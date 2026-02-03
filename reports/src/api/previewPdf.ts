import type { TemplateDefinition } from '@shared/template';
import { getTenantContext } from '../store/tenantStore';

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
  const res = await fetch(`${tenantContext.workerBaseUrl.replace(/\/$/, '')}/render`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      template,
      data: template.sampleData,
      previewMode: 'fieldCode',
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Render failed: ${res.status} ${text}`);
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
}
