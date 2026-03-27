import type { TemplateDataRecord, TemplateDefinition } from './template.js';

export type RenderJobStatus =
  | 'queued'
  | 'leased'
  | 'dispatched'
  | 'processing'
  | 'running'
  | 'done'
  | 'failed';

export type RendererErrorCode =
  | 'INVALID_PAYLOAD'
  | 'UNAUTHORIZED_RENDERER_CALL'
  | 'STALE_JOB'
  | 'TABLE_RENDER_STUCK'
  | 'TEMPLATE_LOAD_FAILED'
  | 'BACKGROUND_FETCH_FAILED'
  | 'FONT_LOAD_FAILED'
  | 'RENDER_FAILED'
  | 'UPLOAD_FAILED'
  | 'RENDERER_HTTP_FAILED'
  | 'RENDERER_TIMEOUT'
  | 'FILE_NOT_READY'
  | 'JOB_NOT_FOUND';

export type RendererInlineAsset = {
  base64: string;
  contentType: string;
  objectKey?: string | null;
};

export type RendererRenderOptions = {
  previewMode: 'record' | 'fieldCode';
  renderMode: 'layout' | 'preview' | 'final';
  useJpFont: boolean;
  superFastMode: boolean;
  skipLogo: boolean;
  skipStaticLabels: boolean;
  useBaseBackgroundDoc: boolean;
};

export type RendererRenderRequest = {
  jobId: string;
  template: TemplateDefinition;
  data?: TemplateDataRecord;
  assets: {
    backgroundKey?: string | null;
    backgroundIncludesCompanyLogo?: boolean;
    tenantLogo?: RendererInlineAsset | null;
    pdfKey?: string | null;
  };
  meta: {
    tenantId: string;
    templateId: string;
    templateRevision: number | null;
    rendererVersion: string;
    requestId?: string;
    jpFontFamily?: string;
  };
  options: RendererRenderOptions;
};

export type RendererRenderSuccess = {
  ok: true;
  jobId: string;
  pdfKey: string;
  pdfBytes: number;
  backgroundBytes?: number | null;
  renderMs: number;
  rendererVersion: string;
};

export type RendererRenderAccepted = {
  ok: true;
  accepted: true;
  jobId: string;
  status: 'processing';
  rendererVersion: string;
};

export type RendererRenderFailure = {
  ok: false;
  jobId: string;
  errorCode: RendererErrorCode;
  errorMessage: string;
  rendererVersion?: string;
};

export type RendererRenderResponse =
  | RendererRenderAccepted
  | RendererRenderSuccess
  | RendererRenderFailure;

export type RenderJobPayloadRecord = {
  jobId: string;
  status: RenderJobStatus;
  templateId: string;
  tenantId: string;
  rendererVersion?: string | null;
  executionName?: string | null;
  attempt?: number | null;
  executionDispatchedAt?: string | null;
  renderStartedAt?: string | null;
  renderFinishedAt?: string | null;
  failureStage?: string | null;
};

export type StoredRenderJobPayload = {
  jobId: string;
  renderRequest: RendererRenderRequest;
  record: RenderJobPayloadRecord;
};

export type RendererJobTransitionRequest = {
  status: 'running';
  rendererVersion?: string | null;
  executionName?: string | null;
  renderStartedAt?: string | null;
  attempt?: number | null;
};

export type RendererJobResultRequest =
  | {
      status: 'done';
      pdfKey: string;
      pdfBytes: number;
      backgroundBytes?: number | null;
      renderMs: number;
      rendererVersion: string;
      executionName?: string | null;
      renderStartedAt?: string | null;
      renderFinishedAt?: string | null;
    }
  | {
      status: 'failed';
      errorCode: RendererErrorCode;
      errorMessage: string;
      backgroundBytes?: number | null;
      renderMs?: number | null;
      rendererVersion: string;
      executionName?: string | null;
      renderStartedAt?: string | null;
      renderFinishedAt?: string | null;
      failureStage?: string | null;
      errorSummary?: string | null;
      errorDetails?: string | null;
    };
