export type PageSize = 'A4';
export type Orientation = 'portrait' | 'landscape';

export type DataSource =
  | { type: 'static'; value: string }
  | { type: 'kintone'; fieldCode: string }
  | { type: 'kintoneSubtable'; fieldCode: string };

export interface BaseElement {
  id: string;
  type: 'text' | 'table' | 'image'　| 'label';
  x: number;
  y: number;
  width?: number;
  height?: number;
}

export interface TextElement extends BaseElement {
  type: 'text';
  fontSize?: number;
  fontWeight?: 'normal' | 'bold';
  dataSource: DataSource;
}

export interface LabelElement extends BaseElement {
  type: 'label';
  fontSize?: number;
  fontWeight?: 'normal' | 'bold';
  text: string;
}

export interface TableColumn {
  id: string;
  title: string;
  fieldCode: string;
  width: number;
  align?: 'left' | 'center' | 'right';
}

export interface TableElement extends BaseElement {
  type: 'table';
  rowHeight?: number;
  headerHeight?: number;
  dataSource: Extract<DataSource, { type: 'kintoneSubtable' }>;
  columns: TableColumn[];
  showGrid?: boolean;
}

export interface ImageElement extends BaseElement {
  type: 'image';
  dataSource: Extract<DataSource, { type: 'static' }>;
}

export type TemplateElement = TextElement | LabelElement | TableElement | ImageElement;

export interface TemplateDefinition {
  id: string;
  name: string;
  pageSize: PageSize;
  orientation: Orientation;
  elements: TemplateElement[];
}

export type TemplateDataRecord = Record<string, unknown>;

export const SAMPLE_TEMPLATE: TemplateDefinition = {
  id: 'template_001',
  name: '標準見積書',
  pageSize: 'A4',
  orientation: 'portrait',
  elements: [
    {
      id: 'title',
      type: 'text',
      x: 50,
      y: 780,
      fontSize: 16,
      fontWeight: 'bold',
      dataSource: { type: 'static', value: '御見積書' },
    },
    {
      id: 'customer',
      type: 'text',
      x: 50,
      y: 740,
      fontSize: 12,
      dataSource: { type: 'kintone', fieldCode: 'CustomerName' },
    },
    {
      id: 'date',
      type: 'text',
      x: 400,
      y: 740,
      fontSize: 12,
      dataSource: { type: 'kintone', fieldCode: 'EstimateDate' },
    },
    {
      id: 'items',
      type: 'table',
      x: 40,
      y: 600,
      width: 515,
      rowHeight: 20,
      headerHeight: 24,
      dataSource: { type: 'kintoneSubtable', fieldCode: 'Items' },
      columns: [
        { id: 'name', title: '品名', fieldCode: 'ItemName', width: 215 },
        { id: 'qty', title: '数量', fieldCode: 'Qty', width: 80, align: 'right' },
        { id: 'unit', title: '単価', fieldCode: 'UnitPrice', width: 100, align: 'right' },
        { id: 'amount', title: '金額', fieldCode: 'Amount', width: 120, align: 'right' },
      ],
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
};

export const SAMPLE_DATA = {
  CustomerName: 'サンプル株式会社',
  EstimateDate: '2024-11-15',
  Items: [
    { ItemName: '部品A', Qty: 10, UnitPrice: 1200, Amount: 12000 },
    { ItemName: '部品B', Qty: 5, UnitPrice: 5000, Amount: 25000 },
  ],
  TotalAmount: '¥37,000-'
};
