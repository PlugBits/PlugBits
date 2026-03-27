import type {
  RendererJobResultRequest,
  RendererJobTransitionRequest,
  StoredRenderJobPayload,
} from './shared/rendering.js';
import { logRendererInfo } from './logging.js';

const DEFAULT_WORKER_TIMEOUT_MS = 120_000;

export const resolveWorkerInternalTimeoutMs = (): number => {
  const parsedTimeout = Number(process.env.WORKER_INTERNAL_TIMEOUT_MS ?? '');
  return Number.isFinite(parsedTimeout) && parsedTimeout > 0
    ? parsedTimeout
    : DEFAULT_WORKER_TIMEOUT_MS;
};

type WorkerClientContext = {
  jobId: string;
  templateId: string;
  tenantId: string;
  rendererVersion: string;
  backgroundKey?: string | null;
  pdfKey?: string | null;
};

const getWorkerConfig = () => {
  const baseUrl = process.env.WORKER_INTERNAL_BASE_URL?.trim();
  const token =
    process.env.RENDERER_INTERNAL_TOKEN?.trim() ||
    process.env.WORKER_INTERNAL_TOKEN?.trim();
  if (!baseUrl) {
    throw new Error('RENDERER_HTTP_FAILED: WORKER_INTERNAL_BASE_URL is not configured');
  }
  if (!token) {
    throw new Error('UNAUTHORIZED_RENDERER_CALL: RENDERER_INTERNAL_TOKEN is not configured');
  }
  return {
    baseUrl: baseUrl.replace(/\/$/, ''),
    token,
    timeoutMs: resolveWorkerInternalTimeoutMs(),
  };
};

const fetchWithTimeout = async (
  input: string,
  init: RequestInit,
  timeoutMs: number,
) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if ((error as any)?.name === 'AbortError') {
      throw new Error(`RENDERER_TIMEOUT: worker internal timeout after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

const logWorkerClient = (
  tag: string,
  context: WorkerClientContext,
  extra?: Record<string, unknown>,
) => {
  logRendererInfo('debug', tag, {
    jobId: context.jobId,
    templateId: context.templateId,
    tenantId: context.tenantId,
    rendererVersion: context.rendererVersion,
    backgroundKey: context.backgroundKey ?? null,
    pdfKey: context.pdfKey ?? null,
    ...extra,
  });
};

const traceWorkerClient = (tag: string, payload: Record<string, unknown>) => {
  console.error(`[${tag}]`, JSON.stringify(payload));
};

const fetchWorkerInternal = async (args: {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: BodyInit;
  timeoutMs: number;
  requestId: string;
  operation: string;
  context: WorkerClientContext;
}) => {
  traceWorkerClient('WORKER_CLIENT_REQUEST', {
    operation: args.operation,
    method: args.method,
    url: args.url,
    requestId: args.requestId,
    jobId: args.context.jobId,
    templateId: args.context.templateId,
    tenantId: args.context.tenantId,
    headerNames: Object.keys(args.headers),
    rendererRequestId: args.headers['x-renderer-request-id'] ?? null,
    rendererJobId: args.headers['x-renderer-job-id'] ?? null,
    timeoutMs: args.timeoutMs,
  });
  try {
    const response = await fetchWithTimeout(
      args.url,
      {
        method: args.method,
        headers: args.headers,
        body: args.body,
      },
      args.timeoutMs,
    );
    traceWorkerClient('WORKER_CLIENT_RESPONSE', {
      operation: args.operation,
      method: args.method,
      url: args.url,
      requestId: args.requestId,
      jobId: args.context.jobId,
      status: response.status,
      statusText: response.statusText,
    });
    return response;
  } catch (error) {
    traceWorkerClient('WORKER_CLIENT_ERROR', {
      operation: args.operation,
      method: args.method,
      url: args.url,
      requestId: args.requestId,
      jobId: args.context.jobId,
      errorMessage: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
};

const traceNon2xx = (args: {
  operation: string;
  requestId: string;
  jobId: string;
  url: string;
  status: number;
  statusText: string;
  responseText: string;
}) => {
  traceWorkerClient('WORKER_CLIENT_NON_2XX', {
    operation: args.operation,
    requestId: args.requestId,
    jobId: args.jobId,
    url: args.url,
    status: args.status,
    statusText: args.statusText,
    responseText: args.responseText.slice(0, 1024),
  });
};

export const fetchAssetBytes = async (
  key: string,
  requestId: string,
  context: WorkerClientContext,
) => {
  const { baseUrl, token, timeoutMs } = getWorkerConfig();
  const url = `${baseUrl}/internal/render-assets?key=${encodeURIComponent(key)}`;
  logWorkerClient('[DBG_RENDERER_WORKER_REQUEST]', context, {
    operation: 'background_fetch',
    requestId,
    url,
    timeoutMs,
  });
  const response = await fetchWorkerInternal({
    url,
    method: 'GET',
    headers: {
      'x-renderer-internal-token': token,
      'x-renderer-request-id': requestId,
      'x-renderer-job-id': context.jobId,
    },
    timeoutMs,
    requestId,
    operation: 'background_fetch',
    context,
  });
  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    traceNon2xx({
      operation: 'background_fetch',
      requestId,
      jobId: context.jobId,
      url,
      status: response.status,
      statusText: response.statusText,
      responseText: bodyText,
    });
    logWorkerClient('[DBG_RENDERER_WORKER_RESPONSE]', context, {
      operation: 'background_fetch',
      requestId,
      url,
      status: response.status,
      responseText: bodyText.slice(0, 200),
    });
    if (response.status === 401) {
      throw new Error(`UNAUTHORIZED_RENDERER_CALL: ${bodyText.slice(0, 200)}`);
    }
    throw new Error(`BACKGROUND_FETCH_FAILED: ${response.status} ${bodyText.slice(0, 200)}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  logWorkerClient('[DBG_RENDERER_WORKER_RESPONSE]', context, {
    operation: 'background_fetch',
    requestId,
    url,
    status: response.status,
    backgroundBytes: arrayBuffer.byteLength,
  });
  return {
    bytes: new Uint8Array(arrayBuffer),
    contentType: response.headers.get('content-type') ?? 'application/octet-stream',
  };
};

export const uploadRenderedPdf = async (args: {
  jobId: string;
  templateId: string;
  tenantId: string;
  pdfKey: string;
  pdfBytes: Uint8Array;
  rendererVersion: string;
  requestId: string;
}) => {
  const { baseUrl, token, timeoutMs } = getWorkerConfig();
  const context: WorkerClientContext = {
    jobId: args.jobId,
    templateId: args.templateId,
    tenantId: args.tenantId,
    rendererVersion: args.rendererVersion,
    pdfKey: args.pdfKey,
  };
  const url = `${baseUrl}/internal/render-jobs/${encodeURIComponent(args.jobId)}/file?pdfKey=${encodeURIComponent(args.pdfKey)}`;
  logWorkerClient('[DBG_RENDERER_WORKER_REQUEST]', context, {
    operation: 'pdf_upload',
    requestId: args.requestId,
    url,
    timeoutMs,
    pdfBytes: args.pdfBytes.length,
  });
  const response = await fetchWorkerInternal({
    url,
    method: 'PUT',
    headers: {
      'content-type': 'application/pdf',
      'x-renderer-internal-token': token,
      'x-renderer-request-id': args.requestId,
      'x-renderer-job-id': args.jobId,
      'x-renderer-version': args.rendererVersion,
      'x-pdf-key': args.pdfKey,
    },
    body: Buffer.from(args.pdfBytes),
    timeoutMs,
    requestId: args.requestId,
    operation: 'pdf_upload',
    context,
  });
  const bodyText = await response.text().catch(() => '');
  if (!response.ok) {
    traceNon2xx({
      operation: 'pdf_upload',
      requestId: args.requestId,
      jobId: args.jobId,
      url,
      status: response.status,
      statusText: response.statusText,
      responseText: bodyText,
    });
  }
  logWorkerClient('[DBG_RENDERER_WORKER_RESPONSE]', context, {
    operation: 'pdf_upload',
    requestId: args.requestId,
    url,
    status: response.status,
    responseText: bodyText.slice(0, 200),
  });
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error(`UNAUTHORIZED_RENDERER_CALL: ${bodyText.slice(0, 200)}`);
    }
    throw new Error(`UPLOAD_FAILED: ${response.status} ${bodyText.slice(0, 200)}`);
  }
};

export const fetchRenderJobPayload = async (args: {
  jobId: string;
  templateId?: string;
  tenantId?: string;
  rendererVersion: string;
  requestId: string;
}): Promise<StoredRenderJobPayload> => {
  const { baseUrl, token, timeoutMs } = getWorkerConfig();
  const context: WorkerClientContext = {
    jobId: args.jobId,
    templateId: args.templateId ?? 'unknown',
    tenantId: args.tenantId ?? 'unknown',
    rendererVersion: args.rendererVersion,
  };
  const url = `${baseUrl}/internal/render-jobs/${encodeURIComponent(args.jobId)}/payload`;
  logWorkerClient('[DBG_RENDERER_WORKER_REQUEST]', context, {
    operation: 'payload_fetch',
    requestId: args.requestId,
    url,
    timeoutMs,
  });
  const response = await fetchWorkerInternal({
    url,
    method: 'GET',
    headers: {
      'x-renderer-internal-token': token,
      'x-renderer-request-id': args.requestId,
      'x-renderer-job-id': args.jobId,
    },
    timeoutMs,
    requestId: args.requestId,
    operation: 'payload_fetch',
    context,
  });
  const bodyText = await response.text().catch(() => '');
  if (!response.ok) {
    traceNon2xx({
      operation: 'payload_fetch',
      requestId: args.requestId,
      jobId: args.jobId,
      url,
      status: response.status,
      statusText: response.statusText,
      responseText: bodyText,
    });
  }
  logWorkerClient('[DBG_RENDERER_WORKER_RESPONSE]', context, {
    operation: 'payload_fetch',
    requestId: args.requestId,
    url,
    status: response.status,
    responseText: bodyText.slice(0, 200),
  });
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error(`UNAUTHORIZED_RENDERER_CALL: ${bodyText.slice(0, 200)}`);
    }
    if (response.status === 404) {
      throw new Error(`JOB_NOT_FOUND: ${bodyText.slice(0, 200)}`);
    }
    throw new Error(`RENDERER_HTTP_FAILED: ${response.status} ${bodyText.slice(0, 200)}`);
  }
  return JSON.parse(bodyText) as StoredRenderJobPayload;
};

export const transitionRenderJob = async (args: {
  jobId: string;
  templateId: string;
  tenantId: string;
  rendererVersion: string;
  requestId: string;
  transition: RendererJobTransitionRequest;
}) => {
  const { baseUrl, token, timeoutMs } = getWorkerConfig();
  const context: WorkerClientContext = {
    jobId: args.jobId,
    templateId: args.templateId,
    tenantId: args.tenantId,
    rendererVersion: args.rendererVersion,
  };
  const url = `${baseUrl}/internal/render-jobs/${encodeURIComponent(args.jobId)}/transition`;
  logWorkerClient('[DBG_RENDERER_WORKER_REQUEST]', context, {
    operation: 'job_transition',
    requestId: args.requestId,
    url,
    timeoutMs,
    status: args.transition.status,
    executionName: args.transition.executionName ?? null,
  });
  const response = await fetchWorkerInternal({
    url,
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-renderer-internal-token': token,
      'x-renderer-request-id': args.requestId,
      'x-renderer-job-id': args.jobId,
    },
    body: JSON.stringify(args.transition),
    timeoutMs,
    requestId: args.requestId,
    operation: 'job_transition',
    context,
  });
  const bodyText = await response.text().catch(() => '');
  if (!response.ok) {
    traceNon2xx({
      operation: 'job_transition',
      requestId: args.requestId,
      jobId: args.jobId,
      url,
      status: response.status,
      statusText: response.statusText,
      responseText: bodyText,
    });
  }
  logWorkerClient('[DBG_RENDERER_WORKER_RESPONSE]', context, {
    operation: 'job_transition',
    requestId: args.requestId,
    url,
    status: response.status,
    responseText: bodyText.slice(0, 200),
  });
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error(`UNAUTHORIZED_RENDERER_CALL: ${bodyText.slice(0, 200)}`);
    }
    if (response.status === 404) {
      throw new Error(`JOB_NOT_FOUND: ${bodyText.slice(0, 200)}`);
    }
    throw new Error(`RENDERER_HTTP_FAILED: ${response.status} ${bodyText.slice(0, 200)}`);
  }
  return bodyText ? (JSON.parse(bodyText) as Record<string, unknown>) : null;
};

export const updateRenderJobResult = async (args: {
  jobId: string;
  templateId: string;
  tenantId: string;
  rendererVersion: string;
  requestId: string;
  result: RendererJobResultRequest;
}) => {
  const { baseUrl, token, timeoutMs } = getWorkerConfig();
  const context: WorkerClientContext = {
    jobId: args.jobId,
    templateId: args.templateId,
    tenantId: args.tenantId,
    rendererVersion: args.rendererVersion,
    pdfKey: args.result.status === 'done' ? args.result.pdfKey : null,
  };
  const url = `${baseUrl}/internal/render-jobs/${encodeURIComponent(args.jobId)}/result`;
  logWorkerClient('[DBG_RENDERER_WORKER_REQUEST]', context, {
    operation: 'result_update',
    requestId: args.requestId,
    url,
    timeoutMs,
    status: args.result.status,
    errorCode: args.result.status === 'failed' ? args.result.errorCode : null,
  });
  const response = await fetchWorkerInternal({
    url,
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-renderer-internal-token': token,
      'x-renderer-request-id': args.requestId,
      'x-renderer-job-id': args.jobId,
    },
    body: JSON.stringify(args.result),
    timeoutMs,
    requestId: args.requestId,
    operation: 'result_update',
    context,
  });
  const bodyText = await response.text().catch(() => '');
  if (!response.ok) {
    traceNon2xx({
      operation: 'result_update',
      requestId: args.requestId,
      jobId: args.jobId,
      url,
      status: response.status,
      statusText: response.statusText,
      responseText: bodyText,
    });
  }
  logWorkerClient('[DBG_RENDERER_WORKER_RESPONSE]', context, {
    operation: 'result_update',
    requestId: args.requestId,
    url,
    status: response.status,
    responseText: bodyText.slice(0, 200),
  });
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error(`UNAUTHORIZED_RENDERER_CALL: ${bodyText.slice(0, 200)}`);
    }
    throw new Error(`RENDERER_HTTP_FAILED: ${response.status} ${bodyText.slice(0, 200)}`);
  }
};
