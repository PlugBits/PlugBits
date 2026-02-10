// worker/src/index.ts
import type {
  TemplateDefinition,
  TemplateDataRecord,
  TemplateMeta,
  TableElement,
} from "../../shared/template.js";
import { TEMPLATE_SCHEMA_VERSION } from "../../shared/template.js";

import { renderLabelCalibrationPdf, renderTemplateToPdf } from "./pdf/renderTemplate.ts";
import { getFonts } from "./fonts/fontLoader.js";
import { getFixtureData } from "./fixtures/templateData.js";
import { migrateTemplate, validateTemplate } from "./template/migrate.js";
import { applyListV1MappingToTemplate } from "./template/listV1Mapping.ts";
import { applyCardsV1MappingToTemplate } from "./template/cardsV1Mapping.ts";
import {
  applySlotDataOverrides,
  applySlotLayoutOverrides,
  buildTenantKey,
  buildUserTemplateKey,
  deleteTemplateMeta,
  findTemplateMeta,
  listTemplateMetas,
  putTemplateMeta,
  TEMPLATE_STATUSES,
  type UserTemplatePayload,
} from "./template/userTemplates.ts";
import {
  issueEditorToken,
  getTenantRecord,
  registerTenant,
  upsertTenantApiToken,
  verifyEditorToken,
} from "./auth/tenantAuth.ts";
import { canonicalizeAppId, canonicalizeKintoneBaseUrl } from "./utils/canonicalize.ts";


// Wrangler の env 定義（あってもなくても動くよう optional にする）
export interface Env {
  FONT_SOURCE_URL?: string;
  LATIN_FONT_URL?: string; 
  ADMIN_API_KEY?: string;
  TEMPLATE_KV: KVNamespace;
  USER_TEMPLATES_KV: KVNamespace;
  SESSIONS_KV: KVNamespace;
}

// /render が受け取る JSON ボディ
type RenderRequestBody = {
  // 既存フロントエンド向け: テンプレート本体をそのまま送るパターン
  template?: TemplateDefinition;

  // kintone プラグイン向け: templateId だけ送るパターン
  templateId?: string;

  // テンプレートに流し込むデータ（TemplateDataRecord は shared/template.ts 側の型）
  data?: TemplateDataRecord;

  // 将来用: kintone に関するメタ情報など（今の実装では未使用）
  kintone?: unknown;

  // 編集UI向け: fieldCode可視化モード
  previewMode?: "record" | "fieldCode";
};

// CORS 設定
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key, x-kintone-api-token, X-Requested-With",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const truncateHeaderValue = (value: string, maxLength = 200) =>
  value.length > maxLength ? value.slice(0, maxLength) : value;

// フォント読み込み（今はデフォルト埋め込みフォントだけ）
async function loadFonts(env: Env): Promise<{ jp: Uint8Array; latin: Uint8Array }> {
  // 将来 FONT_SOURCE_URL から外部フォントを読む場合はここに処理を追加
  return getFonts(env);
}

const requireEditorToken = async (
  request: Request,
  env: Env,
): Promise<{ tenantId: string; record: { kintoneBaseUrl: string; appId: string; kintoneApiToken?: string } } | { error: Response }> => {
  const authHeader = request.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) {
    return {
      error: new Response("Missing Authorization", {
        status: 401,
        headers: CORS_HEADERS,
      }),
    };
  }

  const verified = await verifyEditorToken(env.USER_TEMPLATES_KV, token);
  if (!verified) {
    return {
      error: new Response("Unauthorized", {
        status: 401,
        headers: CORS_HEADERS,
      }),
    };
  }

  return verified;
};

const loadEditorSession = async (
  env: Env,
  token: string,
): Promise<{
  session: {
    kintoneBaseUrl: string;
    appId: string;
    expiresAt: number;
    kintoneApiToken?: string;
  };
} | { error: Response }> => {
  if (!env.SESSIONS_KV) {
    return {
      error: new Response("SESSIONS_KV is required", {
        status: 500,
        headers: CORS_HEADERS,
      }),
    };
  }
  if (!token) {
    return {
      error: new Response("Missing token", {
        status: 400,
        headers: CORS_HEADERS,
      }),
    };
  }

  const key = `editor_session:${token}`;
  const raw = await env.SESSIONS_KV.get(key);
  if (!raw) {
    return {
      error: new Response("Invalid session token", {
        status: 401,
        headers: CORS_HEADERS,
      }),
    };
  }

  let session: { kintoneBaseUrl?: string; appId?: string; expiresAt?: number; kintoneApiToken?: string };
  try {
    session = JSON.parse(raw) as {
      kintoneBaseUrl?: string;
      appId?: string;
      expiresAt?: number;
      kintoneApiToken?: string;
    };
  } catch {
    return {
      error: new Response("Invalid session payload", {
        status: 401,
        headers: CORS_HEADERS,
      }),
    };
  }

  const kintoneBaseUrl = session.kintoneBaseUrl ?? "";
  const appId = session.appId ? String(session.appId) : "";
  if (!kintoneBaseUrl || !appId) {
    return {
      error: new Response("Invalid session payload", {
        status: 401,
        headers: CORS_HEADERS,
      }),
    };
  }

  if (!session?.expiresAt || Date.now() > session.expiresAt) {
    return {
      error: new Response("Session expired", {
        status: 401,
        headers: CORS_HEADERS,
      }),
    };
  }

  return {
    session: {
      kintoneBaseUrl,
      appId,
      expiresAt: Number(session.expiresAt),
      kintoneApiToken: session.kintoneApiToken,
    },
  };
};

const getTenantContext = (
  url: URL,
): { baseUrl: string; appId: string; tenantKey: string } | { error: Response } => {
  const baseUrl = url.searchParams.get("kintoneBaseUrl");
  const appId = url.searchParams.get("appId");
  if (!baseUrl || !appId) {
    return {
      error: new Response("Missing kintoneBaseUrl or appId", {
        status: 400,
        headers: CORS_HEADERS,
      }),
    };
  }

  try {
    const normalizedBaseUrl = canonicalizeKintoneBaseUrl(baseUrl);
    const normalizedAppId = canonicalizeAppId(appId);
    if (!normalizedAppId) {
      return {
        error: new Response("Missing kintoneBaseUrl or appId", {
          status: 400,
          headers: CORS_HEADERS,
        }),
      };
    }
    const tenantKey = buildTenantKey(normalizedBaseUrl, normalizedAppId);
    return { baseUrl: normalizedBaseUrl, appId: normalizedAppId, tenantKey };
  } catch {
    return {
      error: new Response("Invalid kintoneBaseUrl", {
        status: 400,
        headers: CORS_HEADERS,
      }),
    };
  }
};

 // templateId から TemplateDefinition を引く関数
 
const TEMPLATE_IDS = new Set([
  "list_v1",
  "cards_v1",
  "cards_v2",
  "label_standard_v1",
  "label_compact_v1",
  "label_logistics_v1",
  "card_v1",
  "multiTable_v1",
]);
const SLOT_SCHEMA_LIST_V1 = {
  header: [
    { slotId: "doc_title", label: "タイトル", kind: "text" as const },
    { slotId: "to_name", label: "宛先名", kind: "text" as const, required: true },
    { slotId: "date_label", label: "日付ラベル", kind: "text" as const },
    { slotId: "issue_date", label: "日付", kind: "date" as const, required: true },
    { slotId: "doc_no", label: "文書番号", kind: "text" as const },
    { slotId: "logo", label: "ロゴ", kind: "image" as const },
  ],
  footer: [
    { slotId: "remarks", label: "備考", kind: "text" as const },
    { slotId: "total_label", label: "合計ラベル", kind: "text" as const },
    { slotId: "total", label: "合計", kind: "number" as const },
  ],
};
const SLOT_SCHEMA_LABEL_V1 = {
  header: [
    { slotId: "title", label: "タイトル", kind: "text" as const, required: true },
    { slotId: "code", label: "コード", kind: "text" as const, required: true },
    { slotId: "qty", label: "数量", kind: "number" as const, required: true },
    { slotId: "qr", label: "QR", kind: "text" as const, required: true },
    { slotId: "extra", label: "補足", kind: "text" as const },
  ],
  footer: [],
};
const TEMPLATE_CATALOG = [
  {
    templateId: "list_v1",
    displayName: "一覧（標準）",
    structureType: "list_v1",
    description: "ヘッダ＋明細テーブル＋フッタの標準テンプレ",
    version: 1,
    flags: [] as string[],
    slotSchema: SLOT_SCHEMA_LIST_V1,
  },
  {
    templateId: "cards_v1",
    displayName: "Card",
    structureType: "cards_v1",
    description: "ヘッダ＋カード＋フッタのテンプレ",
    version: 1,
    flags: ["hidden"] as string[],
    slotSchema: SLOT_SCHEMA_LIST_V1,
  },
  {
    templateId: "cards_v2",
    displayName: "Card Compact",
    structureType: "cards_v1",
    description: "一覧向けのコンパクトカードテンプレ",
    version: 1,
    flags: ["hidden"] as string[],
    slotSchema: SLOT_SCHEMA_LIST_V1,
  },
  {
    templateId: "label_standard_v1",
    displayName: "Label Standard",
    structureType: "label_v1",
    description: "標準ラベル（2x5）",
    version: 1,
    flags: [] as string[],
    slotSchema: SLOT_SCHEMA_LABEL_V1,
  },
  {
    templateId: "label_compact_v1",
    displayName: "Label Compact",
    structureType: "label_v1",
    description: "小型ラベル（3x8）",
    version: 1,
    flags: [] as string[],
    slotSchema: SLOT_SCHEMA_LABEL_V1,
  },
  {
    templateId: "label_logistics_v1",
    displayName: "Label Logistics",
    structureType: "label_v1",
    description: "物流ラベル（2x4）",
    version: 1,
    flags: [] as string[],
    slotSchema: SLOT_SCHEMA_LABEL_V1,
  },
];

const getUserTemplateById = async (
  templateId: string,
  env: Env,
  tenantKey: string,
): Promise<TemplateDefinition | null> => {
  const key = buildUserTemplateKey(tenantKey, templateId);
  const raw = await env.USER_TEMPLATES_KV.get(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as any;
    if (parsed && Array.isArray(parsed.elements)) {
      return parsed as TemplateDefinition;
    }
    if (parsed?.baseTemplateId) {
      const baseTemplate = await getBaseTemplateById(parsed.baseTemplateId, env);
      const mapped =
        baseTemplate.structureType === "cards_v1" ||
        parsed.baseTemplateId === "cards_v1" ||
        parsed.baseTemplateId === "cards_v2"
          ? applyCardsV1MappingToTemplate(baseTemplate, parsed.mapping)
          : baseTemplate.structureType === "list_v1" || parsed.baseTemplateId === "list_v1"
          ? applyListV1MappingToTemplate(baseTemplate, parsed.mapping)
          : { ...baseTemplate, mapping: parsed.mapping };
      const layoutApplied = applySlotLayoutOverrides(mapped, parsed.overrides?.layout);
      const dataApplied = applySlotDataOverrides(layoutApplied, parsed.overrides?.slots);
      return {
        ...dataApplied,
        id: templateId,
        name: parsed.meta?.name ?? dataApplied.name,
        baseTemplateId: parsed.baseTemplateId,
        sheetSettings: parsed.sheetSettings ?? dataApplied.sheetSettings,
      };
    }
    return null;
  } catch {
    return null;
  }
};

const ensureUserTemplateActive = async (
  env: Env,
  tenantKey: string,
  templateId: string,
): Promise<void> => {
  const found = await findTemplateMeta(env.USER_TEMPLATES_KV, tenantKey, templateId);
  if (!found) {
    throw new Error("Template not found");
  }
  if (found.status !== "active") {
    throw new Error(`Template is not active (${found.status})`);
  }
};

const getTableSummarySnapshot = (template?: TemplateDefinition | null) => {
  const table = template?.elements?.find((el) => el.type === "table") as
    | TableElement
    | undefined;
  if (!table?.summary) return null;
  return {
    mode: table.summary.mode,
    rows: table.summary.rows?.map((row) => ({
      op: row.op,
      kind: row.kind ?? null,
      columnId: row.columnId,
      fieldCode: "fieldCode" in row ? row.fieldCode : undefined,
    })),
  };
};

const applyListV1SummaryFromMapping = (
  template: TemplateDefinition,
): TemplateDefinition => {
  const structure = template.structureType ?? "list_v1";
  if (structure !== "list_v1") return template;
  const mapping = template.mapping as any;
  const rawSummaryMode = mapping?.table?.summaryMode ?? mapping?.table?.summary?.mode;
  if (!rawSummaryMode || rawSummaryMode === "none") return template;
  const summaryMode =
    rawSummaryMode === "everyPageSubtotal+lastTotal"
      ? ("everyPageSubtotal+lastTotal" as const)
      : ("lastPageOnly" as const);

  const tableIndex = template.elements.findIndex(
    (el) => el.type === "table" && el.id === "items",
  );
  if (tableIndex < 0) return template;
  const table = template.elements[tableIndex] as TableElement;
  if (!table.columns || table.columns.length === 0) return template;
  if (table.summary?.mode === summaryMode) return template;

  const amountColumnById = table.columns.find(
    (col) => col.id === "amount" && col.fieldCode,
  );
  const amountColumnByField = table.columns.find(
    (col) => col.fieldCode === "Amount",
  );
  const amountColumn = amountColumnById ?? amountColumnByField;
  if (!amountColumn?.fieldCode) return template;

  const nextSummary = {
    mode: summaryMode,
    rows: [
      {
        op: "sum" as const,
        fieldCode: amountColumn.fieldCode,
        columnId: amountColumn.id,
        kind: summaryMode === "everyPageSubtotal+lastTotal" ? ("both" as const) : ("total" as const),
        label: "合計",
        labelSubtotal: "小計",
        labelTotal: "合計",
      },
    ],
    style: {
      subtotalFillGray: 0.96,
      totalFillGray: 0.92,
      totalTopBorderWidth: 1.5,
      borderColorGray: 0.85,
    },
  };

  const nextElements = [...template.elements];
  nextElements[tableIndex] = { ...table, summary: nextSummary };
  return { ...template, elements: nextElements };
};

const resolveUserTemplate = async (
  templateId: string,
  env: Env,
  kintone?: { baseUrl?: string; appId?: string },
): Promise<TemplateDefinition> => {
  const baseUrl = kintone?.baseUrl;
  const appId = kintone?.appId;
  if (!baseUrl || !appId) {
    throw new Error("Missing kintone.baseUrl or kintone.appId for user template");
  }

  const tenantKey = buildTenantKey(baseUrl, appId);
  await ensureUserTemplateActive(env, tenantKey, templateId);
  const userTemplate = await getUserTemplateById(templateId, env, tenantKey);
  if (!userTemplate) {
    throw new Error(`Unknown user templateId: ${templateId}`);
  }

  return {
    ...userTemplate,
    id: templateId,
  };
};

async function getBaseTemplateById(
  id: string,
  env: Env,
): Promise<TemplateDefinition<TemplateDataRecord>> {
  const key = `tpl:${id}`;
  const value = await env.TEMPLATE_KV.get(key);
  if (value) {
    return JSON.parse(value) as TemplateDefinition<TemplateDataRecord>;
  }

  throw new Error(`Unknown templateId: ${id}`);
}

const buildTemplateHeaders = (
  migrated: TemplateDefinition,
  didMigrate: boolean,
  warnCount: number,
): Record<string, string> => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Template-Schema-Version": String(
      migrated.schemaVersion ?? TEMPLATE_SCHEMA_VERSION,
    ),
    "X-Warn-Count": String(warnCount),
  };
  if (didMigrate) headers["X-Template-Migrated"] = "1";
  return headers;
};

const normalizeTemplatePayload = (
  input: unknown,
): { ok: true; template: TemplateDefinition } | { ok: false; message: string } => {
  if (!input || typeof input !== "object") {
    return {
      ok: false,
      message: "Invalid template payload. Expected TemplateDefinition or { template: TemplateDefinition }",
    };
  }

  const obj = input as Record<string, unknown>;
  const candidate =
    typeof obj.template === "object" && obj.template !== null
      ? (obj.template as Record<string, unknown>)
      : obj;

  if (!("pageSize" in candidate) || !("elements" in candidate)) {
    return {
      ok: false,
      message: "Invalid template payload. Expected TemplateDefinition or { template: TemplateDefinition }",
    };
  }

  return { ok: true, template: candidate as unknown as TemplateDefinition };
};

const upsertActiveTemplateMeta = async (
  env: Env,
  tenantKey: string,
  templateId: string,
  baseTemplateId: string,
  name: string,
): Promise<TemplateMeta> => {
  const now = new Date().toISOString();
  const existing = await findTemplateMeta(env.USER_TEMPLATES_KV, tenantKey, templateId);
  const createdAt = existing?.meta.createdAt ?? now;

  const nextMeta: TemplateMeta = {
    templateId,
    baseTemplateId,
    name: name || existing?.meta.name || "名称未設定",
    createdAt,
    updatedAt: now,
    status: "active",
    pinned: existing?.meta.pinned,
    lastOpenedAt: existing?.meta.lastOpenedAt,
  };

  await putTemplateMeta(env.USER_TEMPLATES_KV, tenantKey, nextMeta);
  if (existing && existing.status !== "active") {
    await deleteTemplateMeta(env.USER_TEMPLATES_KV, tenantKey, existing.status, templateId);
  }

  return nextMeta;
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);

      // CORS preflight
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 200,
          headers: CORS_HEADERS,
        });
      }

      // ヘルスチェック
      if (url.pathname === "/" && request.method === "GET") {
        return new Response("PlugBits report worker is running.", {
          status: 200,
          headers: CORS_HEADERS,
        });
      }

      if (url.pathname === "/editor/session") {
        if (request.method !== "POST") {
          return new Response("Method Not Allowed", {
            status: 405,
            headers: CORS_HEADERS,
          });
        }
        if (!env.SESSIONS_KV) {
          return new Response("SESSIONS_KV is required", {
            status: 500,
            headers: CORS_HEADERS,
          });
        }

        let payload: { kintoneBaseUrl?: string; appId?: string; kintoneApiToken?: string };
        try {
          payload = (await request.json()) as {
            kintoneBaseUrl?: string;
            appId?: string;
            kintoneApiToken?: string;
          };
        } catch {
          return new Response("Invalid JSON body", {
            status: 400,
            headers: CORS_HEADERS,
          });
        }

        const rawBaseUrl = payload?.kintoneBaseUrl ?? "";
        const rawAppId = payload?.appId ?? "";
        if (!rawBaseUrl || !rawAppId) {
          return new Response("Missing kintoneBaseUrl or appId", {
            status: 400,
            headers: CORS_HEADERS,
          });
        }
        let kintoneBaseUrl: string;
        let appId: string;
        try {
          kintoneBaseUrl = canonicalizeKintoneBaseUrl(rawBaseUrl);
          appId = canonicalizeAppId(rawAppId);
        } catch {
          return new Response("Invalid kintoneBaseUrl", {
            status: 400,
            headers: CORS_HEADERS,
          });
        }
        if (!appId) {
          return new Response("Missing kintoneBaseUrl or appId", {
            status: 400,
            headers: CORS_HEADERS,
          });
        }

        const sessionToken =
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? `st_${crypto.randomUUID()}`
            : `st_${Date.now()}`;
        const expiresAt = Date.now() + 5 * 60 * 1000;
        const key = `editor_session:${sessionToken}`;
        const value = JSON.stringify({
          kintoneBaseUrl,
          appId,
          expiresAt,
          kintoneApiToken: payload.kintoneApiToken,
        });
        await env.SESSIONS_KV.put(key, value, { expirationTtl: 300 });

        console.info("[editor/session] issued", { sessionToken: sessionToken.slice(0, 8) });

        return new Response(JSON.stringify({ sessionToken, expiresAt }), {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          },
        });
      }

      if (url.pathname === "/editor/session/verify") {
        if (request.method !== "GET") {
          return new Response("Method Not Allowed", {
            status: 405,
            headers: CORS_HEADERS,
          });
        }
        const token = url.searchParams.get("token") ?? "";
        const loaded = await loadEditorSession(env, token);
        if ("error" in loaded) return loaded.error;

        console.info("[editor/session] verified", { sessionToken: token.slice(0, 8) });
        const session = loaded.session;

        return new Response(
          JSON.stringify({
            ok: true,
            kintoneBaseUrl: session.kintoneBaseUrl ?? "",
            appId: session.appId ?? "",
          }),
          {
            status: 200,
            headers: {
              ...CORS_HEADERS,
              "Content-Type": "application/json",
              "Cache-Control": "no-store",
            },
          },
        );
      }

      if (url.pathname === "/editor/session/exchange") {
        if (request.method !== "POST") {
          return new Response("Method Not Allowed", {
            status: 405,
            headers: CORS_HEADERS,
          });
        }

        let payload: { token?: string };
        try {
          payload = (await request.json()) as { token?: string };
        } catch {
          return new Response("Invalid JSON body", {
            status: 400,
            headers: CORS_HEADERS,
          });
        }

        const token = payload?.token ?? "";
        const loaded = await loadEditorSession(env, token);
        if ("error" in loaded) return loaded.error;

        const session = loaded.session;
        let canonicalBaseUrl = "";
        let canonicalAppId = "";
        let tenantId = "";
        try {
          canonicalBaseUrl = canonicalizeKintoneBaseUrl(session.kintoneBaseUrl);
          canonicalAppId = canonicalizeAppId(session.appId);
          if (!canonicalAppId) {
            return new Response("Missing kintoneBaseUrl or appId", {
              status: 400,
              headers: CORS_HEADERS,
            });
          }
          tenantId = buildTenantKey(canonicalBaseUrl, canonicalAppId);
        } catch {
          return new Response("Invalid kintoneBaseUrl", {
            status: 400,
            headers: CORS_HEADERS,
          });
        }

        let record = await getTenantRecord(env.USER_TEMPLATES_KV, tenantId);
        if (!record) {
          try {
            record = await registerTenant(env.USER_TEMPLATES_KV, {
              kintoneBaseUrl: canonicalBaseUrl,
              appId: canonicalAppId,
              kintoneApiToken: session.kintoneApiToken,
            });
          } catch {
            return new Response("Invalid kintoneBaseUrl", {
              status: 400,
              headers: CORS_HEADERS,
            });
          }
        } else if (session.kintoneApiToken) {
          const updated = await upsertTenantApiToken(
            env.USER_TEMPLATES_KV,
            record.tenantId,
            canonicalAppId,
            session.kintoneApiToken,
          );
          if (updated) record = updated;
        }

        const issued = await issueEditorToken(record.tenantId, record.tenantSecret);
        const expiresAt = new Date(issued.expiresAt).getTime();

        console.info("[editor/session] exchanged", {
          tenantId: record.tenantId,
          hasToken: Boolean(session.kintoneApiToken),
          tokenLength: session.kintoneApiToken?.length ?? 0,
        });

        return new Response(
          JSON.stringify({
            ok: true,
            editorToken: issued.token,
            expiresAt,
            kintoneBaseUrl: record.kintoneBaseUrl,
            appId: record.appId,
            tenantId: record.tenantId,
          }),
          {
            status: 200,
            headers: {
              ...CORS_HEADERS,
              "Content-Type": "application/json",
              "Cache-Control": "no-store",
            },
          },
        );
      }

      if (url.pathname === "/tenants/register") {
        if (request.method !== "POST") {
          return new Response("Method Not Allowed", {
            status: 405,
            headers: CORS_HEADERS,
          });
        }

        let payload: { kintoneBaseUrl?: string; appId?: string; kintoneApiToken?: string };
        try {
          payload = (await request.json()) as {
            kintoneBaseUrl?: string;
            appId?: string;
            kintoneApiToken?: string;
          };
        } catch {
          return new Response("Invalid JSON body", {
            status: 400,
            headers: CORS_HEADERS,
          });
        }

        if (!payload.kintoneBaseUrl || !payload.appId) {
          return new Response("Missing kintoneBaseUrl or appId", {
            status: 400,
            headers: CORS_HEADERS,
          });
        }

        let record;
        try {
          record = await registerTenant(env.USER_TEMPLATES_KV, {
            kintoneBaseUrl: payload.kintoneBaseUrl,
            appId: String(payload.appId),
            kintoneApiToken: payload.kintoneApiToken,
          });
        } catch {
          return new Response("Invalid kintoneBaseUrl", {
            status: 400,
            headers: CORS_HEADERS,
          });
        }

        return new Response(
          JSON.stringify({ tenantId: record.tenantId, tenantSecret: record.tenantSecret }),
          {
            status: 200,
            headers: {
              ...CORS_HEADERS,
              "Content-Type": "application/json",
              "Cache-Control": "no-store",
            },
          },
        );
      }

      if (url.pathname === "/auth/exchange") {
        if (request.method !== "POST") {
          return new Response("Method Not Allowed", {
            status: 405,
            headers: CORS_HEADERS,
          });
        }

        let payload: { tenantId?: string; tenantSecret?: string };
        try {
          payload = (await request.json()) as { tenantId?: string; tenantSecret?: string };
        } catch {
          return new Response("Invalid JSON body", {
            status: 400,
            headers: CORS_HEADERS,
          });
        }

        if (!payload.tenantId || !payload.tenantSecret) {
          return new Response("Missing tenantId or tenantSecret", {
            status: 400,
            headers: CORS_HEADERS,
          });
        }

        const record = await getTenantRecord(env.USER_TEMPLATES_KV, payload.tenantId);
        if (!record || record.tenantSecret !== payload.tenantSecret) {
          return new Response("Unauthorized", {
            status: 401,
            headers: CORS_HEADERS,
          });
        }

        const issued = await issueEditorToken(payload.tenantId, payload.tenantSecret);

        return new Response(JSON.stringify({ editorToken: issued.token, expiresAt: issued.expiresAt }), {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          },
        });
      }

      if (url.pathname === "/kintone/fields") {
        if (request.method !== "GET") {
          return new Response("Method Not Allowed", {
            status: 405,
            headers: CORS_HEADERS,
          });
        }

        const auth = await requireEditorToken(request, env);
        if ("error" in auth) return auth.error;

        const queryBaseUrl = url.searchParams.get("kintoneBaseUrl");
        const queryAppId = url.searchParams.get("appId");
        if (queryBaseUrl && queryAppId) {
          try {
            const expectedTenantId = buildTenantKey(queryBaseUrl, queryAppId);
            if (expectedTenantId !== auth.tenantId) {
              return new Response("Unauthorized", {
                status: 401,
                headers: CORS_HEADERS,
              });
            }
          } catch {
            return new Response("Invalid kintoneBaseUrl", {
              status: 400,
              headers: CORS_HEADERS,
            });
          }
        }

        let tenantRecord = auth.record;
        if (!tenantRecord.tokensByAppId && tenantRecord.kintoneApiToken && tenantRecord.appId) {
          const migrated = {
            ...tenantRecord,
            tokensByAppId: {
              [tenantRecord.appId]: tenantRecord.kintoneApiToken,
            },
            updatedAt: new Date().toISOString(),
          };
          await env.USER_TEMPLATES_KV.put(
            `tenant:${tenantRecord.tenantId}`,
            JSON.stringify(migrated),
          );
          tenantRecord = migrated;
        }

        const resolvedAppId = canonicalizeAppId(queryAppId ?? tenantRecord.appId);
        const token =
          tenantRecord.tokensByAppId?.[resolvedAppId] ??
          (tenantRecord.appId === resolvedAppId ? tenantRecord.kintoneApiToken : undefined) ??
          tenantRecord.kintoneApiToken;
        if (!token) {
          console.info("[kintone/fields] missing token", {
            tenantId: auth.tenantId,
            appId: resolvedAppId,
            hasToken: false,
          });
          return new Response(
            JSON.stringify({
              error_code: "MISSING_KINTONE_API_TOKEN",
              message: "Missing kintoneApiToken for app",
              appId: resolvedAppId,
            }),
            {
              status: 400,
              headers: {
                ...CORS_HEADERS,
                "Content-Type": "application/json",
              },
            },
          );
        }

        console.info("[kintone/fields] fetch", {
          tenantId: auth.tenantId,
          appId: resolvedAppId,
          hasToken: true,
        });

        const baseUrl = tenantRecord.kintoneBaseUrl.replace(/\/$/, "");
        const endpoint = `${baseUrl}/k/v1/app/form/fields.json?app=${encodeURIComponent(
          resolvedAppId,
        )}`;

        let kintoneResponse: Response;
        try {
          kintoneResponse = await fetch(endpoint, {
            headers: {
              "X-Cybozu-API-Token": token,
            },
          });
        } catch (error) {
          return new Response(
            error instanceof Error ? error.message : "Failed to fetch kintone fields",
            {
              status: 502,
              headers: CORS_HEADERS,
            },
          );
        }

        if (!kintoneResponse.ok) {
          const text = await kintoneResponse.text();
          return new Response(text || "Failed to fetch kintone fields", {
            status: kintoneResponse.status,
            headers: CORS_HEADERS,
          });
        }

        let payload: { properties?: Record<string, any> };
        try {
          payload = (await kintoneResponse.json()) as { properties?: Record<string, any> };
        } catch {
          return new Response("Failed to parse kintone response", {
            status: 502,
            headers: CORS_HEADERS,
          });
        }

        const properties = payload?.properties ?? {};
        const fields: Array<{
          code: string;
          label: string;
          type: string;
          isSubtable: boolean;
          subtableCode?: string;
        }> = [];

        Object.entries(properties).forEach(([propertyKey, propertyValue]) => {
          if (!propertyValue || typeof propertyValue !== "object") return;
          const code = String((propertyValue as any).code ?? propertyKey);
          const label = String((propertyValue as any).label ?? code);
          const type = String((propertyValue as any).type ?? "UNKNOWN");

          if (type === "SUBTABLE") {
            fields.push({ code, label, type: "SUBTABLE", isSubtable: true });
            const inner = (propertyValue as any).fields ?? {};
            Object.entries(inner).forEach(([innerKey, innerValue]) => {
              if (!innerValue || typeof innerValue !== "object") return;
              const innerCode = String((innerValue as any).code ?? innerKey);
              const innerLabel = String((innerValue as any).label ?? innerCode);
              const innerType = String((innerValue as any).type ?? "UNKNOWN");
              fields.push({
                code: innerCode,
                label: innerLabel,
                type: innerType,
                isSubtable: true,
                subtableCode: code,
              });
            });
            return;
          }

          fields.push({
            code,
            label,
            type,
            isSubtable: false,
          });
        });

        return new Response(JSON.stringify({ fields }), {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          },
        });
      }

      if (url.pathname === "/user-templates") {
        const auth = await requireEditorToken(request, env);
        if ("error" in auth) return auth.error;

        if (request.method !== "GET") {
          return new Response("Method Not Allowed", {
            status: 405,
            headers: CORS_HEADERS,
          });
        }

        const statusParam = url.searchParams.get("status") ?? "active";
        const status = statusParam as TemplateMeta["status"];
        if (!TEMPLATE_STATUSES.includes(status)) {
          return new Response("Invalid status", {
            status: 400,
            headers: CORS_HEADERS,
          });
        }

        const baseTemplateId = url.searchParams.get("baseTemplateId") ?? undefined;
        const limitParam = url.searchParams.get("limit");
        const limit = limitParam ? Number(limitParam) : undefined;
        const cursor = url.searchParams.get("cursor") ?? undefined;

        const list = await listTemplateMetas(env.USER_TEMPLATES_KV, auth.tenantId, status, {
          limit: Number.isFinite(limit) && limit && limit > 0 ? Math.min(limit, 200) : undefined,
          cursor: cursor || undefined,
        });

        let items = list.items;
        if (baseTemplateId) {
          items = items.filter((meta) => meta.baseTemplateId === baseTemplateId);
        }
        items.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));

        return new Response(JSON.stringify({ items, nextCursor: list.cursor }), {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          },
        });
      }

      const userTemplateActionMatch = url.pathname.match(
        /^\/user-templates\/([^/]+)\/(archive|unarchive|delete|restore|purge)$/,
      );
      if (userTemplateActionMatch) {
        const auth = await requireEditorToken(request, env);
        if ("error" in auth) return auth.error;

        const templateId = userTemplateActionMatch[1];
        const action = userTemplateActionMatch[2];
        const now = new Date().toISOString();

        const found = await findTemplateMeta(env.USER_TEMPLATES_KV, auth.tenantId, templateId);
        if (!found) {
          return new Response("Template not found", {
            status: 404,
            headers: CORS_HEADERS,
          });
        }

        const { meta, status } = found;
        const nextMeta: TemplateMeta = { ...meta, updatedAt: now };

        const moveMeta = async (nextStatus: TemplateMeta["status"]) => {
          nextMeta.status = nextStatus;
          await putTemplateMeta(env.USER_TEMPLATES_KV, auth.tenantId, nextMeta);
          if (status !== nextStatus) {
            await deleteTemplateMeta(env.USER_TEMPLATES_KV, auth.tenantId, status, templateId);
          }
        };

        if (request.method !== "POST" && !(action === "purge" && request.method === "DELETE")) {
          return new Response("Method Not Allowed", {
            status: 405,
            headers: CORS_HEADERS,
          });
        }

        if (action === "archive") {
          if (status === "deleted") {
            return new Response("Cannot archive deleted template", {
              status: 400,
              headers: CORS_HEADERS,
            });
          }
          nextMeta.archivedAt = now;
          nextMeta.deletedAt = undefined;
          await moveMeta("archived");
          return new Response(JSON.stringify(nextMeta), {
            status: 200,
            headers: {
              ...CORS_HEADERS,
              "Content-Type": "application/json",
              "Cache-Control": "no-store",
            },
          });
        }

        if (action === "unarchive") {
          if (status === "deleted") {
            return new Response("Cannot unarchive deleted template", {
              status: 400,
              headers: CORS_HEADERS,
            });
          }
          nextMeta.archivedAt = undefined;
          nextMeta.deletedAt = undefined;
          await moveMeta("active");
          return new Response(JSON.stringify(nextMeta), {
            status: 200,
            headers: {
              ...CORS_HEADERS,
              "Content-Type": "application/json",
              "Cache-Control": "no-store",
            },
          });
        }

        if (action === "delete") {
          nextMeta.archivedAt = undefined;
          nextMeta.deletedAt = now;
          await moveMeta("deleted");
          return new Response(JSON.stringify(nextMeta), {
            status: 200,
            headers: {
              ...CORS_HEADERS,
              "Content-Type": "application/json",
              "Cache-Control": "no-store",
            },
          });
        }

        if (action === "restore") {
          if (status !== "deleted") {
            return new Response("Template is not deleted", {
              status: 400,
              headers: CORS_HEADERS,
            });
          }
          nextMeta.archivedAt = undefined;
          nextMeta.deletedAt = undefined;
          await moveMeta("active");
          return new Response(JSON.stringify(nextMeta), {
            status: 200,
            headers: {
              ...CORS_HEADERS,
              "Content-Type": "application/json",
              "Cache-Control": "no-store",
            },
          });
        }

        if (action === "purge") {
          if (status !== "deleted") {
            return new Response("Template is not deleted", {
              status: 400,
              headers: CORS_HEADERS,
            });
          }

          await deleteTemplateMeta(env.USER_TEMPLATES_KV, auth.tenantId, status, templateId);
          await env.USER_TEMPLATES_KV.delete(buildUserTemplateKey(auth.tenantId, templateId));
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: {
              ...CORS_HEADERS,
              "Content-Type": "application/json",
              "Cache-Control": "no-store",
            },
          });
        }
      }

      const userTemplateMatch = url.pathname.match(/^\/user-templates\/([^/]+)$/);
      if (userTemplateMatch) {
        const templateId = userTemplateMatch[1];

        if (request.method === "GET") {
          const authHeader = request.headers.get("Authorization") ?? "";
          const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
          if (token) {
            const auth = await requireEditorToken(request, env);
            if ("error" in auth) return auth.error;
            if (url.searchParams.get("requireActive") === "1") {
              try {
                await ensureUserTemplateActive(env, auth.tenantId, templateId);
              } catch {
                return new Response("Template not found", {
                  status: 404,
                  headers: CORS_HEADERS,
                });
              }
            }
            const templateBody = await getUserTemplateById(templateId, env, auth.tenantId);
            if (!templateBody) {
              return new Response("Template not found", {
                status: 404,
                headers: CORS_HEADERS,
              });
            }
            return new Response(JSON.stringify({ ...templateBody, id: templateId }), {
              status: 200,
              headers: {
                ...CORS_HEADERS,
                "Content-Type": "application/json",
                "Cache-Control": "no-store",
              },
            });
          }

          const tenant = getTenantContext(url);
          if ("error" in tenant) return tenant.error;
          try {
            await ensureUserTemplateActive(env, tenant.tenantKey, templateId);
          } catch {
            return new Response("Template not found", {
              status: 404,
              headers: CORS_HEADERS,
            });
          }
          const templateBody = await getUserTemplateById(templateId, env, tenant.tenantKey);
          if (!templateBody) {
            return new Response("Template not found", {
              status: 404,
              headers: CORS_HEADERS,
            });
          }
          return new Response(JSON.stringify({ ...templateBody, id: templateId }), {
            status: 200,
            headers: {
              ...CORS_HEADERS,
              "Content-Type": "application/json",
              "Cache-Control": "no-store",
            },
          });
        }

        const auth = await requireEditorToken(request, env);
        if ("error" in auth) return auth.error;
        const key = buildUserTemplateKey(auth.tenantId, templateId);

        if (request.method === "PUT") {
          let rawPayload: unknown;
          let payload: UserTemplatePayload | null = null;
          let templateBody: TemplateDefinition | null = null;
          try {
            rawPayload = await request.json();
          } catch {
            return new Response("Invalid JSON body", {
              status: 400,
              headers: CORS_HEADERS,
            });
          }

          const normalized = normalizeTemplatePayload(rawPayload);
          if (normalized.ok) {
            templateBody = normalized.template;
          } else {
            payload = rawPayload as UserTemplatePayload;
          }

          const baseTemplateId =
            templateBody?.baseTemplateId ??
            payload?.baseTemplateId ??
            (templateBody ? "list_v1" : "");

          if (!baseTemplateId) {
            return new Response("Missing baseTemplateId", {
              status: 400,
              headers: CORS_HEADERS,
            });
          }

          if (!templateBody) {
            let baseTemplate: TemplateDefinition;
            try {
              baseTemplate = await getBaseTemplateById(baseTemplateId, env);
            } catch {
              return new Response("Base template not found", {
                status: 404,
                headers: CORS_HEADERS,
              });
            }

            const mapped =
              baseTemplate.structureType === "cards_v1" ||
              baseTemplateId === "cards_v1" ||
              baseTemplateId === "cards_v2"
                ? applyCardsV1MappingToTemplate(baseTemplate, payload?.mapping)
                : baseTemplate.structureType === "list_v1" || baseTemplateId === "list_v1"
                ? applyListV1MappingToTemplate(baseTemplate, payload?.mapping)
                : { ...baseTemplate, mapping: payload?.mapping };
            const layoutApplied = applySlotLayoutOverrides(mapped, payload?.overrides?.layout);
            const dataApplied = applySlotDataOverrides(layoutApplied, payload?.overrides?.slots);
            const pageSize = payload?.pageSize ?? dataApplied.pageSize;

            templateBody = {
              ...dataApplied,
              pageSize,
            };
          }

          const nextName =
            payload?.meta?.name ||
            templateBody.name ||
            "名称未設定";

          const nextTemplate: TemplateDefinition = {
            ...templateBody,
            id: templateId,
            name: nextName,
            baseTemplateId,
            sheetSettings: payload?.sheetSettings ?? templateBody.sheetSettings,
          };

          const payloadSummaryMode =
            payload?.mapping &&
            typeof payload.mapping === "object" &&
            (payload.mapping as any)?.table?.summaryMode;
          const payloadSummaryConfig =
            payload?.mapping &&
            typeof payload.mapping === "object" &&
            (payload.mapping as any)?.table?.summary;
          const tableSummary = getTableSummarySnapshot(nextTemplate);
          console.info("[user-templates] summary snapshot", {
            templateId,
            payloadSummaryMode: payloadSummaryMode ?? null,
            payloadSummaryConfig: payloadSummaryConfig ?? null,
            tableSummary,
          });

          await env.USER_TEMPLATES_KV.put(key, JSON.stringify(nextTemplate));
          await upsertActiveTemplateMeta(env, auth.tenantId, templateId, baseTemplateId, nextName);

          return new Response(JSON.stringify(nextTemplate), {
            status: 200,
            headers: {
              ...CORS_HEADERS,
              "Content-Type": "application/json",
              "Cache-Control": "no-store",
            },
          });
        }

        if (request.method === "DELETE") {
          const now = new Date().toISOString();
          const found = await findTemplateMeta(env.USER_TEMPLATES_KV, auth.tenantId, templateId);
          if (!found) {
            return new Response("Template not found", {
              status: 404,
              headers: CORS_HEADERS,
            });
          }

          if (url.searchParams.get("permanent") === "1") {
            await deleteTemplateMeta(env.USER_TEMPLATES_KV, auth.tenantId, found.status, templateId);
            await env.USER_TEMPLATES_KV.delete(buildUserTemplateKey(auth.tenantId, templateId));
            return new Response(JSON.stringify({ ok: true }), {
              status: 200,
              headers: {
                ...CORS_HEADERS,
                "Content-Type": "application/json",
                "Cache-Control": "no-store",
              },
            });
          }

          const nextMeta: TemplateMeta = {
            ...found.meta,
            status: "deleted",
            updatedAt: now,
            archivedAt: undefined,
            deletedAt: now,
          };

          await putTemplateMeta(env.USER_TEMPLATES_KV, auth.tenantId, nextMeta);
          if (found.status !== "deleted") {
            await deleteTemplateMeta(env.USER_TEMPLATES_KV, auth.tenantId, found.status, templateId);
          }

          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: {
              ...CORS_HEADERS,
              "Content-Type": "application/json",
              "Cache-Control": "no-store",
            },
          });
        }

        return new Response("Method Not Allowed", {
          status: 405,
          headers: CORS_HEADERS,
        });
      }

      if (url.pathname === "/templates-catalog") {
        if (request.method !== "GET") {
          return new Response("Method Not Allowed", {
            status: 405,
            headers: CORS_HEADERS,
          });
        }

        const visibleTemplates = TEMPLATE_CATALOG.filter(
          (item) => !(item.flags ?? []).includes("hidden"),
        );
        return new Response(JSON.stringify({ templates: visibleTemplates }), {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            "Content-Type": "application/json",
            "Cache-Control": "public, max-age=300",
          },
        });
      }

      if (url.pathname === "/calibration/label") {
        if (request.method !== "GET") {
          return new Response("Method Not Allowed", {
            status: 405,
            headers: CORS_HEADERS,
          });
        }

        const numParam = (key: string, fallback: number) => {
          const raw = url.searchParams.get(key);
          const value = raw === null ? fallback : Number(raw);
          return Number.isFinite(value) ? value : fallback;
        };
        const intParam = (key: string, fallback: number) => {
          const raw = url.searchParams.get(key);
          const value = raw === null ? fallback : Number(raw);
          const intVal = Number.isFinite(value) ? Math.floor(value) : fallback;
          return intVal > 0 ? intVal : fallback;
        };

        const sheetSettings = {
          paperWidthMm: numParam("paperWidthMm", 210),
          paperHeightMm: numParam("paperHeightMm", 297),
          cols: intParam("cols", 2),
          rows: intParam("rows", 5),
          marginMm: numParam("marginMm", 8),
          gapMm: numParam("gapMm", 2),
          offsetXmm: numParam("offsetXmm", 0),
          offsetYmm: numParam("offsetYmm", 0),
        };

        const { bytes } = await renderLabelCalibrationPdf(sheetSettings);
        const body = bytes.slice().buffer;
        return new Response(body, {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            "Content-Type": "application/pdf",
            "Cache-Control": "no-store",
          },
        });
      }

      const templateMatch = url.pathname.match(/^\/templates\/([^/]+)$/);
      if (templateMatch) {
        const templateId = templateMatch[1];
        const isUserTemplate = templateId.startsWith("tpl_");
        const requireActive = url.searchParams.get("requireActive") === "1";
        if (!isUserTemplate && !TEMPLATE_IDS.has(templateId)) {
          return new Response("Unknown templateId", {
            status: 400,
            headers: CORS_HEADERS,
          });
        }

        if (request.method === "GET") {
          try {
            const rawTemplate = isUserTemplate
              ? (async () => {
                  const authHeader = request.headers.get("Authorization") ?? "";
                  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
                  if (token) {
                    const verified = await verifyEditorToken(env.USER_TEMPLATES_KV, token);
                    if (!verified) {
                      return { error: new Response("Unauthorized", { status: 401, headers: CORS_HEADERS }) };
                    }
                    if (requireActive) {
                      try {
                        await ensureUserTemplateActive(env, verified.tenantId, templateId);
                      } catch (error) {
                        const message = error instanceof Error ? error.message : "Template not found";
                        return { error: new Response(message, { status: 404, headers: CORS_HEADERS }) };
                      }
                    }
                    return getUserTemplateById(templateId, env, verified.tenantId);
                  }

                  const tenant = getTenantContext(url);
                  if ("error" in tenant) return tenant;
                  if (requireActive) {
                    try {
                      await ensureUserTemplateActive(env, tenant.tenantKey, templateId);
                    } catch (error) {
                      const message = error instanceof Error ? error.message : "Template not found";
                      return { error: new Response(message, { status: 404, headers: CORS_HEADERS }) };
                    }
                  }
                  return getUserTemplateById(templateId, env, tenant.tenantKey);
                })()
              : getBaseTemplateById(templateId, env);

            const resolved = await rawTemplate;
            if (!resolved || "error" in (resolved as any)) {
              if (resolved && "error" in (resolved as any)) return (resolved as any).error;
              return new Response("Template not found", {
                status: 404,
                headers: CORS_HEADERS,
              });
            }

            const rawTemplateResolved = resolved as TemplateDefinition;
            const schemaVersionBefore = rawTemplateResolved.schemaVersion ?? 0;
            const migratedTemplate = migrateTemplate(rawTemplateResolved);
            const didMigrate = schemaVersionBefore < TEMPLATE_SCHEMA_VERSION;
            const { ok, issues } = validateTemplate(migratedTemplate);
            const warnCount = issues.filter((issue) => issue.level === "warn").length;

            const headers: Record<string, string> = {
              ...CORS_HEADERS,
              ...buildTemplateHeaders(migratedTemplate, didMigrate, warnCount),
            };

            if (!ok) {
              return new Response(JSON.stringify({ ok: false, issues }), {
                status: 400,
                headers,
              });
            }

            return new Response(JSON.stringify(migratedTemplate), {
              status: 200,
              headers,
            });
          } catch {
            return new Response("Template not found", {
              status: 404,
              headers: CORS_HEADERS,
            });
          }
        }

        if (request.method === "PUT") {
          if (isUserTemplate) {
            return new Response("Use /user-templates for user template updates", {
              status: 405,
              headers: CORS_HEADERS,
            });
          }
          if (env.ADMIN_API_KEY) {
            const apiKey = request.headers.get("x-api-key");
            if (apiKey !== env.ADMIN_API_KEY) {
              return new Response("Unauthorized", {
                status: 401,
                headers: CORS_HEADERS,
              });
            }
          }

          let templateBody: TemplateDefinition;
          try {
            const rawPayload = await request.json();
            const normalized = normalizeTemplatePayload(rawPayload);
            if (!normalized.ok) {
              return new Response(normalized.message, {
                status: 400,
                headers: CORS_HEADERS,
              });
            }
            templateBody = normalized.template;
          } catch {
            return new Response("Invalid JSON body", {
              status: 400,
              headers: CORS_HEADERS,
            });
          }

          const schemaVersionBefore = templateBody.schemaVersion ?? 0;
          const migratedTemplate = migrateTemplate(templateBody);
          const didMigrate = schemaVersionBefore < TEMPLATE_SCHEMA_VERSION;
          const { ok, issues } = validateTemplate(migratedTemplate);
          const warnCount = issues.filter((issue) => issue.level === "warn").length;
          const headers: Record<string, string> = {
            ...CORS_HEADERS,
            ...buildTemplateHeaders(migratedTemplate, didMigrate, warnCount),
          };

          if (!ok) {
            return new Response(JSON.stringify({ ok: false, issues }), {
              status: 400,
              headers,
            });
          }

          await env.TEMPLATE_KV.put(
            `tpl:${templateId}`,
            JSON.stringify(migratedTemplate),
          );

          return new Response(JSON.stringify(migratedTemplate), {
            status: 200,
            headers,
          });
        }

        return new Response("Method Not Allowed", {
          status: 405,
          headers: CORS_HEADERS,
        });
      }

      // PDF レンダリング API
      if (
        (url.pathname === "/render" || url.pathname === "/render-preview") &&
        request.method === "POST"
      ) {
        let body: RenderRequestBody;

        // JSON パース
        try {
          body = (await request.json()) as RenderRequestBody;
        } catch {
          return new Response("Invalid JSON body", {
            status: 400,
            headers: CORS_HEADERS,
          });
        }

        const debug = url.searchParams.get("debug") === "1";
        const previewMode =
          body.previewMode === "fieldCode" ? "fieldCode" : "record";

        // template / templateId のどちらかから TemplateDefinition を決定
        let template: TemplateDefinition<TemplateDataRecord>;

        if (body.template) {
          template = body.template;
        } else if (body.templateId) {
          const isUserTemplate = body.templateId.startsWith("tpl_");
          if (!isUserTemplate && !TEMPLATE_IDS.has(body.templateId)) {
            return new Response("Unknown templateId", {
              status: 400,
              headers: CORS_HEADERS,
            });
          }
          if (
            !isUserTemplate &&
            body.templateId !== "list_v1" &&
            body.templateId !== "cards_v1" &&
            body.templateId !== "cards_v2" &&
            body.templateId !== "label_standard_v1" &&
            body.templateId !== "label_compact_v1" &&
            body.templateId !== "label_logistics_v1"
          ) {
            return new Response(
              JSON.stringify({
                ok: false,
                code: "UNSUPPORTED_TEMPLATE",
                message: `templateId ${body.templateId} is not supported yet`,
              }),
              {
                status: 400,
                headers: {
                  ...CORS_HEADERS,
                  "Content-Type": "application/json",
                },
              },
            );
          }
          try {
            template = isUserTemplate
              ? await resolveUserTemplate(body.templateId, env, body.kintone as any)
              : await getBaseTemplateById(body.templateId, env);
          } catch (err) {
            const msg =
              err instanceof Error ? err.message : "Unknown templateId";
            return new Response(msg, {
              status: 400,
              headers: CORS_HEADERS,
            });
          }
        } else {
          return new Response(
            "Missing 'template' or 'templateId' in request body",
            {
              status: 400,
              headers: CORS_HEADERS,
            },
          );
        }

        const fixtureName = url.searchParams.get("fixture");
        console.log("fixture=", fixtureName);
        const fixtureData = fixtureName ? getFixtureData(fixtureName) : undefined;
        if (fixtureName && !fixtureData) {
          return new Response(`Unknown fixture: ${fixtureName}`, {
            status: 400,
            headers: CORS_HEADERS,
          });
        }
        const schemaVersionBefore = template.schemaVersion ?? 0;
        const migratedTemplate = migrateTemplate(template);
        const didMigrate = schemaVersionBefore < TEMPLATE_SCHEMA_VERSION;
        const { ok, issues } = validateTemplate(migratedTemplate);
        const issueWarnings = issues.map((issue) => {
          const category = issue.level === "error" ? "layout" : "data";
          const pathSuffix = issue.path ? ` (${issue.path})` : "";
          return `[${category}] template ${issue.code}: ${issue.message}${pathSuffix}`;
        });
        const schemaHeaderValue = String(
          migratedTemplate.schemaVersion ?? TEMPLATE_SCHEMA_VERSION,
        );

        if (!ok) {
          const headers: Record<string, string> = {
            ...CORS_HEADERS,
            "Content-Type": "application/json",
            "X-Template-Schema-Version": schemaHeaderValue,
            "X-Warn-Count": String(issueWarnings.length),
          };
          if (didMigrate) headers["X-Template-Migrated"] = "1";
          if (debug && issueWarnings.length > 0) {
            headers["X-Debug-Warn-Sample"] = truncateHeaderValue(issueWarnings[0]);
          }

          return new Response(
            JSON.stringify({ ok: false, issues }),
            {
              status: 400,
              headers,
            },
          );
        }

        const rowHeightParam = url.searchParams.get("rowHeight");
        const rowHeightOverride = rowHeightParam ? Number(rowHeightParam) : undefined;
        const hasRowHeightOverride =
          typeof rowHeightOverride === "number" &&
          Number.isFinite(rowHeightOverride) &&
          rowHeightOverride > 0;

        let templateForRender = hasRowHeightOverride
          ? {
              ...migratedTemplate,
              elements: migratedTemplate.elements.map((el) =>
                el.type === "table" && el.id === "items"
                  ? { ...el, rowHeight: rowHeightOverride }
                  : el,
              ),
            }
          : migratedTemplate;
        templateForRender = applyListV1SummaryFromMapping(templateForRender);
        const mappingSummaryMode =
          templateForRender.mapping &&
          typeof templateForRender.mapping === "object" &&
          ((templateForRender.mapping as any)?.table?.summaryMode ??
            (templateForRender.mapping as any)?.table?.summary?.mode);
        console.info("[render] summary snapshot", {
          templateId: templateForRender.id ?? body.templateId ?? "",
          mappingSummaryMode: mappingSummaryMode ?? null,
          tableSummary: getTableSummarySnapshot(templateForRender),
        });
        let dataForRender = (fixtureData ?? body.data) as unknown;
        const dataWarnings: string[] = [];

        if (dataForRender && typeof dataForRender === "object") {
          const record = dataForRender as Record<string, unknown>;
          if ("Items" in record) {
            const items = record.Items;
            if (!Array.isArray(items)) {
              return new Response(
                JSON.stringify({
                  ok: false,
                  code: "INVALID_ITEMS",
                  message: "data.Items must be an array",
                }),
                {
                  status: 400,
                  headers: {
                    ...CORS_HEADERS,
                    "Content-Type": "application/json",
                  },
                },
              );
            }

            let changed = false;
            const nextItems = items.map((row, rowIndex) => {
              if (!row || typeof row !== "object" || Array.isArray(row)) {
                return row;
              }

              const rowRecord = row as Record<string, unknown>;
              let rowChanged = false;
              const nextRow: Record<string, unknown> = { ...rowRecord };
              for (const field of ["Qty", "UnitPrice", "Amount"] as const) {
                const value = rowRecord[field];
                if (typeof value === "number") {
                  dataWarnings.push(
                    `[data] number coerced to string ${JSON.stringify({ field, value, rowIndex })}`,
                  );
                  nextRow[field] = String(value);
                  rowChanged = true;
                }
              }

              if (rowChanged) {
                changed = true;
                return nextRow;
              }
              return rowRecord;
            });

            if (changed) {
              dataForRender = { ...record, Items: nextItems };
            }
          }
        }

        const rowsCount = (() => {
          if (dataForRender && typeof dataForRender === "object") {
            const maybeItems = (dataForRender as any).Items;
            if (Array.isArray(maybeItems)) return maybeItems.length;
          }
          return "(unknown)";
        })();

        // フォント読み込み
        let fonts: { jp: Uint8Array; latin: Uint8Array };  // ← これが大事！！
        try {
          fonts = await loadFonts(env);
          console.log(
            "jpFont length:", fonts.jp.length,
            "latinFont length:", fonts.latin.length,
          );
        } catch (err) {
          console.error("Failed to load font:", err);
          return new Response("Failed to load font", {
            status: 500,
            headers: CORS_HEADERS,
          });
        }

        // PDF 生成
        try {
          const { bytes: rawPdfBytes, warnings } = await renderTemplateToPdf(
            templateForRender,
            dataForRender as TemplateDataRecord | undefined,
            fonts,
            { debug, previewMode },
          );

          const pdfBytes = new Uint8Array(rawPdfBytes);
          const combinedWarnings = [...issueWarnings, ...dataWarnings, ...warnings];
          const warnCount = combinedWarnings.length;
          const headers: Record<string, string> = {
            ...CORS_HEADERS,
            "Content-Type": "application/pdf",
            "X-Debug-Fixture": fixtureName ?? "(none)",
            "X-Debug-Rows": String(rowsCount),
            "X-Warn-Count": String(warnCount),
            "X-Template-Schema-Version": schemaHeaderValue,
          };
          if (didMigrate) headers["X-Template-Migrated"] = "1";

          if (debug && warnCount > 0) {
            headers["X-Debug-Warn-Sample"] = truncateHeaderValue(combinedWarnings[0]);
          }

          return new Response(pdfBytes, {
            status: 200,
            headers,
          });
        } catch (err) {
          console.error("Failed to render template:", err);
          return new Response("Failed to render template", {
            status: 500,
            headers: CORS_HEADERS,
          });
        }
      }

      // その他のパス
      return new Response("Not Found", { status: 404, headers: CORS_HEADERS });
    } catch (err) {
      // ここに来るのは「本当に想定外」の例外
      console.error("Unhandled error in worker:", err);
      return new Response("Internal error", {
        status: 500,
        headers: CORS_HEADERS,
      });
    }
  },
};
