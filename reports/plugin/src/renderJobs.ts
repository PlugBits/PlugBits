import { appendDebugParam } from '../../src/shared/appendDebug';

export type RenderJobStatus = 'queued' | 'running' | 'done' | 'failed';

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
const activeCreateRequests = new Map<string, Promise<RenderJobCreateResponse>>();
const activeJobPolls = new Set<string>();
const activeJobDownloads = new Map<string, Promise<Blob>>();
const downloadedJobBlobs = new Map<string, Blob>();
const jobStatusListeners = new Map<string, Set<(status: RenderJobStatus) => void>>();
const jobRequestBindings = new Map<string, Set<string>>();

export const JOB_STATUS_LABEL: Record<RenderJobStatus, string> = {
  queued: 'キュー待機中',
  running: 'PDF生成中',
  done: 'ダウンロード可能',
  failed: '生成失敗。再試行してください',
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const logTimerCount = () => {
  console.log('[DBG_PLUGIN_JOB_TIMER_COUNT]', {
    activeJobIds: Array.from(activeJobPolls),
    timerCount: activeJobPolls.size,
  });
};

const addJobStatusListener = (jobId: string, listener?: (status: RenderJobStatus) => void) => {
  if (!listener) return;
  const listeners = jobStatusListeners.get(jobId) ?? new Set<(status: RenderJobStatus) => void>();
  listeners.add(listener);
  jobStatusListeners.set(jobId, listeners);
};

const emitJobStatus = (jobId: string, status: RenderJobStatus) => {
  console.log('[DBG_PLUGIN_JOB_STATUS]', { jobId, status });
  const listeners = jobStatusListeners.get(jobId);
  if (!listeners) return;
  for (const listener of listeners) {
    try {
      listener(status);
    } catch {
      // ignore listener errors
    }
  }
};

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

const buildCreateSignature = (args: {
  templateId: string;
  recordId: string;
  recordRevision: string;
  kintoneBaseUrl: string;
  appId: string;
  jpFontFamily: string;
}) =>
  [
    args.templateId,
    args.recordId,
    args.recordRevision,
    args.kintoneBaseUrl,
    args.appId,
    args.jpFontFamily,
  ].join('::');

const bindRequestToJob = (requestKey: string, jobId: string, recordId: string, recordRevision: string) => {
  const bindings = jobRequestBindings.get(jobId) ?? new Set<string>();
  bindings.add(requestKey);
  jobRequestBindings.set(jobId, bindings);
  console.log('[DBG_PLUGIN_JOB_BIND_UI]', { recordId, recordRevision, jobId });
};

const exchangeSessionForJobs = async (
  workerBaseUrl: string,
  sessionToken: string,
  kintoneBaseUrl: string,
  appId: string,
  kintoneApiToken: string,
) => {
  console.log('[DBG_PLUGIN_SESSION_EXCHANGE]', {
    hasSessionToken: Boolean(sessionToken),
    hasKintoneApiToken: Boolean(kintoneApiToken),
    tokenLength: kintoneApiToken.length,
    appId,
    kintoneBaseUrl,
  });
  const exchangeRes = await fetch(`${workerBaseUrl.replace(/\/$/, '')}/editor/session/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: sessionToken,
      sessionToken,
      kintoneApiToken,
      appId,
      kintoneBaseUrl,
    }),
  });
  if (!exchangeRes.ok) {
    throw new Error(await buildErrorMessage(exchangeRes, 'セッション交換に失敗しました'));
  }
};

const getSessionTokenForJobs = async (
  workerBaseUrl: string,
  kintoneBaseUrl: string,
  appId: string,
  kintoneApiToken?: string,
): Promise<string> => {
  const normalizedToken = String(kintoneApiToken ?? '').trim();
  if (!normalizedToken) {
    throw new Error('kintoneApiToken が未設定です。プラグイン設定を確認してください。');
  }
  const key = `${kintoneBaseUrl}__${appId}`;
  const cached = sessionTokenCache.get(key);
  if (cached && cached.expiresAt - 60_000 > Date.now()) {
    // Always refresh token binding before /render-jobs.
    await exchangeSessionForJobs(
      workerBaseUrl,
      cached.token,
      kintoneBaseUrl,
      appId,
      normalizedToken,
    );
    return cached.token;
  }

  const sessionRes = await fetch(`${workerBaseUrl.replace(/\/$/, '')}/editor/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kintoneBaseUrl,
      appId,
      kintoneApiToken: normalizedToken,
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
  await exchangeSessionForJobs(
    workerBaseUrl,
    sessionToken,
    kintoneBaseUrl,
    appId,
    normalizedToken,
  );
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
  const requestKey = `${templateId}::${recordId}::${recordRevision}::${appId}::${Date.now()}`;
  const baseUrl = workerBaseUrl.replace(/\/$/, '');
  const sessionToken = await getSessionTokenForJobs(baseUrl, kintoneBaseUrl, appId, kintoneApiToken);
  const authHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-session-token': sessionToken,
  };
  const selectedFont = jpFontFamily ?? 'noto';
  const createSignature = buildCreateSignature({
    templateId,
    recordId,
    recordRevision,
    kintoneBaseUrl,
    appId,
    jpFontFamily: selectedFont,
  });

  let createPromise = activeCreateRequests.get(createSignature);
  if (!createPromise) {
    console.log('[DBG_PLUGIN_JOB_CREATE_START]', {
      requestKey,
      recordId,
      recordRevision,
    });
    createPromise = (async () => {
      const createUrl = appendDebugParam(`${baseUrl}/render-jobs`, debugEnabled);
      const createBody: Record<string, unknown> = {
        templateId,
        recordId,
        recordRevision,
        kintoneBaseUrl,
        appId,
        sessionToken,
        jpFontFamily: selectedFont,
      };
      console.log('[DBG_PLUGIN_RENDER_JOB_REQUEST]', {
        hasSessionToken: Boolean(sessionToken),
        sessionTokenLength: sessionToken.length,
        hasKintoneApiToken: Boolean(kintoneApiToken),
        tokenLength: String(kintoneApiToken ?? '').length,
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
      const created = ((await safeJson(createRes)) as RenderJobCreateResponse | null) ?? {};
      console.log('[DBG_PLUGIN_JOB_CREATE_DONE]', {
        requestKey,
        jobId: String(created.jobId ?? ''),
      });
      return created;
    })().finally(() => {
      activeCreateRequests.delete(createSignature);
    });
    activeCreateRequests.set(createSignature, createPromise);
  }

  const createPayload = await createPromise;
  const jobId = String(createPayload?.jobId ?? '').trim();
  if (!jobId) {
    throw new Error('jobId が取得できませんでした');
  }
  bindRequestToJob(requestKey, jobId, recordId, recordRevision);
  addJobStatusListener(jobId, onStatus);
  emitJobStatus(jobId, createPayload?.status ?? 'queued');

  let downloadPromise = activeJobDownloads.get(jobId);
  if (!downloadPromise) {
    downloadPromise = (async () => {
      if (downloadedJobBlobs.has(jobId)) {
        console.log('[DBG_PLUGIN_JOB_DOWNLOAD_ONCE]', { jobId, alreadyDownloaded: true });
        console.log('[DBG_PLUGIN_JOB_FINALIZE]', {
          jobId,
          status: 'done',
          downloaded: true,
        });
        return downloadedJobBlobs.get(jobId)!;
      }

      let currentStatus: RenderJobStatus = createPayload?.status ?? 'queued';
      console.log('[DBG_PLUGIN_JOB_POLL_START]', { jobId });
      activeJobPolls.add(jobId);
      logTimerCount();
      emitJobStatus(jobId, currentStatus);
      let stopReason: string = currentStatus;

      try {
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
          const nextStatus = pollPayload?.status ?? 'running';
          if (nextStatus !== currentStatus) {
            currentStatus = nextStatus;
            emitJobStatus(jobId, currentStatus);
          }
          if (currentStatus === 'failed') {
            const reason =
              typeof pollPayload?.error === 'string' && pollPayload.error.trim()
                ? pollPayload.error
                : '生成失敗。再試行してください';
            stopReason = reason;
            throw new Error(reason);
          }
          if (currentStatus === 'done') break;
        }

        if (currentStatus !== 'done') {
          stopReason = 'timeout';
          throw new Error('PDF生成がタイムアウトしました。時間をおいて再試行してください');
        }
        stopReason = 'done';

        console.log('[DBG_PLUGIN_JOB_DOWNLOAD_ONCE]', { jobId, alreadyDownloaded: false });
        const downloadUrl = appendDebugParam(
          `${baseUrl}/render-jobs/${encodeURIComponent(jobId)}/file`,
          debugEnabled,
        );
        const downloadRes = await fetch(downloadUrl, {
          method: 'GET',
          headers: { 'x-session-token': sessionToken },
        });
        if (!downloadRes.ok) {
          throw new Error(await buildErrorMessage(downloadRes, 'PDFの取得に失敗しました'));
        }
        const blob = await downloadRes.blob();
        downloadedJobBlobs.set(jobId, blob);
        console.log('[DBG_PLUGIN_JOB_FINALIZE]', {
          jobId,
          status: 'done',
          downloaded: true,
        });
        return blob;
      } catch (error) {
        console.log('[DBG_PLUGIN_JOB_FINALIZE]', {
          jobId,
          status: 'failed',
          downloaded: false,
        });
        throw error;
      } finally {
        if (activeJobPolls.delete(jobId)) {
          logTimerCount();
        }
        console.log('[DBG_PLUGIN_JOB_POLL_STOP]', {
          jobId,
          reason: stopReason,
        });
        jobStatusListeners.delete(jobId);
        jobRequestBindings.delete(jobId);
      }
    })().finally(() => {
      activeJobDownloads.delete(jobId);
    });
    activeJobDownloads.set(jobId, downloadPromise);
  }

  return downloadPromise;
};
