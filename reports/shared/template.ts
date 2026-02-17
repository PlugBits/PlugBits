// shared/template.ts

export type PageSize = 'A4' | 'Letter';
export type Orientation = 'portrait' | 'landscape';
//構造テンプレ種別（将来増やす） ---
export type StructureType = 'list_v1' | 'estimate_v1' | 'cards_v1' | 'label_v1';
//フッターの繰り返しモード ---
export type FooterRepeatMode = 'all' | 'last';
//mapping は MVP では unknown（Adapter側で解釈/検証） ---
export type TemplateMapping = unknown;

export type FontScalePreset = 'S' | 'M' | 'L';
export type PagePaddingPreset = 'Narrow' | 'Normal' | 'Wide';

export type EasyAdjustGroup =
  | 'header'
  | 'recipient'
  | 'body'
  | 'footer'
  | 'documentMeta'
  | 'title'
  | 'customer';
export type EasyAdjustGroupSettings = {
  fontPreset?: FontScalePreset;
  paddingPreset?: PagePaddingPreset;
  enabled?: boolean;
  docNoVisible?: boolean;
  dateVisible?: boolean;
  hiddenLabelIds?: string[];
};
export type EasyAdjustSettings = Partial<Record<EasyAdjustGroup, EasyAdjustGroupSettings>>;

export type TemplateSettings = {
  easyAdjust?: EasyAdjustSettings;
  fontScalePreset?: FontScalePreset;
  pagePaddingPreset?: PagePaddingPreset;
  presetId?: string;
  presetRevision?: number;
  companyBlock?: {
    enabled?: boolean;
  };
};

export type RegionBounds = {
  header: { yTop: number; yBottom: number };
  body: { yTop: number; yBottom: number };
  footer: { yTop: number; yBottom: number };
};

export type CompanyProfile = {
  companyName?: string;
  companyAddress?: string;
  companyTel?: string;
  companyEmail?: string;
};

export type LabelSheetSettings = {
  paperPreset?: 'A4' | 'Letter' | 'Custom';
  paperWidthMm: number;
  paperHeightMm: number;
  cols: number;
  rows: number;
  marginMm: number;
  gapMm: number;
  offsetXmm: number;
  offsetYmm: number;
};

export type LabelSlotMapping = {
  title: string | null;
  code: string | null;
  qty: string | null;
  qr: string | null;
  extra?: string | null;
};

export type LabelMapping = {
  slots: LabelSlotMapping;
  copiesFieldCode: string | null;
};

// Editor canvas height (bottom-based UI coordinates)
export const CANVAS_HEIGHT = 842;

const clampNumber = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

export const resolveRegionBounds = (
  template?: Pick<TemplateDefinition, 'regionBounds' | 'footerReserveHeight'>,
  pageHeight = CANVAS_HEIGHT,
): RegionBounds => {
  const footerReserve = template?.footerReserveHeight ?? 150;
  const footerTop = clampNumber(pageHeight - footerReserve, 0, pageHeight);
  const headerBottom = clampNumber(250, 0, pageHeight);
  const bodyTop = Math.min(headerBottom, footerTop);
  const bodyBottom = Math.max(bodyTop, footerTop);

  const defaultBounds: RegionBounds = {
    header: { yTop: 0, yBottom: headerBottom },
    body: { yTop: bodyTop, yBottom: bodyBottom },
    footer: { yTop: footerTop, yBottom: pageHeight },
  };

  const normalize = (input: { yTop: number; yBottom: number }, fallback: { yTop: number; yBottom: number }) => {
    const rawTop = Number.isFinite(input.yTop) ? input.yTop : fallback.yTop;
    const rawBottom = Number.isFinite(input.yBottom) ? input.yBottom : fallback.yBottom;
    const yTop = clampNumber(Math.min(rawTop, rawBottom), 0, pageHeight);
    const yBottom = clampNumber(Math.max(rawTop, rawBottom), 0, pageHeight);
    return { yTop, yBottom };
  };

  if (!template?.regionBounds) return defaultBounds;

  return {
    header: normalize(template.regionBounds.header, defaultBounds.header),
    body: normalize(template.regionBounds.body, defaultBounds.body),
    footer: normalize(template.regionBounds.footer, defaultBounds.footer),
  };
};

export const toBottomBasedRegionBounds = (
  bounds: RegionBounds,
  pageHeight = CANVAS_HEIGHT,
) => ({
  header: {
    yMin: clampNumber(pageHeight - bounds.header.yBottom, 0, pageHeight),
    yMax: clampNumber(pageHeight - bounds.header.yTop, 0, pageHeight),
  },
  body: {
    yMin: clampNumber(pageHeight - bounds.body.yBottom, 0, pageHeight),
    yMax: clampNumber(pageHeight - bounds.body.yTop, 0, pageHeight),
  },
  footer: {
    yMin: clampNumber(pageHeight - bounds.footer.yBottom, 0, pageHeight),
    yMax: clampNumber(pageHeight - bounds.footer.yTop, 0, pageHeight),
  },
});


export type DataSource =
  | { type: 'static'; value: string }
  | { type: 'kintone'; fieldCode: string }
  | { type: 'kintoneSubtable'; fieldCode: string };

export interface BaseElement {
  id: string;
  slotId?: string;
  type: 'text' | 'label' | 'table' | 'image' | 'cardList';
  x: number;
  y: number;
  width?: number;
  height?: number;
  alignX?: 'left' | 'center' | 'right';
  borderWidth?: number;
  borderColorGray?: number;
  fillGray?: number;
  cornerRadius?: number;
  hidden?: boolean;
  region?: 'header' | 'body' | 'footer';
  repeatOnEveryPage?: boolean;
  footerRepeatMode?: 'all' | 'last';
}

// 動的 or 静的テキスト
export interface TextElement extends BaseElement {
  type: 'text';
  fontSize?: number;
  fontWeight?: 'normal' | 'bold';
  text?: string;
  dataSource?: DataSource;
}

// 完全固定のラベル
export interface LabelElement extends BaseElement {
  type: 'label';
  fontSize?: number;
  fontWeight?: 'normal' | 'bold';
  text: string;
}
// どっちにもなり得るゆるい型（既存コード救済用）
export interface TextOrLabelElement extends BaseElement {
  type: 'text' | 'label';
  fontSize?: number;
  fontWeight?: 'normal' | 'bold';
  text?: string;
  dataSource?: DataSource;
}


export interface TableColumn {
  id: string;
  title: string;
  fieldCode: string;
  width: number;
  align?: 'left' | 'center' | 'right';
  overflow?: 'wrap' | 'shrink' | 'ellipsis' | 'clip';
  minFontSize?: number;
  maxLines?: number;
  formatter?: {
    type: 'number' | 'currency' | 'date' | 'text';
    locale?: string;
  };
}

export interface CardField {
  id: string;
  label: string;
  fieldCode?: string;
  align?: 'left' | 'center' | 'right';
}

export interface CardListElement extends BaseElement {
  type: 'cardList';
  dataSource: Extract<DataSource, { type: 'kintoneSubtable' }>;
  cardHeight: number;
  gapY?: number;
  padding?: number;
  borderWidth?: number;
  borderColorGray?: number;
  fillGray?: number;
  cornerRadius?: number;
  fields: CardField[];
}

export type SummaryRow =
  | {
      op: 'sum';
      label?: string;
      fieldCode: string;
      columnId: string;
      kind?: 'subtotal' | 'total' | 'both';
      labelSubtotal?: string;
      labelTotal?: string;
    }
  | {
      op: 'static';
      label?: string;
      value?: string;
      columnId: string;
      valueColumnId?: string;
      kind?: 'subtotal' | 'total' | 'both';
    };

export type TableSummary = {
  mode: 'lastPageOnly' | 'everyPageSubtotal+lastTotal';
  rows: SummaryRow[];
  style?: {
    subtotalFillGray?: number;
    totalFillGray?: number;
    totalTopBorderWidth?: number;
    borderColorGray?: number;
  };
};

// サブテーブル用テーブル
export interface TableElement extends BaseElement {
  type: 'table';
  rowHeight?: number;
  headerHeight?: number;
  dataSource: Extract<DataSource, { type: 'kintoneSubtable' }>;
  columns: TableColumn[];
  summary?: TableSummary;
  showGrid?: boolean;
}

// 静的画像
export interface ImageElement extends BaseElement {
  type: 'image';
  width?: number;
  height?: number;
  imageUrl?: string;
  fitMode?: 'fit' | 'fill';
  dataSource: Extract<DataSource, { type: 'static' }>;
}

export type TemplateElement =
  | TextElement
  | LabelElement
  | TextOrLabelElement 
  | TableElement
  | CardListElement
  | ImageElement;

export type TemplateDataRecord = Record<string, unknown>;

export const TEMPLATE_SCHEMA_VERSION = 1;

export interface TemplateDefinition<
  TData extends TemplateDataRecord = TemplateDataRecord,
> {
  id: string;
  name: string;
  // baseTemplateId identifies the catalog/base template (e.g. "list_v1").
  // TemplateDefinition.id is the user-specific template id (e.g. "tpl_*").
  baseTemplateId?: string;
  schemaVersion?: number;
  pageSize: PageSize;
  orientation: Orientation;
  elements: TemplateElement[];
  slotSchema?: {
    header: Array<{
      slotId: string;
      label: string;
      kind: 'text' | 'date' | 'number' | 'image';
      required?: boolean;
      defaultAlign?: 'left' | 'center' | 'right';
    }>;
    footer: Array<{
      slotId: string;
      label: string;
      kind: 'text' | 'date' | 'number' | 'image';
      required?: boolean;
      defaultAlign?: 'left' | 'center' | 'right';
    }>;
  };
  structureType?: StructureType;
  mapping?: TemplateMapping;
  settings?: TemplateSettings;
  regionBounds?: RegionBounds;
  sheetSettings?: LabelSheetSettings;
  footerRepeatMode?: FooterRepeatMode;
  sampleData?: TData;
  footerReserveHeight?: number;
  advancedLayoutEditing?: boolean;
}

export type TemplateStatus = 'active' | 'archived' | 'deleted';

export type TemplateMeta = {
  templateId: string;
  baseTemplateId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  status: TemplateStatus;
  archivedAt?: string;
  deletedAt?: string;
  pinned?: boolean;
  lastOpenedAt?: string;
};

// ---- サンプル ----

export const SAMPLE_DATA: TemplateDataRecord = {
  CustomerName: 'サンプル株式会社',
  EstimateDate: '2024-11-15',
  Items: [
    { ItemName: '部品A', Qty: 10, UnitPrice: 1200, Amount: 12000 },
    { ItemName: '部品B', Qty: 5, UnitPrice: 5000, Amount: 25000 },
  ],
  TotalAmount: '¥37,000-',
};

export const SAMPLE_TEMPLATE: TemplateDefinition = {
  id: 'template_001',
  name: '標準見積書',
  pageSize: 'A4',
  orientation: 'portrait',
  structureType: 'list_v1',
  footerRepeatMode: 'last',
  footerReserveHeight: 150,
  elements: [
    {
      id: 'title',
      slotId: 'doc_title',
      type: 'text',
      region: 'header',
      x: 50,
      y: 782,
      fontSize: 24,
      fontWeight: 'bold',
      dataSource: { type: 'static', value: '御見積書' },
    },
    {
      id: 'customer_name',
      slotId: 'to_name',
      type: 'text',
      region: 'header',
      x: 90,
      y: 722,
      fontSize: 12,
      fontWeight: 'bold',
      dataSource: { type: 'kintone', fieldCode: 'CustomerName' },
    },
    {
      id: 'estimate_date_label',
      type: 'label',
      region: 'header',
      x: 350,
      y: 722,
      fontSize: 12,
      text: '見積日',
    },
    {
      id: 'estimate_date',
      slotId: 'issue_date',
      type: 'text',
      region: 'header',
      x: 410,
      y: 722,
      fontSize: 12,
      dataSource: { type: 'kintone', fieldCode: 'EstimateDate' },
    },
    {
      id: 'doc_no',
      slotId: 'doc_no',
      type: 'text',
      region: 'header',
      x: 350,
      y: 752,
      fontSize: 10,
      width: 220,
      height: 20,
      dataSource: { type: 'static', value: '' },
    },
    {
      id: 'logo',
      slotId: 'logo',
      type: 'image',
      region: 'header',
      x: 450,
      y: 772,
      width: 120,
      height: 60,
      dataSource: { type: 'static', value: '' },
    },
    {
      id: 'items',
      type: 'table',
      region: 'body',
      x: 50,
      y: 160,
      width: 520,
      rowHeight: 20,
      headerHeight: 24,
      dataSource: { type: 'kintoneSubtable', fieldCode: 'Items' },
      columns: [
        { id: 'item_name', title: '品名', fieldCode: 'ItemName', width: 220 },
        { id: 'qty', title: '数量', fieldCode: 'Qty', width: 80, align: 'right' },
        {
          id: 'unit_price',
          title: '単価',
          fieldCode: 'UnitPrice',
          width: 100,
          align: 'right',
        },
        {
          id: 'amount',
          title: '金額',
          fieldCode: 'Amount',
          width: 120,
          align: 'right',
        },
      ],
      showGrid: true,
    },
    {
      id: 'remarks',
      slotId: 'remarks',
      type: 'text',
      region: 'footer',
      x: 50,
      y: 120,
      fontSize: 10,
      width: 520,
      height: 60,
      dataSource: { type: 'static', value: '' },
    },
    {
      id: 'total_label',
      type: 'label',
      region: 'footer',
      x: 300,
      y: 70,
      fontSize: 14,
      fontWeight: 'bold',
      text: '合計',
    },
    {
      id: 'total',
      slotId: 'total',
      type: 'text',
      region: 'footer',
      x: 350,
      y: 70,
      fontSize: 14,
      fontWeight: 'bold',
      dataSource: { type: 'kintone', fieldCode: 'TotalAmount' },
    },
  ],
    mapping: {
    header: {
      doc_title: { kind: 'staticText', text: '御見積書' },
      to_name: { kind: 'recordField', fieldCode: 'CustomerName' },
      issue_date: { kind: 'recordField', fieldCode: 'EstimateDate' },
    },
    table: {
      source: { kind: 'subtable', fieldCode: 'Items' },
      columns: [
        { id: 'item_name', label: '品名', value: { kind: 'subtableField', subtableCode: 'Items', fieldCode: 'ItemName' }, widthPct: 52, align: 'left', format: 'text' },
        { id: 'qty', label: '数量', value: { kind: 'subtableField', subtableCode: 'Items', fieldCode: 'Qty' }, widthPct: 12, align: 'right', format: 'number' },
        { id: 'unit_price', label: '単価', value: { kind: 'subtableField', subtableCode: 'Items', fieldCode: 'UnitPrice' }, widthPct: 18, align: 'right', format: 'currency' },
        { id: 'amount', label: '金額', value: { kind: 'subtableField', subtableCode: 'Items', fieldCode: 'Amount' }, widthPct: 18, align: 'right', format: 'currency' },
      ],
    },
    footer: {
      total: { kind: 'recordField', fieldCode: 'TotalAmount' },
    },
  },
  sampleData: SAMPLE_DATA,
};
