import { appendDebugParam } from '../../src/shared/appendDebug';

export type RenderJobRawStatus =
  | 'queued'
  | 'leased'
  | 'dispatched'
  | 'processing'
  | 'running'
  | 'done'
  | 'failed';

export type RenderJobStatus = 'queued' | 'running' | 'done' | 'error';

export type RenderJobStatusPayload = {
  ok: boolean;
  jobId: string;
  status: RenderJobStatus;
  rawStatus?: RenderJobRawStatus | null;
  templateId?: string | null;
  recordId?: string | null;
  mode?: 'print' | 'save' | null;
  source?: string | null;
  executionName?: string | null;
  createdAt?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  pdfUrl?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  rendererVersion?: string | null;
  reused?: boolean;
};

type RenderJobCreateResponse = Partial<RenderJobStatusPayload>;
type RenderJobLatestResponse = {
  ok?: boolean;
  job?: RenderJobCreateResponse | null;
};

type RequestRenderJobOptions = {
  workerBaseUrl: string;
  kintoneBaseUrl: string;
  appId: string;
  templateId: string;
  recordId: string;
  recordRevision: string;
  mode?: 'print' | 'save';
  kintoneApiToken?: string;
  jpFontFamily?: string;
  debugEnabled?: boolean;
  onStatus?: (status: RenderJobStatus) => void;
  source?: string;
  openWhenDone?: boolean;
};

type RenderJobClientContext = {
  baseUrl: string;
  debugEnabled: boolean;
  sessionToken: string;
  requestKey: string;
  job: RenderJobStatusPayload;
};

type PollRenderJobOptions = {
  baseUrl: string;
  sessionToken: string;
  jobId: string;
  debugEnabled?: boolean;
  onStatus?: (status: RenderJobStatus) => void;
};

const POLL_INTERVAL_MS = 2000;
const POLL_MAX_ATTEMPTS = 60;

const sessionTokenCache = new Map<string, { token: string; expiresAt: number }>();
const activeCreateRequests = new Map<string, Promise<RenderJobClientContext>>();
const downloadedJobBlobs = new Map<string, Blob>();

export const JOB_STATUS_LABEL: Record<RenderJobStatus, string> = {
  queued: '生成待ちです',
  running: 'PDFを生成しています',
  done: 'PDFの準備ができました',
  error: 'PDF生成に失敗しました',
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
    (parsed && typeof parsed === 'object' && (parsed as any).errorMessage) ||
    (parsed && typeof parsed === 'object' && (parsed as any).error) ||
    '';
  if (jsonReason) return String(jsonReason);
  const text = await res.text().catch(() => '');
  return text || fallback;
};

const normalizePublicStatus = (status?: string | null): RenderJobStatus => {
  if (status === 'done') return 'done';
  if (status === 'failed' || status === 'error') return 'error';
  if (status === 'running' || status === 'processing') return 'running';
  return 'queued';
};

const normalizeStatusPayload = (
  payload: RenderJobCreateResponse | null | undefined,
  baseUrl: string,
  fallbackJobId = '',
): RenderJobStatusPayload => {
  const jobId = String(payload?.jobId ?? fallbackJobId ?? '').trim();
  const rawStatus = (payload?.rawStatus ?? payload?.status ?? 'queued') as RenderJobRawStatus;
  const status = normalizePublicStatus(String(payload?.status ?? rawStatus ?? 'queued'));
  const pdfUrl = payload?.pdfUrl
    ? String(payload.pdfUrl)
    : jobId && status === 'done'
      ? `${baseUrl.replace(/\/$/, '')}/render-jobs/${encodeURIComponent(jobId)}/pdf`
      : null;
  return {
    ok: payload?.ok ?? status !== 'error',
    jobId,
    status,
    rawStatus,
    templateId: payload?.templateId ?? null,
    recordId: payload?.recordId ?? null,
    mode: (payload?.mode as 'print' | 'save' | undefined) ?? null,
    source: (payload?.source as string | undefined) ?? null,
    executionName: payload?.executionName ?? null,
    createdAt: payload?.createdAt ?? null,
    startedAt: payload?.startedAt ?? null,
    finishedAt: payload?.finishedAt ?? null,
    pdfUrl,
    errorCode: payload?.errorCode ?? null,
    errorMessage: payload?.errorMessage ?? null,
    rendererVersion: payload?.rendererVersion ?? null,
    reused: payload?.reused === true,
  };
};

const buildCreateSignature = (args: {
  templateId: string;
  recordId: string;
  recordRevision: string;
  kintoneBaseUrl: string;
  appId: string;
  jpFontFamily: string;
  mode: 'print' | 'save';
}) =>
  [
    args.templateId,
    args.recordId,
    args.recordRevision,
    args.kintoneBaseUrl,
    args.appId,
    args.jpFontFamily,
    args.mode,
  ].join('::');

const exchangeSessionForJobs = async (
  workerBaseUrl: string,
  sessionToken: string,
  kintoneBaseUrl: string,
  appId: string,
  kintoneApiToken: string,
) => {
  const exchangeRes = await fetch(`${workerBaseUrl}/editor/session/exchange`, {
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
    await exchangeSessionForJobs(
      workerBaseUrl,
      cached.token,
      kintoneBaseUrl,
      appId,
      normalizedToken,
    );
    return cached.token;
  }

  const sessionRes = await fetch(`${workerBaseUrl}/editor/session`, {
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
  sessionTokenCache.set(key, {
    token: sessionToken,
    expiresAt: Date.now() + 50 * 60_000,
  });
  return sessionToken;
};

export const buildRenderJobPdfUrl = (args: {
  workerBaseUrl: string;
  jobId: string;
  sessionToken: string;
  debugEnabled?: boolean;
}) => {
  const url = new URL(
    appendDebugParam(
      `${args.workerBaseUrl.replace(/\/$/, '')}/render-jobs/${encodeURIComponent(args.jobId)}/pdf`,
      args.debugEnabled === true,
    ),
  );
  url.searchParams.set('sessionToken', args.sessionToken);
  return url.toString();
};

export const createRenderJob = async (
  options: RequestRenderJobOptions,
): Promise<RenderJobClientContext> => {
  const {
    workerBaseUrl,
    kintoneBaseUrl,
    appId,
    templateId,
    recordId,
    recordRevision,
    mode = 'print',
    kintoneApiToken,
    jpFontFamily,
    debugEnabled = false,
    source = 'plugin-record-detail',
    openWhenDone = true,
  } = options;
  const baseUrl = workerBaseUrl.replace(/\/$/, '');
  const sessionToken = await getSessionTokenForJobs(baseUrl, kintoneBaseUrl, appId, kintoneApiToken);
  const selectedFont = jpFontFamily ?? 'noto';
  const createSignature = buildCreateSignature({
    templateId,
    recordId,
    recordRevision,
    kintoneBaseUrl,
    appId,
    jpFontFamily: selectedFont,
    mode,
  });

  let createPromise = activeCreateRequests.get(createSignature);
  if (!createPromise) {
    createPromise = (async () => {
      const requestKey = `${templateId}::${recordId}::${recordRevision}::${Date.now()}`;
      const createUrl = appendDebugParam(`${baseUrl}/render-jobs`, debugEnabled);
      const createRes = await fetch(createUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-session-token': sessionToken,
        },
        body: JSON.stringify({
          templateId,
          recordId,
          recordRevision,
          mode,
          kintoneBaseUrl,
          appId,
          sessionToken,
          jpFontFamily: selectedFont,
          openWhenDone,
          kintone: {
            baseUrl: kintoneBaseUrl,
            appId,
          },
          context: {
            source,
            userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
          },
        }),
      });
      if (!createRes.ok) {
        throw new Error(await buildErrorMessage(createRes, 'PDF生成ジョブの作成に失敗しました'));
      }
      const created = normalizeStatusPayload(
        (await safeJson(createRes)) as RenderJobCreateResponse | null,
        baseUrl,
      );
      if (!created.jobId) {
        throw new Error('jobId が取得できませんでした');
      }
      return {
        baseUrl,
        debugEnabled,
        sessionToken,
        requestKey,
        job: created,
      };
    })().finally(() => {
      activeCreateRequests.delete(createSignature);
    });
    activeCreateRequests.set(createSignature, createPromise);
  }

  return createPromise;
};

export const fetchLatestRenderJob = async (options: {
  workerBaseUrl: string;
  kintoneBaseUrl: string;
  appId: string;
  templateId: string;
  recordId: string;
  kintoneApiToken?: string;
  debugEnabled?: boolean;
  mode?: 'print' | 'save';
}): Promise<RenderJobClientContext | null> => {
  const baseUrl = options.workerBaseUrl.replace(/\/$/, '');
  const sessionToken = await getSessionTokenForJobs(
    baseUrl,
    options.kintoneBaseUrl,
    options.appId,
    options.kintoneApiToken,
  );
  const latestUrl = new URL(`${baseUrl}/render-jobs/latest`);
  latestUrl.searchParams.set('templateId', options.templateId);
  latestUrl.searchParams.set('recordId', options.recordId);
  latestUrl.searchParams.set('mode', options.mode ?? 'print');
  if (options.debugEnabled) latestUrl.searchParams.set('debug', '1');
  const res = await fetch(latestUrl.toString(), {
    method: 'GET',
    headers: { 'x-session-token': sessionToken },
  });
  if (!res.ok) {
    throw new Error(await buildErrorMessage(res, '直近のPDF生成ジョブ取得に失敗しました'));
  }
  const payload = (await safeJson(res)) as RenderJobLatestResponse | null;
  if (!payload?.job) return null;
  const job = normalizeStatusPayload(payload.job, baseUrl);
  if (!job.jobId) return null;
  return {
    baseUrl,
    debugEnabled: options.debugEnabled === true,
    sessionToken,
    requestKey: `${options.templateId}::${options.recordId}::${options.mode ?? 'print'}::latest`,
    job,
  };
};

export const fetchRenderJobStatus = async (args: PollRenderJobOptions): Promise<RenderJobStatusPayload> => {
  const pollUrl = appendDebugParam(
    `${args.baseUrl.replace(/\/$/, '')}/render-jobs/${encodeURIComponent(args.jobId)}`,
    args.debugEnabled === true,
  );
  const pollRes = await fetch(pollUrl, {
    method: 'GET',
    headers: { 'x-session-token': args.sessionToken },
  });
  if (!pollRes.ok) {
    throw new Error(await buildErrorMessage(pollRes, 'ジョブ状態の取得に失敗しました'));
  }
  return normalizeStatusPayload(
    (await safeJson(pollRes)) as RenderJobCreateResponse | null,
    args.baseUrl,
    args.jobId,
  );
};

export const waitForRenderJob = async (args: PollRenderJobOptions): Promise<RenderJobStatusPayload> => {
  let lastStatus: RenderJobStatus | null = null;
  for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt += 1) {
    const payload = await fetchRenderJobStatus(args);
    if (payload.status !== lastStatus) {
      lastStatus = payload.status;
      args.onStatus?.(payload.status);
    }
    if (payload.status === 'done' || payload.status === 'error') {
      return payload;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error('生成に時間がかかっています。しばらくしてから再確認してください。');
};

export const requestRenderJobPdf = async (
  options: RequestRenderJobOptions,
): Promise<Blob> => {
  const client = await createRenderJob(options);
  options.onStatus?.(client.job.status);
  const finalStatus =
    client.job.status === 'done' || client.job.status === 'error'
      ? client.job
      : await waitForRenderJob({
          baseUrl: client.baseUrl,
          sessionToken: client.sessionToken,
          jobId: client.job.jobId,
          debugEnabled: client.debugEnabled,
          onStatus: options.onStatus,
        });
  if (finalStatus.status === 'error') {
    throw new Error('PDF生成に失敗しました。もう一度お試しください。');
  }

  if (downloadedJobBlobs.has(finalStatus.jobId)) {
    return downloadedJobBlobs.get(finalStatus.jobId)!;
  }

  const downloadUrl = appendDebugParam(
    `${client.baseUrl}/render-jobs/${encodeURIComponent(finalStatus.jobId)}/file`,
    client.debugEnabled,
  );
  const downloadRes = await fetch(downloadUrl, {
    method: 'GET',
    headers: { 'x-session-token': client.sessionToken },
  });
  if (!downloadRes.ok) {
    throw new Error(await buildErrorMessage(downloadRes, 'PDFの取得に失敗しました'));
  }
  const blob = await downloadRes.blob();
  downloadedJobBlobs.set(finalStatus.jobId, blob);
  return blob;
};
