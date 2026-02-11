import type { TemplateDefinition } from '@shared/template';
import type { ListV1Mapping } from './Mapping/adapters/list_v1';

export type IssueSeverity = 'error' | 'warn';
export type IssueCode =
  | 'E_REQUIRED_SLOT'
  | 'E_EMPTY_VALUE'
  | 'E_SUBTABLE_EMPTY'
  | 'E_SUBTABLE_COL_EMPTY'
  | 'W_TYPE_MISMATCH'
  | 'W_OVERFLOW';

export type IssueGroup =
  | '宛先'
  | '右上メタ'
  | '明細'
  | '合計'
  | '補助'
  | '振込先'
  | '会社情報';

export type Issue = {
  severity: IssueSeverity;
  code: IssueCode;
  slotId?: string;
  tableId?: string;
  colSlotId?: string;
  group: IssueGroup;
  label: string;
  message: string;
};

type RequiredLevel = 'error' | 'warn' | 'none';

type SlotRule = {
  slotId: string;
  label: string;
  group: IssueGroup;
  required: RequiredLevel;
  region: 'header' | 'footer';
};

type ColumnRule = {
  columnId: string;
  label: string;
  required: RequiredLevel;
};

type TableRule = {
  tableId: string;
  label: string;
  group: IssueGroup;
  required: RequiredLevel;
  minRows: number;
  columns: ColumnRule[];
};

type PresetDefinition = {
  id: 'estimate_v1' | 'invoice_v1';
  name: string;
  slots: SlotRule[];
  table: TableRule;
};

export const ISSUE_GROUP_ORDER: IssueGroup[] = [
  '宛先',
  '右上メタ',
  '明細',
  '合計',
  '補助',
  '振込先',
  '会社情報',
];

const LIST_V1_PRESETS: Record<PresetDefinition['id'], PresetDefinition> = {
  estimate_v1: {
    id: 'estimate_v1',
    name: '見積書',
    slots: [
      { slotId: 'to_name', label: '宛先名', group: '宛先', required: 'error', region: 'header' },
      { slotId: 'doc_no', label: '文書番号', group: '右上メタ', required: 'error', region: 'header' },
      { slotId: 'issue_date', label: '日付', group: '右上メタ', required: 'error', region: 'header' },
      { slotId: 'total', label: '合計', group: '合計', required: 'error', region: 'footer' },
      { slotId: 'remarks', label: '備考', group: '補助', required: 'none', region: 'footer' },
      { slotId: 'subtotal', label: '小計', group: '合計', required: 'none', region: 'footer' },
      { slotId: 'tax', label: '税', group: '合計', required: 'none', region: 'footer' },
    ],
    table: {
      tableId: 'items',
      label: '明細テーブル',
      group: '明細',
      required: 'error',
      minRows: 1,
      columns: [
        { columnId: 'item_name', label: '品名', required: 'error' },
        { columnId: 'amount', label: '金額', required: 'error' },
        { columnId: 'qty', label: '数量', required: 'warn' },
        { columnId: 'unit_price', label: '単価', required: 'warn' },
      ],
    },
  },
  invoice_v1: {
    id: 'invoice_v1',
    name: '請求書',
    slots: [
      { slotId: 'to_name', label: '宛先名', group: '宛先', required: 'error', region: 'header' },
      { slotId: 'doc_no', label: '文書番号', group: '右上メタ', required: 'error', region: 'header' },
      { slotId: 'issue_date', label: '日付', group: '右上メタ', required: 'error', region: 'header' },
      { slotId: 'due_date_value', label: '支払期限', group: '右上メタ', required: 'error', region: 'header' },
      { slotId: 'payment_value', label: '振込先', group: '振込先', required: 'warn', region: 'footer' },
      { slotId: 'total', label: '合計', group: '合計', required: 'error', region: 'footer' },
      { slotId: 'remarks', label: '備考', group: '補助', required: 'none', region: 'footer' },
    ],
    table: {
      tableId: 'items',
      label: '明細テーブル',
      group: '明細',
      required: 'error',
      minRows: 1,
      columns: [
        { columnId: 'item_name', label: '品名', required: 'error' },
        { columnId: 'amount', label: '金額', required: 'error' },
        { columnId: 'qty', label: '数量', required: 'warn' },
        { columnId: 'unit_price', label: '単価', required: 'warn' },
      ],
    },
  },
};

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const isEmptyValue = (value: unknown) => {
  if (value === 0) return false;
  if (typeof value === 'number' && !Number.isNaN(value)) return false;
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  return false;
};

const getRecordFieldValue = (record: Record<string, unknown> | undefined, fieldCode: string) => {
  if (!record) return undefined;
  const raw = (record as any)[fieldCode];
  if (raw && typeof raw === 'object' && 'value' in (raw as any)) {
    return (raw as any).value;
  }
  return raw;
};

const normalizeSubtableRows = (raw: unknown): Array<Record<string, unknown>> => {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => {
      if (row && typeof row === 'object' && 'value' in (row as any)) {
        const value = (row as any).value;
        if (value && typeof value === 'object') return value as Record<string, unknown>;
      }
      if (row && typeof row === 'object') return row as Record<string, unknown>;
      return null;
    })
    .filter((row): row is Record<string, unknown> => !!row);
};

const isSlotPresent = (template: TemplateDefinition, slotId: string) => {
  const elements = template.elements ?? [];
  if (elements.some((el) => (el as any).slotId === slotId)) return true;
  if (template.slotSchema?.header?.some((slot) => slot.slotId === slotId)) return true;
  if (template.slotSchema?.footer?.some((slot) => slot.slotId === slotId)) return true;
  return false;
};

const buildRequiredIssue = (rule: SlotRule, severity: IssueSeverity): Issue => ({
  severity,
  code: 'E_REQUIRED_SLOT',
  slotId: rule.slotId,
  group: rule.group,
  label: rule.label,
  message: `『${rule.label}』が未選択です。`,
});

const buildEmptyValueIssue = (rule: SlotRule, severity: IssueSeverity): Issue => ({
  severity,
  code: 'E_EMPTY_VALUE',
  slotId: rule.slotId,
  group: rule.group,
  label: rule.label,
  message: `『${rule.label}』に値が入っていません。`,
});

const buildTableRequiredIssue = (table: TableRule): Issue => ({
  severity: 'error',
  code: 'E_REQUIRED_SLOT',
  tableId: table.tableId,
  group: table.group,
  label: table.label,
  message: `『${table.label}』が未選択です。`,
});

const buildTableEmptyIssue = (table: TableRule): Issue => ({
  severity: 'error',
  code: 'E_SUBTABLE_EMPTY',
  tableId: table.tableId,
  group: table.group,
  label: table.label,
  message: '明細に行がありません。',
});

const buildColumnRequiredIssue = (table: TableRule, column: ColumnRule, severity: IssueSeverity): Issue => ({
  severity,
  code: 'E_REQUIRED_SLOT',
  tableId: table.tableId,
  colSlotId: column.columnId,
  group: table.group,
  label: column.label,
  message: `『${column.label}』が未選択です。`,
});

const buildColumnEmptyIssue = (table: TableRule, column: ColumnRule): Issue => ({
  severity: 'error',
  code: 'E_SUBTABLE_COL_EMPTY',
  tableId: table.tableId,
  colSlotId: column.columnId,
  group: table.group,
  label: column.label,
  message: `明細の『${column.label}』に値が入っていない行があります。`,
});

export const resolvePresetId = (template?: TemplateDefinition): PresetDefinition['id'] => {
  const raw = template?.settings?.presetId;
  if (raw === 'invoice_v1' || raw === 'estimate_v1') return raw;
  return 'estimate_v1';
};

export const getPresetDefinition = (id: PresetDefinition['id']) => LIST_V1_PRESETS[id];

export const collectIssues = ({
  preset,
  template,
  recordData,
}: {
  preset: PresetDefinition;
  template: TemplateDefinition;
  recordData?: Record<string, unknown> | null;
}): Issue[] => {
  const issues: Issue[] = [];
  if (template.structureType !== 'list_v1') return issues;

  const mapping = (template.mapping ?? {}) as Partial<ListV1Mapping>;
  const header = mapping.header ?? {};
  const footer = mapping.footer ?? {};

  for (const rule of preset.slots) {
    if (rule.required === 'none') continue;
    if (!isSlotPresent(template, rule.slotId)) continue;
    const ref = rule.region === 'header' ? header[rule.slotId] : footer[rule.slotId];
    const hasMapping =
      !!ref &&
      ((ref as any).kind === 'recordField' ? isNonEmptyString((ref as any).fieldCode) :
        (ref as any).kind === 'staticText' ? isNonEmptyString((ref as any).text) :
        (ref as any).kind === 'imageUrl' ? isNonEmptyString((ref as any).url) :
        false);
    if (!hasMapping) {
      issues.push(buildRequiredIssue(rule, rule.required === 'warn' ? 'warn' : 'error'));
      continue;
    }

    if (recordData && (ref as any).kind === 'recordField') {
      const value = getRecordFieldValue(recordData, (ref as any).fieldCode);
      if (isEmptyValue(value)) {
        issues.push(buildEmptyValueIssue(rule, rule.required === 'warn' ? 'warn' : 'error'));
      }
    }
  }

  const table = preset.table;
  const sourceFieldCode = mapping.table?.source?.fieldCode;
  if (table.required !== 'none' && !isNonEmptyString(sourceFieldCode)) {
    issues.push(buildTableRequiredIssue(table));
  }

  const columns = mapping.table?.columns ?? [];
  for (const columnRule of table.columns) {
    if (columnRule.required === 'none') continue;
    const mappedColumn = columns.find((col) => col.id === columnRule.columnId);
    const hasColumnMapping =
      !!mappedColumn &&
      (mappedColumn.value as any)?.kind === 'subtableField' &&
      isNonEmptyString((mappedColumn.value as any)?.fieldCode);
    if (!hasColumnMapping) {
      issues.push(buildColumnRequiredIssue(table, columnRule, columnRule.required === 'warn' ? 'warn' : 'error'));
    }
  }

  if (recordData && isNonEmptyString(sourceFieldCode)) {
    const rawRows = getRecordFieldValue(recordData, sourceFieldCode);
    const rows = normalizeSubtableRows(rawRows);
    if (rows.length < table.minRows) {
      issues.push(buildTableEmptyIssue(table));
    }

    for (const columnRule of table.columns) {
      if (columnRule.required === 'none') continue;
      const mappedColumn = columns.find((col) => col.id === columnRule.columnId);
      const fieldCode = (mappedColumn?.value as any)?.fieldCode;
      if (!isNonEmptyString(fieldCode)) continue;
      const hasEmpty = rows.some((row) => isEmptyValue(getRecordFieldValue(row, fieldCode)));
      if (hasEmpty && columnRule.required === 'error') {
        issues.push(buildColumnEmptyIssue(table, columnRule));
      }
    }
  }

  return issues;
};

export const summarizeIssues = (issues: Issue[]) => {
  let errorCount = 0;
  let warnCount = 0;
  const byGroup = new Map<IssueGroup, Issue[]>();
  const bySlot = new Map<string, Issue[]>();

  for (const issue of issues) {
    if (issue.severity === 'error') errorCount += 1;
    if (issue.severity === 'warn') warnCount += 1;
    const groupIssues = byGroup.get(issue.group) ?? [];
    groupIssues.push(issue);
    byGroup.set(issue.group, groupIssues);

    const key = issue.slotId ?? issue.colSlotId ?? issue.tableId;
    if (key) {
      const slotIssues = bySlot.get(key) ?? [];
      slotIssues.push(issue);
      bySlot.set(key, slotIssues);
    }
  }

  return { errorCount, warnCount, byGroup, bySlot };
};
