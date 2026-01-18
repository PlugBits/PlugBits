import { PDFDocument, rgb, type PDFPage, type PDFFont } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {
  CANVAS_HEIGHT,
  type TemplateDefinition,
  type TemplateElement,
  type TextElement,
  type LabelElement,
  type TableElement,
  type SummaryRow,
  type ImageElement,
  type TemplateDataRecord,
  type DataSource,
  type PageSize,
} from '../../../shared/template.js';
import type { PDFImage } from 'pdf-lib'; // 先頭の import に追加

const isHttpUrl = (value: string) => /^https?:\/\//i.test(value);
type WarnCategory = 'debug' | 'data' | 'layout' | 'image' | 'number';
type WarnFn = (
  category: WarnCategory,
  message: string,
  context?: Record<string, unknown>,
) => void;
const MAX_TEXT_LENGTH = 200;

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
) => {
  const limit = Math.min(lines.length, Math.max(0, maxLines));
  for (let idx = 0; idx < limit; idx += 1) {
    page.drawText(lines[idx], {
      x,
      y: yStart - idx * lineHeight,
      size: fontSize,
      font,
      color,
    });
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
  minFontSize = MIN_FONT_SIZE,
) => {
  const availableW = Math.max(0, cellW - CELL_PADDING_X * 2);
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
      ? cellX + cellW - CELL_PADDING_X - textW
      : align === 'center'
      ? cellX + (cellW - textW) / 2
      : cellX + CELL_PADDING_X;

  const y = cellY + cellH / 2 - fontSize / 2;

  page.drawText(text, { x, y, size: fontSize, font, color: rgb(0, 0, 0) });
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
) => {
  const textW = font.widthOfTextAtSize(text, fontSize);
  const x =
    align === 'right'
      ? cellX + cellW - CELL_PADDING_X - textW
      : align === 'center'
      ? cellX + (cellW - textW) / 2
      : cellX + CELL_PADDING_X;
  const y = cellY + cellH / 2 - fontSize / 2;

  page.drawText(text, { x, y, size: fontSize, font, color: rgb(0, 0, 0) });
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
  warn: WarnFn,
): Promise<Map<string, PDFImage>> {
  const map = new Map<string, PDFImage>();

  const imageElements = template.elements.filter(
    (e) => e.type === 'image',
  ) as ImageElement[];

  const urls = Array.from(
    new Set(
      imageElements
        .map((e) => resolveDataSource(e.dataSource, data, warn, { elementId: e.id }))
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

/**
 * ページサイズ定義
 */
const PAGE_DIMENSIONS: Record<
  PageSize,
  { portrait: [number, number]; landscape: [number, number] }
> = {
  A4: {
    // ざっくり A4（もともとの値と同じくらい）
    portrait: [595.28, 841.89],
    landscape: [841.89, 595.28],
  },
  Letter: {
    portrait: [612, 792],
    landscape: [792, 612],
  },
};

/**
 * テンプレートからページ幅・高さを決定
 */
function getPageSize(template: TemplateDefinition): [number, number] {
  const dims = PAGE_DIMENSIONS[template.pageSize] ?? PAGE_DIMENSIONS.A4;
  return template.orientation === 'landscape'
    ? dims.landscape
    : dims.portrait;
}

/**
 * UI の Y（bottom基準） → PDF の Y（bottom基準）に変換
 */
function toPdfYFromBottom(uiBottomY: number, pageHeight: number): number {
  const scale = pageHeight / CANVAS_HEIGHT;
  return uiBottomY * scale;
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

  if (!data) return '';

  // kintone / kintoneSubtable 系
  if ('fieldCode' in source && source.fieldCode) {
    const value = data[source.fieldCode];
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
  options?: { debug?: boolean },
): Promise<{ bytes: Uint8Array; warnings: string[] }> {
  const warnings = new Set<string>();
  const debugEnabled = options?.debug === true;
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

  const [pageWidth, pageHeight] = getPageSize(template);
  const renderData = data ? structuredClone(data) : undefined;
  const imageMap = await preloadImages(pdfDoc, template, renderData, warn);

  // ★ let にして、テーブル描画の途中で別ページに差し替えられるようにする
  let page = pdfDoc.addPage([pageWidth, pageHeight]);

  // フォント埋め込み
  const jpFont = await pdfDoc.embedFont(fonts.jp, { subset: false });
  const latinFont = await pdfDoc.embedFont(fonts.latin, { subset: false });

  warn('debug', 'template elements', {
    count: template.elements.length,
    ids: template.elements.map((e) => e.id),
  });

  // ▼▼ 要素を分解：ヘッダー（毎ページ／1ページのみ）とフッター、テーブル ▼▼
  const nonTableElements = template.elements.filter(
    (e) => e.type !== 'table',
  );

  // region === 'footer' のものだけフッター扱い
  const footerElements = nonTableElements.filter(
    (e) => e.region === 'footer',
  );

  // それ以外（region 未指定 or 'header' 'body'）はヘッダー候補として扱う
  const headerCandidates = nonTableElements.filter(
    (e) => e.region !== 'footer',
  );

  // ヘッダー：毎ページ出すもの（デフォルト）
  const repeatingHeaderElements = headerCandidates.filter(
    (e) => e.repeatOnEveryPage !== false,
  );

  // ヘッダー：1ページ目だけ出すもの
  const firstPageOnlyHeaderElements = headerCandidates.filter(
    (e) => e.repeatOnEveryPage === false,
  );

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
    const textFooterElems = allFooterElems.filter(
      (el) => el.type === "label" || el.type === "text",
    );
    if (textFooterElems.length === 0) return 0;

    // Y座標でソート（UI座標のままでOK）
    const sorted = [...textFooterElems].sort((a, b) => a.y - b.y);

    type RowInfo = { y: number; maxFontSize: number };

    const rows: RowInfo[] = [];
    const ROW_THRESHOLD = 5; // この差以内なら同じ行とみなす

    for (const el of sorted) {
      const fontSize = (el as any).fontSize ?? 12;
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

  // テンプレが明示的に footerReserveHeight を持っていればそっちを優先
  const footerReserveHeight =
    template.footerReserveHeight ?? estimatedFooterHeight ?? 0;

  const tableElements = template.elements.filter(
    (e): e is TableElement => e.type === 'table',
  );
  if (tableElements.length > 1) {
    warn('layout', 'multiple table elements found', {
      ids: tableElements.map((el) => el.id),
    });
  }
  const tableElementToRender =
    tableElements.find((el) => el.id === 'items') ?? tableElements[0];

  // 1ページ目にヘッダー要素を描画
  drawHeaderElements(
    page,
    [...repeatingHeaderElements, ...firstPageOnlyHeaderElements],
    pageHeight,
    renderData,
    jpFont,
    latinFont,
    imageMap,
    warn,
  );

  // テーブル（複数ある場合は順番に描画）
  // drawTable には「毎ページヘッダー」だけを渡す
  if (tableElementToRender) {
    page = drawTable(
      pdfDoc,
      page,
      pageWidth,
      pageHeight,
      tableElementToRender,
      jpFont,
      latinFont,
      renderData,
      repeatingHeaderElements,
      footerReserveHeight,
      imageMap,
      warn,
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
      pageHeight,
      renderData,
      jpFont,
      latinFont,
      imageMap,
      warn,
    );

    // --- ページ番号 (1 / N) を中央下に描画 ---
    const footerText = `${i + 1} / ${totalPages}`;
    const textWidth = latinFont.widthOfTextAtSize(
      footerText,
      footerFontSize,
    );
    const x = (pageWidth - textWidth) / 2;
    const y = 20; // 下から20pt

    p.drawText(footerText, {
      x,
      y,
      size: footerFontSize,
      font: latinFont,
      color: rgb(0.5, 0.5, 0.5),
    });
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


function pickFontForText(text: string, jpFont: PDFFont, latinFont: PDFFont): PDFFont {
  // ASCIIのみは Latin、それ以外は日本語フォント
  return /^[\x00-\x7F]*$/.test(text) ? latinFont : jpFont;
}

// ============================
// Label
// ============================

function drawLabel(
  page: PDFPage,
  element: LabelElement,
  jpFont: PDFFont,
  pageHeight: number,
) {
  const fontSize = element.fontSize ?? 12;
  const text = element.text ?? '';
  const maxWidth = 180;
  const maxLines = 99;

  let yStart = toPdfYFromBottom(element.y, pageHeight);
  yStart = clampPdfY(yStart, pageHeight - fontSize - 2);

  const lines = wrapTextToLines(text, jpFont, fontSize, maxWidth);
  drawMultilineText(
    page,
    lines,
    element.x,
    yStart,
    jpFont,
    fontSize,
    rgb(0, 0, 0),
    maxLines,
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
  pageHeight: number,
  data: TemplateDataRecord | undefined,
  warn: WarnFn,
) {
  const fontSize = element.fontSize ?? 12;
  const lineHeight = fontSize * 1.2;
  const maxWidth = element.width ?? 200;

  const resolved = resolveDataSource(element.dataSource, data, warn, { elementId: element.id });
  const text = resolved || element.text || '';
  const maxLines = element.height ? Math.floor(element.height / lineHeight) : 99999;

  let yStart = toPdfYFromBottom(element.y, pageHeight);
  yStart = clampPdfY(yStart, pageHeight - fontSize - 2);
  const fontToUse = pickFontForText(text, jpFont, latinFont);

  const lines = wrapTextToLines(text, fontToUse, fontSize, maxWidth);
  drawMultilineText(
    page,
    lines,
    element.x,
    yStart,
    fontToUse,
    fontSize,
    rgb(0, 0, 0),
    maxLines,
  );
}

// ============================
// Header elements (label / text / image) for each page
// ============================

function drawHeaderElements(
  page: PDFPage,
  headerElements: TemplateElement[],
  pageHeight: number,
  data: TemplateDataRecord | undefined,
  jpFont: PDFFont,
  latinFont: PDFFont,
  imageMap: Map<string, PDFImage>,
  warn: WarnFn,
) {
  for (const element of headerElements) {
    switch (element.type) {
      case 'label':
        drawLabel(page, element as LabelElement, jpFont, pageHeight);
        break;

      case 'text':
        drawText(
          page,
          element as TextElement,
          jpFont,
          latinFont,
          pageHeight,
          data,
          warn,
        );
        break;

      case 'image':
        drawImageElement(
          page,
          element as ImageElement,
          pageHeight,
          data,
          imageMap,
          warn,
        );
        break;


      case 'table':
        // ヘッダーには含めない（テーブルは別ルートで描画）
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
  pageHeight: number,
  data: TemplateDataRecord | undefined,
  jpFont: PDFFont,
  latinFont: PDFFont,
  imageMap: Map<string, PDFImage>,
  warn: WarnFn,
) {
  for (const element of footerElements) {
    switch (element.type) {
      case 'label':
        drawLabel(page, element as LabelElement, jpFont, pageHeight);
        break;

      case 'text':
        drawText(
          page,
          element as TextElement,
          jpFont,
          latinFont,
          pageHeight,
          data,
          warn,
        );
        break;

      case 'image':
        drawImageElement(
          page,
          element as ImageElement,
          pageHeight,
          data,
          imageMap,
          warn,
        );
        break;

      case 'table':
        // フッターにはテーブルを描かない想定
        break;

      default:
        warn('layout', 'unknown footer element type', { type: (element as TemplateElement).type });
    }
  }
}

// ============================
// Table
// ============================

function drawTable(
  pdfDoc: PDFDocument,
  page: PDFPage,
  pageWidth: number,
  pageHeight: number,
  element: TableElement,
  jpFont: PDFFont,
  latinFont: PDFFont,
  data: TemplateDataRecord | undefined,
  headerElements: TemplateElement[],
  footerReserveHeight: number,
  imageMap: Map<string, PDFImage>,
  warn: WarnFn,
): PDFPage {
  const rowHeight = element.rowHeight ?? 18;
  const headerHeight = element.headerHeight ?? rowHeight;
  const baseFontSize = 10;
  const lineGap = 2;
  const lineHeight = baseFontSize + lineGap;
  const paddingY = 4;
  const paddingLeft = CELL_PADDING_X;
  const paddingRight = CELL_PADDING_X;

  const originX = element.x;
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
  const tableWidth = element.columns.reduce((sum, col) => sum + col.width, 0);
  const summaryMode = summarySpec?.mode;
  const resolveSummaryKind = (row: SummaryRow) => row.kind ?? 'both';
  const shouldDrawSummaryKind = (row: SummaryRow, kind: 'subtotal' | 'total') => {
    const resolved = resolveSummaryKind(row);
    return resolved === 'both' || resolved === kind;
  };
  const resolveSummaryLabel = (row: SummaryRow, kind: 'subtotal' | 'total') => {
    if (row.label) return row.label;
    if (row.op !== 'sum') return '';
    if (kind === 'subtotal') {
      return row.labelSubtotal ?? '小計';
    }
    return row.labelTotal ?? '合計';
  };

  // テーブルヘッダー（列タイトル）を描画するヘルパー
  const drawTableHeaderRow = (targetPage: PDFPage, headerY: number) => {
    let currentX = originX;
    for (const col of element.columns) {
      const colWidth = col.width;

      // 枠線
      targetPage.drawRectangle({
        x: currentX,
        y: headerY,
        width: colWidth,
        height: headerHeight,
        borderColor: rgb(0.7, 0.7, 0.7),
        borderWidth: 0.5,
      });

      // 列タイトル
      targetPage.drawText(col.title, {
        x: currentX + 4,
        y: headerY + headerHeight / 2 - baseFontSize / 2,
        size: baseFontSize,
        font: jpFont,
        color: rgb(0, 0, 0),
      });

      currentX += colWidth;
    }
  };

  let currentPage = page;
  const minHeaderY = bottomMargin + headerHeight + rowHeight;
  const getHeaderY = () =>
    clampPdfY(toPdfYFromBottom(element.y, pageHeight), pageHeight - headerHeight);
  let headerY = getHeaderY();
  let cursorY = headerY - headerHeight;

  if (headerY < minHeaderY) {
    currentPage = pdfDoc.addPage([pageWidth, pageHeight]);

    drawHeaderElements(
      currentPage,
      headerElements,
      pageHeight,
      data,
      jpFont,
      latinFont,
      imageMap,
      warn,
    );

    headerY = getHeaderY();
    cursorY = headerY - headerHeight;
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

    const rowYBottom = cursorY - summaryRowHeight;
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
        y: rowYBottom,
        width: tableWidth,
        height: summaryRowHeight,
        color: rgb(fillGray, fillGray, fillGray),
      });
    }

    for (const col of element.columns) {
      const colWidth = col.width;
      const spec = normalizeColumnSpec(col);
      const cellText =
        col.id === labelColumn.id
          ? labelText
          : col.id === valueColumnId
          ? sumText
          : '';
      const fontForCell = pickFontForText(cellText, jpFont, latinFont);

      if (element.showGrid) {
        const borderGray = summaryStyle?.borderColorGray ?? 0.85;
        currentPage.drawRectangle({
          x: currentX,
          y: rowYBottom,
          width: colWidth,
          height: summaryRowHeight,
          borderColor: rgb(borderGray, borderGray, borderGray),
          borderWidth: 0.5,
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
            rowYBottom,
            colWidth,
            summaryRowHeight,
            align,
          );
        } else if (spec.overflow === 'shrink') {
          drawCellText(
            currentPage,
            cellText,
            fontForCell,
            baseFontSize,
            currentX,
            rowYBottom,
            colWidth,
            summaryRowHeight,
            align,
            spec.minFontSize,
          );
        } else if (spec.overflow === 'ellipsis') {
          const clipped = ellipsisTextToWidth(cellText, fontForCell, baseFontSize, maxCellWidth);
          drawAlignedText(
            currentPage,
            clipped,
            fontForCell,
            baseFontSize,
            currentX,
            rowYBottom,
            colWidth,
            summaryRowHeight,
            align,
          );
        } else if (spec.overflow === 'wrap') {
          const lines = wrapTextToLines(cellText, fontForCell, baseFontSize, maxCellWidth);
          const maxLinesByHeight = Math.floor((summaryRowHeight - paddingY * 2) / lineHeight);
          const yStart = rowYBottom + summaryRowHeight - paddingY - lineHeight;
          for (let idx = 0; idx < Math.min(lines.length, maxLinesByHeight); idx += 1) {
            const line = lines[idx];
            const lineWidth = fontForCell.widthOfTextAtSize(line, baseFontSize);
            const x =
              align === 'right'
                ? currentX + colWidth - paddingRight - lineWidth
                : align === 'center'
                ? currentX + (colWidth - lineWidth) / 2
                : currentX + paddingLeft;
            currentPage.drawText(line, {
              x,
              y: yStart - idx * lineHeight,
              size: baseFontSize,
              font: fontForCell,
              color: rgb(0, 0, 0),
            });
          }
        } else {
          drawAlignedText(
            currentPage,
            cellText,
            fontForCell,
            baseFontSize,
            currentX,
            rowYBottom,
            colWidth,
            summaryRowHeight,
            align,
          );
        }
      }

      currentX += colWidth;
    }

    if (summaryStyle && kind === 'total') {
      const borderGray = summaryStyle.borderColorGray ?? 0.85;
      const thickness = summaryStyle.totalTopBorderWidth ?? 1.5;
      currentPage.drawLine({
        start: { x: originX, y: rowYBottom + summaryRowHeight },
        end: { x: originX + tableWidth, y: rowYBottom + summaryRowHeight },
        thickness,
        color: rgb(borderGray, borderGray, borderGray),
      });
    }

    cursorY = rowYBottom;
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
      pageHeight,
      data,
      jpFont,
      latinFont,
      imageMap,
      warn,
    );

    headerY = getHeaderY();
    cursorY = headerY - headerHeight;
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


    const cells = element.columns.map((col) => {
      const colWidth = col.width;
      const maxCellWidth = Math.max(0, colWidth - (paddingLeft + paddingRight));
      const spec = normalizeColumnSpec(col);
      const rawVal = col.fieldCode ? (row as any)[col.fieldCode] : '';
      const cellTextRaw = formatCellValue(rawVal, spec, warn, {
        tableId: element.id,
        columnId: col.id,
        fieldCode: col.fieldCode,
      });
      const fontForCell = pickFontForText(cellTextRaw, jpFont, latinFont);

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
          pageHeight,
          data,
          jpFont,
          latinFont,
          imageMap,
          warn,
        );

        headerY = getHeaderY();
        cursorY = headerY - headerHeight;
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

    let rowYBottom = cursorY - effectiveRowHeight;

    // 下余白を割りそうなら改ページ
    if (rowYBottom < bottomMargin) {
      emitSubtotalIfNeeded();
      pageRowCount = 0;

      // 新しいページを追加
      currentPage = pdfDoc.addPage([pageWidth, pageHeight]);

      // ★ 新ページにもラベル・テキストなどのヘッダー要素を再描画
      drawHeaderElements(
        currentPage,
        headerElements,
        pageHeight,
        data,
        jpFont,
        latinFont,
        imageMap,
        warn,
      );

      // テーブルヘッダーの位置を再計算して描画
      headerY = getHeaderY();
      cursorY = headerY - headerHeight;

      if (headerY < minHeaderY) {
        warn('layout', 'table header Y is too low for minimum layout', {
          id: element.id,
          headerY,
          minHeaderY,
        });
      }

      drawTableHeaderRow(currentPage, headerY);

      rowYBottom = cursorY - effectiveRowHeight;
    }

    let currentX = originX;

    for (const cell of cells) {
      const {
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
          y: rowYBottom,
          width: colWidth,
          height: effectiveRowHeight,
          borderColor: rgb(0.85, 0.85, 0.85),
          borderWidth: 0.5,
        });
      }

      const cellText = cellTextRaw.replace(/\n/g, '');
      const align = resolveColumnAlign(spec, cellText);

      if (spec.overflow === 'wrap' && maxCellWidth > 0) {
        const maxLinesByHeight = Math.floor((effectiveRowHeight - paddingY * 2) / lineHeight);
        const lines = linesToDraw.slice(0, Math.max(0, maxLinesByHeight));
        const yStart = rowYBottom + effectiveRowHeight - paddingY - lineHeight;
        for (let idx = 0; idx < lines.length; idx += 1) {
          const line = lines[idx];
          const lineWidth = fontForCell.widthOfTextAtSize(line, baseFontSize);
          const x =
            align === 'right'
              ? currentX + colWidth - paddingRight - lineWidth
              : align === 'center'
              ? currentX + (colWidth - lineWidth) / 2
              : currentX + paddingLeft;
          currentPage.drawText(line, {
            x,
            y: yStart - idx * lineHeight,
            size: baseFontSize,
            font: fontForCell,
            color: rgb(0, 0, 0),
          });
        }
      } else if (spec.overflow === 'ellipsis') {
        const clipped = ellipsisTextToWidth(cellText, fontForCell, baseFontSize, maxCellWidth);
        drawAlignedText(
          currentPage,
          clipped,
          fontForCell,
          baseFontSize,
          currentX,
          rowYBottom,
          colWidth,
          effectiveRowHeight,
          align,
        );
      } else if (spec.overflow === 'clip') {
        drawAlignedText(
          currentPage,
          cellText,
          fontForCell,
          baseFontSize,
          currentX,
          rowYBottom,
          colWidth,
          effectiveRowHeight,
          align,
        );
      } else {
        drawCellText(
          currentPage,
          cellText,
          fontForCell,
          baseFontSize,
          currentX,
          rowYBottom,
          colWidth,
          effectiveRowHeight,
          align,
          spec.minFontSize,
        );
      }

      currentX += colWidth;
    }

    if (summaryStates.length > 0) {
      for (const state of summaryStates) {
        if (state.row.op !== 'sum') continue;
        const rawVal = (row as any)[state.row.fieldCode];
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
      const rawVal = (row as any)[amountFieldCode];
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

    cursorY = rowYBottom;
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
}

function drawImageElement(
  page: PDFPage,
  element: ImageElement,
  pageHeight: number,
  data: TemplateDataRecord | undefined,
  imageMap: Map<string, PDFImage>,
  warn: WarnFn,
) {
  const url = resolveDataSource(element.dataSource, data, warn, { elementId: element.id });
  if (!url || !isHttpUrl(url)) {
    drawImagePlaceholder(page, element, pageHeight);
    return;
  }

  const embedded = imageMap.get(url);
  if (!embedded) {
    drawImagePlaceholder(page, element, pageHeight);
    return;
  }

  const width = element.width ?? embedded.width;
  const height = element.height ?? embedded.height;
  let pdfY = toPdfYFromBottom(element.y, pageHeight);
  pdfY = clampPdfY(pdfY, pageHeight - height);

  const { width: imgW, height: imgH } = embedded.size();
  const fitMode = element.fitMode ?? 'fit';

  let drawWidth = width;
  let drawHeight = height;

  if (fitMode === 'fit') {
    const scale = Math.min(width / imgW, height / imgH);
    drawWidth = imgW * scale;
    drawHeight = imgH * scale;
  }

  page.drawImage(embedded, {
    x: element.x,
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
  pageHeight: number,
) {
  const width = element.width ?? 120;
  const height = element.height ?? 80;

  let pdfY = toPdfYFromBottom(element.y, pageHeight);
  pdfY = clampPdfY(pdfY, pageHeight - height);

  page.drawRectangle({
    x: element.x,
    y: pdfY,
    width,
    height,
    borderColor: rgb(0.5, 0.5, 0.5),
    borderWidth: 1,
  });

  page.drawText('IMAGE', {
    x: element.x + 8,
    y: pdfY + height / 2 - 6,
    size: 10,
    color: rgb(0.4, 0.4, 0.4),
  });
}
