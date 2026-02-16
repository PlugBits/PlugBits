import type { TemplateDataRecord, TemplateDefinition } from '@shared/template';
import { getTenantContext } from '../store/tenantStore';

function buildHeaders() {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const tenantContext = getTenantContext();
  if (tenantContext?.editorToken) {
    headers.Authorization = `Bearer ${tenantContext.editorToken}`;
  }
  return headers;
}

export async function requestPreviewPdf(
  template: TemplateDefinition,
  data?: TemplateDataRecord,
): Promise<Blob> {
  const tenantContext = getTenantContext();
  if (!tenantContext?.workerBaseUrl) {
    throw new Error('設定画面から開き直してください。');
  }

  const res = await fetch(`${tenantContext.workerBaseUrl.replace(/\/$/, '')}/render-preview`, {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify({
      templateId: template.id,
      template,
      data,
      previewMode: "fieldCode",
      companyProfile: tenantContext.companyProfile,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("requestPreviewPdf error:", res.status, text);
    throw new Error('処理に失敗しました。もう一度お試しください。');
  }

  return await res.blob();
}
