import { PDFDocument, StandardFonts, rgb, type PDFImage, type PDFFont, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type {
  ImageElement,
  LabelElement,
  TableColumn,
  TableElement,
  TemplateDataRecord,
  TemplateDefinition,
  TemplateElement,
  TextElement,
} from '../shared/template.js';
import { getPageDimensions } from '../shared/template.js';

type FontBytes = {
  jp: Uint8Array | null;
  latin: Uint8Array | null;
};

export type RenderPipelineStage =
  | 'prepare_doc_load_pdf'
  | 'prepare_doc_register_fontkit'
  | 'prepare_doc_embed_fonts'
  | 'prepare_doc_init_state'
  | 'merge_background'
  | 'draw_static'
  | 'draw_table'
  | 'save_pdf'
  | 'upload_pdf'
  | 'result_update';

type TableTrace = {
  rowIndex: number;
  pageIndex: number;
  templateYMode: 'top' | 'bottom';
  incomingTableY: number;
  normalizedTableY: number;
  currentY: number;
  remainingRows: number;
  pageHeight: number;
  usableTop: number;
  usableBottom: number;
  availableHeight: number;
  reservedFooterHeight: number;
  explicitFooterReserveHeight: number | null;
  derivedFooterBoundary: number;
  headerHeight: number;
  tableHeaderHeight: number;
  firstRowHeight: number;
  rowBottomY: number;
  nextY: number;
  pageBreakThreshold: number;
  tableStartY: number;
  bodyStartY: number;
  clampApplied: boolean;
  clampReason?: string | null;
};

type RenderOptions = {
  debug?: boolean;
  previewMode?: 'record' | 'fieldCode';
  renderMode?: 'layout' | 'preview' | 'final';
  useJpFont?: boolean;
  superFastMode?: boolean;
  layer?: 'full' | 'dynamic';
  backgroundPdfBytes?: Uint8Array | null;
  tenantLogo?: { bytes: Uint8Array; contentType: string; objectKey: string };
  skipLogo?: boolean;
  skipStaticLabels?: boolean;
  useBaseBackgroundDoc?: boolean;
  requestId?: string;
  onStageStart?: (stage: RenderPipelineStage) => void;
  onStageDone?: (stage: RenderPipelineStage, ms: number) => void;
  onStageError?: (stage: RenderPipelineStage, error: unknown) => void;
  onLayoutResolved?: (details: {
    templateYMode: 'top' | 'bottom';
    pageHeight: number;
    tableId: string | null;
    templateId: string | null;
    presetId: string | null;
    incomingTableY: number | null;
    normalizedTableY: number | null;
    pdfTableStartY: number | null;
    bodyStartY: number | null;
  }) => void;
  onTableStart?: (details: TableTrace & { rowsTotal: number }) => void;
  onTableRow?: (details: TableTrace) => void;
  onTablePageBreak?: (details: TableTrace) => void;
  onTableDone?: (details: { rowsDrawn: number; pagesUsed: number; ms: number }) => void;
  onTableError?: (details: TableTrace & { reason: string; message: string }) => void;
};

const DYNAMIC_SLOT_IDS = new Set([
  'to_name',
  'to_honorific',
  'issue_date',
  'doc_no',
  'company_logo',
  'company_name',
  'company_address',
  'company_tel',
  'company_email',
  'items',
  'subtotal',
  'tax',
  'total',
  'remarks',
]);

const hasNonAscii = (text: string) => /[^\u0000-\u007F]/.test(text);
const isNumericLike = (text: string) => /^[0-9.,+\-() ¥$%/]*$/.test(text);

const pickFont = (text: string, latinFont: PDFFont, jpFont: PDFFont) => {
  if (!text) return latinFont;
  if (isNumericLike(text)) return latinFont;
  return hasNonAscii(text) ? jpFont : latinFont;
};

const gray = (value?: number) => {
  const normalized = typeof value === 'number' ? Math.max(0, Math.min(1, value)) : 0;
  return rgb(normalized, normalized, normalized);
};

const drawBox = (page: PDFPage, element: TemplateElement) => {
  if (element.fillGray != null) {
    page.drawRectangle({
      x: element.x,
      y: element.y,
      width: element.width ?? 0,
      height: element.height ?? 0,
      color: gray(element.fillGray),
      borderColor: undefined,
    });
  }
  if ((element.borderWidth ?? 0) > 0) {
    page.drawRectangle({
      x: element.x,
      y: element.y,
      width: element.width ?? 0,
      height: element.height ?? 0,
      borderWidth: element.borderWidth,
      borderColor: gray(element.borderColorGray ?? 0),
      color: undefined,
    });
  }
};

const stringifyValue = (value: unknown): string => {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return '';
};

const resolveDataSourceValue = (
  dataSource: TextElement['dataSource'] | TableElement['dataSource'] | undefined,
  data: TemplateDataRecord | undefined,
) => {
  if (!dataSource) return '';
  if (dataSource.type === 'static') return stringifyValue(dataSource.value);
  if (!data || dataSource.type !== 'kintone') return '';
  return stringifyValue(data[dataSource.fieldCode]);
};

const resolveTextValue = (element: TextElement, data: TemplateDataRecord | undefined) => {
  const resolved = resolveDataSourceValue(element.dataSource, data);
  if (resolved) return resolved;
  return stringifyValue(element.text);
};

const resolveTableRows = (table: TableElement, data: TemplateDataRecord | undefined): Record<string, unknown>[] => {
  if (!table.dataSource || table.dataSource.type !== 'kintoneSubtable' || !data) return [];
  const raw = data[table.dataSource.fieldCode];
  if (!Array.isArray(raw)) return [];
  return raw.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object' && !Array.isArray(row));
};

const formatAmount = (value: unknown) => {
  const text = stringifyValue(value).trim();
  if (!text) return '';
  const normalized = Number(text.replace(/,/g, ''));
  if (!Number.isFinite(normalized)) return text;
  return new Intl.NumberFormat('ja-JP').format(normalized);
};

const computeSummaryValue = (slotId: string, data: TemplateDataRecord | undefined, rows: Record<string, unknown>[]) => {
  const direct = slotId ? stringifyValue(data?.[slotId]) : '';
  if (direct) return direct;
  const subtotal = rows.reduce((sum, row) => {
    const raw = stringifyValue(row.Amount ?? row.amount).replace(/,/g, '');
    const value = Number(raw);
    return Number.isFinite(value) ? sum + value : sum;
  }, 0);
  if (slotId === 'subtotal') return subtotal ? new Intl.NumberFormat('ja-JP').format(subtotal) : '';
  const taxRaw = stringifyValue(data?.tax).replace(/,/g, '');
  const tax = Number(taxRaw);
  if (slotId === 'tax') return Number.isFinite(tax) ? new Intl.NumberFormat('ja-JP').format(tax) : '';
  if (slotId === 'total') {
    const totalRaw = stringifyValue(data?.total).replace(/,/g, '');
    const total = Number(totalRaw);
    const resolved = Number.isFinite(total) ? total : subtotal + (Number.isFinite(tax) ? tax : 0);
    return resolved ? new Intl.NumberFormat('ja-JP').format(resolved) : '';
  }
  return direct;
};

const fitLines = (text: string, maxCharsPerLine: number) => {
  if (!text) return [''];
  const lines: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    if (rawLine.length <= maxCharsPerLine) {
      lines.push(rawLine);
      continue;
    }
    let current = '';
    for (const char of rawLine) {
      if ((current + char).length > maxCharsPerLine) {
        lines.push(current);
        current = char;
      } else {
        current += char;
      }
    }
    if (current) lines.push(current);
  }
  return lines.length > 0 ? lines : [''];
};

const drawTextBlock = (
  page: PDFPage,
  text: string,
  element: Pick<TextElement, 'x' | 'y' | 'width' | 'height' | 'fontSize' | 'alignX' | 'fontWeight'>,
  latinFont: PDFFont,
  jpFont: PDFFont,
) => {
  const fontSize = element.fontSize ?? 10;
  const boxWidth = element.width ?? 0;
  const boxHeight = element.height ?? fontSize;
  const lines = fitLines(text, Math.max(1, Math.floor(boxWidth / Math.max(fontSize * 0.75, 6))));
  const lineHeight = fontSize * 1.2;
  const startY = element.y + boxHeight - fontSize - 2;
  lines.slice(0, Math.max(1, Math.floor(boxHeight / lineHeight))).forEach((line, index) => {
    const font = pickFont(line, latinFont, jpFont);
    const textWidth = font.widthOfTextAtSize(line, fontSize);
    let drawX = element.x;
    if (element.alignX === 'center') {
      drawX = element.x + Math.max(0, (boxWidth - textWidth) / 2);
    } else if (element.alignX === 'right') {
      drawX = element.x + Math.max(0, boxWidth - textWidth - 2);
    }
    const drawY = startY - index * lineHeight;
    page.drawText(line, {
      x: drawX,
      y: drawY,
      size: fontSize,
      font,
      color: rgb(0, 0, 0),
    });
  });
};

const shouldSkipTextElement = (element: TextElement, options: RenderOptions) => {
  if (!options.skipStaticLabels) return false;
  const slotId = element.slotId ?? element.id;
  if (slotId && DYNAMIC_SLOT_IDS.has(slotId)) return false;
  if (slotId && slotId.startsWith('company_')) return false;
  return element.dataSource?.type === 'static' || Boolean(element.text);
};

const embedLogo = async (
  pdfDoc: PDFDocument,
  tenantLogo: RenderOptions['tenantLogo'],
): Promise<PDFImage | null> => {
  if (!tenantLogo) return null;
  const contentType = tenantLogo.contentType.toLowerCase();
  if (contentType.includes('png')) {
    return pdfDoc.embedPng(tenantLogo.bytes);
  }
  if (contentType.includes('jpg') || contentType.includes('jpeg')) {
    return pdfDoc.embedJpg(tenantLogo.bytes);
  }
  return null;
};

const drawImageElement = (
  page: PDFPage,
  element: ImageElement,
  image: PDFImage | null,
) => {
  if (!image) return false;
  page.drawImage(image, {
    x: element.x,
    y: element.y,
    width: element.width ?? 0,
    height: element.height ?? 0,
  });
  return true;
};

const isFooterElement = (element: TemplateElement) => element.region === 'footer';
const isTableElement = (element: TemplateElement): element is TableElement => element.type === 'table';

const resolveTemplateYMode = (template: TemplateDefinition): 'top' | 'bottom' => {
  return template.rawYMode === 'top' || template.settings?.yMode === 'top' ? 'top' : 'bottom';
};

const resolveElementHeightForYMode = (element: TemplateElement) => {
  if (typeof element.height === 'number') return element.height;
  if (element.type === 'table') {
    return element.headerHeight ?? element.rowHeight ?? 18;
  }
  if (element.type === 'text' || element.type === 'label') {
    const fontSize = element.fontSize ?? 12;
    return fontSize * 1.2;
  }
  return 0;
};

const normalizeTemplateForPdfCoordinates = (
  template: TemplateDefinition,
  pageHeight: number,
): TemplateDefinition => {
  if (resolveTemplateYMode(template) !== 'top') return template;
  return {
    ...template,
    rawYMode: 'bottom',
    settings: {
      ...(template.settings ?? {}),
      yMode: 'bottom',
    },
    elements: template.elements.map((element) => ({
      ...element,
      y: pageHeight - element.y - resolveElementHeightForYMode(element),
    })),
  };
};

const drawTableHeader = (
  page: PDFPage,
  table: TableElement,
  latinFont: PDFFont,
  jpFont: PDFFont,
  topY: number,
  drawHeaderBox: boolean,
) => {
  const headerHeight = table.headerHeight ?? 24;
  let cursorX = table.x;
  for (const column of table.columns ?? []) {
    if (drawHeaderBox) {
      page.drawRectangle({
        x: cursorX,
        y: topY,
        width: column.width,
        height: headerHeight,
        borderWidth: table.borderWidth ?? 0.9,
        borderColor: gray(table.borderColorGray ?? 0.3),
      });
      drawTextBlock(
        page,
        column.title,
        {
          x: cursorX + 4,
          y: topY + 2,
          width: column.width - 8,
          height: headerHeight - 4,
          fontSize: 10,
          alignX: column.align === 'right' ? 'right' : 'left',
          fontWeight: 'bold',
        },
        latinFont,
        jpFont,
      );
    }
    cursorX += column.width;
  }
};

const drawTableRows = (
  page: PDFPage,
  table: TableElement,
  rows: Record<string, unknown>[],
  startIndex: number,
  latinFont: PDFFont,
  jpFont: PDFFont,
  headerY: number,
  minRowY: number,
  overlayMode: boolean,
  pageIndex: number,
  pageHeight: number,
  reservedFooterHeight: number,
  explicitFooterReserveHeight: number | null,
  derivedFooterBoundary: number,
  templateYMode: 'top' | 'bottom',
  incomingTableY: number,
  clampApplied: boolean,
  clampReason: string | null,
  onTableRow?: (details: TableTrace) => void,
) => {
  const rowHeight = table.rowHeight ?? 20;
  const headerHeight = overlayMode ? 0 : (table.headerHeight ?? 24);
  let rowTopY = headerY - headerHeight;
  let index = startIndex;
  let rowsDrawn = 0;
  let rejectedLayout: TableTrace | null = null;

  while (index < rows.length) {
    const rowBottomY = rowTopY - rowHeight;
    const layout: TableTrace = {
      rowIndex: index,
      pageIndex,
      templateYMode,
      incomingTableY,
      normalizedTableY: table.y,
      currentY: rowTopY,
      remainingRows: rows.length - index,
      pageHeight,
      usableTop: headerY,
      usableBottom: minRowY,
      availableHeight: rowTopY - minRowY,
      reservedFooterHeight,
      explicitFooterReserveHeight,
      derivedFooterBoundary,
      headerHeight: Math.max(0, pageHeight - headerY),
      tableHeaderHeight: headerHeight,
      firstRowHeight: rowHeight,
      rowBottomY,
      nextY: rowBottomY,
      pageBreakThreshold: minRowY,
      tableStartY: table.y,
      bodyStartY: headerY - headerHeight,
      clampApplied,
      clampReason,
    };
    if (rowBottomY < minRowY) {
      rejectedLayout = layout;
      break;
    }
    onTableRow?.(layout);
    const row = rows[index];
    let cursorX = table.x;
    for (const column of table.columns ?? []) {
      if (!overlayMode || table.showGrid) {
        page.drawRectangle({
          x: cursorX,
          y: rowBottomY,
          width: column.width,
          height: rowHeight,
          borderWidth: table.borderWidth ?? 0.5,
          borderColor: gray(table.borderColorGray ?? 0.3),
        });
      }
      const rawValue = row[column.fieldCode];
      const text = column.align === 'right' ? formatAmount(rawValue) : stringifyValue(rawValue);
      drawTextBlock(
        page,
        text,
        {
          x: cursorX + 4,
          y: rowBottomY + 2,
          width: column.width - 8,
          height: rowHeight - 4,
          fontSize: 9,
          alignX: column.align === 'right' ? 'right' : 'left',
          fontWeight: 'normal',
        },
        latinFont,
        jpFont,
      );
      cursorX += column.width;
    }
    rowTopY = rowBottomY;
    index += 1;
    rowsDrawn += 1;
  }

  return {
    nextIndex: index,
    rowsDrawn,
    currentY: rowTopY,
    rejectedLayout,
  };
};

export async function renderTemplateToPdf(
  template: TemplateDefinition,
  data: TemplateDataRecord | undefined,
  fonts: FontBytes,
  options: RenderOptions = {},
): Promise<{
  bytes: Uint8Array;
  warnings: string[];
  stats: { companyLogoDrawn: boolean };
}> {
  const nowMs = () =>
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
  const runStage = async <T>(stage: RenderPipelineStage, fn: () => Promise<T> | T): Promise<T> => {
    const startedAt = nowMs();
    options.onStageStart?.(stage);
    try {
      const result = await fn();
      options.onStageDone?.(stage, Math.round(nowMs() - startedAt));
      return result;
    } catch (error) {
      options.onStageError?.(stage, error);
      throw error;
    }
  };

  const { width: pageWidth, height: pageHeight } = getPageDimensions(
    template.pageSize ?? 'A4',
    template.orientation ?? 'portrait',
  );
  const templateYMode = resolveTemplateYMode(template);
  const templateForPdf = normalizeTemplateForPdfCoordinates(template, pageHeight);
  const incomingTable = template.elements.find(isTableElement);
  const normalizedTable = templateForPdf.elements.find(isTableElement);

  let pdfDoc!: PDFDocument;
  let latinFont!: PDFFont;
  let jpFont!: PDFFont;
  await runStage('prepare_doc_load_pdf', async () => {
    pdfDoc = await PDFDocument.create();
  });
  await runStage('prepare_doc_register_fontkit', () => {
    pdfDoc.registerFontkit(fontkit);
  });
  await runStage('prepare_doc_embed_fonts', async () => {
    latinFont = fonts.latin
      ? await pdfDoc.embedFont(fonts.latin, { subset: true })
      : await pdfDoc.embedFont(StandardFonts.Helvetica);
    jpFont = options.useJpFont && fonts.jp
      ? await pdfDoc.embedFont(fonts.jp, { subset: false })
      : latinFont;
  });

  let backgroundPage = null as Awaited<ReturnType<PDFDocument['embedPdf']>>[number] | null;
  await runStage('merge_background', async () => {
    if (!options.backgroundPdfBytes?.length) return;
    const [embedded] = await pdfDoc.embedPdf(options.backgroundPdfBytes, [0]);
    backgroundPage = embedded;
  });

  let tenantLogoImage: PDFImage | null = null;
  let companyLogoDrawn = false;
  let table: TableElement | undefined;
  let tableRows: Record<string, unknown>[] = [];
  let minBodyY = 228;
  let derivedFooterBoundary = 228;
  let explicitFooterReserveHeight: number | null = null;
  let clampApplied = false;
  let clampReason: string | null = null;
  const overlayMode = Boolean(options.backgroundPdfBytes?.length);
  await runStage('prepare_doc_init_state', async () => {
    tenantLogoImage = await embedLogo(pdfDoc, options.tenantLogo);
    table = templateForPdf.elements.find(isTableElement);
    tableRows = table ? resolveTableRows(table, data) : [];
    const footerElements = templateForPdf.elements.filter(isFooterElement);
    const footerTop = footerElements.reduce(
      (max, element) => Math.max(max, element.y + (element.height ?? 0)),
      220,
    );
    derivedFooterBoundary = footerTop + 8;
    explicitFooterReserveHeight =
      typeof template.footerReserveHeight === 'number' && Number.isFinite(template.footerReserveHeight)
        ? Math.max(0, template.footerReserveHeight)
        : null;
    const reserveBasedBoundary = explicitFooterReserveHeight != null
      ? explicitFooterReserveHeight + 40
      : null;
    minBodyY = reserveBasedBoundary != null
      ? Math.min(derivedFooterBoundary, reserveBasedBoundary)
      : derivedFooterBoundary;
    if (table && tableRows.length > 0) {
      const firstRowHeight = table.rowHeight ?? 20;
      const tableHeaderHeight = overlayMode ? 0 : (table.headerHeight ?? 24);
      const bodyStartY = table.y - tableHeaderHeight;
      const availableHeight = bodyStartY - minBodyY;
      if (availableHeight < firstRowHeight) {
        const clampedMinBodyY = Math.max(0, bodyStartY - firstRowHeight - 8);
        if (clampedMinBodyY < minBodyY) {
          clampApplied = true;
          clampReason = 'ensure_first_row_fits';
          minBodyY = clampedMinBodyY;
        }
      }
    }
    options.onLayoutResolved?.({
      templateYMode,
      pageHeight,
      tableId: incomingTable?.id ?? normalizedTable?.id ?? null,
      templateId: templateForPdf.id ?? template.id ?? null,
      presetId: template.settings?.presetId ?? templateForPdf.settings?.presetId ?? null,
      incomingTableY: incomingTable?.y ?? null,
      normalizedTableY: normalizedTable?.y ?? null,
      pdfTableStartY: table?.y ?? null,
      bodyStartY: table ? table.y - (overlayMode ? 0 : (table.headerHeight ?? 24)) : null,
    });
  });

  const createPage = () => {
    const page = pdfDoc.addPage([pageWidth, pageHeight]);
    if (backgroundPage) {
      page.drawPage(backgroundPage, {
        x: 0,
        y: 0,
        width: pageWidth,
        height: pageHeight,
      });
    }
    return page;
  };

  const pages: PDFPage[] = [];
  let page = createPage();
  pages.push(page);
  let nextRowIndex = 0;

  await runStage('draw_table', () => {
    if (!table) return;
    const tableStartedAt = nowMs();
    const maxPages = Math.max(2, tableRows.length + 2);
    const maxIterations = Math.max(4, tableRows.length * 3 + 10);
    let iterations = 0;
    let rowsDrawnTotal = 0;
    const firstRowHeight = table.rowHeight ?? 20;
    const tableHeaderHeight = overlayMode ? 0 : (table.headerHeight ?? 24);
    const bodyStartY = table.y - tableHeaderHeight;
    const tableStartDetails: TableTrace & { rowsTotal: number } = {
      rowIndex: 0,
      pageIndex: 0,
      templateYMode,
      incomingTableY: incomingTable?.y ?? table.y,
      normalizedTableY: table.y,
      currentY: bodyStartY,
      remainingRows: tableRows.length,
      pageHeight,
      usableTop: table.y,
      usableBottom: minBodyY,
      availableHeight: bodyStartY - minBodyY,
      reservedFooterHeight: minBodyY,
      explicitFooterReserveHeight,
      derivedFooterBoundary,
      headerHeight: Math.max(0, pageHeight - table.y),
      tableHeaderHeight,
      firstRowHeight,
      rowBottomY: bodyStartY - firstRowHeight,
      nextY: bodyStartY - firstRowHeight,
      pageBreakThreshold: minBodyY,
      tableStartY: table.y,
      bodyStartY,
      clampApplied,
      clampReason,
      rowsTotal: tableRows.length,
    };
    options.onTableStart?.({
      ...tableStartDetails,
    });
    if (!overlayMode) {
      drawTableHeader(page, table, latinFont, jpFont, table.y, true);
    }
    const firstPass = drawTableRows(
      page,
      table,
      tableRows,
      0,
      latinFont,
      jpFont,
      table.y,
      minBodyY,
      overlayMode,
      0,
      pageHeight,
      minBodyY,
      explicitFooterReserveHeight,
      derivedFooterBoundary,
      templateYMode,
      incomingTable?.y ?? table.y,
      clampApplied,
      clampReason,
      options.onTableRow,
    );
    nextRowIndex = firstPass.nextIndex;
    rowsDrawnTotal += firstPass.rowsDrawn;
    if (tableRows.length > 0 && firstPass.rowsDrawn === 0) {
      const diagnostics = firstPass.rejectedLayout ?? tableStartDetails;
      const isRowTooTall = diagnostics.firstRowHeight > diagnostics.availableHeight;
      const message =
        `${isRowTooTall ? 'TABLE_ROW_TOO_TALL' : 'TABLE_RENDER_STUCK'}: ` +
        `templateYMode=${diagnostics.templateYMode} incomingTableY=${diagnostics.incomingTableY} ` +
        `normalizedTableY=${diagnostics.normalizedTableY} ` +
        `pageIndex=0 rowIndex=${nextRowIndex} currentY=${diagnostics.currentY} ` +
        `pageHeight=${diagnostics.pageHeight} usableTop=${diagnostics.usableTop} ` +
        `usableBottom=${diagnostics.usableBottom} availableHeight=${diagnostics.availableHeight} ` +
        `reservedFooterHeight=${diagnostics.reservedFooterHeight} ` +
        `explicitFooterReserveHeight=${diagnostics.explicitFooterReserveHeight ?? 'null'} ` +
        `derivedFooterBoundary=${diagnostics.derivedFooterBoundary} ` +
        `headerHeight=${diagnostics.headerHeight} tableHeaderHeight=${diagnostics.tableHeaderHeight} ` +
        `firstRowHeight=${diagnostics.firstRowHeight} rowBottomY=${diagnostics.rowBottomY} ` +
        `nextY=${diagnostics.nextY} pageBreakThreshold=${diagnostics.pageBreakThreshold} ` +
        `tableStartY=${diagnostics.tableStartY} bodyStartY=${diagnostics.bodyStartY} ` +
        `clampApplied=${diagnostics.clampApplied ? 1 : 0} clampReason=${diagnostics.clampReason ?? 'null'}`;
      options.onTableError?.({
        ...diagnostics,
        reason: 'no_progress_first_page',
        message,
      });
      throw new Error(message);
    }
    while (nextRowIndex < tableRows.length) {
      iterations += 1;
      if (iterations > maxIterations || pages.length >= maxPages) {
        const diagnostics: TableTrace = {
          rowIndex: nextRowIndex,
          pageIndex: pages.length - 1,
          templateYMode,
          incomingTableY: incomingTable?.y ?? table.y,
          normalizedTableY: table.y,
          currentY: table.y - tableHeaderHeight,
          remainingRows: tableRows.length - nextRowIndex,
          pageHeight,
          usableTop: table.y,
          usableBottom: minBodyY,
          availableHeight: (table.y - tableHeaderHeight) - minBodyY,
          reservedFooterHeight: minBodyY,
          explicitFooterReserveHeight,
          derivedFooterBoundary,
          headerHeight: Math.max(0, pageHeight - table.y),
          tableHeaderHeight,
          firstRowHeight,
          rowBottomY: (table.y - tableHeaderHeight) - firstRowHeight,
          nextY: (table.y - tableHeaderHeight) - firstRowHeight,
          pageBreakThreshold: minBodyY,
          tableStartY: table.y,
          bodyStartY: table.y - tableHeaderHeight,
          clampApplied,
          clampReason,
        };
        const message =
          `TABLE_RENDER_STUCK: rowIndex=${nextRowIndex} pageIndex=${pages.length - 1} ` +
          `templateYMode=${diagnostics.templateYMode} incomingTableY=${diagnostics.incomingTableY} ` +
          `normalizedTableY=${diagnostics.normalizedTableY} ` +
          `iterations=${iterations} pages=${pages.length} ` +
          `availableHeight=${diagnostics.availableHeight} firstRowHeight=${diagnostics.firstRowHeight} ` +
          `currentY=${diagnostics.currentY} usableBottom=${diagnostics.usableBottom}`;
        options.onTableError?.({
          ...diagnostics,
          reason: 'iteration_limit',
          message,
        });
        throw new Error(message);
      }
      options.onTablePageBreak?.({
        rowIndex: nextRowIndex,
        pageIndex: pages.length,
        templateYMode,
        incomingTableY: incomingTable?.y ?? table.y,
        normalizedTableY: table.y,
        currentY: table.y - tableHeaderHeight,
        remainingRows: tableRows.length - nextRowIndex,
        pageHeight,
        usableTop: table.y,
        usableBottom: minBodyY,
        availableHeight: (table.y - tableHeaderHeight) - minBodyY,
        reservedFooterHeight: minBodyY,
        explicitFooterReserveHeight,
        derivedFooterBoundary,
        headerHeight: Math.max(0, pageHeight - table.y),
        tableHeaderHeight,
        firstRowHeight,
        rowBottomY: (table.y - tableHeaderHeight) - firstRowHeight,
        nextY: (table.y - tableHeaderHeight) - firstRowHeight,
        pageBreakThreshold: minBodyY,
        tableStartY: table.y,
        bodyStartY: table.y - tableHeaderHeight,
        clampApplied,
        clampReason,
      });
      page = createPage();
      pages.push(page);
      if (!overlayMode) {
        drawTableHeader(page, table, latinFont, jpFont, table.y, true);
      }
      const previousRowIndex = nextRowIndex;
      const pagePass = drawTableRows(
        page,
        table,
        tableRows,
        nextRowIndex,
        latinFont,
        jpFont,
        table.y,
        minBodyY,
        overlayMode,
        pages.length - 1,
        pageHeight,
        minBodyY,
        explicitFooterReserveHeight,
        derivedFooterBoundary,
        templateYMode,
        incomingTable?.y ?? table.y,
        clampApplied,
        clampReason,
        options.onTableRow,
      );
      nextRowIndex = pagePass.nextIndex;
      rowsDrawnTotal += pagePass.rowsDrawn;
      if (nextRowIndex <= previousRowIndex) {
        const diagnostics = pagePass.rejectedLayout ?? {
          rowIndex: previousRowIndex,
          pageIndex: pages.length - 1,
          templateYMode,
          incomingTableY: incomingTable?.y ?? table.y,
          normalizedTableY: table.y,
          currentY: table.y - tableHeaderHeight,
          remainingRows: tableRows.length - previousRowIndex,
          pageHeight,
          usableTop: table.y,
          usableBottom: minBodyY,
          availableHeight: (table.y - tableHeaderHeight) - minBodyY,
          reservedFooterHeight: minBodyY,
          explicitFooterReserveHeight,
          derivedFooterBoundary,
          headerHeight: Math.max(0, pageHeight - table.y),
          tableHeaderHeight,
          firstRowHeight,
          rowBottomY: (table.y - tableHeaderHeight) - firstRowHeight,
          nextY: (table.y - tableHeaderHeight) - firstRowHeight,
          pageBreakThreshold: minBodyY,
          tableStartY: table.y,
          bodyStartY: table.y - tableHeaderHeight,
          clampApplied,
          clampReason,
        };
        const message =
          `TABLE_RENDER_STUCK: rowIndex=${previousRowIndex} pageIndex=${pages.length - 1} ` +
          `templateYMode=${diagnostics.templateYMode} incomingTableY=${diagnostics.incomingTableY} ` +
          `normalizedTableY=${diagnostics.normalizedTableY} ` +
          `currentY=${diagnostics.currentY} usableBottom=${diagnostics.usableBottom} ` +
          `availableHeight=${diagnostics.availableHeight} firstRowHeight=${diagnostics.firstRowHeight} ` +
          `rowBottomY=${diagnostics.rowBottomY} remainingRows=${tableRows.length - previousRowIndex}`;
        options.onTableError?.({
          ...diagnostics,
          reason: 'row_index_not_advancing',
          message,
        });
        throw new Error(message);
      }
    }
    options.onTableDone?.({
      rowsDrawn: rowsDrawnTotal,
      pagesUsed: pages.length,
      ms: Math.round(nowMs() - tableStartedAt),
    });
  });

  const lastPage = pages[pages.length - 1];

  await runStage('draw_static', () => {
    for (const element of templateForPdf.elements) {
      if (element.type === 'table') continue;
      if (element.region === 'footer' && lastPage !== page && pages.length > 1) {
        // footer values only on the last page
      }
      if (element.type === 'label') {
        if (options.skipStaticLabels) continue;
        if (element.region === 'footer') {
          drawBox(lastPage, element);
          drawTextBlock(lastPage, (element as LabelElement).text, element, latinFont, jpFont);
        } else {
          drawBox(pages[0], element);
          drawTextBlock(pages[0], (element as LabelElement).text, element, latinFont, jpFont);
        }
        continue;
      }
      if (element.type === 'image') {
        if (options.skipLogo) continue;
        const targetPage = element.region === 'footer' ? lastPage : pages[0];
        companyLogoDrawn = drawImageElement(targetPage, element, tenantLogoImage) || companyLogoDrawn;
        continue;
      }
      const textElement = element as TextElement;
      if (shouldSkipTextElement(textElement, options)) continue;
      const targetPage = textElement.region === 'footer' ? lastPage : pages[0];
      drawBox(targetPage, textElement);
      const slotId = textElement.slotId ?? textElement.id;
      const text = slotId === 'subtotal' || slotId === 'tax' || slotId === 'total'
        ? computeSummaryValue(slotId, data, tableRows)
        : resolveTextValue(textElement, data);
      drawTextBlock(targetPage, text, textElement, latinFont, jpFont);
    }
  });

  const bytes = await runStage('save_pdf', async () => pdfDoc.save());
  return {
    bytes,
    warnings: [],
    stats: { companyLogoDrawn },
  };
}
