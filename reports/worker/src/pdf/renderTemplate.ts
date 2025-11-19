import { PDFDocument, rgb, type PDFPage, type PDFFont } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type {
  PageSize,
  TemplateDataRecord,
  TemplateDefinition,
  TableElement,
  TextElement,
} from '../../../shared/template.ts';

const PAGE_DIMENSIONS: Record<PageSize, { portrait: [number, number]; landscape: [number, number] }> = {
  A4: {
    portrait: [595, 842],
    landscape: [842, 595],
  },
};

export async function renderTemplateToPdf(
  template: TemplateDefinition,
  data: TemplateDataRecord,
  fontBytes: Uint8Array,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);

  const dims = PAGE_DIMENSIONS[template.pageSize] ?? PAGE_DIMENSIONS.A4;
  const [width, height] = dims[template.orientation];
  const page = pdf.addPage([width, height]);

  const font = await pdf.embedFont(fontBytes, { subset: true });

  for (const element of template.elements) {
    if (element.type === 'text') {
      drawTextElement(page, element, data, font);
      continue;
    }

    if (element.type === 'table') {
      drawTableElement(page, element, data, font);
    }
  }

  return pdf.save();
}

const resolveValue = (dataSource: TextElement['dataSource'], data: TemplateDataRecord): string => {
  if (dataSource.type === 'static') {
    return dataSource.value;
  }

  const value = data[dataSource.fieldCode];
  if (value === null || value === undefined) {
    return '';
  }

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
};

const drawTextElement = (
  page: PDFPage,
  element: TextElement,
  data: TemplateDataRecord,
  font: PDFFont,
) => {
  const text = resolveValue(element.dataSource, data);
  const fontSize = element.fontSize ?? 12;
  page.drawText(text, {
    x: element.x,
    y: element.y,
    size: fontSize,
    font,
  });
};

const drawTableElement = (
  page: PDFPage,
  element: TableElement,
  data: TemplateDataRecord,
  font: PDFFont,
) => {
  const rows = Array.isArray(data[element.dataSource.fieldCode])
    ? (data[element.dataSource.fieldCode] as TemplateDataRecord[])
    : [];

  const rowHeight = element.rowHeight ?? 18;
  const headerHeight = element.headerHeight ?? 24;
  const tableWidth = element.columns.reduce<number>((sum, column) => sum + column.width, 0);
  const totalHeight = headerHeight + rowHeight * rows.length;
  const startX = element.x;
  const startY = element.y;

  drawTableGrid(page, startX, startY, tableWidth, totalHeight, element, rows.length);

  const cellPaddingX = 6;
  const headerFontSize = 11;
  const bodyFontSize = 10;
  let cursorY = startY - 8;

  for (const column of element.columns) {
    drawAlignedText({
      page,
      font,
      text: column.title,
      x: startX + getColumnOffset(element, column.id) + cellPaddingX,
      y: cursorY,
      width: column.width - cellPaddingX * 2,
      align: column.align ?? 'left',
      fontSize: headerFontSize,
    });
  }

  cursorY -= headerHeight;

  for (const row of rows) {
    for (const column of element.columns) {
      const rawValue =
        typeof row === 'object' && row !== null ? (row as TemplateDataRecord)[column.fieldCode] : '';
      const text = rawValue === undefined || rawValue === null ? '' : String(rawValue);
      drawAlignedText({
        page,
        font,
        text,
        x: startX + getColumnOffset(element, column.id) + cellPaddingX,
        y: cursorY,
        width: column.width - cellPaddingX * 2,
        align: column.align ?? 'left',
        fontSize: bodyFontSize,
      });
    }
    cursorY -= rowHeight;
  }
};

const getColumnOffset = (element: TableElement, columnId: string) => {
  let offset = 0;
  for (const column of element.columns) {
    if (column.id === columnId) {
      break;
    }
    offset += column.width;
  }
  return offset;
};

const drawTableGrid = (
  page: PDFPage,
  startX: number,
  startY: number,
  tableWidth: number,
  totalHeight: number,
  element: TableElement,
  bodyRowCount: number,
) => {
  const rowHeight = element.rowHeight ?? 18;
  const headerHeight = element.headerHeight ?? 24;
  const heights = [headerHeight, ...Array(bodyRowCount).fill(rowHeight)];

  let offset = 0;
  for (let i = 0; i <= heights.length; i += 1) {
    const y = startY - offset;
    page.drawLine({
      start: { x: startX, y },
      end: { x: startX + tableWidth, y },
      thickness: 0.5,
      color: rgb(0.8, 0.8, 0.8),
    });
    if (i < heights.length) {
      offset += heights[i];
    }
  }

  let columnX = startX;
  page.drawLine({
    start: { x: startX, y: startY },
    end: { x: startX, y: startY - totalHeight },
    thickness: 0.5,
    color: rgb(0.8, 0.8, 0.8),
  });

  for (const column of element.columns) {
    columnX += column.width;
    page.drawLine({
      start: { x: columnX, y: startY },
      end: { x: columnX, y: startY - totalHeight },
      thickness: 0.5,
      color: rgb(0.8, 0.8, 0.8),
    });
  }
};

type Align = 'left' | 'center' | 'right';

type DrawTextOptions = {
  page: PDFPage;
  font: PDFFont;
  text: string;
  x: number;
  y: number;
  width: number;
  align: Align;
  fontSize: number;
};

const drawAlignedText = ({ page, font, text, x, y, width, align, fontSize }: DrawTextOptions) => {
  const safeText = text ?? '';
  const textWidth = font.widthOfTextAtSize(safeText, fontSize);
  let drawX = x;
  if (align === 'center') {
    drawX = x + Math.max(0, (width - textWidth) / 2);
  } else if (align === 'right') {
    drawX = x + Math.max(0, width - textWidth);
  }

  page.drawText(safeText, {
    x: drawX,
    y,
    size: fontSize,
    font,
  });
};
