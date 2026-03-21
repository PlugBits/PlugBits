import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { renderTemplateToPdf } from '../../worker/src/pdf/renderTemplate.js';
import type {
  RendererErrorCode,
  RendererInlineAsset,
  RendererRenderRequest,
  RendererRenderResponse,
} from '../../shared/rendering.js';
import { getFonts } from './fontStore.js';
import { fetchAssetBytes, uploadRenderedPdf } from './workerClient.js';

const PORT = Number(process.env.PORT ?? '8080');
const INTERNAL_TOKEN = process.env.RENDERER_INTERNAL_TOKEN?.trim() ?? '';
const RENDERER_VERSION = process.env.RENDERER_VERSION?.trim() || 'v1';
const MAX_BODY_BYTES = 10 * 1024 * 1024;

const json = (res: ServerResponse, status: number, payload: RendererRenderResponse | Record<string, unknown>) => {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(payload));
};

const readJsonBody = async (req: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > MAX_BODY_BYTES) {
      throw new Error('INVALID_PAYLOAD: request body too large');
    }
    chunks.push(buf);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
};

const decodeInlineAsset = (
  asset?: RendererInlineAsset | null,
): { bytes: Uint8Array; contentType: string; objectKey: string } | null => {
  if (!asset?.base64) return null;
  const bytes = Buffer.from(asset.base64, 'base64');
  return {
    bytes: new Uint8Array(bytes),
    contentType: asset.contentType,
    objectKey: asset.objectKey ?? '',
  };
};

const normalizeRendererError = (error: unknown): { errorCode: RendererErrorCode; errorMessage: string } => {
  const message = error instanceof Error ? error.message : String(error);
  if (/UNAUTHORIZED_RENDERER_CALL/i.test(message)) {
    return { errorCode: 'UNAUTHORIZED_RENDERER_CALL', errorMessage: 'Unauthorized renderer call' };
  }
  if (/BACKGROUND_FETCH_FAILED/i.test(message) || /background/i.test(message)) {
    return { errorCode: 'BACKGROUND_FETCH_FAILED', errorMessage: 'Background fetch failed' };
  }
  if (/FONT_LOAD_FAILED/i.test(message) || /ENOENT/i.test(message) || /font/i.test(message)) {
    return { errorCode: 'FONT_LOAD_FAILED', errorMessage: 'Font load failed' };
  }
  if (/UPLOAD_FAILED/i.test(message) || /upload/i.test(message)) {
    return { errorCode: 'UPLOAD_FAILED', errorMessage: 'PDF upload failed' };
  }
  if (/RENDERER_TIMEOUT/i.test(message) || /timeout/i.test(message)) {
    return { errorCode: 'RENDERER_TIMEOUT', errorMessage: 'Renderer request timed out' };
  }
  if (/INVALID_PAYLOAD/i.test(message) || /request body too large/i.test(message)) {
    return { errorCode: 'INVALID_PAYLOAD', errorMessage: 'Invalid render payload' };
  }
  if (/TEMPLATE_LOAD_FAILED/i.test(message) || /template/i.test(message)) {
    return { errorCode: 'TEMPLATE_LOAD_FAILED', errorMessage: 'Template load failed' };
  }
  if (/RENDERER_HTTP_FAILED/i.test(message)) {
    return { errorCode: 'RENDERER_HTTP_FAILED', errorMessage: 'Worker internal HTTP failed' };
  }
  if (/JOB_NOT_FOUND/i.test(message)) {
    return { errorCode: 'JOB_NOT_FOUND', errorMessage: 'Render job not found' };
  }
  if (/FILE_NOT_READY/i.test(message)) {
    return { errorCode: 'FILE_NOT_READY', errorMessage: 'Render output file is not ready' };
  }
  return { errorCode: 'RENDER_FAILED', errorMessage: message };
};

const isRenderRequest = (value: unknown): value is RendererRenderRequest => {
  if (!value || typeof value !== 'object') return false;
  const payload = value as Partial<RendererRenderRequest>;
  return Boolean(
    payload.jobId &&
      payload.template &&
      payload.meta?.tenantId &&
      payload.meta?.templateId &&
      payload.options,
  );
};

const server = createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/healthz') {
    res.statusCode = 200;
    res.end('ok');
    return;
  }

  if (req.method !== 'POST' || req.url !== '/internal/render') {
    json(res, 404, { ok: false, error: 'NOT_FOUND' });
    return;
  }

  const token = req.headers['x-renderer-internal-token'];
  if (!INTERNAL_TOKEN || token !== INTERNAL_TOKEN) {
    json(res, 401, {
      ok: false,
      jobId: '',
      errorCode: 'UNAUTHORIZED_RENDERER_CALL',
      errorMessage: 'Unauthorized renderer call',
      rendererVersion: RENDERER_VERSION,
    });
    return;
  }

  let payload: RendererRenderRequest;
  try {
    const parsed = await readJsonBody(req);
    if (!isRenderRequest(parsed)) {
      throw new Error('INVALID_PAYLOAD: missing renderer payload fields');
    }
    payload = parsed;
  } catch (error) {
    const normalized = normalizeRendererError(error);
    json(res, 400, {
      ok: false,
      jobId: '',
      errorCode: normalized.errorCode,
      errorMessage: normalized.errorMessage,
      rendererVersion: RENDERER_VERSION,
    });
    return;
  }

  const requestId = payload.meta.requestId ?? payload.jobId;
  const logContext = {
    jobId: payload.jobId,
    templateId: payload.meta.templateId,
    tenantId: payload.meta.tenantId,
    rendererVersion: RENDERER_VERSION,
    backgroundKey: payload.assets.backgroundKey ?? null,
  };

  console.info('[DBG_RENDERER_REQUEST]', {
    ...logContext,
    backgroundKey: payload.assets.backgroundKey ?? null,
    templateRevision: payload.meta.templateRevision,
    backgroundBytes: null,
    pdfBytes: null,
    renderMs: null,
    errorCode: null,
  });

  const startedAt = Date.now();
  try {
    const backgroundLoadStartedAt = Date.now();
    console.info('[DBG_RENDERER_BACKGROUND_FETCH_START]', {
      ...logContext,
      backgroundBytes: null,
      pdfBytes: null,
      renderMs: null,
      errorCode: null,
    });
    const background = payload.assets.backgroundKey
      ? await fetchAssetBytes(payload.assets.backgroundKey, requestId, {
          jobId: payload.jobId,
          templateId: payload.meta.templateId,
          tenantId: payload.meta.tenantId,
          rendererVersion: RENDERER_VERSION,
          backgroundKey: payload.assets.backgroundKey ?? null,
        })
      : null;
    console.info('[DBG_RENDERER_BACKGROUND_FETCH_DONE]', {
      ...logContext,
      backgroundBytes: background?.bytes.length ?? 0,
      pdfBytes: null,
      renderMs: null,
      loadMs: Date.now() - backgroundLoadStartedAt,
      errorCode: null,
    });

    const fontLoadStartedAt = Date.now();
    console.info('[DBG_RENDERER_FONT_LOAD_START]', {
      ...logContext,
      backgroundBytes: background?.bytes.length ?? 0,
      pdfBytes: null,
      renderMs: null,
      errorCode: null,
    });
    const fonts = await getFonts(payload.meta.jpFontFamily);
    console.info('[DBG_RENDERER_FONT_LOAD_DONE]', {
      ...logContext,
      backgroundBytes: background?.bytes.length ?? 0,
      pdfBytes: null,
      renderMs: null,
      requestedFamily: fonts.requestedFamily,
      resolvedFamily: fonts.resolvedFamily,
      fellBackToNoto: fonts.fellBackToNoto,
      latinBytes: fonts.latin.length,
      jpBytes: fonts.jp.length,
      loadMs: Date.now() - fontLoadStartedAt,
      jpSubset: false,
      latinSubset: true,
      errorCode: null,
    });

    const tenantLogo = decodeInlineAsset(payload.assets.tenantLogo);
    console.info('[DBG_RENDERER_RENDER_START]', {
      ...logContext,
      backgroundBytes: background?.bytes.length ?? 0,
      pdfBytes: null,
      renderMs: null,
      hasTenantLogo: Boolean(tenantLogo),
      errorCode: null,
    });
    const rendered = await renderTemplateToPdf(
      payload.template,
      payload.data,
      {
        jp: payload.options.useJpFont ? fonts.jp : null,
        latin: fonts.latin,
      },
      {
        debug: false,
        previewMode: payload.options.previewMode,
        renderMode: payload.options.renderMode,
        useJpFont: payload.options.useJpFont,
        superFastMode: payload.options.superFastMode,
        layer: background ? 'dynamic' : 'full',
        backgroundPdfBytes: background?.bytes ?? undefined,
        tenantLogo: tenantLogo ?? undefined,
        skipLogo: payload.options.skipLogo,
        skipStaticLabels: payload.options.skipStaticLabels,
        useBaseBackgroundDoc: payload.options.useBaseBackgroundDoc,
        requestId,
      },
    );
    const pdfBytes = rendered.bytes;
    const renderMs = Date.now() - startedAt;
    console.info('[DBG_RENDERER_RENDER_DONE]', {
      ...logContext,
      renderMs,
      pdfBytes: pdfBytes.length,
      backgroundBytes: background?.bytes.length ?? 0,
      errorCode: null,
    });

    const pdfKey = payload.assets.pdfKey ?? `renders/${payload.jobId}/output.pdf`;
    console.info('[DBG_RENDERER_UPLOAD_START]', {
      ...logContext,
      backgroundBytes: background?.bytes.length ?? 0,
      pdfKey,
      pdfBytes: pdfBytes.length,
      renderMs,
      errorCode: null,
    });
    await uploadRenderedPdf({
      jobId: payload.jobId,
      templateId: payload.meta.templateId,
      tenantId: payload.meta.tenantId,
      pdfKey,
      pdfBytes,
      rendererVersion: RENDERER_VERSION,
      requestId,
    });
    console.info('[DBG_RENDERER_UPLOAD_DONE]', {
      ...logContext,
      backgroundBytes: background?.bytes.length ?? 0,
      pdfKey,
      pdfBytes: pdfBytes.length,
      renderMs,
      errorCode: null,
    });

    json(res, 200, {
      ok: true,
      jobId: payload.jobId,
      pdfKey,
      pdfBytes: pdfBytes.length,
      renderMs,
      rendererVersion: RENDERER_VERSION,
    });
  } catch (error) {
    const normalized = normalizeRendererError(error);
    console.error('[DBG_RENDERER_ERROR]', {
      ...logContext,
      errorCode: normalized.errorCode,
      errorMessage: normalized.errorMessage,
      backgroundBytes: null,
      pdfBytes: null,
      renderMs: Date.now() - startedAt,
    });
    json(
      res,
      normalized.errorCode === 'INVALID_PAYLOAD'
        ? 400
        : normalized.errorCode === 'UNAUTHORIZED_RENDERER_CALL'
          ? 401
          : 500,
      {
      ok: false,
      jobId: payload.jobId,
      errorCode: normalized.errorCode,
      errorMessage: normalized.errorMessage,
      rendererVersion: RENDERER_VERSION,
      },
    );
  }
});

server.listen(PORT, () => {
  console.info('[DBG_RENDERER_LISTEN]', {
    port: PORT,
    rendererVersion: RENDERER_VERSION,
  });
});
