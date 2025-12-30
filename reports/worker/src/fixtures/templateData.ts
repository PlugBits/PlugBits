import type { TemplateDataRecord } from '../../../shared/template.js';

const makeLongText = (length: number) => 'X'.repeat(length);

const makeItems = (
  count: number,
  itemName: string,
  overrides?: { unitPrice?: string; amount?: string },
): TemplateDataRecord[] =>
  Array.from({ length: count }, (_, index) => ({
    ItemName: `${itemName} ${index + 1}`,
    Qty: index + 1,
    UnitPrice: overrides?.unitPrice ?? '1234567890',
    Amount: overrides?.amount ?? '9876543210',
  }));

const LONG_TEXT = makeLongText(200);

const fixtures: Record<string, TemplateDataRecord> = {
  longtext: {
    CustomerName: makeLongText(200),
    EstimateDate: '2025-01-15',
    Remarks: makeLongText(240),
    TotalAmount: '1234567890',
    Items: makeItems(10, LONG_TEXT),
  },
  bigNumber: {
    CustomerName: 'Big Number Co.',
    EstimateDate: '2025-01-15',
    TotalAmount: '1234567890123456',
    Items: makeItems(3, 'BigNumberItem', {
      unitPrice: '1234567890123456',
      amount: '9876543210987654',
    }),
  },
  badImage: {
    CustomerName: 'Bad Image Co.',
    EstimateDate: '2025-01-15',
    LogoUrl404: 'https://example.com/404.png',
    LogoUrlText: 'https://example.com/',
    LogoUrlNonHttp: 'file://not-allowed',
    Items: makeItems(2, 'BadImageItem'),
  },
  emptyRows: {
    CustomerName: 'Empty Rows Co.',
    EstimateDate: '2025-01-15',
    Items: [],
  },
  emptyRowsUndefined: {
    CustomerName: 'Empty Rows Undefined Co.',
    EstimateDate: '2025-01-15',
  },
  summaryBasic: {
    CustomerName: 'Summary Basic Co.',
    EstimateDate: '2025-01-15',
    Items: [
      { ItemName: 'Item A', Qty: 1, UnitPrice: '1000', Amount: '1000' },
      { ItemName: 'Item B', Qty: 2, UnitPrice: '2000', Amount: '2000' },
      { ItemName: 'Item C', Qty: 3, UnitPrice: '3000', Amount: '3000' },
    ],
  },
  summaryPaging: {
    CustomerName: 'Summary Paging Co.',
    EstimateDate: '2025-01-15',
    Items: makeItems(60, LONG_TEXT, { unitPrice: '1000', amount: '1000' }),
  },
  summaryPagingTight: {
    CustomerName: 'Summary Paging Tight Co.',
    EstimateDate: '2025-01-15',
    Items: makeItems(40, LONG_TEXT, { unitPrice: '1000', amount: '1000' }),
  },
};

export const getFixtureData = (name: string): TemplateDataRecord | undefined =>
  fixtures[name];
