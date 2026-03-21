import type { TemplateDataRecord, TemplateDefinition } from './template.js';

export type RenderJobStatus = 'queued' | 'running' | 'done' | 'failed';

export type RendererErrorCode =
  | 'INVALID_PAYLOAD'
  | 'UNAUTHORIZED_RENDERER_CALL'
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
  renderMs: number;
  rendererVersion: string;
};

export type RendererRenderFailure = {
  ok: false;
  jobId: string;
  errorCode: RendererErrorCode;
  errorMessage: string;
  rendererVersion?: string;
};

export type RendererRenderResponse = RendererRenderSuccess | RendererRenderFailure;
