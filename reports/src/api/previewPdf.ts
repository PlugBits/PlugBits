import { type TemplateDefinition } from '@shared/template';
import { isDebugEnabled } from '../shared/debugFlag';
import { appendDebugParam } from '../shared/appendDebug';
import { getTenantContext } from '../store/tenantStore';

const DBG_TEXT_TARGETS = new Set([
  'doc_title',
  'doc_no',
  'date_label',
  'issue_date',
  'items:row0:item_name',
]);
const TABLE_DEBUG_PDF_TOP = 842;
type PreviewSource = 'saved' | 'draft';

export async function previewPdf(
  template: TemplateDefinition,
  options?: { source?: PreviewSource },
) {
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
  const source: PreviewSource = options?.source ?? 'saved';
  console.log('[DBG_PREVIEWPDF_CALL]', {
    enabled: debugEnabled,
    renderUrl,
    source,
  });
  const kintone =
    tenantContext.kintoneBaseUrl && tenantContext.appId
      ? { baseUrl: tenantContext.kintoneBaseUrl, appId: tenantContext.appId }
      : undefined;
  const body =
    source === 'draft'
      ? {
          templateId: template.id,
          template,
          data: template.sampleData,
          previewMode: 'fieldCode',
          companyProfile: tenantContext.companyProfile,
          kintone,
        }
      : {
          templateId: template.id,
          data: template.sampleData,
          previewMode: 'fieldCode',
          companyProfile: tenantContext.companyProfile,
          kintone,
        };
  const res = await fetch(renderUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const raw = await res.text();
    let detail = raw;
    try {
      detail = JSON.stringify(JSON.parse(raw));
    } catch {
      // keep raw text
    }
    throw new Error(`プレビューに失敗しました (${res.status}): ${detail || 'unknown error'}`);
  }

  if (debugEnabled) {
    const header = res.headers.get('x-debug-text-baseline');
    if (header) {
      try {
        const entries = JSON.parse(header) as Array<{
          elementId: string;
          rectTopY: number;
        }>;
        const canvasTopById = (window as any).__DBG_CANVAS_TOP__ ?? {};
        for (const entry of entries) {
          if (!DBG_TEXT_TARGETS.has(entry.elementId)) continue;
          const canvasTop = canvasTopById[entry.elementId];
          if (typeof canvasTop !== 'number') continue;
          const pdfTop = TABLE_DEBUG_PDF_TOP - entry.rectTopY;
          const diffPx = canvasTop - pdfTop;
          console.log('[DBG_TEXT_DIFF]', {
            elementId: entry.elementId,
            canvasTop,
            pdfTop,
            diffPx,
          });
        }
      } catch (error) {
        console.debug('[DBG_TEXT_DIFF] parse failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  window.open(blobUrl, '_blank');
}
