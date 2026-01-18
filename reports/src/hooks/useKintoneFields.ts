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

  useEffect(() => {
    if (!workerBaseUrl || !editorToken) {
      setFields([]);
      setLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    const fetchFields = async () => {
      setLoading(true);
      setError(null);
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
          const text = await res.text();
          const tokenStatuses = new Set([400, 401, 403, 502]);
          const message = tokenStatuses.has(res.status)
            ? 'kintone APIトークンが未設定、または権限不足のためフィールド一覧を取得できませんでした。'
            : text || 'Failed to fetch kintone fields';
          throw new Error(message);
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
    kintoneBaseUrl,
    appId,
    hasToken: !!editorToken,
  };
};
