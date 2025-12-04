// shared/template.ts

export type PageSize = 'A4';
export type Orientation = 'portrait' | 'landscape';

export type DataSource =
  | { type: 'static'; value: string }
  | { type: 'kintone'; fieldCode: string }
  | { type: 'kintoneSubtable'; fieldCode: string };

export interface BaseElement {
  id: string;
  type: 'text' | 'label' | 'table' | 'image';
  x: number;
  y: number;
  width?: number;
  height?: number;
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
}

// サブテーブル用テーブル
export interface TableElement extends BaseElement {
  type: 'table';
  rowHeight?: number;
  headerHeight?: number;
  dataSource: Extract<DataSource, { type: 'kintoneSubtable' }>;
  columns: TableColumn[];
  showGrid?: boolean;
}

// 静的画像
export interface ImageElement extends BaseElement {
  type: 'image';
  dataSource: Extract<DataSource, { type: 'static' }>;
}

export type TemplateElement =
  | TextElement
  | LabelElement
  | TextOrLabelElement 
  | TableElement
  | ImageElement;

export type TemplateDataRecord = Record<string, unknown>;

export interface TemplateDefinition<
  TData extends TemplateDataRecord = TemplateDataRecord,
> {
  id: string;
  name: string;
  pageSize: PageSize;
  orientation: Orientation;
  elements: TemplateElement[];
  sampleData?: TData;
}

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
  elements: [
    {
      id: 'title',
      type: 'label',
      x: 50,
      y: 50,
      fontSize: 24,
      fontWeight: 'bold',
      text: '御見積書',
    },
    {
      id: 'customer_name_label',
      type: 'label',
      x: 50,
      y: 100,
      fontSize: 12,
      text: '御中',
    },
    {
      id: 'customer_name',
      type: 'text',
      x: 90,
      y: 100,
      fontSize: 12,
      fontWeight: 'bold',
      dataSource: { type: 'kintone', fieldCode: 'CustomerName' },
    },
    {
      id: 'estimate_date_label',
      type: 'label',
      x: 350,
      y: 100,
      fontSize: 12,
      text: '見積日',
    },
    {
      id: 'estimate_date',
      type: 'text',
      x: 410,
      y: 100,
      fontSize: 12,
      dataSource: { type: 'kintone', fieldCode: 'EstimateDate' },
    },
    {
      id: 'items',
      type: 'table',
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
      id: 'total_label',
      type: 'label',
      x: 300,
      y: 560,
      fontSize: 14,
      fontWeight: 'bold',
      text: '合計',
    },
    {
      id: 'total',
      type: 'text',
      x: 350,
      y: 560,
      fontSize: 14,
      fontWeight: 'bold',
      dataSource: { type: 'kintone', fieldCode: 'TotalAmount' },
    },
  ],
  sampleData: SAMPLE_DATA,
};
