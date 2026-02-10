import { useEffect, useState } from 'react';
import { useTenantStore } from '../store/tenantStore';

export type KintoneFieldItem = {
  code: string;
  label: string;
  type: string;
  isSubtable: boolean;
  subtableCode?: string;
};

export const useKintoneFields = () => {
  const tenantContext = useTenantStore((state) => state.tenantContext);
  const workerBaseUrl = tenantContext?.workerBaseUrl ?? '';
  const kintoneBaseUrl = tenantContext?.kintoneBaseUrl ?? '';
  const appId = tenantContext?.appId ?? '';
  const editorToken = tenantContext?.editorToken ?? '';
  const [fields, setFields] = useState<KintoneFieldItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  useEffect(() => {
    if (!workerBaseUrl || !editorToken) {
      setFields([]);
      setLoading(false);
      setError(null);
      setErrorCode(null);
      return;
    }

    const controller = new AbortController();
    const fetchFields = async () => {
      setLoading(true);
      setError(null);
      setErrorCode(null);
      try {
        const query = new URLSearchParams();
        if (kintoneBaseUrl) query.set('kintoneBaseUrl', kintoneBaseUrl);
        if (appId) query.set('appId', appId);
        const url = `${workerBaseUrl.replace(/\/$/, '')}/kintone/fields${query.toString() ? `?${query.toString()}` : ''}`;
        const res = await fetch(url, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${editorToken}`,
          },
          signal: controller.signal,
        });
        if (!res.ok) {
          let message = '';
          let code: string | null = null;
          const contentType = res.headers.get('content-type') ?? '';
          if (contentType.includes('application/json')) {
            try {
              const payload = (await res.json()) as { error_code?: string; message?: string };
              code = payload?.error_code ?? null;
              message = payload?.message ?? '';
            } catch {
              message = '';
            }
          }
          if (!message) {
            message = await res.text();
          }

          if (code === 'MISSING_KINTONE_API_TOKEN') {
            setErrorCode(code);
            throw new Error('このアプリのAPIトークンが未設定です。プラグイン設定で設定してください。');
          }

          const tokenStatuses = new Set([400, 401, 403, 502]);
          const fallback = tokenStatuses.has(res.status)
            ? 'kintone APIトークンが未設定、または権限不足のためフィールド一覧を取得できませんでした。'
            : 'Failed to fetch kintone fields';
          throw new Error(message || fallback);
        }
        const data = (await res.json()) as { fields?: KintoneFieldItem[] };
        setFields(Array.isArray(data.fields) ? data.fields : []);
        setLoading(false);
      } catch (err) {
        if (controller.signal.aborted) return;
        setFields([]);
        setLoading(false);
        setError(err instanceof Error ? err.message : 'Failed to fetch kintone fields');
      }
    };

    void fetchFields();
    return () => controller.abort();
  }, [kintoneBaseUrl, appId, workerBaseUrl, editorToken]);

  return {
    fields,
    loading,
    error,
    errorCode,
    kintoneBaseUrl,
    appId,
    hasToken: !!editorToken,
  };
};
