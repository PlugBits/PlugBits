const DEFAULT_WORKER_TIMEOUT_MS = 30_000;

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
  const token = process.env.WORKER_INTERNAL_TOKEN?.trim();
  const parsedTimeout = Number(process.env.WORKER_INTERNAL_TIMEOUT_MS ?? '');
  if (!baseUrl) {
    throw new Error('RENDERER_HTTP_FAILED: WORKER_INTERNAL_BASE_URL is not configured');
  }
  if (!token) {
    throw new Error('UNAUTHORIZED_RENDERER_CALL: WORKER_INTERNAL_TOKEN is not configured');
  }
  return {
    baseUrl: baseUrl.replace(/\/$/, ''),
    token,
    timeoutMs:
      Number.isFinite(parsedTimeout) && parsedTimeout > 0
        ? parsedTimeout
        : DEFAULT_WORKER_TIMEOUT_MS,
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
  console.info(tag, {
    jobId: context.jobId,
    templateId: context.templateId,
    tenantId: context.tenantId,
    rendererVersion: context.rendererVersion,
    backgroundKey: context.backgroundKey ?? null,
    pdfKey: context.pdfKey ?? null,
    ...extra,
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
  const response = await fetchWithTimeout(
    url,
    {
      method: 'GET',
      headers: {
        'x-renderer-internal-token': token,
        'x-renderer-request-id': requestId,
      },
    },
    timeoutMs,
  );
  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
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
  const response = await fetchWithTimeout(
    url,
    {
      method: 'PUT',
      headers: {
        'content-type': 'application/pdf',
        'x-renderer-internal-token': token,
        'x-renderer-request-id': args.requestId,
        'x-renderer-version': args.rendererVersion,
        'x-pdf-key': args.pdfKey,
      },
      body: Buffer.from(args.pdfBytes),
    },
    timeoutMs,
  );
  const bodyText = await response.text().catch(() => '');
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
