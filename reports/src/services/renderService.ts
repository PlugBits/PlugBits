import type { TemplateDataRecord, TemplateDefinition } from '@shared/template';
import { isDebugEnabled } from '../shared/debugFlag';
import { appendDebugParam } from '../shared/appendDebug';
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

  const debugEnabled = isDebugEnabled();
  const renderUrl = appendDebugParam(
    `${tenantContext.workerBaseUrl.replace(/\/$/, '')}/render-preview`,
    debugEnabled,
  );
  if (debugEnabled) console.log('[DBG_RENDER_URL]', renderUrl);
  const kintone =
    tenantContext?.kintoneBaseUrl && tenantContext?.appId
      ? { baseUrl: tenantContext.kintoneBaseUrl, appId: tenantContext.appId }
      : undefined;
  const res = await fetch(renderUrl, {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify({
      templateId: template.id,
      data,
      previewMode: "fieldCode",
      companyProfile: tenantContext.companyProfile,
      kintone,
    }),
  });

  if (!res.ok) {
    const raw = await res.text();
    let detail = raw;
    try {
      detail = JSON.stringify(JSON.parse(raw));
    } catch {
      // keep raw text
    }
    console.error("requestPreviewPdf error:", res.status, detail);
    throw new Error(`プレビューに失敗しました (${res.status}): ${detail || 'unknown error'}`);
  }

  return await res.blob();
}
