import { PDFDocument, rgb, StandardFonts, type PDFPage, type PDFFont } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import qrcode from 'qrcode-generator';
import {
  type TemplateDefinition,
  type TemplateElement,
  type TextElement,
  type LabelElement,
  type TableElement,
  type CardListElement,
  type SummaryRow,
  type ImageElement,
  type TemplateDataRecord,
  type DataSource,
  type LabelSheetSettings,
  type LabelMapping,
  resolveRegionBounds,
  getPageDimensions,
} from '../../../shared/template.js';
import { buildPdfTransform, type PdfTransform } from '../../../shared/pdfTransform.js';
import { computeDocumentMetaLayout, applyFrameToTextElement } from '../../../shared/documentMetaLayout.js';
import type { PDFImage } from 'pdf-lib'; // 先頭の import に追加

const isHttpUrl = (value: string) => /^https?:\/\//i.test(value);
type WarnCategory = 'debug' | 'data' | 'layout' | 'image' | 'number';
type WarnFn = (
  category: WarnCategory,
  message: string,
  context?: Record<string, unknown>,
) => void;
type PreviewMode = 'record' | 'fieldCode';
const MAX_TEXT_LENGTH = 200;
type DrawTextOptions = Parameters<PDFPage['drawText']>[1];
type TextBaselineDebug = {
  elementId: string;
  rectTopY: number;
  rectBottomY: number;
  fontSize: number;
  ascent: number | null;
  descent: number | null;
  computedDrawY: number;
};

// NOTE(2026-02-20):
// Header text alignment between Canvas(DOM) and PDF is within ~±1px (acceptable, frozen).
// Table cell text alignment differs (e.g. items:row0:item_name diff = -5px), handled in table phase separately.
const DBG_TEXT_BASELINE_TARGETS = new Set([
  'doc_title',
  'doc_no',
  'date_label',
  'issue_date',
]);

const hasNonAscii = (text: string) => /[^\u0000-\u007F]/.test(text);
const pickFont = (text: string, latinFont: PDFFont, jpFont: PDFFont) =>
  hasNonAscii(text) ? jpFont : latinFont;

const snapPdfStroke = (value: number, stroke: number) => {
  if (!Number.isFinite(value)) return value;
  const thickness = Number.isFinite(stroke) ? stroke : 0;
  if (thickness <= 0) return Math.round(value);
  return Math.round(value + thickness / 2) - thickness / 2;
};

const safeDrawText = (
  page: PDFPage,
  text: string,
  options: DrawTextOptions,
  warn?: WarnFn,
  context?: Record<string, unknown>,
) => {
  try {
    page.drawText(text, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warn?.('debug', 'drawText failed', { text, ...context, error: message });
    throw error;
  }
};

const truncateText = (text: string, maxLength = MAX_TEXT_LENGTH) => {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength);
};

const safeStringifyValue = (
  value: unknown,
  warn?: WarnFn,
  context?: Record<string, unknown>,
) => {
  try {
    return JSON.stringify(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warn?.('data', 'value stringify failed', { ...context, error: message });
    return '';
  }
};

const stringifyValue = (
  value: unknown,
  warn?: WarnFn,
  context?: Record<string, unknown>,
): string => {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();

  const type = typeof value;
  if (type === 'string' || type === 'number' || type === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    const parts = value
      .map((item, index) => stringifyValue(item, warn, { ...context, index }))
      .filter((part) => part !== '');
    return parts.join(', ');
  }

  if (type === 'object') {
    return safeStringifyValue(value, warn, context);
  }

  warn?.('data', 'unsupported value type', { ...context, type });
  return '';
};

const resolveFieldValue = (
  fieldCode: string | null | undefined,
  record: Record<string, unknown> | undefined,
  previewMode: PreviewMode,
): unknown => {
  if (!fieldCode) return '';
  if (previewMode === 'fieldCode') return fieldCode;
  if (!record) return '';
  const raw = record[fieldCode];
  if (raw && typeof raw === 'object' && 'value' in raw) {
    return (raw as { value?: unknown }).value;
  }
  return raw;
};

const numericLikePattern = /^[0-9.,+\-() ¥$]*$/;

const isNumericLike = (text: string) => numericLikePattern.test(text);

const wrapTextToLines = (
  text: string,
  font: PDFFont,
  fontSize: number,
  maxWidth: number,
): string[] => {
  if (text === '') return [''];
  if (maxWidth <= 0) return [''];

  const paragraphs = text.split('\n');
  const lines: string[] = [];

  for (const paragraph of paragraphs) {
    if (paragraph === '') {
      lines.push('');
      continue;
    }

    let line = '';
    for (const char of paragraph) {
      const candidate = `${line}${char}`;
      if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth || line === '') {
        line = candidate;
        continue;
      }
      lines.push(line);
      line = char;
    }
    if (line !== '') {
      lines.push(line);
    }
  }

  return lines.length > 0 ? lines : [''];
};

const ellipsisTextToWidth = (
  text: string,
  font: PDFFont,
  fontSize: number,
  maxWidth: number,
): string => {
  if (!text) return '';
  if (maxWidth <= 0) return '';

  const ellipsis = '...';
  if (font.widthOfTextAtSize(text, fontSize) <= maxWidth) {
    return text;
  }
  if (font.widthOfTextAtSize(ellipsis, fontSize) > maxWidth) {
    return '';
  }

  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const candidate = `${text.slice(0, mid)}${ellipsis}`;
    if (font.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  return `${text.slice(0, low)}${ellipsis}`;
};

const drawMultilineText = (
  page: PDFPage,
  lines: string[],
  x: number,
  yStart: number,
  font: PDFFont,
  fontSize: number,
  color: ReturnType<typeof rgb>,
  maxLines: number,
  lineHeight = fontSize * 1.2,
  fontWeight: 'normal' | 'bold' = 'normal',
  align: 'left' | 'center' | 'right' = 'left',
  maxWidth?: number,
  warn?: WarnFn,
  context?: Record<string, unknown>,
) => {
  const drawLine = (text: string, xPos: number, yPos: number) => {
    safeDrawText(page, text, {
      x: xPos,
      y: yPos,
      size: fontSize,
      font,
      color,
    }, warn, context);
    if (fontWeight === 'bold') {
      safeDrawText(page, text, {
        x: xPos + 0.4,
        y: yPos,
        size: fontSize,
        font,
        color,
      }, warn, context);
    }
  };
  const limit = Math.min(lines.length, Math.max(0, maxLines));
  for (let idx = 0; idx < limit; idx += 1) {
    const line = lines[idx];
    let xPos = x;
    if (align !== 'left' && typeof maxWidth === 'number') {
      const textWidth = font.widthOfTextAtSize(line, fontSize);
      if (align === 'center') {
        xPos = x + Math.max(0, (maxWidth - textWidth) / 2);
      } else if (align === 'right') {
        xPos = x + Math.max(0, maxWidth - textWidth);
      }
    }
    drawLine(line, xPos, yStart - idx * lineHeight);
  }
};

const CELL_PADDING_X = 4;
const MIN_FONT_SIZE = 6;

const calcShrinkFontSize = (
  text: string,
  font: PDFFont,
  baseSize: number,
  maxWidth: number,
  minFontSize = MIN_FONT_SIZE,
): number => {
  if (!text) return baseSize;

  const baseWidth = font.widthOfTextAtSize(text, baseSize);
  if (baseWidth <= maxWidth) return baseSize;

  const scale = maxWidth / baseWidth;
  const shrunk = Math.floor(baseSize * scale);

  return Math.max(minFontSize, Math.min(baseSize, shrunk));
};

type DebugOverlayInfo = {
  elementId: string;
  canvas: { x: number; y: number; w: number; h: number };
  pdf: { x: number; y: number; w: number; h: number };
  raw: { x: number; y: number; w: number; h: number };
  rawDrawY?: number;
};

const logDebugOverlayInfo = (
  info: DebugOverlayInfo,
  pageWidth: number,
  pageHeight: number,
  transform: PdfTransform,
  pageSize?: string,
) => {
  console.debug('[renderTemplate] coord debug', {
    elementId: info.elementId,
    canvas: info.canvas,
    pdfPage: { width: pageWidth, height: pageHeight },
    pageSize: pageSize ?? null,
    scale: { x: transform.scaleX, y: transform.scaleY },
    pdf: info.pdf,
    raw: info.raw,
    rawDrawY: info.rawDrawY ?? null,
  });
};

const drawDebugOverlay = (
  page: PDFPage,
  info: DebugOverlayInfo,
  pageWidth: number,
  pageHeight: number,
) => {
  page.drawRectangle({
    x: 0,
    y: 0,
    width: pageWidth,
    height: pageHeight,
    borderColor: rgb(0.8, 0.1, 0.1),
    borderWidth: 0.6,
  });

  page.drawRectangle({
    x: info.pdf.x,
    y: info.pdf.y,
    width: info.pdf.w,
    height: info.pdf.h,
    borderColor: rgb(0.1, 0.6, 0.1),
    borderWidth: 0.8,
  });

  page.drawRectangle({
    x: info.raw.x,
    y: info.raw.y,
    width: info.raw.w,
    height: info.raw.h,
    borderColor: rgb(0.1, 0.2, 0.8),
    borderWidth: 0.6,
  });

  const crossSize = 6;
  page.drawLine({
    start: { x: info.pdf.x - crossSize, y: info.pdf.y },
    end: { x: info.pdf.x + crossSize, y: info.pdf.y },
    thickness: 0.7,
    color: rgb(0.1, 0.6, 0.1),
  });
  page.drawLine({
    start: { x: info.pdf.x, y: info.pdf.y - crossSize },
    end: { x: info.pdf.x, y: info.pdf.y + crossSize },
    thickness: 0.7,
    color: rgb(0.1, 0.6, 0.1),
  });
};

const assertDebugOverlayInfo = (
  info: DebugOverlayInfo,
  pageWidth: number,
  pageHeight: number,
  warn: WarnFn,
) => {
  if (
    info.pdf.x < 0 ||
    info.pdf.x > pageWidth ||
    info.pdf.y < -pageHeight ||
    info.pdf.y > pageHeight
  ) {
    warn('layout', 'pdf coord out of range', {
      elementId: info.elementId,
      pdf: info.pdf,
      page: { width: pageWidth, height: pageHeight },
    });
  }
  if (Math.abs(info.pdf.y) < 1) {
    warn('layout', 'pdf y near zero', {
      elementId: info.elementId,
      pdfY: info.pdf.y,
    });
  }
  if (info.pdf.y < -pageHeight * 0.5) {
    warn('layout', 'pdf y unusually negative', {
      elementId: info.elementId,
      pdfY: info.pdf.y,
    });
  }
};

const buildDebugOverlayInfoForText = (
  element: TextElement,
  data: TemplateDataRecord | undefined,
  previewMode: PreviewMode,
  fontScale: number,
  pagePadding: number,
  transform: PdfTransform,
  jpFont: PDFFont,
  latinFont: PDFFont,
  warn: WarnFn,
): DebugOverlayInfo => {
  const fontSizeCanvas = (element.fontSize ?? 12) * fontScale;
  const fontSize = fontSizeCanvas * transform.scaleY;
  const lineHeight = fontSize * 1.2;
  const lineHeightCanvas = fontSizeCanvas * 1.2;
  const maxWidthCanvas = element.width ?? 200;
  const maxWidth = transform.toPdfW(maxWidthCanvas);

  const resolved = resolveDataSource(
    element.dataSource,
    data,
    previewMode,
    warn,
    { elementId: element.id },
  );
  const text = resolved || element.text || '';
  const fontToUse = pickFont(text, latinFont, jpFont);
  const xCanvas = resolveAlignedX(element, transform.canvasWidth, maxWidthCanvas, pagePadding);
  const yCanvas = typeof element.y === 'number' ? element.y : 0;

  const lines = wrapTextToLines(text, fontToUse, fontSize, maxWidth);
  const contentHeightCanvas = lineHeightCanvas * Math.max(1, lines.length);
  const elementHeightCanvas = typeof element.height === 'number' ? element.height : 0;
  const boxHeightCanvas = Math.max(elementHeightCanvas, contentHeightCanvas);
  const boxHeight = transform.toPdfH(boxHeightCanvas);

  const yBottom = clampPdfY(
    transform.toPdfYBox(yCanvas, boxHeightCanvas),
    transform.pageHeightPt,
  );
  let yStart = yBottom + boxHeight - lineHeight;
  yStart = clampPdfY(yStart, transform.pageHeightPt - lineHeight);

  return {
    elementId: element.id,
    canvas: { x: xCanvas, y: yCanvas, w: maxWidthCanvas, h: boxHeightCanvas },
    pdf: { x: transform.toPdfX(xCanvas), y: yBottom, w: maxWidth, h: boxHeight },
    raw: {
      x: xCanvas * transform.scaleX,
      y: yCanvas * transform.scaleY,
      w: maxWidthCanvas * transform.scaleX,
      h: boxHeightCanvas * transform.scaleY,
    },
    rawDrawY: yStart,
  };
};

const drawCellText = (
  page: PDFPage,
  text: string,
  font: PDFFont,
  baseFontSize: number,
  cellX: number,
  cellY: number,
  cellW: number,
  cellH: number,
  align: 'left' | 'center' | 'right',
  paddingX: number,
  paddingY: number,
  minFontSize = MIN_FONT_SIZE,
  valign: 'top' | 'middle' = 'middle',
  color: ReturnType<typeof rgb> = rgb(0, 0, 0),
  warn?: WarnFn,
  context?: Record<string, unknown>,
) => {
  const availableW = Math.max(0, cellW - paddingX * 2);
  const fontSize = calcShrinkFontSize(
    text,
    font,
    baseFontSize,
    availableW,
    minFontSize,
  );
  const textW = font.widthOfTextAtSize(text, fontSize);

  const x =
    align === 'right'
      ? cellX + cellW - paddingX - textW
      : align === 'center'
      ? cellX + (cellW - textW) / 2
      : cellX + paddingX;

  const y =
    valign === 'top'
      ? cellY + cellH - fontSize - paddingY
      : cellY + cellH / 2 - fontSize / 2;

  safeDrawText(page, text, { x, y, size: fontSize, font, color }, warn, context);
};

const drawAlignedText = (
  page: PDFPage,
  text: string,
  font: PDFFont,
  fontSize: number,
  cellX: number,
  cellY: number,
  cellW: number,
  cellH: number,
  align: 'left' | 'center' | 'right',
  paddingX: number,
  warn?: WarnFn,
  context?: Record<string, unknown>,
) => {
  const textW = font.widthOfTextAtSize(text, fontSize);
  const x =
    align === 'right'
      ? cellX + cellW - paddingX - textW
      : align === 'center'
      ? cellX + (cellW - textW) / 2
      : cellX + paddingX;
  const y = cellY + cellH / 2 - fontSize / 2;

  safeDrawText(
    page,
    text,
    { x, y, size: fontSize, font, color: rgb(0, 0, 0) },
    warn,
    context,
  );
};

type NormalizedColumnSpec = {
  align?: 'left' | 'center' | 'right';
  overflow: 'wrap' | 'shrink' | 'ellipsis' | 'clip';
  minFontSize: number;
  maxLines?: number;
  formatter?: TableElement['columns'][number]['formatter'];
  isItemName: boolean;
};

const isItemNameColumn = (col: TableElement['columns'][number]) =>
  col.id === 'item_name' || col.fieldCode === 'ItemName';

const normalizeColumnSpec = (col: TableElement['columns'][number]): NormalizedColumnSpec => {
  const itemName = isItemNameColumn(col);
  return {
    align: col.align,
    overflow: col.overflow ?? (itemName ? 'wrap' : 'shrink'),
    minFontSize: col.minFontSize ?? MIN_FONT_SIZE,
    maxLines: col.maxLines,
    formatter: col.formatter,
    isItemName: itemName,
  };
};

const resolveColumnAlign = (spec: NormalizedColumnSpec, text: string) => {
  if (spec.align) return spec.align;
  if (spec.overflow === 'wrap') return 'left';
  return isNumericLike(text) ? 'right' : 'left';
};

const formatCellValue = (
  rawVal: unknown,
  spec: NormalizedColumnSpec,
  warn: WarnFn,
  context: Record<string, unknown>,
): string => {
  const formatterType = spec.formatter?.type ?? 'text';

  if (formatterType === 'number' || formatterType === 'currency') {
    if (rawVal === null || rawVal === undefined) return '';
    if (typeof rawVal === 'number') {
      if (!Number.isSafeInteger(rawVal)) {
        warn('number', 'unsafe-number', { ...context, value: rawVal });
        return String(rawVal);
      }
      const locale = spec.formatter?.locale ?? 'ja-JP';
      return new Intl.NumberFormat(locale).format(rawVal);
    }
    if (typeof rawVal === 'string') {
      return rawVal;
    }
    return stringifyValue(rawVal, warn, context);
  }

  if (formatterType === 'date') {
    if (rawVal === null || rawVal === undefined) return '';
    if (rawVal instanceof Date) return rawVal.toISOString();
    if (typeof rawVal === 'string') return rawVal;
    return stringifyValue(rawVal, warn, context);
  }

  return stringifyValue(rawVal, warn, context);
};

const pow10BigInt = (exp: number): bigint => {
  if (exp <= 0) return 1n;
  return 10n ** BigInt(exp);
};

const formatIntStringWithCommas = (digits: string): string =>
  digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

const formatBigIntWithCommas = (value: bigint): string =>
  formatIntStringWithCommas(value.toString());

const formatScaledBigInt = (value: bigint, scale: number): string => {
  const negative = value < 0n;
  const absValue = negative ? -value : value;
  let digits = absValue.toString();

  if (scale <= 0) {
    return `${negative ? '-' : ''}${formatIntStringWithCommas(digits)}`;
  }

  if (digits.length <= scale) {
    digits = digits.padStart(scale + 1, '0');
  }

  const intPart = digits.slice(0, -scale) || '0';
  const fracPart = digits.slice(-scale);
  return `${negative ? '-' : ''}${formatIntStringWithCommas(intPart)}.${fracPart}`;
};

const parseDecimalToScaledBigInt = (
  value: unknown,
  warn?: WarnFn,
  context?: Record<string, unknown>,
): { value: bigint; scale: number } | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return { value, scale: 0 };

  let raw = '';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      warn?.('data', 'summary amount parse failed', { ...context, value });
      return null;
    }
    raw = String(value);
  } else if (typeof value === 'string') {
    raw = value;
  } else {
    warn?.('data', 'summary amount parse failed', { ...context, value });
    return null;
  }

  const original = raw.trim();
  if (original === '') return null;

  if (/[eE]/.test(original)) {
    warn?.('data', 'summary amount parse failed', { ...context, value: original });
    return null;
  }

  let negative = false;
  let text = original;
  if (text.startsWith('(') && text.endsWith(')')) {
    negative = true;
    text = text.slice(1, -1).trim();
  }

  text = text.replace(/[¥$]/g, '').replace(/,/g, '').replace(/\s+/g, '');
  if (text.startsWith('+') || text.startsWith('-')) {
    if (text.startsWith('-')) negative = true;
    text = text.slice(1);
  }

  if (text === '') {
    warn?.('data', 'summary amount parse failed', { ...context, value: original });
    return null;
  }

  const match = text.match(/^(\d*)(?:\.(\d*))?$/);
  if (!match) {
    warn?.('data', 'summary amount parse failed', { ...context, value: original });
    return null;
  }

  const intPart = match[1] ?? '';
  const fracPart = match[2] ?? '';
  const scale = fracPart.length;
  const joined = `${intPart}${fracPart}`;
  if (joined === '') {
    warn?.('data', 'summary amount parse failed', { ...context, value: original });
    return null;
  }

  try {
    let bigintValue = BigInt(joined);
    if (negative) bigintValue = -bigintValue;
    return { value: bigintValue, scale };
  } catch {
    warn?.('data', 'summary amount parse failed', { ...context, value: original });
    return null;
  }
};

const addScaledValue = (
  currentValue: bigint,
  currentScale: number,
  addition: { value: bigint; scale: number },
): { value: bigint; scale: number } => {
  let value = currentValue;
  let scale = currentScale;
  let addValue = addition.value;

  if (addition.scale > scale) {
    value *= pow10BigInt(addition.scale - scale);
    scale = addition.scale;
  } else if (addition.scale < scale) {
    addValue *= pow10BigInt(scale - addition.scale);
  }

  return { value: value + addValue, scale };
};

const fetchWithTimeout = async (
  url: string,
  timeoutMs: number,
  warn: WarnFn,
): Promise<Response | null> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const reason = error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'error';
    warn('image', 'image fetch failed', { url, reason, error: message });
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

const embedImageBuffer = async (
  pdfDoc: PDFDocument,
  buf: Uint8Array,
  url: string,
  contentType: string,
  warn: WarnFn,
): Promise<PDFImage | null> => {
  const lower = url.toLowerCase();
  const preferJpg =
    contentType.includes('jpeg') ||
    contentType.includes('jpg') ||
    lower.endsWith('.jpg') ||
    lower.endsWith('.jpeg');
  const preferPng = contentType.includes('png') || lower.endsWith('.png');
  const order: Array<'jpg' | 'png'> = preferJpg && !preferPng ? ['jpg', 'png'] : ['png', 'jpg'];

  for (const kind of order) {
    try {
      if (kind === 'jpg') return await pdfDoc.embedJpg(buf);
      return await pdfDoc.embedPng(buf);
    } catch {
      // try the other format
    }
  }

  warn('image', 'image embed failed', { url });
  return null;
};

// 画像を事前に埋め込んでキャッシュ
async function preloadImages(
  pdfDoc: PDFDocument,
  template: TemplateDefinition,
  data: TemplateDataRecord | undefined,
  previewMode: PreviewMode,
  warn: WarnFn,
): Promise<Map<string, PDFImage>> {
  const map = new Map<string, PDFImage>();

  const imageElements = template.elements.filter(
    (e) => e.type === 'image',
  ) as ImageElement[];

  const urls = Array.from(
    new Set(
      imageElements
        .map((e) => resolveDataSource(e.dataSource, data, previewMode, warn, { elementId: e.id }))
        .filter((u): u is string => !!u && isHttpUrl(u)),
    ),
  );

  for (const url of urls) {
    const res = await fetchWithTimeout(url, 5000, warn);
    if (!res) {
      continue;
    }
    if (!res.ok) {
      warn('image', 'image fetch failed', { url, status: res.status });
      continue;
    }
    const contentType = res.headers.get('content-type')?.toLowerCase() ?? '';
    if (!contentType.startsWith('image/')) {
      warn('image', 'image content-type not image', { url, contentType });
      continue;
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    const embedded = await embedImageBuffer(pdfDoc, buf, url, contentType, warn);
    if (!embedded) continue;
    map.set(url, embedded);
  }

  return map;
}

const MM_TO_PT = 72 / 25.4;
const mmToPt = (mm: number) => mm * MM_TO_PT;

const DEFAULT_LABEL_SHEET: LabelSheetSettings = {
  paperWidthMm: 210,
  paperHeightMm: 297,
  cols: 2,
  rows: 5,
  marginMm: 8,
  gapMm: 2,
  offsetXmm: 0,
  offsetYmm: 0,
};

/**
 * テンプレートからページ幅・高さを決定
 */
function getPageSize(template: TemplateDefinition): [number, number] {
  if (template.structureType === 'label_v1') {
    const sheet = template.sheetSettings ?? DEFAULT_LABEL_SHEET;
    return [mmToPt(sheet.paperWidthMm), mmToPt(sheet.paperHeightMm)];
  }
  const dims = getPageDimensions(template.pageSize, template.orientation);
  return [dims.width, dims.height];
}

const clampPdfY = (pdfY: number, maxY: number) => {
  if (Number.isNaN(pdfY)) return 0;
  const cappedMax = Number.isNaN(maxY) ? 0 : maxY;
  return Math.min(Math.max(pdfY, 0), cappedMax);
};

/**
 * kintone / static などのデータソースを解決
 */
function resolveDataSource(
  source: DataSource | undefined,
  data: TemplateDataRecord | undefined,
  previewMode: PreviewMode,
  warn?: WarnFn,
  context?: Record<string, unknown>,
): string {
  if (!source) return '';

  // 固定値
  if (source.type === 'static') {
    return source.value ?? '';
  }

  if (source.type === 'kintoneSubtable') {
    return '';
  }

  // kintone / kintoneSubtable 系
  if ('fieldCode' in source && source.fieldCode) {
    const value = resolveFieldValue(
      source.fieldCode,
      data as Record<string, unknown> | undefined,
      previewMode,
    );
    if (value === null || value === undefined) return '';
    if (typeof value === 'number') {
      if (Number.isSafeInteger(value)) {
        return new Intl.NumberFormat('ja-JP').format(value);
      }
      const contextInfo = { fieldCode: source.fieldCode, value };
      warn?.('number', 'unsafe-number', contextInfo);
      return String(value);
    }
    if (value instanceof Date) {
      return value.toISOString();
    }
    if (typeof value === 'string' || typeof value === 'boolean') {
      return truncateText(String(value));
    }
    if (Array.isArray(value)) {
      const parts = value
        .map((item, index) => {
          if (item === null || item === undefined) return '';
          if (typeof item === 'number') return new Intl.NumberFormat('ja-JP').format(item);
          if (item instanceof Date) return item.toISOString();
          if (typeof item === 'string' || typeof item === 'boolean') return String(item);
          return safeStringifyValue(item, warn, { ...context, fieldCode: source.fieldCode, index });
        })
        .filter((part) => part !== '');
      return truncateText(parts.join(', '));
    }
    return truncateText(
      safeStringifyValue(value, warn, { ...context, fieldCode: source.fieldCode }),
    );
  }

  warn?.('data', 'dataSource fieldCode missing', context);
  return '';
}

/**
 * メイン：テンプレートを PDF のバイト列に変換
 */
export async function renderTemplateToPdf(
  template: TemplateDefinition,
  data: TemplateDataRecord | undefined,
  fonts: { jp: Uint8Array; latin: Uint8Array },
  options?: {
    debug?: boolean;
    previewMode?: PreviewMode;
    requestId?: string;
    onPageInfo?: (info: { pdfPageW: number; pdfPageH: number }) => void;
    onTextBaseline?: (entry: TextBaselineDebug) => void;
  },
): Promise<{ bytes: Uint8Array; warnings: string[] }> {
  const warnings = new Set<string>();
  const debugEnabled = options?.debug === true;
  const debugOverlayEnabled = debugEnabled;
  const requestId = options?.requestId;
  const onPageInfo = options?.onPageInfo;
  const onTextBaseline = options?.onTextBaseline;
  const previewMode: PreviewMode = options?.previewMode ?? 'record';
  const warn: WarnFn = (category, message, context) => {
    if (category === 'debug' && !debugEnabled) return;
    let entry = `[${category}] ${message}`;
    if (context) {
      try {
        entry = `${entry} ${JSON.stringify(context)}`;
      } catch {
        entry = `${entry} [context_unserializable]`;
      }
    }
    warnings.add(entry);
  };

  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  if (debugEnabled && template.structureType === 'estimate_v1') {
    console.debug('[render] estimate_v1 passthrough');
  }

  const [pageWidth, pageHeight] = getPageSize(template);
  const canvasWidth = pageWidth;
  const canvasHeight = pageHeight;
  const templateYMode = template.rawYMode ?? template.settings?.yMode ?? 'bottom';
  if (debugEnabled) {
    console.debug('[DBG_YMODE]', { templateYMode });
  }
  const transform = buildPdfTransform({
    pageWidthPt: pageWidth,
    pageHeightPt: pageHeight,
    canvasWidth,
    canvasHeight,
    yMode: templateYMode,
  });
  if (debugEnabled) {
    console.debug('[DBG_XFORM]', {
      requestId,
      xformPageW: transform.pageWidthPt,
      xformPageH: transform.pageHeightPt,
      scaleX: transform.scaleX,
      scaleY: transform.scaleY,
      mode: 'renderTemplate',
      yMode: transform.yMode,
    });
  }
  const dbgFlipY = (tag: string, uiY: number, uiH?: number) => {
    if (!debugEnabled) return;
    const height = Number.isFinite(uiH ?? 0) ? (uiH ?? 0) : 0;
    const usedPageH = transform.pageHeightPt;
    const outY =
      transform.yMode === 'top'
        ? usedPageH - uiY * transform.scaleY - height * transform.scaleY
        : uiY * transform.scaleY;
    console.debug('[DBG_FLIPY]', {
      requestId,
      tag,
      uiY,
      uiH: height,
      usedPageH,
      outY,
    });
  };
  const resolveAdjust = (element: TemplateElement) =>
    resolveEasyAdjustForElement(element, template);
  let renderData = data ? structuredClone(data) : undefined;
  const imageMap = await preloadImages(pdfDoc, template, renderData, previewMode, warn);

  // ★ let にして、テーブル描画の途中で別ページに差し替えられるようにする
  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  const pageWidthActual = page.getWidth();
  const pageHeightActual = page.getHeight();
  if (debugEnabled && onPageInfo) {
    onPageInfo({ pdfPageW: pageWidthActual, pdfPageH: pageHeightActual });
  }
  if (debugEnabled && transform.pageHeightPt !== pageHeightActual) {
    console.debug('[DBG_WARN_PAGEH_MISMATCH]', {
      requestId,
      xformPageH: transform.pageHeightPt,
      pdfPageH: pageHeightActual,
    });
  }

  // フォント埋め込み
  const jpFont = await pdfDoc.embedFont(fonts.jp, { subset: false });
  const latinFont = await pdfDoc.embedFont(fonts.latin, { subset: false });

  if (template.structureType === 'label_v1') {
    drawLabelSheet(pdfDoc, page, template, renderData, previewMode, jpFont, latinFont, warn);
    const bytes = await pdfDoc.save();
    const warningList = Array.from(warnings.values());
    return { bytes, warnings: warningList };
  }

  warn('debug', 'template elements', {
    count: template.elements.length,
    ids: template.elements.map((e) => e.id),
  });

  // ▼▼ 要素を分解：ヘッダー（毎ページ／1ページのみ）とフッター、テーブル ▼▼
  const nonBodyElements = template.elements.filter(
    (e) => e.type !== 'table' && e.type !== 'cardList',
  );

  // region === 'footer' のものだけフッター扱い
  const footerElements = nonBodyElements.filter(
    (e) => e.region === 'footer',
  );

  if (debugEnabled) {
    console.debug('[renderTemplate] canvas/pdf scales', {
      pageWidth,
      pageHeight,
      canvasWidth,
      canvasHeight,
      scaleX: transform.scaleX,
      scaleY: transform.scaleY,
    });
  }

  // それ以外（region 未指定 or 'header' 'body'）はヘッダー候補として扱う
  const headerCandidates = applyDocumentMetaLayout(
    nonBodyElements.filter(
      (e) => e.region !== 'footer',
    ),
    template,
    canvasWidth,
  );
  const isCompanySlot = (element: TemplateElement) => {
    const slotId = (element as any).slotId as string | undefined;
    return slotId ? slotId.startsWith('company_') : false;
  };
  const resolveTextValue = (element: TemplateElement | undefined) => {
    if (!element || element.type !== 'text') return '';
    return resolveDataSource(
      element.dataSource,
      renderData,
      previewMode,
      warn,
      { elementId: element.id },
    );
  };
  const companyNameEl = headerCandidates.find(
    (el) => (el as any).slotId === 'company_name',
  ) as TextElement | undefined;
  const companyNameValue = resolveTextValue(companyNameEl);
  const companyBlockEnabled = template.settings?.companyBlock?.enabled !== false;
  const shouldHideCompanyBlock =
    !companyBlockEnabled || (!!companyNameEl && !companyNameValue);
  const docNoEl = headerCandidates.find(
    (el) => (el as any).slotId === 'doc_no',
  ) as TextElement | undefined;
  const docNoValue = resolveTextValue(docNoEl);
  const shouldHideDocNo = !!docNoEl && !docNoValue;
  const filteredHeaderCandidates = headerCandidates.filter((element) => {
    if (shouldHideCompanyBlock && isCompanySlot(element)) return false;
    const slotId = (element as any).slotId as string | undefined;
    if (shouldHideDocNo && (slotId === 'doc_no' || element.id === 'doc_no_label')) {
      return false;
    }
    return true;
  });

  let debugOverlayInfo: DebugOverlayInfo | null = null;
  if (debugOverlayEnabled) {
    const debugTarget =
      filteredHeaderCandidates.find(
        (el) =>
          (el as any).slotId === 'doc_title' ||
          el.id === 'doc_title',
      ) ??
      filteredHeaderCandidates.find((el) => el.type === 'text');
    if (debugTarget && debugTarget.type === 'text') {
      const adjust = resolveAdjust(debugTarget);
      if (!adjust.hidden) {
        debugOverlayInfo = buildDebugOverlayInfoForText(
          debugTarget,
          renderData,
          previewMode,
          adjust.fontScale,
          adjust.pagePadding,
          transform,
          jpFont,
          latinFont,
          warn,
        );
        dbgFlipY(
          'elementY(doc_title)',
          debugOverlayInfo.canvas.y,
          debugOverlayInfo.canvas.h,
        );
        logDebugOverlayInfo(debugOverlayInfo, pageWidth, pageHeight, transform, template.pageSize);
        assertDebugOverlayInfo(debugOverlayInfo, pageWidth, pageHeight, warn);
      }
    }
  }

  // ヘッダー：毎ページ出すもの（デフォルト）
  const repeatingHeaderElements = filteredHeaderCandidates.filter(
    (e) => e.repeatOnEveryPage !== false,
  );

  // ヘッダー：1ページ目だけ出すもの
  const firstPageOnlyHeaderElements = filteredHeaderCandidates.filter(
    (e) => e.repeatOnEveryPage === false,
  );

  const resolveElementHeightForLayout = (el: TemplateElement) => {
    if (el.type === 'table') {
      const header = el.headerHeight ?? el.rowHeight ?? 18;
      const rows = (el.rowHeight ?? 18) * 3;
      return header + rows;
    }
    if (el.type === 'cardList') {
      return el.cardHeight ?? 90;
    }
    if (typeof el.height === 'number') return el.height;
    if (el.type === 'text' || el.type === 'label') {
      const fontSize = ((el as any).fontSize ?? 12) * resolveAdjust(el).fontScale;
      return fontSize * 1.2;
    }
    return 0;
  };
  const resolveHeaderBottomY = (elements: TemplateElement[]) => {
    const candidates = elements.filter(
      (el) => !resolveAdjust(el).hidden && typeof el.y === 'number',
    );
    if (candidates.length === 0) return null;
    return Math.max(
      ...candidates.map((el) => (el.y as number) + resolveElementHeightForLayout(el)),
    );
  };

  if (debugEnabled) {
    const debugTargets = new Set(['doc_no_label', 'doc_no', 'issue_date', 'date_label']);
    const docMetaDebug = template.elements
      .filter((el) => {
        const slotId = (el as any).slotId as string | undefined;
        return debugTargets.has(el.id) || (slotId ? debugTargets.has(slotId) : false);
      })
      .map((el) => {
        const height = resolveElementHeightForLayout(el);
        const width = typeof (el as any).width === 'number' ? (el as any).width : undefined;
        const pdfY = transform.toPdfYBox(el.y, height);
        return {
          id: el.id,
          slotId: (el as any).slotId ?? null,
          x: el.x,
          yTop: el.y,
          width: width ?? null,
          height,
          pdfY,
        };
      });
    if (docMetaDebug.length > 0) {
      console.debug('[renderTemplate] docMeta coords', docMetaDebug);
    }
  }

  // フッター：全ページに出すもの（デフォルト）
  const footerAllPages = footerElements.filter(
    (e) => e.footerRepeatMode !== 'last',
  );

  // フッター：最終ページのみに出すもの
  const footerLastPageOnly = footerElements.filter(
    (e) => e.footerRepeatMode === 'last',
  );

     // --- フッター領域高さを計算 ---
  const estimatedFooterHeight = (() => {
    const allFooterElems = [...footerAllPages, ...footerLastPageOnly];
    if (allFooterElems.length === 0) return 0;

    // ラベル／テキストだけ対象にする
    const textFooterElems = allFooterElems.filter((el) => {
      if (el.type !== 'label' && el.type !== 'text') return false;
      return !resolveAdjust(el).hidden;
    });
    if (textFooterElems.length === 0) return 0;

    // Y座標でソート（UI座標のままでOK）
    const sorted = [...textFooterElems].sort((a, b) => a.y - b.y);

    type RowInfo = { y: number; maxFontSize: number };

    const rows: RowInfo[] = [];
    const ROW_THRESHOLD = 5; // この差以内なら同じ行とみなす

    for (const el of sorted) {
      const fontSize = ((el as any).fontSize ?? 12) * resolveAdjust(el).fontScale;
      if (rows.length === 0) {
        rows.push({ y: el.y, maxFontSize: fontSize });
        continue;
      }

      const lastRow = rows[rows.length - 1];
      if (Math.abs(el.y - lastRow.y) <= ROW_THRESHOLD) {
        // 同じ行とみなして、フォントサイズだけ更新
        if (fontSize > lastRow.maxFontSize) {
          lastRow.maxFontSize = fontSize;
        }
      } else {
        // 新しい行として追加
        rows.push({ y: el.y, maxFontSize: fontSize });
      }
    }

    // 各行の高さ = フォントサイズ + 行間(6pt) として足し合わせる
    const lineGap = 6;
    let total = 0;
    for (const row of rows) {
      total += row.maxFontSize + lineGap;
    }

    // 上下にちょっと余白を足す
    return total + 10;
  })();

  const bounds = resolveRegionBounds(template, canvasHeight);
  const footerReserveFromBounds = bounds.footer.yBottom - bounds.footer.yTop;

  // テンプレが明示的に footerReserveHeight を持っていればそっちを優先
  const footerReserveHeightCanvas =
    template.footerReserveHeight ??
    (template.regionBounds ? footerReserveFromBounds : estimatedFooterHeight ?? 0);
  const footerReserveHeightPdf = transform.toPdfH(footerReserveHeightCanvas);

  const tableElements = template.elements.filter(
    (e): e is TableElement => e.type === 'table' && !(e as any).hidden,
  );
  const cardListElements = template.elements.filter(
    (e): e is CardListElement => e.type === 'cardList' && !(e as any).hidden,
  );
  if (cardListElements.length > 1) {
    warn('layout', 'multiple cardList elements found', {
      ids: cardListElements.map((el) => el.id),
    });
  }
  const cardListElementToRender =
    cardListElements.find((el) => el.id === 'cards') ?? cardListElements[0];
  if (tableElements.length > 1) {
    warn('layout', 'multiple table elements found', {
      ids: tableElements.map((el) => el.id),
    });
  }
  const tableElementToRender =
    tableElements.find((el) => el.id === 'items') ?? tableElements[0];

  if (
    previewMode === 'fieldCode' &&
    tableElementToRender?.dataSource?.type === 'kintoneSubtable'
  ) {
    const fieldCode = tableElementToRender.dataSource.fieldCode;
    const base =
      renderData && typeof renderData === 'object'
        ? (renderData as Record<string, unknown>)
        : {};
    renderData = {
      ...base,
      [fieldCode]: Array.from({ length: 5 }, () => ({})),
    } as TemplateDataRecord;
  }

  // 1ページ目にヘッダー要素を描画
  drawHeaderElements(
    page,
    [...repeatingHeaderElements, ...firstPageOnlyHeaderElements],
    renderData,
    previewMode,
    jpFont,
    latinFont,
    imageMap,
    resolveAdjust,
    transform,
    warn,
    debugEnabled,
    onTextBaseline,
  );

  // ボディ描画：cardList or table
  if (cardListElementToRender) {
    const cardListVariant =
      template.baseTemplateId === "cards_v2" || template.id === "cards_v2"
        ? "compact_v2"
        : undefined;
    page = drawCardList(
      pdfDoc,
      page,
      cardListElementToRender,
      jpFont,
      latinFont,
      renderData,
      previewMode,
      repeatingHeaderElements,
      footerReserveHeightPdf,
      imageMap,
      resolveAdjust,
      transform,
      warn,
      debugEnabled,
      onTextBaseline,
      cardListVariant,
    );
  } else if (tableElementToRender) {
    const headerElementsForFirstPage = [
      ...repeatingHeaderElements,
      ...firstPageOnlyHeaderElements,
    ];
    const headerBottomY = resolveHeaderBottomY(headerElementsForFirstPage);
    const tableY = tableElementToRender.y;
    const tableHeaderHeight =
      tableElementToRender.headerHeight ?? tableElementToRender.rowHeight ?? 18;
    const tableHeaderTopY = typeof tableY === 'number' ? tableY : null;
    const gap =
      typeof tableHeaderTopY === 'number' && typeof headerBottomY === 'number'
        ? tableHeaderTopY - headerBottomY
        : null;
    const shouldAdjustTableY = template.structureType !== 'estimate_v1';
    const minGap = 16;
    const desiredTableY =
      shouldAdjustTableY && typeof headerBottomY === 'number'
        ? headerBottomY + minGap
        : null;
    const adjustedTableY =
      shouldAdjustTableY &&
      typeof gap === 'number' &&
      gap < minGap &&
      typeof desiredTableY === 'number'
        ? desiredTableY
        : null;
    const tableElementForRender =
      shouldAdjustTableY && typeof adjustedTableY === 'number'
        ? { ...tableElementToRender, y: adjustedTableY }
        : tableElementToRender;

    if (debugEnabled) {
      if (typeof headerBottomY === 'number') {
        dbgFlipY('headerBottomY(tableLayout)', headerBottomY, 0);
      }
      if (typeof tableY === 'number') {
        dbgFlipY('tableY(items)', tableY, tableHeaderHeight);
      }
    }
    warn('debug', 'table layout positions', {
      tableId: tableElementToRender.id,
      tableY,
      tableHeaderTopY,
      headerBottomY,
      gap,
      adjustedTableY,
        pdf: {
        tableY:
          typeof tableY === 'number'
            ? transform.toPdfYBox(tableY, tableHeaderHeight)
            : null,
        headerBottomY:
          typeof headerBottomY === 'number'
            ? transform.toPdfYBox(headerBottomY, 0)
            : null,
      },
    });
    if (debugEnabled) {
      console.debug('[renderTemplate] table layout positions', {
        tableId: tableElementToRender.id,
        tableY,
        tableHeaderTopY,
        headerBottomY,
        gap,
        adjustedTableY,
      });
    }

    // drawTable には「毎ページヘッダー」だけを渡す
    page = drawTable(
      pdfDoc,
      page,
      template.id,
      tableElementForRender,
      jpFont,
      latinFont,
      renderData,
      previewMode,
      repeatingHeaderElements,
      footerReserveHeightPdf,
      imageMap,
      resolveAdjust,
      transform,
      warn,
      debugEnabled,
      onTextBaseline,
    );
  }

  const pages = pdfDoc.getPages();
  const totalPages = pages.length;
  const footerFontSize = 9;

  for (let i = 0; i < totalPages; i++) {
    const p = pages[i];

    // --- フッター要素（固定文言など）を描画 ---
    //   - 最終ページだけの要素は最後のページにだけ描く
    const footerElementsForThisPage =
      i === totalPages - 1
        ? [...footerAllPages, ...footerLastPageOnly]
        : footerAllPages;

    drawFooterElements(
      p,
      footerElementsForThisPage,
      renderData,
      previewMode,
      jpFont,
      latinFont,
      imageMap,
      resolveAdjust,
      transform,
      warn,
      debugEnabled,
      onTextBaseline,
    );

    // --- ページ番号 (1 / N) を中央下に描画 ---
    const footerText = `${i + 1} / ${totalPages}`;
    const footerFont = pickFont(footerText, latinFont, jpFont);
    const textWidth = footerFont.widthOfTextAtSize(footerText, footerFontSize);
    const x = (pageWidth - textWidth) / 2;
    const y = 20; // 下から20pt

    safeDrawText(p, footerText, {
      x,
      y,
      size: footerFontSize,
      font: footerFont,
      color: rgb(0.5, 0.5, 0.5),
    }, warn, { elementId: 'page_number' });
  }

  if (debugOverlayEnabled && debugOverlayInfo && pages[0]) {
    drawDebugOverlay(pages[0], debugOverlayInfo, pageWidth, pageHeight);
  }

  const bytes = await pdfDoc.save();
  const warningList = Array.from(warnings);
  if (warningList.length > 0) {
    console.warn('renderTemplateToPdf warnings', warningList);
  }
  return { bytes, warnings: warningList };
}

// Manual test ideas:
// - rows undefined or not array, expect render to continue
// - image URL 404 or non-image content-type, expect placeholder
// - fixture=longtext to verify table cell wrap within fixed rowHeight
// - rowHeight=40 query to verify fixed row height spacing changes


const ALIGN_PADDING = 12;

const resolveFontScale = (preset?: 'S' | 'M' | 'L') => {
  if (preset === 'S') return 0.9;
  if (preset === 'L') return 1.1;
  return 1.0;
};

const resolvePagePadding = (preset?: 'Narrow' | 'Normal' | 'Wide') => {
  if (preset === 'Narrow') return 8;
  if (preset === 'Wide') return 24;
  return 16;
};

type EasyAdjustBlock = 'header' | 'recipient' | 'body' | 'footer' | 'documentMeta';

const resolveEasyAdjustBlock = (
  element: TemplateElement,
  template: TemplateDefinition,
): EasyAdjustBlock => {
  const slotId = (element as any).slotId as string | undefined;
  if (slotId === 'doc_no' || slotId === 'date_label' || slotId === 'issue_date') {
    return 'documentMeta';
  }
  if (element.id === 'doc_no_label') {
    return 'documentMeta';
  }
  if (slotId === 'to_name' || element.id === 'to_name') {
    return 'recipient';
  }
  if (element.id === 'to_label' || element.id === 'to_honorific') {
    return 'recipient';
  }
  if (element.region === 'header') return 'header';
  if (element.region === 'footer') return 'footer';
  if (element.region === 'body') return 'body';

  const headerSlots = new Set(template.slotSchema?.header?.map((slot) => slot.slotId) ?? []);
  const footerSlots = new Set(template.slotSchema?.footer?.map((slot) => slot.slotId) ?? []);
  if (slotId) {
    if (headerSlots.has(slotId)) return 'header';
    if (footerSlots.has(slotId)) return 'footer';
    if (slotId.startsWith('header')) return 'header';
    if (slotId.startsWith('footer')) return 'footer';
  }
  if (element.id.startsWith('header')) return 'header';
  if (element.id.startsWith('footer')) return 'footer';
  return 'body';
};

const normalizeEasyAdjustBlockSettings = (
  template: TemplateDefinition,
  block: EasyAdjustBlock,
) => {
  const legacyFontPreset = template.settings?.fontScalePreset ?? 'M';
  const legacyPaddingPreset = template.settings?.pagePaddingPreset ?? 'Normal';
  const easyAdjust = template.settings?.easyAdjust ?? {};
  const groupSettings = (easyAdjust as Record<string, any>)[block] ?? {};
  const legacyTitle = (easyAdjust as Record<string, any>).title ?? {};
  const legacyCustomer = (easyAdjust as Record<string, any>).customer ?? {};
  return {
    fontPreset:
      groupSettings.fontPreset ??
      (block === 'header' ? legacyTitle.fontPreset : undefined) ??
      (block === 'recipient' ? legacyCustomer.fontPreset : undefined) ??
      legacyFontPreset,
    paddingPreset:
      groupSettings.paddingPreset ??
      (block === 'header' ? legacyTitle.paddingPreset : undefined) ??
      (block === 'recipient' ? legacyCustomer.paddingPreset : undefined) ??
      legacyPaddingPreset,
    enabled: groupSettings.enabled !== false,
    docNoVisible: groupSettings.docNoVisible !== false,
    dateVisible: groupSettings.dateVisible !== false,
    hiddenLabelIds: Array.isArray(groupSettings.hiddenLabelIds) ? groupSettings.hiddenLabelIds : [],
  };
};

const resolveEasyAdjustForElement = (
  element: TemplateElement,
  template: TemplateDefinition,
) => {
  const block = resolveEasyAdjustBlock(element, template);
  const settings = normalizeEasyAdjustBlockSettings(template, block);
  const slotId = (element as any).slotId as string | undefined;
  let hidden = (element as any).hidden === true;
  if (!hidden && block !== 'documentMeta' && settings.enabled === false) {
    hidden = true;
  }
  if (!hidden && block === 'documentMeta') {
    const headerSettings = normalizeEasyAdjustBlockSettings(template, 'header');
    if (headerSettings.enabled === false) {
      hidden = true;
    }
    if (!settings.docNoVisible && (slotId === 'doc_no' || element.id === 'doc_no_label')) {
      hidden = true;
    }
    if (!settings.dateVisible && (slotId === 'date_label' || slotId === 'issue_date')) {
      hidden = true;
    }
  }
  return {
    fontScale: resolveFontScale(settings.fontPreset),
    pagePadding: resolvePagePadding(settings.paddingPreset),
    hidden,
  };
};

const resolveAlignedX = (
  element: TemplateElement,
  pageWidth: number,
  elementWidth: number,
  pagePadding: number,
) => {
  const slotId = (element as any).slotId as string | undefined;
  if (slotId !== 'doc_title') return element.x;
  const alignX = (element as any).alignX as 'left' | 'center' | 'right' | undefined;
  if (!alignX) return element.x;
  const safeWidth = Number.isFinite(elementWidth) ? elementWidth : 0;
  if (safeWidth <= 0) return element.x;
  const padding = Number.isFinite(pagePadding) ? pagePadding : ALIGN_PADDING;
  if (alignX === 'left') return padding;
  if (alignX === 'center') return (pageWidth - safeWidth) / 2;
  if (alignX === 'right') return pageWidth - safeWidth - padding;
  return element.x;
};

const applyDocumentMetaLayout = (
  elements: TemplateElement[],
  template: TemplateDefinition,
  pageWidth: number,
): TemplateElement[] => {
  if (template.structureType === 'estimate_v1') return elements;
  const docMetaSettings = normalizeEasyAdjustBlockSettings(template, 'documentMeta');
  if (!docMetaSettings.docNoVisible && !docMetaSettings.dateVisible) return elements;

  const logo = elements.find(
    (el) => el.type === 'image' && ((el as any).slotId === 'logo' || el.id === 'logo'),
  ) as ImageElement | undefined;
  const logoX = Number.isFinite(logo?.x) ? (logo?.x as number) : 450;
  const logoY = Number.isFinite(logo?.y) ? (logo?.y as number) : 752;
  const logoW = Number.isFinite(logo?.width) ? (logo?.width as number) : 120;
  const logoH = Number.isFinite(logo?.height) ? (logo?.height as number) : 60;

  const docNoLabelEl = elements.find((el) => el.id === 'doc_no_label') as TextElement | undefined;
  const docNoEl = elements.find((el) => (el as any).slotId === 'doc_no') as TextElement | undefined;
  const dateLabelEl = elements.find((el) => (el as any).slotId === 'date_label') as TextElement | undefined;
  const issueDateEl = elements.find((el) => (el as any).slotId === 'issue_date') as TextElement | undefined;

  const headerSettings = normalizeEasyAdjustBlockSettings(template, 'header');
  const headerFontScale = resolveFontScale(headerSettings.fontPreset);
  const headerPadding = resolvePagePadding(headerSettings.paddingPreset);
  const blockWidth = Math.min(280, Math.max(200, logoW));
  const blockRight = pageWidth - headerPadding;
  const blockX = Math.max(headerPadding, blockRight - blockWidth);

  const layout = computeDocumentMetaLayout({
    logoX,
    logoY,
    logoWidth: logoW,
    logoHeight: logoH,
    blockX,
    blockWidth,
    gap: 12,
    labelWidth: 56,
    columnGap: 8,
    rowGap: 6,
    minValueWidth: 80,
    docNoVisible: docMetaSettings.docNoVisible,
    dateVisible: docMetaSettings.dateVisible,
    fontSizes: {
      docNoLabel: (docNoLabelEl?.fontSize ?? 9) * headerFontScale,
      docNoValue: (docNoEl?.fontSize ?? 10) * headerFontScale,
      dateLabel: (dateLabelEl?.fontSize ?? 9) * headerFontScale,
      dateValue: (issueDateEl?.fontSize ?? 10) * headerFontScale,
    },
    heights: {
      docNoLabel: docNoLabelEl?.height,
      docNoValue: docNoEl?.height,
      dateLabel: dateLabelEl?.height,
      dateValue: issueDateEl?.height,
    },
  });

  const nextElements = elements.map((el) => {
    if (el.id === 'doc_no_label' && layout.docNoLabel && el.type === 'text') {
      return applyFrameToTextElement(el, layout.docNoLabel);
    }
    if ((el as any).slotId === 'doc_no' && layout.docNoValue && el.type === 'text') {
      return applyFrameToTextElement(el, layout.docNoValue);
    }
    if ((el as any).slotId === 'date_label' && layout.dateLabel && el.type === 'text') {
      return applyFrameToTextElement(el, layout.dateLabel);
    }
    if ((el as any).slotId === 'issue_date' && layout.dateValue && el.type === 'text') {
      return applyFrameToTextElement(el, layout.dateValue);
    }
    return el;
  });

  if (docMetaSettings.docNoVisible && !docNoLabelEl && layout.docNoLabel) {
    nextElements.push({
      id: 'doc_no_label',
      type: 'text',
      region: 'header',
      x: layout.docNoLabel.x,
      y: layout.docNoLabel.y,
      width: layout.docNoLabel.width,
      height: layout.docNoLabel.height,
      fontSize: 9,
      repeatOnEveryPage: true,
      dataSource: { type: 'static', value: '文書番号' },
    } as TextElement);
  }
  if (docMetaSettings.dateVisible && !dateLabelEl && layout.dateLabel) {
    nextElements.push({
      id: 'date_label',
      slotId: 'date_label',
      type: 'text',
      region: 'header',
      x: layout.dateLabel.x,
      y: layout.dateLabel.y,
      width: layout.dateLabel.width,
      height: layout.dateLabel.height,
      fontSize: 9,
      repeatOnEveryPage: true,
      dataSource: { type: 'static', value: '日付' },
    } as TextElement);
  }

  return nextElements;
};

// ============================
// Label
// ============================

function drawLabel(
  page: PDFPage,
  element: LabelElement,
  jpFont: PDFFont,
  latinFont: PDFFont,
  fontScale: number,
  pagePadding: number,
  transform: PdfTransform,
  warn?: WarnFn,
  debugEnabled = false,
  onTextBaseline?: (entry: TextBaselineDebug) => void,
) {
  const fontSizeCanvas = (element.fontSize ?? 12) * fontScale;
  const fontSize = fontSizeCanvas * transform.scaleY;
  const text = element.text ?? '';
  const maxWidthCanvas = element.width ?? 180;
  const maxWidth = transform.toPdfW(maxWidthCanvas);
  const maxLines = 99;
  const lineHeight = fontSize * 1.2;
  const lineHeightCanvas = fontSizeCanvas * 1.2;
  const fillGray = (element as any).fillGray as number | undefined;
  const borderWidthCanvas = (element as any).borderWidth as number | undefined;
  const borderColorGray = (element as any).borderColorGray as number | undefined;
  const fontToUse = pickFont(text, latinFont, jpFont);
  const strokeScale = Math.min(transform.scaleX, transform.scaleY);

  const lines = wrapTextToLines(text, fontToUse, fontSize, maxWidth);
  const contentHeightCanvas = lineHeightCanvas * Math.max(1, lines.length);
  const elementHeightCanvas = typeof element.height === 'number' ? element.height : 0;
  const boxHeightCanvas = Math.max(elementHeightCanvas, contentHeightCanvas);
  const boxHeight = transform.toPdfH(boxHeightCanvas);
  const yBottom = clampPdfY(
    transform.toPdfYBox(element.y, boxHeightCanvas),
    transform.pageHeightPt,
  );
  let yStart = yBottom + boxHeight - lineHeight;
  yStart = clampPdfY(yStart, transform.pageHeightPt - lineHeight);
  const xCanvas = resolveAlignedX(element, transform.canvasWidth, maxWidthCanvas, pagePadding);
  const x = transform.toPdfX(xCanvas);
  const slotId = (element as any).slotId as string | undefined;
  const elementKey = slotId ?? element.id;
  const shouldLogBaseline = debugEnabled && DBG_TEXT_BASELINE_TARGETS.has(elementKey);
  const fontAny = fontToUse as unknown as {
    ascentAtSize?: (size: number) => number;
    descentAtSize?: (size: number) => number;
  };
  const ascent =
    typeof fontAny.ascentAtSize === 'function' ? fontAny.ascentAtSize(fontSize) : null;
  const descent =
    typeof fontAny.descentAtSize === 'function' ? fontAny.descentAtSize(fontSize) : null;
  if (shouldLogBaseline) {
    const entry = {
      elementId: elementKey,
      rectTopY: yBottom + boxHeight,
      rectBottomY: yBottom,
      fontSize,
      ascent,
      descent,
      computedDrawY: yStart,
    };
    console.log('[DBG_TEXT_BASELINE]', entry);
    onTextBaseline?.(entry);
  }
  if (typeof fillGray === 'number') {
    page.drawRectangle({
      x,
      y: yBottom,
      width: maxWidth,
      height: boxHeight,
      color: rgb(fillGray, fillGray, fillGray),
    });
  }
  if (borderWidthCanvas && borderWidthCanvas > 0) {
    const gray = typeof borderColorGray === 'number' ? borderColorGray : 0.6;
    page.drawRectangle({
      x,
      y: yBottom,
      width: maxWidth,
      height: boxHeight,
      borderColor: rgb(gray, gray, gray),
      borderWidth: borderWidthCanvas * strokeScale,
    });
  }
  const align = (element as any).alignX as 'left' | 'center' | 'right' | undefined;
  drawMultilineText(
    page,
    lines,
    x,
    yStart,
    fontToUse,
    fontSize,
    rgb(0, 0, 0),
    maxLines,
    lineHeight,
    element.fontWeight === 'bold' ? 'bold' : 'normal',
    align ?? 'left',
    maxWidth,
    warn,
    { elementId: element.id },
  );
}

// ============================
// Text
// ============================

function drawText(
  page: PDFPage,
  element: TextElement,
  jpFont: PDFFont,
  latinFont: PDFFont,
  data: TemplateDataRecord | undefined,
  previewMode: PreviewMode,
  fontScale: number,
  pagePadding: number,
  transform: PdfTransform,
  warn: WarnFn,
  debugEnabled = false,
  onTextBaseline?: (entry: TextBaselineDebug) => void,
) {
  const fontSizeCanvas = (element.fontSize ?? 12) * fontScale;
  const fontSize = fontSizeCanvas * transform.scaleY;
  const lineHeight = fontSize * 1.2;
  const lineHeightCanvas = fontSizeCanvas * 1.2;
  const maxWidthCanvas = element.width ?? 200;
  const maxWidth = transform.toPdfW(maxWidthCanvas);
  const fillGray = (element as any).fillGray as number | undefined;
  const borderWidthCanvas = (element as any).borderWidth as number | undefined;
  const borderColorGray = (element as any).borderColorGray as number | undefined;

  const resolved = resolveDataSource(
    element.dataSource,
    data,
    previewMode,
    warn,
    { elementId: element.id },
  );
  const text = resolved || element.text || '';
  const fontToUse = pickFont(text, latinFont, jpFont);
  const slotId = (element as any).slotId as string | undefined;
  const elementKey = slotId ?? element.id;
  const isLabelText =
    element.id.endsWith('_label') ||
    (slotId ? slotId.endsWith('_label') : false) ||
    slotId === 'date_label' ||
    element.id === 'to_label';
  const textColor = isLabelText ? rgb(0.35, 0.35, 0.35) : rgb(0, 0, 0);

  const isDocMeta =
    element.id === 'doc_no_label' ||
    slotId === 'doc_no' ||
    slotId === 'date_label' ||
    slotId === 'issue_date';
  const xCanvas = resolveAlignedX(element, transform.canvasWidth, maxWidthCanvas, pagePadding);
  const x = transform.toPdfX(xCanvas);
  const lines = wrapTextToLines(text, fontToUse, fontSize, maxWidth);
  const contentHeightCanvas = lineHeightCanvas * Math.max(1, lines.length);
  const elementHeightCanvas = typeof element.height === 'number' ? element.height : 0;
  const boxHeightCanvas = Math.max(elementHeightCanvas, contentHeightCanvas);
  const boxHeight = transform.toPdfH(boxHeightCanvas);
  const maxLines = Math.max(1, Math.floor(boxHeight / lineHeight));
  const yBottom = clampPdfY(
    transform.toPdfYBox(element.y, boxHeightCanvas),
    transform.pageHeightPt,
  );
  let yStart = yBottom + boxHeight - lineHeight;
  yStart = clampPdfY(yStart, transform.pageHeightPt - lineHeight);
  const align = (element as any).alignX as 'left' | 'center' | 'right' | undefined;
  const shouldLogBaseline = debugEnabled && DBG_TEXT_BASELINE_TARGETS.has(elementKey);
  const fontAny = fontToUse as unknown as {
    ascentAtSize?: (size: number) => number;
    descentAtSize?: (size: number) => number;
  };
  const ascent =
    typeof fontAny.ascentAtSize === 'function' ? fontAny.ascentAtSize(fontSize) : null;
  const descent =
    typeof fontAny.descentAtSize === 'function' ? fontAny.descentAtSize(fontSize) : null;
  const emitBaseline = (computedDrawY: number) => {
    if (!shouldLogBaseline) return;
    const entry = {
      elementId: elementKey,
      rectTopY: yBottom + boxHeight,
      rectBottomY: yBottom,
      fontSize,
      ascent,
      descent,
      computedDrawY,
    };
    console.log('[DBG_TEXT_BASELINE]', entry);
    onTextBaseline?.(entry);
  };
  if (debugEnabled && (element.id === 'doc_title' || slotId === 'doc_title')) {
    console.debug(
      `[DBG_TEXT_POS] id=${element.id} slotId=${slotId ?? ''} ` +
        `canvas(x=${xCanvas},y=${element.y},w=${maxWidthCanvas},h=${boxHeightCanvas}) ` +
        `page(w=${transform.pageWidthPt},h=${transform.pageHeightPt}) ` +
        `rectPdf(x=${x},y=${yBottom}) drawText(x=${x},y=${yStart}) ` +
        `fontSize=${fontSize} lineHeight=${lineHeight}`,
    );
  }
  if (typeof fillGray === 'number') {
    page.drawRectangle({
      x,
      y: yBottom,
      width: maxWidth,
      height: boxHeight,
      color: rgb(fillGray, fillGray, fillGray),
    });
  }
  if (borderWidthCanvas && borderWidthCanvas > 0) {
    const gray = typeof borderColorGray === 'number' ? borderColorGray : 0.6;
    const strokeScale = Math.min(transform.scaleX, transform.scaleY);
    page.drawRectangle({
      x,
      y: yBottom,
      width: maxWidth,
      height: boxHeight,
      borderColor: rgb(gray, gray, gray),
      borderWidth: borderWidthCanvas * strokeScale,
    });
  }
  if (isDocMeta) {
    const line = ellipsisTextToWidth(text, fontToUse, fontSize, maxWidth);
    if (line) {
      emitBaseline(yStart);
      let xPos = x;
      if (align && align !== 'left') {
        const textWidth = fontToUse.widthOfTextAtSize(line, fontSize);
        if (align === 'center') {
          xPos = x + Math.max(0, (maxWidth - textWidth) / 2);
        } else if (align === 'right') {
          xPos = x + Math.max(0, maxWidth - textWidth);
        }
      }
      safeDrawText(page, line, {
        x: xPos,
        y: yStart,
        size: fontSize,
        font: fontToUse,
        color: textColor,
      }, warn, { elementId: element.id });
      if (element.fontWeight === 'bold') {
        safeDrawText(page, line, {
          x: xPos + 0.4,
          y: yStart,
          size: fontSize,
          font: fontToUse,
          color: textColor,
        }, warn, { elementId: element.id });
      }
    }
    return;
  }

  emitBaseline(yStart);
  drawMultilineText(
    page,
    lines,
    x,
    yStart,
    fontToUse,
    fontSize,
    textColor,
    maxLines,
    lineHeight,
    element.fontWeight === 'bold' ? 'bold' : 'normal',
    align ?? 'left',
    maxWidth,
    warn,
    { elementId: element.id },
  );
}

// ============================
// Header elements (label / text / image) for each page
// ============================

function drawHeaderElements(
  page: PDFPage,
  headerElements: TemplateElement[],
  data: TemplateDataRecord | undefined,
  previewMode: PreviewMode,
  jpFont: PDFFont,
  latinFont: PDFFont,
  imageMap: Map<string, PDFImage>,
  resolveAdjust: (element: TemplateElement) => { fontScale: number; pagePadding: number; hidden: boolean },
  transform: PdfTransform,
  warn: WarnFn,
  debugEnabled = false,
  onTextBaseline?: (entry: TextBaselineDebug) => void,
) {
  for (const element of headerElements) {
    const adjust = resolveAdjust(element);
    if (adjust.hidden) continue;
    switch (element.type) {
      case 'label':
        drawLabel(
          page,
          element as LabelElement,
          jpFont,
          latinFont,
          adjust.fontScale,
          adjust.pagePadding,
          transform,
          warn,
          debugEnabled,
          onTextBaseline,
        );
        break;

      case 'text':
        drawText(
          page,
          element as TextElement,
          jpFont,
          latinFont,
          data,
          previewMode,
          adjust.fontScale,
          adjust.pagePadding,
          transform,
          warn,
          debugEnabled,
          onTextBaseline,
        );
        break;

      case 'image':
        drawImageElement(
          page,
          element as ImageElement,
          jpFont,
          latinFont,
          data,
          previewMode,
          adjust.pagePadding,
          imageMap,
          transform,
          warn,
        );
        break;


      case 'table':
        // ヘッダーには含めない（テーブルは別ルートで描画）
        break;
      case 'cardList':
        // ヘッダーには含めない（カードは別ルートで描画）
        break;

      default:
        warn('layout', 'unknown header element type', { type: (element as TemplateElement).type });
    }
  }
}

// ============================
// Footer elements（実装は header とほぼ同じ）
// ============================

function drawFooterElements(
  page: PDFPage,
  footerElements: TemplateElement[],
  data: TemplateDataRecord | undefined,
  previewMode: PreviewMode,
  jpFont: PDFFont,
  latinFont: PDFFont,
  imageMap: Map<string, PDFImage>,
  resolveAdjust: (element: TemplateElement) => { fontScale: number; pagePadding: number; hidden: boolean },
  transform: PdfTransform,
  warn: WarnFn,
  debugEnabled = false,
  onTextBaseline?: (entry: TextBaselineDebug) => void,
) {
  for (const element of footerElements) {
    const adjust = resolveAdjust(element);
    if (adjust.hidden) continue;
    switch (element.type) {
      case 'label':
        drawLabel(
          page,
          element as LabelElement,
          jpFont,
          latinFont,
          adjust.fontScale,
          adjust.pagePadding,
          transform,
          warn,
          debugEnabled,
          onTextBaseline,
        );
        break;

      case 'text':
        drawText(
          page,
          element as TextElement,
          jpFont,
          latinFont,
          data,
          previewMode,
          adjust.fontScale,
          adjust.pagePadding,
          transform,
          warn,
          debugEnabled,
          onTextBaseline,
        );
        break;

      case 'image':
        drawImageElement(
          page,
          element as ImageElement,
          jpFont,
          latinFont,
          data,
          previewMode,
          adjust.pagePadding,
          imageMap,
          transform,
          warn,
        );
        break;

      case 'table':
        // フッターにはテーブルを描かない想定
        break;
      case 'cardList':
        // フッターにはカードを描かない想定
        break;

      default:
        warn('layout', 'unknown footer element type', { type: (element as TemplateElement).type });
    }
  }
}

const coerceNumber = (value: unknown, fallback: number) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const coercePositiveInt = (value: unknown, fallback: number) => {
  const num = Math.floor(coerceNumber(value, fallback));
  return num > 0 ? num : fallback;
};

const normalizeLabelSheetSettings = (
  raw: unknown,
  warn: WarnFn,
): LabelSheetSettings => {
  const source = (raw && typeof raw === 'object') ? (raw as Record<string, unknown>) : {};
  const paperWidthMm = Math.max(10, coerceNumber(source.paperWidthMm, DEFAULT_LABEL_SHEET.paperWidthMm));
  const paperHeightMm = Math.max(10, coerceNumber(source.paperHeightMm, DEFAULT_LABEL_SHEET.paperHeightMm));
  const cols = coercePositiveInt(source.cols, DEFAULT_LABEL_SHEET.cols);
  const rows = coercePositiveInt(source.rows, DEFAULT_LABEL_SHEET.rows);
  const marginMm = Math.max(0, coerceNumber(source.marginMm, DEFAULT_LABEL_SHEET.marginMm));
  const gapMm = Math.max(0, coerceNumber(source.gapMm, DEFAULT_LABEL_SHEET.gapMm));
  const offsetXmm = coerceNumber(source.offsetXmm, DEFAULT_LABEL_SHEET.offsetXmm);
  const offsetYmm = coerceNumber(source.offsetYmm, DEFAULT_LABEL_SHEET.offsetYmm);

  if (cols <= 0 || rows <= 0) {
    warn('layout', 'label cols/rows invalid; using default', { cols, rows });
  }

  return {
    paperWidthMm,
    paperHeightMm,
    cols,
    rows,
    marginMm,
    gapMm,
    offsetXmm,
    offsetYmm,
  };
};

const normalizeLabelMapping = (raw: unknown): LabelMapping => {
  const source = (raw && typeof raw === 'object') ? (raw as Record<string, unknown>) : {};
  const slots = (source.slots && typeof source.slots === 'object')
    ? (source.slots as Record<string, unknown>)
    : {};
  const normalizeFieldCode = (value: unknown) =>
    typeof value === 'string' && value.trim() !== '' ? value.trim() : null;

  return {
    slots: {
      title: normalizeFieldCode(slots.title),
      code: normalizeFieldCode(slots.code),
      qty: normalizeFieldCode(slots.qty),
      qr: normalizeFieldCode(slots.qr),
      extra: normalizeFieldCode(slots.extra),
    },
    copiesFieldCode: normalizeFieldCode(source.copiesFieldCode),
  };
};

type LabelGridLayout = {
  pageWidthPt: number;
  pageHeightPt: number;
  labelWmm: number;
  labelHmm: number;
  labelWPt: number;
  labelHPt: number;
  labelsPerPage: number;
  getCellRect: (index: number) => { x: number; y: number; width: number; height: number };
};

const buildLabelGridLayout = (
  sheet: LabelSheetSettings,
  warn: WarnFn,
): LabelGridLayout | null => {
  const innerW = sheet.paperWidthMm - sheet.marginMm * 2 - sheet.gapMm * (sheet.cols - 1);
  const innerH = sheet.paperHeightMm - sheet.marginMm * 2 - sheet.gapMm * (sheet.rows - 1);
  if (innerW <= 0 || innerH <= 0) {
    warn('layout', 'label sheet is too small', { innerW, innerH });
    return null;
  }

  const labelWmm = innerW / sheet.cols;
  const labelHmm = innerH / sheet.rows;
  const pageWidthPt = mmToPt(sheet.paperWidthMm);
  const pageHeightPt = mmToPt(sheet.paperHeightMm);
  const labelWPt = mmToPt(labelWmm);
  const labelHPt = mmToPt(labelHmm);
  const labelsPerPage = sheet.cols * sheet.rows;

  const getCellRect = (index: number) => {
    const row = Math.floor(index / sheet.cols);
    const col = index % sheet.cols;
    const xMm = sheet.marginMm + col * (labelWmm + sheet.gapMm) + sheet.offsetXmm;
    const yMm = sheet.marginMm + row * (labelHmm + sheet.gapMm) + sheet.offsetYmm;
    const x = mmToPt(xMm);
    const y = pageHeightPt - mmToPt(yMm) - labelHPt;
    return { x, y, width: labelWPt, height: labelHPt };
  };

  return {
    pageWidthPt,
    pageHeightPt,
    labelWmm,
    labelHmm,
    labelWPt,
    labelHPt,
    labelsPerPage,
    getCellRect,
  };
};

const getLabelFieldValue = (
  data: TemplateDataRecord | undefined,
  fieldCode: string | null | undefined,
  previewMode: PreviewMode,
  warn: WarnFn,
  context: Record<string, unknown>,
): string => {
  if (!fieldCode) return '';
  const raw = resolveFieldValue(
    fieldCode,
    data as Record<string, unknown> | undefined,
    previewMode,
  );
  return stringifyValue(raw, warn, { ...context, fieldCode });
};

const clampLinesWithEllipsis = (
  lines: string[],
  font: PDFFont,
  fontSize: number,
  maxWidth: number,
  maxLines: number,
) => {
  if (lines.length <= maxLines) return lines;
  const next = lines.slice(0, maxLines);
  const last = next[maxLines - 1] ?? '';
  next[maxLines - 1] = ellipsisTextToWidth(last, font, fontSize, maxWidth);
  return next;
};

const resolveCopiesCount = (
  data: TemplateDataRecord | undefined,
  fieldCode: string | null,
  previewMode: PreviewMode,
  warn: WarnFn,
): number => {
  if (!fieldCode) return 1;
  const raw = resolveFieldValue(
    fieldCode,
    data as Record<string, unknown> | undefined,
    previewMode,
  );
  if (raw === null || raw === undefined || raw === '') {
    warn('data', 'copies field missing data', { fieldCode });
    return 1;
  }
  const num = Number(raw);
  if (!Number.isFinite(num)) {
    warn('data', 'copies is not numeric', { fieldCode, value: raw });
    return 1;
  }
  if (num <= 0) return 1;
  if (num > 1000) {
    warn('data', 'copies capped to 1000', { fieldCode, value: num });
    return 1000;
  }
  return Math.floor(num);
};

const drawQrPlaceholder = (
  page: PDFPage,
  x: number,
  y: number,
  size: number,
  font: PDFFont,
  warn?: WarnFn,
) => {
  page.drawRectangle({
    x,
    y,
    width: size,
    height: size,
    borderColor: rgb(0.6, 0.6, 0.6),
    borderWidth: 0.5,
  });
  safeDrawText(
    page,
    'QR',
    {
      x: x + 4,
      y: y + size / 2 - 4,
      size: 8,
      font,
      color: rgb(0.5, 0.5, 0.5),
    },
    warn,
    { elementId: 'qr_placeholder' },
  );
};

const drawQrCode = (
  page: PDFPage,
  x: number,
  y: number,
  size: number,
  value: string,
  warn: WarnFn,
  fallbackFont: PDFFont,
) => {
  if (!value) {
    drawQrPlaceholder(page, x, y, size, fallbackFont, warn);
    return;
  }

  let qr: ReturnType<typeof qrcode> | null = null;
  try {
    qr = qrcode(0, 'M');
    qr.addData(value);
    qr.make();
  } catch (error) {
    warn('data', 'qr generation failed', {
      value: value.slice(0, 80),
      error: error instanceof Error ? error.message : String(error),
    });
    drawQrPlaceholder(page, x, y, size, fallbackFont);
    return;
  }

  const count = qr.getModuleCount();
  if (!Number.isFinite(count) || count <= 0) {
    warn('data', 'qr module count invalid', { count });
    drawQrPlaceholder(page, x, y, size, fallbackFont);
    return;
  }

  const cell = size / count;
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (!qr.isDark(row, col)) continue;
      page.drawRectangle({
        x: x + col * cell,
        y: y + (count - 1 - row) * cell,
        width: cell,
        height: cell,
        color: rgb(0, 0, 0),
      });
    }
  }
};

type FitResult = { lines: string[]; fontSize: number };

const calcMaxFontSizeForLines = (
  lines: string[],
  font: PDFFont,
  boxW: number,
  boxH: number,
  lineHeightFactor: number,
): number => {
  if (lines.length === 0 || boxW <= 0 || boxH <= 0) return 0;
  const heightLimit = boxH / (lines.length * lineHeightFactor);
  let widthLimit = Number.POSITIVE_INFINITY;
  for (const line of lines) {
    if (!line) continue;
    const widthAt1 = font.widthOfTextAtSize(line, 1);
    if (widthAt1 > 0) {
      widthLimit = Math.min(widthLimit, boxW / widthAt1);
    }
  }
  const maxSize = Math.min(heightLimit, widthLimit);
  return Number.isFinite(maxSize) ? Math.max(0, maxSize) : 0;
};

const fitLines = (
  lines: string[],
  font: PDFFont,
  boxW: number,
  boxH: number,
  lineHeightFactor: number,
): FitResult => ({
  lines,
  fontSize: calcMaxFontSizeForLines(lines, font, boxW, boxH, lineHeightFactor),
});

const makeTwoLineCandidates = (text: string, maxCandidates = 30): string[][] => {
  const positions: number[] = [];
  const splitter = /[\s\-\/／_・|]/g;
  let match: RegExpExecArray | null;
  while ((match = splitter.exec(text)) !== null) {
    const idx = match.index;
    if (idx > 0 && idx < text.length - 1) positions.push(idx);
  }
  const mid = Math.floor(text.length / 2);
  positions.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid));
  const limited = positions.slice(0, maxCandidates);
  const candidates: string[][] = [];
  for (const idx of limited) {
    const left = text.slice(0, idx).trim();
    const right = text.slice(idx + 1).trim();
    if (!left || !right) continue;
    candidates.push([left, right]);
  }
  return candidates;
};

const splitHalf = (text: string): string[] => {
  if (text.length < 2) return [text];
  const mid = Math.floor(text.length / 2);
  const left = text.slice(0, mid).trim();
  const right = text.slice(mid).trim();
  if (!left || !right) return [text];
  return [left, right];
};

const fitTitleUpTo2Lines = (
  text: string,
  font: PDFFont,
  boxW: number,
  boxH: number,
  lineHeightFactor: number,
): FitResult => {
  const trimmed = text.trim();
  if (!trimmed || boxW <= 0 || boxH <= 0) {
    return { lines: [], fontSize: 0 };
  }

  const heightLimit = boxH / lineHeightFactor;
  const widthAtHeightLimit = font.widthOfTextAtSize(trimmed, heightLimit);
  if (Number.isFinite(widthAtHeightLimit) && widthAtHeightLimit <= boxW) {
    return { lines: [trimmed], fontSize: heightLimit };
  }

  let best = fitLines([trimmed], font, boxW, boxH, lineHeightFactor);
  const candidates = makeTwoLineCandidates(trimmed);
  for (const lines of candidates) {
    const fit = fitLines(lines, font, boxW, boxH, lineHeightFactor);
    if (fit.fontSize > best.fontSize) best = fit;
  }

  if (best.fontSize <= 0 && candidates.length === 0) {
    const fallbackLines = splitHalf(trimmed);
    best = fitLines(fallbackLines, font, boxW, boxH, lineHeightFactor);
  }

  return best;
};

const drawLabelSheet = (
  pdfDoc: PDFDocument,
  firstPage: PDFPage,
  template: TemplateDefinition,
  data: TemplateDataRecord | undefined,
  previewMode: PreviewMode,
  jpFont: PDFFont,
  latinFont: PDFFont,
  warn: WarnFn,
): void => {
  const sheet = normalizeLabelSheetSettings(template.sheetSettings, warn);
  const mapping = normalizeLabelMapping(template.mapping);
  const copies = resolveCopiesCount(data, mapping.copiesFieldCode, previewMode, warn);

  const layout = buildLabelGridLayout(sheet, warn);
  if (!layout) return;

  const safeMarginMm = 3;
  const internalGapMm = 3;
  const qrSizeMm = layout.labelHmm * 0.3;

  const labelsPerPage = layout.labelsPerPage;
  let currentPage = firstPage;

  const titleValue = getLabelFieldValue(data, mapping.slots.title, previewMode, warn, { slot: 'title' });
  const codeValue = getLabelFieldValue(data, mapping.slots.code, previewMode, warn, { slot: 'code' });
  const qtyValue = getLabelFieldValue(data, mapping.slots.qty, previewMode, warn, { slot: 'qty' });
  const qrValue = getLabelFieldValue(data, mapping.slots.qr, previewMode, warn, { slot: 'qr' });
  const extraValue = getLabelFieldValue(data, mapping.slots.extra, previewMode, warn, { slot: 'extra' });

  if (!qrValue) {
    warn('data', 'qr value is empty', { slot: 'qr' });
  }

  for (let i = 0; i < copies; i++) {
    if (i > 0 && i % labelsPerPage === 0) {
      currentPage = pdfDoc.addPage([layout.pageWidthPt, layout.pageHeightPt]);
    }
    const index = i % labelsPerPage;
    const rect = layout.getCellRect(index);
    const x = rect.x;
    const y = rect.y;
    const w = rect.width;
    const h = rect.height;

    const safeMarginPt = mmToPt(safeMarginMm);
    const internalGapPt = mmToPt(internalGapMm);
    const headerHeightPt = h * 0.5;
    const footerTop = y + h - headerHeightPt;

    const qrSizePt = mmToPt(qrSizeMm);
    if (qrSizePt > footerTop - (y + safeMarginPt)) {
      warn('layout', 'qr size exceeds footer height', { qrSizeMm, labelH: layout.labelHmm });
    }
    const qrX = x + w - safeMarginPt - qrSizePt;
    const qrY = y + safeMarginPt;
    const textX = x + safeMarginPt;
    const textWidth = Math.max(0, w - safeMarginPt * 2 - qrSizePt - internalGapPt);
    const titleFont = pickFont(titleValue, latinFont, jpFont);
    const subFont = pickFont(codeValue || qtyValue || extraValue || '', latinFont, jpFont);

    const headerTop = y + h - safeMarginPt;
    const headerBottom = Math.max(footerTop, y + safeMarginPt);
    const headerBoxHeight = Math.max(0, headerTop - headerBottom);
    const headerBoxWidth = Math.max(0, w - safeMarginPt * 2);
    const titleLineHeightFactor = 1.2;

    if (titleValue && headerBoxHeight > 0 && headerBoxWidth > 0) {
      const fit = fitTitleUpTo2Lines(
        titleValue,
        titleFont,
        headerBoxWidth,
        headerBoxHeight,
        titleLineHeightFactor,
      );
      if (fit.fontSize > 0 && fit.lines.length > 0) {
        const titleLineHeight = fit.fontSize * titleLineHeightFactor;
        drawMultilineText(
          currentPage,
          fit.lines,
          textX,
          headerTop - fit.fontSize,
          titleFont,
          fit.fontSize,
          rgb(0, 0, 0),
          fit.lines.length,
          titleLineHeight,
          'normal',
          'left',
          undefined,
          warn,
          { elementId: 'label_sheet_title' },
        );
      }
    }

    const footerTextY = y + safeMarginPt;
    const footerTextHeight = Math.max(0, footerTop - footerTextY);
    const subValues = [codeValue, qtyValue, extraValue].filter((value) => value);
    if (subValues.length > 0 && footerTextHeight > 0 && textWidth > 0) {
      const subLineHeightFactor = 1.2;
      const subFontSize = calcMaxFontSizeForLines(
        subValues,
        subFont,
        textWidth,
        footerTextHeight,
        subLineHeightFactor,
      );
      if (subFontSize > 0) {
        const subLineHeight = subFontSize * subLineHeightFactor;
        drawMultilineText(
          currentPage,
          subValues,
          textX,
          footerTop - subFontSize,
          subFont,
          subFontSize,
          rgb(0.2, 0.2, 0.2),
          subValues.length,
          subLineHeight,
          'normal',
          'left',
          undefined,
          warn,
          { elementId: 'label_sheet_footer' },
        );
      }
    }

    drawQrCode(currentPage, qrX, qrY, qrSizePt, qrValue, warn, subFont);
  }
};

// ============================
// Table
// ============================

function drawTable(
  pdfDoc: PDFDocument,
  page: PDFPage,
  templateId: string,
  element: TableElement,
  jpFont: PDFFont,
  latinFont: PDFFont,
  data: TemplateDataRecord | undefined,
  previewMode: PreviewMode,
  headerElements: TemplateElement[],
  footerReserveHeight: number,
  imageMap: Map<string, PDFImage>,
  resolveAdjust: (element: TemplateElement) => { fontScale: number; pagePadding: number; hidden: boolean },
  transform: PdfTransform,
  warn: WarnFn,
  debugEnabled = false,
  onTextBaseline?: (entry: TextBaselineDebug) => void,
): PDFPage {
  let phase: 'header' | 'cell' | 'summary' = 'header';
  try {
  const pageWidth = transform.pageWidthPt;
  const pageHeight = transform.pageHeightPt;
  const rowHeightCanvas = element.rowHeight ?? 18;
  const headerHeightCanvas = element.headerHeight ?? rowHeightCanvas;
  const baseFontSize = 10 * transform.scaleY;
  const lineGap = 2 * transform.scaleY;
  const lineHeight = baseFontSize + lineGap;
  const paddingY = 4 * transform.scaleY;
  const paddingLeft = CELL_PADDING_X * transform.scaleX;
  const paddingRight = CELL_PADDING_X * transform.scaleX;
  const headerRowGapCanvas = Math.min(8, Math.max(4, Math.round(rowHeightCanvas * 0.3)));
  const headerRowGap = transform.toPdfH(headerRowGapCanvas);
  const gridBorderGray = (element as any).borderColorGray ?? 0.85;
  const gridBorderWidthCanvas = (element as any).borderWidth ?? 0.5;
  const strokeScale = Math.min(transform.scaleX, transform.scaleY);
  const gridBorderWidth = gridBorderWidthCanvas * strokeScale;

  const rowHeight = transform.toPdfH(rowHeightCanvas);
  const headerHeight = transform.toPdfH(headerHeightCanvas);
  const originX = transform.toPdfX(element.x);
  const bottomMargin = footerReserveHeight + 40; // 下から40ptは余白

  // サブテーブル行
  if (!element.columns || element.columns.length === 0) {
    warn('data', 'table columns empty', { id: element.id });
    return page;
  }

  const rawRows =
    data &&
    element.dataSource &&
    element.dataSource.type === 'kintoneSubtable'
      ? data[element.dataSource.fieldCode]
      : undefined;
  const rows = Array.isArray(rawRows) ? rawRows : [];
  if (rawRows !== undefined && !Array.isArray(rawRows)) {
    warn('data', 'table rows is not array', {
      id: element.id,
      fieldCode: element.dataSource?.fieldCode,
    });
  }

  warn('debug', 'draw table', {
    id: element.id,
    uiY: element.y,
    rows: rows?.length ?? 0,
  });

  if (!rows || rows.length === 0) {
    return page;
  }

  const summarySpec =
    element.summary?.mode === 'lastPageOnly' ||
    element.summary?.mode === 'everyPageSubtotal+lastTotal'
      ? element.summary
      : undefined;
  const summaryRows = summarySpec?.rows ?? [];
  const summaryStates = summaryRows.map((row, index) => ({
    row,
    index,
    sumGrandValue: 0n,
    sumGrandScale: 0,
    sumPageValue: 0n,
    sumPageScale: 0,
  }));
  const summaryStyle = summarySpec?.style;
  const columnsById = new Map(element.columns.map((col) => [col.id, col]));
  const labelColumn =
    element.columns.find((col) => isItemNameColumn(col)) ?? element.columns[0];
  const amountColumn = element.columns.find((col) => col.fieldCode === 'Amount');
  const amountFieldCode = amountColumn?.fieldCode;
  const sumStateForTotal =
    summaryStates.find(
      (state) => state.row.op === 'sum' && state.row.fieldCode === 'Amount',
    ) ?? summaryStates.find((state) => state.row.op === 'sum');
  const needsFallbackTotal = !sumStateForTotal && !!amountFieldCode;
  let fallbackGrandTotalValue = 0n;
  let fallbackGrandTotalScale = 0;
  const summaryRowHeight = Math.max(rowHeight, lineHeight + paddingY * 2);
  const columnWidths = element.columns.map((col) => transform.toPdfW(col.width));
  const tableWidth = columnWidths.reduce((sum, width) => sum + width, 0);
  const summaryMode = summarySpec?.mode;
  const resolveSummaryKind = (row: SummaryRow) => row.kind ?? 'both';
  const shouldDrawSummaryKind = (row: SummaryRow, kind: 'subtotal' | 'total') => {
    const resolved = resolveSummaryKind(row);
    return resolved === 'both' || resolved === kind;
  };
  const resolveSummaryLabel = (row: SummaryRow, kind: 'subtotal' | 'total') => {
    if (row.op !== 'sum') return row.label ?? '';
    return kind === 'subtotal'
      ? row.labelSubtotal ?? row.label ?? ''
      : row.labelTotal ?? row.label ?? '';
  };

  // テーブルヘッダー（列タイトル）を描画するヘルパー
  const drawTableHeaderRow = (targetPage: PDFPage, headerY: number) => {
    let currentX = originX;
    for (const [index, col] of element.columns.entries()) {
      const colWidth = columnWidths[index] ?? transform.toPdfW(col.width);

      // 枠線
      targetPage.drawRectangle({
        x: currentX,
        y: headerY,
        width: colWidth,
        height: headerHeight,
        borderColor: rgb(gridBorderGray, gridBorderGray, gridBorderGray),
        borderWidth: gridBorderWidth,
      });

      // 列タイトル
      const headerFont = pickFont(col.title, latinFont, jpFont);
      safeDrawText(
        targetPage,
        col.title,
        {
          x: currentX + paddingLeft,
          y: headerY + headerHeight / 2 - baseFontSize / 2,
          size: baseFontSize,
          font: headerFont,
          color: rgb(0, 0, 0),
        },
        warn,
        { tableId: element.id, columnId: col.id },
      );
      safeDrawText(
        targetPage,
        col.title,
        {
          x: currentX + paddingLeft + 0.4 * strokeScale,
          y: headerY + headerHeight / 2 - baseFontSize / 2,
          size: baseFontSize,
          font: headerFont,
          color: rgb(0, 0, 0),
        },
        warn,
        { tableId: element.id, columnId: col.id },
      );

      currentX += colWidth;
    }
  };

  let currentPage = page;
  const minHeaderY = bottomMargin + headerRowGap + rowHeight;
  const getHeaderY = () =>
    clampPdfY(
      transform.toPdfYBox(element.y, headerHeightCanvas),
      pageHeight - headerHeight,
    );
  let headerY = getHeaderY();
  let cursorY = headerY - headerRowGap;

  if (headerY < minHeaderY) {
    currentPage = pdfDoc.addPage([pageWidth, pageHeight]);

    drawHeaderElements(
      currentPage,
      headerElements,
      data,
      previewMode,
      jpFont,
      latinFont,
      imageMap,
      resolveAdjust,
      transform,
      warn,
      debugEnabled,
      onTextBaseline,
    );

    headerY = getHeaderY();
    cursorY = headerY - headerRowGap;
    if (headerY < minHeaderY) {
      warn('layout', 'table header Y is too low for minimum layout', {
        id: element.id,
        headerY,
        minHeaderY,
      });
    }
  }

  // 1ページ目には、既に renderTemplateToPdf 側でヘッダー要素が描画済みなので、
  // ここではテーブルヘッダー行だけ描画する
  drawTableHeaderRow(currentPage, headerY);

  const drawSummaryRow = (
    state: (typeof summaryStates)[number],
    kind: 'subtotal' | 'total',
  ) => {
    const row = state.row;
    const isSumRow = row.op === 'sum';
    const valueColumnId = isSumRow ? row.columnId : row.valueColumnId ?? row.columnId;
    const valueColumn = columnsById.get(valueColumnId);
    if (!valueColumn) {
      warn('data', 'summary column not found', {
        tableId: element.id,
        columnId: valueColumnId,
      });
    }

    const rowYBottomLayout = cursorY - summaryRowHeight;
    if (!Number.isFinite(rowYBottomLayout) || !Number.isFinite(summaryRowHeight)) {
      throw new Error(
        `[renderTable] summary layout missing: rowTop=${cursorY} rowH=${summaryRowHeight}`,
      );
    }
    const rowTopPdfRaw = rowYBottomLayout + summaryRowHeight;
    const rowTopPdfDraw = snapPdfStroke(rowTopPdfRaw, gridBorderWidth);
    const rowYBottomDraw = rowTopPdfDraw - summaryRowHeight;
    const sumValue =
      kind === 'subtotal'
        ? { value: state.sumPageValue, scale: state.sumPageScale }
        : { value: state.sumGrandValue, scale: state.sumGrandScale };
    const sumText = isSumRow ? formatScaledBigInt(sumValue.value, sumValue.scale) : row.value ?? '';
    const labelText = resolveSummaryLabel(row, kind);
    let currentX = originX;

    if (isSumRow) {
      warn('debug', kind === 'subtotal' ? 'subtotal drawn' : 'total drawn', {
        tableId: element.id,
        amount: formatScaledBigInt(sumValue.value, sumValue.scale),
      });
    }
    if (!isSumRow && row.value === undefined) {
      warn('data', 'summary static value missing', {
        tableId: element.id,
        rowIndex: state.index,
      });
    }

    if (summaryStyle) {
      const fillGray =
        kind === 'total'
          ? summaryStyle.totalFillGray ?? 0.92
          : summaryStyle.subtotalFillGray ?? 0.96;
      currentPage.drawRectangle({
        x: originX,
        y: rowYBottomDraw,
        width: tableWidth,
        height: summaryRowHeight,
        color: rgb(fillGray, fillGray, fillGray),
      });
    }

    for (const [colIndex, col] of element.columns.entries()) {
      const colWidth = columnWidths[colIndex] ?? transform.toPdfW(col.width);
      const spec = normalizeColumnSpec(col);
      const cellText =
        col.id === labelColumn.id
          ? labelText
          : col.id === valueColumnId
          ? sumText
          : '';
      const fontForCell = pickFont(cellText, latinFont, jpFont);
      const minFontSize = spec.minFontSize * transform.scaleY;

      if (element.showGrid) {
        const borderGray = summaryStyle?.borderColorGray ?? gridBorderGray;
        currentPage.drawRectangle({
          x: currentX,
          y: rowYBottomDraw,
          width: colWidth,
          height: summaryRowHeight,
          borderColor: rgb(borderGray, borderGray, borderGray),
          borderWidth: gridBorderWidth,
        });
      }

      if (cellText) {
          const align =
            col.id === labelColumn.id
              ? 'left'
              : col.id === valueColumnId
              ? 'right'
              : resolveColumnAlign(spec, cellText);
        const maxCellWidth = Math.max(0, colWidth - (paddingLeft + paddingRight));
        if (col.id === labelColumn.id) {
          const clipped = ellipsisTextToWidth(cellText, fontForCell, baseFontSize, maxCellWidth);
          drawAlignedText(
            currentPage,
            clipped,
            fontForCell,
            baseFontSize,
            currentX,
            rowYBottomDraw,
            colWidth,
            summaryRowHeight,
            align,
            paddingLeft,
            warn,
            { tableId: element.id, columnId: col.id },
          );
        } else if (spec.overflow === 'shrink') {
          drawCellText(
            currentPage,
            cellText,
            fontForCell,
            baseFontSize,
            currentX,
            rowYBottomDraw,
            colWidth,
            summaryRowHeight,
            align,
            paddingLeft,
            paddingY,
            minFontSize,
            'middle',
            rgb(0, 0, 0),
            warn,
            { tableId: element.id, columnId: col.id },
          );
        } else if (spec.overflow === 'ellipsis') {
          const clipped = ellipsisTextToWidth(cellText, fontForCell, baseFontSize, maxCellWidth);
          drawAlignedText(
            currentPage,
            clipped,
            fontForCell,
            baseFontSize,
            currentX,
            rowYBottomDraw,
            colWidth,
            summaryRowHeight,
            align,
            paddingLeft,
            warn,
            { tableId: element.id, columnId: col.id },
          );
        } else if (spec.overflow === 'wrap') {
          const lines = wrapTextToLines(cellText, fontForCell, baseFontSize, maxCellWidth);
          const maxLinesByHeight = Math.floor((summaryRowHeight - paddingY * 2) / lineHeight);
          const yStart = rowTopPdfDraw - paddingY - lineHeight;
          for (let idx = 0; idx < Math.min(lines.length, maxLinesByHeight); idx += 1) {
            const line = lines[idx];
            const lineWidth = fontForCell.widthOfTextAtSize(line, baseFontSize);
            const x =
              align === 'right'
                ? currentX + colWidth - paddingRight - lineWidth
                : align === 'center'
                ? currentX + (colWidth - lineWidth) / 2
                : currentX + paddingLeft;
            safeDrawText(
              currentPage,
              line,
              {
                x,
                y: rowTopPdfDraw - paddingY - lineHeight - idx * lineHeight,
                size: baseFontSize,
                font: fontForCell,
                color: rgb(0, 0, 0),
              },
              warn,
              { tableId: element.id, columnId: col.id },
            );
          }
        } else {
          drawAlignedText(
            currentPage,
            cellText,
            fontForCell,
            baseFontSize,
            currentX,
            rowYBottomDraw,
            colWidth,
            summaryRowHeight,
            align,
            paddingLeft,
            warn,
            { tableId: element.id, columnId: col.id },
          );
        }
      }

      currentX += colWidth;
    }

    if (summaryStyle && kind === 'total') {
      const borderGray = summaryStyle.borderColorGray ?? gridBorderGray;
      const thicknessCanvas = summaryStyle.totalTopBorderWidth ?? 1.5;
      const thickness = thicknessCanvas * strokeScale;
      currentPage.drawLine({
        start: { x: originX, y: rowYBottomDraw + summaryRowHeight },
        end: { x: originX + tableWidth, y: rowYBottomDraw + summaryRowHeight },
        thickness,
        color: rgb(borderGray, borderGray, borderGray),
      });
    }

    cursorY = rowYBottomLayout;
  };

  const getSummaryRows = (kind: 'subtotal' | 'total') =>
    summaryStates.filter((state) => shouldDrawSummaryKind(state.row, kind));

  const ensureSummarySpace = (rowCount: number, allowPageBreak: boolean) => {
    if (rowCount <= 0) return true;
    const neededHeight = summaryRowHeight * rowCount;
    if (cursorY - neededHeight >= bottomMargin) return true;
    if (!allowPageBreak) return false;

    currentPage = pdfDoc.addPage([pageWidth, pageHeight]);
    drawHeaderElements(
      currentPage,
      headerElements,
      data,
      previewMode,
      jpFont,
      latinFont,
      imageMap,
      resolveAdjust,
      transform,
      warn,
      debugEnabled,
      onTextBaseline,
    );

    headerY = getHeaderY();
    cursorY = headerY - headerRowGap;
    if (headerY < minHeaderY) {
      warn('layout', 'table header Y is too low for minimum layout', {
        id: element.id,
        headerY,
        minHeaderY,
      });
    }
    drawTableHeaderRow(currentPage, headerY);
    return cursorY - neededHeight >= bottomMargin;
  };

  const drawSummaryLines = (kind: 'subtotal' | 'total', allowPageBreak: boolean) => {
    if (!summarySpec || summaryStates.length === 0 || !labelColumn) return false;
    const rowsToDraw = getSummaryRows(kind);
    if (rowsToDraw.length === 0) return false;

    const hasSpace = ensureSummarySpace(rowsToDraw.length, allowPageBreak);
    if (!hasSpace && !allowPageBreak) {
      return false;
    }
    if (!hasSpace && allowPageBreak) {
      warn('layout', 'summary rows do not fit', { tableId: element.id });
    }

    for (const state of rowsToDraw) {
      drawSummaryRow(state, kind);
    }
    return true;
  };

  const subtotalRowCount =
    summaryMode === 'everyPageSubtotal+lastTotal'
      ? getSummaryRows('subtotal').length
      : 0;
  const totalRowCount = summarySpec ? getSummaryRows('total').length : 0;
  const trailerRowCount =
    summaryMode === 'everyPageSubtotal+lastTotal'
      ? subtotalRowCount + totalRowCount
      : 0;

  const missingFieldCodes = new Set<string>();
  let invalidRowWarnCount = 0;
  let pageRowCount = 0;
  let rowMathLogged = false;
  let nudgeLogged = false;
  const emitTableCellBaseline = (
    elementId: string,
    rectTopY: number,
    rectBottomY: number,
    fontSize: number,
    computedDrawY: number,
    font: PDFFont,
  ) => {
    if (!debugEnabled) return;
    const fontAny = font as unknown as {
      ascentAtSize?: (size: number) => number;
      descentAtSize?: (size: number) => number;
    };
    const ascent =
      typeof fontAny.ascentAtSize === 'function' ? fontAny.ascentAtSize(fontSize) : null;
    const descent =
      typeof fontAny.descentAtSize === 'function' ? fontAny.descentAtSize(fontSize) : null;
    const entry = {
      elementId,
      rectTopY,
      rectBottomY,
      fontSize,
      ascent,
      descent,
      computedDrawY,
    };
    console.log('[DBG_TEXT_BASELINE]', entry);
    onTextBaseline?.(entry);
  };
  const emitTableCellPdfLog = (
    elementId: string,
    rectTopY: number,
    rectBottomY: number,
    fontSize: number,
    computedDrawY: number,
    meta?: {
      rowTop_pdf_raw?: number;
      rowTop_pdf_draw?: number;
      rowBottom_pdf_draw?: number;
      cellInnerTop_pdf?: number;
    } & Record<string, unknown>,
  ) => {
    if (!debugEnabled) return;
    const cellHeight = rectTopY - rectBottomY;
    const cellTop = pageHeight - rectTopY;
    const cellBottom = cellTop + cellHeight;
    const baselineOffset = computedDrawY - rectBottomY;
    const rowTopPdfRaw = meta?.rowTop_pdf_raw ?? rectTopY;
    const rowTopPdfDraw = meta?.rowTop_pdf_draw ?? rectTopY;
    const rowBottomPdfDraw = meta?.rowBottom_pdf_draw ?? rectBottomY;
    const cellFrameTopPdf = rowTopPdfDraw;
    const cellInnerTopPdf =
      typeof meta?.cellInnerTop_pdf === 'number'
        ? meta.cellInnerTop_pdf
        : rowTopPdfDraw - paddingY;
    console.log('[DBG_TABLE_PDF_COORDS]', {
      elementId,
      rowTop_pdf_raw: rowTopPdfRaw,
      rowTop_pdf_draw: rowTopPdfDraw,
      rowBottom_pdf_draw: rowBottomPdfDraw,
      cellFrameTop_pdf: cellFrameTopPdf,
      cellInnerTop_pdf: cellInnerTopPdf,
      paddingY,
      baselineOffset,
      textBaseline_pdf: computedDrawY,
    });
    console.log('[DBG_TABLE_CELL_PDF]', {
      elementId,
      cellTop,
      cellBottom,
      fontSize,
      lineHeight,
      computedDrawY,
      baselineOffset,
      cellPaddingY: paddingY,
      ...(meta ?? {}),
    });
  };

  const emitSubtotalIfNeeded = () => {
    if (summaryMode !== 'everyPageSubtotal+lastTotal') return;
    if (summaryStates.length === 0 || pageRowCount === 0 || subtotalRowCount === 0) return;
    warn('debug', 'summary rows', {
      tableId: element.id,
      count: summaryStates.length,
      ops: summaryStates.map((state) => state.row.op),
    });
    const ok = drawSummaryLines('subtotal', false);
    if (!ok) {
      warn('layout', 'subtotal row does not fit (should not happen)', {
        tableId: element.id,
      });
    }
    for (const state of summaryStates) {
      state.sumPageValue = 0n;
      state.sumPageScale = 0;
    }
  };

  phase = 'cell';
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      if (invalidRowWarnCount < 3) {
        warn('data', 'table row is not object', { id: element.id, rowIndex: i });
        invalidRowWarnCount += 1;
      }
      continue;
    }

    if (i === 0) {
      warn('debug', 'table row sample', {
        tableId: element.id,
        rowKeys: Object.keys(row as any),
      });
      warn('debug', 'table columns', {
        tableId: element.id,
        columns: element.columns.map((c) => ({
          id: c.id,
          fieldCode: c.fieldCode,
          title: c.title,
        })),
      });
    }


    const cells = element.columns.map((col, colIndex) => {
      const colWidth = columnWidths[colIndex] ?? transform.toPdfW(col.width);
      const maxCellWidth = Math.max(0, colWidth - (paddingLeft + paddingRight));
      const spec = normalizeColumnSpec(col);
      const rawVal = resolveFieldValue(
        col.fieldCode,
        row as Record<string, unknown>,
        previewMode,
      );
      const cellTextRaw = formatCellValue(rawVal, spec, warn, {
        tableId: element.id,
        columnId: col.id,
        fieldCode: col.fieldCode,
      });
      const fontForCell = pickFont(cellTextRaw, latinFont, jpFont);

      if (!col.fieldCode) {
        const key = col.id ?? '(unknown)';
        if (!missingFieldCodes.has(key)) {
          warn('data', 'table column fieldCode missing', { id: element.id, columnId: key });
          missingFieldCodes.add(key);
        }
      }

      const lines =
        spec.overflow === 'wrap'
          ? wrapTextToLines(cellTextRaw, fontForCell, baseFontSize, maxCellWidth)
          : [cellTextRaw];
      const maxLinesForDraw = spec.maxLines ?? lines.length;
      const linesToDraw = lines.slice(0, maxLinesForDraw);
      const lineCountForHeight = spec.overflow === 'wrap' ? linesToDraw.length : 1;

      return {
        columnId: col.id,
        fieldCode: col.fieldCode,
        colWidth,
        maxCellWidth,
        cellTextRaw,
        fontForCell,
        spec,
        linesToDraw,
        lineCountForHeight,
      };
    });

    const maxLines = Math.max(1, ...cells.map((cell) => cell.lineCountForHeight));
    const effectiveRowHeight = Math.max(
      rowHeight,
      lineHeight * maxLines + paddingY * 2,
    );

    const hasMoreRows = i < rows.length - 1;
    const remainingAfterRow = cursorY - effectiveRowHeight;

    if (
      summaryMode === 'everyPageSubtotal+lastTotal' &&
      pageRowCount > 0 &&
      subtotalRowCount > 0
    ) {
      const needsSubtotalSpace =
        hasMoreRows &&
        remainingAfterRow - subtotalRowCount * summaryRowHeight < bottomMargin;
      const needsTrailerSpace =
        !hasMoreRows &&
        trailerRowCount > 0 &&
        remainingAfterRow - trailerRowCount * summaryRowHeight < bottomMargin;

      if (needsSubtotalSpace || needsTrailerSpace) {
        emitSubtotalIfNeeded();
        pageRowCount = 0;

        currentPage = pdfDoc.addPage([pageWidth, pageHeight]);
        drawHeaderElements(
          currentPage,
          headerElements,
          data,
          previewMode,
          jpFont,
          latinFont,
          imageMap,
          resolveAdjust,
          transform,
          warn,
          debugEnabled,
          onTextBaseline,
        );

        headerY = getHeaderY();
        cursorY = headerY - headerRowGap;
        if (headerY < minHeaderY) {
          warn('layout', 'table header Y is too low for minimum layout', {
            id: element.id,
            headerY,
            minHeaderY,
          });
        }
        drawTableHeaderRow(currentPage, headerY);
      }
    }

    let rowYBottomLayout = cursorY - effectiveRowHeight;

    // 下余白を割りそうなら改ページ
    if (rowYBottomLayout < bottomMargin) {
      emitSubtotalIfNeeded();
      pageRowCount = 0;

      // 新しいページを追加
      currentPage = pdfDoc.addPage([pageWidth, pageHeight]);

      // ★ 新ページにもラベル・テキストなどのヘッダー要素を再描画
      drawHeaderElements(
        currentPage,
        headerElements,
        data,
        previewMode,
        jpFont,
        latinFont,
        imageMap,
        resolveAdjust,
        transform,
        warn,
        debugEnabled,
        onTextBaseline,
      );

      // テーブルヘッダーの位置を再計算して描画
      headerY = getHeaderY();
      cursorY = headerY - headerRowGap;

      if (headerY < minHeaderY) {
        warn('layout', 'table header Y is too low for minimum layout', {
          id: element.id,
          headerY,
          minHeaderY,
        });
      }

      drawTableHeaderRow(currentPage, headerY);

      rowYBottomLayout = cursorY - effectiveRowHeight;
    }

    const rowTopPdfRaw = rowYBottomLayout + effectiveRowHeight;
    const rowTopPdfDraw = snapPdfStroke(rowTopPdfRaw, gridBorderWidth);
    const rowYBottomDraw = rowTopPdfDraw - effectiveRowHeight;
    let currentX = originX;

    for (const cell of cells) {
      const {
        columnId,
        fieldCode,
        colWidth,
        maxCellWidth,
        cellTextRaw,
        fontForCell,
        spec,
        linesToDraw,
      } = cell;

      if (element.showGrid) {
        currentPage.drawRectangle({
          x: currentX,
          y: rowYBottomDraw,
          width: colWidth,
          height: effectiveRowHeight,
          borderColor: rgb(gridBorderGray, gridBorderGray, gridBorderGray),
          borderWidth: gridBorderWidth,
        });
      }

      const cellText = cellTextRaw.replace(/\n/g, '');
      const align = resolveColumnAlign(spec, cellText);
      const minFontSize = spec.minFontSize * transform.scaleY;
      const shouldLogTableCell = debugEnabled && i === 0 && spec.isItemName;
      const tableCellElementId = `${element.id}:row0:${columnId}`;
      const rectTopY = rowTopPdfDraw;
      const rectBottomY = rowYBottomDraw;
      const tableCellLogMeta = shouldLogTableCell
        ? (() => {
            const tableYUi = typeof element.y === 'number' ? element.y : 0;
            const rowTopUi = tableYUi + headerHeightCanvas + headerRowGapCanvas;
            const rowTopPdfFromUi = transform.toPdfTop(rowTopUi, 0);
            const rowTopPdfFinal = rowTopPdfDraw;
            const cellTopUiRaw = rowTopUi;
            const cellTopUiSnapped = snapPdfStroke(
              cellTopUiRaw,
              gridBorderWidthCanvas ?? 0,
            );
            const cellTopPdfRaw = pageHeight - rowTopPdfRaw;
            const cellTopPdfFinal = pageHeight - rectTopY;
            return {
              rowTop_ui: rowTopUi,
              rowTop_pdf_raw: rowTopPdfRaw,
              rowTop_pdf_from_ui: rowTopPdfFromUi,
              rowTop_pdf_final: rowTopPdfFinal,
              cellTop_ui_raw: cellTopUiRaw,
              cellTop_ui_snapped: cellTopUiSnapped,
              cellTop_pdf_raw: cellTopPdfRaw,
              cellTop_pdf_final: cellTopPdfFinal,
              rowTop_pdf_draw: rowTopPdfDraw,
              rowBottom_pdf_draw: rowYBottomDraw,
              cellInnerTop_pdf: rowTopPdfDraw - paddingY,
            };
          })()
        : null;
      if (shouldLogTableCell && !nudgeLogged) {
        const rowTopBefore = rowTopPdfRaw;
        const rowTopAfter = rowTopPdfDraw;
        console.log('[DBG_TABLE_PDF_NUDGE_REASON]', {
          rowIndex: i,
          rowTop_pdf_raw: rowTopBefore,
          gridBorderWidth,
          paddingY,
          nudgeBeforeClamp: rowTopAfter - rowTopBefore,
          rule: 'snapPdfStroke(rowTop, gridBorderWidth)',
        });
        console.log('[DBG_TABLE_PDF_NUDGE]', {
          rowTopBefore,
          rowTopAfter,
          nudge: rowTopAfter - rowTopBefore,
          mode: 'stroke',
        });
        nudgeLogged = true;
      }
      if (shouldLogTableCell && !rowMathLogged) {
        const tableYUi = typeof element.y === 'number' ? element.y : 0;
        const tableYPdfRaw = transform.toPdfYBox(tableYUi, headerHeightCanvas);
        const rowTopUi = tableYUi + headerHeightCanvas + headerRowGapCanvas;
        const rowTopPdfFromUi = transform.toPdfTop(rowTopUi, 0);
        const rowTopPdfFinal = rowTopPdfDraw;
        console.log('[DBG_TABLE_ROW_MATH]', {
          tableY_ui: tableYUi,
          tableY_pdf: tableYPdfRaw,
          rowIndex: i,
          rowTop_ui: rowTopUi,
          rowTop_pdf_raw: rowTopPdfRaw,
          rowTop_pdf_from_ui: rowTopPdfFromUi,
          rowTop_pdf_draw: rowTopPdfDraw,
          rowTop_pdf_final: rowTopPdfFinal,
          appliedOffsets: {
            headerHeightCanvas,
            headerHeight,
            headerRowGapCanvas,
            headerRowGap,
            rowHeightCanvas,
            effectiveRowHeight,
            gridBorderWidth,
            paddingY,
            clampHeaderY: headerY,
            cursorY,
          },
        });
        rowMathLogged = true;
      }

      if (spec.overflow === 'wrap' && maxCellWidth > 0) {
        const maxLinesByHeight = Math.floor((effectiveRowHeight - paddingY * 2) / lineHeight);
        const lines = linesToDraw.slice(0, Math.max(0, maxLinesByHeight));
        const yStart = rowYBottomDraw + effectiveRowHeight - paddingY - lineHeight;
        if (shouldLogTableCell && lines.length > 0) {
          emitTableCellBaseline(
            tableCellElementId,
            rectTopY,
            rectBottomY,
            baseFontSize,
            yStart,
            fontForCell,
          );
          emitTableCellPdfLog(
            tableCellElementId,
            rectTopY,
            rectBottomY,
            baseFontSize,
            yStart,
            tableCellLogMeta ?? undefined,
          );
        }
        for (let idx = 0; idx < lines.length; idx += 1) {
          const line = lines[idx];
          const lineWidth = fontForCell.widthOfTextAtSize(line, baseFontSize);
          const x =
            align === 'right'
              ? currentX + colWidth - paddingRight - lineWidth
              : align === 'center'
              ? currentX + (colWidth - lineWidth) / 2
              : currentX + paddingLeft;
          safeDrawText(
            currentPage,
            line,
            {
              x,
              y: yStart - idx * lineHeight,
              size: baseFontSize,
              font: fontForCell,
              color: rgb(0, 0, 0),
            },
            warn,
            { tableId: element.id, columnId, fieldCode },
          );
        }
      } else if (spec.overflow === 'ellipsis') {
        const clipped = ellipsisTextToWidth(cellText, fontForCell, baseFontSize, maxCellWidth);
        if (shouldLogTableCell && clipped) {
          const drawY = rowYBottomDraw + effectiveRowHeight / 2 - baseFontSize / 2;
          emitTableCellBaseline(
            tableCellElementId,
            rectTopY,
            rectBottomY,
            baseFontSize,
            drawY,
            fontForCell,
          );
          emitTableCellPdfLog(
            tableCellElementId,
            rectTopY,
            rectBottomY,
            baseFontSize,
            drawY,
            tableCellLogMeta ?? undefined,
          );
        }
        drawAlignedText(
          currentPage,
          clipped,
          fontForCell,
          baseFontSize,
          currentX,
          rowYBottomDraw,
          colWidth,
          effectiveRowHeight,
          align,
          paddingLeft,
          warn,
          { tableId: element.id, columnId, fieldCode },
        );
      } else if (spec.overflow === 'clip') {
        if (shouldLogTableCell && cellText) {
          const drawY = rowYBottomDraw + effectiveRowHeight / 2 - baseFontSize / 2;
          emitTableCellBaseline(
            tableCellElementId,
            rectTopY,
            rectBottomY,
            baseFontSize,
            drawY,
            fontForCell,
          );
          emitTableCellPdfLog(
            tableCellElementId,
            rectTopY,
            rectBottomY,
            baseFontSize,
            drawY,
            tableCellLogMeta ?? undefined,
          );
        }
        drawAlignedText(
          currentPage,
          cellText,
          fontForCell,
          baseFontSize,
          currentX,
          rowYBottomDraw,
          colWidth,
          effectiveRowHeight,
          align,
          paddingLeft,
          warn,
          { tableId: element.id, columnId, fieldCode },
        );
      } else {
        if (shouldLogTableCell && cellText) {
          const availableW = Math.max(0, colWidth - paddingLeft * 2);
          const shrinkFontSize = calcShrinkFontSize(
            cellText,
            fontForCell,
            baseFontSize,
            availableW,
            minFontSize,
          );
          const drawY = rowYBottomDraw + effectiveRowHeight / 2 - shrinkFontSize / 2;
          emitTableCellBaseline(
            tableCellElementId,
            rectTopY,
            rectBottomY,
            shrinkFontSize,
            drawY,
            fontForCell,
          );
          emitTableCellPdfLog(
            tableCellElementId,
            rectTopY,
            rectBottomY,
            shrinkFontSize,
            drawY,
            tableCellLogMeta ?? undefined,
          );
        }
        drawCellText(
          currentPage,
          cellText,
          fontForCell,
          baseFontSize,
          currentX,
          rowYBottomDraw,
          colWidth,
          effectiveRowHeight,
          align,
          paddingLeft,
          paddingY,
          minFontSize,
          'middle',
          rgb(0, 0, 0),
          warn,
          { tableId: element.id, columnId, fieldCode },
        );
      }

      currentX += colWidth;
    }

  if (summaryStates.length > 0) {
      phase = 'summary';
      for (const state of summaryStates) {
        if (state.row.op !== 'sum') continue;
        const rawVal = resolveFieldValue(
          state.row.fieldCode,
          row as Record<string, unknown>,
          previewMode,
        );
        const parsed = parseDecimalToScaledBigInt(rawVal, warn, {
          tableId: element.id,
          fieldCode: state.row.fieldCode,
          rowIndex: i,
        });
        if (!parsed) {
          continue;
        }
        const grandNext = addScaledValue(
          state.sumGrandValue,
          state.sumGrandScale,
          parsed,
        );
        state.sumGrandValue = grandNext.value;
        state.sumGrandScale = grandNext.scale;
        const pageNext = addScaledValue(
          state.sumPageValue,
          state.sumPageScale,
          parsed,
        );
        state.sumPageValue = pageNext.value;
        state.sumPageScale = pageNext.scale;
      }
    }
    if (needsFallbackTotal && amountFieldCode) {
      const rawVal = resolveFieldValue(
        amountFieldCode,
        row as Record<string, unknown>,
        previewMode,
      );
      const parsed = parseDecimalToScaledBigInt(rawVal, warn, {
        tableId: element.id,
        fieldCode: amountFieldCode,
        rowIndex: i,
      });
      if (parsed) {
        const next = addScaledValue(
          fallbackGrandTotalValue,
          fallbackGrandTotalScale,
          parsed,
        );
        fallbackGrandTotalValue = next.value;
        fallbackGrandTotalScale = next.scale;
      }
    }

    cursorY = rowYBottomLayout;
    pageRowCount += 1;
  }

  if (data && rows.length > 0) {
    const computedTotal =
      sumStateForTotal
        ? { value: sumStateForTotal.sumGrandValue, scale: sumStateForTotal.sumGrandScale }
        : needsFallbackTotal
        ? { value: fallbackGrandTotalValue, scale: fallbackGrandTotalScale }
        : null;
    if (computedTotal !== null) {
      const formattedTotal = formatScaledBigInt(computedTotal.value, computedTotal.scale);
      const record = data as Record<string, unknown>;
      if (!('TotalAmount' in record)) {
        record.TotalAmount = formattedTotal;
      }
      const computed =
        record.__computed && typeof record.__computed === 'object'
          ? { ...(record.__computed as Record<string, unknown>) }
          : {};
      computed.grandTotal = formattedTotal;
      record.__computed = computed;
    }
  }

  if (summaryStates.length > 0 && labelColumn) {
    warn('debug', 'summary rows', {
      tableId: element.id,
      count: summaryStates.length,
      ops: summaryStates.map((state) => state.row.op),
    });
    if (summaryMode === 'everyPageSubtotal+lastTotal') {
      const subtotalRows = getSummaryRows('subtotal');
      const totalRows = getSummaryRows('total');
      const totalCount = subtotalRows.length + totalRows.length;

      if (totalCount > 0) {
        const hasSpace = ensureSummarySpace(totalCount, true);
        if (!hasSpace) {
          warn('layout', 'summary rows do not fit', { tableId: element.id });
        }
        for (const state of subtotalRows) {
          warn('debug', 'summary row', {
            tableId: element.id,
            rowIndex: state.index,
            op: state.row.op,
            label: state.row.label ?? null,
            columnId: state.row.columnId,
          });
          drawSummaryRow(state, 'subtotal');
        }
        for (const state of totalRows) {
          warn('debug', 'summary row', {
            tableId: element.id,
            rowIndex: state.index,
            op: state.row.op,
            label: state.row.label ?? null,
            columnId: state.row.columnId,
          });
          drawSummaryRow(state, 'total');
        }
        for (const state of summaryStates) {
          state.sumPageValue = 0n;
          state.sumPageScale = 0;
        }
      }
    } else if (summaryMode === 'lastPageOnly') {
      const rowsToDraw = summaryStates;
      if (rowsToDraw.length > 0) {
        const hasSpace = ensureSummarySpace(rowsToDraw.length, true);
        if (!hasSpace) {
          warn('layout', 'summary rows do not fit', { tableId: element.id });
        }
        for (const state of rowsToDraw) {
          warn('debug', 'summary row', {
            tableId: element.id,
            rowIndex: state.index,
            op: state.row.op,
            label: state.row.label ?? null,
            columnId: state.row.columnId,
          });
          drawSummaryRow(state, 'total');
        }
      }
    }
  }

  return currentPage;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `[renderTable] template=${templateId} element=${element.id} phase=${phase} error=${message}`,
    );
  }
}

// ============================
// Card list
// ============================

function drawCardList(
  pdfDoc: PDFDocument,
  page: PDFPage,
  element: CardListElement,
  jpFont: PDFFont,
  latinFont: PDFFont,
  data: TemplateDataRecord | undefined,
  previewMode: PreviewMode,
  headerElements: TemplateElement[],
  footerReserveHeight: number,
  imageMap: Map<string, PDFImage>,
  resolveAdjust: (element: TemplateElement) => { fontScale: number; pagePadding: number; hidden: boolean },
  transform: PdfTransform,
  warn: WarnFn,
  debugEnabled = false,
  onTextBaseline?: (entry: TextBaselineDebug) => void,
  layoutVariant?: "compact_v2",
): PDFPage {
  const isCompactV2 = layoutVariant === "compact_v2";
  const pageWidth = transform.pageWidthPt;
  const pageHeight = transform.pageHeightPt;
  const strokeScale = Math.min(transform.scaleX, transform.scaleY);
  const cardHeightCanvas = element.cardHeight ?? 86;
  const gapYCanvas = element.gapY ?? 14;
  const paddingCanvas = element.padding ?? 12;
  const borderWidthCanvas = element.borderWidth ?? 0;
  const borderGray = element.borderColorGray ?? 0.85;
  const fillGray = element.fillGray ?? 0.93;
  const cornerRadiusCanvas = element.cornerRadius ?? 8;

  if (!Number.isFinite(cardHeightCanvas) || cardHeightCanvas <= 0) {
    warn('layout', 'cardHeight is invalid', { id: element.id, cardHeight: cardHeightCanvas });
    return page;
  }

  const { pagePadding } = resolveAdjust(element);
  const cardWidthBase = element.width ?? 520;
  const cardWidthCanvas = isCompactV2 ? 430 : cardWidthBase;
  const originXCanvas = isCompactV2
    ? Math.max(0, (transform.canvasWidth - cardWidthCanvas) / 2)
    : resolveAlignedX(element, transform.canvasWidth, cardWidthCanvas, pagePadding);
  const cardWidth = transform.toPdfW(cardWidthCanvas);
  const cardHeight = transform.toPdfH(cardHeightCanvas);
  const gapY = transform.toPdfH(gapYCanvas);
  const paddingX = transform.toPdfW(paddingCanvas);
  const paddingY = transform.toPdfH(paddingCanvas);
  const borderWidth = borderWidthCanvas * strokeScale;
  const cornerRadius = cornerRadiusCanvas * strokeScale;
  const originX = transform.toPdfX(originXCanvas);
  const bottomMargin = footerReserveHeight + 40;

  const rawRows =
    data &&
    element.dataSource &&
    element.dataSource.type === 'kintoneSubtable'
      ? (data as any)[element.dataSource.fieldCode]
      : undefined;
  const rows = Array.isArray(rawRows) ? rawRows : [];
  if (rawRows !== undefined && !Array.isArray(rawRows)) {
    warn('data', 'cardList rows is not array', {
      id: element.id,
      fieldCode: element.dataSource?.fieldCode,
    });
  }

  let rowsToRender = rows;
  if (rowsToRender.length === 0) {
    const sampleValuesById: Record<string, string[]> = {
      fieldA: [
        'サンプル品名 ABC-12345 長いテキスト (sample)',
        'サンプル品名 XYZ-888 (sample)',
        'サンプル品名 QWE-77 (sample)',
      ],
      fieldB: ['120', '98', '64'],
      fieldC: ['カテゴリA', 'カテゴリA', 'カテゴリA'],
      fieldD: ['34.52', '18.4', '12.0'],
      fieldE: ['SKU-01', 'SKU-02', 'SKU-03'],
      fieldF: ['4142.4', '303.2', '999.0'],
    };

    rowsToRender = Array.from({ length: 3 }, (_, index) => {
      const row: Record<string, unknown> = {
        __placeholder: true,
        __index: index,
      };
      for (const field of element.fields) {
        if (!field.fieldCode) continue;
        const values = sampleValuesById[field.id] ?? [''];
        const sample = values[index % values.length];
        if (sample) {
          row[field.fieldCode] = sample;
        }
      }
      return row;
    });
    warn('data', 'cardList rows empty; using placeholder rows', { id: element.id });
  }

  const startTopY = clampPdfY(
    transform.toPdfTop(element.y, cardHeightCanvas),
    pageHeight - 5,
  );
  const innerWidth = Math.max(0, cardWidth - paddingX * 2);
  const innerHeight = Math.max(0, cardHeight - paddingY * 2);
  const leftWidth = Math.round(innerWidth * 0.72);
  const rightWidth = Math.max(0, innerWidth - leftWidth);
  const compactLeftWidth = Math.round(innerWidth * 0.55);
  const compactRightWidth = Math.max(0, innerWidth - compactLeftWidth);
  const compactRightColWidth = Math.round(compactRightWidth * 0.5);

  const fieldsById = new Map(element.fields.map((field) => [field.id, field]));
  const activeFieldIds = element.fields
    .filter((field) => !!field.fieldCode)
    .map((field) => field.id);
  const compactFieldIds = ["fieldA", "fieldB", "fieldC", "fieldD", "fieldE"] as const;
  const activeCompactIds = isCompactV2
    ? activeFieldIds.filter((id) => compactFieldIds.includes(id as any))
    : activeFieldIds;

  const getFieldSpec = (fieldId: string) => {
    const field = fieldsById.get(fieldId);
    const isPrimary = fieldId === 'fieldA';
    return {
      field,
      spec: {
        align: field?.align,
        overflow: isPrimary ? 'wrap' : 'ellipsis',
        minFontSize: MIN_FONT_SIZE,
        maxLines: isPrimary ? undefined : 1,
        formatter: undefined,
        isItemName: isPrimary,
      } as NormalizedColumnSpec,
    };
  };

  const hasValue = (value: unknown) =>
    value === 0 ? true : !!String(value ?? '').trim();
  const cellPaddingY = 2 * transform.scaleY;

  const drawFieldText = (
    targetPage: PDFPage,
    row: Record<string, unknown>,
    fieldId: string,
    box: { x: number; y: number; w: number; h: number },
    fontSize: number,
  ) => {
    const { field, spec } = getFieldSpec(fieldId);
    const fieldCode = field?.fieldCode;
    const isPlaceholderRow = (row as any).__placeholder === true;
    const rawVal: unknown = resolveFieldValue(
      fieldCode,
      row as Record<string, unknown>,
      previewMode,
    );
    const text = formatCellValue(rawVal, spec, warn, {
      cardId: element.id,
      fieldId,
      fieldCode,
    });
    if (!text) return;

    const font = pickFont(text, latinFont, jpFont);
    const textColor = isPlaceholderRow
      ? rgb(0.35, 0.35, 0.35)
      : fieldId === 'fieldA'
      ? rgb(0, 0, 0)
      : rgb(0.25, 0.25, 0.25);
    if (fieldId === 'fieldA') {
      const maxWidth = Math.max(0, box.w);
      const lineHeight = fontSize * 1.2;
      const maxLines = Math.max(1, Math.floor(box.h / lineHeight));
      const lines = wrapTextToLines(text, font, fontSize, maxWidth);
      drawMultilineText(
        targetPage,
        lines,
        box.x,
        box.y + box.h - fontSize,
        font,
        fontSize,
        textColor,
        maxLines,
        lineHeight,
        'normal',
        'left',
        maxWidth,
        warn,
        { cardId: element.id, fieldId, fieldCode },
      );
      return;
    }

    const align = resolveColumnAlign(spec, text);
    const minFontSize = spec.minFontSize * transform.scaleY;
    drawCellText(
      targetPage,
      text,
      font,
      fontSize,
      box.x,
      box.y,
      box.w,
      box.h,
      align,
      paddingX,
      cellPaddingY,
      minFontSize,
      'top',
      textColor,
      warn,
      { cardId: element.id, fieldId, fieldCode },
    );
  };

  if (activeCompactIds.length === 0) {
    warn('layout', 'cardList has no active fields', { id: element.id });
    return page;
  }

  let currentPage = page;
  let cardTopY = startTopY;

  const ensureCardSpace = () => {
    if (cardTopY - cardHeight >= bottomMargin) return;
    currentPage = pdfDoc.addPage([pageWidth, pageHeight]);
    drawHeaderElements(
      currentPage,
      headerElements,
      data,
      previewMode,
      jpFont,
      latinFont,
      imageMap,
      resolveAdjust,
      transform,
      warn,
      debugEnabled,
      onTextBaseline,
    );
    cardTopY = startTopY;
  };

  ensureCardSpace();
  if (cardTopY - cardHeight < bottomMargin) {
    warn('layout', 'cardList does not fit into page', {
      id: element.id,
      cardHeight,
      bottomMargin,
    });
  }

  for (let i = 0; i < rowsToRender.length; i++) {
    const row = rowsToRender[i];
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      warn('data', 'cardList row is not object', { id: element.id, rowIndex: i });
      continue;
    }

    ensureCardSpace();

    if (!isCompactV2) {
      const shadowOffset = 3 * strokeScale;
      const shadowOptions: any = {
        x: originX + shadowOffset,
        y: cardTopY - cardHeight - shadowOffset,
        width: cardWidth,
        height: cardHeight,
        color: rgb(0.8, 0.8, 0.8),
      };
      if (cornerRadius > 0) {
        shadowOptions.borderRadius = cornerRadius;
      }
      currentPage.drawRectangle(shadowOptions);
    }

    const rectOptions: any = {
      x: originX,
      y: cardTopY - cardHeight,
      width: cardWidth,
      height: cardHeight,
      borderColor: rgb(borderGray, borderGray, borderGray),
      borderWidth,
      color: rgb(fillGray, fillGray, fillGray),
    };
    if (cornerRadius > 0) {
      rectOptions.borderRadius = cornerRadius;
    }
    currentPage.drawRectangle(rectOptions);

    const innerLeft = originX + paddingX;
    const innerTop = cardTopY - paddingY;
    const mode = isCompactV2
      ? activeCompactIds.length === 1
        ? 'single'
        : 'compact'
      : activeFieldIds.length === 1
      ? 'single'
      : activeFieldIds.length <= 3
      ? 'compact'
      : 'full';

    if (mode === 'single') {
      const singleFieldId = (isCompactV2 ? activeCompactIds[0] : activeFieldIds[0]) ?? 'fieldA';
      const { field, spec } = getFieldSpec(singleFieldId);
      const fieldCode = field?.fieldCode;
      const rawVal: unknown = resolveFieldValue(
        fieldCode,
        row as Record<string, unknown>,
        previewMode,
      );
      if (hasValue(rawVal)) {
        const text = formatCellValue(rawVal, spec, warn, {
          cardId: element.id,
          fieldId: singleFieldId,
          fieldCode,
        });
        if (text) {
          const isPlaceholderRow = (row as any).__placeholder === true;
          const textColor = isPlaceholderRow ? rgb(0.35, 0.35, 0.35) : rgb(0, 0, 0);
          const font = pickFont(text, latinFont, jpFont);
          if (isCompactV2) {
            const fontSize = 14 * transform.scaleY;
            const lineHeight = fontSize * 1.28;
            const maxLines = Math.min(2, Math.max(1, Math.floor(innerHeight / lineHeight)));
            const blockHeight = maxLines * lineHeight;
            const startY = innerTop - Math.max(0, (innerHeight - blockHeight) / 2);
            const lines = wrapTextToLines(text, font, fontSize, innerWidth);
            drawMultilineText(
              currentPage,
              lines,
              innerLeft,
              startY,
              font,
              fontSize,
              textColor,
              maxLines,
              lineHeight,
            );
            drawMultilineText(
              currentPage,
              lines,
              innerLeft + 0.3 * strokeScale,
              startY,
              font,
              fontSize,
              textColor,
              maxLines,
              lineHeight,
            );
          } else {
            const fontSize = 16 * transform.scaleY;
            const lineHeight = fontSize * 1.3;
            const maxLines = Math.max(1, Math.floor(innerHeight / lineHeight));
            const lines = wrapTextToLines(text, font, fontSize, innerWidth);
            drawMultilineText(
              currentPage,
              lines,
              innerLeft,
              cardTopY - paddingY - 10 * transform.scaleY,
              font,
              fontSize,
              textColor,
              maxLines,
              lineHeight,
            );
            drawMultilineText(
              currentPage,
              lines,
              innerLeft + 0.35 * strokeScale,
              cardTopY - paddingY - 10 * transform.scaleY,
              font,
              fontSize,
              textColor,
              maxLines,
              lineHeight,
            );
          }
        }
      }
    } else if (mode === 'compact') {
      if (isCompactV2) {
        const titleFieldId = activeCompactIds.includes("fieldA") ? "fieldA" : activeCompactIds[0];
        const subFieldId = activeCompactIds.includes("fieldE")
          ? "fieldE"
          : activeCompactIds.includes("fieldB")
          ? "fieldB"
          : null;
        const titleTextField = getFieldSpec(titleFieldId ?? "fieldA");
        const titleFieldCode = titleTextField.field?.fieldCode;
        const titleRaw = resolveFieldValue(
          titleFieldCode,
          row as Record<string, unknown>,
          previewMode,
        );
        const titleText = hasValue(titleRaw)
          ? formatCellValue(titleRaw, titleTextField.spec, warn, {
              cardId: element.id,
              fieldId: titleFieldId,
              fieldCode: titleFieldCode,
            })
          : "";
        const isPlaceholderRow = (row as any).__placeholder === true;
        const titleColor = isPlaceholderRow ? rgb(0.35, 0.35, 0.35) : rgb(0, 0, 0);
        const subColor = isPlaceholderRow ? rgb(0.4, 0.4, 0.4) : rgb(0.25, 0.25, 0.25);

        if (titleText) {
          const titleFontSize = 13 * transform.scaleY;
          const titleLineHeight = titleFontSize * 1.25;
          const titleFont = pickFont(titleText, latinFont, jpFont);
          const lines = wrapTextToLines(titleText, titleFont, titleFontSize, innerWidth);
          drawMultilineText(
            currentPage,
            lines,
            innerLeft,
            innerTop - 2 * transform.scaleY,
            titleFont,
            titleFontSize,
            titleColor,
            2,
            titleLineHeight,
          );
          drawMultilineText(
            currentPage,
            lines,
            innerLeft + 0.3 * strokeScale,
            innerTop - 2 * transform.scaleY,
            titleFont,
            titleFontSize,
            titleColor,
            2,
            titleLineHeight,
          );
        }

        const innerBottom = cardTopY - cardHeight + paddingY;
        const subRowHeight = 12 * transform.scaleY;
        if (subFieldId) {
          const { field, spec } = getFieldSpec(subFieldId);
          const fieldCode = field?.fieldCode;
          const rawVal: unknown = resolveFieldValue(
            fieldCode,
            row as Record<string, unknown>,
            previewMode,
          );
          if (hasValue(rawVal)) {
            const text = formatCellValue(rawVal, spec, warn, {
              cardId: element.id,
              fieldId: subFieldId,
              fieldCode,
            });
            if (text) {
              const font = pickFont(text, latinFont, jpFont);
              const minFontSize = spec.minFontSize * transform.scaleY;
              drawCellText(
                currentPage,
                text,
                font,
                9 * transform.scaleY,
                innerLeft,
                innerBottom,
                compactLeftWidth,
                subRowHeight,
                "left",
                paddingX,
                cellPaddingY,
                minFontSize,
                "top",
                subColor,
              );
            }
          }
        }

        const drawRightNumber = (fieldId: string, x: number, width: number) => {
          const { field, spec } = getFieldSpec(fieldId);
          const fieldCode = field?.fieldCode;
          const rawVal: unknown = resolveFieldValue(
            fieldCode,
            row as Record<string, unknown>,
            previewMode,
          );
          if (!hasValue(rawVal)) return;
          const text = formatCellValue(rawVal, spec, warn, {
            cardId: element.id,
            fieldId,
            fieldCode,
          });
          if (!text) return;
          const font = pickFont(text, latinFont, jpFont);
          const align = resolveColumnAlign(spec, text);
          const minFontSize = spec.minFontSize * transform.scaleY;
          drawCellText(
            currentPage,
            text,
            font,
            10 * transform.scaleY,
            x,
            innerBottom,
            width,
            subRowHeight,
            align,
            paddingX,
            cellPaddingY,
            minFontSize,
            "top",
            subColor,
          );
        };

        drawRightNumber("fieldC", innerLeft + compactLeftWidth, compactRightColWidth);
        drawRightNumber(
          "fieldD",
          innerLeft + compactLeftWidth + compactRightColWidth,
          compactRightWidth - compactRightColWidth,
        );
      } else {
        const titleFieldId = activeFieldIds.includes('fieldA')
          ? 'fieldA'
          : activeFieldIds[0] ?? 'fieldA';
        const secondaryIds = activeFieldIds.filter((id) => id !== titleFieldId);
        const presentSecondary = secondaryIds.filter((id) => {
          const field = fieldsById.get(id);
          const fieldCode = field?.fieldCode;
          const rawVal: unknown = resolveFieldValue(
            fieldCode,
            row as Record<string, unknown>,
            previewMode,
          );
          return hasValue(rawVal);
        });
        const titleHeight = Math.max(24 * transform.scaleY, Math.round(innerHeight * 0.6));
        const lineGap = 4 * transform.scaleY;
        const secondaryArea = Math.max(0, innerHeight - titleHeight - lineGap);
        const secondaryCount = Math.max(1, presentSecondary.length);
        const blockHeight = Math.max(12 * transform.scaleY, Math.floor(secondaryArea / secondaryCount));

        drawFieldText(
          currentPage,
          row as Record<string, unknown>,
          titleFieldId,
          { x: innerLeft, y: innerTop - titleHeight, w: leftWidth, h: titleHeight },
          14 * transform.scaleY,
        );

        let rightY = innerTop - titleHeight - lineGap;
        for (const fieldId of presentSecondary) {
          drawFieldText(
            currentPage,
            row as Record<string, unknown>,
            fieldId,
            { x: innerLeft + leftWidth, y: rightY - blockHeight, w: rightWidth, h: blockHeight },
            10 * transform.scaleY,
          );
          rightY -= blockHeight + lineGap;
        }
      }
    } else {
      const topHeight = Math.round(innerHeight * 0.55);
      const midHeight = Math.round(innerHeight * 0.25);
      const bottomHeight = Math.max(0, innerHeight - topHeight - midHeight);

      const topRowBottom = innerTop - topHeight;
      const midRowBottom = topRowBottom - midHeight;
      const bottomRowBottom = midRowBottom - bottomHeight;

      drawFieldText(
        currentPage,
        row as Record<string, unknown>,
        'fieldA',
        { x: innerLeft, y: topRowBottom, w: leftWidth, h: topHeight },
        14 * transform.scaleY,
      );
      drawFieldText(
        currentPage,
        row as Record<string, unknown>,
        'fieldB',
        { x: innerLeft + leftWidth, y: topRowBottom, w: rightWidth, h: topHeight },
        10 * transform.scaleY,
      );
      drawFieldText(
        currentPage,
        row as Record<string, unknown>,
        'fieldC',
        { x: innerLeft, y: midRowBottom, w: leftWidth, h: midHeight },
        10 * transform.scaleY,
      );
      drawFieldText(
        currentPage,
        row as Record<string, unknown>,
        'fieldD',
        { x: innerLeft + leftWidth, y: midRowBottom, w: rightWidth, h: midHeight },
        10 * transform.scaleY,
      );
      drawFieldText(
        currentPage,
        row as Record<string, unknown>,
        'fieldE',
        { x: innerLeft, y: bottomRowBottom, w: leftWidth, h: bottomHeight },
        9 * transform.scaleY,
      );
      drawFieldText(
        currentPage,
        row as Record<string, unknown>,
        'fieldF',
        { x: innerLeft + leftWidth, y: bottomRowBottom, w: rightWidth, h: bottomHeight },
        9 * transform.scaleY,
      );
    }

    cardTopY = cardTopY - cardHeight - gapY;
  }

  return currentPage;
}

function drawImageElement(
  page: PDFPage,
  element: ImageElement,
  jpFont: PDFFont,
  latinFont: PDFFont,
  data: TemplateDataRecord | undefined,
  previewMode: PreviewMode,
  pagePadding: number,
  imageMap: Map<string, PDFImage>,
  transform: PdfTransform,
  warn: WarnFn,
) {
  const slotId = (element as any).slotId as string | undefined;
  const isLogo = slotId === 'logo' || element.id === 'logo';
  if (isLogo) {
    const staticValue =
      element.dataSource?.type === 'static'
        ? String(element.dataSource.value ?? '').trim()
        : '';
    const kintoneField =
      element.dataSource?.type === 'kintone'
        ? String(element.dataSource.fieldCode ?? '').trim()
        : '';
    if (!staticValue && !kintoneField) {
      return;
    }
  }
  if (previewMode === 'fieldCode') {
    const fieldCode =
      element.dataSource?.type === 'kintone' ? element.dataSource.fieldCode : '';
    drawImagePlaceholderWithFieldCode(
      page,
      element,
      jpFont,
      latinFont,
      pagePadding,
      transform,
      fieldCode,
      warn,
    );
    return;
  }

  const url = resolveDataSource(
    element.dataSource,
    data,
    previewMode,
    warn,
    { elementId: element.id },
  );
  if (!url || !isHttpUrl(url)) {
    drawImagePlaceholder(page, element, jpFont, latinFont, pagePadding, transform, warn);
    return;
  }

  const embedded = imageMap.get(url);
  if (!embedded) {
    drawImagePlaceholder(page, element, jpFont, latinFont, pagePadding, transform, warn);
    return;
  }

  const widthCanvas =
    typeof element.width === 'number' ? element.width : embedded.width / transform.scaleX;
  const heightCanvas =
    typeof element.height === 'number' ? element.height : embedded.height / transform.scaleY;
  const width = transform.toPdfW(widthCanvas);
  const height = transform.toPdfH(heightCanvas);
  let pdfY = transform.toPdfYBox(element.y, heightCanvas);
  pdfY = clampPdfY(pdfY, transform.pageHeightPt - height);

  const { width: imgW, height: imgH } = embedded.size();
  const fitMode = element.fitMode ?? 'fit';

  let drawWidth = width;
  let drawHeight = height;

  if (fitMode === 'fit') {
    const scale = Math.min(width / imgW, height / imgH);
    drawWidth = imgW * scale;
    drawHeight = imgH * scale;
  }

  const drawXCanvas = resolveAlignedX(element, transform.canvasWidth, widthCanvas, pagePadding);
  const drawX = transform.toPdfX(drawXCanvas);

  page.drawImage(embedded, {
    x: drawX,
    y: pdfY,
    width: drawWidth,
    height: drawHeight,
  });
}


// ============================
// Image placeholder（まだ枠だけ）
// ============================

function drawImagePlaceholder(
  page: PDFPage,
  element: ImageElement,
  jpFont: PDFFont,
  latinFont: PDFFont,
  pagePadding: number,
  transform: PdfTransform,
  warn?: WarnFn,
) {
  const widthCanvas = element.width ?? 120;
  const heightCanvas = element.height ?? 80;
  const width = transform.toPdfW(widthCanvas);
  const height = transform.toPdfH(heightCanvas);
  const strokeScale = Math.min(transform.scaleX, transform.scaleY);

  let pdfY = transform.toPdfYBox(element.y, heightCanvas);
  pdfY = clampPdfY(pdfY, transform.pageHeightPt - height);

  const drawXCanvas = resolveAlignedX(element, transform.canvasWidth, widthCanvas, pagePadding);
  const drawX = transform.toPdfX(drawXCanvas);

  page.drawRectangle({
    x: drawX,
    y: pdfY,
    width,
    height,
    borderColor: rgb(0.5, 0.5, 0.5),
    borderWidth: 1 * strokeScale,
  });

  const labelText = 'IMAGE';
  const labelFont = pickFont(labelText, latinFont, jpFont);
  const labelSize = 10 * transform.scaleY;
  safeDrawText(
    page,
    labelText,
    {
      x: drawX + 8 * transform.scaleX,
      y: pdfY + height / 2 - 6 * transform.scaleY,
      size: labelSize,
      font: labelFont,
      color: rgb(0.4, 0.4, 0.4),
    },
    warn,
    { elementId: element.id },
  );
}

function drawImagePlaceholderWithFieldCode(
  page: PDFPage,
  element: ImageElement,
  jpFont: PDFFont,
  latinFont: PDFFont,
  pagePadding: number,
  transform: PdfTransform,
  fieldCode?: string,
  warn?: WarnFn,
) {
  const widthCanvas = element.width ?? 120;
  const heightCanvas = element.height ?? 80;
  const width = transform.toPdfW(widthCanvas);
  const height = transform.toPdfH(heightCanvas);
  const strokeScale = Math.min(transform.scaleX, transform.scaleY);

  let pdfY = transform.toPdfYBox(element.y, heightCanvas);
  pdfY = clampPdfY(pdfY, transform.pageHeightPt - height);

  const drawXCanvas = resolveAlignedX(element, transform.canvasWidth, widthCanvas, pagePadding);
  const drawX = transform.toPdfX(drawXCanvas);

  page.drawRectangle({
    x: drawX,
    y: pdfY,
    width,
    height,
    borderColor: rgb(0.5, 0.5, 0.5),
    borderWidth: 1 * strokeScale,
  });

  const centerX = drawX + width / 2;
  const centerY = pdfY + height / 2;
  const lineHeight = 10 * transform.scaleY;

  const labelText = 'IMAGE';
  const labelFont = pickFont(labelText, latinFont, jpFont);
  const labelSize = 9 * transform.scaleY;
  const labelOffsetX = 18 * transform.scaleX;
  safeDrawText(
    page,
    labelText,
    {
      x: centerX - labelOffsetX,
      y: centerY + lineHeight / 2 - 4 * transform.scaleY,
      size: labelSize,
      font: labelFont,
      color: rgb(0.4, 0.4, 0.4),
    },
    warn,
    { elementId: element.id },
  );

  if (fieldCode) {
    const codeFont = pickFont(fieldCode, latinFont, jpFont);
    const codeSize = 8 * transform.scaleY;
    const codeOffsetX = fieldCode.length * 2.5 * transform.scaleX;
    safeDrawText(
      page,
      fieldCode,
      {
        x: centerX - codeOffsetX,
        y: centerY - lineHeight / 2 - 6 * transform.scaleY,
        size: codeSize,
        font: codeFont,
        color: rgb(0.4, 0.4, 0.4),
      },
      warn,
      { elementId: element.id, fieldCode },
    );
  }
}

export const renderLabelCalibrationPdf = async (
  settings: LabelSheetSettings,
): Promise<{ bytes: Uint8Array }> => {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const sheet = normalizeLabelSheetSettings(settings, () => undefined);
  const layout = buildLabelGridLayout(sheet, () => undefined);
  if (!layout) {
    return { bytes: await pdfDoc.save() };
  }
  const pageWidth = layout.pageWidthPt;
  const pageHeight = layout.pageHeightPt;
  const page = pdfDoc.addPage([pageWidth, pageHeight]);

  const marginPt = mmToPt(sheet.marginMm);
  const labelWPt = layout.labelWPt;
  const labelHPt = layout.labelHPt;

  page.drawRectangle({
    x: 0,
    y: 0,
    width: pageWidth,
    height: pageHeight,
    borderColor: rgb(0.4, 0.4, 0.4),
    borderWidth: 0.8,
  });

  const crossSize = mmToPt(4);
  for (let row = 0; row < sheet.rows; row += 1) {
    for (let col = 0; col < sheet.cols; col += 1) {
      const index = row * sheet.cols + col;
      const rect = layout.getCellRect(index);
      const cellX = rect.x;
      const cellY = rect.y;

      page.drawRectangle({
        x: cellX,
        y: cellY,
        width: labelWPt,
        height: labelHPt,
        borderColor: rgb(0.8, 0.8, 0.8),
        borderWidth: 0.5,
      });

      const crossX = cellX + labelWPt / 2;
      const crossY = cellY + labelHPt / 2;
      page.drawLine({
        start: { x: crossX - crossSize, y: crossY },
        end: { x: crossX + crossSize, y: crossY },
        thickness: 0.5,
        color: rgb(0.3, 0.3, 0.3),
      });
      page.drawLine({
        start: { x: crossX, y: crossY - crossSize },
        end: { x: crossX, y: crossY + crossSize },
        thickness: 0.5,
        color: rgb(0.3, 0.3, 0.3),
      });
    }
  }

  const scaleLen = mmToPt(10);
  const scaleX = marginPt;
  const scaleY = pageHeight - marginPt + mmToPt(2);
  page.drawLine({
    start: { x: scaleX, y: scaleY },
    end: { x: scaleX + scaleLen, y: scaleY },
    thickness: 0.6,
    color: rgb(0.3, 0.3, 0.3),
  });
  page.drawLine({
    start: { x: scaleX, y: scaleY },
    end: { x: scaleX, y: scaleY - scaleLen },
    thickness: 0.6,
    color: rgb(0.3, 0.3, 0.3),
  });
  safeDrawText(page, '10mm', {
    x: scaleX + scaleLen + 2,
    y: scaleY - 4,
    size: 8,
    font,
    color: rgb(0.35, 0.35, 0.35),
  });

  page.drawLine({
    start: { x: marginPt, y: pageHeight - marginPt },
    end: { x: marginPt + mmToPt(40), y: pageHeight - marginPt },
    thickness: 0.3,
    color: rgb(0.75, 0.75, 0.75),
  });
  page.drawLine({
    start: { x: marginPt, y: pageHeight - marginPt },
    end: { x: marginPt, y: pageHeight - marginPt - mmToPt(40) },
    thickness: 0.3,
    color: rgb(0.75, 0.75, 0.75),
  });

  const bytes = await pdfDoc.save();
  return { bytes };
};
