// worker/src/index.ts
import type {
  TemplateDefinition,
  TemplateDataRecord,
  TemplateMeta,
  TableElement,
  CompanyProfile,
  TemplateElement,
} from "../../shared/template.js";
import { TEMPLATE_SCHEMA_VERSION, getPageDimensions } from "../../shared/template.js";

import { renderLabelCalibrationPdf, renderTemplateToPdf } from "./pdf/renderTemplate.ts";
import { getFonts } from "./fonts/fontLoader.js";
import { getFixtureData } from "./fixtures/templateData.js";
import { applyEstimateV1PresetPatch, migrateTemplate, validateTemplate } from "./template/migrate.js";
import { applyListV1MappingToTemplate } from "./template/listV1Mapping.ts";
import { applyEstimateV1MappingToTemplate } from "./template/estimateV1Mapping.ts";
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
  updateTenantLogo,
  deleteTenantLogo,
  updateTenantSettings,
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
  TENANT_ASSETS?: R2Bucket;
  RENDER_CACHE?: KVNamespace;
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

  // 表示モード（layout/preview/final）
  mode?: "layout" | "preview" | "final";

  // 自社情報（プラグイン設定由来）
  companyProfile?: CompanyProfile;
};

type RenderMode = "layout" | "preview" | "final";

// CORS 設定
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key, x-kintone-api-token, X-Requested-With",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const SESSION_TTL_SECONDS = 60 * 60;
const DEBUG_PATTERN = /(^|[?#&])debug=(1|true)($|[&#])/i;

const parseDebugFlags = (url: URL) => {
  const debugFromQuery = DEBUG_PATTERN.test(url.search ?? "");
  const debugFromHash = DEBUG_PATTERN.test(url.hash ?? "");
  return {
    debugFromQuery,
    debugFromHash,
    debugEffective: debugFromQuery || debugFromHash,
  };
};

const buildRenderErrorResponse = (
  status: number,
  payload: Record<string, unknown>,
) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json",
    },
  });

const resolveRenderHint = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  if (/font/i.test(message)) return "Font load failed.";
  if (/template/i.test(message)) return "Template missing or invalid.";
  if (/json/i.test(message)) return "Request JSON body is invalid.";
  if (/kv/i.test(message)) return "Template KV lookup failed.";
  return "Check worker logs with requestId for details.";
};

const truncateHeaderValue = (value: string, maxLength = 200) =>
  value.length > maxLength ? value.slice(0, maxLength) : value;

const LOGO_ALLOWED_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
]);
const LOGO_MAX_UPLOAD_BYTES = 2 * 1024 * 1024;
const LOGO_MAX_STORED_BYTES = 300 * 1024;

const buildTenantLogoKey = (tenantKey: string, ext?: string) =>
  `tenants/${tenantKey}/logo${ext ? `.${ext}` : ""}`;

const normalizeLogoContentType = (contentType: string) => {
  if (contentType === "image/jpg") return "image/jpeg";
  return contentType;
};

const resolveLogoExtension = (contentType: string) =>
  contentType === "image/png" ? "png" : "jpg";

const isValidLogoContentType = (contentType: string | null | undefined) => {
  if (!contentType) return false;
  return LOGO_ALLOWED_TYPES.has(contentType.toLowerCase());
};

const getTenantLogoBytes = async (
  env: Env,
  tenantKey: string,
  logo: { objectKey: string; contentType: string },
): Promise<{ bytes: Uint8Array; contentType: string } | null> => {
  if (!env.TENANT_ASSETS) return null;
  const cacheKey = new Request(`https://tenant-assets/${logo.objectKey}`);
  const cached = await caches.default.match(cacheKey);
  if (cached) {
    const cachedBytes = new Uint8Array(await cached.arrayBuffer());
    const cachedType = cached.headers.get("content-type") ?? logo.contentType;
    return { bytes: cachedBytes, contentType: cachedType };
  }

  const object = await env.TENANT_ASSETS.get(logo.objectKey);
  if (!object) return null;
  const contentType =
    object.httpMetadata?.contentType ??
    logo.contentType ??
    "image/png";
  const bytes = new Uint8Array(await object.arrayBuffer());
  const response = new Response(bytes, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=21600",
    },
  });
  await caches.default.put(cacheKey, response.clone());
  return { bytes, contentType };
};

const normalizeCompanyProfile = (profile?: CompanyProfile) => ({
  companyName: String(profile?.companyName ?? '').trim(),
  companyAddress: String(profile?.companyAddress ?? '').trim(),
  companyTel: String(profile?.companyTel ?? '').trim(),
  companyEmail: String(profile?.companyEmail ?? '').trim(),
});

const stableStringify = (value: unknown): string => {
  const seen = new WeakSet<object>();
  const stringify = (input: unknown): string => {
    if (input === null || typeof input === "number" || typeof input === "boolean") {
      return JSON.stringify(input);
    }
    if (typeof input === "string") {
      return JSON.stringify(input);
    }
    if (typeof input !== "object") {
      return "null";
    }
    const obj = input as Record<string, unknown>;
    if (seen.has(obj)) return "\"[Circular]\"";
    seen.add(obj);
    if (Array.isArray(obj)) {
      const items = obj.map((item) => {
        if (item === undefined || typeof item === "function" || typeof item === "symbol") {
          return "null";
        }
        return stringify(item);
      });
      return `[${items.join(",")}]`;
    }
    const keys = Object.keys(obj).sort();
    const entries: string[] = [];
    for (const key of keys) {
      const val = obj[key];
      if (val === undefined || typeof val === "function" || typeof val === "symbol") continue;
      entries.push(`${JSON.stringify(key)}:${stringify(val)}`);
    }
    return `{${entries.join(",")}}`;
  };
  return stringify(value);
};

const canonicalizeElementDefaults = (
  element: TemplateElement,
): TemplateElement => {
  const next = { ...element } as any;
  const slotId = next.slotId ?? next.id;
  const isCompanyLogo =
    slotId === "company_logo" || slotId === "logo" || next.id === "company_logo" || next.id === "logo";
  const isCompanySlot = typeof slotId === "string" && slotId.startsWith("company_");
  if (isCompanyLogo) {
    next.slotId = "company_logo";
    next.hidden = false;
    if ("dataSource" in next) {
      delete next.dataSource;
    }
    if ("imageUrl" in next) {
      delete next.imageUrl;
    }
  }
  if (isCompanySlot && !isCompanyLogo) {
    if ("dataSource" in next) {
      delete next.dataSource;
    }
    if ("text" in next) {
      delete next.text;
    }
  }
  if (next.slotId === null || next.slotId === undefined) {
    delete next.slotId;
  }
  if (next.type === "text" || next.type === "label") {
    if (next.alignX === null || next.alignX === undefined || next.alignX === "left") {
      delete next.alignX;
    }
    if (next.valign === null || next.valign === undefined || next.valign === "middle") {
      delete next.valign;
    }
    if (next.paddingX === null || next.paddingX === undefined || next.paddingX === 0) {
      delete next.paddingX;
    }
    if (next.paddingY === null || next.paddingY === undefined || next.paddingY === 0) {
      delete next.paddingY;
    }
    if (next.lineHeight === null || next.lineHeight === undefined || next.lineHeight === 0) {
      delete next.lineHeight;
    }
    if (next.style && typeof next.style === "object" && Object.keys(next.style).length === 0) {
      delete next.style;
    }
  } else {
    delete next.fontSize;
    delete next.lineHeight;
    delete next.alignX;
    delete next.align;
    delete next.valign;
    delete next.paddingX;
    delete next.paddingY;
    delete next.style;
  }
  if (next.type === "image") {
    if (next.fitMode === null || next.fitMode === undefined || next.fitMode === "fit") {
      delete next.fitMode;
    }
  }
  return next as TemplateElement;
};

const canonicalizeTemplateForStorage = (
  template: TemplateDefinition,
): TemplateDefinition => {
  const clone =
    typeof structuredClone === "function"
      ? structuredClone(template)
      : JSON.parse(JSON.stringify(template));
  const mapping = (clone as any).mapping;
  if (mapping?.header) {
    delete mapping.header.logo;
    delete mapping.header.company_logo;
    delete mapping.header.company_name;
    delete mapping.header.company_address;
    delete mapping.header.company_tel;
    delete mapping.header.company_email;
  }
  const elements = Array.isArray(clone.elements) ? clone.elements : [];
  const canonicalized = elements.map(canonicalizeElementDefaults);
  const hasCompanyLogo = canonicalized.some((el) => {
    const slotId = (el as any).slotId ?? el.id;
    return slotId === "company_logo" || el.id === "logo" || el.id === "company_logo";
  });
  const companySlotDefs = [
    { slotId: "company_name", label: "会社名", kind: "text" },
    { slotId: "company_address", label: "住所", kind: "text" },
    { slotId: "company_tel", label: "TEL", kind: "text" },
    { slotId: "company_email", label: "Email", kind: "text" },
  ] as const;
  const hasCompanySlots = canonicalized.some((el) => {
    const slotId = (el as any).slotId ?? el.id;
    return typeof slotId === "string" && slotId.startsWith("company_") && slotId !== "company_logo";
  });
  const slotSchema = (clone as any).slotSchema as
    | { header?: Array<{ slotId: string; label?: string; kind?: string }> }
    | undefined;
  let nextSlotSchema = slotSchema;
  if (slotSchema?.header) {
    const headerSlots = slotSchema.header.map((slot) => {
      if (slot.slotId !== "logo") return slot;
      return {
        ...slot,
        slotId: "company_logo",
        label: slot.label === "ロゴ" ? "会社ロゴ" : slot.label,
      };
    });
    const hasCompanyLogoSlot = headerSlots.some((slot) => slot.slotId === "company_logo");
    if (hasCompanyLogo && !hasCompanyLogoSlot) {
      headerSlots.push({ slotId: "company_logo", label: "会社ロゴ", kind: "image" });
    }
    if (hasCompanySlots) {
      const existing = new Set(headerSlots.map((slot) => slot.slotId));
      for (const slot of companySlotDefs) {
        if (!existing.has(slot.slotId)) {
          headerSlots.push({ ...slot });
        }
      }
    }
    nextSlotSchema = headerSlots !== slotSchema.header ? { ...slotSchema, header: headerSlots } : slotSchema;
  }
  return {
    ...clone,
    elements: canonicalized,
    ...(nextSlotSchema ? { slotSchema: nextSlotSchema } : {}),
  };
};

const hashStringFNV1a = (input: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
};

const sha256Hex = async (input: string): Promise<string | null> => {
  if (typeof crypto === "undefined" || !crypto.subtle) return null;
  try {
    const data = new TextEncoder().encode(input);
    const hash = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return null;
  }
};

const canonicalizeTemplateForFingerprint = (template: TemplateDefinition) => ({
  schemaVersion: template.schemaVersion ?? null,
  pageSize: template.pageSize ?? null,
  orientation: template.orientation ?? null,
  structureType: template.structureType ?? null,
  settings: template.settings ?? null,
  regionBounds: template.regionBounds ?? null,
  slotSchema: (template as any).slotSchema ?? null,
  footerRepeatMode: (template as any).footerRepeatMode ?? null,
  footerReserveHeight: (template as any).footerReserveHeight ?? null,
  elements: Array.isArray(template.elements) ? template.elements : null,
  mapping: (template as any).mapping ?? null,
  sheetSettings:
    template.structureType === "label_v1"
      ? (template as any).sheetSettings ?? null
      : null,
});

const buildTemplateFingerprint = async (template: TemplateDefinition) => {
  const normalized = canonicalizeTemplateForStorage(template);
  const canonical = canonicalizeTemplateForFingerprint(normalized);
  const json = stableStringify(canonical);
  const hash = await sha256Hex(json);
  return {
    jsonLen: json.length,
    elements: Array.isArray(template.elements) ? template.elements.length : 0,
    hash: hash ?? hashStringFNV1a(json),
    hashType: hash ? "sha256" : "fnv1a",
  };
};

const getTemplatePageInfo = (template: TemplateDefinition) => {
  if (template.structureType === "label_v1") {
    const sheet = template.sheetSettings ?? {
      paperWidthMm: 210,
      paperHeightMm: 297,
    };
    const mmToPt = (mm: number) => mm * (72 / 25.4);
    return { width: mmToPt(sheet.paperWidthMm), height: mmToPt(sheet.paperHeightMm) };
  }
  return getPageDimensions(template.pageSize ?? "A4", template.orientation ?? "portrait");
};

const applyCompanyProfileToTemplate = (
  template: TemplateDefinition,
  profile?: CompanyProfile,
): TemplateDefinition => {
  const companyEnabled = template.settings?.companyBlock?.enabled !== false;
  const normalized = normalizeCompanyProfile(profile);
  const hasProfile =
    normalized.companyName ||
    normalized.companyAddress ||
    normalized.companyTel ||
    normalized.companyEmail;
  if (companyEnabled && !hasProfile) return template;

  const slotValues: Record<string, string> = {
    company_name: normalized.companyName,
    company_address: normalized.companyAddress,
    company_tel: normalized.companyTel,
    company_email: normalized.companyEmail,
  };

  let changed = false;
  const nextElements = template.elements.map((el) => {
    const slotId = (el as any).slotId as string | undefined;
    if (!slotId || !slotId.startsWith('company_')) return el;
    if (el.type !== 'text') return el;

    if (!companyEnabled) {
      if ((el as any).hidden) return el;
      changed = true;
      return { ...el, hidden: true } as TemplateElement;
    }

    const value = slotValues[slotId];
    if (value === undefined) return el;
    const nextDataSource = { type: 'static', value } as const;
    const needsUpdate =
      (el as any).hidden ||
      !el.dataSource ||
      el.dataSource.type !== 'static' ||
      el.dataSource.value !== value;
    if (!needsUpdate) return el;
    changed = true;
    return {
      ...el,
      hidden: false,
      dataSource: nextDataSource,
    } as TemplateElement;
  });

  return changed ? { ...template, elements: nextElements } : template;
};

const hasNonAscii = (text: string) => /[^\u0000-\u007F]/.test(text);

const containsNonAsciiValue = (value: unknown, seen = new WeakSet<object>()): boolean => {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return hasNonAscii(value);
  if (typeof value === "number" || typeof value === "boolean") return false;
  if (value instanceof Date) return hasNonAscii(value.toISOString());

  if (Array.isArray(value)) {
    for (const item of value) {
      if (containsNonAsciiValue(item, seen)) return true;
    }
    return false;
  }

  if (typeof value === "object") {
    if (seen.has(value as object)) return false;
    seen.add(value as object);
    for (const v of Object.values(value as Record<string, unknown>)) {
      if (containsNonAsciiValue(v, seen)) return true;
    }
  }
  return false;
};

const templateHasNonAscii = (template: TemplateDefinition): boolean => {
  for (const element of template.elements) {
    if (typeof (element as any).text === "string" && hasNonAscii((element as any).text)) {
      return true;
    }
    if (element.dataSource?.type === "static" && typeof element.dataSource.value === "string") {
      if (hasNonAscii(element.dataSource.value)) return true;
    }
    if (element.type === "table") {
      const table = element as TableElement;
      for (const col of table.columns ?? []) {
        if (typeof col.title === "string" && hasNonAscii(col.title)) return true;
      }
      const summaryRows = table.summary?.rows ?? [];
      for (const row of summaryRows) {
        if (typeof row.label === "string" && hasNonAscii(row.label)) return true;
        if (typeof row.labelSubtotal === "string" && hasNonAscii(row.labelSubtotal)) return true;
        if (typeof row.labelTotal === "string" && hasNonAscii(row.labelTotal)) return true;
      }
    }
  }
  return false;
};

const collectTemplateTextCandidates = (
  template: TemplateDefinition,
  previewMode: "record" | "fieldCode",
): string[] => {
  const texts: string[] = [];
  for (const element of template.elements) {
    if (typeof (element as any).text === "string") {
      texts.push((element as any).text);
    }
    if (element.dataSource?.type === "static" && typeof element.dataSource.value === "string") {
      texts.push(element.dataSource.value);
    }
    if (previewMode === "fieldCode" && element.dataSource?.type === "kintone") {
      if (typeof element.dataSource.fieldCode === "string") {
        texts.push(element.dataSource.fieldCode);
        texts.push(`{{${element.dataSource.fieldCode}}}`);
      }
    }
    if (element.type === "table") {
      const table = element as TableElement;
      for (const col of table.columns ?? []) {
        if (typeof col.title === "string") texts.push(col.title);
        if (previewMode === "fieldCode" && typeof col.fieldCode === "string") {
          texts.push(col.fieldCode);
          texts.push(`{{${col.fieldCode}}}`);
        }
      }
      const summaryRows = table.summary?.rows ?? [];
      for (const row of summaryRows) {
        if (typeof row.label === "string") texts.push(row.label);
        if (typeof row.labelSubtotal === "string") texts.push(row.labelSubtotal);
        if (typeof row.labelTotal === "string") texts.push(row.labelTotal);
      }
    }
  }
  return texts;
};

const shouldUseJpFont = (
  template: TemplateDefinition,
  data: unknown,
  renderMode: RenderMode,
  previewMode: "record" | "fieldCode",
  companyProfile?: CompanyProfile,
): boolean => {
  if (renderMode === "layout") return false;
  if (templateHasNonAscii(template)) return true;
  for (const text of collectTemplateTextCandidates(template, previewMode)) {
    if (hasNonAscii(text)) return true;
  }
  if (companyProfile) {
    const companyTexts = [
      companyProfile.companyName,
      companyProfile.companyAddress,
      companyProfile.companyTel,
      companyProfile.companyEmail,
    ].filter((v): v is string => typeof v === "string");
    if (companyTexts.some((t) => hasNonAscii(t))) return true;
  }
  if (containsNonAsciiValue(data)) return true;
  return false;
};

// フォント読み込み（今はデフォルト埋め込みフォントだけ）
async function loadFonts(
  env: Env,
  options?: { requireJp?: boolean },
): Promise<{ jp: Uint8Array | null; latin: Uint8Array | null }> {
  return getFonts(env, options);
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

const requireUserTemplateToken = async (
  request: Request,
  env: Env,
): Promise<{ tenantId: string; record: { kintoneBaseUrl: string; appId: string; kintoneApiToken?: string } } | { error: Response }> => {
  const authHeader = request.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) {
    console.log("[auth] missing bearer");
    return {
      error: new Response("Missing Authorization", {
        status: 401,
        headers: CORS_HEADERS,
      }),
    };
  }

  const verified = await verifyEditorToken(env.USER_TEMPLATES_KV, token);
  if (verified) return verified;

  if (!env.SESSIONS_KV) {
    return {
      error: new Response("SESSIONS_KV is required", {
        status: 500,
        headers: CORS_HEADERS,
      }),
    };
  }

  const key = `editor_session:${token}`;
  const raw = await env.SESSIONS_KV.get(key);
  if (!raw) {
    console.log("[auth] invalid session");
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
    console.log("[auth] invalid session");
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
    console.log("[auth] invalid session");
    return {
      error: new Response("Invalid session payload", {
        status: 401,
        headers: CORS_HEADERS,
      }),
    };
  }

  if (!session?.expiresAt || Date.now() > session.expiresAt) {
    console.log("[auth] expired session");
    return {
      error: new Response("Session expired", {
        status: 401,
        headers: CORS_HEADERS,
      }),
    };
  }

  let tenantId = "";
  try {
    tenantId = buildTenantKey(kintoneBaseUrl, appId);
  } catch {
    console.log("[auth] invalid session");
    return {
      error: new Response("Invalid session payload", {
        status: 401,
        headers: CORS_HEADERS,
      }),
    };
  }

  return {
    tenantId,
    record: {
      kintoneBaseUrl,
      appId,
      kintoneApiToken: session.kintoneApiToken,
    },
  };
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
    companyProfile?: CompanyProfile;
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

  let session: {
    kintoneBaseUrl?: string;
    appId?: string;
    expiresAt?: number;
    kintoneApiToken?: string;
    companyProfile?: CompanyProfile;
  };
  try {
    session = JSON.parse(raw) as {
      kintoneBaseUrl?: string;
      appId?: string;
      expiresAt?: number;
      kintoneApiToken?: string;
      companyProfile?: CompanyProfile;
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

const buildSessionFieldsKey = (token: string) => `editor_session_fields:${token}`;

const jsonError = (status: number, payload: Record<string, unknown>) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json",
    },
  });

const resolveTenantKeyFromQuery = (url: URL): { tenantKey: string; error?: Response } => {
  const kintoneBaseUrl = url.searchParams.get("kintoneBaseUrl") ?? "";
  const appId = url.searchParams.get("appId") ?? "";
  if (!kintoneBaseUrl || !appId) {
    return {
      tenantKey: "",
      error: jsonError(400, {
        error: "BAD_REQUEST",
        reason: "missing kintone.baseUrl or kintone.appId",
      }),
    };
  }
  try {
    return { tenantKey: buildTenantKey(kintoneBaseUrl, appId) };
  } catch {
    return {
      tenantKey: "",
      error: jsonError(400, {
        error: "BAD_REQUEST",
        reason: "invalid kintone.baseUrl or kintone.appId",
      }),
    };
  }
};

const resolveTenantLogoAuth = async (
  request: Request,
  env: Env,
  url: URL,
): Promise<
  | {
      tenantKeyResolved: string;
      tenantKeyQuery: string;
      authMode: "admin" | "bearer";
      hasApiKey: boolean;
      hasBearer: boolean;
    }
  | { error: Response }
> => {
  const authHeader = request.headers.get("Authorization") ?? "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const hasBearer = Boolean(bearerToken);
  const apiKeyHeader = request.headers.get("x-api-key") ?? "";
  const hasApiKey = env.ADMIN_API_KEY ? apiKeyHeader === env.ADMIN_API_KEY : Boolean(apiKeyHeader);

  if (hasBearer) {
    const verified = await verifyEditorToken(env.USER_TEMPLATES_KV, bearerToken);
    if (!verified) {
      console.info("[DBG_TENANT_LOGO_AUTH]", {
        hasApiKey,
        hasBearer,
        authMode: "bearer",
        tenantKeyResolved: null,
        tenantKeyQuery: null,
        ok: false,
      });
      return {
        error: jsonError(401, { error: "UNAUTHORIZED", reason: "missing token or invalid" }),
      };
    }
    const queryParamsPresent =
      url.searchParams.has("kintoneBaseUrl") || url.searchParams.has("appId");
    const queryResult = resolveTenantKeyFromQuery(url);
    if (queryResult.error && queryParamsPresent) {
      console.info("[DBG_TENANT_LOGO_AUTH]", {
        hasApiKey,
        hasBearer,
        authMode: "bearer",
        tenantKeyResolved: verified.tenantId,
        tenantKeyQuery: null,
        ok: false,
      });
      return { error: queryResult.error };
    }
    const tenantKeyQuery = queryResult.error ? "" : queryResult.tenantKey;
    if (tenantKeyQuery && tenantKeyQuery !== verified.tenantId) {
      console.info("[DBG_TENANT_LOGO_AUTH]", {
        hasApiKey,
        hasBearer,
        authMode: "bearer",
        tenantKeyResolved: verified.tenantId,
        tenantKeyQuery,
        ok: false,
      });
      return {
        error: jsonError(403, { error: "FORBIDDEN", reason: "tenant mismatch" }),
      };
    }
    console.info("[DBG_TENANT_LOGO_AUTH]", {
      hasApiKey,
      hasBearer,
      authMode: "bearer",
      tenantKeyResolved: verified.tenantId,
      tenantKeyQuery,
      ok: true,
    });
    return {
      tenantKeyResolved: verified.tenantId,
      tenantKeyQuery,
      authMode: "bearer",
      hasApiKey,
      hasBearer,
    };
  }

  if (env.ADMIN_API_KEY && !hasApiKey) {
    console.info("[DBG_TENANT_LOGO_AUTH]", {
      hasApiKey,
      hasBearer,
      authMode: "admin",
      tenantKeyResolved: null,
      tenantKeyQuery: null,
      ok: false,
    });
    return {
      error: jsonError(401, { error: "UNAUTHORIZED", reason: "missing token or invalid" }),
    };
  }

  const queryResult = resolveTenantKeyFromQuery(url);
  if (queryResult.error) {
    console.info("[DBG_TENANT_LOGO_AUTH]", {
      hasApiKey,
      hasBearer,
      authMode: "admin",
      tenantKeyResolved: null,
      tenantKeyQuery: null,
      ok: false,
    });
    return { error: queryResult.error };
  }

  console.info("[DBG_TENANT_LOGO_AUTH]", {
    hasApiKey,
    hasBearer,
    authMode: "admin",
    tenantKeyResolved: queryResult.tenantKey,
    tenantKeyQuery: queryResult.tenantKey,
    ok: true,
  });

  return {
    tenantKeyResolved: queryResult.tenantKey,
    tenantKeyQuery: queryResult.tenantKey,
    authMode: "admin",
    hasApiKey,
    hasBearer,
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

const resolveRenderMode = (
  input: unknown,
  previewMode: "record" | "fieldCode",
): RenderMode => {
  if (input === "layout" || input === "preview" || input === "final") {
    return input;
  }
  return previewMode === "fieldCode" ? "preview" : "final";
};

 // templateId から TemplateDefinition を引く関数
 
const TEMPLATE_IDS = new Set([
  "list_v1",
  "estimate_v1",
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
    { slotId: "company_logo", label: "会社ロゴ", kind: "image" as const },
  ],
  footer: [
    { slotId: "remarks", label: "備考", kind: "text" as const },
    { slotId: "total_label", label: "合計ラベル", kind: "text" as const },
    { slotId: "total", label: "合計", kind: "number" as const },
  ],
};
const SLOT_SCHEMA_ESTIMATE_V1 = {
  header: [
    { slotId: "doc_title", label: "タイトル", kind: "text" as const },
    { slotId: "to_name", label: "宛先名", kind: "text" as const, required: true },
    { slotId: "to_honorific", label: "敬称", kind: "text" as const },
    { slotId: "doc_no_label", label: "見積番号ラベル", kind: "text" as const },
    { slotId: "date_label", label: "日付ラベル", kind: "text" as const },
    { slotId: "issue_date", label: "発行日", kind: "date" as const, required: true },
    { slotId: "doc_no", label: "見積番号", kind: "text" as const },
    { slotId: "company_logo", label: "会社ロゴ", kind: "image" as const },
  ],
  footer: [
    { slotId: "remarks", label: "備考", kind: "text" as const },
    { slotId: "subtotal", label: "小計", kind: "number" as const },
    { slotId: "tax", label: "税", kind: "number" as const },
    { slotId: "total", label: "合計", kind: "number" as const, required: true },
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
    templateId: "estimate_v1",
    displayName: "見積書（固定）",
    structureType: "estimate_v1",
    description: "見積書専用の固定レイアウトテンプレ",
    version: 1,
    flags: [] as string[],
    slotSchema: SLOT_SCHEMA_ESTIMATE_V1,
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

const pickDocMeta = (template?: TemplateDefinition | null) => {
  if (!template || !Array.isArray(template.elements)) return [];
  return template.elements
    .filter((el) => {
      const slotId = (el as any).slotId as string | undefined;
      return (
        ["doc_no_label", "date_label"].includes(el.id) ||
        (slotId ? ["doc_no_label", "date_label"].includes(slotId) : false)
      );
    })
    .map((el) => ({
      id: el.id,
      slotId: (el as any).slotId ?? null,
      x: (el as any).x,
      y: (el as any).y,
      region: el.region ?? null,
    }));
};

const getUserTemplateById = async (
  templateId: string,
  env: Env,
  tenantKey: string,
  debug?: { enabled?: boolean; requestId?: string; path?: string },
): Promise<TemplateDefinition | null> => {
  const key = buildUserTemplateKey(tenantKey, templateId);
  const raw = await env.USER_TEMPLATES_KV.get(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as any;
    if (debug?.enabled) {
      console.info("[DBG_FETCH_DOCMETA]", {
        requestId: debug.requestId ?? null,
        path: debug.path ?? null,
        templateId,
        elements: pickDocMeta(parsed as TemplateDefinition),
      });
    }
    if (parsed && Array.isArray(parsed.elements)) {
      return applyEstimateV1PresetPatch(parsed as TemplateDefinition);
    }
    if (parsed?.baseTemplateId) {
      const baseTemplate = await getBaseTemplateById(parsed.baseTemplateId, env);
      const mapped =
        baseTemplate.structureType === "cards_v1" ||
        parsed.baseTemplateId === "cards_v1" ||
        parsed.baseTemplateId === "cards_v2"
          ? applyCardsV1MappingToTemplate(baseTemplate, parsed.mapping)
          : baseTemplate.structureType === "estimate_v1" || parsed.baseTemplateId === "estimate_v1"
          ? applyEstimateV1MappingToTemplate(baseTemplate, parsed.mapping)
          : baseTemplate.structureType === "list_v1" || parsed.baseTemplateId === "list_v1"
          ? applyListV1MappingToTemplate(baseTemplate, parsed.mapping)
          : { ...baseTemplate, mapping: parsed.mapping };
      const layoutApplied = applySlotLayoutOverrides(mapped, parsed.overrides?.layout);
      const dataApplied = applySlotDataOverrides(layoutApplied, parsed.overrides?.slots);
      const reconstructed: TemplateDefinition = {
        ...dataApplied,
        id: templateId,
        name: parsed.meta?.name ?? dataApplied.name,
        baseTemplateId: parsed.baseTemplateId,
        sheetSettings: parsed.sheetSettings ?? dataApplied.sheetSettings,
        settings: parsed.settings ?? dataApplied.settings,
      };
      return applyEstimateV1PresetPatch(reconstructed);
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
  if (structure !== "list_v1" && structure !== "estimate_v1") return template;
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
  debug?: { enabled?: boolean; requestId?: string; path?: string },
): Promise<TemplateDefinition> => {
  const baseUrl = kintone?.baseUrl;
  const appId = kintone?.appId;
  if (!baseUrl || !appId) {
    throw new Error("Missing kintone.baseUrl or kintone.appId for user template");
  }

  const tenantKey = buildTenantKey(baseUrl, appId);
  await ensureUserTemplateActive(env, tenantKey, templateId);
  const userTemplate = await getUserTemplateById(templateId, env, tenantKey, debug);
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
      const requestId = typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `req_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
      const { debugFromQuery, debugFromHash, debugEffective } = parseDebugFlags(url);
      const debugEnabled = debugEffective;

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

        let payload: {
          kintoneBaseUrl?: string;
          appId?: string;
          kintoneApiToken?: string;
          companyProfile?: CompanyProfile;
        };
        try {
          payload = (await request.json()) as {
            kintoneBaseUrl?: string;
            appId?: string;
            kintoneApiToken?: string;
            companyProfile?: CompanyProfile;
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
        const expiresAt = Date.now() + SESSION_TTL_SECONDS * 1000;
        const key = `editor_session:${sessionToken}`;
        const value = JSON.stringify({
          kintoneBaseUrl,
          appId,
          expiresAt,
          kintoneApiToken: payload.kintoneApiToken,
          companyProfile: normalizeCompanyProfile(payload.companyProfile),
        });
        await env.SESSIONS_KV.put(key, value, { expirationTtl: SESSION_TTL_SECONDS });

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
        let tenantProfile: CompanyProfile | undefined;
        try {
          const baseUrl = canonicalizeKintoneBaseUrl(session.kintoneBaseUrl);
          const appId = canonicalizeAppId(session.appId);
          if (appId) {
            const tenantId = buildTenantKey(baseUrl, appId);
            const record = await getTenantRecord(env.USER_TEMPLATES_KV, tenantId);
            tenantProfile = record?.companyProfile;
          }
        } catch {
          tenantProfile = undefined;
        }

        return new Response(
          JSON.stringify({
            ok: true,
            kintoneBaseUrl: session.kintoneBaseUrl ?? "",
            appId: session.appId ?? "",
            companyProfile: normalizeCompanyProfile(tenantProfile ?? session.companyProfile),
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

        let payload: { token?: string; kintoneApiToken?: string };
        try {
          payload = (await request.json()) as { token?: string; kintoneApiToken?: string };
        } catch {
          return new Response("Invalid JSON body", {
            status: 400,
            headers: CORS_HEADERS,
          });
        }

        const token = payload?.token ?? "";
        console.info("[editor/session] exchange payload", {
          hasKintoneApiToken: Boolean(payload?.kintoneApiToken),
          tokenLength: payload?.kintoneApiToken?.length ?? 0,
        });
        const loaded = await loadEditorSession(env, token);
        if ("error" in loaded) return loaded.error;

        const session = loaded.session;
        const incomingToken = payload?.kintoneApiToken?.trim() ?? "";
        if (incomingToken && incomingToken !== session.kintoneApiToken) {
          const key = `editor_session:${token}`;
          const ttlSeconds = Math.max(
            1,
            Math.floor((session.expiresAt - Date.now()) / 1000),
          );
          await env.SESSIONS_KV.put(
            key,
            JSON.stringify({ ...session, kintoneApiToken: incomingToken }),
            { expirationTtl: ttlSeconds },
          );
          session.kintoneApiToken = incomingToken;
        }
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
            companyProfile: normalizeCompanyProfile(record.companyProfile ?? session.companyProfile),
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

      if (url.pathname === "/session/refresh") {
        if (request.method !== "POST") {
          return new Response("Method Not Allowed", {
            status: 405,
            headers: CORS_HEADERS,
          });
        }

        const authHeader = request.headers.get("Authorization") ?? "";
        const headerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
        const queryToken = url.searchParams.get("sessionToken") ?? "";
        let payload: { sessionToken?: string } | undefined;
        try {
          payload = (await request.json()) as { sessionToken?: string };
        } catch {
          payload = undefined;
        }
        const sessionToken = headerToken || payload?.sessionToken || queryToken;
        const jsonResponse = (status: number, body: Record<string, unknown>) =>
          new Response(JSON.stringify(body), {
            status,
            headers: {
              ...CORS_HEADERS,
              "Content-Type": "application/json",
              "Cache-Control": "no-store",
            },
          });

        if (!sessionToken) {
          return jsonResponse(401, {
            ok: false,
            error_code: "INVALID_SESSION_TOKEN",
            message: "Missing session token",
          });
        }

        const loaded = await loadEditorSession(env, sessionToken);
        if ("error" in loaded) {
          return jsonResponse(401, {
            ok: false,
            error_code: "INVALID_SESSION_TOKEN",
            message: "Invalid session token",
          });
        }

        const session = loaded.session;
        const expiresAt = Date.now() + SESSION_TTL_SECONDS * 1000;
        const key = `editor_session:${sessionToken}`;
        await env.SESSIONS_KV.put(
          key,
          JSON.stringify({
            kintoneBaseUrl: session.kintoneBaseUrl,
            appId: session.appId,
            expiresAt,
            kintoneApiToken: session.kintoneApiToken,
            companyProfile: normalizeCompanyProfile(session.companyProfile),
          }),
          { expirationTtl: SESSION_TTL_SECONDS },
        );

        const fieldsKey = buildSessionFieldsKey(sessionToken);
        const fieldsRaw = await env.SESSIONS_KV.get(fieldsKey);
        if (fieldsRaw) {
          await env.SESSIONS_KV.put(fieldsKey, fieldsRaw, {
            expirationTtl: SESSION_TTL_SECONDS,
          });
        }

        return jsonResponse(200, { ok: true, expiresAt });
      }

      if (url.pathname === "/session/fields" || url.pathname === "/editor/session/fields") {
        const authHeader = request.headers.get("Authorization") ?? "";
        const headerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
        const queryToken = url.searchParams.get("sessionToken") ?? "";

        const jsonResponse = (status: number, body: Record<string, unknown>) =>
          new Response(JSON.stringify(body), {
            status,
            headers: {
              ...CORS_HEADERS,
              "Content-Type": "application/json",
              "Cache-Control": "no-store",
            },
          });

        if (request.method === "POST") {
          let payload: {
            sessionToken?: string;
            kintoneBaseUrl?: string;
            appId?: string;
            fields?: unknown;
            errorCode?: string;
            message?: string;
            fetchedAt?: string;
            pluginId?: string;
          };
          try {
            payload = (await request.json()) as {
              sessionToken?: string;
              kintoneBaseUrl?: string;
              appId?: string;
              fields?: unknown;
              errorCode?: string;
              message?: string;
              fetchedAt?: string;
              pluginId?: string;
            };
          } catch {
            return jsonResponse(400, {
              ok: false,
              error_code: "INVALID_SESSION_TOKEN",
              message: "Invalid JSON body",
            });
          }

          const sessionToken = headerToken || payload?.sessionToken || queryToken;
          if (!sessionToken) {
            console.log("[session/fields]", "POST", "", payload?.appId ?? "", payload?.kintoneBaseUrl ?? "", "INVALID_SESSION_TOKEN");
            return jsonResponse(401, {
              ok: false,
              error_code: "INVALID_SESSION_TOKEN",
              message: "Missing session token",
            });
          }

          const loaded = await loadEditorSession(env, sessionToken);
          if ("error" in loaded) {
            console.log("[session/fields]", "POST", sessionToken.slice(0, 8), payload?.appId ?? "", payload?.kintoneBaseUrl ?? "", "INVALID_SESSION_TOKEN");
            return jsonResponse(401, {
              ok: false,
              error_code: "INVALID_SESSION_TOKEN",
              message: "Invalid session token",
            });
          }

          const session = loaded.session;
          const expectedBaseUrl = session.kintoneBaseUrl;
          const expectedAppId = session.appId;
          const payloadBaseUrl = payload?.kintoneBaseUrl ?? expectedBaseUrl;
          const payloadAppId = payload?.appId ?? expectedAppId;
          if (payloadBaseUrl !== expectedBaseUrl || String(payloadAppId) !== String(expectedAppId)) {
            console.log("[session/fields]", "POST", sessionToken.slice(0, 8), payloadAppId, payloadBaseUrl, "INVALID_SESSION_TOKEN");
            return jsonResponse(400, {
              ok: false,
              error_code: "INVALID_SESSION_TOKEN",
              message: "Session does not match app context",
            });
          }

          const fields = Array.isArray(payload?.fields) ? payload?.fields : [];
          const key = buildSessionFieldsKey(sessionToken);
          const resultErrorCode = payload?.errorCode ?? null;
          await env.SESSIONS_KV.put(
            key,
            JSON.stringify({
              ok: resultErrorCode ? false : true,
              fields,
              kintoneBaseUrl: expectedBaseUrl,
              appId: expectedAppId,
              fetchedAt: payload?.fetchedAt ?? new Date().toISOString(),
              error_code: resultErrorCode,
              message: payload?.message ?? null,
              pluginId: payload?.pluginId ?? null,
            }),
            { expirationTtl: SESSION_TTL_SECONDS },
          );

          console.log(
            "[session/fields]",
            "POST",
            sessionToken.slice(0, 8),
            expectedAppId,
            expectedBaseUrl,
            resultErrorCode ?? "OK",
          );

          return jsonResponse(200, { ok: true });
        }

        if (request.method === "GET") {
          const sessionToken = headerToken || queryToken;
          if (!sessionToken) {
            console.log("[session/fields]", "GET", "", "", "", "INVALID_SESSION_TOKEN");
            return jsonResponse(401, {
              ok: false,
              error_code: "INVALID_SESSION_TOKEN",
              message: "Missing session token",
            });
          }

          const loaded = await loadEditorSession(env, sessionToken);
          if ("error" in loaded) {
            console.log("[session/fields]", "GET", sessionToken.slice(0, 8), "", "", "INVALID_SESSION_TOKEN");
            return jsonResponse(401, {
              ok: false,
              error_code: "INVALID_SESSION_TOKEN",
              message: "Invalid session token",
            });
          }

          const key = buildSessionFieldsKey(sessionToken);
          const raw = await env.SESSIONS_KV.get(key);
          if (!raw) {
            console.log(
              "[session/fields]",
              "GET",
              sessionToken.slice(0, 8),
              loaded.session.appId,
              loaded.session.kintoneBaseUrl,
              "MISSING_SESSION_FIELDS",
            );
            return jsonResponse(404, {
              ok: false,
              error_code: "MISSING_SESSION_FIELDS",
              message: "Missing session fields",
            });
          }

          let payload: Record<string, unknown>;
          try {
            payload = JSON.parse(raw) as Record<string, unknown>;
          } catch {
            payload = {};
          }

          const resultCode =
            (payload?.error_code as string | null | undefined) ?? "OK";
          console.log(
            "[session/fields]",
            "GET",
            sessionToken.slice(0, 8),
            payload?.appId ?? loaded.session.appId,
            payload?.kintoneBaseUrl ?? loaded.session.kintoneBaseUrl,
            resultCode,
          );

          return jsonResponse(200, {
            ok: payload?.ok !== false,
            fields: payload?.fields ?? [],
            kintoneBaseUrl: payload?.kintoneBaseUrl ?? loaded.session.kintoneBaseUrl,
            appId: payload?.appId ?? loaded.session.appId,
            fetchedAt: payload?.fetchedAt ?? null,
            error_code: payload?.error_code ?? null,
            message: payload?.message ?? null,
          });
        }

        return jsonResponse(405, {
          ok: false,
          error_code: "INVALID_SESSION_TOKEN",
          message: "Method Not Allowed",
        });
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

      if (url.pathname === "/tenant/logo") {
        const authResolved = await resolveTenantLogoAuth(request, env, url);
        if ("error" in authResolved) {
          return authResolved.error;
        }
        const tenantKey = authResolved.tenantKeyResolved;

        if (request.method === "GET") {
          if (!env.TENANT_ASSETS) {
            return new Response("Tenant assets bucket not configured", {
              status: 500,
              headers: CORS_HEADERS,
            });
          }
          const record = await getTenantRecord(env.USER_TEMPLATES_KV, tenantKey);
          if (!record?.logo) {
            return new Response("Logo not set", {
              status: 404,
              headers: CORS_HEADERS,
            });
          }
          const logo = await getTenantLogoBytes(env, tenantKey, record.logo);
          if (!logo) {
            return new Response("Logo not found", {
              status: 404,
              headers: CORS_HEADERS,
            });
          }
          return new Response(logo.bytes, {
            status: 200,
            headers: {
              ...CORS_HEADERS,
              "Content-Type": logo.contentType,
              "Cache-Control": "no-store",
            },
          });
        }
        if (request.method === "DELETE") {
          if (!env.TENANT_ASSETS) {
            return new Response("Tenant assets bucket not configured", {
              status: 500,
              headers: CORS_HEADERS,
            });
          }
          const record = await getTenantRecord(env.USER_TEMPLATES_KV, tenantKey);
          if (record?.logo?.objectKey) {
            try {
              await env.TENANT_ASSETS.delete(record.logo.objectKey);
              const cacheKey = new Request(`https://tenant-assets/${record.logo.objectKey}`);
              await caches.default.delete(cacheKey);
            } catch {
              // ignore R2/cache delete failure
            }
          }
          const updated = await deleteTenantLogo(env.USER_TEMPLATES_KV, tenantKey);
          if (!updated) {
            return new Response("Tenant not found", {
              status: 400,
              headers: CORS_HEADERS,
            });
          }
          return new Response(
            JSON.stringify({ ok: true, logo: null }),
            {
              status: 200,
              headers: {
                ...CORS_HEADERS,
                "Content-Type": "application/json",
              },
            },
          );
        }
        if (request.method !== "PUT") {
          return new Response("Method Not Allowed", {
            status: 405,
            headers: CORS_HEADERS,
          });
        }
        if (!env.TENANT_ASSETS) {
          return new Response("Tenant assets bucket not configured", {
            status: 500,
            headers: CORS_HEADERS,
          });
        }

        let form: FormData;
        try {
          form = await request.formData();
        } catch {
          return new Response("Invalid form data", {
            status: 400,
            headers: CORS_HEADERS,
          });
        }

        const file = form.get("file") ?? form.get("logo");
        if (!(file instanceof File)) {
          return new Response("Missing logo file", {
            status: 400,
            headers: CORS_HEADERS,
          });
        }
        const contentType = String(file.type ?? "").toLowerCase();
        if (!isValidLogoContentType(contentType)) {
          return new Response("Unsupported image type", {
            status: 400,
            headers: CORS_HEADERS,
          });
        }
        if (file.size > LOGO_MAX_UPLOAD_BYTES) {
          return new Response("Image too large (max 2MB)", {
            status: 413,
            headers: CORS_HEADERS,
          });
        }

        const normalizedContentType = normalizeLogoContentType(contentType);
        const objectKey = buildTenantLogoKey(
          tenantKey,
          resolveLogoExtension(normalizedContentType),
        );
        const buf = await file.arrayBuffer();
        if (buf.byteLength > LOGO_MAX_STORED_BYTES) {
          return new Response("Image too large after normalization (max 300KB)", {
            status: 413,
            headers: CORS_HEADERS,
          });
        }
        await env.TENANT_ASSETS.put(objectKey, buf, {
          httpMetadata: { contentType: normalizedContentType },
        });
        const updatedAt = new Date().toISOString();
        const updated = await updateTenantLogo(env.USER_TEMPLATES_KV, tenantKey, {
          objectKey,
          contentType: normalizedContentType,
          updatedAt,
        });
        if (!updated) {
          return new Response("Tenant not found", {
            status: 400,
            headers: CORS_HEADERS,
          });
        }

        return new Response(
          JSON.stringify({
            ok: true,
            logo: updated.logo,
            contentType: normalizedContentType,
            bytesLen: buf.byteLength,
            width: null,
            height: null,
            updatedAt,
          }),
          {
            status: 200,
            headers: {
              ...CORS_HEADERS,
              "Content-Type": "application/json",
            },
          },
        );
      }

      if (url.pathname === "/tenant/settings") {
        if (request.method === "GET") {
          const tenant = getTenantContext(url);
          if ("error" in tenant) return tenant.error;
          const record = await getTenantRecord(env.USER_TEMPLATES_KV, tenant.tenantKey);
          if (!record) {
            return new Response("Tenant not found", {
              status: 400,
              headers: CORS_HEADERS,
            });
          }
          return new Response(
            JSON.stringify({
              ok: true,
              tenantId: record.tenantId,
              companyProfile: normalizeCompanyProfile(record.companyProfile),
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

        if (request.method !== "PUT") {
          return new Response("Method Not Allowed", {
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

        const tenant = getTenantContext(url);
        if ("error" in tenant) return tenant.error;

        let payload: CompanyProfile | undefined;
        try {
          payload = (await request.json()) as CompanyProfile;
        } catch {
          return new Response("Invalid JSON body", {
            status: 400,
            headers: CORS_HEADERS,
          });
        }

        const normalizedProfile = normalizeCompanyProfile(payload);
        const updated = await updateTenantSettings(
          env.USER_TEMPLATES_KV,
          tenant.tenantKey,
          normalizedProfile,
        );
        if (!updated) {
          return new Response("Tenant not found", {
            status: 400,
            headers: CORS_HEADERS,
          });
        }

        return new Response(
          JSON.stringify({ ok: true, companyProfile: normalizeCompanyProfile(updated.companyProfile) }),
          {
            status: 200,
            headers: {
              ...CORS_HEADERS,
              "Content-Type": "application/json",
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
            const auth = await requireUserTemplateToken(request, env);
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
            if (debugEnabled) {
              const fingerprint = await buildTemplateFingerprint(templateBody);
              const dims = getTemplatePageInfo(templateBody);
              const key = buildUserTemplateKey(auth.tenantId, templateId);
              const updatedAt = (templateBody as any).updatedAt ?? (templateBody as any).meta?.updatedAt ?? "";
              const revision = (templateBody as any).revision ?? "";
              console.info(
                `[DBG_FETCH_TEMPLATE] requestId=${requestId ?? ""} path=${url.pathname} store=USER_TEMPLATES_KV ` +
                  `key=${key} templateId=${templateId} pageSize=${templateBody.pageSize} ` +
                  `w=${dims.width} h=${dims.height} elements=${fingerprint.elements} ` +
                  `jsonLen=${fingerprint.jsonLen} hash=${fingerprint.hash} hashType=${fingerprint.hashType} ` +
                  `updatedAt=${updatedAt} revision=${revision}`,
              );
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
          if (debugEnabled) {
            const fingerprint = await buildTemplateFingerprint(templateBody);
            const dims = getTemplatePageInfo(templateBody);
            const key = buildUserTemplateKey(tenant.tenantKey, templateId);
            const updatedAt = (templateBody as any).updatedAt ?? (templateBody as any).meta?.updatedAt ?? "";
            const revision = (templateBody as any).revision ?? "";
            console.info(
              `[DBG_FETCH_TEMPLATE] requestId=${requestId ?? ""} path=${url.pathname} store=USER_TEMPLATES_KV ` +
                `key=${key} templateId=${templateId} pageSize=${templateBody.pageSize} ` +
                `w=${dims.width} h=${dims.height} elements=${fingerprint.elements} ` +
                `jsonLen=${fingerprint.jsonLen} hash=${fingerprint.hash} hashType=${fingerprint.hashType} ` +
                `updatedAt=${updatedAt} revision=${revision}`,
            );
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

        const auth = await requireUserTemplateToken(request, env);
        if ("error" in auth) return auth.error;
        const key = buildUserTemplateKey(auth.tenantId, templateId);

        if (request.method === "PUT") {
          let rawPayload: unknown;
          let payload: UserTemplatePayload | null = null;
          let templateBody: TemplateDefinition | null = null;
          let draftTemplateObj: TemplateDefinition | null = null;
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
            draftTemplateObj = normalized.template;
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
                : baseTemplate.structureType === "estimate_v1" || baseTemplateId === "estimate_v1"
                ? applyEstimateV1MappingToTemplate(baseTemplate, payload?.mapping)
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
            draftTemplateObj = templateBody;
          }

          const canonicalDraft = canonicalizeTemplateForStorage(
            (draftTemplateObj ?? templateBody) as TemplateDefinition,
          );

          const nextName =
            payload?.meta?.name ||
            templateBody.name ||
            "名称未設定";

          const nextTemplate: TemplateDefinition = {
            ...canonicalDraft,
            id: templateId,
            name: nextName,
            baseTemplateId,
            sheetSettings: payload?.sheetSettings ?? templateBody.sheetSettings,
            settings: payload?.settings ?? templateBody.settings,
          };

          if (debugEnabled) {
            const draftObj = canonicalDraft;
            const storedObj = nextTemplate;
            const [draftFingerprint, storedFingerprint] = await Promise.all([
              buildTemplateFingerprint(draftObj),
              buildTemplateFingerprint(storedObj),
            ]);
            const DIFF_KEYS = [
              "x",
              "y",
              "width",
              "height",
              "fontSize",
              "lineHeight",
              "alignX",
              "align",
              "valign",
              "paddingX",
              "paddingY",
              "region",
              "type",
              "slotId",
              "dataSource",
              "style",
              "fitMode",
            ];
            const diffKeyCounts: Record<string, number> = {};
            const round3 = (value: unknown) => {
              if (typeof value !== "number" || !Number.isFinite(value)) return value;
              return Math.round(value * 1000) / 1000;
            };
            const normalizeValue = (value: unknown): unknown => {
              if (value === null || value === undefined) return value;
              if (typeof value === "number") return round3(value);
              if (typeof value !== "object") return value;
              if (Array.isArray(value)) return value.map(normalizeValue);
              const obj = value as Record<string, unknown>;
              const keys = Object.keys(obj).sort();
              const out: Record<string, unknown> = {};
              for (const key of keys) {
                out[key] = normalizeValue(obj[key]);
              }
              return out;
            };
            const readField = (obj: unknown, key: string) => {
              if (!obj || typeof obj !== "object") {
                return { present: false, value: undefined };
              }
              const has = Object.prototype.hasOwnProperty.call(obj, key);
              if (!has) return { present: false, value: undefined };
              return { present: true, value: (obj as any)[key] };
            };
            const representField = (obj: unknown, key: string) => {
              const { present, value } = readField(obj, key);
              if (!present) return "__MISSING__";
              if (value === undefined) return "__MISSING__";
              if (key === "slotId" && (value === null || value === undefined)) {
                return "__MISSING__";
              }
              return normalizeValue(value);
            };
            const compareField = (a: unknown, b: unknown) =>
              stableStringify(a) === stableStringify(b);
            const isTextLike = (el: TemplateElement | undefined) =>
              el?.type === "text" || el?.type === "label";
            const pickElement = (t: TemplateDefinition, targetId: string) =>
              t.elements?.find((e) => e.id === targetId) ??
              t.elements?.find((e) => (e as any).slotId === targetId);
            const pickElementId = (t: TemplateDefinition, id: string) =>
              pickElement(t, id)?.id ?? id;
            const toElemDiffEntry = (
              elementId: string,
              draftEl: TemplateElement | undefined,
              storedEl: TemplateElement | undefined,
            ) => {
              const draftFields: Record<string, unknown> = {};
              const storedFields: Record<string, unknown> = {};
              const changedKeys: string[] = [];
              const textLike = isTextLike(draftEl) || isTextLike(storedEl);
              for (const key of DIFF_KEYS) {
                if (!textLike) {
                  if (
                    key === "fontSize" ||
                    key === "lineHeight" ||
                    key === "alignX" ||
                    key === "align" ||
                    key === "valign" ||
                    key === "paddingX" ||
                    key === "paddingY" ||
                    key === "style"
                  ) {
                    continue;
                  }
                }
                const draftVal = representField(draftEl, key);
                const storedVal = representField(storedEl, key);
                draftFields[key] = draftVal;
                storedFields[key] = storedVal;
                if (!compareField(draftVal, storedVal)) changedKeys.push(key);
              }
              return { draftFields, storedFields, changedKeys };
            };
            const pickElementSample = (
              t: TemplateDefinition,
              targetId: string,
            ) => {
              const el =
                t.elements?.find((e) => e.id === targetId) ??
                t.elements?.find(
                  (e) => (e as any).slotId === targetId,
                );
              if (!el) return null;
              return {
                id: el.id ?? targetId,
                slotId: (el as any).slotId ?? null,
                type: el.type,
                x: (el as any).x ?? null,
                y: (el as any).y ?? null,
                width: (el as any).width ?? null,
                height: (el as any).height ?? null,
                fontSize: (el as any).fontSize ?? null,
                alignX: (el as any).alignX ?? null,
              };
            };
            const elementSampleIds = ["doc_title", "items", "total", "remarks"];
            const elementsDiffSample = elementSampleIds.reduce(
              (acc, id) => {
                acc[id] = {
                  draft: pickElementSample(draftObj, id),
                  stored: pickElementSample(storedObj, id),
                };
                return acc;
              },
              {} as Record<
                string,
                { draft: Record<string, unknown> | null; stored: Record<string, unknown> | null }
              >,
            );
            const settingsDiffSample = {
              draft: {
                coordSystem: (draftObj as any).settings?.coordSystem ?? null,
                yMode: (draftObj as any).settings?.yMode ?? null,
                presetId: (draftObj as any).settings?.presetId ?? null,
                presetRevision: (draftObj as any).settings?.presetRevision ?? null,
              },
              stored: {
                coordSystem: (storedObj as any).settings?.coordSystem ?? null,
                yMode: (storedObj as any).settings?.yMode ?? null,
                presetId: (storedObj as any).settings?.presetId ?? null,
                presetRevision: (storedObj as any).settings?.presetRevision ?? null,
              },
            };
            const regionBoundsDiffSample = {
              draft: (draftObj as any).regionBounds ?? null,
              stored: (storedObj as any).regionBounds ?? null,
            };
            const sheetSettingsDraft = (draftObj as any).sheetSettings;
            const sheetSettingsStored = (storedObj as any).sheetSettings;
            const sheetSettingsDiffSample = {
              draft: {
                exists: Boolean(sheetSettingsDraft),
                keys: sheetSettingsDraft ? Object.keys(sheetSettingsDraft) : [],
              },
              stored: {
                exists: Boolean(sheetSettingsStored),
                keys: sheetSettingsStored ? Object.keys(sheetSettingsStored) : [],
              },
            };
            const topLevelKeysDraft = Object.keys(draftObj).sort();
            const topLevelKeysStored = Object.keys(storedObj).sort();
            console.info("[DBG_SAVE_COMPARE]", {
              templateId,
              baseTemplateId: draftObj.baseTemplateId ?? storedObj.baseTemplateId ?? null,
              hashDraft: draftFingerprint.hash,
              hashStored: storedFingerprint.hash,
              jsonLenDraft: draftFingerprint.jsonLen,
              jsonLenStored: storedFingerprint.jsonLen,
              elementsCountDraft: draftFingerprint.elements,
              elementsCountStored: storedFingerprint.elements,
              topLevelKeysDraft,
              topLevelKeysStored,
              elementsDiffSample,
              settingsDiffSample,
              regionBoundsDiffSample,
              sheetSettingsDiffSample,
            });
            const elementIdsToCheck = new Set<string>([
              "doc_title",
              "items",
              "total",
              "remarks",
            ]);
            const allDraftIds = (draftObj.elements ?? []).map((el) => el.id ?? "");
            const allStoredIds = (storedObj.elements ?? []).map((el) => el.id ?? "");
            for (const id of [...allDraftIds, ...allStoredIds]) {
              if (id) elementIdsToCheck.add(id);
            }
            let diffLogCount = 0;
            const maxDiffLogs = 10;
            for (const targetId of elementIdsToCheck) {
              const draftEl = pickElement(draftObj, targetId);
              const storedEl = pickElement(storedObj, targetId);
              const elementId = pickElementId(draftObj, targetId);
              const { draftFields, storedFields, changedKeys } = toElemDiffEntry(
                elementId,
                draftEl,
                storedEl,
              );
              if (changedKeys.length > 0) {
                if (diffLogCount < maxDiffLogs) {
                  const values: Record<string, { draft: unknown; stored: unknown }> = {};
                  for (const key of changedKeys) {
                    values[key] = {
                      draft: draftFields[key],
                      stored: storedFields[key],
                    };
                  }
                  console.info("[DBG_SAVE_ELEM_DIFF]", {
                    elementId,
                    changedKeys,
                    values,
                  });
                  diffLogCount += 1;
                }
                for (const key of changedKeys) {
                  diffKeyCounts[key] = (diffKeyCounts[key] ?? 0) + 1;
                }
              } else if (
                targetId === "doc_title" ||
                targetId === "items" ||
                targetId === "total" ||
                targetId === "remarks"
              ) {
                console.info("[DBG_SAVE_ELEM_SAME]", { elementId });
              }
            }
            const summaryKeys = Object.keys(diffKeyCounts).sort(
              (a, b) => diffKeyCounts[b] - diffKeyCounts[a],
            );
            if (summaryKeys.length > 0) {
              const keysSummary: Record<string, number> = {};
              for (const key of summaryKeys) {
                keysSummary[key] = diffKeyCounts[key];
              }
              console.info("[DBG_DIFF_KEYS_SUMMARY]", keysSummary);
            }
            if (draftFingerprint.hash !== storedFingerprint.hash) {
              const missingInStored = topLevelKeysDraft.filter(
                (key) => !topLevelKeysStored.includes(key),
              );
              const extraInStored = topLevelKeysStored.filter(
                (key) => !topLevelKeysDraft.includes(key),
              );
              console.info("[DBG_SAVE_DIFF_KEYS]", {
                missingInStored,
                extraInStored,
              });
            }
          }

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
            let storeInfo: { store: string; key: string } | null = null;
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
                    storeInfo = {
                      store: "USER_TEMPLATES_KV",
                      key: buildUserTemplateKey(verified.tenantId, templateId),
                    };
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
                  storeInfo = {
                    store: "USER_TEMPLATES_KV",
                    key: buildUserTemplateKey(tenant.tenantKey, templateId),
                  };
                  return getUserTemplateById(templateId, env, tenant.tenantKey);
                })()
              : getBaseTemplateById(templateId, env);
            if (!isUserTemplate) {
              storeInfo = { store: "TEMPLATE_KV", key: `tpl:${templateId}` };
            }

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
            const migratedTemplate = migrateTemplate(rawTemplateResolved, {
              enabled: debugEnabled,
              requestId,
              reason: "fetch-template",
              templateId,
            });
            const didMigrate = schemaVersionBefore < TEMPLATE_SCHEMA_VERSION;
            const { ok, issues } = validateTemplate(migratedTemplate);
            const warnCount = issues.filter((issue) => issue.level === "warn").length;

            if (debugEnabled) {
              const fingerprint = await buildTemplateFingerprint(migratedTemplate);
              const dims = getTemplatePageInfo(migratedTemplate);
              const updatedAt = (migratedTemplate as any).updatedAt ?? (migratedTemplate as any).meta?.updatedAt ?? "";
              const revision = (migratedTemplate as any).revision ?? "";
              console.info(
                `[DBG_FETCH_TEMPLATE] requestId=${requestId ?? ""} path=${url.pathname} store=${storeInfo?.store ?? ""} ` +
                  `key=${storeInfo?.key ?? ""} templateId=${templateId} pageSize=${migratedTemplate.pageSize} ` +
                  `w=${dims.width} h=${dims.height} elements=${fingerprint.elements} jsonLen=${fingerprint.jsonLen} ` +
                  `hash=${fingerprint.hash} hashType=${fingerprint.hashType} migrated=${didMigrate} ` +
                  `updatedAt=${updatedAt} revision=${revision}`,
              );
            }

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
          const migratedTemplate = migrateTemplate(templateBody, {
            enabled: debugEnabled,
            requestId,
            reason: "admin-update",
            templateId,
          });
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
        try {
          let phase = "parse";
          let tenantKeyForDiag: string | null = null;
          let hasLogoForDiag = false;
          let logoBytesLenForDiag = 0;
          let resolvedTemplateIdForDiag: string | null = null;
          let resolvedBaseTemplateIdForDiag: string | null = null;
          let body: RenderRequestBody | undefined;
          try {
            body = (await request.json()) as RenderRequestBody;
          } catch (error) {
            console.error("[ERR_RENDER]", {
              requestId,
              message: "Invalid JSON body",
              error: error instanceof Error ? error.message : String(error),
            });
            return buildRenderErrorResponse(400, {
              errorCode: "INVALID_JSON",
              error: "Bad Request: Invalid JSON body",
              requestId,
              phase,
              missing: ["body"],
            });
          }

          if (debugEnabled) {
            console.info("[DBG_DEBUG_FLAGS]", {
              url: request.url,
              debugFromQuery,
              debugFromHash,
              debugEffective: debugEnabled,
            });
          }

          const debug = debugEnabled;
          const previewMode =
            body?.previewMode === "fieldCode" ? "fieldCode" : "record";
          const renderMode = resolveRenderMode(
            (body as { mode?: string } | undefined)?.mode ?? url.searchParams.get("mode"),
            previewMode,
          );
          let tenantRecordForRender: Awaited<ReturnType<typeof getTenantRecord>> | null = null;
          const kintoneForRender = body?.kintone as { baseUrl?: string; appId?: string } | undefined;
          if (kintoneForRender?.baseUrl && kintoneForRender?.appId) {
            try {
              const baseUrl = canonicalizeKintoneBaseUrl(kintoneForRender.baseUrl);
              const appId = canonicalizeAppId(kintoneForRender.appId);
              if (appId) {
                const tenantKey = buildTenantKey(baseUrl, appId);
                tenantKeyForDiag = tenantKey;
                tenantRecordForRender = await getTenantRecord(env.USER_TEMPLATES_KV, tenantKey);
              }
            } catch {
              tenantRecordForRender = null;
            }
          }

          const authHeader = request.headers.get("authorization");
          const sessionToken =
            request.headers.get("x-session-token") ??
            url.searchParams.get("sessionToken") ??
            (body as { sessionToken?: string } | undefined)?.sessionToken ??
            null;
          const hasSessionToken = Boolean(sessionToken || authHeader);

          const buildDiagnostics = () =>
            debugEnabled
              ? {
                  tenantKey: tenantKeyForDiag,
                  hasLogo: hasLogoForDiag,
                  logoBytesLen: logoBytesLenForDiag,
                  templateId: resolvedTemplateIdForDiag ?? templateIdInBody ?? null,
                  baseTemplateId: resolvedBaseTemplateIdForDiag,
                }
              : undefined;

          const templateIdInBody = body?.templateId ?? body?.template?.id ?? "";
          const userTemplateIdInBody = templateIdInBody.startsWith("tpl_")
            ? templateIdInBody
            : null;
          const bodyBaseTemplateId =
            (body as { baseTemplateId?: string } | undefined)?.baseTemplateId ??
            body?.template?.baseTemplateId ??
            null;
          const hasBodyTemplate = Boolean(body?.template);
          if (debugEnabled) {
            console.info("[DBG_RENDER_INCOMING]", {
              requestId,
              templateId: templateIdInBody,
              userTemplateId: userTemplateIdInBody,
              baseTemplateId: bodyBaseTemplateId,
              hasSessionToken,
              previewMode,
              renderMode,
              hasBodyTemplate,
            });
          }

          phase = "validate";
          const missing: string[] = [];
          if (!body || typeof body !== "object") {
            missing.push("body");
          }
          if (!body?.template && !body?.templateId) {
            missing.push("template", "templateId");
          }
          const requiresKintone =
            !body?.template && templateIdInBody.startsWith("tpl_");
          if (requiresKintone) {
            const kBaseUrl = (body as any)?.kintone?.baseUrl ?? "";
            const kAppId = (body as any)?.kintone?.appId ?? "";
            if (!kBaseUrl) missing.push("kintone.baseUrl");
            if (!kAppId) missing.push("kintone.appId");
          }
          if (missing.length > 0) {
            return buildRenderErrorResponse(400, {
              errorCode: "MISSING_FIELDS",
              error: `Bad Request: missing ${missing.join(", ")}`,
              requestId,
              phase,
              diagnostics: buildDiagnostics(),
              missing,
            });
          }

          if (url.pathname === "/render") {
            console.info("[render] debugFlag", {
              debug: debugEnabled,
              requestId,
            });
          }

          const isUserTemplateId = templateIdInBody.startsWith("tpl_");

          // template / templateId のどちらかから TemplateDefinition を決定
          let template: TemplateDefinition<TemplateDataRecord>;
          let templateSource: "body.template" | "templateId" = "templateId";
          let resolvedSource: "body.template" | "userTemplate" | "baseTemplate" =
            "baseTemplate";

          phase = "resolveTemplate";
          if (body?.template) {
            template = body.template;
            templateSource = "body.template";
            resolvedSource = "body.template";
          } else if (body?.templateId) {
            const isUserTemplate = body.templateId.startsWith("tpl_");
            resolvedSource = isUserTemplate ? "userTemplate" : "baseTemplate";
            if (!isUserTemplate && !TEMPLATE_IDS.has(body.templateId)) {
              return buildRenderErrorResponse(400, {
                errorCode: "UNKNOWN_TEMPLATE",
                error: "Bad Request: Unknown templateId",
                requestId,
                phase,
                diagnostics: buildDiagnostics(),
                missing: [],
              });
            }
            if (
              !isUserTemplate &&
              body.templateId !== "list_v1" &&
              body.templateId !== "estimate_v1" &&
              body.templateId !== "cards_v1" &&
              body.templateId !== "cards_v2" &&
              body.templateId !== "label_standard_v1" &&
              body.templateId !== "label_compact_v1" &&
              body.templateId !== "label_logistics_v1"
            ) {
              return buildRenderErrorResponse(400, {
                errorCode: "UNSUPPORTED_TEMPLATE",
                error: `Bad Request: templateId ${body.templateId} is not supported yet`,
                requestId,
                phase,
                diagnostics: buildDiagnostics(),
                missing: [],
              });
            }
            try {
              template = isUserTemplate
                ? await resolveUserTemplate(body.templateId, env, body.kintone as any, {
                    enabled: debugEnabled,
                    requestId,
                    path: url.pathname,
                  })
                : await getBaseTemplateById(body.templateId, env);
            } catch (err) {
              const msg =
                err instanceof Error ? err.message : "Unknown templateId";
              return buildRenderErrorResponse(400, {
                errorCode: "TEMPLATE_RESOLVE_FAILED",
                error: `Bad Request: ${msg}`,
                requestId,
                phase,
                diagnostics: buildDiagnostics(),
                missing: [],
              });
            }
          } else {
            return buildRenderErrorResponse(400, {
              errorCode: "MISSING_TEMPLATE",
              error: "Bad Request: Missing 'template' or 'templateId' in request body",
              requestId,
              phase,
              diagnostics: buildDiagnostics(),
              missing: ["template", "templateId"],
            });
          }
          resolvedTemplateIdForDiag = template.id ?? templateIdInBody ?? null;
          resolvedBaseTemplateIdForDiag = (template as any).baseTemplateId ?? bodyBaseTemplateId ?? null;

          if (debugEnabled) {
            const fingerprint = await buildTemplateFingerprint(template as TemplateDefinition);
            const elementIds = Array.isArray(template.elements)
              ? template.elements.map((el) => el.id ?? "").filter(Boolean)
              : [];
            const updatedAt =
              (template as any).updatedAt ??
              (template as any).meta?.updatedAt ??
              null;
            const revision =
              (template as any).revision ??
              (template as any).meta?.revision ??
              null;
            console.info("[DBG_RENDER_RESOLVED]", {
              requestId,
              resolvedSource,
              resolvedTemplateId: template.id ?? templateIdInBody ?? "",
              resolvedBaseTemplateId: (template as any).baseTemplateId ?? null,
              resolvedTemplateHash: fingerprint.hash,
              resolvedHashType: fingerprint.hashType,
              resolvedElementsCount: fingerprint.elements,
              resolvedElementIdsSample: elementIds.slice(0, 10),
              resolvedUpdatedAt: updatedAt,
              resolvedRevision: revision,
            });
            console.info("[DBG_RENDER_DOCMETA]", {
              requestId,
              templateId: template.id ?? templateIdInBody ?? "",
              elements: pickDocMeta(template as TemplateDefinition),
            });
          }

          const mappingKeysCount = (() => {
            const mapping = (template as any)?.mapping;
            if (!mapping || typeof mapping !== "object") return 0;
            return Object.keys(mapping).length;
          })();
          const tableConfigSummary = (() => {
            const tables =
              template?.elements?.filter((el) => el.type === "table") ?? [];
            return tables.map((table) => ({
              tableId: table.id ?? "",
              rowHeight: (table as any).rowHeight ?? null,
              headerHeight: (table as any).headerHeight ?? null,
              columns: Array.isArray((table as any).columns)
                ? (table as any).columns.length
                : 0,
              dataSource: (table as any).dataSource?.type ?? null,
              fieldCode: (table as any).dataSource?.fieldCode ?? null,
            }));
          })();

          console.info("[render] request", {
            requestId,
            method: request.method,
            url: request.url,
            origin: url.origin,
            debug: debugEnabled,
            templateId: templateIdInBody,
            userTemplateId: isUserTemplateId ? templateIdInBody : null,
            hasSessionToken,
            mappingKeysCount,
            tableConfigSummary,
          });

          const fixtureName = url.searchParams.get("fixture");
          console.log("fixture=", fixtureName);
          const fixtureData = fixtureName ? getFixtureData(fixtureName) : undefined;
          if (fixtureName && !fixtureData) {
            return new Response(`Unknown fixture: ${fixtureName}`, {
              status: 400,
              headers: CORS_HEADERS,
            });
          }
          phase = "migrate";
          const schemaVersionBefore = template.schemaVersion ?? 0;
          const migratedTemplate = migrateTemplate(template, {
            enabled: debug,
            requestId,
            reason: "render",
            templateId: template.id ?? body.templateId ?? "",
          });
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
        if (debug) {
          const fingerprint = await buildTemplateFingerprint(migratedTemplate);
          const dims = getTemplatePageInfo(migratedTemplate);
          const templateId = template.id ?? body.templateId ?? "";
          console.info(
            `[DBG_RENDER_START] requestId=${requestId ?? ""} templateId=${templateId} source=${templateSource} ` +
              `pageSize=${migratedTemplate.pageSize} previewMode=${previewMode} renderMode=${renderMode} ` +
              `fetchedHash=${fingerprint.hash} hashType=${fingerprint.hashType} fetchedEtag= ` +
              `fetchedJsonLen=${fingerprint.jsonLen} fetchedElements=${fingerprint.elements} ` +
              `pdfPageW=${dims.width} pdfPageH=${dims.height}`,
          );
        }

        phase = "prepareRender";
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
        const renderCompanyProfile =
          renderMode === "layout"
            ? undefined
            : normalizeCompanyProfile(
                tenantRecordForRender?.companyProfile ?? body?.companyProfile,
              );
        templateForRender = applyCompanyProfileToTemplate(
          templateForRender,
          renderCompanyProfile,
        );
        const templatePageInfo = getTemplatePageInfo(templateForRender);
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
        const debugTextBaseline: Array<{
          elementId: string;
          rectTopY: number;
          rectBottomY: number;
          fontSize: number;
          ascent: number | null;
          descent: number | null;
          computedDrawY: number;
        }> = debug ? [] : [];

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

        if (renderMode === "preview" && dataForRender && typeof dataForRender === "object") {
          const record = dataForRender as Record<string, unknown>;
          const maybeItems = record.Items;
          if (Array.isArray(maybeItems)) {
            const PREVIEW_ROW_LIMIT = 20;
            if (maybeItems.length > PREVIEW_ROW_LIMIT) {
              dataForRender = { ...record, Items: maybeItems.slice(0, PREVIEW_ROW_LIMIT) };
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

        const nowMs = () =>
          typeof performance !== "undefined" && typeof performance.now === "function"
            ? performance.now()
            : Date.now();
        const logTiming = (phaseName: string, ms: number) => {
          console.info("[DBG_RENDER_TIMING]", {
            requestId,
            phase: phaseName,
            ms: Math.round(ms),
          });
        };

        const logoStart = nowMs();
        const tenantLogo = await (async () => {
          try {
            if (!tenantRecordForRender?.logo) return null;
            const logo = await getTenantLogoBytes(env, tenantRecordForRender.tenantId, tenantRecordForRender.logo);
            if (!logo) return null;
            return {
              ...logo,
              objectKey: tenantRecordForRender.logo.objectKey,
            };
          } catch {
            return null;
          }
        })();
        logTiming("load_logo", nowMs() - logoStart);
        hasLogoForDiag = Boolean(tenantLogo);
        logoBytesLenForDiag = tenantLogo?.bytes?.length ?? 0;
        if (debugEnabled) {
          console.info("[DBG_TENANT_PROFILE]", {
            hasLogo: hasLogoForDiag,
            companyNameLen: renderCompanyProfile?.companyName?.length ?? 0,
            addressLen: renderCompanyProfile?.companyAddress?.length ?? 0,
            telLen: renderCompanyProfile?.companyTel?.length ?? 0,
            emailLen: renderCompanyProfile?.companyEmail?.length ?? 0,
          });
          console.info("[DBG_LOGO]", {
            tenantKey: tenantKeyForDiag,
            found: Boolean(tenantLogo),
            bytes: tenantLogo?.bytes?.length ?? 0,
            contentType: tenantLogo?.contentType ?? null,
            source: 'tenantR2',
          });
        }

        let cachedPdf: ArrayBuffer | null = null;
        let cacheKey: string | null = null;
        if (renderMode === "preview" && env.RENDER_CACHE && !debugEnabled) {
          const templateFingerprint = await buildTemplateFingerprint(templateForRender);
          const dataJson = stableStringify(dataForRender ?? null);
          const dataHash = (await sha256Hex(dataJson)) ?? hashStringFNV1a(dataJson);
          const cachePayload = {
            mode: renderMode,
            previewMode,
            templateHash: templateFingerprint.hash,
            templateId: templateForRender.id ?? templateIdInBody ?? null,
            baseTemplateId: templateForRender.baseTemplateId ?? null,
            tenantKey: tenantKeyForDiag,
            tenantUpdatedAt: tenantRecordForRender?.updatedAt ?? null,
            logoUpdatedAt: tenantRecordForRender?.logo?.updatedAt ?? null,
            dataHash,
          };
          const cacheJson = stableStringify(cachePayload);
          const cacheHash = (await sha256Hex(cacheJson)) ?? hashStringFNV1a(cacheJson);
          cacheKey = `render:preview:${cacheHash}`;
          cachedPdf = await env.RENDER_CACHE.get(cacheKey, "arrayBuffer");
        }

        if (cachedPdf) {
          console.info("[DBG_RENDER_CACHE]", {
            requestId,
            status: "HIT",
            cacheKey,
          });
          return new Response(cachedPdf, {
            status: 200,
            headers: {
              ...CORS_HEADERS,
              "Content-Type": "application/pdf",
              "X-Render-Cache": "HIT",
              "X-Debug-Fixture": fixtureName ?? "(none)",
              "X-Debug-Rows": String(rowsCount),
            },
          });
        }

        // フォント読み込み
        const useJpFont = shouldUseJpFont(
          templateForRender,
          dataForRender,
          renderMode,
          previewMode,
          renderCompanyProfile,
        );
        let fonts: { jp: Uint8Array | null; latin: Uint8Array | null };
        phase = "loadFonts";
        try {
          const fontStart = nowMs();
          fonts = await loadFonts(env, { requireJp: useJpFont });
          logTiming("load_fonts", nowMs() - fontStart);
          console.info("[DBG_FONT_POLICY]", {
            requestId,
            renderMode,
            useJpFont,
            latinSource: fonts.latin ? "custom" : "standard",
            jpBytes: fonts.jp?.length ?? 0,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[ERR_RENDER]", {
            requestId,
            message,
            stack: err instanceof Error ? err.stack : undefined,
          });
          const responseBody = debug
            ? {
                errorCode: "FONT_LOAD_FAILED",
                error: message,
                requestId,
                phase,
                diagnostics: {
                  tenantKey: tenantKeyForDiag,
                  hasLogo: hasLogoForDiag,
                  logoBytesLen: logoBytesLenForDiag,
                  templateId: resolvedTemplateIdForDiag ?? templateIdInBody ?? null,
                  baseTemplateId: resolvedBaseTemplateIdForDiag,
                },
                stack: truncateHeaderValue(err instanceof Error ? err.stack ?? "" : ""),
                hint: resolveRenderHint(err),
              }
            : { errorCode: "RENDER_FAILED", error: "Render failed", requestId, phase };
          return buildRenderErrorResponse(500, responseBody);
        }

          // PDF 生成
          try {
            phase = "renderPdf";
            const renderStart = nowMs();
            const { bytes: rawPdfBytes, warnings } = await renderTemplateToPdf(
              templateForRender,
              dataForRender as TemplateDataRecord | undefined,
              fonts,
              {
                debug,
                previewMode,
                renderMode,
                useJpFont,
                requestId,
                tenantLogo: tenantLogo ?? undefined,
                onTiming: (phaseName, ms) => logTiming(phaseName, ms),
                onTextBaseline: debug
                  ? (entry) => {
                      debugTextBaseline.push(entry);
                    }
                  : undefined,
                onPageInfo: debug
                  ? ({ pdfPageW, pdfPageH }) => {
                      console.debug('[DBG_PAGE]', {
                        requestId,
                        pageSize: templateForRender.pageSize ?? null,
                        templatePageW: templatePageInfo.width,
                        templatePageH: templatePageInfo.height,
                        pdfPageW,
                        pdfPageH,
                      });
                    }
                  : undefined,
              },
            );
            logTiming("build_pdf", nowMs() - renderStart);

            const pdfBytes = new Uint8Array(rawPdfBytes);
            if (debugEnabled) {
              console.info("[DBG_PDF_SIZE]", { requestId, bytes: pdfBytes.length });
            }
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
            if (cacheKey && env.RENDER_CACHE) {
              try {
                await env.RENDER_CACHE.put(cacheKey, pdfBytes, { expirationTtl: 60 });
                headers["X-Render-Cache"] = "PUT";
                console.info("[DBG_RENDER_CACHE]", {
                  requestId,
                  status: "PUT",
                  cacheKey,
                });
              } catch {
                headers["X-Render-Cache"] = "PUT_FAILED";
                console.info("[DBG_RENDER_CACHE]", {
                  requestId,
                  status: "PUT_FAILED",
                  cacheKey,
                });
              }
            }

            if (debug && warnCount > 0) {
              headers["X-Debug-Warn-Sample"] = truncateHeaderValue(combinedWarnings[0]);
            }
            if (debug && debugTextBaseline.length > 0) {
              headers["X-Debug-Text-Baseline"] = truncateHeaderValue(
                JSON.stringify(debugTextBaseline),
                1000,
              );
            }

            return new Response(pdfBytes, {
              status: 200,
              headers,
            });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error("[ERR_RENDER]", {
              requestId,
              message,
              stack: err instanceof Error ? err.stack : undefined,
            });
            const responseBody = debug
              ? {
                  errorCode: "RENDER_FAILED",
                  error: message,
                  requestId,
                  phase,
                  diagnostics: {
                    tenantKey: tenantKeyForDiag,
                    hasLogo: hasLogoForDiag,
                    logoBytesLen: logoBytesLenForDiag,
                    templateId: resolvedTemplateIdForDiag ?? templateIdInBody ?? null,
                    baseTemplateId: resolvedBaseTemplateIdForDiag,
                  },
                  stack: truncateHeaderValue(err instanceof Error ? err.stack ?? "" : ""),
                  hint: resolveRenderHint(err),
                }
              : { errorCode: "RENDER_FAILED", error: "Render failed", requestId, phase };
            return buildRenderErrorResponse(500, responseBody);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.error("[ERR_RENDER]", {
            requestId,
            message,
            stack: err instanceof Error ? err.stack : undefined,
          });
          const responseBody = debugEnabled
            ? {
                errorCode: "RENDER_FAILED",
                error: message,
                requestId,
                phase,
                diagnostics: {
                  tenantKey: tenantKeyForDiag,
                  hasLogo: hasLogoForDiag,
                  logoBytesLen: logoBytesLenForDiag,
                  templateId: resolvedTemplateIdForDiag ?? templateIdInBody ?? null,
                  baseTemplateId: resolvedBaseTemplateIdForDiag,
                },
                stack: truncateHeaderValue(err instanceof Error ? err.stack ?? "" : ""),
                hint: resolveRenderHint(err),
              }
            : { errorCode: "RENDER_FAILED", error: "Render failed", requestId, phase };
          return buildRenderErrorResponse(500, responseBody);
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
