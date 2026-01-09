import type { TemplateDataRecord, TemplateDefinition } from '@shared/template';
import { getTenantContext } from '../store/tenantStore';

const API_KEY = import.meta.env.VITE_WORKER_API_KEY as string | undefined;

function buildHeaders() {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const tenantContext = getTenantContext();
  if (tenantContext?.editorToken) {
    headers.Authorization = `Bearer ${tenantContext.editorToken}`;
  }
  if (API_KEY) {
    headers["x-api-key"] = API_KEY;
  }
  return headers;
}

export async function requestPreviewPdf(
  template: TemplateDefinition,
  data?: TemplateDataRecord,
): Promise<Blob> {
  const tenantContext = getTenantContext();
  if (!tenantContext?.workerBaseUrl) {
    throw new Error('Missing tenant context. Launch from plugin.');
  }

  const res = await fetch(`${tenantContext.workerBaseUrl.replace(/\/$/, '')}/render-preview`, {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify({
      templateId: template.id,
      template,
      data,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("requestPreviewPdf error:", res.status, text);
    throw new Error(text || "Failed to render preview");
  }

  return await res.blob();
}
