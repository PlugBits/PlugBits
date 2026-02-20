import type { TemplateDefinition } from '@shared/template';
import { isDebugEnabled } from '../shared/debugFlag';
import { appendDebugParam } from '../shared/appendDebug';
import { getTenantContext } from '../store/tenantStore';

export async function previewPdf(template: TemplateDefinition) {
  const tenantContext = getTenantContext();
  if (!tenantContext?.workerBaseUrl) {
    throw new Error('設定画面から開き直してください。');
  }
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (tenantContext.editorToken) {
    headers.Authorization = `Bearer ${tenantContext.editorToken}`;
  }
  const debugEnabled = isDebugEnabled();
  const renderUrl = appendDebugParam(
    `${tenantContext.workerBaseUrl.replace(/\/$/, '')}/render`,
    debugEnabled,
  );
  console.log('[DBG_PREVIEWPDF_CALL]', { enabled: debugEnabled, renderUrl });
  const res = await fetch(renderUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      template,
      data: template.sampleData,
      previewMode: 'fieldCode',
      companyProfile: tenantContext.companyProfile,
    }),
  });

  if (!res.ok) {
    throw new Error('処理に失敗しました。もう一度お試しください。');
  }

  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  window.open(blobUrl, '_blank');
}
