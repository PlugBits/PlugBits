import {
  TEMPLATE_SCHEMA_VERSION,
  type TemplateDefinition,
  type TemplateElement,
  type TableElement,
  type TableColumn,
  type CardListElement,
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
  const baseTemplateId = template.baseTemplateId ?? template.id;
  const normalizedStructureType =
    template.structureType === 'line_items_v1' ? 'list_v1' : template.structureType;
  const nextStructureType =
    baseTemplateId === 'cards_v1' ? 'cards_v1' : normalizedStructureType;
  const needsElementsNormalization = !Array.isArray(template.elements);
  const needsMappingNormalization = template.mapping == null;
  const needsStructureUpdate = nextStructureType !== template.structureType;
  const needsPageSizeUpdate = !template.pageSize;
  const hasCardList = Array.isArray(template.elements)
    ? template.elements.some((el) => el.type === 'cardList')
    : false;
  const needsCardListMigration = nextStructureType === 'cards_v1' && !hasCardList;

  if (
    schemaVersion >= TEMPLATE_SCHEMA_VERSION &&
    !needsStructureUpdate &&
    !needsPageSizeUpdate &&
    !needsCardListMigration &&
    !needsElementsNormalization &&
    !needsMappingNormalization
  ) {
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

  let mapping =
    template.mapping &&
    typeof template.mapping === 'object' &&
    (template.mapping as any).structureType === 'line_items_v1'
      ? { ...(template.mapping as Record<string, unknown>), structureType: 'list_v1' }
      : template.mapping;

  if (!mapping || typeof mapping !== 'object') {
    mapping = {};
  }

  let nextElements = migratedElements;

  if (nextStructureType === 'cards_v1') {
    const existingCardList = nextElements.find((el) => el.type === 'cardList');
    if (!existingCardList) {
      const table = nextElements.find((el) => el.type === 'table') as TableElement | undefined;
      const tableWidth = table?.columns?.reduce((sum, col) => sum + (col.width ?? 0), 0) ?? 520;
      const fallbackFieldCodes = [
        'card_primary_left',
        'card_primary_right',
        'card_mid_left',
        'card_mid_right',
        'card_bottom_left',
        'card_bottom_right',
      ];
      const fieldIds = ['fieldA', 'fieldB', 'fieldC', 'fieldD', 'fieldE', 'fieldF'] as const;
      const fieldLabels = ['Field A', 'Field B', 'Field C', 'Field D', 'Field E', 'Field F'] as const;
      const mappingObj = mapping as any;
      const mappingFields = (mappingObj?.cardList?.fields ?? {}) as Record<string, any>;

      const baseY = typeof table?.y === 'number' ? table.y : 520;
      const nextY = Math.min(baseY + 100, 640);
      const cardList: CardListElement = {
        id: 'cards',
        type: 'cardList',
        region: 'body',
        x: table?.x ?? 60,
        y: nextY,
        width: tableWidth,
        cardHeight: 80,
        gapY: 11,
        padding: 12,
        borderWidth: 0.6,
        borderColorGray: 0.84,
        fillGray: 0.91,
        cornerRadius: 8,
        dataSource:
          table?.dataSource?.type === 'kintoneSubtable'
            ? table.dataSource
            : { type: 'kintoneSubtable', fieldCode: 'Items' },
        fields: fieldIds.map((id, index) => ({
          id,
          label: fieldLabels[index],
          fieldCode:
            (mappingFields[id]?.kind === 'subtableField' && mappingFields[id].fieldCode
              ? mappingFields[id].fieldCode
              : table?.columns?.[index]?.fieldCode) ??
            (!table && id === 'fieldA' ? fallbackFieldCodes[0] : undefined),
          align: id === 'fieldB' || id === 'fieldD' || id === 'fieldF' ? 'right' : 'left',
        })),
      };

      nextElements = nextElements.filter((el) => el.type !== 'table');
      nextElements.push(cardList);
    }

    if (!mapping || typeof mapping !== 'object') {
      mapping = {};
    }
    const mappingObj = mapping as any;
    if (!mappingObj.cardList) {
      const tableMapping = mappingObj.table ?? {};
      const sourceFromMapping = tableMapping.source;
      const cardSource =
        sourceFromMapping?.kind === 'subtable' && sourceFromMapping.fieldCode
          ? sourceFromMapping
          : {
              kind: 'subtable',
              fieldCode:
                (nextElements.find((el) => el.type === 'cardList') as CardListElement | undefined)
                  ?.dataSource?.fieldCode ?? 'Items',
            };

      const fieldIds = ['fieldA', 'fieldB', 'fieldC', 'fieldD', 'fieldE', 'fieldF'] as const;
      const fields: Record<string, unknown> = {};
      const cols = Array.isArray(tableMapping.columns) ? tableMapping.columns : [];
      fieldIds.forEach((id, index) => {
        const col = cols[index];
        if (col?.value) {
          fields[id] = col.value;
        } else if (cardSource.fieldCode) {
          fields[id] = {
            kind: 'subtableField',
            subtableCode: cardSource.fieldCode,
            fieldCode:
              (nextElements.find((el) => el.type === 'cardList') as CardListElement | undefined)
                ?.fields?.[index]?.fieldCode ?? '',
          };
        }
      });

      mapping = {
        header: mappingObj.header ?? {},
        cardList: {
          source: cardSource,
          fields,
        },
        footer: mappingObj.footer ?? {},
      };
    }
  }

  return {
    ...template,
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    structureType: nextStructureType,
    pageSize: template.pageSize ?? 'A4',
    elements: nextElements,
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
    } else if (element.type === 'cardList') {
      const cardList = element as CardListElement;
      if (
        !cardList.dataSource ||
        cardList.dataSource.type !== 'kintoneSubtable' ||
        !cardList.dataSource.fieldCode
      ) {
        issues.push({
          level: 'error',
          code: 'cardlist_source_missing',
          message: `cardList '${element.id}' must have subtable dataSource`,
          path: `elements.${element.id}.dataSource`,
        });
      }
      if (!Array.isArray(cardList.fields) || cardList.fields.length === 0) {
        issues.push({
          level: 'error',
          code: 'cardlist_fields_empty',
          message: `cardList '${element.id}' must have fields`,
          path: `elements.${element.id}.fields`,
        });
      }
      if (!Number.isFinite(cardList.cardHeight) || cardList.cardHeight <= 0) {
        issues.push({
          level: 'error',
          code: 'cardlist_height_invalid',
          message: `cardList '${element.id}' cardHeight must be positive`,
          path: `elements.${element.id}.cardHeight`,
        });
      }
    }
  }

  const ok = !issues.some((issue) => issue.level === 'error');
  return { ok, issues };
};
