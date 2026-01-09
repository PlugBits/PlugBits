import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  getKintoneContextFromParams,
  getQueryParams,
  getReportsApiBaseUrlFromParams,
  getSessionTokenFromParams,
} from '../utils/urlParams';
import { useTenantStore } from '../store/tenantStore';

export type EditorAuthState = 'checking' | 'authorized' | 'unauthorized';

export const useEditorSession = () => {
  const location = useLocation();
  const params = useMemo(
    () => getQueryParams(location.search),
    [location.search, location.hash],
  );
  const sessionToken = useMemo(() => getSessionTokenFromParams(params), [params]);
  const workerBaseUrl = useMemo(() => getReportsApiBaseUrlFromParams(params), [params]);
  const { kintoneBaseUrl, appId } = useMemo(
    () => getKintoneContextFromParams(params),
    [params],
  );

  const tenantContext = useTenantStore((state) => state.tenantContext);
  const setTenantContext = useTenantStore((state) => state.setTenantContext);
  const clearTenantContext = useTenantStore((state) => state.clearTenantContext);
  const [authState, setAuthState] = useState<EditorAuthState>('checking');

  useEffect(() => {
    if (!sessionToken || !workerBaseUrl || !kintoneBaseUrl || !appId) {
      clearTenantContext();
      setAuthState('unauthorized');
      return;
    }

    const normalizedWorkerBaseUrl = workerBaseUrl.replace(/\/$/, '');

    if (
      tenantContext &&
      tenantContext.workerBaseUrl === normalizedWorkerBaseUrl &&
      tenantContext.sessionToken === sessionToken &&
      tenantContext.editorToken
    ) {
      setAuthState('authorized');
      return;
    }

    const controller = new AbortController();
    setAuthState('checking');
    console.log('[editor session] workerBaseUrl', normalizedWorkerBaseUrl);
    console.log('[editor session] sessionToken', sessionToken.slice(0, 8));

    const run = async () => {
      try {
        const verifyRes = await fetch(
          `${normalizedWorkerBaseUrl}/editor/session/verify?token=${encodeURIComponent(
            sessionToken,
          )}`,
          { cache: 'no-store', signal: controller.signal },
        );
        if (!verifyRes.ok) {
          const text = await verifyRes.text();
          throw new Error(text || 'verify failed');
        }
        const verifyData = (await verifyRes.json()) as {
          kintoneBaseUrl?: string;
          appId?: string;
        };

        const exchangeRes = await fetch(`${normalizedWorkerBaseUrl}/editor/session/exchange`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: sessionToken }),
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!exchangeRes.ok) {
          const text = await exchangeRes.text();
          throw new Error(text || 'exchange failed');
        }
        const exchangeData = (await exchangeRes.json()) as {
          editorToken?: string;
          kintoneBaseUrl?: string;
          appId?: string;
        };
        const editorToken = String(exchangeData.editorToken ?? '');
        if (!editorToken) {
          throw new Error('Missing editorToken');
        }

        const nextContext = {
          workerBaseUrl: normalizedWorkerBaseUrl,
          kintoneBaseUrl: String(
            exchangeData.kintoneBaseUrl ?? verifyData.kintoneBaseUrl ?? kintoneBaseUrl,
          ).replace(/\/$/, ''),
          appId: String(exchangeData.appId ?? verifyData.appId ?? appId),
          sessionToken,
          editorToken,
        };
        setTenantContext(nextContext);
        console.log('[editor session] exchange ok', { editorToken: editorToken.slice(0, 8) });
        setAuthState('authorized');
      } catch (error) {
        if (controller.signal.aborted) return;
        console.log('[editor session] auth failed', error);
        clearTenantContext();
        setAuthState('unauthorized');
      }
    };

    void run();

    return () => controller.abort();
  }, [
    sessionToken,
    workerBaseUrl,
    kintoneBaseUrl,
    appId,
    tenantContext,
    setTenantContext,
    clearTenantContext,
  ]);

  return { authState, tenantContext, params, sessionToken };
};
