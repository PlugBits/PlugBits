// src/services/templateService.ts

import type {
  LabelMapping,
  TemplateDefinition,
  TemplateMeta,
  TemplateStatus,
  TableElement,
} from '@shared/template';
import {
  applySlotDataOverrides,
  applySlotLayoutOverrides,
  extractSlotDataOverrides,
  extractSlotLayoutOverrides,
  type UserTemplatePayload,
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

const buildUrl = (path: string, params?: Record<string, string>) => {
  const baseUrl = getWorkerBaseUrl();
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(`${baseUrl}${normalized}`);
  if (params) {
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  }
  return url.toString();
};

const buildHeaders = (includeContentType = true, requireEditorToken = false) => {
  const headers: Record<string, string> = {};
  if (includeContentType) headers['Content-Type'] = 'application/json';
  const { editorToken } = getTenantContext();
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

const normalizeLabelMappingForSave = (raw: unknown): LabelMapping => {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const slots = source.slots && typeof source.slots === 'object'
    ? (source.slots as Record<string, unknown>)
    : {};
  const normalizeField = (value: unknown) =>
    typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
  return {
    slots: {
      title: normalizeField(slots.title),
      code: normalizeField(slots.code),
      qty: normalizeField(slots.qty),
      qr: normalizeField(slots.qr),
      extra: normalizeField(slots.extra),
    },
    copiesFieldCode: normalizeField(source.copiesFieldCode),
  };
};

const generateUserTemplateId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? `tpl_${crypto.randomUUID()}`
    : `tpl_${Date.now()}`;

// NOTE:
// - baseTemplateId identifies the catalog/base template (e.g. "list_v1").
// - TemplateDefinition.id / templateId identifies the user-specific template (e.g. "tpl_*").
// - fetchBaseTemplate() must be called with baseTemplateId (catalog id).
// - user templateId and baseTemplateId are expected to differ.
const fetchBaseTemplate = async (templateId: string): Promise<TemplateDefinition> => {
  const res = await fetch(buildUrl(`/templates/${templateId}`), {
    headers: buildHeaders(false),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Failed to fetch base template: ${templateId}`);
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
    ? buildUrl(`/user-templates/${templateId}`)
    : buildUrl(`/templates/${templateId}`);
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
  console.log('[templateService] save template', {
    workerBaseUrl,
    templateId: template.id,
  });
  console.info('[templateService] summary snapshot', {
    templateId: template.id,
    ...getSummarySnapshot(template),
  });
  const baseTemplateId = template.baseTemplateId ?? 'list_v1';
  const structureType = template.structureType ?? 'list_v1';
  const mapping =
    structureType === 'label_v1'
      ? normalizeLabelMappingForSave(template.mapping)
      : template.mapping ?? null;
  const payload: UserTemplatePayload = {
    baseTemplateId,
    pageSize: template.pageSize,
    sheetSettings: template.sheetSettings,
    mapping,
    overrides: {
      layout: extractSlotLayoutOverrides(template),
      slots: extractSlotDataOverrides(template),
    },
    settings: template.settings,
    meta: {
      name: template.name,
      updatedAt: new Date().toISOString(),
    },
  };

  const url = buildUrl(`/user-templates/${template.id}`);
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
  return { ...template, baseTemplateId };
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
