import { type TemplateDefinition } from '@shared/template';
import { isDebugEnabled } from '../shared/debugFlag';
import { appendDebugParam } from '../shared/appendDebug';
import { getTenantContext } from '../store/tenantStore';

const DBG_TEXT_TARGETS = new Set(['doc_title', 'doc_no', 'date_label', 'issue_date']);
const TABLE_DEBUG_PDF_TOP = 842;

const isItemNameColumn = (column: { id: string; fieldCode?: string | null }) =>
  column.id === 'item_name' || column.fieldCode === 'ItemName';

const resolveTableDebugCellId = (template: TemplateDefinition) => {
  const tables = template.elements.filter(
    (el): el is Extract<TemplateDefinition['elements'][number], { type: 'table' }> =>
      el.type === 'table',
  );
  if (tables.length === 0) return null;
  const table = tables.find((el) => el.id === 'items') ?? tables[0];
  if (!table.columns || table.columns.length === 0) return null;
  const itemColumn = table.columns.find(isItemNameColumn) ?? table.columns[0];
  if (!itemColumn?.id) return null;
  return `${table.id}:row0:${itemColumn.id}`;
};

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

  if (debugEnabled) {
    const header = res.headers.get('x-debug-text-baseline');
    if (header) {
      try {
        const entries = JSON.parse(header) as Array<{
          elementId: string;
          rectTopY: number;
        }>;
        const tableDebugCellId = resolveTableDebugCellId(template);
        const targetIds = new Set(DBG_TEXT_TARGETS);
        if (tableDebugCellId) targetIds.add(tableDebugCellId);
        const canvasTopById = (window as any).__DBG_CANVAS_TOP__ ?? {};
        for (const entry of entries) {
          if (!targetIds.has(entry.elementId)) continue;
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
