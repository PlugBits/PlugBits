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
  const sessionToken = tenantContext?.sessionToken ?? '';
  const [fields, setFields] = useState<KintoneFieldItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  useEffect(() => {
    if (!workerBaseUrl || !sessionToken) {
      setFields([]);
      setLoading(false);
      setError('設定画面から開き直してください。');
      setErrorCode('INVALID_SESSION_TOKEN');
      return;
    }

    const controller = new AbortController();
    const fetchFields = async () => {
      setLoading(true);
      setError(null);
      setErrorCode(null);
      try {
        const sessionUrl = `${workerBaseUrl.replace(/\/$/, '')}/session/fields`;
        const sessionRes = await fetch(sessionUrl, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${sessionToken}`,
          },
          signal: controller.signal,
        });
        let payload: {
          ok?: boolean;
          fields?: KintoneFieldItem[];
          error_code?: string | null;
          message?: string | null;
        } = {};
        if (sessionRes.headers.get('content-type')?.includes('application/json')) {
          payload = (await sessionRes.json()) as {
            ok?: boolean;
            fields?: KintoneFieldItem[];
            error_code?: string | null;
            message?: string | null;
          };
        }
        if (sessionRes.ok && payload.ok !== false) {
          const list = Array.isArray(payload.fields) ? payload.fields : [];
          setFields(list);
          setLoading(false);
          return;
        }

        const sessionCode = payload?.error_code ?? null;
        const sessionMessage = payload?.message ?? '';
        if (sessionCode === 'KINTONE_PERMISSION_DENIED') {
          setErrorCode(sessionCode);
          throw new Error(
            sessionMessage ||
              'このアプリでフィールド一覧を取得できません。権限設定を確認してください。',
          );
        }
        if (sessionCode === 'INVALID_SESSION_TOKEN') {
          setErrorCode(sessionCode);
          throw new Error(sessionMessage || '設定画面から開き直してください。');
        }
        if (sessionCode === 'MISSING_SESSION_FIELDS') {
          setErrorCode(sessionCode);
          throw new Error(
            sessionMessage ||
              'フィールド同期が未完了です。設定画面から再度「テンプレを選ぶ」を押してください。',
          );
        }

        if (editorToken) {
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
              throw new Error('このアプリのAPIトークンが未選択です。設定画面で設定してください。');
            }

            const tokenStatuses = new Set([400, 401, 403, 502]);
            const fallback = tokenStatuses.has(res.status)
              ? 'フィールド一覧を取得できませんでした。権限設定を確認してください。'
              : 'Failed to fetch kintone fields';
            throw new Error(message || fallback);
          }
          const data = (await res.json()) as { fields?: KintoneFieldItem[] };
          setFields(Array.isArray(data.fields) ? data.fields : []);
          setLoading(false);
          return;
        }

        throw new Error('フィールド一覧を取得できませんでした。');
      } catch (err) {
        if (controller.signal.aborted) return;
        setFields([]);
        setLoading(false);
        setError(err instanceof Error ? err.message : 'フィールド一覧を取得できませんでした。');
      }
    };

    void fetchFields();
    return () => controller.abort();
  }, [kintoneBaseUrl, appId, workerBaseUrl, editorToken, sessionToken]);

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
