// src/services/templateService.ts

import type {
  TemplateDefinition,
  TemplateMeta,
  TemplateStatus,
  TableElement,
  TemplateElement,
} from '@shared/template';
import { getPageDimensions } from '@shared/template';
import { isDebugEnabled } from '../shared/debugFlag';
// userTemplateUtils no longer needed here after lossless base copy
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

export const canonicalizeTemplateForStorage = (
  template: TemplateDefinition,
): TemplateDefinition => {
  const clone =
    typeof structuredClone === 'function'
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
  const canonicalized = elements.map((element) => {
    const next = { ...element } as any;
    const slotId = next.slotId ?? next.id;
    const isCompanyLogo =
      slotId === 'company_logo' || slotId === 'logo' || next.id === 'company_logo' || next.id === 'logo';
    const isCompanySlot = typeof slotId === 'string' && slotId.startsWith('company_');
    if (isCompanyLogo) {
      next.slotId = 'company_logo';
      next.hidden = false;
      if ('dataSource' in next) delete next.dataSource;
      if ('imageUrl' in next) delete next.imageUrl;
    }
    if (isCompanySlot && !isCompanyLogo) {
      if ('dataSource' in next) delete next.dataSource;
      if ('text' in next) delete next.text;
    }
    if (next.slotId === null || next.slotId === undefined) {
      delete next.slotId;
    }
    if (next.type === 'text' || next.type === 'label') {
      if (next.alignX === null || next.alignX === undefined || next.alignX === 'left') {
        delete next.alignX;
      }
      if (next.valign === null || next.valign === undefined || next.valign === 'middle') {
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
      if (next.style && typeof next.style === 'object' && Object.keys(next.style).length === 0) {
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
    if (next.type === 'image') {
      if (next.fitMode === null || next.fitMode === undefined || next.fitMode === 'fit') {
        delete next.fitMode;
      }
    }
    return next as TemplateDefinition['elements'][number];
  });

  const logoCandidates = canonicalized.filter((el) => {
    if (el.type !== 'image') return false;
    const slotId = (el as any).slotId ?? el.id;
    return slotId === 'company_logo' || el.id === 'logo' || el.id === 'company_logo';
  }) as TemplateDefinition['elements'][number][];

  if (logoCandidates.length > 1) {
    const score = (el: any) => {
      const hiddenScore = el.hidden === true ? 1 : 0;
      const idScore = el.id === 'logo' ? 0 : 1;
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
    const pickedRef = picked;
    const removed = logoCandidates.filter((el) => el !== pickedRef).map((el) => el.id);
    if (removed.length > 0) {
      console.warn('[WARN_LOGO_DUPLICATE]', {
        count: logoCandidates.length,
        keptId: pickedRef.id,
        removedIds: removed,
      });
    }
    const deduped = canonicalized.filter((el) => {
      if (logoCandidates.includes(el as any)) {
        return el === pickedRef;
      }
      return true;
    });
    canonicalized.splice(0, canonicalized.length, ...deduped);
  }
  const hasCompanyLogo = canonicalized.some((el) => {
    const slotId = (el as any).slotId ?? el.id;
    return slotId === 'company_logo' || el.id === 'logo' || el.id === 'company_logo';
  });
  const companySlotDefs = [
    { slotId: 'company_name', label: '会社名', kind: 'text' },
    { slotId: 'company_address', label: '住所', kind: 'text' },
    { slotId: 'company_tel', label: 'TEL', kind: 'text' },
    { slotId: 'company_email', label: 'Email', kind: 'text' },
  ] as const;
  const hasCompanySlots = canonicalized.some((el) => {
    const slotId = (el as any).slotId ?? el.id;
    return typeof slotId === 'string' && slotId.startsWith('company_') && slotId !== 'company_logo';
  });
  const slotSchema = (clone as any).slotSchema as
    | { header?: Array<{ slotId: string; label?: string; kind?: string }> }
    | undefined;
  let nextSlotSchema = slotSchema;
  if (slotSchema?.header) {
    const headerSlots = slotSchema.header.map((slot) => {
      if (slot.slotId !== 'logo') return slot;
      return {
        ...slot,
        slotId: 'company_logo',
        label: slot.label === 'ロゴ' ? '会社ロゴ' : slot.label,
      };
    });
    const hasCompanyLogoSlot = headerSlots.some((slot) => slot.slotId === 'company_logo');
    if (hasCompanyLogo && !hasCompanyLogoSlot) {
      headerSlots.push({ slotId: 'company_logo', label: '会社ロゴ', kind: 'image' });
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
  return { ...clone, elements: canonicalized, ...(nextSlotSchema ? { slotSchema: nextSlotSchema } : {}) };
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
  const normalized = canonicalizeTemplateForStorage(template);
  const json = stableStringify(canonicalizeTemplateForFingerprint(normalized));
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
  const canonicalTemplate = canonicalizeTemplateForStorage(template);
  const payload: { template: TemplateDefinition } = {
    template: canonicalTemplate,
  };
  if (debugEnabled) {
    const pickMeta = (els: TemplateElement[]) =>
      els
        .filter((e) => {
          const slotId = (e as any).slotId as string | undefined;
          return (
            ['doc_no_label', 'date_label'].includes(e.id) ||
            (slotId ? ['doc_no_label', 'date_label'].includes(slotId) : false)
          );
        })
        .map((e) => ({
          id: e.id,
          slotId: (e as any).slotId ?? null,
          x: (e as any).x,
          y: (e as any).y,
          region: e.region ?? null,
        }));
    console.log('[DBG_SAVE_DOCMETA]', {
      templateId: template.id,
      elements: pickMeta(payload.template.elements),
    });
  }

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
  const normalizeDocMetaSlotIds = (template: TemplateDefinition): TemplateDefinition => {
    if (!Array.isArray(template.elements)) return template;
    let changed = false;
    const nextElements = template.elements.map((el) => {
      if (el.id === 'doc_no_label' || el.id === 'date_label') {
        const slotId = (el as any).slotId as string | undefined;
        if (!slotId) {
          changed = true;
          return { ...el, slotId: el.id } as TemplateElement;
        }
      }
      if (el.id === 'logo') {
        const slotId = (el as any).slotId as string | undefined;
        if (slotId !== 'company_logo') {
          changed = true;
          return { ...el, slotId: 'company_logo' } as TemplateElement;
        }
      }
      if ((el as any).slotId === 'logo') {
        changed = true;
        return { ...el, slotId: 'company_logo' } as TemplateElement;
      }
      return el;
    });
    return changed ? { ...template, elements: nextElements } : template;
  };
  const baseTemplate = normalizeDocMetaSlotIds(structuredClone(base));

  const id = generateUserTemplateId();
  const template: TemplateDefinition = {
    ...baseTemplate,
    id,
    name: name ?? base.name,
    baseTemplateId,
    mapping: baseTemplate.mapping ?? base.mapping,
    sheetSettings: baseTemplate.sheetSettings ?? base.sheetSettings,
    structureType,
  };

  if (isDebugEnabled()) {
    const pickMeta = (els: TemplateElement[]) =>
      els
        .filter((e) => {
          const slotId = (e as any).slotId as string | undefined;
          return (
            ['doc_no_label', 'date_label', 'doc_no', 'issue_date'].includes(e.id) ||
            (slotId ? ['doc_no_label', 'date_label', 'doc_no', 'issue_date'].includes(slotId) : false)
          );
        })
        .map((e) => ({
          id: e.id,
          slotId: (e as any).slotId ?? null,
          x: (e as any).x,
          y: (e as any).y,
          region: e.region ?? null,
        }));
    console.log('[DBG_DUP_COPY_DOCMETA]', {
      base: pickMeta(baseTemplate.elements ?? []),
      tpl: pickMeta(template.elements ?? []),
    });
  }

  const saved = await createTemplateRemote(template);
  return saved;
};
