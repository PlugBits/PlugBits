// src/services/templateService.ts

import type { TemplateDefinition, TemplateMeta, TemplateStatus, TableElement } from '@shared/template';
import { getPageDimensions } from '@shared/template';
import { isDebugEnabled } from '../shared/debugFlag';
import {
  applySlotDataOverrides,
  applySlotLayoutOverrides,
  extractSlotDataOverrides,
  extractSlotLayoutOverrides,
} from './userTemplateUtils';
import { getTenantContext as getTenantContextFromStore } from '../store/tenantStore';

export type TemplateCatalogItem = {
  templateId: string;
  displayName: string;
  structureType: string;
  description?: string;
  version?: number;
  flags?: string[];
  slotSchema?: unknown;
};

const getTenantContext = () => {
  const ctx = getTenantContextFromStore();
  if (!ctx) {
    throw new Error('設定画面から開き直してください。');
  }
  return ctx;
};

const getWorkerBaseUrl = () => getTenantContext().workerBaseUrl.replace(/\/$/, '');

const buildUrlFromBase = (
  baseUrl: string,
  path: string,
  params?: Record<string, string>,
) => {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(`${baseUrl}${normalized}`);
  if (params) {
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  }
  return url.toString();
};

const buildDebugParams = (params?: Record<string, string>) => {
  if (!isDebugEnabled()) return params;
  return { ...(params ?? {}), debug: '1' };
};

const buildUrl = (
  path: string,
  params?: Record<string, string>,
  workerBaseUrl?: string,
) => buildUrlFromBase(workerBaseUrl ?? getWorkerBaseUrl(), path, params);

const buildHeaders = (includeContentType = true, requireEditorToken = false) => {
  const headers: Record<string, string> = {};
  if (includeContentType) headers['Content-Type'] = 'application/json';
  const editorToken = getTenantContextFromStore()?.editorToken;
  if (editorToken) {
    headers.Authorization = `Bearer ${editorToken}`;
  } else if (requireEditorToken) {
    throw new Error('設定画面から開き直してください。');
  }
  return headers;
};

const getSummarySnapshot = (template: TemplateDefinition) => {
  const table = template.elements.find((el) => el.type === 'table') as TableElement | undefined;
  const mapping = template.mapping as any;
  return {
    mappingSummaryMode: mapping?.table?.summaryMode ?? mapping?.table?.summary?.mode ?? null,
    mappingSummaryConfig: mapping?.table?.summary ?? null,
    tableSummaryMode: table?.summary?.mode ?? null,
    tableSummaryRows: table?.summary?.rows?.map((row) => ({
      op: row.op,
      kind: row.kind ?? null,
      columnId: row.columnId,
      fieldCode: 'fieldCode' in row ? row.fieldCode : undefined,
    })) ?? [],
  };
};

const generateUserTemplateId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? `tpl_${crypto.randomUUID()}`
    : `tpl_${Date.now()}`;

const stableStringify = (value: unknown): string => {
  const seen = new WeakSet<object>();
  const stringify = (input: unknown): string => {
    if (input === null || typeof input === 'number' || typeof input === 'boolean') {
      return JSON.stringify(input);
    }
    if (typeof input === 'string') {
      return JSON.stringify(input);
    }
    if (typeof input !== 'object') {
      return 'null';
    }
    const obj = input as Record<string, unknown>;
    if (seen.has(obj)) return '"[Circular]"';
    seen.add(obj);
    if (Array.isArray(obj)) {
      const items = obj.map((item) => {
        if (item === undefined || typeof item === 'function' || typeof item === 'symbol') {
          return 'null';
        }
        return stringify(item);
      });
      return `[${items.join(',')}]`;
    }
    const keys = Object.keys(obj).sort();
    const entries: string[] = [];
    for (const key of keys) {
      const val = obj[key];
      if (val === undefined || typeof val === 'function' || typeof val === 'symbol') continue;
      entries.push(`${JSON.stringify(key)}:${stringify(val)}`);
    }
    return `{${entries.join(',')}}`;
  };
  return stringify(value);
};

const sha256Hex = async (input: string): Promise<string | null> => {
  if (typeof crypto === 'undefined' || !crypto.subtle) return null;
  try {
    const data = new TextEncoder().encode(input);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
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
    template.structureType === 'label_v1'
      ? (template as any).sheetSettings ?? null
      : null,
});

export const buildTemplateFingerprint = async (template: TemplateDefinition) => {
  const json = stableStringify(canonicalizeTemplateForFingerprint(template));
  const hash = await sha256Hex(json);
  return {
    jsonLen: json.length,
    elements: Array.isArray(template.elements) ? template.elements.length : 0,
    hash,
    hashType: hash ? 'sha256' : 'none',
  };
};

// NOTE:
// - baseTemplateId identifies the catalog/base template (e.g. "list_v1").
// - TemplateDefinition.id / templateId identifies the user-specific template (e.g. "tpl_*").
// - fetchBaseTemplate() must be called with baseTemplateId (catalog id).
// - user templateId and baseTemplateId are expected to differ.
export const fetchBaseTemplate = async (
  templateId: string,
  opts?: { workerBaseUrl?: string },
): Promise<TemplateDefinition> => {
  const res = await fetch(
    buildUrl(`/templates/${templateId}`, buildDebugParams(), opts?.workerBaseUrl),
    {
    headers: buildHeaders(false),
    cache: 'no-store',
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Failed to fetch base template: ${templateId}`);
  }
  return (await res.json()) as TemplateDefinition;
};

export const updateBaseTemplate = async (
  template: TemplateDefinition,
  opts?: { workerBaseUrl?: string; adminApiKey?: string },
): Promise<TemplateDefinition> => {
  const headers = buildHeaders(true);
  if (opts?.adminApiKey) {
    headers['x-api-key'] = opts.adminApiKey;
  }
  const res = await fetch(
    buildUrl(`/templates/${template.id}`, undefined, opts?.workerBaseUrl),
    {
      method: 'PUT',
      headers,
      body: JSON.stringify(template),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Failed to update base template: ${template.id}`);
  }
  return (await res.json()) as TemplateDefinition;
};

export const fetchTemplateCatalog = async (): Promise<TemplateCatalogItem[]> => {
  const res = await fetch(buildUrl('/templates-catalog'), {
    headers: buildHeaders(false),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || 'Failed to fetch template catalog');
  }
  const data = (await res.json()) as { templates?: TemplateCatalogItem[] };
  return Array.isArray(data.templates) ? data.templates : [];
};

export const listUserTemplateMetas = async (params: {
  status: TemplateStatus;
  baseTemplateId?: string;
  limit?: number;
  cursor?: string;
}): Promise<{ items: TemplateMeta[]; nextCursor?: string }> => {
  const tenant = getTenantContext();
  const query: Record<string, string> = {
    status: params.status,
  };
  if (params.baseTemplateId) query.baseTemplateId = params.baseTemplateId;
  if (params.limit) query.limit = String(params.limit);
  if (params.cursor) query.cursor = params.cursor;

  const url = buildUrl('/user-templates', query);
  console.log('[templateService] list user templates', {
    workerBaseUrl: tenant.workerBaseUrl,
    status: params.status,
    url,
  });
  const res = await fetch(url, {
    headers: buildHeaders(false, true),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || 'Failed to fetch user template meta list');
  }
  const data = (await res.json()) as { items?: TemplateMeta[]; nextCursor?: string };
  const items = Array.isArray(data.items) ? data.items : [];
  console.log('[templateService] list user templates success', { count: items.length });
  return { items, nextCursor: data.nextCursor };
};

const callUserTemplateAction = async (
  templateId: string,
  action: string,
  method: 'POST' | 'DELETE' = 'POST',
): Promise<TemplateMeta | { ok: true }> => {
  const tenant = getTenantContext();
  const url = buildUrl(`/user-templates/${templateId}/${action}`);
  console.log('[templateService] user template action', {
    workerBaseUrl: tenant.workerBaseUrl,
    templateId,
    action,
    url,
  });
  const res = await fetch(url, {
    method,
    headers: buildHeaders(false, true),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Failed to ${action} template`);
  }
  if (method === 'DELETE') {
    return { ok: true };
  }
  return (await res.json()) as TemplateMeta;
};

export const archiveTemplate = async (templateId: string): Promise<TemplateMeta> =>
  (await callUserTemplateAction(templateId, 'archive')) as TemplateMeta;

export const unarchiveTemplate = async (templateId: string): Promise<TemplateMeta> =>
  (await callUserTemplateAction(templateId, 'unarchive')) as TemplateMeta;

export const softDeleteTemplate = async (templateId: string): Promise<TemplateMeta> =>
  (await callUserTemplateAction(templateId, 'delete')) as TemplateMeta;

export const restoreTemplate = async (templateId: string): Promise<TemplateMeta> =>
  (await callUserTemplateAction(templateId, 'restore')) as TemplateMeta;

export const purgeTemplate = async (templateId: string): Promise<void> => {
  await callUserTemplateAction(templateId, 'purge', 'DELETE');
};

export const fetchTemplateById = async (templateId: string): Promise<TemplateDefinition> => {
  const isUserTemplate = templateId.startsWith('tpl_');
  const url = isUserTemplate
    ? buildUrl(`/user-templates/${templateId}`, buildDebugParams())
    : buildUrl(`/templates/${templateId}`, buildDebugParams());
  if (isUserTemplate) {
    const tenant = getTenantContext();
    console.log('[templateService] load user template', {
      workerBaseUrl: tenant.workerBaseUrl,
      templateId,
      url,
    });
  }
  const res = await fetch(url, {
    headers: buildHeaders(false, isUserTemplate),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || 'Failed to fetch template');
  }
  const data = (await res.json()) as TemplateDefinition;
  if (isUserTemplate) {
    console.log('[templateService] load user template success', { templateId });
  }
  return data;
};

export async function createTemplateRemote(
  template: TemplateDefinition,
): Promise<TemplateDefinition> {
  const workerBaseUrl = getWorkerBaseUrl();
  const debugEnabled = isDebugEnabled();
  console.log('[templateService] save template', {
    workerBaseUrl,
    templateId: template.id,
  });
  console.info('[templateService] summary snapshot', {
    templateId: template.id,
    ...getSummarySnapshot(template),
  });
  const updatedAt = new Date().toISOString();
  const payload: { template: TemplateDefinition } = {
    template,
  };

  const url = buildUrl(`/user-templates/${template.id}`, buildDebugParams());
  console.log('[templateService] save user template request', {
    workerBaseUrl,
    templateId: template.id,
    url,
  });
  const res = await fetch(url, {
    method: 'PUT',
    headers: buildHeaders(true, true),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || 'Failed to save template');
  }

  console.log('[templateService] save user template success', { templateId: template.id });
  if (debugEnabled) {
    const fingerprint = await buildTemplateFingerprint(template);
    const dims = getPageDimensions(template.pageSize ?? 'A4', template.orientation ?? 'portrait');
    const etag = res.headers.get('etag');
    const revision = res.headers.get('x-template-revision') ?? res.headers.get('x-template-version');
    const schemaVersion = res.headers.get('x-template-schema-version');
    console.debug(
      `[DBG_SAVE] templateId=${template.id} pageSize=${template.pageSize ?? 'A4'} w=${dims.width} h=${dims.height} ` +
        `elements=${fingerprint.elements} jsonLen=${fingerprint.jsonLen} ` +
        `hash=${fingerprint.hash ?? ''} hashType=${fingerprint.hashType} worker=${workerBaseUrl} url=${url} ` +
        `updatedAt=${updatedAt} etag=${etag ?? ''} revision=${revision ?? ''} schema=${schemaVersion ?? ''}`,
    );
  }
  return template;
}

export const createUserTemplateFromBase = async (
  baseTemplateId: string,
  name?: string,
): Promise<TemplateDefinition> => {
  const base = await fetchBaseTemplate(baseTemplateId);
  const structureType = base.structureType ?? 'list_v1';
  let mapped: TemplateDefinition;
  if (structureType === 'label_v1') {
    mapped = { ...base, structureType };
  } else {
    const adapter = (await import('../editor/Mapping/adapters/getAdapter')).getAdapter(
      structureType,
    );
    const mapping = base.mapping ?? adapter.createDefaultMapping();
    mapped = adapter.applyMappingToTemplate(
      { ...base, structureType, mapping },
      mapping,
    );
  }

  const id = generateUserTemplateId();
  const template: TemplateDefinition = {
    ...mapped,
    id,
    name: name ?? base.name,
    baseTemplateId,
    mapping: mapped.mapping ?? base.mapping,
    sheetSettings: mapped.sheetSettings ?? base.sheetSettings,
  };

  const saved = await createTemplateRemote(template);
  const layoutApplied = applySlotLayoutOverrides(template, extractSlotLayoutOverrides(template));
  const dataApplied = applySlotDataOverrides(layoutApplied, extractSlotDataOverrides(template));
  return { ...dataApplied, ...saved };
};
