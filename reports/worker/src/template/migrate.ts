import {
  TEMPLATE_SCHEMA_VERSION,
  type TemplateDefinition,
  type TemplateElement,
  type TableElement,
  type TableColumn,
  type PageSize,
  type Orientation,
} from '../../../shared/template.js';

export type TemplateIssue = {
  level: 'warn' | 'error';
  code: string;
  message: string;
  path?: string;
};

const PAGE_SIZES: PageSize[] = ['A4', 'Letter'];
const ORIENTATIONS: Orientation[] = ['portrait', 'landscape'];

const isItemNameColumn = (col: TableColumn) =>
  col.id === 'item_name' || col.fieldCode === 'ItemName';

export const migrateTemplate = (template: TemplateDefinition): TemplateDefinition => {
  const schemaVersion = template.schemaVersion ?? 0;
  const nextStructureType =
    template.structureType === 'line_items_v1' ? 'list_v1' : template.structureType;
  const needsStructureUpdate = nextStructureType !== template.structureType;
  const needsPageSizeUpdate = !template.pageSize;
  if (schemaVersion >= TEMPLATE_SCHEMA_VERSION && !needsStructureUpdate && !needsPageSizeUpdate) {
    return template;
  }

  const elements = Array.isArray(template.elements) ? template.elements : [];
  const migratedElements = elements.map((element): TemplateElement => {
    if (element.type !== 'table') return element;
    const table = element as TableElement;
    const columns = Array.isArray(table.columns) ? table.columns : [];
    const nextColumns = columns.map((col) => {
      if (col.overflow) return col;
      return {
        ...col,
        overflow: isItemNameColumn(col) ? 'wrap' : 'shrink',
      };
    });

    return {
      ...table,
      columns: nextColumns,
    };
  });

  const mapping =
    template.mapping &&
    typeof template.mapping === 'object' &&
    (template.mapping as any).structureType === 'line_items_v1'
      ? { ...(template.mapping as Record<string, unknown>), structureType: 'list_v1' }
      : template.mapping;

  return {
    ...template,
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    structureType: nextStructureType,
    pageSize: template.pageSize ?? 'A4',
    elements: migratedElements,
    mapping,
  };
};

export const validateTemplate = (template: TemplateDefinition): { ok: boolean; issues: TemplateIssue[] } => {
  const issues: TemplateIssue[] = [];

  if (!PAGE_SIZES.includes(template.pageSize)) {
    issues.push({
      level: 'error',
      code: 'page_size_invalid',
      message: `pageSize '${String(template.pageSize)}' is not supported`,
      path: 'pageSize',
    });
  }

  if (!ORIENTATIONS.includes(template.orientation)) {
    issues.push({
      level: 'error',
      code: 'orientation_invalid',
      message: `orientation '${String(template.orientation)}' is not supported`,
      path: 'orientation',
    });
  }

  if (!Array.isArray(template.elements)) {
    issues.push({
      level: 'error',
      code: 'elements_missing',
      message: 'elements must be an array',
      path: 'elements',
    });
    return { ok: false, issues };
  }

  if (template.elements.length === 0) {
    issues.push({
      level: 'error',
      code: 'elements_empty',
      message: 'elements must not be empty',
      path: 'elements',
    });
  }

  const seenIds = new Set<string>();
  for (const element of template.elements) {
    if (!element.id || typeof element.id !== 'string') {
      issues.push({
        level: 'error',
        code: 'element_id_invalid',
        message: 'element id must be a non-empty string',
        path: 'elements.id',
      });
      continue;
    }
    if (seenIds.has(element.id)) {
      issues.push({
        level: 'error',
        code: 'element_id_duplicate',
        message: `element id '${element.id}' is duplicated`,
        path: `elements.${element.id}`,
      });
    }
    seenIds.add(element.id);

    if (element.type === 'table') {
      const table = element as TableElement;
      if (!Array.isArray(table.columns) || table.columns.length === 0) {
        issues.push({
          level: 'error',
          code: 'table_columns_empty',
          message: `table '${element.id}' must have columns`,
          path: `elements.${element.id}.columns`,
        });
        continue;
      }

      for (const col of table.columns) {
        if (!(typeof col.width === 'number') || col.width <= 0) {
          issues.push({
            level: 'error',
            code: 'column_width_invalid',
            message: `column '${col.id}' width must be positive`,
            path: `elements.${element.id}.columns.${col.id}.width`,
          });
        }
      }

      const columnIds = new Set(table.columns.map((col) => col.id));
      if (table.summary?.rows) {
        table.summary.rows.forEach((row, index) => {
          if (!columnIds.has(row.columnId)) {
            issues.push({
              level: 'warn',
              code: 'summary_column_missing',
              message: `summary row columnId '${row.columnId}' not found`,
              path: `elements.${element.id}.summary.rows.${index}.columnId`,
            });
          }
          if (row.op === 'static' && row.valueColumnId && !columnIds.has(row.valueColumnId)) {
            issues.push({
              level: 'warn',
              code: 'summary_value_column_missing',
              message: `summary row valueColumnId '${row.valueColumnId}' not found`,
              path: `elements.${element.id}.summary.rows.${index}.valueColumnId`,
            });
          }
        });
      }
    }
  }

  const ok = !issues.some((issue) => issue.level === 'error');
  return { ok, issues };
};
