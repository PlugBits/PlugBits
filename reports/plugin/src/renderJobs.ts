import { appendDebugParam } from '../../src/shared/appendDebug';

export type RenderJobStatus = 'queued' | 'processing' | 'done' | 'failed';

type RenderJobCreateResponse = {
  jobId?: string;
  status?: RenderJobStatus;
};

type RenderJobPollResponse = {
  jobId?: string;
  status?: RenderJobStatus;
  error?: string | null;
};

type RequestRenderJobPdfOptions = {
  workerBaseUrl: string;
  kintoneBaseUrl: string;
  appId: string;
  templateId: string;
  recordId: string;
  recordRevision: string;
  kintoneApiToken?: string;
  jpFontFamily?: string;
  debugEnabled?: boolean;
  onStatus?: (status: RenderJobStatus) => void;
};

const POLL_INTERVAL_MS = 2500;
const POLL_MAX_ATTEMPTS = 120;

const sessionTokenCache = new Map<string, { token: string; expiresAt: number }>();

export const JOB_STATUS_LABEL: Record<RenderJobStatus, string> = {
  queued: 'キュー待機中',
  processing: 'PDF生成中',
  done: 'ダウンロード可能',
  failed: '生成失敗。再試行してください',
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const safeJson = async (res: Response) => {
  try {
    return await res.json();
  } catch {
    return null;
  }
};

const buildErrorMessage = async (res: Response, fallback: string) => {
  const parsed = await safeJson(res);
  const jsonReason =
    (parsed && typeof parsed === 'object' && (parsed as any).reason) ||
    (parsed && typeof parsed === 'object' && (parsed as any).error) ||
    '';
  if (jsonReason) return String(jsonReason);
  const text = await res.text().catch(() => '');
  return text || fallback;
};

const getSessionTokenForJobs = async (
  workerBaseUrl: string,
  kintoneBaseUrl: string,
  appId: string,
  kintoneApiToken?: string,
): Promise<string> => {
  const key = `${kintoneBaseUrl}__${appId}`;
  const cached = sessionTokenCache.get(key);
  if (cached && cached.expiresAt - 60_000 > Date.now()) {
    return cached.token;
  }

  const sessionRes = await fetch(`${workerBaseUrl.replace(/\/$/, '')}/editor/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kintoneBaseUrl,
      appId,
      ...(kintoneApiToken ? { kintoneApiToken } : {}),
    }),
  });
  if (!sessionRes.ok) {
    throw new Error(await buildErrorMessage(sessionRes, 'セッショントークン発行に失敗しました'));
  }
  const sessionPayload = (await safeJson(sessionRes)) as { sessionToken?: string } | null;
  const sessionToken = String(sessionPayload?.sessionToken ?? '').trim();
  if (!sessionToken) {
    throw new Error('セッショントークンが取得できませんでした');
  }
  const expiresAt = Date.now() + 50 * 60_000;
  sessionTokenCache.set(key, { token: sessionToken, expiresAt });
  return sessionToken;
};

export const requestRenderJobPdf = async (
  options: RequestRenderJobPdfOptions,
): Promise<Blob> => {
  const {
    workerBaseUrl,
    kintoneBaseUrl,
    appId,
    templateId,
    recordId,
    recordRevision,
    kintoneApiToken,
    jpFontFamily,
    debugEnabled = false,
    onStatus,
  } = options;
  const baseUrl = workerBaseUrl.replace(/\/$/, '');
  const sessionToken = await getSessionTokenForJobs(baseUrl, kintoneBaseUrl, appId, kintoneApiToken);
  const authHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-session-token': sessionToken,
  };

  const createUrl = appendDebugParam(`${baseUrl}/render-jobs`, debugEnabled);
  const createBody: Record<string, unknown> = {
    templateId,
    recordId,
    recordRevision,
    kintoneBaseUrl,
    appId,
    sessionToken,
    jpFontFamily: jpFontFamily ?? 'noto',
  };
  console.log('[DBG_PLUGIN_RENDER_JOB_REQUEST]', {
    hasSessionToken: Boolean(sessionToken),
    sessionTokenLength: sessionToken.length,
    recordId,
    recordRevision,
  });

  const createRes = await fetch(createUrl, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify(createBody),
  });
  if (!createRes.ok) {
    throw new Error(await buildErrorMessage(createRes, 'PDF生成ジョブの作成に失敗しました'));
  }

  const createPayload = (await safeJson(createRes)) as RenderJobCreateResponse | null;
  const jobId = String(createPayload?.jobId ?? '').trim();
  if (!jobId) {
    throw new Error('jobId が取得できませんでした');
  }

  let currentStatus: RenderJobStatus = createPayload?.status ?? 'queued';
  onStatus?.(currentStatus);

  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt += 1) {
    if (currentStatus === 'done') break;
    if (currentStatus === 'failed') {
      throw new Error('生成失敗。再試行してください');
    }
    await sleep(POLL_INTERVAL_MS);

    const pollUrl = appendDebugParam(
      `${baseUrl}/render-jobs/${encodeURIComponent(jobId)}`,
      debugEnabled,
    );
    const pollRes = await fetch(pollUrl, {
      method: 'GET',
      headers: { 'x-session-token': sessionToken },
    });
    if (!pollRes.ok) {
      throw new Error(await buildErrorMessage(pollRes, 'ジョブ状態の取得に失敗しました'));
    }
    const pollPayload = (await safeJson(pollRes)) as RenderJobPollResponse | null;
    const nextStatus = pollPayload?.status ?? 'processing';
    if (nextStatus !== currentStatus) {
      currentStatus = nextStatus;
      onStatus?.(currentStatus);
    }
    if (currentStatus === 'failed') {
      const reason =
        typeof pollPayload?.error === 'string' && pollPayload.error.trim()
          ? pollPayload.error
          : '生成失敗。再試行してください';
      throw new Error(reason);
    }
    if (currentStatus === 'done') break;
  }

  if (currentStatus !== 'done') {
    throw new Error('PDF生成がタイムアウトしました。時間をおいて再試行してください');
  }

  const downloadUrl = appendDebugParam(
    `${baseUrl}/render-jobs/${encodeURIComponent(jobId)}/pdf`,
    debugEnabled,
  );
  const downloadRes = await fetch(downloadUrl, {
    method: 'GET',
    headers: { 'x-session-token': sessionToken },
  });
  if (!downloadRes.ok) {
    throw new Error(await buildErrorMessage(downloadRes, 'PDFの取得に失敗しました'));
  }
  return downloadRes.blob();
};
