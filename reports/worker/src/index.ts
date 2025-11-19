import { renderTemplateToPdf } from './pdf/renderTemplate.ts';
import { loadFontFromKv } from './fonts/fontLoader.ts';
import {
  SAMPLE_DATA,
  SAMPLE_TEMPLATE,
  type TemplateDataRecord,
  type TemplateDefinition,
} from '../../shared/template.ts';

interface Env {
  API_KEY?: string;
  TEMPLATE_KV?: KVNamespace;
}

type PreviewRequestBody = {
  templateId: string;
  template?: TemplateDefinition;
  data?: TemplateDataRecord;
};

type RenderRequestBody = {
  templateId: string;
  kintone: KintoneRequestOptions;
};

type KintoneRequestOptions = {
  baseUrl: string;
  appId: string;
  recordId: string;
  apiToken: string;
};

type KintoneRecordResponse = {
  record: KintoneRecord;
};

type KintoneRecord = Record<string, KintoneField>;

type KintoneField = {
  type?: string;
  value: unknown;
};

const inMemoryTemplates: Record<string, TemplateDefinition> = {
  [SAMPLE_TEMPLATE.id]: SAMPLE_TEMPLATE,
};

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type,x-api-key',
  'Access-Control-Allow-Methods': 'OPTIONS, GET, POST, PUT, DELETE',
};

const pdfResponse = (bytes: Uint8Array, filename: string) => {
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new Response(buffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${filename}.pdf"`,
      ...corsHeaders,
    },
  });
};

const unauthorized = () => jsonResponse({ error: 'Unauthorized' }, { status: 401 });
const notFound = () => jsonResponse({ error: 'Not Found' }, { status: 404 });
const badRequest = (message: string) => jsonResponse({ error: message }, { status: 400 });
const storageUnavailable = () => jsonResponse({ error: 'Template storage is not configured' }, { status: 503 });
const fontUnavailable = () => jsonResponse({ error: 'Font asset is not available' }, { status: 500 });

const authorize = (request: Request, env: Env) => {
  if (!env.API_KEY) {
    return null;
  }

  const provided = request.headers.get('x-api-key');
  if (provided !== env.API_KEY) {
    return unauthorized();
  }

  return null;
};


const handleRenderPreview = async (request: Request, env: Env) => {
  let body: PreviewRequestBody;
  try {
    body = (await request.json()) as PreviewRequestBody;
  } catch (error) {
    return badRequest('Invalid JSON body');
  }

  const templateId = body.template?.id ?? body.templateId;
  if (!templateId) {
    return badRequest('templateId is required');
  }

  const template = body.template ?? (await resolveTemplate(templateId, env));
  if (!template) {
    return notFound();
  }

  const data = body.data ?? SAMPLE_DATA;
  let fontBytes: Uint8Array;
  try {
    fontBytes = await loadFontFromKv(env.TEMPLATE_KV);
  } catch (error) {
    console.error('Failed to load font', error);
    return fontUnavailable();
  }
  const pdfBytes = await renderTemplateToPdf(template, data, fontBytes);
  return pdfResponse(pdfBytes, templateId);
};

const handleRender = async (request: Request, env: Env) => {
  let body: RenderRequestBody;
  try {
    body = (await request.json()) as RenderRequestBody;
  } catch (error) {
    return badRequest('Invalid JSON body');
  }

  if (!body.templateId) {
    return badRequest('templateId is required');
  }

  if (!body.kintone) {
    return badRequest('kintone configuration is required');
  }

  const template = await resolveTemplate(body.templateId, env);
  if (!template) {
    return notFound();
  }

  let fontBytes: Uint8Array;
  try {
    fontBytes = await loadFontFromKv(env.TEMPLATE_KV);
  } catch (error) {
    console.error('Failed to load font', error);
    return fontUnavailable();
  }

  try {
    const record = await fetchKintoneRecord(body.kintone);
    const pdfBytes = await renderTemplateToPdf(template, record, fontBytes);
    return pdfResponse(pdfBytes, template.id);
  } catch (error) {
    console.error('Render failed', error);
    return jsonResponse({ error: 'Failed to render PDF' }, { status: 502 });
  }
};

const resolveTemplate = async (
  templateId: string,
  env: Env,
): Promise<TemplateDefinition | null> => {
  // サンプルテンプレ指定ならコード内のもの
  if (!templateId || templateId === SAMPLE_TEMPLATE.id) {
    return SAMPLE_TEMPLATE;
  }

  const kv = ensureKv(env);
  if (!kv) return null;

  const raw = await kv.get(`${TEMPLATE_KEY_PREFIX}${templateId}`);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as TemplateDefinition;
  } catch (e) {
    console.error("Failed to parse template for render", e);
    return null;
  }
};


const fetchKintoneRecord = async (options: KintoneRequestOptions): Promise<TemplateDataRecord> => {
  const endpoint = new URL('/k/v1/record.json', options.baseUrl);
  endpoint.searchParams.set('app', options.appId);
  endpoint.searchParams.set('id', options.recordId);

  const response = await fetch(endpoint, {
    method: 'GET',
    headers: {
      'X-Cybozu-API-Token': options.apiToken,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`kintone API error: ${response.status} ${message}`);
  }

  const payload = (await response.json()) as KintoneRecordResponse;
  return normalizeKintoneRecord(payload.record);
};

const normalizeKintoneRecord = (record: KintoneRecord): TemplateDataRecord => {
  const normalized: TemplateDataRecord = {};
  for (const [fieldCode, descriptor] of Object.entries(record)) {
    normalized[fieldCode] = normalizeFieldValue(descriptor.value);
  }
  return normalized;
};

const normalizeFieldValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry) => {
      if (entry && typeof entry === 'object' && 'value' in (entry as Record<string, unknown>)) {
        const row = entry as { value: KintoneRecord };
        return normalizeKintoneRecord(row.value);
      }
      return entry;
    });
  }

  return value;
};

const generateTemplateId = () =>
  (typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? `tpl_${crypto.randomUUID()}`
    : `tpl_${Date.now()}`);


// 一覧取得 GET /templates
export const handleListTemplates = async (env: Env): Promise<Response> => {
  const kv = ensureKv(env);
  const list = await kv.list();

  if (!list.keys.length) {
    // まだ1件も保存されてなければサンプルだけ返す
    return jsonResponse({ templates: SAMPLE_TEMPLATES });
  }

  const templates: TemplateDefinition[] = [];
  for (const key of list.keys) {
    if (!key.name.startsWith("template:")) continue;
    const raw = await kv.get(key.name);
    if (!raw) continue;
    try {
      const tpl = JSON.parse(raw) as TemplateDefinition;
      templates.push(tpl);
    } catch (e) {
      console.error("Failed to parse template", key.name, e);
    }
  }
  if (!templates.length) {
    return jsonResponse({ templates: SAMPLE_TEMPLATES });
  }

  return jsonResponse({ templates });
};

// 新規作成 POST /templates
export const handleCreateTemplate = async (
  request: Request,
  env: Env,
): Promise<Response> => {
  const kv = ensureKv(env);
  const body = (await request.json()) as TemplateDefinition;

  const id = body.id ?? crypto.randomUUID();
  const toSave: TemplateDefinition = {
    ...body,
    id,
  };

  await kv.put(
    `${TEMPLATE_KEY_PREFIX}${id}`,
    JSON.stringify(toSave),
  );

  return jsonResponse(toSave, { status: 201 });
};

// 単体取得 GET /templates/:id
export const handleGetTemplate = async (
  templateId: string,
  env: Env,
): Promise<Response> => {
  const kv = ensureKv(env);

  // サンプルIDならそのまま返す
  const sample = SAMPLE_TEMPLATES.find((t) => t.id === templateId);
  if (sample) {
    return jsonResponse(sample);
  }

  const raw = await kv.get(`${TEMPLATE_KEY_PREFIX}${templateId}`);
  if (!raw) {
    return jsonResponse({ error: "Not Found" }, { status: 404 });
  }

  const template = JSON.parse(raw) as TemplateDefinition;
  return jsonResponse(template);
};

// 更新 PUT /templates/:id
export const handleUpdateTemplate = async (
  request: Request,
  env: Env,
  templateId: string,
): Promise<Response> => {
  const kv = ensureKv(env); // ここは既存のヘルパーをそのまま使う

  // フロントから来た JSON をそのまま受け取る
  const payload = (await request.json()) as TemplateDefinition;

  // id は URL の templateId を優先して固定
  const toSave: TemplateDefinition = {
    ...payload,
    id: templateId,
  };

  await kv.put(
    `${TEMPLATE_KEY_PREFIX}${templateId}`,
    JSON.stringify(toSave),
  );

  // ★ここでは絶対 404 を返さない
  return jsonResponse(toSave, { status: 200 });
};



// 削除 DELETE /templates/:id
export const handleDeleteTemplate = async (
  env: Env,
  templateId: string,
): Promise<Response> => {
  const kv = ensureKv(env);

  await kv.delete(`${TEMPLATE_KEY_PREFIX}${templateId}`);

  // 存在してなくても delete は通るので 204 で OK
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
};


// 例：既に TemplateDefinition がどこかで定義されてる想定
// もし name だけしか使っていなければ最低限これだけあれば動きます。
// interface TemplateDefinition {
//   id: string;
//   name: string;
//   // 他にあればそのままでOK
// }

const SAMPLE_TEMPLATES: TemplateDefinition[] = [
  {
    id: "sample-1",
    name: "サンプルテンプレート1",
    pageSize: "A4",          // TemplateDefinition の型に合わせて
    orientation: "portrait", // ここも型に合わせて
    elements: [],            // とりあえず空配列でOK
  },
  {
    id: "sample-2",
    name: "サンプルテンプレート2",
    pageSize: "A4",
    orientation: "portrait",
    elements: [],
  },
];

const TEMPLATE_KEY_PREFIX = "template:";

// KV 取得ヘルパ
const ensureKv = (env: Env): KVNamespace => {
  const kv = (env as any).TEMPLATE_KV as KVNamespace | undefined;
  if (!kv) {
    throw new Error("TEMPLATE_KV is not bound");
  }
  return kv;
};

// jsonResponse の型が Record<string, unknown> だと怒られるので、だいたいこんな感じにしておくと楽です
const jsonResponse = (body: unknown, init?: ResponseInit): Response =>
  new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders,
      ...init?.headers,
    },
  });



export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const authError = authorize(request, env);
    if (authError) {
      return authError;
    }

    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/ping') {
      return jsonResponse({ ok: true, message: 'pong-from-worker' });
    }

    if (request.method === 'POST' && url.pathname === '/render-preview') {
      return handleRenderPreview(request, env);
    }

    if (request.method === 'POST' && url.pathname === '/render') {
      return handleRender(request, env);
    }

    if (request.method === 'GET' && url.pathname === '/templates') {
      return handleListTemplates(env);
    }

    if (request.method === 'POST' && url.pathname === '/templates') {
      return handleCreateTemplate(request, env);
    }

    const templateMatch = url.pathname.match(/^\/templates\/(.+)$/);
    if (templateMatch) {
      const templateId = decodeURIComponent(templateMatch[1]);
      if (request.method === 'GET') {
        return handleGetTemplate(templateId, env);
      }
      if (request.method === 'PUT') {
        return handleUpdateTemplate(request, env, templateId);
      }
      if (request.method === 'DELETE') {
        return handleDeleteTemplate(env, templateId);
      }
    }

    return notFound();
  },
};
