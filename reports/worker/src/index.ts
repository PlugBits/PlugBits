// worker/src/index.ts
import type {
  TemplateDefinition,
  TemplateDataRecord,
  TemplateMeta,
  TableElement,
  CardListElement,
  CompanyProfile,
  TemplateElement,
} from "../../shared/template.js";
import { TEMPLATE_SCHEMA_VERSION, getPageDimensions } from "../../shared/template.js";
import type {
  RendererErrorCode,
  RendererJobResultRequest,
  RendererJobTransitionRequest,
  RendererInlineAsset,
  RendererRenderRequest,
  RendererRenderResponse,
  RendererRenderSuccess,
  RenderJobStatus,
  StoredRenderJobPayload,
} from "../../shared/rendering.js";

import { renderLabelCalibrationPdf, renderTemplateToPdf } from "./pdf/renderTemplate.ts";
import { PDFDocument, StandardFonts } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { getFonts, resolveJpFontSelection, type JpFontFamily } from "./fonts/fontLoader.js";
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
import {
  getRenderLogTier,
  logRenderError,
  logRenderInfo,
  type RenderLogTier,
} from "./logging/renderLogs.ts";
import { runCloudRunJob, type CloudRunJobDispatchConfig } from "./lib/gcp/runJobs.ts";


// Wrangler の env 定義（あってもなくても動くよう optional にする）
export interface Env {
  FONT_SOURCE_URL?: string;
  JP_FONT_FAMILY?: string;
  JP_FONT_BIZUD_URL?: string;
  JP_FONT_MPLUS_URL?: string;
  LATIN_FONT_URL?: string;
  ADMIN_API_KEY?: string;
  RENDER_LOG_LEVEL?: string;
  RENDER_MODE?: "local" | "remote";
  RENDERER_BASE_URL?: string;
  RENDERER_INTERNAL_TOKEN?: string;
  RENDERER_REQUEST_TIMEOUT_MS?: string;
  RENDERER_VERSION?: string;
  GCP_PROJECT_ID?: string;
  GCP_REGION?: string;
  CLOUD_RUN_RENDER_JOB_NAME?: string;
  CLOUD_RUN_RENDER_JOB_CONTAINER_NAME?: string;
  GCP_SERVICE_ACCOUNT_CLIENT_EMAIL?: string;
  GCP_SERVICE_ACCOUNT_PRIVATE_KEY?: string;
  GCP_TOKEN_URI?: string;
  CLOUD_RUN_RENDER_JOB_REQUEST_TIMEOUT_MS?: string;
  CLOUD_RUN_RENDER_JOB_TASK_TIMEOUT?: string;
  TEMPLATE_KV: KVNamespace;
  USER_TEMPLATES_KV: KVNamespace;
  SESSIONS_KV: KVNamespace;
  TENANT_ASSETS?: R2Bucket;
  RENDER_CACHE?: KVNamespace;
  RENDER_JOBS_KV?: KVNamespace;
  RENDER_JOBS_QUEUE?: Queue<RenderJobMessage>;
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

  // 日本語フォント候補切替（noto | bizud | mplus）
  jpFontFamily?: JpFontFamily;

  // 自社情報（プラグイン設定由来）
  companyProfile?: CompanyProfile;
};

type RenderMode = "layout" | "preview" | "final";
type RenderJobRequestBody = {
  templateId?: string;
  recordId?: string | number;
  recordRevision?: string | number;
  mode?: "print" | "save";
  kintoneBaseUrl?: string;
  appId?: string | number;
  openWhenDone?: boolean;
  kintone?: {
    baseUrl?: string;
    appId?: string | number;
  };
  context?: {
    tenantKey?: string;
    userAgent?: string;
    source?: string;
  };
  jpFontFamily?: JpFontFamily;
  kintoneApiToken?: string;
  sessionToken?: string;
};
type RenderJobMessage = {
  jobId: string;
  templateId: string;
  recordId: string;
  recordRevision: string;
  mode: RenderJobMode;
  kintoneBaseUrl: string;
  appId: string;
  jpFontFamily: JpFontFamily;
  sessionToken?: string;
  kintoneApiToken?: string;
  tenantKey: string;
  dedupKey: string;
  requestedAt: string;
};
type RenderJobMode = "print" | "save";
type RenderJobRecord = {
  jobId: string;
  status: RenderJobStatus;
  templateId: string;
  templateRevision: number | null;
  recordId: string;
  recordRevision: string;
  kintoneBaseUrl: string;
  appId: string;
  tenantKey: string;
  tenantId: string;
  mode: RenderJobMode;
  source?: string | null;
  jpFontFamily: JpFontFamily;
  dedupKey: string;
  requestedAt: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  finishedAt?: string | null;
  pdfKey?: string | null;
  pdfObjectKey?: string | null;
  pdfUrl?: string | null;
  pdfBytes?: number | null;
  renderMs?: number | null;
  errorCode?: RendererErrorCode | null;
  errorMessage?: string | null;
  error?: string | null;
  rendererVersion?: string | null;
  executionName?: string | null;
  executionDispatchedAt?: string | null;
  renderStartedAt?: string | null;
  renderFinishedAt?: string | null;
  failureStage?: string | null;
  errorSummary?: string | null;
  errorDetails?: string | null;
  requestedBy?: string | null;
  attempt: number;
};

type PublicRenderJobStatus = "queued" | "running" | "done" | "error";

// CORS 設定
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key, x-kintone-api-token, x-session-token, x-renderer-internal-token, x-renderer-request-id, x-renderer-version, x-renderer-job-id, X-Requested-With",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const SESSION_TTL_SECONDS = 60 * 60;
const DEFAULT_RENDERER_TIMEOUT_MS = 120_000;
const DEFAULT_RENDERER_VERSION = "v1";
const DEFAULT_GCP_RUN_JOB_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_RENDER_JOB_PAYLOAD_TTL_SECONDS = 60 * 60 * 24;
const RENDER_JOB_DEDUP_REUSE_QUEUED_MS = 60_000;
const RENDER_JOB_STALE_PROCESSING_MS = 10 * 60_000;
const RENDER_JOBS_QUEUE_NAME = "render-jobs";
const INTERNAL_RENDERER_HEADER = "x-renderer-internal-token";
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
const LOGO_MAX_STORED_BYTES = 150 * 1024;
const LOGO_MAX_STORED_BYTES_PNG = 100 * 1024;

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
  const logoCandidates = canonicalized.filter((el) => {
    if (el.type !== "image") return false;
    const slotId = (el as any).slotId ?? el.id;
    return slotId === "company_logo" || el.id === "logo" || el.id === "company_logo";
  }) as TemplateElement[];

  if (logoCandidates.length > 1) {
    const score = (el: any) => {
      const hiddenScore = el.hidden === true ? 1 : 0;
      const idScore = el.id === "logo" ? 0 : 1;
      const x = Number.isFinite(el.x) ? el.x : 0;
      const y = Number.isFinite(el.y) ? el.y : 0;
      const posScore = x + y;
      return [hiddenScore, idScore, posScore];
    };
    let picked = logoCandidates[0];
    for (const candidate of logoCandidates.slice(1)) {
      const a = score(picked);
      const b = score(candidate);
      if (b[0] < a[0] || (b[0] === a[0] && (b[1] < a[1] || (b[1] === a[1] && b[2] < a[2])))) {
        picked = candidate;
      }
    }
    const removed = logoCandidates.filter((el) => el !== picked).map((el) => el.id);
    if (removed.length > 0) {
      console.warn("[WARN_LOGO_DUPLICATE]", {
        templateId: (clone as any).id ?? null,
        count: logoCandidates.length,
        keptId: picked.id,
        removedIds: removed,
      });
    }
    const deduped = canonicalized.filter((el) => {
      if (logoCandidates.includes(el)) {
        return el === picked;
      }
      return true;
    });
    canonicalized.splice(0, canonicalized.length, ...deduped);
  }
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
const hasAscii = (text: string) => /[\u0000-\u007F]/.test(text);

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

const containsAsciiValue = (value: unknown, seen = new WeakSet<object>()): boolean => {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return hasAscii(value);
  if (typeof value === "number" || typeof value === "boolean") return true;
  if (value instanceof Date) return true;

  if (Array.isArray(value)) {
    for (const item of value) {
      if (containsAsciiValue(item, seen)) return true;
    }
    return false;
  }

  if (typeof value === "object") {
    if (seen.has(value as object)) return false;
    seen.add(value as object);
    for (const v of Object.values(value as Record<string, unknown>)) {
      if (containsAsciiValue(v, seen)) return true;
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

type TextProfileStat = {
  fieldCode: string;
  count: number;
  maxLen: number;
  maxNewlines: number;
  maxNonAscii: number;
  maxLineLength: number;
  maxSpecialChars: number;
};

const CONTROL_CHAR_PATTERN = /[\u0000-\u001F\u007F]/g;
const NON_ASCII_PATTERN = /[^\x00-\x7F]/g;
const SPECIAL_CHAR_PATTERN = /[^\p{L}\p{N}\s]/gu;

const unwrapKintoneValue = (raw: unknown): unknown => {
  if (raw && typeof raw === "object" && "value" in (raw as Record<string, unknown>)) {
    return (raw as { value?: unknown }).value;
  }
  return raw;
};

const stringifyRecordValue = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  const type = typeof value;
  if (type === "string" || type === "number" || type === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => stringifyRecordValue(item))
      .filter((part) => part !== "")
      .join(", ");
  }
  if (type === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }
  return "";
};

const analyzeTextProfile = (text: string) => {
  if (!text) {
    return {
      len: 0,
      newlines: 0,
      nonAscii: 0,
      maxLineLength: 0,
      specialChars: 0,
    };
  }
  const len = text.length;
  const newlines = (text.match(/\n/g) ?? []).length;
  const nonAscii = (text.match(NON_ASCII_PATTERN) ?? []).length;
  const lines = text.split("\n");
  const maxLineLength = lines.reduce((max, line) => Math.max(max, line.length), 0);
  const specialChars = (text.match(SPECIAL_CHAR_PATTERN) ?? []).length;
  const controlChars = (text.match(CONTROL_CHAR_PATTERN) ?? []).length;
  return {
    len,
    newlines,
    nonAscii,
    maxLineLength,
    specialChars: specialChars + controlChars,
  };
};

const buildTextProfile = (
  template: TemplateDefinition,
  data: unknown,
  previewMode: "record" | "fieldCode",
): TextProfileStat[] => {
  if (!data || typeof data !== "object") return [];
  if (previewMode !== "record") return [];
  const record = data as Record<string, unknown>;
  const profile = new Map<string, TextProfileStat>();
  const update = (fieldCode: string, raw: unknown) => {
    if (!fieldCode) return;
    const value = unwrapKintoneValue(raw);
    const text = stringifyRecordValue(value);
    const stats = analyzeTextProfile(text);
    const current = profile.get(fieldCode) ?? {
      fieldCode,
      count: 0,
      maxLen: 0,
      maxNewlines: 0,
      maxNonAscii: 0,
      maxLineLength: 0,
      maxSpecialChars: 0,
    };
    current.count += 1;
    current.maxLen = Math.max(current.maxLen, stats.len);
    current.maxNewlines = Math.max(current.maxNewlines, stats.newlines);
    current.maxNonAscii = Math.max(current.maxNonAscii, stats.nonAscii);
    current.maxLineLength = Math.max(current.maxLineLength, stats.maxLineLength);
    current.maxSpecialChars = Math.max(current.maxSpecialChars, stats.specialChars);
    profile.set(fieldCode, current);
  };

  for (const element of template.elements ?? []) {
    if (element.dataSource?.type === "kintone") {
      update(element.dataSource.fieldCode, record[element.dataSource.fieldCode]);
    }
    if (element.type === "table") {
      const table = element as TableElement;
      const tableField = table.dataSource?.fieldCode;
      const rawRows = tableField ? record[tableField] : undefined;
      const rows = Array.isArray(rawRows) ? rawRows : [];
      const rowLimit = Math.min(rows.length, 20);
      for (let i = 0; i < rowLimit; i += 1) {
        const row = rows[i];
        if (!row || typeof row !== "object") continue;
        const rowRecord = row as Record<string, unknown>;
        for (const col of table.columns ?? []) {
          update(col.fieldCode, rowRecord[col.fieldCode]);
        }
      }
      continue;
    }
    if (element.type === "cardList") {
      const card = element as CardListElement;
      const tableField = card.dataSource?.fieldCode;
      const rawRows = tableField ? record[tableField] : undefined;
      const rows = Array.isArray(rawRows) ? rawRows : [];
      const rowLimit = Math.min(rows.length, 20);
      for (let i = 0; i < rowLimit; i += 1) {
        const row = rows[i];
        if (!row || typeof row !== "object") continue;
        const rowRecord = row as Record<string, unknown>;
        for (const field of card.fields ?? []) {
          if (!field.fieldCode) continue;
          update(field.fieldCode, rowRecord[field.fieldCode]);
        }
      }
    }
  }

  return Array.from(profile.values()).sort((a, b) =>
    a.fieldCode.localeCompare(b.fieldCode),
  );
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

const ESTIMATE_DYNAMIC_SLOT_IDS_FOR_OVERLAY = new Set([
  "to_name",
  "to_honorific",
  "issue_date",
  "doc_no",
  "company_logo",
  "company_name",
  "company_address",
  "company_tel",
  "company_email",
  "items",
  "subtotal",
  "tax",
  "total",
  "remarks",
]);

const estimateOverlayTemplateHasNonAscii = (template: TemplateDefinition): boolean => {
  for (const element of template.elements ?? []) {
    if (element.type !== "text") continue;
    const slotId = (element as any).slotId as string | undefined;
    if (!slotId || !ESTIMATE_DYNAMIC_SLOT_IDS_FOR_OVERLAY.has(slotId)) continue;
    const staticValue =
      element.dataSource?.type === "static"
        ? String(element.dataSource.value ?? "")
        : String((element as any).text ?? "");
    if (hasNonAscii(staticValue)) return true;
  }
  return false;
};

// フォント読み込み（今はデフォルト埋め込みフォントだけ）
async function loadFonts(
  env: Env,
  options?: { requireJp?: boolean; jpFontFamily?: JpFontFamily },
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
    tenantKey: string;
    kintoneBaseUrl: string;
    appId: string;
    expiresAt: number;
    kintoneApiToken?: string;
    tokensByAppId?: Record<string, string>;
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
    tenantKey?: string;
    kintoneBaseUrl?: string;
    appId?: string;
    expiresAt?: number;
    kintoneApiToken?: string;
    tokensByAppId?: Record<string, string>;
    companyProfile?: CompanyProfile;
  };
  try {
    session = JSON.parse(raw) as {
      tenantKey?: string;
      kintoneBaseUrl?: string;
      appId?: string;
      expiresAt?: number;
      kintoneApiToken?: string;
      tokensByAppId?: Record<string, string>;
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

  let tenantKey = session.tenantKey ?? "";
  if (!tenantKey) {
    try {
      tenantKey = buildTenantKey(kintoneBaseUrl, appId);
    } catch {
      return {
        error: new Response("Invalid session payload", {
          status: 401,
          headers: CORS_HEADERS,
        }),
      };
    }
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
      tenantKey,
      kintoneBaseUrl,
      appId,
      expiresAt: Number(session.expiresAt),
      kintoneApiToken: session.kintoneApiToken,
      tokensByAppId: session.tokensByAppId,
      companyProfile: normalizeCompanyProfile(session.companyProfile),
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

const resolveRenderModeSetting = (env: Env): "local" | "remote" =>
  env.RENDER_MODE === "remote" ? "remote" : "local";

const getRendererVersion = (env: Env) => env.RENDERER_VERSION?.trim() || DEFAULT_RENDERER_VERSION;

const getRendererTimeoutMs = (env: Env) => {
  const parsed = Number(env.RENDERER_REQUEST_TIMEOUT_MS ?? "");
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_RENDERER_TIMEOUT_MS;
  return parsed;
};

const getCloudRunJobRequestTimeoutMs = (env: Env) => {
  const parsed = Number(env.CLOUD_RUN_RENDER_JOB_REQUEST_TIMEOUT_MS ?? "");
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_GCP_RUN_JOB_REQUEST_TIMEOUT_MS;
  return parsed;
};

const getCloudRunJobDispatchConfig = (env: Env): CloudRunJobDispatchConfig => {
  const projectId = env.GCP_PROJECT_ID?.trim() ?? "";
  const region = env.GCP_REGION?.trim() ?? "";
  const jobName = env.CLOUD_RUN_RENDER_JOB_NAME?.trim() ?? "";
  const serviceAccountClientEmail = env.GCP_SERVICE_ACCOUNT_CLIENT_EMAIL?.trim() ?? "";
  const serviceAccountPrivateKey = env.GCP_SERVICE_ACCOUNT_PRIVATE_KEY?.trim() ?? "";
  if (!projectId || !region || !jobName) {
    throw new RenderExecutionError(
      "RENDERER_HTTP_FAILED",
      "Cloud Run Job config is not configured",
    );
  }
  if (!serviceAccountClientEmail || !serviceAccountPrivateKey) {
    throw new RenderExecutionError(
      "UNAUTHORIZED_RENDERER_CALL",
      "Google service account credentials are not configured",
    );
  }
  return {
    projectId,
    region,
    jobName,
    serviceAccountClientEmail,
    serviceAccountPrivateKey,
    tokenUri: env.GCP_TOKEN_URI?.trim() ?? null,
    requestTimeoutMs: getCloudRunJobRequestTimeoutMs(env),
    taskTimeout: env.CLOUD_RUN_RENDER_JOB_TASK_TIMEOUT?.trim() || "900s",
  };
};

const buildRenderOutputKey = (jobId: string) => `renders/${jobId}/output.pdf`;
const buildRenderJobPdfPath = (jobId: string) => `/render-jobs/${encodeURIComponent(jobId)}/pdf`;
const buildRenderJobPdfUrl = (request: Request, jobId: string) =>
  new URL(buildRenderJobPdfPath(jobId), request.url).toString();

const toPublicRenderJobStatus = (status: RenderJobStatus): PublicRenderJobStatus => {
  if (status === "done") return "done";
  if (status === "failed") return "error";
  if (status === "running" || status === "processing") return "running";
  return "queued";
};

const buildRenderJobPublicPayload = (request: Request, record: RenderJobRecord) => {
  const status = toPublicRenderJobStatus(record.status);
  const pdfUrl = status === "done"
    ? (
        record.pdfUrl
          ? new URL(record.pdfUrl, request.url).toString()
          : buildRenderJobPdfUrl(request, record.jobId)
      )
    : null;
  return {
    ok: status !== "error",
    jobId: record.jobId,
    status,
    rawStatus: record.status,
    templateId: record.templateId,
    recordId: record.recordId,
    mode: record.mode,
    source: record.source ?? null,
    executionName: record.executionName ?? null,
    createdAt: record.createdAt ?? record.requestedAt ?? null,
    startedAt: record.renderStartedAt ?? record.startedAt ?? null,
    finishedAt: record.renderFinishedAt ?? record.finishedAt ?? record.completedAt ?? null,
    pdfUrl,
    pdfKey: record.pdfKey ?? record.pdfObjectKey ?? null,
    errorCode: record.errorCode ?? null,
    errorMessage: record.errorMessage ?? record.error ?? null,
    rendererVersion: record.rendererVersion ?? null,
  };
};

const logRenderJobEvent = (
  tag: string,
  env: Env,
  recordLike: Partial<RenderJobRecord> & {
    jobId?: string | null;
    templateId?: string | null;
    recordId?: string | null;
    tenantKey?: string | null;
    tenantId?: string | null;
    mode?: RenderJobMode | null;
    source?: string | null;
    status?: RenderJobStatus | null;
  },
  extra?: Record<string, unknown>,
  tier: RenderLogTier = "always",
) => {
  logRenderInfo(env, tier, tag, {
    jobId: recordLike.jobId ?? null,
    templateId: recordLike.templateId ?? null,
    recordId: recordLike.recordId ?? null,
    tenantKey: recordLike.tenantKey ?? null,
    tenantId: recordLike.tenantId ?? null,
    mode: recordLike.mode ?? null,
    source: recordLike.source ?? null,
    rendererVersion: recordLike.rendererVersion ?? getRendererVersion(env),
    renderMode: resolveRenderModeSetting(env),
    renderEngine: resolveRenderModeSetting(env),
    pdfKey: recordLike.pdfKey ?? recordLike.pdfObjectKey ?? null,
    pdfBytes: recordLike.pdfBytes ?? null,
    renderMs: recordLike.renderMs ?? null,
    status: recordLike.status ?? null,
    errorCode: recordLike.errorCode ?? null,
    executionName: recordLike.executionName ?? null,
    renderStartedAt: recordLike.renderStartedAt ?? recordLike.startedAt ?? null,
    renderFinishedAt: recordLike.renderFinishedAt ?? recordLike.finishedAt ?? null,
    failureStage: recordLike.failureStage ?? null,
    ...extra,
  });
};

const logRenderSummary = (
  env: Env,
  summary: {
    jobId: string;
    templateId: string;
    tenantId: string;
    renderMs: number | null;
    pdfBytes: number | null;
    backgroundBytes: number | null;
    status: RenderJobStatus;
    rendererVersion?: string | null;
    errorCode?: RendererErrorCode | null;
    executionName?: string | null;
    renderStartedAt?: string | null;
    renderFinishedAt?: string | null;
    failureStage?: string | null;
  },
) => {
  logRenderInfo(env, "always", "[DBG_RENDER_SUMMARY]", {
    jobId: summary.jobId,
    templateId: summary.templateId,
    tenantId: summary.tenantId,
    renderEngine: resolveRenderModeSetting(env),
    renderMode: resolveRenderModeSetting(env),
    rendererVersion: summary.rendererVersion ?? getRendererVersion(env),
    timeoutMs: getRendererTimeoutMs(env),
    renderMs: summary.renderMs,
    pdfBytes: summary.pdfBytes,
    backgroundBytes: summary.backgroundBytes,
    status: summary.status,
    errorCode: summary.errorCode ?? null,
    executionName: summary.executionName ?? null,
    renderStartedAt: summary.renderStartedAt ?? null,
    renderFinishedAt: summary.renderFinishedAt ?? null,
    durationMs: summary.renderMs,
    outputBytes: summary.pdfBytes,
    failureStage: summary.failureStage ?? null,
  });
};

const buildRendererInternalHeaders = (env: Env, requestId: string, jobId?: string) => {
  const token = env.RENDERER_INTERNAL_TOKEN?.trim();
  if (!token) {
    throw new Error("RENDERER_INTERNAL_TOKEN is not configured");
  }
  const headers: Record<string, string> = {
    [INTERNAL_RENDERER_HEADER]: token,
    "x-renderer-request-id": requestId,
  };
  if (jobId) headers["x-renderer-job-id"] = jobId;
  return headers;
};

const authorizeRendererInternalRequest = (request: Request, env: Env): Response | null => {
  const expected = env.RENDERER_INTERNAL_TOKEN?.trim();
  const actual = request.headers.get(INTERNAL_RENDERER_HEADER)?.trim() ?? "";
  if (!expected || !actual || expected !== actual) {
    logRenderError(env, "always", "[DBG_RENDERER_INTERNAL_AUTH_MISMATCH]", {
      route: new URL(request.url).pathname,
      requestId: request.headers.get("x-renderer-request-id") ?? null,
      expectedLength: expected?.length ?? 0,
      actualLength: actual.length,
    });
    return jsonError(401, {
      error: "UNAUTHORIZED_RENDERER_CALL",
      errorCode: "UNAUTHORIZED_RENDERER_CALL",
      errorMessage: "renderer internal token mismatch",
    });
  }
  return null;
};

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
};

const getRenderJobsStore = (
  env: Env,
): { kv: KVNamespace; store: "RENDER_JOBS_KV" | "RENDER_CACHE" } | null => {
  if (env.RENDER_JOBS_KV) return { kv: env.RENDER_JOBS_KV, store: "RENDER_JOBS_KV" };
  if (env.RENDER_CACHE) return { kv: env.RENDER_CACHE, store: "RENDER_CACHE" };
  return null;
};

const getRenderJobsKv = (env: Env): KVNamespace | null =>
  getRenderJobsStore(env)?.kv ?? null;

const buildRenderJobKey = (jobId: string) => `render_job:${jobId}`;
const buildRenderJobDedupKey = (signatureHash: string) => `render_job_dedup:${signatureHash}`;
const buildRenderJobPayloadKey = (jobId: string) => `render_job_payload:${jobId}`;

const putRenderJobRecord = async (env: Env, record: RenderJobRecord) => {
  const store = getRenderJobsStore(env);
  if (!store) throw new Error("RENDER_JOBS_KV_OR_RENDER_CACHE_REQUIRED");
  const key = buildRenderJobKey(record.jobId);
  await store.kv.put(key, JSON.stringify(record));
  logRenderInfo(env, "debug", "[DBG_RENDER_JOB_STORE_WRITE]", {
    jobId: record.jobId,
    status: record.status,
    store: store.store,
    key,
  });
};

const getRenderJobRecord = async (
  env: Env,
  jobId: string,
): Promise<RenderJobRecord | null> => {
  const store = getRenderJobsStore(env);
  if (!store) return null;
  const key = buildRenderJobKey(jobId);
  const raw = await store.kv.get(key);
  if (!raw) {
    logRenderInfo(env, "debug", "[DBG_RENDER_JOB_STORE_READ]", {
      jobId,
      status: null,
      store: store.store,
      key,
      found: false,
    });
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<RenderJobRecord>;
    const normalized: RenderJobRecord = {
      jobId: String(parsed.jobId ?? jobId),
      status: (parsed.status as RenderJobStatus | undefined) ?? "queued",
      templateId: String(parsed.templateId ?? ""),
      templateRevision: parsed.templateRevision ?? null,
      recordId: String(parsed.recordId ?? ""),
      recordRevision: String(parsed.recordRevision ?? ""),
      kintoneBaseUrl: String(parsed.kintoneBaseUrl ?? ""),
      appId: String(parsed.appId ?? ""),
      tenantKey: String(parsed.tenantKey ?? ""),
      tenantId: String(parsed.tenantId ?? parsed.tenantKey ?? ""),
      mode: parsed.mode === "save" ? "save" : "print",
      source: parsed.source ?? null,
      jpFontFamily: (parsed.jpFontFamily as JpFontFamily | undefined) ?? "noto",
      dedupKey: String(parsed.dedupKey ?? ""),
      requestedAt: String(parsed.requestedAt ?? parsed.createdAt ?? new Date().toISOString()),
      createdAt: String(parsed.createdAt ?? parsed.requestedAt ?? new Date().toISOString()),
      updatedAt: String(parsed.updatedAt ?? parsed.createdAt ?? new Date().toISOString()),
      startedAt: parsed.startedAt ?? null,
      completedAt: parsed.completedAt ?? null,
      finishedAt: parsed.finishedAt ?? parsed.completedAt ?? null,
      pdfKey: parsed.pdfKey ?? parsed.pdfObjectKey ?? null,
      pdfObjectKey: parsed.pdfObjectKey ?? parsed.pdfKey ?? null,
      pdfUrl: parsed.pdfUrl ?? null,
      pdfBytes: parsed.pdfBytes ?? null,
      renderMs: parsed.renderMs ?? null,
      errorCode: parsed.errorCode ?? null,
      errorMessage: parsed.errorMessage ?? parsed.error ?? null,
      error: parsed.error ?? parsed.errorMessage ?? null,
      rendererVersion: parsed.rendererVersion ?? null,
      executionName: parsed.executionName ?? null,
      executionDispatchedAt: parsed.executionDispatchedAt ?? null,
      renderStartedAt: parsed.renderStartedAt ?? parsed.startedAt ?? null,
      renderFinishedAt: parsed.renderFinishedAt ?? parsed.finishedAt ?? parsed.completedAt ?? null,
      failureStage: parsed.failureStage ?? null,
      errorSummary: parsed.errorSummary ?? parsed.errorMessage ?? parsed.error ?? null,
      errorDetails: parsed.errorDetails ?? null,
      requestedBy: parsed.requestedBy ?? parsed.source ?? null,
      attempt: Number.isFinite(parsed.attempt) ? Number(parsed.attempt) : 1,
    };
    logRenderInfo(env, "debug", "[DBG_RENDER_JOB_STORE_READ]", {
      jobId,
      status: normalized.status,
      store: store.store,
      key,
      found: true,
    });
    return normalized;
  } catch {
    logRenderInfo(env, "debug", "[DBG_RENDER_JOB_STORE_READ]", {
      jobId,
      status: null,
      store: store.store,
      key,
      found: false,
    });
    return null;
  }
};

const RENDER_JOB_RESTORE_MAX_AGE_MS = 24 * 60 * 60_000;
const ACTIVE_RENDER_JOB_STATUSES = new Set<RenderJobStatus>([
  "queued",
  "leased",
  "dispatched",
  "processing",
  "running",
]);

const getRecordAgeMs = (record: RenderJobRecord) => {
  const base = record.updatedAt ?? record.finishedAt ?? record.createdAt ?? record.requestedAt;
  const parsed = Date.parse(base ?? "");
  if (!Number.isFinite(parsed)) return null;
  return Date.now() - parsed;
};

const shouldRestoreLatestRenderJob = (record: RenderJobRecord) => {
  if (ACTIVE_RENDER_JOB_STATUSES.has(record.status)) return true;
  const ageMs = getRecordAgeMs(record);
  if (ageMs == null) return false;
  return ageMs <= RENDER_JOB_RESTORE_MAX_AGE_MS;
};

const compareRenderJobRecordDesc = (left: RenderJobRecord, right: RenderJobRecord) => {
  const rightTime = Date.parse(right.createdAt ?? right.requestedAt ?? "") || 0;
  const leftTime = Date.parse(left.createdAt ?? left.requestedAt ?? "") || 0;
  return rightTime - leftTime;
};

const listRenderJobRecords = async (env: Env): Promise<RenderJobRecord[]> => {
  const store = getRenderJobsStore(env);
  if (!store) return [];
  const records: RenderJobRecord[] = [];
  let cursor: string | undefined;
  do {
    const page = await store.kv.list({ prefix: "render_job:", cursor });
    for (const key of page.keys) {
      const jobId = key.name.slice("render_job:".length);
      if (!jobId || jobId.startsWith("payload:") || jobId.startsWith("dedup:")) continue;
      const record = await getRenderJobRecord(env, jobId);
      if (record) records.push(record);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return records;
};

const findActiveRenderJobForRecord = async (
  env: Env,
  args: { tenantKey: string; templateId: string; recordId: string; mode: RenderJobMode },
): Promise<RenderJobRecord | null> => {
  const records = await listRenderJobRecords(env);
  const matched = records
    .filter((record) =>
      record.tenantKey === args.tenantKey &&
      record.templateId === args.templateId &&
      record.recordId === args.recordId &&
      record.mode === args.mode &&
      ACTIVE_RENDER_JOB_STATUSES.has(record.status),
    )
    .sort(compareRenderJobRecordDesc);
  return matched[0] ?? null;
};

const findLatestRenderJobForRecord = async (
  env: Env,
  args: { tenantKey: string; templateId: string; recordId: string; mode: RenderJobMode },
): Promise<RenderJobRecord | null> => {
  const records = await listRenderJobRecords(env);
  const matched = records
    .filter((record) =>
      record.tenantKey === args.tenantKey &&
      record.templateId === args.templateId &&
      record.recordId === args.recordId &&
      record.mode === args.mode &&
      shouldRestoreLatestRenderJob(record),
    )
    .sort((left, right) => {
      const leftActive = ACTIVE_RENDER_JOB_STATUSES.has(left.status) ? 1 : 0;
      const rightActive = ACTIVE_RENDER_JOB_STATUSES.has(right.status) ? 1 : 0;
      if (leftActive !== rightActive) return rightActive - leftActive;
      return compareRenderJobRecordDesc(left, right);
    });
  return matched[0] ?? null;
};

const updateRenderJobStatus = async (
  env: Env,
  jobId: string,
  patch: Partial<RenderJobRecord> & { status: RenderJobStatus },
) => {
  const current = await getRenderJobRecord(env, jobId);
  if (!current) return null;
  const now = new Date().toISOString();
  const next: RenderJobRecord = {
    ...current,
    ...patch,
    updatedAt: patch.updatedAt ?? now,
  };
  await putRenderJobRecord(env, next);
  logRenderJobEvent("[DBG_RENDER_JOB_STATUS_UPDATE]", env, next, undefined, "debug");
  return next;
};

const createRenderJobRecord = async (env: Env, record: RenderJobRecord) => {
  await putRenderJobRecord(env, record);
  logRenderJobEvent("[DBG_RENDER_JOB_CREATE]", env, record);
  return record;
};

const putStoredRenderJobPayload = async (env: Env, payload: StoredRenderJobPayload) => {
  const store = getRenderJobsStore(env);
  if (!store) throw new Error("RENDER_JOBS_KV_OR_RENDER_CACHE_REQUIRED");
  const key = buildRenderJobPayloadKey(payload.jobId);
  await store.kv.put(key, JSON.stringify(payload), {
    expirationTtl: DEFAULT_RENDER_JOB_PAYLOAD_TTL_SECONDS,
  });
  logRenderInfo(env, "debug", "[DBG_RENDER_JOB_PAYLOAD_STORE_WRITE]", {
    jobId: payload.jobId,
    key,
    status: payload.record.status,
  });
};

const getStoredRenderJobPayload = async (
  env: Env,
  jobId: string,
): Promise<StoredRenderJobPayload | null> => {
  const store = getRenderJobsStore(env);
  if (!store) return null;
  const key = buildRenderJobPayloadKey(jobId);
  const raw = await store.kv.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredRenderJobPayload;
  } catch {
    return null;
  }
};

const markRenderJobRunning = async (env: Env, jobId: string, patch?: Partial<RenderJobRecord>) => {
  const next = await updateRenderJobStatus(env, jobId, {
    ...patch,
    status: "running",
    startedAt: patch?.startedAt ?? new Date().toISOString(),
    renderStartedAt: patch?.renderStartedAt ?? new Date().toISOString(),
    error: null,
    errorCode: null,
    errorMessage: null,
  });
  if (next) {
    logRenderJobEvent("[DBG_RENDER_JOB_START]", env, next, {
      attempt: next.attempt,
    }, "debug");
    logRenderInfo(env, "always", "[RENDER_JOB_STARTED]", {
      jobId: next.jobId,
      templateId: next.templateId,
      recordId: next.recordId,
      tenantKey: next.tenantKey,
      executionName: next.executionName ?? null,
      status: "running",
    });
  }
  return next;
};

const markRenderJobLeased = async (
  env: Env,
  jobId: string,
  patch?: Partial<RenderJobRecord>,
) =>
  updateRenderJobStatus(env, jobId, {
    ...patch,
    status: "leased",
    error: null,
    errorCode: null,
    errorMessage: null,
  });

const markRenderJobDispatched = async (
  env: Env,
  jobId: string,
  patch?: Partial<RenderJobRecord>,
) =>
  updateRenderJobStatus(env, jobId, {
    ...patch,
    status: "dispatched",
    executionDispatchedAt: patch?.executionDispatchedAt ?? new Date().toISOString(),
    error: null,
    errorCode: null,
    errorMessage: null,
  });

const markRenderJobProcessing = async (
  env: Env,
  jobId: string,
  patch?: Partial<RenderJobRecord>,
) => {
  const next = await updateRenderJobStatus(env, jobId, {
    ...patch,
    status: "processing",
    startedAt: patch?.startedAt ?? new Date().toISOString(),
    error: null,
    errorCode: null,
    errorMessage: null,
  });
  if (next) {
    logRenderJobEvent("[DBG_RENDER_JOB_START]", env, next, {
      attempt: next.attempt,
    }, "debug");
  }
  return next;
};

const markRenderJobDone = async (
  env: Env,
  jobId: string,
  patch: {
    pdfKey: string;
    pdfBytes: number;
    renderMs: number;
    rendererVersion: string;
    finishedAt?: string;
    executionName?: string | null;
    renderStartedAt?: string | null;
    renderFinishedAt?: string | null;
  },
) => {
  const finishedAt = patch.finishedAt ?? new Date().toISOString();
  const next = await updateRenderJobStatus(env, jobId, {
    status: "done",
    finishedAt,
    completedAt: finishedAt,
    pdfKey: patch.pdfKey,
    pdfObjectKey: patch.pdfKey,
    pdfUrl: buildRenderJobPdfPath(jobId),
    pdfBytes: patch.pdfBytes,
    renderMs: patch.renderMs,
    rendererVersion: patch.rendererVersion,
    executionName: patch.executionName ?? null,
    renderStartedAt: patch.renderStartedAt ?? finishedAt,
    renderFinishedAt: patch.renderFinishedAt ?? finishedAt,
    failureStage: null,
    errorSummary: null,
    errorDetails: null,
    error: null,
    errorCode: null,
    errorMessage: null,
  });
  if (next) {
    logRenderJobEvent("[DBG_RENDER_JOB_DONE]", env, next);
    logRenderInfo(env, "always", "[RENDER_JOB_DONE]", {
      jobId: next.jobId,
      templateId: next.templateId,
      recordId: next.recordId,
      tenantKey: next.tenantKey,
      executionName: next.executionName ?? null,
      status: "done",
    });
  }
  return next;
};

const markRenderJobFailed = async (
  env: Env,
  jobId: string,
  patch: {
    errorCode: RendererErrorCode;
    errorMessage: string;
    rendererVersion?: string | null;
    finishedAt?: string;
    executionName?: string | null;
    renderStartedAt?: string | null;
    renderFinishedAt?: string | null;
    failureStage?: string | null;
    errorSummary?: string | null;
    errorDetails?: string | null;
  },
) => {
  const finishedAt = patch.finishedAt ?? new Date().toISOString();
  const next = await updateRenderJobStatus(env, jobId, {
    status: "failed",
    finishedAt,
    completedAt: finishedAt,
    pdfUrl: null,
    executionName: patch.executionName ?? null,
    renderStartedAt: patch.renderStartedAt ?? null,
    renderFinishedAt: patch.renderFinishedAt ?? finishedAt,
    failureStage: patch.failureStage ?? null,
    errorCode: patch.errorCode,
    errorMessage: patch.errorMessage,
    errorSummary: patch.errorSummary ?? patch.errorMessage,
    errorDetails: patch.errorDetails ?? null,
    error: patch.errorMessage,
    rendererVersion: patch.rendererVersion ?? null,
  });
  if (next) {
    logRenderJobEvent("[DBG_RENDER_JOB_FAILED]", env, next, {
      errorMessage: next.errorMessage,
    });
    logRenderInfo(env, "always", "[RENDER_JOB_ERROR]", {
      jobId: next.jobId,
      templateId: next.templateId,
      recordId: next.recordId,
      tenantKey: next.tenantKey,
      executionName: next.executionName ?? null,
      status: "error",
      errorCode: next.errorCode ?? null,
    });
  }
  return next;
};

const reconcileRenderJobDoneFromOutput = async (
  env: Env,
  record: RenderJobRecord,
): Promise<RenderJobRecord> => {
  if (record.status === "done") return record;
  if (!env.TENANT_ASSETS) return record;
  const pdfObjectKey = record.pdfKey ?? record.pdfObjectKey ?? buildRenderOutputKey(record.jobId);
  const object = await env.TENANT_ASSETS.head(pdfObjectKey);
  if (!object) return record;
  const updated = await updateRenderJobStatus(env, record.jobId, {
    status: "done",
    finishedAt: record.finishedAt ?? new Date().toISOString(),
    completedAt: record.completedAt ?? record.finishedAt ?? new Date().toISOString(),
    renderFinishedAt: record.renderFinishedAt ?? record.finishedAt ?? new Date().toISOString(),
    pdfKey: pdfObjectKey,
    pdfObjectKey,
    pdfBytes: object.size ?? record.pdfBytes ?? null,
    error: null,
    errorCode: null,
    errorMessage: null,
  });
  return updated ?? { ...record, status: "done", pdfKey: pdfObjectKey, pdfObjectKey };
};

const clearRenderJobDedup = async (env: Env, record: Pick<RenderJobRecord, "jobId" | "dedupKey">) => {
  const jobsKv = getRenderJobsKv(env);
  if (!jobsKv || !record.dedupKey) return;
  const dedupJobId = await jobsKv.get(record.dedupKey);
  if (dedupJobId === record.jobId) {
    await jobsKv.delete(record.dedupKey);
  }
};

const getRenderJobAgeMs = (record: Pick<RenderJobRecord, "updatedAt" | "createdAt" | "requestedAt">) => {
  const base = record.updatedAt || record.createdAt || record.requestedAt;
  const parsed = base ? Date.parse(base) : Number.NaN;
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Date.now() - parsed);
};

const normalizeRenderJobIdValue = (
  value: unknown,
  fieldName: "recordId" | "recordRevision",
): { value: string; type: "string" | "number" } | null => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    return { value: trimmed, type: "string" };
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return { value: String(value), type: "number" };
  }
  if (value === null || value === undefined) {
    return null;
  }
  console.warn("[WARN_RENDER_JOB_INVALID_TYPE]", {
    fieldName,
    receivedType: Array.isArray(value) ? "array" : typeof value,
  });
  return null;
};

const normalizeKintoneRecordForRender = (
  rawRecord: Record<string, unknown>,
): Record<string, unknown> => {
  const normalized: Record<string, unknown> = {};
  for (const [fieldCode, rawField] of Object.entries(rawRecord)) {
    if (!rawField || typeof rawField !== "object" || Array.isArray(rawField)) {
      normalized[fieldCode] = rawField;
      continue;
    }
    const fieldObj = rawField as { type?: unknown; value?: unknown };
    const fieldType = typeof fieldObj.type === "string" ? fieldObj.type : "";
    const fieldValue = fieldObj.value;
    if (fieldType === "SUBTABLE") {
      if (!Array.isArray(fieldValue)) {
        normalized[fieldCode] = [];
        continue;
      }
      normalized[fieldCode] = fieldValue.map((row) => {
        if (!row || typeof row !== "object" || Array.isArray(row)) {
          return row;
        }
        const rowValue = "value" in row ? (row as { value?: unknown }).value : row;
        if (!rowValue || typeof rowValue !== "object" || Array.isArray(rowValue)) {
          return rowValue;
        }
        const normalizedRow: Record<string, unknown> = {};
        for (const [colCode, colRaw] of Object.entries(rowValue as Record<string, unknown>)) {
          if (
            colRaw &&
            typeof colRaw === "object" &&
            !Array.isArray(colRaw) &&
            "value" in colRaw
          ) {
            normalizedRow[colCode] = (colRaw as { value?: unknown }).value;
          } else {
            normalizedRow[colCode] = colRaw;
          }
        }
        return normalizedRow;
      });
      continue;
    }
    if ("value" in fieldObj) {
      normalized[fieldCode] = fieldValue;
      continue;
    }
    normalized[fieldCode] = rawField;
  }
  return normalized;
};

const resolveTenantStoredKintoneApiToken = (
  tenantRecord: Awaited<ReturnType<typeof getTenantRecord>>,
  appIdRaw: string,
): string => {
  if (!tenantRecord) return "";
  const appIdStr = String(appIdRaw ?? "").trim();
  let normalizedAppId = "";
  try {
    normalizedAppId = canonicalizeAppId(appIdStr);
  } catch {
    normalizedAppId = "";
  }
  const appIdForLookup = normalizedAppId || appIdStr;
  if (!appIdForLookup) return "";
  const token =
    tenantRecord.tokensByAppId?.[appIdForLookup] ??
    tenantRecord.tokensByAppId?.[appIdStr] ??
    tenantRecord.tokensByAppId?.[normalizedAppId] ??
    (tenantRecord.appId === appIdForLookup ? tenantRecord.kintoneApiToken : undefined) ??
    tenantRecord.kintoneApiToken;
  return token?.trim() ?? "";
};

const resolveSessionKintoneApiToken = async (
  env: Env,
  sessionToken: string,
  tenantKey: string,
  appId: string,
): Promise<string> => {
  if (!sessionToken) {
    logRenderInfo(env, "debug", "[DBG_RENDER_JOB_SESSION_RESOLVE]", {
      hasSessionToken: false,
      sessionFound: false,
      tenantKey,
      appId: String(appId ?? ""),
      hasSessionData: false,
      hasTokensByAppId: false,
      availableAppIds: [],
      resolvedFromAppId: null,
      hasResolvedToken: false,
    });
    return "";
  }
  const appIdStr = String(appId ?? "").trim();
  const loaded = await loadEditorSession(env, sessionToken);
  if ("error" in loaded) {
    logRenderInfo(env, "debug", "[DBG_RENDER_JOB_SESSION_RESOLVE]", {
      hasSessionToken: true,
      sessionFound: false,
      tenantKey,
      appId: appIdStr,
      hasSessionData: false,
      hasTokensByAppId: false,
      availableAppIds: [],
      resolvedFromAppId: null,
      hasResolvedToken: false,
    });
    return "";
  }
  let sessionTenantKey = "";
  try {
    sessionTenantKey = buildTenantKey(
      loaded.session.kintoneBaseUrl,
      loaded.session.appId,
    );
  } catch {
    logRenderInfo(env, "debug", "[DBG_RENDER_JOB_SESSION_RESOLVE]", {
      hasSessionToken: true,
      sessionFound: true,
      tenantKey,
      appId: appIdStr,
      hasSessionData: true,
      hasTokensByAppId: false,
      availableAppIds: [],
      resolvedFromAppId: null,
      hasResolvedToken: false,
    });
    return "";
  }
  if (sessionTenantKey !== tenantKey) {
    logRenderInfo(env, "debug", "[DBG_RENDER_JOB_SESSION_RESOLVE]", {
      hasSessionToken: true,
      sessionFound: true,
      tenantKey,
      appId: appIdStr,
      hasSessionData: true,
      hasTokensByAppId: false,
      availableAppIds: [],
      resolvedFromAppId: null,
      hasResolvedToken: false,
    });
    return "";
  }

  const availableSessionAppIds = loaded.session.tokensByAppId
    ? Object.keys(loaded.session.tokensByAppId)
    : [];
  let normalizedAppId = "";
  try {
    normalizedAppId = canonicalizeAppId(appIdStr);
  } catch {
    normalizedAppId = "";
  }
  const sessionMapToken =
    loaded.session.tokensByAppId?.[appIdStr] ??
    (normalizedAppId ? loaded.session.tokensByAppId?.[normalizedAppId] : undefined) ??
    "";
  if (sessionMapToken) {
    logRenderInfo(env, "debug", "[DBG_RENDER_JOB_SESSION_RESOLVE]", {
      hasSessionToken: true,
      sessionFound: true,
      tenantKey,
      appId: appIdStr,
      hasSessionData: true,
      hasTokensByAppId: availableSessionAppIds.length > 0,
      availableAppIds: availableSessionAppIds,
      resolvedFromAppId:
        loaded.session.tokensByAppId?.[appIdStr] ? appIdStr : normalizedAppId || appIdStr,
      hasResolvedToken: true,
    });
    return String(sessionMapToken).trim();
  }

  const directToken = loaded.session.kintoneApiToken?.trim() ?? "";
  if (directToken) {
    logRenderInfo(env, "debug", "[DBG_RENDER_JOB_SESSION_RESOLVE]", {
      hasSessionToken: true,
      sessionFound: true,
      tenantKey,
      appId: appIdStr,
      hasSessionData: true,
      hasTokensByAppId: availableSessionAppIds.length > 0,
      availableAppIds: availableSessionAppIds,
      resolvedFromAppId: appIdStr || null,
      hasResolvedToken: true,
    });
    return directToken;
  }

  const tenantRecord = await getTenantRecord(env.USER_TEMPLATES_KV, tenantKey);
  const availableTenantAppIds = tenantRecord?.tokensByAppId
    ? Object.keys(tenantRecord.tokensByAppId)
    : [];
  const availableAppIds = [
    ...new Set([...availableSessionAppIds, ...availableTenantAppIds]),
  ];
  const tenantToken = resolveTenantStoredKintoneApiToken(tenantRecord, appId);
  if (!tenantToken || !env.SESSIONS_KV) {
    logRenderInfo(env, "debug", "[DBG_RENDER_JOB_SESSION_RESOLVE]", {
      hasSessionToken: true,
      sessionFound: true,
      tenantKey,
      appId: appIdStr,
      hasSessionData: true,
      hasTokensByAppId: availableAppIds.length > 0,
      availableAppIds,
      resolvedFromAppId: tenantToken ? appIdStr || null : null,
      hasResolvedToken: Boolean(tenantToken),
    });
    return tenantToken;
  }

  const ttlSeconds = Math.max(
    1,
    Math.floor((loaded.session.expiresAt - Date.now()) / 1000),
  );
  if (ttlSeconds > 0) {
    const nextTokensByAppId = {
      ...(loaded.session.tokensByAppId ?? {}),
      [normalizedAppId || appIdStr]: tenantToken,
    };
    await env.SESSIONS_KV.put(
      `editor_session:${sessionToken}`,
      JSON.stringify({
        ...loaded.session,
        tenantKey: loaded.session.tenantKey,
        kintoneApiToken: tenantToken,
        tokensByAppId: nextTokensByAppId,
      }),
      { expirationTtl: ttlSeconds },
    );
  }
  logRenderInfo(env, "debug", "[DBG_RENDER_JOB_SESSION_RESOLVE]", {
    hasSessionToken: true,
    sessionFound: true,
    tenantKey,
    appId: appIdStr,
    hasSessionData: true,
    hasTokensByAppId: availableAppIds.length > 0,
    availableAppIds,
    resolvedFromAppId: appIdStr || null,
    hasResolvedToken: true,
  });
  return tenantToken;
};

const fetchKintoneRecordForJob = async (
  env: Env,
  payload: RenderJobMessage,
): Promise<Record<string, unknown>> => {
  let token = "";
  let tokenSource: "session" | "body" | "missing" = "missing";
  if (payload.sessionToken) {
    token = await resolveSessionKintoneApiToken(
      env,
      payload.sessionToken,
      payload.tenantKey,
      payload.appId,
    );
    if (token) tokenSource = "session";
  }
  if (!token) {
    const tenantRecord = await getTenantRecord(env.USER_TEMPLATES_KV, payload.tenantKey);
    const tenantToken = resolveTenantStoredKintoneApiToken(tenantRecord, payload.appId);
    if (tenantToken) {
      token = tenantToken;
      tokenSource = payload.sessionToken ? "session" : "body";
    }
  }
  if (!token) {
    token = payload.kintoneApiToken?.trim() ?? "";
    if (token) tokenSource = "body";
  }
  logRenderInfo(env, "debug", "[DBG_RENDER_JOB_KINTONE_AUTH]", {
    jobId: payload.jobId,
    tenantKey: payload.tenantKey,
    hasToken: Boolean(token),
    tokenSource,
  });
  if (!token) {
    throw new Error(`Missing kintoneApiToken for tenant=${payload.tenantKey} app=${payload.appId}`);
  }
  const endpoint = `${payload.kintoneBaseUrl.replace(/\/$/, "")}/k/v1/record.json?app=${encodeURIComponent(
    payload.appId,
  )}&id=${encodeURIComponent(payload.recordId)}`;
  const res = await fetch(endpoint, {
    headers: {
      "X-Cybozu-API-Token": token,
    },
  });
  if (!res.ok) {
    const bodyText = await res.text();
    throw new Error(`Kintone record fetch failed (${res.status}): ${bodyText.slice(0, 300)}`);
  }
  const payloadJson = (await res.json()) as {
    record?: Record<string, unknown>;
    revision?: string | number;
  };
  const rawRecord = payloadJson.record ?? {};
  const record = normalizeKintoneRecordForRender(rawRecord);
  const responseRevision = payloadJson.revision == null ? "" : String(payloadJson.revision).trim();
  const recordRevision = payload.recordRevision || responseRevision;
  if (recordRevision) {
    (record as Record<string, unknown>).recordRevision = recordRevision;
    (record as Record<string, unknown>).revision = recordRevision;
  }
  (record as Record<string, unknown>).recordId = payload.recordId;
  for (const [fieldCode, rawField] of Object.entries(rawRecord)) {
    if (!rawField || typeof rawField !== "object" || Array.isArray(rawField)) continue;
    const fieldObj = rawField as { type?: unknown; value?: unknown };
    if (fieldObj.type !== "SUBTABLE") continue;
    const normalizedRows = (record as Record<string, unknown>)[fieldCode];
    const rawRows = fieldObj.value;
    logRenderInfo(env, "debug", "[DBG_RENDER_JOB_RECORD_SHAPE]", {
      recordId: payload.recordId,
      tableFieldCode: fieldCode,
      isArray: Array.isArray(normalizedRows),
      valueType: Array.isArray(rawRows) ? "array" : typeof rawRows,
      rowCount: Array.isArray(normalizedRows) ? normalizedRows.length : 0,
    });
  }
  return record;
};

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
      logRenderInfo(env, "debug", "[DBG_TENANT_LOGO_AUTH]", {
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
      logRenderInfo(env, "debug", "[DBG_TENANT_LOGO_AUTH]", {
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
      logRenderInfo(env, "debug", "[DBG_TENANT_LOGO_AUTH]", {
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
    logRenderInfo(env, "debug", "[DBG_TENANT_LOGO_AUTH]", {
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
    logRenderInfo(env, "debug", "[DBG_TENANT_LOGO_AUTH]", {
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
    logRenderInfo(env, "debug", "[DBG_TENANT_LOGO_AUTH]", {
      hasApiKey,
      hasBearer,
      authMode: "admin",
      tenantKeyResolved: null,
      tenantKeyQuery: null,
      ok: false,
    });
    return { error: queryResult.error };
  }

  logRenderInfo(env, "debug", "[DBG_TENANT_LOGO_AUTH]", {
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

const authorizeRenderJobAccess = async (
  request: Request,
  env: Env,
  tenantKey: string,
  url?: URL,
): Promise<Response | null> => {
  const authHeader = request.headers.get("Authorization") ?? "";
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const hasBearer = Boolean(bearerToken);
  const sessionToken =
    (request.headers.get("x-session-token") ?? url?.searchParams.get("sessionToken") ?? "").trim();
  const apiKeyHeader = request.headers.get("x-api-key") ?? "";
  const hasApiKey = env.ADMIN_API_KEY
    ? apiKeyHeader === env.ADMIN_API_KEY
    : Boolean(apiKeyHeader);
  if (sessionToken) {
    const loaded = await loadEditorSession(env, sessionToken);
    if ("error" in loaded) {
      return jsonError(401, { error: "UNAUTHORIZED", reason: "missing token or invalid" });
    }
    let sessionTenantKey = "";
    try {
      sessionTenantKey = buildTenantKey(loaded.session.kintoneBaseUrl, loaded.session.appId);
    } catch {
      return jsonError(401, { error: "UNAUTHORIZED", reason: "missing token or invalid" });
    }
    if (sessionTenantKey !== tenantKey) {
      return jsonError(403, { error: "FORBIDDEN", reason: "tenant mismatch" });
    }
    return null;
  }
  if (hasBearer) {
    const verified = await verifyEditorToken(env.USER_TEMPLATES_KV, bearerToken);
    if (!verified) {
      return jsonError(401, { error: "UNAUTHORIZED", reason: "missing token or invalid" });
    }
    if (verified.tenantId !== tenantKey) {
      return jsonError(403, { error: "FORBIDDEN", reason: "tenant mismatch" });
    }
    return null;
  }
  if (env.ADMIN_API_KEY && !hasApiKey) {
    return jsonError(401, { error: "UNAUTHORIZED", reason: "missing token or invalid" });
  }
  return null;
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
      return applyEstimateV1PresetPatch(
        canonicalizeTemplateForStorage(parsed as TemplateDefinition),
      );
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
      return applyEstimateV1PresetPatch(
        canonicalizeTemplateForStorage(reconstructed),
      );
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

const handleHttpRequest = async (request: Request, env: Env): Promise<Response> => {
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

        const tenantKey = buildTenantKey(kintoneBaseUrl, appId);
        const existingTenant = await getTenantRecord(env.USER_TEMPLATES_KV, tenantKey);
        const incomingToken = (
          payload.kintoneApiToken ??
          request.headers.get("x-kintone-api-token") ??
          ""
        ).trim();
        const tokensByAppId: Record<string, string> = {
          ...(existingTenant?.tokensByAppId ?? {}),
        };
        if (incomingToken) {
          tokensByAppId[appId] = incomingToken;
        } else if (
          existingTenant?.kintoneApiToken &&
          !tokensByAppId[appId]
        ) {
          tokensByAppId[appId] = existingTenant.kintoneApiToken;
        }
        console.info("[DBG_SESSION_SOURCE]", {
          tenantKey,
          appId,
          hasTenantRecord: Boolean(existingTenant),
          tenantRecordKeys: existingTenant ? Object.keys(existingTenant) : [],
          hasTokensByAppId: Object.keys(existingTenant?.tokensByAppId ?? {}).length > 0,
          availableAppIds: Object.keys(existingTenant?.tokensByAppId ?? {}),
          hasDirectKintoneApiToken: Boolean(existingTenant?.kintoneApiToken),
          directTokenAppId: existingTenant?.appId ?? null,
        });
        const resolvedSessionToken =
          incomingToken ||
          tokensByAppId[appId] ||
          (existingTenant?.appId === appId ? existingTenant?.kintoneApiToken : undefined) ||
          existingTenant?.kintoneApiToken ||
          "";
        if (incomingToken) {
          if (existingTenant) {
            await upsertTenantApiToken(env.USER_TEMPLATES_KV, tenantKey, appId, incomingToken);
          } else {
            await registerTenant(env.USER_TEMPLATES_KV, {
              kintoneBaseUrl,
              appId,
              kintoneApiToken: incomingToken,
            });
          }
        }

        const sessionToken =
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? `st_${crypto.randomUUID()}`
            : `st_${Date.now()}`;
        const expiresAt = Date.now() + SESSION_TTL_SECONDS * 1000;
        const key = `editor_session:${sessionToken}`;
        const value = JSON.stringify({
          tenantKey,
          kintoneBaseUrl,
          appId,
          expiresAt,
          kintoneApiToken: resolvedSessionToken || undefined,
          tokensByAppId: Object.keys(tokensByAppId).length > 0 ? tokensByAppId : undefined,
          companyProfile: normalizeCompanyProfile(payload.companyProfile),
        });
        await env.SESSIONS_KV.put(key, value, { expirationTtl: SESSION_TTL_SECONDS });

        console.info("[editor/session] issued", { sessionToken: sessionToken.slice(0, 8) });
        console.info("[DBG_SESSION_CREATE]", {
          tenantKey,
          appId,
          hasTokensByAppId: Object.keys(tokensByAppId).length > 0,
          availableAppIds: Object.keys(tokensByAppId),
        });

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

        let payload: {
          token?: string;
          sessionToken?: string;
          kintoneApiToken?: string;
          appId?: string | number;
          kintoneBaseUrl?: string;
        };
        try {
          payload = (await request.json()) as {
            token?: string;
            sessionToken?: string;
            kintoneApiToken?: string;
            appId?: string | number;
            kintoneBaseUrl?: string;
          };
        } catch {
          return new Response("Invalid JSON body", {
            status: 400,
            headers: CORS_HEADERS,
          });
        }

        const token = String(payload?.sessionToken ?? payload?.token ?? "").trim();
        console.info("[editor/session] exchange payload", {
          hasKintoneApiToken: Boolean(payload?.kintoneApiToken),
          tokenLength: payload?.kintoneApiToken?.length ?? 0,
          hasSessionToken: Boolean(token),
          appId: payload?.appId ?? null,
          kintoneBaseUrl: payload?.kintoneBaseUrl ?? null,
        });
        const loaded = await loadEditorSession(env, token);
        if ("error" in loaded) return loaded.error;

        const session = loaded.session;
        const incomingToken = payload?.kintoneApiToken?.trim() ?? "";
        if (incomingToken && incomingToken !== session.kintoneApiToken) {
          const nextTokensByAppId = {
            ...(session.tokensByAppId ?? {}),
            [session.appId]: incomingToken,
          };
          const key = `editor_session:${token}`;
          const ttlSeconds = Math.max(
            1,
            Math.floor((session.expiresAt - Date.now()) / 1000),
          );
          await env.SESSIONS_KV.put(
            key,
            JSON.stringify({
              ...session,
              tenantKey: session.tenantKey,
              kintoneApiToken: incomingToken,
              tokensByAppId: nextTokensByAppId,
            }),
            { expirationTtl: ttlSeconds },
          );
          session.kintoneApiToken = incomingToken;
          session.tokensByAppId = nextTokensByAppId;
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

        const resolvedToken =
          incomingToken ||
          session.kintoneApiToken?.trim() ||
          resolveTenantStoredKintoneApiToken(record, canonicalAppId);
        const nextTokensByAppId = {
          ...(session.tokensByAppId ?? {}),
        };
        if (resolvedToken) {
          nextTokensByAppId[canonicalAppId] = resolvedToken;
        }
        const ttlSeconds = Math.max(
          1,
          Math.floor((session.expiresAt - Date.now()) / 1000),
        );
        const sessionKey = `editor_session:${token}`;
        await env.SESSIONS_KV.put(
          sessionKey,
          JSON.stringify({
            ...session,
            tenantKey: tenantId,
            appId: canonicalAppId,
            kintoneApiToken: resolvedToken || undefined,
            tokensByAppId: Object.keys(nextTokensByAppId).length > 0 ? nextTokensByAppId : undefined,
          }),
          { expirationTtl: ttlSeconds },
        );
        session.kintoneApiToken = resolvedToken || undefined;
        session.tokensByAppId =
          Object.keys(nextTokensByAppId).length > 0 ? nextTokensByAppId : undefined;

        const issued = await issueEditorToken(record.tenantId, record.tenantSecret);
        const expiresAt = new Date(issued.expiresAt).getTime();

        console.info("[editor/session] exchanged", {
          tenantId: record.tenantId,
          hasToken: Boolean(session.kintoneApiToken),
          tokenLength: session.kintoneApiToken?.length ?? 0,
        });
        console.info("[DBG_SESSION_CREATE]", {
          tenantKey: tenantId,
          appId: canonicalAppId,
          hasTokensByAppId: Object.keys(session.tokensByAppId ?? {}).length > 0,
          availableAppIds: Object.keys(session.tokensByAppId ?? {}),
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
        console.info("[DBG_LOGO_NORMALIZE]", {
          originalBytes: file.size,
          normalizedBytes: buf.byteLength,
          contentType: normalizedContentType,
        });
        const maxBytes =
          normalizedContentType === "image/png"
            ? LOGO_MAX_STORED_BYTES_PNG
            : LOGO_MAX_STORED_BYTES;
        if (buf.byteLength > maxBytes) {
          return new Response(
            JSON.stringify({
              errorCode: "LOGO_TOO_LARGE",
              message: "Image too large after normalization",
              bytes: buf.byteLength,
              maxBytes,
            }),
            {
              status: 413,
              headers: {
                ...CORS_HEADERS,
                "Content-Type": "application/json",
              },
            },
          );
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

      // Background PDF build (estimate_v1)
      if (url.pathname === "/backgrounds/build" && request.method === "POST") {
        const authHeader = request.headers.get("Authorization") ?? "";
        const hasBearer = authHeader.startsWith("Bearer ");
        const bearerToken = hasBearer ? authHeader.slice(7) : "";
        const apiKeyHeader = request.headers.get("x-api-key") ?? "";
        const hasApiKey = env.ADMIN_API_KEY
          ? apiKeyHeader === env.ADMIN_API_KEY
          : Boolean(apiKeyHeader);
        if (!env.TENANT_ASSETS) {
          return jsonError(500, { error: "TENANT_ASSETS not configured" });
        }
        let body:
          | {
              templateId?: string;
              template?: TemplateDefinition;
              jpFontFamily?: JpFontFamily;
              kintone?: { baseUrl?: string; appId?: string | number };
              kintoneBaseUrl?: string;
              appId?: string | number;
              baseUrl?: string;
            }
          | null = null;
        try {
          body = (await request.json()) as typeof body;
          console.log("[DBG_BACKGROUND_BUILD_BODY]", body);
        } catch (err) {
          console.error("[DBG_BACKGROUND_BUILD_PARSE_ERROR]", err);
          return new Response(
            JSON.stringify({ error: "BAD_REQUEST", reason: "invalid json body" }),
            { status: 400, headers: { "content-type": "application/json; charset=utf-8" } },
          );
        }

        const templateId = body?.templateId ?? body?.template?.id ?? "";
        const kintoneBaseUrlRaw =
          body?.kintone?.baseUrl ?? body?.kintoneBaseUrl ?? body?.baseUrl ?? null;
        const appIdRaw = body?.kintone?.appId ?? body?.appId ?? null;
        console.log("[DBG_BACKGROUND_BUILD_KEYS]", {
          templateId,
          kintoneBaseUrl: kintoneBaseUrlRaw,
          appId: appIdRaw,
          jpFontFamily:
            body?.jpFontFamily ??
            (url.searchParams.get("jpFontFamily") as JpFontFamily | null) ??
            null,
          raw: body,
        });

        if (!templateId || !kintoneBaseUrlRaw || appIdRaw == null) {
          return new Response(
            JSON.stringify({
              error: "BAD_REQUEST",
              reason: "missing kintone.baseUrl or kintone.appId",
              debug: { templateId, kintoneBaseUrl: kintoneBaseUrlRaw, appId: appIdRaw },
            }),
            { status: 400, headers: { "content-type": "application/json; charset=utf-8" } },
          );
        }

        const appIdStr = String(appIdRaw);
        let tenantKeyFromBody = "";
        try {
          const normalizedBaseUrl = canonicalizeKintoneBaseUrl(kintoneBaseUrlRaw);
          const normalizedAppId = canonicalizeAppId(appIdStr);
          if (!normalizedAppId) {
            return new Response(
              JSON.stringify({
                error: "BAD_REQUEST",
                reason: "missing kintone.baseUrl or kintone.appId",
                debug: { templateId, kintoneBaseUrl: kintoneBaseUrlRaw, appId: appIdRaw },
              }),
              { status: 400, headers: { "content-type": "application/json; charset=utf-8" } },
            );
          }
          tenantKeyFromBody = buildTenantKey(normalizedBaseUrl, normalizedAppId);
        } catch {
          return new Response(
            JSON.stringify({
              error: "BAD_REQUEST",
              reason: "invalid kintone.baseUrl or kintone.appId",
              debug: { templateId, kintoneBaseUrl: kintoneBaseUrlRaw, appId: appIdRaw },
            }),
            { status: 400, headers: { "content-type": "application/json; charset=utf-8" } },
          );
        }

        let authMode: "admin" | "bearer" = "admin";
        let tenantKeyResolved = tenantKeyFromBody;
        if (hasBearer) {
          const verified = await verifyEditorToken(env.USER_TEMPLATES_KV, bearerToken);
          if (!verified) {
            console.info("[DBG_BACKGROUND_AUTH]", {
              hasApiKey,
              hasBearer,
              authMode: "bearer",
              tenantKeyResolved: null,
              ok: false,
            });
            return jsonError(401, { error: "UNAUTHORIZED", reason: "missing token or invalid" });
          }
          authMode = "bearer";
          tenantKeyResolved = verified.tenantId;
          if (tenantKeyResolved !== tenantKeyFromBody) {
            console.info("[DBG_BACKGROUND_AUTH]", {
              hasApiKey,
              hasBearer,
              authMode: "bearer",
              tenantKeyResolved,
              tenantKeyBody: tenantKeyFromBody,
              ok: false,
            });
            return jsonError(403, { error: "FORBIDDEN", reason: "tenant mismatch" });
          }
        } else if (env.ADMIN_API_KEY && !hasApiKey) {
          console.info("[DBG_BACKGROUND_AUTH]", {
            hasApiKey,
            hasBearer,
            authMode: "admin",
            tenantKeyResolved: null,
            ok: false,
          });
          return jsonError(401, { error: "UNAUTHORIZED", reason: "missing token or invalid" });
        }
        console.info("[DBG_BACKGROUND_AUTH]", {
          hasApiKey,
          hasBearer,
          authMode,
          tenantKeyResolved,
          ok: true,
        });
        if (!templateId && !body?.template) {
          return jsonError(400, { error: "MISSING_TEMPLATE" });
        }

        let template: TemplateDefinition | null = null;
        if (body?.template) {
          template = body.template;
        } else if (templateId.startsWith("tpl_")) {
          template = await getUserTemplateById(templateId, env, tenantKeyResolved, {
            enabled: true,
            requestId,
            path: "/backgrounds/build",
          });
        } else {
          template = await getBaseTemplateById(templateId, env);
        }

        if (!template) {
          return jsonError(404, {
            error: "TEMPLATE_LOAD_FAILED",
            errorCode: "TEMPLATE_LOAD_FAILED",
          });
        }
        if (template.structureType !== "estimate_v1") {
          return jsonError(400, { error: "UNSUPPORTED_TEMPLATE" });
        }

        const templateFingerprint = await buildTemplateFingerprint(template);
        const useJpFont = templateHasNonAscii(template);
        const backgroundJpSelection = resolveJpFontSelection(
          env,
          body?.jpFontFamily ?? (url.searchParams.get("jpFontFamily") as JpFontFamily | null),
        );
        const fonts = await loadFonts(env, {
          requireJp: useJpFont,
          jpFontFamily: backgroundJpSelection.requestedFamily,
        });
        const tenantRecordForBackground = await getTenantRecord(env.USER_TEMPLATES_KV, tenantKeyResolved);
        let backgroundTenantLogo:
          | { bytes: Uint8Array; contentType: string; objectKey: string }
          | null = null;
        if (tenantRecordForBackground?.logo) {
          try {
            const logo = await getTenantLogoBytes(
              env,
              tenantKeyResolved,
              tenantRecordForBackground.logo,
            );
            if (logo) {
              backgroundTenantLogo = {
                ...logo,
                objectKey: tenantRecordForBackground.logo.objectKey,
              };
            }
          } catch {
            backgroundTenantLogo = null;
          }
        }
        logRenderInfo(env, "debug", "[DBG_BACKGROUND_FONT_POLICY]", {
          jpBytesLen: fonts.jp?.length ?? 0,
          subset: false,
        });
        logRenderInfo(env, "verbose", "[DBG_JP_FONT_CANDIDATE]", {
          scope: "background_build",
          fontFamily: backgroundJpSelection.requestedFamily,
          resolvedFamily: backgroundJpSelection.resolvedFamily,
          sourceUrl: backgroundJpSelection.sourceUrl,
          fellBackToNoto: backgroundJpSelection.fellBackToNoto,
          fontBytesLen: fonts.jp?.length ?? 0,
          bytesHead: Array.from((fonts.jp ?? new Uint8Array()).slice(0, 16))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join(""),
          subset: false,
          embedOk: !useJpFont || Boolean(fonts.jp),
        });
        const { bytes, stats } = await renderTemplateToPdf(template, undefined, fonts, {
          debug: debugEnabled,
          logLevel: getRenderLogTier(env),
          previewMode: "record",
          renderMode: "layout",
          useJpFont,
          layer: "background",
          includeBackgroundLogo: true,
          tenantLogo: backgroundTenantLogo ?? undefined,
          requestId,
        });
        console.info("[DBG_BACKGROUND_LOGO]", {
          logoFound: Boolean(backgroundTenantLogo?.bytes),
          logoBytesLen: backgroundTenantLogo?.bytes?.length ?? 0,
          drewLogo: stats.companyLogoDrawn,
          contentType: backgroundTenantLogo?.contentType ?? null,
        });
        const backgroundDoc = await PDFDocument.load(bytes);
        const pageCount = backgroundDoc.getPageCount();
        const bgKey = `backgrounds/${tenantKeyResolved}/${templateId}.pdf`;
        const savedAt = new Date().toISOString();
        await env.TENANT_ASSETS.put(bgKey, bytes, {
          httpMetadata: { contentType: "application/pdf" },
          customMetadata: {
            templateId,
            templateFingerprint: templateFingerprint.hash,
            generatedAt: savedAt,
            schemaVersion: TEMPLATE_SCHEMA_VERSION,
            pageCount: String(pageCount),
            includesCompanyLogo: stats.companyLogoDrawn ? "1" : "0",
            hasLogo: stats.companyLogoDrawn ? "1" : "0",
          },
        });
        console.info("[DBG_BACKGROUND_SAVE]", {
          templateId,
          tenantKey: tenantKeyResolved,
          objectKey: bgKey,
          bytesLen: bytes.length,
          fingerprint: templateFingerprint.hash,
          savedAt,
        });
        console.info("[DBG_BACKGROUND_BUILD]", {
          templateId,
          tenantKey: tenantKeyResolved,
          bytesLen: bytes.length,
          fingerprint: templateFingerprint.hash,
        });
        return new Response(
          JSON.stringify({
            ok: true,
            templateId,
            tenantKey: tenantKeyResolved,
            pageCount,
            fingerprint: templateFingerprint.hash,
            bytesLen: bytes.length,
            objectKey: bgKey,
            savedAt,
            includesCompanyLogo: stats.companyLogoDrawn,
            hasLogo: stats.companyLogoDrawn,
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

      // Background PDF build (minimal)
      if (url.pathname === "/backgrounds/build-minimal" && request.method === "POST") {
        const apiKeyHeader = request.headers.get("x-api-key") ?? "";
        const hasApiKey =
          env.ADMIN_API_KEY ? apiKeyHeader === env.ADMIN_API_KEY : Boolean(apiKeyHeader);
        if (!hasApiKey) {
          return jsonError(401, { error: "UNAUTHORIZED", reason: "missing token or invalid" });
        }
        if (!env.TENANT_ASSETS) {
          return jsonError(500, { error: "TENANT_ASSETS not configured" });
        }
        const templateId = url.searchParams.get("templateId") ?? "";
        if (!templateId) {
          return jsonError(400, { error: "BAD_REQUEST", reason: "missing templateId" });
        }
        console.info("[DBG_BUILD_MINIMAL_STEP]", {
          step: "request",
          ok: true,
          templateId,
          tenantKey: null,
        });
        const tenantResult = resolveTenantKeyFromQuery(url);
        if (tenantResult.error) {
          console.info("[DBG_BUILD_MINIMAL_STEP]", {
            step: "tenant",
            ok: false,
            templateId,
            tenantKey: null,
          });
          return tenantResult.error;
        }
        console.info("[DBG_BUILD_MINIMAL_STEP]", {
          step: "tenant",
          ok: true,
          templateId,
          tenantKey: tenantResult.tenantKey,
        });

        const fonts = await loadFonts(env, { requireJp: true });
        if (!fonts.jp) {
          console.info("[DBG_BUILD_MINIMAL_STEP]", {
            step: "fonts",
            ok: false,
            templateId,
            tenantKey: tenantResult.tenantKey,
          });
          return jsonError(500, { error: "JP_FONT_NOT_AVAILABLE" });
        }
        console.info("[DBG_BUILD_MINIMAL_STEP]", {
          step: "fonts",
          ok: true,
          templateId,
          tenantKey: tenantResult.tenantKey,
        });

        const pdfDoc = await PDFDocument.create();
        pdfDoc.registerFontkit(fontkit);
        const jpFont = await pdfDoc.embedFont(fonts.jp, { subset: true });
        const page = pdfDoc.addPage([595, 842]);
        page.drawText("御見積書", { x: 100, y: 700, size: 20, font: jpFont });
        page.drawText("見積番号", { x: 100, y: 660, size: 12, font: jpFont });
        page.drawText("発行日", { x: 100, y: 640, size: 12, font: jpFont });
        const bytes = await pdfDoc.save();

        const objectKey = `backgrounds-minimal/${tenantResult.tenantKey}/${templateId}.pdf`;
        const savedAt = new Date().toISOString();
        try {
          await env.TENANT_ASSETS.put(objectKey, bytes, {
            httpMetadata: { contentType: "application/pdf" },
            customMetadata: {
              templateId,
              generatedAt: savedAt,
            },
          });
          console.info("[DBG_BUILD_MINIMAL_STEP]", {
            step: "save",
            ok: true,
            templateId,
            tenantKey: tenantResult.tenantKey,
          });
        } catch (error) {
          console.info("[DBG_BUILD_MINIMAL_STEP]", {
            step: "save",
            ok: false,
            templateId,
            tenantKey: tenantResult.tenantKey,
          });
          console.warn("[WARN_BUILD_MINIMAL_SAVE]", {
            templateId,
            tenantKey: tenantResult.tenantKey,
            message: error instanceof Error ? error.message : String(error),
          });
        }

        console.info("[DBG_BUILD_MINIMAL_STEP]", {
          step: "return_pdf",
          ok: true,
          templateId,
          tenantKey: tenantResult.tenantKey,
        });
        return new Response(bytes, {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            "Content-Type": "application/pdf",
            "Content-Length": String(bytes.length),
            "X-Background-Minimal-Key": objectKey,
            "X-Background-Minimal-Bytes": String(bytes.length),
            "X-Background-Minimal-Saved-At": savedAt,
          },
        });
      }

      // Background PDF fetch (minimal)
      if (url.pathname === "/backgrounds/file-minimal" && request.method === "GET") {
        const apiKeyHeader = request.headers.get("x-api-key") ?? "";
        const hasApiKey =
          env.ADMIN_API_KEY ? apiKeyHeader === env.ADMIN_API_KEY : Boolean(apiKeyHeader);
        if (!hasApiKey) {
          return jsonError(401, { error: "UNAUTHORIZED", reason: "missing token or invalid" });
        }
        if (!env.TENANT_ASSETS) {
          return jsonError(500, { error: "TENANT_ASSETS not configured" });
        }
        const templateId = url.searchParams.get("templateId") ?? "";
        if (!templateId) {
          return jsonError(400, { error: "BAD_REQUEST", reason: "missing templateId" });
        }
        const tenantResult = resolveTenantKeyFromQuery(url);
        if (tenantResult.error) return tenantResult.error;
        const objectKey = `backgrounds-minimal/${tenantResult.tenantKey}/${templateId}.pdf`;
        const object = await env.TENANT_ASSETS.get(objectKey);
        if (!object) {
          return jsonError(404, { error: "NOT_FOUND" });
        }
        const bytes = await object.arrayBuffer();
        return new Response(bytes, {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            "Content-Type": "application/pdf",
            "X-Background-Minimal-Key": objectKey,
            "X-Background-Minimal-Bytes": String(bytes.byteLength),
            "X-Background-Minimal-Saved-At": object.customMetadata?.generatedAt ?? "",
            "ETag": object.httpEtag ?? "",
          },
        });
      }

      // Debug font test (isolated)
      if (url.pathname === "/debug/font-test" && request.method === "POST") {
        const apiKeyHeader = request.headers.get("x-api-key") ?? "";
        const hasApiKey =
          env.ADMIN_API_KEY ? apiKeyHeader === env.ADMIN_API_KEY : Boolean(apiKeyHeader);
        if (!hasApiKey) {
          return jsonError(401, { error: "UNAUTHORIZED", reason: "missing token or invalid" });
        }
        console.log("[DBG_FONT_TEST] enter");

        try {
          let requestBody: Record<string, unknown> = {};
          try {
            requestBody = (await request.json()) as Record<string, unknown>;
          } catch {
            requestBody = {};
          }
          const requestedFontFamily =
            requestBody.fontFamily ?? url.searchParams.get("fontFamily");
          const jpSelection = resolveJpFontSelection(env, requestedFontFamily);
          console.log("[DBG_FONT_TEST] after create pdf");
          const pdfDoc = await PDFDocument.create();
          console.log("[DBG_FONT_TEST] before registerFontkit");
          pdfDoc.registerFontkit(fontkit);
          console.log("[DBG_FONT_TEST] after registerFontkit");
          const page = pdfDoc.addPage([595.28, 841.89]);

          const fonts = await loadFonts(env, {
            requireJp: true,
            jpFontFamily: jpSelection.requestedFamily,
          });
          console.log("[DBG_FONT_TEST] before load latin");
          const latinBytes = fonts.latin ?? null;
          console.log("[DBG_FONT_TEST] after load latin");
          console.log("[DBG_FONT_TEST] font_bytes", {
            kind: "latin",
            len: latinBytes?.length ?? 0,
            head: Array.from((latinBytes ?? new Uint8Array()).slice(0, 16))
              .map((b) => b.toString(16).padStart(2, "0"))
              .join(""),
          });

          console.log("[DBG_FONT_TEST] before load jp");
          const jpBytes = fonts.jp ?? null;
          console.log("[DBG_FONT_TEST] after load jp");
          const jpBytesHead = Array.from((jpBytes ?? new Uint8Array()).slice(0, 16))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
          logRenderInfo(env, "verbose", "[DBG_JP_FONT_CANDIDATE]", {
            fontFamily: jpSelection.requestedFamily,
            resolvedFamily: jpSelection.resolvedFamily,
            sourceUrl: jpSelection.sourceUrl,
            fellBackToNoto: jpSelection.fellBackToNoto,
            fontBytesLen: jpBytes?.length ?? 0,
            bytesHead: jpBytesHead,
            subset: "precheck",
            embedOk: false,
          });
          console.log("[DBG_FONT_TEST] font_bytes", {
            kind: "jp",
            len: jpBytes?.length ?? 0,
            head: jpBytesHead,
          });
          if (!jpBytes || jpBytes.length === 0) {
            throw new Error("jp font bytes empty");
          }

          console.log("[DBG_FONT_TEST] before embed helvetica");
          const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
          console.log("[DBG_FONT_TEST] after embed helvetica");
          page.drawText("ABC123", { x: 50, y: 780, size: 20, font: helvetica });

          if (latinBytes && latinBytes.length > 0) {
            console.log("[DBG_FONT_TEST] before embed latin");
            const latinFont = await pdfDoc.embedFont(latinBytes, { subset: true });
            console.log("[DBG_FONT_TEST] after embed latin");
            page.drawText("ABC123", { x: 50, y: 740, size: 20, font: latinFont });
          }

          console.log("[DBG_FONT_TEST] before embed jp subset=true");
          const jpFontSubset = await pdfDoc.embedFont(jpBytes, { subset: true });
          console.log("[DBG_FONT_TEST] after embed jp subset=true");
          logRenderInfo(env, "verbose", "[DBG_JP_FONT_CANDIDATE]", {
            fontFamily: jpSelection.requestedFamily,
            resolvedFamily: jpSelection.resolvedFamily,
            sourceUrl: jpSelection.sourceUrl,
            fellBackToNoto: jpSelection.fellBackToNoto,
            fontBytesLen: jpBytes.length,
            bytesHead: jpBytesHead,
            subset: true,
            embedOk: true,
          });
          page.drawText("御見積書", { x: 50, y: 680, size: 20, font: jpFontSubset });
          page.drawText("見積番号", { x: 50, y: 640, size: 20, font: jpFontSubset });
          page.drawText("発行日", { x: 50, y: 600, size: 20, font: jpFontSubset });

          console.log("[DBG_FONT_TEST] before embed jp subset=false");
          const jpFontFull = await pdfDoc.embedFont(jpBytes, { subset: false });
          console.log("[DBG_FONT_TEST] after embed jp subset=false");
          logRenderInfo(env, "verbose", "[DBG_JP_FONT_CANDIDATE]", {
            fontFamily: jpSelection.requestedFamily,
            resolvedFamily: jpSelection.resolvedFamily,
            sourceUrl: jpSelection.sourceUrl,
            fellBackToNoto: jpSelection.fellBackToNoto,
            fontBytesLen: jpBytes.length,
            bytesHead: jpBytesHead,
            subset: false,
            embedOk: true,
          });
          page.drawText("御見積書", { x: 300, y: 680, size: 20, font: jpFontFull });
          page.drawText("見積番号", { x: 300, y: 640, size: 20, font: jpFontFull });
          page.drawText("発行日", { x: 300, y: 600, size: 20, font: jpFontFull });

          console.log("[DBG_FONT_TEST] before save");
          const bytes = await pdfDoc.save();
          console.log("[DBG_FONT_TEST] after save");

          return new Response(bytes, {
            status: 200,
            headers: {
              "Content-Type": "application/pdf",
              "Content-Length": String(bytes.length),
            },
          });
        } catch (err) {
          console.error("[DBG_FONT_TEST] fatal", err);
          console.error(
            "[DBG_FONT_TEST] fatal_stack",
            err instanceof Error ? err.stack : String(err),
          );
          return new Response(
            JSON.stringify({
              error: "INTERNAL_ERROR",
              message: err instanceof Error ? err.message : String(err),
              stack: err instanceof Error ? err.stack : null,
            }),
            {
              status: 500,
              headers: { "content-type": "application/json; charset=utf-8" },
            },
          );
        }
      }

      // Background PDF file fetch (debug)
      if (url.pathname === "/backgrounds/file" && request.method === "GET") {
        const apiKeyHeader = request.headers.get("x-api-key") ?? "";
        const hasApiKey =
          env.ADMIN_API_KEY ? apiKeyHeader === env.ADMIN_API_KEY : Boolean(apiKeyHeader);
        if (!hasApiKey) {
          return jsonError(401, { error: "UNAUTHORIZED", reason: "missing token or invalid" });
        }
        if (!env.TENANT_ASSETS) {
          return jsonError(500, { error: "TENANT_ASSETS not configured" });
        }
        const templateId = url.searchParams.get("templateId") ?? "";
        if (!templateId) {
          return jsonError(400, { error: "BAD_REQUEST", reason: "missing templateId" });
        }
        const tenantResult = resolveTenantKeyFromQuery(url);
        if (tenantResult.error) return tenantResult.error;
        const bgKey = `backgrounds/${tenantResult.tenantKey}/${templateId}.pdf`;
        const bgObject = await env.TENANT_ASSETS.get(bgKey);
        if (!bgObject) {
          return jsonError(404, { error: "NOT_FOUND" });
        }
        const bytes = await bgObject.arrayBuffer();
        const metaFingerprint = bgObject.customMetadata?.templateFingerprint ?? null;
        const savedAt = bgObject.customMetadata?.generatedAt ?? null;
        const etag = bgObject.httpEtag ?? null;
        logRenderInfo(env, "debug", "[DBG_BACKGROUND_FETCH]", {
          templateId,
          tenantKey: tenantResult.tenantKey,
          objectKey: bgKey,
          bytesLen: bytes.byteLength,
          fingerprint: metaFingerprint,
          savedAt,
          etag,
        });
        return new Response(bytes, {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            "Content-Type": "application/pdf",
            "X-Background-Object-Key": bgKey,
            "X-Background-Bytes": String(bytes.byteLength),
            "X-Background-Fingerprint": metaFingerprint ?? "",
            "X-Background-Saved-At": savedAt ?? "",
            "ETag": etag ?? "",
          },
        });
      }

      if (url.pathname === "/internal/render-assets" && request.method === "GET") {
        const authError = authorizeRendererInternalRequest(request, env);
        if (authError) return authError;
        if (!env.TENANT_ASSETS) {
          return jsonError(500, {
            error: "UPLOAD_FAILED",
            errorCode: "UPLOAD_FAILED",
            errorMessage: "TENANT_ASSETS not configured",
          });
        }
        const key = String(url.searchParams.get("key") ?? "").trim();
        if (!key) {
          return jsonError(400, {
            error: "INVALID_PAYLOAD",
            errorCode: "INVALID_PAYLOAD",
            errorMessage: "missing key",
          });
        }
        const object = await env.TENANT_ASSETS.get(key);
        if (!object) {
          return jsonError(404, {
            error: "BACKGROUND_FETCH_FAILED",
            errorCode: "BACKGROUND_FETCH_FAILED",
            errorMessage: "background asset not found",
            key,
          });
        }
        const bytes = await object.arrayBuffer();
        logRenderInfo(env, "debug", "[DBG_RENDERER_ASSET_FETCH]", {
          key,
          bytesLen: bytes.byteLength,
          contentType: object.httpMetadata?.contentType ?? "application/octet-stream",
        });
        return new Response(bytes, {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            "Content-Type": object.httpMetadata?.contentType ?? "application/octet-stream",
            "Cache-Control": "no-store",
          },
        });
      }

      const internalRenderJobPayloadMatch = url.pathname.match(/^\/internal\/render-jobs\/([^/]+)\/payload$/);
      if (internalRenderJobPayloadMatch && request.method === "GET") {
        const jobId = internalRenderJobPayloadMatch[1];
        const requestId = request.headers.get("x-renderer-request-id") ?? null;
        const authError = authorizeRendererInternalRequest(request, env);
        logRenderInfo(env, "always", "[DBG_RENDERER_INTERNAL_ROUTE]", {
          route: "/internal/render-jobs/:id/payload",
          jobId,
          requestId,
          authorized: !authError,
        });
        if (authError) return authError;
        const record = await getRenderJobRecord(env, jobId);
        const storedPayload = await getStoredRenderJobPayload(env, jobId);
        if (!record || !storedPayload) {
          return jsonError(404, {
            error: "JOB_NOT_FOUND",
            errorCode: "JOB_NOT_FOUND",
            errorMessage: "job payload not found",
          });
        }
        return new Response(
          JSON.stringify({
            ...storedPayload,
            record: {
              ...storedPayload.record,
              status: record.status,
              rendererVersion: record.rendererVersion ?? storedPayload.record.rendererVersion ?? null,
              executionName: record.executionName ?? storedPayload.record.executionName ?? null,
              attempt: record.attempt,
              executionDispatchedAt: record.executionDispatchedAt ?? null,
              renderStartedAt: record.renderStartedAt ?? record.startedAt ?? null,
              renderFinishedAt: record.renderFinishedAt ?? record.finishedAt ?? null,
              failureStage: record.failureStage ?? null,
            },
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

      const internalRenderJobTransitionMatch = url.pathname.match(/^\/internal\/render-jobs\/([^/]+)\/transition$/);
      if (internalRenderJobTransitionMatch && request.method === "POST") {
        const jobId = internalRenderJobTransitionMatch[1];
        const requestId = request.headers.get("x-renderer-request-id") ?? null;
        const authError = authorizeRendererInternalRequest(request, env);
        logRenderInfo(env, "always", "[DBG_RENDERER_INTERNAL_ROUTE]", {
          route: "/internal/render-jobs/:id/transition",
          jobId,
          requestId,
          authorized: !authError,
        });
        if (authError) return authError;
        const record = await getRenderJobRecord(env, jobId);
        if (!record) {
          return jsonError(404, {
            error: "JOB_NOT_FOUND",
            errorCode: "JOB_NOT_FOUND",
            errorMessage: "job not found",
          });
        }
        let payload: RendererJobTransitionRequest | null = null;
        try {
          payload = (await request.json()) as RendererJobTransitionRequest;
        } catch {
          return jsonError(400, {
            error: "INVALID_PAYLOAD",
            errorCode: "INVALID_PAYLOAD",
            errorMessage: "invalid transition payload",
          });
        }
        if (!payload || payload.status !== "running") {
          return jsonError(400, {
            error: "INVALID_PAYLOAD",
            errorCode: "INVALID_PAYLOAD",
            errorMessage: "unsupported transition",
          });
        }
        if (record.status === "done") {
          return new Response(
            JSON.stringify({
              ok: true,
              jobId,
              status: "done",
              skip: true,
              executionName: record.executionName ?? null,
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
        if (
          record.status === "running" &&
          record.executionName &&
          payload.executionName &&
          record.executionName !== payload.executionName
        ) {
          return new Response(
            JSON.stringify({
              ok: true,
              jobId,
              status: "running",
              skip: true,
              executionName: record.executionName,
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
        const next = await markRenderJobRunning(env, jobId, {
          rendererVersion: payload.rendererVersion ?? record.rendererVersion ?? getRendererVersion(env),
          executionName: payload.executionName ?? record.executionName ?? null,
          renderStartedAt: payload.renderStartedAt ?? new Date().toISOString(),
          attempt: payload.attempt ?? record.attempt,
        });
        return new Response(
          JSON.stringify({
            ok: true,
            jobId,
            status: next?.status ?? "running",
            executionName: next?.executionName ?? payload.executionName ?? null,
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

      const internalRenderJobFileMatch = url.pathname.match(/^\/internal\/render-jobs\/([^/]+)\/file$/);
      if (internalRenderJobFileMatch && request.method === "PUT") {
        const authError = authorizeRendererInternalRequest(request, env);
        if (authError) return authError;
        if (!env.TENANT_ASSETS) {
          return jsonError(500, {
            error: "UPLOAD_FAILED",
            errorCode: "UPLOAD_FAILED",
            errorMessage: "TENANT_ASSETS not configured",
          });
        }
        const jobId = internalRenderJobFileMatch[1];
        const record = await getRenderJobRecord(env, jobId);
        if (!record) {
          return jsonError(404, {
            error: "JOB_NOT_FOUND",
            errorCode: "JOB_NOT_FOUND",
            errorMessage: "job not found",
          });
        }
        const pdfKey = String(
          request.headers.get("x-pdf-key") ??
            url.searchParams.get("pdfKey") ??
            record.pdfKey ??
            buildRenderOutputKey(jobId),
        ).trim();
        if (!pdfKey) {
          return jsonError(400, {
            error: "INVALID_PAYLOAD",
            errorCode: "INVALID_PAYLOAD",
            errorMessage: "missing pdfKey",
          });
        }
        const bytes = new Uint8Array(await request.arrayBuffer());
        if (bytes.length === 0) {
          return jsonError(400, {
            error: "INVALID_PAYLOAD",
            errorCode: "INVALID_PAYLOAD",
            errorMessage: "empty pdf body",
          });
        }
        const rendererVersion =
          request.headers.get("x-renderer-version")?.trim() || getRendererVersion(env);
        await env.TENANT_ASSETS.put(pdfKey, bytes, {
          httpMetadata: { contentType: "application/pdf" },
          customMetadata: {
            jobId,
            templateId: record.templateId,
            tenantId: record.tenantId,
            rendererVersion,
          },
        });
        logRenderInfo(env, "debug", "[DBG_RENDERER_UPLOAD_DONE]", {
          jobId,
          templateId: record.templateId,
          tenantId: record.tenantId,
          pdfKey,
          pdfBytes: bytes.length,
          rendererVersion,
        });
        return new Response(
          JSON.stringify({
            ok: true,
            jobId,
            pdfKey,
            pdfBytes: bytes.length,
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

      const internalRenderJobResultMatch = url.pathname.match(/^\/internal\/render-jobs\/([^/]+)\/result$/);
      if (internalRenderJobResultMatch && request.method === "POST") {
        const authError = authorizeRendererInternalRequest(request, env);
        if (authError) return authError;
        const jobId = internalRenderJobResultMatch[1];
        const record = await getRenderJobRecord(env, jobId);
        if (!record) {
          return jsonError(404, {
            error: "JOB_NOT_FOUND",
            errorCode: "JOB_NOT_FOUND",
            errorMessage: "job not found",
          });
        }
        let payload: RendererJobResultRequest | null = null;
        try {
          payload = (await request.json()) as RendererJobResultRequest;
        } catch {
          return jsonError(400, {
            error: "INVALID_PAYLOAD",
            errorCode: "INVALID_PAYLOAD",
            errorMessage: "invalid result payload",
          });
        }
        if (!payload || (payload.status !== "done" && payload.status !== "failed")) {
          return jsonError(400, {
            error: "INVALID_PAYLOAD",
            errorCode: "INVALID_PAYLOAD",
            errorMessage: "missing status",
          });
        }

        if (payload.status === "done") {
          await markRenderJobDone(env, jobId, {
            pdfKey: payload.pdfKey,
            pdfBytes: payload.pdfBytes,
            renderMs: payload.renderMs,
            rendererVersion: payload.rendererVersion,
            executionName: payload.executionName ?? record.executionName ?? null,
            renderStartedAt: payload.renderStartedAt ?? record.renderStartedAt ?? null,
            renderFinishedAt: payload.renderFinishedAt ?? new Date().toISOString(),
          });
          logRenderSummary(env, {
            jobId,
            templateId: record.templateId,
            tenantId: record.tenantId,
            renderMs: payload.renderMs,
            pdfBytes: payload.pdfBytes,
            backgroundBytes: payload.backgroundBytes ?? null,
            status: "done",
            rendererVersion: payload.rendererVersion,
            executionName: payload.executionName ?? record.executionName ?? null,
            renderStartedAt: payload.renderStartedAt ?? record.renderStartedAt ?? null,
            renderFinishedAt: payload.renderFinishedAt ?? new Date().toISOString(),
          });
        } else {
          await markRenderJobFailed(env, jobId, {
            errorCode: payload.errorCode,
            errorMessage: payload.errorMessage,
            rendererVersion: payload.rendererVersion,
            executionName: payload.executionName ?? record.executionName ?? null,
            renderStartedAt: payload.renderStartedAt ?? record.renderStartedAt ?? null,
            renderFinishedAt: payload.renderFinishedAt ?? new Date().toISOString(),
            failureStage: payload.failureStage ?? null,
            errorSummary: payload.errorSummary ?? payload.errorMessage,
            errorDetails: payload.errorDetails ?? null,
          });
          logRenderSummary(env, {
            jobId,
            templateId: record.templateId,
            tenantId: record.tenantId,
            renderMs: payload.renderMs ?? null,
            pdfBytes: null,
            backgroundBytes: payload.backgroundBytes ?? null,
            status: "failed",
            rendererVersion: payload.rendererVersion,
            errorCode: payload.errorCode,
            executionName: payload.executionName ?? record.executionName ?? null,
            renderStartedAt: payload.renderStartedAt ?? record.renderStartedAt ?? null,
            renderFinishedAt: payload.renderFinishedAt ?? new Date().toISOString(),
            failureStage: payload.failureStage ?? null,
          });
        }

        await clearRenderJobDedup(env, record);

        return new Response(
          JSON.stringify({
            ok: true,
            jobId,
            status: payload.status,
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

      if (url.pathname === "/render-jobs" && request.method === "POST") {
        const jobsKv = getRenderJobsKv(env);
        if (!jobsKv || !env.RENDER_JOBS_QUEUE) {
          return jsonError(500, { error: "RENDER_JOBS_NOT_CONFIGURED" });
        }
        let payload: RenderJobRequestBody | null = null;
        try {
          payload = (await request.json()) as RenderJobRequestBody;
        } catch {
          return jsonError(400, { error: "BAD_REQUEST", reason: "invalid json body" });
        }
        logRenderInfo(env, "debug", "[DBG_RENDER_JOB_SESSION_INPUT]", {
          hasSessionToken: Boolean(payload?.sessionToken),
          sessionTokenPrefix:
            typeof payload?.sessionToken === "string"
              ? payload.sessionToken.slice(0, 8)
              : null,
          hasKintoneApiToken: Boolean(payload?.kintoneApiToken),
          recordId: payload?.recordId ?? null,
          recordRevision: payload?.recordRevision ?? null,
          appId: payload?.appId ?? payload?.kintone?.appId ?? null,
          kintoneBaseUrl: payload?.kintoneBaseUrl ?? payload?.kintone?.baseUrl ?? null,
          source: payload?.context?.source ?? null,
        });
        const templateId = String(payload?.templateId ?? "").trim();
        const normalizedRecordId = normalizeRenderJobIdValue(payload?.recordId, "recordId");
        const normalizedRecordRevision = normalizeRenderJobIdValue(
          payload?.recordRevision,
          "recordRevision",
        );
        const recordId = normalizedRecordId?.value ?? "";
        const recordRevision = normalizedRecordRevision?.value ?? "";
        const recordRevisionType = normalizedRecordRevision?.type ??
          (Array.isArray(payload?.recordRevision) ? "array" : typeof payload?.recordRevision);
        logRenderInfo(env, "debug", "[DBG_RENDER_JOB_PAYLOAD]", {
          recordId,
          recordRevision,
          recordRevisionType,
        });
        const kintoneBaseUrlRaw = String(
          payload?.kintoneBaseUrl ?? payload?.kintone?.baseUrl ?? "",
        ).trim();
        const appIdRaw = payload?.appId ?? payload?.kintone?.appId;
        if (payload?.recordId != null && !normalizedRecordId) {
          return jsonError(400, {
            error: "BAD_REQUEST",
            reason: "recordId must be string or number",
          });
        }
        if (payload?.recordRevision != null && !normalizedRecordRevision) {
          return jsonError(400, {
            error: "BAD_REQUEST",
            reason: "recordRevision must be string or number",
          });
        }
        if (!templateId || !recordId || !recordRevision || !kintoneBaseUrlRaw || appIdRaw == null) {
          return jsonError(400, {
            error: "BAD_REQUEST",
            reason: "missing templateId/recordId/recordRevision/kintoneBaseUrl/appId",
          });
        }
        let normalizedBaseUrl = "";
        let normalizedAppId = "";
        try {
          normalizedBaseUrl = canonicalizeKintoneBaseUrl(kintoneBaseUrlRaw);
          normalizedAppId = canonicalizeAppId(String(appIdRaw));
        } catch {
          return jsonError(400, { error: "BAD_REQUEST", reason: "invalid kintoneBaseUrl or appId" });
        }
        if (!normalizedAppId) {
          return jsonError(400, { error: "BAD_REQUEST", reason: "invalid appId" });
        }
        const tenantKey = buildTenantKey(normalizedBaseUrl, normalizedAppId);
        const mode: RenderJobMode = payload?.mode === "save" ? "save" : "print";
        const authHeader = request.headers.get("Authorization") ?? "";
        const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
        const hasBearer = Boolean(bearerToken);
        const sessionToken =
          (request.headers.get("x-session-token") ??
            payload?.sessionToken ??
            url.searchParams.get("sessionToken") ??
            "").trim();
        const apiKeyHeader = request.headers.get("x-api-key") ?? "";
        const hasApiKey = env.ADMIN_API_KEY
          ? apiKeyHeader === env.ADMIN_API_KEY
          : Boolean(apiKeyHeader);
        let verifiedSession:
          | { kintoneBaseUrl: string; appId: string; kintoneApiToken?: string }
          | null = null;
        if (hasBearer) {
          const verified = await verifyEditorToken(env.USER_TEMPLATES_KV, bearerToken);
          if (!verified) {
            return jsonError(401, { error: "UNAUTHORIZED", reason: "missing token or invalid" });
          }
          if (verified.tenantId !== tenantKey) {
            return jsonError(403, { error: "FORBIDDEN", reason: "tenant mismatch" });
          }
        } else if (sessionToken) {
          const loaded = await loadEditorSession(env, sessionToken);
          if ("error" in loaded) {
            return jsonError(401, { error: "UNAUTHORIZED", reason: "missing token or invalid" });
          }
          let sessionTenantKey = "";
          try {
            sessionTenantKey = buildTenantKey(
              loaded.session.kintoneBaseUrl,
              loaded.session.appId,
            );
          } catch {
            return jsonError(401, { error: "UNAUTHORIZED", reason: "missing token or invalid" });
          }
          if (sessionTenantKey !== tenantKey) {
            return jsonError(403, { error: "FORBIDDEN", reason: "tenant mismatch" });
          }
          verifiedSession = loaded.session;
        } else if (env.ADMIN_API_KEY && !hasApiKey) {
          return jsonError(401, { error: "UNAUTHORIZED", reason: "missing token or invalid" });
        }
        const tokenFromBody = payload?.kintoneApiToken?.trim() ?? "";
        let tokenFromSession = "";
        if (sessionToken) {
          tokenFromSession = await resolveSessionKintoneApiToken(
            env,
            sessionToken,
            tenantKey,
            normalizedAppId,
          );
        } else {
          tokenFromSession = verifiedSession?.kintoneApiToken?.trim() ?? "";
        }
        if (!tokenFromSession) {
          const tenantRecord = await getTenantRecord(env.USER_TEMPLATES_KV, tenantKey);
          tokenFromSession = resolveTenantStoredKintoneApiToken(tenantRecord, normalizedAppId);
        }
        let resolvedKintoneApiToken = tokenFromSession;
        let tokenSource = "missing";
        if (tokenFromSession) {
          tokenSource = "session";
        } else if (tokenFromBody) {
          resolvedKintoneApiToken = tokenFromBody;
          tokenSource = "body";
        }
        logRenderInfo(env, "debug", "[DBG_RENDER_JOB_KINTONE_AUTH]", {
          jobId: null,
          tenantKey,
          hasToken: Boolean(resolvedKintoneApiToken),
          tokenSource,
        });
        if (!resolvedKintoneApiToken) {
          return jsonError(400, {
            error: "BAD_REQUEST",
            reason: `missing kintoneApiToken for tenant=${tenantKey} app=${normalizedAppId}`,
          });
        }
        const jpSelection = resolveJpFontSelection(
          env,
          payload?.jpFontFamily ?? url.searchParams.get("jpFontFamily"),
        );
        const activeJob = await findActiveRenderJobForRecord(env, {
          tenantKey,
          templateId,
          recordId,
          mode,
        });
        if (activeJob) {
          logRenderInfo(env, "always", "[RENDER_JOB_REUSED]", {
            jobId: activeJob.jobId,
            templateId: activeJob.templateId,
            recordId: activeJob.recordId,
            tenantKey: activeJob.tenantKey,
            mode: activeJob.mode,
            executionName: activeJob.executionName ?? null,
          });
          return new Response(
            JSON.stringify({
              ...buildRenderJobPublicPayload(request, activeJob),
              reused: true,
            }),
            {
              status: 202,
              headers: {
                ...CORS_HEADERS,
                "Content-Type": "application/json",
                "Cache-Control": "no-store, no-cache, must-revalidate",
                Pragma: "no-cache",
              },
            },
          );
        }
        const dedupSignature = {
          templateId,
          recordId,
          recordRevision,
          jpFontFamily: jpSelection.requestedFamily,
          tenantKey,
          mode,
        };
        const dedupJson = stableStringify(dedupSignature);
        const dedupHash = (await sha256Hex(dedupJson)) ?? hashStringFNV1a(dedupJson);
        const dedupKey = buildRenderJobDedupKey(dedupHash);
        const existingJobId = await jobsKv.get(dedupKey);
        if (existingJobId) {
          const existingRecord = await getRenderJobRecord(env, existingJobId);
          if (existingRecord) {
            const ageMs = getRenderJobAgeMs(existingRecord);
            const isReusableQueued =
              existingRecord.status === "queued" &&
              ageMs != null &&
              ageMs <= RENDER_JOB_DEDUP_REUSE_QUEUED_MS;
            if (isReusableQueued) {
              logRenderInfo(env, "always", "[DBG_RENDER_JOB_DEDUP_REUSED]", {
                jobId: existingJobId,
                templateId: existingRecord.templateId,
                tenantId: existingRecord.tenantId,
                existingStatus: existingRecord.status,
                ageMs,
                dedupKey,
              });
              logRenderJobEvent("[DBG_RENDER_JOB_CREATE]", env, existingRecord, {
                dedupHit: true,
                recordId,
                recordRevision,
                jpFontFamily: existingRecord.jpFontFamily,
              });
              return new Response(
                JSON.stringify({
                  ...buildRenderJobPublicPayload(request, existingRecord),
                  reused: true,
                }),
                {
                  status: 202,
                  headers: {
                    ...CORS_HEADERS,
                    "Content-Type": "application/json",
                    "Cache-Control": "no-store, no-cache, must-revalidate",
                    Pragma: "no-cache",
                  },
                },
              );
            }

            if (
              (
                existingRecord.status === "processing" ||
                existingRecord.status === "running" ||
                existingRecord.status === "leased" ||
                existingRecord.status === "dispatched"
              ) &&
              ageMs != null &&
              ageMs >= RENDER_JOB_STALE_PROCESSING_MS
            ) {
              await markRenderJobFailed(env, existingRecord.jobId, {
                errorCode: "STALE_JOB",
                errorMessage: "stale processing job superseded by a new request",
                rendererVersion: existingRecord.rendererVersion ?? getRendererVersion(env),
              });
            }

            await clearRenderJobDedup(env, existingRecord);
            logRenderInfo(env, "always", "[DBG_RENDER_JOB_DEDUP_SKIPPED]", {
              jobId: existingJobId,
              templateId: existingRecord.templateId,
              tenantId: existingRecord.tenantId,
              existingStatus: existingRecord.status,
              ageMs,
              dedupKey,
              reason:
                existingRecord.status === "done"
                  ? "done_reuse_disabled"
                  : existingRecord.status === "queued"
                    ? "queued_too_old"
                    : existingRecord.status === "failed"
                      ? "failed_not_reused"
                      : existingRecord.status === "leased"
                        ? "leased_not_reused"
                        : existingRecord.status === "dispatched"
                          ? "dispatched_not_reused"
                      : ageMs != null && ageMs >= RENDER_JOB_STALE_PROCESSING_MS
                        ? "stale_processing"
                        : "processing_not_reused",
            });
          }
        }

        const jobId = typeof crypto !== "undefined" && "randomUUID" in crypto
          ? `job_${crypto.randomUUID()}`
          : `job_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
        const now = new Date().toISOString();
        const record: RenderJobRecord = {
          jobId,
          status: "queued",
          templateId,
          templateRevision: null,
          recordId,
          recordRevision,
          kintoneBaseUrl: normalizedBaseUrl,
          appId: normalizedAppId,
          tenantKey,
          tenantId: tenantKey,
          mode,
          source: payload?.context?.source?.trim() || null,
          jpFontFamily: jpSelection.requestedFamily,
          dedupKey,
          requestedAt: now,
          createdAt: now,
          updatedAt: now,
          startedAt: null,
          finishedAt: null,
          completedAt: null,
          pdfKey: null,
          pdfObjectKey: null,
          pdfUrl: null,
          pdfBytes: null,
          renderMs: null,
          errorCode: null,
          errorMessage: null,
          error: null,
          rendererVersion:
            resolveRenderModeSetting(env) === "remote"
              ? getRendererVersion(env)
              : `worker-local:${getRendererVersion(env)}`,
          executionName: null,
          executionDispatchedAt: null,
          renderStartedAt: null,
          renderFinishedAt: null,
          failureStage: null,
          errorSummary: null,
          errorDetails: null,
          requestedBy: payload?.context?.source?.trim() || null,
          attempt: 1,
        };
        await createRenderJobRecord(env, record);
        logRenderInfo(env, "always", "[RENDER_JOB_ACCEPTED]", {
          jobId,
          templateId,
          recordId,
          tenantKey,
          executionName: null,
          status: "queued",
        });
        await jobsKv.put(dedupKey, jobId, { expirationTtl: 60 * 30 });
        try {
          const queuePayload: RenderJobMessage = {
            jobId,
            templateId,
            recordId,
            recordRevision,
            mode,
            kintoneBaseUrl: normalizedBaseUrl,
            appId: normalizedAppId,
            jpFontFamily: jpSelection.requestedFamily,
            sessionToken: sessionToken || undefined,
            kintoneApiToken: tokenSource === "body" ? resolvedKintoneApiToken : undefined,
            tenantKey,
            dedupKey,
            requestedAt: now,
          };
          logRenderInfo(env, "always", "[DBG_RENDER_JOB_ENQUEUE_START]", {
            jobId,
            templateId,
            tenantId: tenantKey,
            queue: RENDER_JOBS_QUEUE_NAME,
            status: "queued",
          });
          await env.RENDER_JOBS_QUEUE.send(queuePayload);
          logRenderInfo(env, "always", "[DBG_RENDER_JOB_ENQUEUE_DONE]", {
            jobId,
            templateId,
            tenantId: tenantKey,
            queue: RENDER_JOBS_QUEUE_NAME,
            status: "queued",
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logRenderError(env, "always", "[DBG_RENDER_JOB_ENQUEUE_ERROR]", {
            jobId,
            templateId,
            tenantId: tenantKey,
            queue: RENDER_JOBS_QUEUE_NAME,
            status: "failed",
            errorMessage: message,
          });
          await markRenderJobFailed(env, jobId, {
            errorCode: "RENDER_FAILED",
            errorMessage: message,
            rendererVersion: record.rendererVersion,
          });
          await jobsKv.delete(dedupKey);
          return jsonError(500, { error: "QUEUE_SEND_FAILED", message });
        }
        logRenderInfo(env, "debug", "[DBG_RENDER_JOB_STATUS]", { jobId, status: "queued" });
        return new Response(JSON.stringify({
          ...buildRenderJobPublicPayload(request, record),
          reused: false,
        }), {
          status: 202,
          headers: {
            ...CORS_HEADERS,
            "Content-Type": "application/json",
            "Cache-Control": "no-store, no-cache, must-revalidate",
            Pragma: "no-cache",
          },
        });
      }

      if (url.pathname === "/render-jobs/latest" && request.method === "GET") {
        const templateId = String(url.searchParams.get("templateId") ?? "").trim();
        const recordId = String(url.searchParams.get("recordId") ?? "").trim();
        const mode: RenderJobMode = url.searchParams.get("mode") === "save" ? "save" : "print";
        if (!templateId || !recordId) {
          return jsonError(400, {
            error: "BAD_REQUEST",
            reason: "missing templateId or recordId",
          });
        }

        const authHeader = request.headers.get("Authorization") ?? "";
        const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
        const sessionToken =
          (request.headers.get("x-session-token") ?? url.searchParams.get("sessionToken") ?? "").trim();
        let tenantKey = "";
        if (bearerToken) {
          const verified = await verifyEditorToken(env.USER_TEMPLATES_KV, bearerToken);
          if (!verified) {
            return jsonError(401, { error: "UNAUTHORIZED", reason: "missing token or invalid" });
          }
          tenantKey = verified.tenantId;
        } else if (sessionToken) {
          const loaded = await loadEditorSession(env, sessionToken);
          if ("error" in loaded) {
            return jsonError(401, { error: "UNAUTHORIZED", reason: "missing token or invalid" });
          }
          tenantKey = buildTenantKey(loaded.session.kintoneBaseUrl, loaded.session.appId);
        } else {
          return jsonError(401, { error: "UNAUTHORIZED", reason: "missing token or invalid" });
        }

        const latest = await findLatestRenderJobForRecord(env, {
          tenantKey,
          templateId,
          recordId,
          mode,
        });
        if (!latest) {
          logRenderInfo(env, "always", "[RENDER_JOB_LATEST_MISS]", {
            jobId: null,
            templateId,
            recordId,
            tenantKey,
            mode,
            executionName: null,
          });
          return new Response(JSON.stringify({ ok: true, job: null }), {
            status: 200,
            headers: {
              ...CORS_HEADERS,
              "Content-Type": "application/json",
              "Cache-Control": "no-store, no-cache, must-revalidate",
              Pragma: "no-cache",
            },
          });
        }

        const reconciled = await reconcileRenderJobDoneFromOutput(env, latest);
        logRenderInfo(env, "always", "[RENDER_JOB_LATEST_FOUND]", {
          jobId: reconciled.jobId,
          templateId: reconciled.templateId,
          recordId: reconciled.recordId,
          tenantKey: reconciled.tenantKey,
          mode: reconciled.mode,
          executionName: reconciled.executionName ?? null,
        });
        return new Response(
          JSON.stringify({
            ok: true,
            job: buildRenderJobPublicPayload(request, reconciled),
          }),
          {
            status: 200,
            headers: {
              ...CORS_HEADERS,
              "Content-Type": "application/json",
              "Cache-Control": "no-store, no-cache, must-revalidate",
              Pragma: "no-cache",
            },
          },
        );
      }

      const renderJobPdfMatch = url.pathname.match(/^\/render-jobs\/([^/]+)\/(pdf|file)$/);
      if (renderJobPdfMatch && request.method === "GET") {
        const jobId = renderJobPdfMatch[1];
        const initialRecord = await getRenderJobRecord(env, jobId);
        if (!initialRecord) {
          logRenderInfo(env, "debug", "[DBG_RENDER_JOB_FILE_FETCH]", {
            jobId,
            status: null,
            errorCode: "JOB_NOT_FOUND",
            renderMode: resolveRenderModeSetting(env),
          });
          return jsonError(404, {
            error: "JOB_NOT_FOUND",
            errorCode: "JOB_NOT_FOUND",
            errorMessage: "job not found",
          });
        }
        const record = await reconcileRenderJobDoneFromOutput(env, initialRecord);
        const authError = await authorizeRenderJobAccess(request, env, record.tenantKey, url);
        if (authError) return authError;
        if (record.status !== "done") {
          logRenderJobEvent("[DBG_RENDER_JOB_FILE_FETCH]", env, record, {
            errorCode: "FILE_NOT_READY",
            requestedPath: renderJobPdfMatch[2],
          }, "debug");
          return jsonError(409, {
            error: "FILE_NOT_READY",
            errorCode: "FILE_NOT_READY",
            errorMessage: "render job is not done",
            jobId,
            status: record.status,
          });
        }
        const pdfKey = record.pdfKey ?? record.pdfObjectKey;
        if (!pdfKey || !env.TENANT_ASSETS) {
          logRenderJobEvent("[DBG_RENDER_JOB_FILE_FETCH]", env, record, {
            errorCode: "UPLOAD_FAILED",
            requestedPath: renderJobPdfMatch[2],
          }, "debug");
          return jsonError(500, {
            error: "UPLOAD_FAILED",
            errorCode: "UPLOAD_FAILED",
            errorMessage: "render output key is missing",
            jobId,
          });
        }
        const object = await env.TENANT_ASSETS.get(pdfKey);
        if (!object) {
          logRenderJobEvent("[DBG_RENDER_JOB_FILE_FETCH]", env, record, {
            errorCode: "UPLOAD_FAILED",
            requestedPath: renderJobPdfMatch[2],
          }, "debug");
          return jsonError(500, {
            error: "UPLOAD_FAILED",
            errorCode: "UPLOAD_FAILED",
            errorMessage: "render output file is missing",
            jobId,
          });
        }
        const bytes = await object.arrayBuffer();
        logRenderJobEvent("[DBG_RENDER_JOB_FILE_FETCH]", env, record, {
          requestedPath: renderJobPdfMatch[2],
          pdfKey,
          pdfBytes: bytes.byteLength,
        }, "debug");
        logRenderInfo(env, "always", "[DBG_RENDER_JOB_DOWNLOAD]", {
          jobId,
          status: record.status,
          pdfKey,
          bytesLen: bytes.byteLength,
        });
        return new Response(bytes, {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            "Content-Type": "application/pdf",
            "Content-Disposition": `attachment; filename=\"plugbits-${record.recordId}.pdf\"`,
            "Cache-Control": "no-store, no-cache, must-revalidate",
            Pragma: "no-cache",
          },
        });
      }

      const renderJobGetMatch = url.pathname.match(/^\/render-jobs\/([^/]+)$/);
      if (renderJobGetMatch && request.method === "GET") {
        const jobId = renderJobGetMatch[1];
        const initialRecord = await getRenderJobRecord(env, jobId);
        if (!initialRecord) {
          return jsonError(404, {
            error: "JOB_NOT_FOUND",
            errorCode: "JOB_NOT_FOUND",
            errorMessage: "job not found",
          });
        }
        const record = await reconcileRenderJobDoneFromOutput(env, initialRecord);
        const authError = await authorizeRenderJobAccess(request, env, record.tenantKey, url);
        if (authError) return authError;
        logRenderInfo(env, "debug", "[DBG_RENDER_JOB_POLL]", {
          jobId: record.jobId,
          status: record.status,
        });
        logRenderInfo(env, "debug", "[DBG_RENDER_JOB_STATUS]", {
          jobId: record.jobId,
          status: record.status,
          pdfKey: record.pdfKey ?? record.pdfObjectKey ?? null,
        });
        return new Response(
          JSON.stringify({
            ...buildRenderJobPublicPayload(request, record),
            templateRevision: record.templateRevision ?? null,
            tenantId: record.tenantId,
            tenantKey: record.tenantKey,
            pdfBytes: record.pdfBytes ?? null,
            renderMs: record.renderMs ?? null,
            executionDispatchedAt: record.executionDispatchedAt ?? null,
            renderStartedAt: record.renderStartedAt ?? record.startedAt ?? null,
            renderFinishedAt: record.renderFinishedAt ?? record.finishedAt ?? null,
            failureStage: record.failureStage ?? null,
            errorSummary: record.errorSummary ?? record.errorMessage ?? null,
            errorDetails: record.errorDetails ?? null,
            updatedAt: record.updatedAt ?? record.requestedAt ?? null,
          }),
          {
            status: 200,
            headers: {
              ...CORS_HEADERS,
              "Content-Type": "application/json",
              "Cache-Control": "no-store, no-cache, must-revalidate",
              Pragma: "no-cache",
            },
          },
        );
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
            logRenderInfo(env, "debug", "[DBG_DEBUG_FLAGS]", {
              url: request.url,
              debugFromQuery,
              debugFromHash,
              debugEffective: debugEnabled,
            });
          }

          const debug = debugEnabled;
          const previewMode =
            body?.previewMode === "fieldCode" ? "fieldCode" : "record";
          const requestedJpFontFamily =
            body?.jpFontFamily ?? (url.searchParams.get("jpFontFamily") as JpFontFamily | null);
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
            logRenderInfo(env, "debug", "[DBG_RENDER_INCOMING]", {
              requestId,
              templateId: templateIdInBody,
              userTemplateId: userTemplateIdInBody,
              baseTemplateId: bodyBaseTemplateId,
              jpFontFamily: requestedJpFontFamily ?? null,
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
            logRenderInfo(env, "debug", "[render] debugFlag", {
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
            logRenderInfo(env, "debug", "[DBG_RENDER_RESOLVED]", {
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
            logRenderInfo(env, "debug", "[DBG_RENDER_DOCMETA]", {
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

          logRenderInfo(env, "debug", "[render] request", {
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
          logRenderInfo(env, "verbose", "[DBG_RENDER_FIXTURE]", {
            requestId,
            fixture: fixtureName ?? null,
          });
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
        const templateFingerprint = await buildTemplateFingerprint(templateForRender);
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
        if (debug) {
          const dims = getTemplatePageInfo(templateForRender);
          const templateId = template.id ?? body.templateId ?? "";
          console.info(
            `[DBG_RENDER_START] requestId=${requestId ?? ""} templateId=${templateId} source=${templateSource} ` +
              `pageSize=${templateForRender.pageSize} previewMode=${previewMode} renderMode=${renderMode} ` +
              `fetchedHash=${templateFingerprint.hash} hashType=${templateFingerprint.hashType} fetchedEtag= ` +
              `fetchedJsonLen=${templateFingerprint.jsonLen} fetchedElements=${templateFingerprint.elements} ` +
              `pdfPageW=${dims.width} pdfPageH=${dims.height}`,
          );
        }
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

        const extractRecordKey = (data: unknown) => {
          if (!data || typeof data !== "object") return {};
          const record = data as Record<string, unknown>;
          const pick = (...keys: string[]) => {
            for (const key of keys) {
              const value = record[key];
              if (value !== undefined && value !== null && value !== "") return String(value);
            }
            return "";
          };
          return {
            recordId: pick("recordId", "recordID", "id", "$id", "RecordId"),
            recordRevision: pick("revision", "$revision", "recordRevision", "updatedRevision"),
            updatedTime: pick("updatedTime", "updatedAt", "updateDate", "$updatedTime"),
          };
        };
        const recordKey = extractRecordKey(dataForRender);

        if (renderMode === "final") {
          const profile = buildTextProfile(templateForRender, dataForRender, previewMode);
          if (profile.length > 0) {
            logRenderInfo(env, "verbose", "[DBG_TEXT_PROFILE]", {
              requestId,
              recordId: recordKey.recordId || null,
              recordRevision: recordKey.recordRevision || null,
              updatedTime: recordKey.updatedTime || null,
              fields: profile,
            });
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
          logRenderInfo(env, "verbose", "[DBG_RENDER_TIMING]", {
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

        let cachedPdf: ArrayBuffer | null = null;
        let cacheKey: string | null = null;
        let finalCacheKey: string | null = null;
        let finalCacheKeyHead: string | null = null;
        let renderCacheHeader: string | null = null;
        if (renderMode === "preview" && env.RENDER_CACHE && !debugEnabled) {
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

        let cachedFinalPdf: ArrayBuffer | null = null;
        let finalCacheDiag: {
          templateId: string | null;
          recordId: string | null;
          recordRevision: string | null;
          updatedTime: string | null;
        } | null = null;
        if (renderMode === "final" && env.TENANT_ASSETS && !debugEnabled && tenantKeyForDiag) {
          const resolvedTemplateId =
            templateForRender.id ?? templateIdInBody ?? resolvedTemplateIdForDiag ?? null;
          const dataJson = stableStringify(dataForRender ?? null);
          const dataHash = (await sha256Hex(dataJson)) ?? hashStringFNV1a(dataJson);
          const cachePayload = {
            mode: renderMode,
            templateHash: templateFingerprint.hash,
            templateId: resolvedTemplateId,
            baseTemplateId: templateForRender.baseTemplateId ?? null,
            tenantKey: tenantKeyForDiag,
            tenantUpdatedAt: tenantRecordForRender?.updatedAt ?? null,
            logoUpdatedAt: tenantRecordForRender?.logo?.updatedAt ?? null,
            recordId: recordKey.recordId || null,
            recordRevision: recordKey.recordRevision || null,
            updatedTime: recordKey.updatedTime || null,
            dataHash: recordKey.recordId ? null : dataHash,
          };
          const cacheJson = stableStringify(cachePayload);
          const cacheHash = (await sha256Hex(cacheJson)) ?? hashStringFNV1a(cacheJson);
          finalCacheKeyHead = cacheHash.slice(0, 12);
          finalCacheKey = `cache/final/${tenantKeyForDiag}/${cacheHash}.pdf`;
          finalCacheDiag = {
            templateId: resolvedTemplateId,
            recordId: recordKey.recordId || null,
            recordRevision: recordKey.recordRevision || null,
            updatedTime: recordKey.updatedTime || null,
          };
          const cachedObject = await env.TENANT_ASSETS.get(finalCacheKey);
          if (cachedObject) {
            cachedFinalPdf = await cachedObject.arrayBuffer();
          } else {
            logRenderInfo(env, "debug", "[DBG_RENDER_CACHE]", {
              requestId,
              mode: "final",
              status: "MISS",
              cacheKeyHead: finalCacheKeyHead,
              ...finalCacheDiag,
            });
            renderCacheHeader = "MISS";
          }
        }

        if (cachedPdf) {
            logRenderInfo(env, "debug", "[DBG_RENDER_CACHE]", {
              requestId,
              status: "HIT",
              cacheKey,
            });
            renderCacheHeader = "HIT";
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

        if (cachedFinalPdf) {
          logRenderInfo(env, "debug", "[DBG_RENDER_CACHE]", {
            requestId,
            mode: "final",
            status: "HIT_R2",
            cacheKeyHead: finalCacheKeyHead,
            ...(finalCacheDiag ?? {}),
          });
          renderCacheHeader = "HIT_R2";
          return new Response(cachedFinalPdf, {
            status: 200,
            headers: {
              ...CORS_HEADERS,
              "Content-Type": "application/pdf",
              "X-Render-Cache": "HIT_R2",
              "X-Debug-Fixture": fixtureName ?? "(none)",
              "X-Debug-Rows": String(rowsCount),
            },
          });
        }

        const disableBackground =
          debugEnabled && url.searchParams.get("disableBackground") === "1";
        let backgroundPdfBytes: Uint8Array | null = null;
        let backgroundFound = false;
        let backgroundPageCount: number | null = null;
        let backgroundHasLogo = false;
        const backgroundTemplateId =
          templateForRender.id ?? templateIdInBody ?? resolvedTemplateIdForDiag ?? null;
        if (
          (renderMode === "preview" || renderMode === "final") &&
          env.TENANT_ASSETS &&
          tenantKeyForDiag &&
          templateForRender.structureType === "estimate_v1" &&
          backgroundTemplateId &&
          !disableBackground
        ) {
          const backgroundBytesStart = nowMs();
          try {
            const bgKey = `backgrounds/${tenantKeyForDiag}/${backgroundTemplateId}.pdf`;
            const bgObject = await env.TENANT_ASSETS.get(bgKey);
            if (bgObject) {
              const metaFingerprint = bgObject.customMetadata?.templateFingerprint ?? null;
              if (!metaFingerprint || metaFingerprint === templateFingerprint.hash) {
                const pageCountMeta = bgObject.customMetadata?.pageCount ?? null;
                backgroundPageCount = pageCountMeta ? Number(pageCountMeta) : null;
                backgroundPdfBytes = new Uint8Array(await bgObject.arrayBuffer());
                backgroundFound = true;
                backgroundHasLogo =
                  bgObject.customMetadata?.includesCompanyLogo === "1" ||
                  bgObject.customMetadata?.hasLogo === "1";
              } else {
                console.warn("[WARN_BACKGROUND_STALE]", {
                  templateId: backgroundTemplateId,
                  tenantKey: tenantKeyForDiag,
                  expected: templateFingerprint.hash,
                  actual: metaFingerprint,
                });
              }
            }
          } catch (error) {
            console.warn("[WARN_BACKGROUND_LOAD]", {
              templateId: backgroundTemplateId,
              tenantKey: tenantKeyForDiag,
              message: error instanceof Error ? error.message : String(error),
            });
          } finally {
            logTiming("load_background_bytes", nowMs() - backgroundBytesStart);
          }
        } else {
          logTiming("load_background_bytes", 0);
        }
        if (debugEnabled || renderMode === "final") {
          logRenderInfo(env, "debug", "[DBG_BACKGROUND_RENDER]", {
            templateId: backgroundTemplateId,
            backgroundFound,
            pageCount: backgroundPageCount,
            backgroundBytesLen: backgroundPdfBytes?.length ?? 0,
            backgroundHasLogo,
            disabled: disableBackground,
          });
        }

        const overlayDecisionStart = nowMs();
        const useBaseBackgroundDoc = backgroundFound;
        const skipStaticLabels = useBaseBackgroundDoc && templateForRender.structureType === "estimate_v1";
        logTiming("decide_overlay_mode", nowMs() - overlayDecisionStart);

        const logoDecisionStart = nowMs();
        const skipLogo = useBaseBackgroundDoc && backgroundHasLogo;
        const tenantLogoForRender = skipLogo ? null : tenantLogo;
        logTiming("decide_logo_skip", nowMs() - logoDecisionStart);

        hasLogoForDiag = Boolean(tenantLogoForRender);
        logoBytesLenForDiag = tenantLogoForRender?.bytes?.length ?? 0;
        logRenderInfo(env, "debug", "[DBG_LOGO]", {
          tenantKey: tenantKeyForDiag,
          found: Boolean(tenantLogoForRender),
          bytes: tenantLogoForRender?.bytes?.length ?? 0,
          contentType: tenantLogoForRender?.contentType ?? null,
          source: "tenantR2",
          skipLogo,
        });
        if (debugEnabled) {
          logRenderInfo(env, "debug", "[DBG_TENANT_PROFILE]", {
            hasLogo: hasLogoForDiag,
            companyNameLen: renderCompanyProfile?.companyName?.length ?? 0,
            addressLen: renderCompanyProfile?.companyAddress?.length ?? 0,
            telLen: renderCompanyProfile?.companyTel?.length ?? 0,
            emailLen: renderCompanyProfile?.companyEmail?.length ?? 0,
          });
        }

        const superFastMode =
          renderMode === "final" && !debugEnabled && !cachedFinalPdf && !!tenantLogoForRender;
        if (superFastMode) {
          logRenderInfo(env, "debug", "[DBG_SUPER_FAST_MODE]", {
            requestId,
            enabled: true,
            reason: "final_miss",
            hasLogo: Boolean(tenantLogoForRender),
          });
        }

        // フォント読み込み
        const prepStart = nowMs();
        const companyHasNonAscii = Boolean(
          renderCompanyProfile &&
            [
              renderCompanyProfile.companyName,
              renderCompanyProfile.companyAddress,
              renderCompanyProfile.companyTel,
              renderCompanyProfile.companyEmail,
            ]
              .filter((value): value is string => typeof value === "string")
              .some((value) => hasNonAscii(value)),
        );
        const useOverlayJpPolicy =
          backgroundFound && templateForRender.structureType === "estimate_v1";
        const useJpFont = useOverlayJpPolicy
          ? estimateOverlayTemplateHasNonAscii(templateForRender) ||
            companyHasNonAscii ||
            containsNonAsciiValue(dataForRender)
          : shouldUseJpFont(
              templateForRender,
              dataForRender,
              renderMode,
              previewMode,
              renderCompanyProfile,
            );
        const needsLatinFont =
          containsAsciiValue(dataForRender) ||
          collectTemplateTextCandidates(
            useOverlayJpPolicy
              ? {
                  ...templateForRender,
                  elements: (templateForRender.elements ?? []).filter((element) => {
                    if (element.type !== "text") return true;
                    const slotId = (element as any).slotId as string | undefined;
                    if (!slotId) return false;
                    return ESTIMATE_DYNAMIC_SLOT_IDS_FOR_OVERLAY.has(slotId);
                  }),
                }
              : templateForRender,
            previewMode,
          ).some((text) => hasAscii(text));
        logRenderInfo(env, "verbose", "[DBG_OVERLAY_MODE]", {
          backgroundFound,
          skipLogo,
          skipStaticLabels,
          useBaseBackgroundDoc,
          needsJpFont: useJpFont,
          needsLatinFont,
        });
        logTiming("prepare_text_runs", nowMs() - prepStart);
        let fonts: { jp: Uint8Array | null; latin: Uint8Array | null };
        phase = "loadFonts";
        try {
          const fontStart = nowMs();
          const renderJpSelection = resolveJpFontSelection(env, requestedJpFontFamily);
          fonts = await loadFonts(env, {
            requireJp: useJpFont,
            jpFontFamily: renderJpSelection.requestedFamily,
          });
          logTiming("load_font_bytes", nowMs() - fontStart);
          logRenderInfo(env, "debug", "[DBG_FONT_POLICY]", {
            requestId,
            renderMode,
            useJpFont,
            latinSource: fonts.latin ? "custom" : "standard",
            jpBytes: fonts.jp?.length ?? 0,
          });
          logRenderInfo(env, "verbose", "[DBG_JP_FONT_CANDIDATE]", {
            scope: "render",
            requestId,
            fontFamily: renderJpSelection.requestedFamily,
            resolvedFamily: renderJpSelection.resolvedFamily,
            sourceUrl: renderJpSelection.sourceUrl,
            fellBackToNoto: renderJpSelection.fellBackToNoto,
            fontBytesLen: fonts.jp?.length ?? 0,
            bytesHead: Array.from((fonts.jp ?? new Uint8Array()).slice(0, 16))
              .map((b) => b.toString(16).padStart(2, "0"))
              .join(""),
            subset: false,
            embedOk: !useJpFont || Boolean(fonts.jp),
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
                logLevel: getRenderLogTier(env),
                previewMode,
                renderMode,
                useJpFont,
                superFastMode,
                layer: backgroundPdfBytes ? "dynamic" : "full",
                backgroundPdfBytes: backgroundPdfBytes ?? undefined,
                requestId,
                tenantLogo: tenantLogoForRender ?? undefined,
                skipLogo,
                skipStaticLabels,
                useBaseBackgroundDoc,
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
              logRenderInfo(env, "debug", "[DBG_PDF_SIZE]", { requestId, bytes: pdfBytes.length });
            }
            if (debugEnabled || renderMode === "final") {
              logRenderInfo(env, "verbose", "[DBG_FINAL_OUTPUT]", {
                requestId,
                bytesLen: pdfBytes.length,
                backgroundFound,
                backgroundBytesLen: backgroundPdfBytes?.length ?? 0,
              });
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
                renderCacheHeader = "PUT";
                logRenderInfo(env, "debug", "[DBG_RENDER_CACHE]", {
                  requestId,
                  status: "PUT",
                  cacheKey,
                });
              } catch {
                renderCacheHeader = "PUT_FAILED";
                logRenderInfo(env, "debug", "[DBG_RENDER_CACHE]", {
                  requestId,
                  status: "PUT_FAILED",
                  cacheKey,
                });
              }
            }

            if (finalCacheKey && env.TENANT_ASSETS) {
              try {
                await env.TENANT_ASSETS.put(finalCacheKey, pdfBytes, {
                  httpMetadata: { contentType: "application/pdf" },
                });
                renderCacheHeader = "PUT_R2";
                logRenderInfo(env, "debug", "[DBG_RENDER_CACHE]", {
                  requestId,
                  mode: "final",
                  status: "PUT_R2",
                  cacheKeyHead: finalCacheKeyHead,
                  ...(finalCacheDiag ?? {}),
                });
              } catch {
                renderCacheHeader = "PUT_R2_FAILED";
                logRenderInfo(env, "debug", "[DBG_RENDER_CACHE]", {
                  requestId,
                  mode: "final",
                  status: "PUT_R2_FAILED",
                  cacheKeyHead: finalCacheKeyHead,
                  ...(finalCacheDiag ?? {}),
                });
              }
            }
            if (!renderCacheHeader && finalCacheKey) {
              renderCacheHeader = "MISS";
            }
            if (renderCacheHeader) headers["X-Render-Cache"] = renderCacheHeader;

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
};

class RenderExecutionError extends Error {
  code: RendererErrorCode;

  constructor(code: RendererErrorCode, message: string) {
    super(message);
    this.name = "RenderExecutionError";
    this.code = code;
  }
}

const normalizeRendererError = (
  error: unknown,
): { errorCode: RendererErrorCode; errorMessage: string } => {
  if (error instanceof RenderExecutionError) {
    return { errorCode: error.code, errorMessage: error.message };
  }
  const message = error instanceof Error ? error.message : String(error);
  if (/UNAUTHORIZED_RENDERER_CALL/i.test(message)) {
    return { errorCode: "UNAUTHORIZED_RENDERER_CALL", errorMessage: "Renderer authorization failed" };
  }
  if (/TABLE_RENDER_STUCK/i.test(message)) {
    return { errorCode: "TABLE_RENDER_STUCK", errorMessage: "Table render stuck" };
  }
  if (/BACKGROUND_FETCH_FAILED/i.test(message) || /background/i.test(message)) {
    return { errorCode: "BACKGROUND_FETCH_FAILED", errorMessage: "Background fetch failed" };
  }
  if (/FONT_LOAD_FAILED/i.test(message) || /font/i.test(message)) {
    return { errorCode: "FONT_LOAD_FAILED", errorMessage: "Font load failed" };
  }
  if (/UPLOAD_FAILED/i.test(message) || /upload/i.test(message)) {
    return { errorCode: "UPLOAD_FAILED", errorMessage: "PDF upload failed" };
  }
  if (/timeout/i.test(message)) {
    return { errorCode: "RENDERER_TIMEOUT", errorMessage: "Renderer timed out" };
  }
  if (/RENDERER_HTTP_FAILED/i.test(message) || /renderer http/i.test(message)) {
    return { errorCode: "RENDERER_HTTP_FAILED", errorMessage: "Renderer HTTP call failed" };
  }
  if (/template/i.test(message)) {
    return { errorCode: "TEMPLATE_LOAD_FAILED", errorMessage: message };
  }
  if (/JOB_NOT_FOUND/i.test(message)) {
    return { errorCode: "JOB_NOT_FOUND", errorMessage: "Render job not found" };
  }
  if (/FILE_NOT_READY/i.test(message)) {
    return { errorCode: "FILE_NOT_READY", errorMessage: "Render file is not ready" };
  }
  return { errorCode: "RENDER_FAILED", errorMessage: message };
};

const extractTemplateRevision = (template: TemplateDefinition): number | null => {
  const candidates = [
    (template as any).revision,
    (template as any).meta?.revision,
    (template as any).templateRevision,
  ];
  for (const candidate of candidates) {
    const value = Number(candidate);
    if (Number.isFinite(value)) return value;
  }
  return null;
};

const toInlineAsset = (
  asset:
    | {
        bytes: Uint8Array;
        contentType: string;
        objectKey?: string;
      }
    | null
    | undefined,
): RendererInlineAsset | null => {
  if (!asset?.bytes?.length) return null;
  return {
    base64: bytesToBase64(asset.bytes),
    contentType: asset.contentType,
    objectKey: asset.objectKey ?? null,
  };
};

type PreparedRenderJobExecution = {
  requestId: string;
  template: TemplateDefinition;
  data: Record<string, unknown>;
  templateRevision: number | null;
  backgroundKey: string | null;
  backgroundIncludesCompanyLogo: boolean;
  tenantLogo: RendererInlineAsset | null;
  useJpFont: boolean;
  skipLogo: boolean;
  skipStaticLabels: boolean;
  useBaseBackgroundDoc: boolean;
  superFastMode: boolean;
  rendererVersion: string;
};

const prepareRenderJobExecution = async (
  env: Env,
  payload: RenderJobMessage,
  requestId: string,
): Promise<PreparedRenderJobExecution> => {
  const recordData = await fetchKintoneRecordForJob(env, payload);
  const tenantRecord = await getTenantRecord(env.USER_TEMPLATES_KV, payload.tenantKey);
  let template: TemplateDefinition;
  try {
    template = payload.templateId.startsWith("tpl_")
      ? await resolveUserTemplate(payload.templateId, env, {
          baseUrl: payload.kintoneBaseUrl,
          appId: payload.appId,
        })
      : await getBaseTemplateById(payload.templateId, env);
  } catch (error) {
    throw new RenderExecutionError(
      "TEMPLATE_LOAD_FAILED",
      error instanceof Error ? error.message : String(error),
    );
  }

  const migratedTemplate = migrateTemplate(template, {
    enabled: false,
    requestId,
    reason: "render-job",
    templateId: template.id ?? payload.templateId,
  });
  const validation = validateTemplate(migratedTemplate);
  if (!validation.ok) {
    const issue = validation.issues[0];
    throw new RenderExecutionError(
      "INVALID_PAYLOAD",
      issue ? `${issue.code}: ${issue.message}` : "template validation failed",
    );
  }

  let templateForRender = applyListV1SummaryFromMapping(migratedTemplate);
  const renderCompanyProfile = normalizeCompanyProfile(tenantRecord?.companyProfile);
  templateForRender = applyCompanyProfileToTemplate(templateForRender, renderCompanyProfile);
  const templateRevision = extractTemplateRevision(templateForRender);
  const templateFingerprint = await buildTemplateFingerprint(templateForRender);

  let backgroundKey: string | null = null;
  let backgroundIncludesCompanyLogo = false;
  if (env.TENANT_ASSETS && templateForRender.structureType === "estimate_v1") {
    const candidateKey = `backgrounds/${payload.tenantKey}/${templateForRender.id ?? payload.templateId}.pdf`;
    try {
      const head = await env.TENANT_ASSETS.head(candidateKey);
      const metaFingerprint = head?.customMetadata?.templateFingerprint ?? null;
      if (head && (!metaFingerprint || metaFingerprint === templateFingerprint.hash)) {
        backgroundKey = candidateKey;
        backgroundIncludesCompanyLogo =
          head.customMetadata?.includesCompanyLogo === "1" ||
          head.customMetadata?.hasLogo === "1";
      }
    } catch (error) {
      console.warn("[WARN_BACKGROUND_HEAD]", {
        jobId: payload.jobId,
        backgroundKey: candidateKey,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    if (!backgroundKey) {
      throw new RenderExecutionError(
        "BACKGROUND_FETCH_FAILED",
        `estimate_v1 background missing for template=${templateForRender.id ?? payload.templateId}`,
      );
    }
  }

  const tenantLogoRaw = tenantRecord?.logo
    ? await getTenantLogoBytes(env, tenantRecord.tenantId, tenantRecord.logo)
    : null;
  const tenantLogo = tenantRecord?.logo && tenantLogoRaw
    ? {
        ...tenantLogoRaw,
        objectKey: tenantRecord.logo.objectKey,
      }
    : null;

  const useBaseBackgroundDoc = Boolean(backgroundKey);
  const skipStaticLabels = useBaseBackgroundDoc && templateForRender.structureType === "estimate_v1";
  const skipLogo = useBaseBackgroundDoc && backgroundIncludesCompanyLogo;
  const tenantLogoForRender = skipLogo ? null : tenantLogo;
  const companyHasNonAscii = [
    renderCompanyProfile.companyName,
    renderCompanyProfile.companyAddress,
    renderCompanyProfile.companyTel,
    renderCompanyProfile.companyEmail,
  ]
    .filter((value): value is string => typeof value === "string")
    .some((value) => hasNonAscii(value));
  const useOverlayJpPolicy = useBaseBackgroundDoc && templateForRender.structureType === "estimate_v1";
  const useJpFont = useOverlayJpPolicy
    ? estimateOverlayTemplateHasNonAscii(templateForRender) ||
      companyHasNonAscii ||
      containsNonAsciiValue(recordData)
    : shouldUseJpFont(
        templateForRender,
        recordData,
        "final",
        "record",
        renderCompanyProfile,
      );
  const superFastMode = Boolean(tenantLogoForRender);

  return {
    requestId,
    template: templateForRender,
    data: recordData,
    templateRevision,
    backgroundKey,
    backgroundIncludesCompanyLogo,
    tenantLogo: toInlineAsset(tenantLogoForRender),
    useJpFont,
    skipLogo,
    skipStaticLabels,
    useBaseBackgroundDoc,
    superFastMode,
    rendererVersion: getRendererVersion(env),
  };
};

const renderLocalPdf = async (
  env: Env,
  payload: RenderJobMessage,
): Promise<RendererRenderSuccess> => {
  if (!env.TENANT_ASSETS) {
    throw new RenderExecutionError("UPLOAD_FAILED", "TENANT_ASSETS not configured");
  }
  const renderStartedAt = Date.now();
  const { bytes, objectKey } = await renderPdfInternal(env, payload);
  await env.TENANT_ASSETS.put(objectKey, bytes, {
    httpMetadata: { contentType: "application/pdf" },
    customMetadata: {
      jobId: payload.jobId,
      templateId: payload.templateId,
      tenantId: payload.tenantKey,
      rendererVersion: `worker-local:${getRendererVersion(env)}`,
    },
  });
  return {
    ok: true,
    jobId: payload.jobId,
    pdfKey: objectKey,
    pdfBytes: bytes.length,
    backgroundBytes: null,
    renderMs: Date.now() - renderStartedAt,
    rendererVersion: `worker-local:${getRendererVersion(env)}`,
  };
};

const buildStoredRenderJobPayload = (
  payload: RenderJobMessage,
  prepared: PreparedRenderJobExecution,
): StoredRenderJobPayload => ({
  jobId: payload.jobId,
  renderRequest: {
    jobId: payload.jobId,
    template: prepared.template,
    data: prepared.data,
    assets: {
      backgroundKey: prepared.backgroundKey,
      backgroundIncludesCompanyLogo: prepared.backgroundIncludesCompanyLogo,
      tenantLogo: prepared.tenantLogo,
      pdfKey: buildRenderOutputKey(payload.jobId),
    },
    meta: {
      tenantId: payload.tenantKey,
      templateId: prepared.template.id ?? payload.templateId,
      templateRevision: prepared.templateRevision,
      rendererVersion: prepared.rendererVersion,
      requestId: prepared.requestId,
      jpFontFamily: payload.jpFontFamily,
    },
    options: {
      previewMode: "record",
      renderMode: "final",
      useJpFont: prepared.useJpFont,
      superFastMode: prepared.superFastMode,
      skipLogo: prepared.skipLogo,
      skipStaticLabels: prepared.skipStaticLabels,
      useBaseBackgroundDoc: prepared.useBaseBackgroundDoc,
    },
  },
  record: {
    jobId: payload.jobId,
    status: "queued",
    templateId: prepared.template.id ?? payload.templateId,
    tenantId: payload.tenantKey,
    rendererVersion: prepared.rendererVersion,
    attempt: 1,
  },
});

const dispatchRendererJob = async (
  env: Env,
  args: {
    jobId: string;
    templateId: string;
    tenantId: string;
    requestId: string;
    rendererVersion: string;
  },
) => {
  const config = getCloudRunJobDispatchConfig(env);
  logRenderInfo(env, "always", "[DBG_RENDERER_CALL_START]", {
    jobId: args.jobId,
    templateId: args.templateId,
    tenantId: args.tenantId,
    rendererVersion: args.rendererVersion,
    renderMode: resolveRenderModeSetting(env),
    renderEngine: "cloud_run_job",
    status: "leased",
    errorCode: null,
    timeoutMs: config.requestTimeoutMs ?? null,
    targetJobName: config.jobName,
  });
  try {
    const dispatched = await runCloudRunJob(config, {
      jobId: args.jobId,
      requestId: args.requestId,
      containerName: env.CLOUD_RUN_RENDER_JOB_CONTAINER_NAME?.trim() ?? null,
    });
    logRenderInfo(env, "always", "[DBG_RENDERER_CALL_DONE]", {
      jobId: args.jobId,
      templateId: args.templateId,
      tenantId: args.tenantId,
      rendererVersion: args.rendererVersion,
      renderMode: resolveRenderModeSetting(env),
      renderEngine: "cloud_run_job",
      executionName: dispatched.executionName,
      operationName: dispatched.operationName,
      status: "dispatched",
      errorCode: null,
    });
    logRenderInfo(env, "always", "[RENDER_JOB_EXECUTION_REQUESTED]", {
      jobId: args.jobId,
      templateId: args.templateId,
      recordId: null,
      tenantKey: args.tenantId,
      executionName: dispatched.executionName,
      status: "dispatched",
    });
    return dispatched;
  } catch (error) {
    const normalized = normalizeRendererError(error);
    logRenderError(env, "always", "[DBG_RENDERER_CALL_ERROR]", {
      jobId: args.jobId,
      templateId: args.templateId,
      tenantId: args.tenantId,
      rendererVersion: args.rendererVersion,
      renderMode: resolveRenderModeSetting(env),
      renderEngine: "cloud_run_job",
      status: "failed",
      errorCode: normalized.errorCode,
    });
    throw error;
  }
};

const renderRemotePdf = async (
  env: Env,
  payload: RenderJobMessage,
): Promise<{
  handoff: {
    jobId: string;
    rendererVersion: string;
    status: "dispatched";
    executionName: string | null;
    executionDispatchedAt: string;
  };
  templateRevision: number | null;
}> => {
  const requestId = `${payload.jobId}:${Date.now()}`;
  const prepared = await prepareRenderJobExecution(env, payload, requestId);
  const storedPayload = buildStoredRenderJobPayload(payload, prepared);
  await putStoredRenderJobPayload(env, storedPayload);
  const dispatched = await dispatchRendererJob(env, {
    jobId: payload.jobId,
    templateId: prepared.template.id ?? payload.templateId,
    tenantId: payload.tenantKey,
    requestId,
    rendererVersion: prepared.rendererVersion,
  });
  return {
    handoff: {
      jobId: payload.jobId,
      rendererVersion: prepared.rendererVersion,
      status: "dispatched",
      executionName: dispatched.executionName,
      executionDispatchedAt: dispatched.dispatchedAt,
    },
    templateRevision: prepared.templateRevision,
  };
};

const renderPdfInternal = async (
  env: Env,
  payload: RenderJobMessage,
): Promise<{ bytes: Uint8Array; objectKey: string }> => {
  const normalizedRecordRevision = String(payload.recordRevision ?? "").trim();
  if (!normalizedRecordRevision) {
    throw new Error("render job payload missing recordRevision");
  }
  const recordData = await fetchKintoneRecordForJob(env, {
    ...payload,
    recordRevision: normalizedRecordRevision,
  });
  const requestBody: RenderRequestBody & {
    kintone: { baseUrl: string; appId: string };
    data: Record<string, unknown>;
  } = {
    templateId: payload.templateId,
    previewMode: "record",
    mode: "final",
    jpFontFamily: payload.jpFontFamily,
    kintone: {
      baseUrl: payload.kintoneBaseUrl,
      appId: payload.appId,
    },
    data: recordData,
  };
  const request = new Request("https://internal/render", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestBody),
  });
  const response = await handleHttpRequest(request, env);
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`render internal failed (${response.status}): ${errorText.slice(0, 500)}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const objectKey = buildRenderOutputKey(payload.jobId);
  return { bytes, objectKey };
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleHttpRequest(request, env);
  },
  async queue(batch: MessageBatch<RenderJobMessage>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      const payload = message.body as RenderJobMessage;
      const renderEngine = resolveRenderModeSetting(env);
      logRenderInfo(env, "always", "[DBG_RENDER_JOB_CONSUME]", {
        jobId: payload.jobId,
        templateId: payload.templateId,
        tenantId: payload.tenantKey,
        queue: RENDER_JOBS_QUEUE_NAME,
        recordId: payload.recordId,
        recordRevision: payload.recordRevision,
        jpFontFamily: payload.jpFontFamily,
      });
      logRenderInfo(env, "always", "[DBG_RENDER_ENGINE_SELECTED]", {
        jobId: payload.jobId,
        templateId: payload.templateId,
        tenantId: payload.tenantKey,
        rendererVersion:
          renderEngine === "remote"
            ? getRendererVersion(env)
            : `worker-local:${getRendererVersion(env)}`,
        renderEngine,
        renderMode: renderEngine,
      });
      try {
        if (!getRenderJobsKv(env)) throw new Error("RENDER_JOBS_KV_OR_RENDER_CACHE_REQUIRED");
        const currentRecord = await getRenderJobRecord(env, payload.jobId);
        if (renderEngine === "remote") {
          await markRenderJobLeased(env, payload.jobId, {
            rendererVersion: getRendererVersion(env),
            attempt: currentRecord?.attempt ?? 1,
          });
          const remote = await renderRemotePdf(env, payload);
          await markRenderJobDispatched(env, payload.jobId, {
            templateRevision: remote.templateRevision,
            rendererVersion: remote.handoff.rendererVersion,
            executionName: remote.handoff.executionName,
            executionDispatchedAt: remote.handoff.executionDispatchedAt,
            attempt: currentRecord?.attempt ?? 1,
          });
          logRenderInfo(env, "always", "[DBG_RENDER_JOB_HANDOFF]", {
            jobId: payload.jobId,
            templateId: payload.templateId,
            tenantId: payload.tenantKey,
            rendererVersion: remote.handoff.rendererVersion,
            renderEngine,
            executionName: remote.handoff.executionName,
            status: remote.handoff.status,
          });
          message.ack();
          continue;
        }

        await markRenderJobRunning(env, payload.jobId, {
          rendererVersion: `worker-local:${getRendererVersion(env)}`,
          attempt: currentRecord?.attempt ?? 1,
        });
        logRenderInfo(env, "debug", "[DBG_RENDER_JOB_STATUS]", {
          jobId: payload.jobId,
          status: "running",
        });
        const result = await renderLocalPdf(env, payload);
        await markRenderJobDone(env, payload.jobId, {
          pdfKey: result.pdfKey,
          pdfBytes: result.pdfBytes,
          renderMs: result.renderMs,
          rendererVersion: result.rendererVersion,
        });
        await clearRenderJobDedup(env, {
          jobId: payload.jobId,
          dedupKey: payload.dedupKey,
        });
        logRenderInfo(env, "debug", "[DBG_RENDER_JOB_STATUS]", {
          jobId: payload.jobId,
          status: "done",
        });
        logRenderSummary(env, {
          jobId: payload.jobId,
          templateId: payload.templateId,
          tenantId: payload.tenantKey,
          renderMs: result.renderMs,
          pdfBytes: result.pdfBytes,
          backgroundBytes: result.backgroundBytes ?? null,
          status: "done",
          rendererVersion: result.rendererVersion,
        });
        message.ack();
      } catch (error) {
        const normalized = normalizeRendererError(error);
        await markRenderJobFailed(env, payload.jobId, {
          errorCode: normalized.errorCode,
          errorMessage: normalized.errorMessage,
          rendererVersion: renderEngine === "remote" ? getRendererVersion(env) : null,
        });
        await clearRenderJobDedup(env, {
          jobId: payload.jobId,
          dedupKey: payload.dedupKey,
        });
        logRenderInfo(env, "debug", "[DBG_RENDER_JOB_STATUS]", {
          jobId: payload.jobId,
          status: "failed",
        });
        logRenderError(env, "debug", "[DBG_RENDER_JOB_FAIL]", {
          jobId: payload.jobId,
          errorCode: normalized.errorCode,
          error: normalized.errorMessage,
        });
        logRenderSummary(env, {
          jobId: payload.jobId,
          templateId: payload.templateId,
          tenantId: payload.tenantKey,
          renderMs: null,
          pdfBytes: null,
          backgroundBytes: null,
          status: "failed",
          rendererVersion:
            renderEngine === "remote"
              ? getRendererVersion(env)
              : `worker-local:${getRendererVersion(env)}`,
          errorCode: normalized.errorCode,
        });
        message.ack();
      }
    }
  },
};
