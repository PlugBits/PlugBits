import { PDFDocument, rgb, type PDFPage, type PDFFont } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type {
  TemplateDefinition,
  TemplateElement,
  TextElement,
  LabelElement,
  TableElement,
  ImageElement,
  TemplateDataRecord,
  DataSource,
  PageSize,
} from '../../../shared/template.js';

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
 * UI の Y（上から） → PDF の Y（下から）に変換
 * もともと使っていた toPdfY と同じロジック：
 *   PDF_Y = pageHeight - uiY - height
 */
const UI_CANVAS_HEIGHT = 800; // ← エディタ側のキャンバス高さに合わせる

function toPdfY(uiY: number, height: number, pageHeight: number): number {
  const scale = pageHeight / UI_CANVAS_HEIGHT;
  // 必要なら baseline 用に height 分ずらしても OK
  return uiY * scale;
}

/**
 * kintone / static などのデータソースを解決
 */
function resolveDataSource(
  source: DataSource | undefined,
  data: TemplateDataRecord | undefined,
): string {
  if (!source) return '';

  // 固定値
  if (source.type === 'static') {
    return source.value ?? '';
  }

  if (!data) return '';

  // kintone / kintoneSubtable 系
  if ('fieldCode' in source && source.fieldCode) {
    const value = data[source.fieldCode];

    if (value === null || value === undefined) return '';

    if (typeof value === 'number') {
      return new Intl.NumberFormat('ja-JP').format(value);
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    if (Array.isArray(value)) {
      return value
        .map((item) => (typeof item === 'object' ? JSON.stringify(item) : String(item)))
        .join(', ');
    }

    return String(value);
  }

  return '';
}

/**
 * メイン：テンプレートを PDF のバイト列に変換
 */
export async function renderTemplateToPdf(
  template: TemplateDefinition,
  data: TemplateDataRecord | undefined,
  fontBytes: Uint8Array,
): Promise<Uint8Array> {
  console.log(
    '==== renderTemplateToPdf START ====',
  );

  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  const [pageWidth, pageHeight] = getPageSize(template);
  const page = pdfDoc.addPage([pageWidth, pageHeight]);

  // 日本語対応フォントを埋め込み
  const font = await pdfDoc.embedFont(fontBytes, { subset: false });

  console.log(
    'TEMPLATE ELEMENTS:',
    template.elements.map((e) => ({
      id: e.id,
      type: e.type,
      text: (e as any).text,
      x: e.x,
      y: e.y,
    })),
  );

  for (const element of template.elements) {
    switch (element.type) {
      case 'label':
        drawLabel(page, element as LabelElement, font, pageHeight);
        break;
      case 'text':
        drawText(page, element as TextElement, font, pageHeight, data);
        break;
      case 'table':
        drawTable(page, element as TableElement, font, pageHeight, data);
        break;
      case 'image':
        // 画像はまだプレースホルダ
        drawImagePlaceholder(page, element as ImageElement, pageHeight);
        break;
      default:
        console.warn('Unknown element type', (element as TemplateElement).type);
    }
  }

  const bytes = await pdfDoc.save();
  console.log('==== renderTemplateToPdf END ====');
  return bytes;
}

// ============================
// Label
// ============================

function drawLabel(
  page: PDFPage,
  element: LabelElement,
  font: PDFFont,
  pageHeight: number,
) {
  const fontSize = element.fontSize ?? 12;
  const textHeight = fontSize;
  const text = element.text ?? '';

  const pdfY = toPdfY(element.y, textHeight, pageHeight);

  console.log('DRAW LABEL', {
    id: element.id,
    text,
    uiY: element.y,
    pdfY,
  });

  page.drawText(text, {
    x: element.x,
    y: pdfY,
    size: fontSize,
    font,
    color: rgb(0, 0, 0),
  });
}

// ============================
// Text
// ============================

function drawText(
  page: PDFPage,
  element: TextElement,
  font: PDFFont,
  pageHeight: number,
  data: TemplateDataRecord | undefined,
) {
  const fontSize = element.fontSize ?? 12;
  const textHeight = fontSize;

  const resolved = resolveDataSource(element.dataSource, data);
  const text = resolved || element.text || '';

  const pdfY = toPdfY(element.y, textHeight, pageHeight);

  console.log('DRAW TEXT', {
    id: element.id,
    text,
    uiY: element.y,
    pdfY,
  });

  page.drawText(text, {
    x: element.x,
    y: pdfY,
    size: fontSize,
    font,
    color: rgb(0, 0, 0),
  });
}

// ============================
// Table
// ============================

function drawTable(
  page: PDFPage,
  element: TableElement,
  font: PDFFont,
  pageHeight: number,
  data: TemplateDataRecord | undefined,
) {
  const rowHeight = element.rowHeight ?? 18;
  const headerHeight = element.headerHeight ?? rowHeight;
  const fontSize = 10;

  const originX = element.x;
  const originY = toPdfY(element.y, headerHeight, pageHeight);

  // サブテーブル行
  const rows =
    data &&
    element.dataSource &&
    element.dataSource.type === 'kintoneSubtable'
      ? (data[element.dataSource.fieldCode] as any[] | undefined)
      : undefined;

  console.log('DRAW TABLE', {
    id: element.id,
    uiY: element.y,
    startY: originY,
    rows: rows?.length ?? 0,
  });

  // ヘッダー行
  let currentX = originX;
  for (const col of element.columns) {
    const colWidth = col.width;

    // 枠線
    page.drawRectangle({
      x: currentX,
      y: originY,
      width: colWidth,
      height: headerHeight,
      borderColor: rgb(0.7, 0.7, 0.7),
      borderWidth: 0.5,
    });

    // タイトル
    page.drawText(col.title, {
      x: currentX + 4,
      y: originY + headerHeight / 2 - fontSize / 2,
      size: fontSize,
      font,
      color: rgb(0, 0, 0),
    });

    currentX += colWidth;
  }

  if (!rows || rows.length === 0) return;

  // データ行
  let rowIndex = 0;
  for (const row of rows) {
    const rowTopY = originY - headerHeight - rowIndex * rowHeight;
    currentX = originX;

    for (const col of element.columns) {
      const colWidth = col.width;

      if (element.showGrid) {
        page.drawRectangle({
          x: currentX,
          y: rowTopY,
          width: colWidth,
          height: rowHeight,
          borderColor: rgb(0.85, 0.85, 0.85),
          borderWidth: 0.5,
        });
      }

      const cellValue =
        row[col.fieldCode] != null ? String(row[col.fieldCode]) : '';

      page.drawText(cellValue, {
        x: currentX + 4,
        y: rowTopY + rowHeight / 2 - fontSize / 2,
        size: fontSize,
        font,
        color: rgb(0, 0, 0),
      });

      currentX += colWidth;
    }

    rowIndex += 1;
  }
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

  const pdfY = toPdfY(element.y, height, pageHeight);

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
