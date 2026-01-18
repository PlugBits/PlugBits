import type {
  TemplateDefinition,
  TemplateElement,
  TextElement,
  ImageElement,
  TemplateMeta,
  TemplateStatus,
  type PageSize,
} from "../../../shared/template.js";
import { canonicalizeAppId, canonicalizeKintoneBaseUrl } from "../utils/canonicalize.ts";

export type SlotFieldRef =
  | { kind: "staticText"; text?: string }
  | { kind: "recordField"; fieldCode: string }
  | { kind: "imageUrl"; url?: string };

export type SlotLayoutOverride = {
  slotId: string;
  region: "header" | "footer";
  type: "text" | "image";
  x: number;
  y: number;
  width?: number;
  height?: number;
  fontSize?: number;
  fontWeight?: "normal" | "bold";
};

export type UserTemplateOverrides = {
  slots?: Record<string, SlotFieldRef>;
  layout?: Record<string, SlotLayoutOverride>;
};

export type UserTemplatePayload = {
  baseTemplateId: string;
  pageSize?: PageSize;
  mapping?: unknown;
  overrides?: UserTemplateOverrides;
  meta?: Partial<TemplateMeta>;
};

export type UserTemplateRecord = UserTemplatePayload & {
  templateId: string;
  kintone: { baseUrl: string; appId: string };
};

const normalizeSlotRegion = (
  template: TemplateDefinition,
  slotId: string,
): "header" | "footer" => {
  const byElement = template.elements.find((el) => (el as any).slotId === slotId);
  if (byElement?.region === "footer") return "footer";
  if (byElement?.region === "header") return "header";

  const schema = template.slotSchema;
  if (schema?.footer?.some((slot) => slot.slotId === slotId)) return "footer";
  return "header";
};

const ensureTextElement = (
  base: Partial<TextElement>,
  dataSource: TextElement["dataSource"],
): TextElement => ({
  id: base.id ?? "",
  slotId: base.slotId,
  type: "text",
  region: base.region,
  x: base.x ?? 0,
  y: base.y ?? 0,
  width: base.width,
  height: base.height,
  fontSize: base.fontSize,
  fontWeight: base.fontWeight,
  dataSource,
});

const ensureImageElement = (
  base: Partial<ImageElement>,
  dataSource: ImageElement["dataSource"],
): ImageElement => ({
  id: base.id ?? "",
  slotId: base.slotId,
  type: "image",
  region: base.region,
  x: base.x ?? 0,
  y: base.y ?? 0,
  width: base.width,
  height: base.height,
  dataSource,
});

export const applySlotLayoutOverrides = (
  template: TemplateDefinition,
  overrides?: Record<string, SlotLayoutOverride>,
): TemplateDefinition => {
  if (!overrides || Object.keys(overrides).length === 0) {
    return template;
  }

  const next = structuredClone(template);
  const elements = [...(next.elements ?? [])];

  for (const slotId of Object.keys(overrides)) {
    const override = overrides[slotId];
    if (!override) continue;

    const idx = elements.findIndex((el) => (el as any).slotId === slotId);
    const region = override.region ?? normalizeSlotRegion(next, slotId);
    const base = idx >= 0 ? (elements[idx] as any) : null;

    const layoutBase = {
      id: base?.id ?? slotId,
      slotId,
      region,
      x: override.x ?? base?.x ?? 0,
      y: override.y ?? base?.y ?? 0,
      width: override.width ?? base?.width,
      height: override.height ?? base?.height,
      fontSize: override.fontSize ?? base?.fontSize,
      fontWeight: override.fontWeight ?? base?.fontWeight,
    };

    const existingDataSource =
      override.type === "image"
        ? base?.dataSource?.type === "static"
          ? base.dataSource
          : { type: "static", value: "" }
        : base?.dataSource ?? { type: "static", value: "" };

    const nextElement: TemplateElement =
      override.type === "image"
        ? ensureImageElement(layoutBase, existingDataSource)
        : ensureTextElement(layoutBase, existingDataSource);

    if (idx >= 0) {
      elements[idx] = nextElement;
    } else {
      elements.push(nextElement);
    }
  }

  next.elements = elements;
  return next;
};

export const applySlotDataOverrides = (
  template: TemplateDefinition,
  overrides?: Record<string, SlotFieldRef>,
): TemplateDefinition => {
  if (!overrides || Object.keys(overrides).length === 0) {
    return template;
  }

  const next = structuredClone(template);
  const elements = [...(next.elements ?? [])];

  for (const slotId of Object.keys(overrides)) {
    const override = overrides[slotId];
    if (!override) continue;

    const idx = elements.findIndex((el) => (el as any).slotId === slotId);
    const region = normalizeSlotRegion(next, slotId);
    const base = idx >= 0 ? (elements[idx] as any) : null;

    const dataSource =
      override.kind === "recordField"
        ? { type: "kintone", fieldCode: override.fieldCode }
        : { type: "static", value: override.kind === "imageUrl" ? override.url ?? "" : override.text ?? "" };

    const layoutBase = {
      id: base?.id ?? slotId,
      slotId,
      region,
      x: base?.x ?? 0,
      y: base?.y ?? 0,
      width: base?.width,
      height: base?.height,
      fontSize: base?.fontSize,
      fontWeight: base?.fontWeight,
    };

    const nextElement: TemplateElement =
      override.kind === "imageUrl"
        ? ensureImageElement(layoutBase, dataSource)
        : ensureTextElement(layoutBase, dataSource);

    if (idx >= 0) {
      elements[idx] = nextElement;
    } else {
      elements.push(nextElement);
    }
  }

  next.elements = elements;
  return next;
};

export const buildTenantKey = (baseUrl: string, appId: string): string => {
  const normalizedBaseUrl = canonicalizeKintoneBaseUrl(baseUrl);
  const normalizedAppId = canonicalizeAppId(appId);
  const url = new URL(normalizedBaseUrl);
  return `${url.host}__${normalizedAppId}`;
};

export const buildUserTemplateKey = (tenantKey: string, templateId: string): string =>
  `${tenantKey}::tpl:${templateId}`;

export const buildTemplateMetaKey = (
  tenantKey: string,
  status: TemplateStatus,
  templateId: string,
): string => `${tenantKey}::tplmeta:${status}:${templateId}`;

export const buildTemplateMetaPrefix = (
  tenantKey: string,
  status: TemplateStatus,
): string => `${tenantKey}::tplmeta:${status}:`;

export const parseMetaKey = (key: string): { status: TemplateStatus; templateId: string } | null => {
  const parts = key.split("::tplmeta:");
  if (parts.length !== 2) return null;
  const [status, templateId] = parts[1].split(":");
  if (!status || !templateId) return null;
  if (status !== "active" && status !== "archived" && status !== "deleted") return null;
  return { status, templateId };
};

export const TEMPLATE_STATUSES: TemplateStatus[] = ["active", "archived", "deleted"];

export const getTemplateMeta = async (
  kv: KVNamespace,
  tenantKey: string,
  status: TemplateStatus,
  templateId: string,
): Promise<TemplateMeta | null> => {
  const key = buildTemplateMetaKey(tenantKey, status, templateId);
  const raw = await kv.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TemplateMeta;
  } catch {
    return null;
  }
};

export const findTemplateMeta = async (
  kv: KVNamespace,
  tenantKey: string,
  templateId: string,
): Promise<{ meta: TemplateMeta; status: TemplateStatus } | null> => {
  for (const status of TEMPLATE_STATUSES) {
    const meta = await getTemplateMeta(kv, tenantKey, status, templateId);
    if (meta) return { meta, status };
  }
  return null;
};

export const putTemplateMeta = async (
  kv: KVNamespace,
  tenantKey: string,
  meta: TemplateMeta,
): Promise<void> => {
  const key = buildTemplateMetaKey(tenantKey, meta.status, meta.templateId);
  await kv.put(key, JSON.stringify(meta));
};

export const deleteTemplateMeta = async (
  kv: KVNamespace,
  tenantKey: string,
  status: TemplateStatus,
  templateId: string,
): Promise<void> => {
  const key = buildTemplateMetaKey(tenantKey, status, templateId);
  await kv.delete(key);
};

export const listTemplateMetas = async (
  kv: KVNamespace,
  tenantKey: string,
  status: TemplateStatus,
  options?: { limit?: number; cursor?: string },
): Promise<{ items: TemplateMeta[]; cursor?: string }> => {
  const list = await kv.list({
    prefix: buildTemplateMetaPrefix(tenantKey, status),
    limit: options?.limit,
    cursor: options?.cursor,
  });

  const items: TemplateMeta[] = [];
  for (const key of list.keys) {
    const raw = await kv.get(key.name);
    if (!raw) continue;
    try {
      items.push(JSON.parse(raw) as TemplateMeta);
    } catch {
      continue;
    }
  }

  return { items, cursor: list.cursor };
};
