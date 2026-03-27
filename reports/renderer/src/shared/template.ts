export type PageSize = 'A4' | 'Letter';
export type Orientation = 'portrait' | 'landscape';

export type TemplateDataRecord = Record<string, unknown>;

export type DataSource =
  | { type: 'static'; value: string }
  | { type: 'kintone'; fieldCode: string }
  | { type: 'kintoneSubtable'; fieldCode: string };

export type BaseElement = {
  id: string;
  slotId?: string;
  type: 'text' | 'label' | 'table' | 'image';
  x: number;
  y: number;
  width?: number;
  height?: number;
  region?: 'header' | 'body' | 'footer';
  repeatOnEveryPage?: boolean;
  alignX?: 'left' | 'center' | 'right';
  borderWidth?: number;
  borderColorGray?: number;
  fillGray?: number;
  fontSize?: number;
  fontWeight?: 'normal' | 'bold';
};

export type TextElement = BaseElement & {
  type: 'text';
  text?: string;
  dataSource?: DataSource;
};

export type LabelElement = BaseElement & {
  type: 'label';
  text: string;
};

export type ImageElement = BaseElement & {
  type: 'image';
  dataSource?: DataSource;
};

export type TableColumn = {
  id: string;
  title: string;
  fieldCode: string;
  width: number;
  align?: 'left' | 'center' | 'right';
  minFontSize?: number;
};

export type TableSummaryRow = {
  op: 'sum' | 'static';
  fieldCode?: string;
  columnId: string;
  label?: string;
  labelSubtotal?: string;
  labelTotal?: string;
  kind?: 'subtotal' | 'total' | 'both';
};

export type TableElement = BaseElement & {
  type: 'table';
  rowHeight?: number;
  headerHeight?: number;
  showGrid?: boolean;
  dataSource?: DataSource;
  columns?: TableColumn[];
  summary?: {
    mode?: 'lastPageOnly' | 'everyPageSubtotal+lastTotal';
    rows?: TableSummaryRow[];
    style?: {
      subtotalFillGray?: number;
      totalFillGray?: number;
      totalTopBorderWidth?: number;
      borderColorGray?: number;
    };
  };
};

export type TemplateElement = TextElement | LabelElement | ImageElement | TableElement;

export type TemplateDefinition = {
  id?: string;
  name?: string;
  pageSize?: PageSize;
  orientation?: Orientation;
  structureType?: string;
  rawYMode?: 'top' | 'bottom';
  settings?: {
    yMode?: 'top' | 'bottom';
    presetId?: string;
    presetRevision?: number;
  };
  footerReserveHeight?: number;
  elements: TemplateElement[];
};

export const PAGE_DIMENSIONS: Record<
  PageSize,
  { portrait: [number, number]; landscape: [number, number] }
> = {
  A4: {
    portrait: [595, 842],
    landscape: [842, 595],
  },
  Letter: {
    portrait: [612, 792],
    landscape: [792, 612],
  },
};

export const getPageDimensions = (
  pageSize: PageSize = 'A4',
  orientation: Orientation = 'portrait',
) => {
  const dims = PAGE_DIMENSIONS[pageSize] ?? PAGE_DIMENSIONS.A4;
  const [width, height] = orientation === 'landscape' ? dims.landscape : dims.portrait;
  return { width, height };
};
