import type { LabelMapping, TemplateDefinition } from '@shared/template';
import { getTenantContext } from '../store/tenantStore';

const buildLabelPreviewRecord = (template: TemplateDefinition): Record<string, unknown> => {
  const mapping = template.mapping as Partial<LabelMapping> | undefined;
  const slots = mapping?.slots ?? {};
  const fieldCodes = [
    slots.title,
    slots.code,
    slots.qty,
    slots.qr,
    slots.extra,
  ].filter((value): value is string => typeof value === 'string' && value.trim() !== '');
  const record: Record<string, unknown> = {};
  fieldCodes.forEach((fieldCode) => {
    record[fieldCode] = fieldCode;
  });
  return record;
};

export async function previewPdf(template: TemplateDefinition) {
  const tenantContext = getTenantContext();
  if (!tenantContext?.workerBaseUrl) {
    throw new Error('Missing tenant context. Launch from plugin.');
  }
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (tenantContext.editorToken) {
    headers.Authorization = `Bearer ${tenantContext.editorToken}`;
  }
  const previewData =
    template.structureType === 'label_v1'
      ? buildLabelPreviewRecord(template)
      : template.sampleData;
  const res = await fetch(`${tenantContext.workerBaseUrl.replace(/\/$/, '')}/render`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ template, data: previewData }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Render failed: ${res.status} ${text}`);
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
}
