import {
  TEMPLATE_SCHEMA_VERSION,
  type TemplateDefinition,
  type TemplateElement,
  type TableElement,
  type TableColumn,
  type CardListElement,
  type PageSize,
  type Orientation,
  getPageDimensions,
} from '../../../shared/template.js';
import { normalizeTemplateForPageSize } from '../../../shared/convertPageSize.js';

export type TemplateIssue = {
  level: 'warn' | 'error';
  code: string;
  message: string;
  path?: string;
};

type MigrateDebugOptions = {
  enabled?: boolean;
  requestId?: string;
  reason?: string;
  templateId?: string;
};

const PAGE_SIZES: PageSize[] = ['A4', 'Letter'];
const ORIENTATIONS: Orientation[] = ['portrait', 'landscape'];
const ESTIMATE_V1_PRESET_REV = 2;
const ESTIMATE_V1_COMPANY_X = 360;
const ESTIMATE_V1_COMPANY_WIDTH = 200;
const ESTIMATE_V1_COMPANY_TARGETS = {
  company_name: { y: 58, fontSize: 11, height: 14, fontWeight: 'bold' as const },
  company_address: { y: 76, fontSize: 9, height: 12 },
  company_tel: { y: 90, fontSize: 9, height: 12 },
  company_email: { y: 104, fontSize: 9, height: 12 },
} as const;
const ESTIMATE_V1_COMPANY_LEGACY = {
  company_name: { y: [112, 128] },
  company_address: { y: [126, 146] },
  company_tel: { y: [138, 162] },
  company_email: { y: [150, 178] },
} as const;

const isItemNameColumn = (col: TableColumn) =>
  col.id === 'item_name' || col.fieldCode === 'ItemName';

const stableStringify = (value: unknown): string => {
  const seen = new WeakSet<object>();
  const stringify = (input: unknown): string => {
    if (input === null || typeof input === 'number' || typeof input === 'boolean') {
      return JSON.stringify(input);
    }
    if (typeof input === 'string') {
      return JSON.stringify(input);
    }
    if (typeof input !== 'object') {
      return 'null';
    }
    const obj = input as Record<string, unknown>;
    if (seen.has(obj)) return '"[Circular]"';
    seen.add(obj);
    if (Array.isArray(obj)) {
      const items = obj.map((item) => {
        if (item === undefined || typeof item === 'function' || typeof item === 'symbol') {
          return 'null';
        }
        return stringify(item);
      });
      return `[${items.join(',')}]`;
    }
    const keys = Object.keys(obj).sort();
    const entries: string[] = [];
    for (const key of keys) {
      const val = obj[key];
      if (val === undefined || typeof val === 'function' || typeof val === 'symbol') continue;
      entries.push(`${JSON.stringify(key)}:${stringify(val)}`);
    }
    return `{${entries.join(',')}}`;
  };
  return stringify(value);
};

const hashStringFNV1a = (input: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
};

const buildTemplateFingerprint = (template: TemplateDefinition) => {
  const json = stableStringify(template);
  return {
    jsonLen: json.length,
    elements: Array.isArray(template.elements) ? template.elements.length : 0,
    hash: hashStringFNV1a(json),
  };
};

export const applyEstimateV1PresetPatch = (
  template: TemplateDefinition,
): TemplateDefinition => {
  const baseTemplateId = template.baseTemplateId ?? template.id;
  const structureType = template.structureType ?? baseTemplateId;
  if (baseTemplateId !== 'estimate_v1' && structureType !== 'estimate_v1') {
    return template;
  }

  const presetRevision = template.settings?.presetRevision ?? 1;
  if (presetRevision >= ESTIMATE_V1_PRESET_REV) return template;

  if (!Array.isArray(template.elements)) {
    return {
      ...template,
      settings: {
        ...(template.settings ?? {}),
        presetRevision: ESTIMATE_V1_PRESET_REV,
      },
    };
  }

  const elements = [...template.elements];
  const bySlot = new Map<string, number>();
  elements.forEach((el, index) => {
    const slotId = (el as any).slotId ?? el.id;
    if (slotId) bySlot.set(String(slotId), index);
  });

  const isNear = (value: unknown, target: number, tolerance = 20) =>
    typeof value === 'number' && Math.abs(value - target) <= tolerance;

  const shouldUpdate = (el: TemplateElement, slotId: keyof typeof ESTIMATE_V1_COMPANY_LEGACY) => {
    if (el.type !== 'text') return false;
    const legacyYs = ESTIMATE_V1_COMPANY_LEGACY[slotId]?.y ?? [];
    const matchesLegacy = Array.isArray(legacyYs)
      ? legacyYs.some((legacyY) => isNear(el.y, legacyY, 20))
      : isNear(el.y, legacyYs, 20);
    if (!matchesLegacy) return false;
    if (typeof el.x === 'number' && !isNear(el.x, ESTIMATE_V1_COMPANY_X, 12)) return false;
    if (typeof el.width === 'number' && !isNear(el.width, ESTIMATE_V1_COMPANY_WIDTH, 20)) return false;
    if (el.alignX && el.alignX !== 'right') return false;
    return true;
  };

  let changed = false;
  (Object.keys(ESTIMATE_V1_COMPANY_TARGETS) as Array<
    keyof typeof ESTIMATE_V1_COMPANY_TARGETS
  >).forEach((slotId) => {
    const idx = bySlot.get(slotId);
    if (idx === undefined) {
      const target = ESTIMATE_V1_COMPANY_TARGETS[slotId];
      elements.push({
        id: slotId,
        slotId,
        type: 'text',
        region: 'header',
        x: ESTIMATE_V1_COMPANY_X,
        y: target.y,
        width: ESTIMATE_V1_COMPANY_WIDTH,
        height: target.height,
        fontSize: target.fontSize,
        fontWeight: target.fontWeight,
        alignX: 'right',
        dataSource: { type: 'static', value: '' },
      });
      changed = true;
      return;
    }

    const current = elements[idx];
    if (shouldUpdate(current, slotId)) {
      elements[idx] = { ...current, y: ESTIMATE_V1_COMPANY_TARGETS[slotId].y };
      changed = true;
    }
  });

  const nextSettings = {
    ...(template.settings ?? {}),
    presetRevision: ESTIMATE_V1_PRESET_REV,
  };

  if (!changed && template.settings?.presetRevision === ESTIMATE_V1_PRESET_REV) {
    return template;
  }

  return {
    ...template,
    elements,
    settings: nextSettings,
  };
};

export const migrateTemplate = (
  inputTemplate: TemplateDefinition,
  debug?: MigrateDebugOptions,
): TemplateDefinition => {
  const debugEnabled = debug?.enabled === true;
  const before = debugEnabled ? buildTemplateFingerprint(inputTemplate) : null;
  const templateId = debug?.templateId ?? inputTemplate.id ?? '';
  const MIN_TABLE_GAP = 16;
  const MAX_TABLE_GAP = 40;
  const FOOTER_LEGACY_TOLERANCE = 20;
  const HEADER_LEGACY_TOLERANCE = 20;
  const clampNumber = (value: number, min: number, max: number) =>
    Math.min(Math.max(value, min), max);
  const resolveElementHeightForYMode = (element: TemplateElement) => {
    if (typeof (element as any).height === 'number') return (element as any).height;
    if (element.type === 'table') {
      return (element as TableElement).headerHeight ?? (element as TableElement).rowHeight ?? 18;
    }
    if (element.type === 'cardList') {
      return (element as CardListElement).cardHeight ?? 90;
    }
    if (element.type === 'text' || element.type === 'label') {
      const fontSize = (element as any).fontSize ?? 12;
      return fontSize * 1.2;
    }
    return 0;
  };
  const resolveTemplateHeight = (tpl: TemplateDefinition) => {
    const pageSize = tpl.pageSize ?? 'A4';
    const orientation = tpl.orientation ?? 'portrait';
    return getPageDimensions(pageSize, orientation).height;
  };
  const convertRegionBoundsToTop = (
    bounds: TemplateDefinition['regionBounds'],
    pageHeight: number,
  ) => {
    if (!bounds) return bounds;
    const convert = (b: { yTop: number; yBottom: number }) => {
      const top = pageHeight - b.yBottom;
      const bottom = pageHeight - b.yTop;
      const yTop = clampNumber(Math.min(top, bottom), 0, pageHeight);
      const yBottom = clampNumber(Math.max(top, bottom), 0, pageHeight);
      return { yTop, yBottom };
    };
    return {
      header: convert(bounds.header),
      body: convert(bounds.body),
      footer: convert(bounds.footer),
    };
  };
  const convertTemplateToTopBased = (tpl: TemplateDefinition): TemplateDefinition => {
    const pageHeight = resolveTemplateHeight(tpl);
    const elements = Array.isArray(tpl.elements)
      ? tpl.elements.map((el) => {
          if (typeof el.y !== 'number') return el;
          const height = resolveElementHeightForYMode(el);
          const yTop = pageHeight - el.y - height;
          return { ...el, y: yTop };
        })
      : tpl.elements;
    const regionBounds = convertRegionBoundsToTop(tpl.regionBounds, pageHeight);
    return {
      ...tpl,
      elements,
      regionBounds,
      settings: {
        ...(tpl.settings ?? {}),
        yMode: 'top',
      },
    };
  };

  let template = inputTemplate;
  const rawYMode = template.settings?.yMode ?? 'bottom';
  const needsYModeMigration = rawYMode !== 'top';
  if (needsYModeMigration) {
    template = convertTemplateToTopBased(template);
  }
  if (debugEnabled) {
    console.debug(
      `[DBG_MIGRATE] requestId=${debug?.requestId ?? ''} templateId=${templateId} ` +
        `reason=${debug?.reason ?? ''} rawYMode=${rawYMode} didYMode=${needsYModeMigration} ` +
        `beforeHash=${before?.hash ?? ''} beforeJsonLen=${before?.jsonLen ?? ''}`,
    );
  }
  const FOOTER_TARGETS = {
    subtotal: { x: 360, y: 672, width: 210, height: 20, fontSize: 10 },
    tax: { x: 360, y: 692, width: 210, height: 20, fontSize: 10 },
    total_label: { x: 300, y: 712, width: 80, height: 20, fontSize: 10 },
    total: { x: 360, y: 712, width: 210, height: 24, fontSize: 14, fontWeight: 'bold' },
    remarks: { x: 50, y: 752, width: 520, height: 60, fontSize: 10 },
  } as const;
  const FOOTER_LEGACY = {
    remarks: { x: 50, y: 722 },
    total_label: { x: 300, y: 692 },
    total: { x: 360, y: 692 },
  } as const;
  const FOOTER_ORDER = ['subtotal', 'tax', 'total_label', 'total', 'remarks'] as const;
  const HEADER_TARGETS = {
    doc_title: {
      x: 0,
      y: 20,
      width: 240,
      height: 32,
      fontSize: 24,
      fontWeight: 'bold',
      alignX: 'center',
    },
    to_name: { x: 60, y: 102, width: 260, height: 20, fontSize: 12, fontWeight: 'bold' },
    date_label: { x: 360, y: 96, width: 56, height: 16, fontSize: 10 },
    issue_date: { x: 420, y: 96, width: 150, height: 16, fontSize: 10 },
    doc_no: { x: 360, y: 74, width: 220, height: 18, fontSize: 10 },
    logo: { x: 450, y: 2, width: 120, height: 60 },
  } as const;
  const HEADER_LEGACY = {
    doc_title: { x: 60, y: 30, width: 320 },
    to_name: { x: 60, y: 102, width: 280 },
    date_label: { x: 350, y: 106 },
    issue_date: { x: 420, y: 106 },
    doc_no: { x: 300, y: 72 },
    logo: { x: 450, y: 30 },
  } as const;
  const schemaVersion = template.schemaVersion ?? 0;
  const baseTemplateId = template.baseTemplateId ?? template.id;
  const structureTypeRaw = template.structureType as unknown as string | undefined;
  const normalizedStructureType =
    structureTypeRaw === 'line_items_v1' ? 'list_v1' : template.structureType;
  const nextStructureType =
    baseTemplateId === 'cards_v1' ? 'cards_v1' : normalizedStructureType;
  const needsEstimateV1PresetPatch =
    (baseTemplateId === 'estimate_v1' || nextStructureType === 'estimate_v1') &&
    (template.settings?.presetRevision ?? 1) < ESTIMATE_V1_PRESET_REV;
  const needsElementsNormalization = !Array.isArray(template.elements);
  const needsMappingNormalization = template.mapping == null;
  const needsStructureUpdate = nextStructureType !== template.structureType;
  const needsPageSizeUpdate = !template.pageSize;
  const resolveHeaderBottomY = (elements: TemplateElement[]) => {
    const candidates = elements.filter(
      (el) =>
        el.type !== 'table' &&
        el.type !== 'cardList' &&
        el.region !== 'footer' &&
        typeof el.y === 'number',
    );
    if (candidates.length === 0) return null;
    return Math.max(
      ...candidates.map((el) => (el.y as number) + resolveElementHeightForYMode(el)),
    );
  };
  const resolveElementsBySlot = (
    elements: TemplateElement[],
    region?: 'header' | 'footer',
  ) => {
    const bySlot = new Map<string, TemplateElement>();
    for (const el of elements) {
      if (region && el.region !== region) continue;
      const slotId = (el as any).slotId ?? el.id;
      if (slotId) {
        bySlot.set(String(slotId), el);
      }
    }
    return bySlot;
  };
  const isNear = (value: unknown, target: number) =>
    typeof value === 'number' && Math.abs(value - target) <= FOOTER_LEGACY_TOLERANCE;
  const isNearHeader = (value: unknown, target: number) =>
    typeof value === 'number' && Math.abs(value - target) <= HEADER_LEGACY_TOLERANCE;
  const isLegacyFooterLayout = (elements: TemplateElement[]) => {
    const footer = resolveElementsBySlot(elements, 'footer');
    const remarks = footer.get('remarks');
    const totalLabel = footer.get('total_label');
    const total = footer.get('total');
    if (!remarks || !totalLabel || !total) return false;
    return (
      isNear((remarks as any).x, FOOTER_LEGACY.remarks.x) &&
      isNear((remarks as any).y, FOOTER_LEGACY.remarks.y) &&
      isNear((totalLabel as any).x, FOOTER_LEGACY.total_label.x) &&
      isNear((totalLabel as any).y, FOOTER_LEGACY.total_label.y) &&
      isNear((total as any).x, FOOTER_LEGACY.total.x) &&
      isNear((total as any).y, FOOTER_LEGACY.total.y)
    );
  };
  const needsListV1TableYAdjust =
    nextStructureType === 'list_v1' &&
    Array.isArray(template.elements) &&
    (() => {
      const headerBottomY = resolveHeaderBottomY(template.elements);
      if (headerBottomY == null) return false;
      return template.elements.some((el) => {
        if (el.type !== 'table') return false;
        const table = el as TableElement;
        const y = table.y;
        if (typeof y !== 'number') return false;
        const tableHeaderTopY = y;
        const gap = tableHeaderTopY - headerBottomY;
        return gap < MIN_TABLE_GAP || gap > MAX_TABLE_GAP;
      });
    })();
  const needsListV1FooterAdjust =
    nextStructureType === 'list_v1' &&
    Array.isArray(template.elements) &&
    isLegacyFooterLayout(template.elements);
  const needsListV1HeaderAdjust =
    nextStructureType === 'list_v1' &&
    Array.isArray(template.elements) &&
    (() => {
      const header = resolveElementsBySlot(template.elements, 'header');
      const docTitle = header.get('doc_title');
      const toName = header.get('to_name');
      const dateLabel = header.get('date_label');
      const issueDate = header.get('issue_date');
      const docNo = header.get('doc_no');
      const logo = header.get('logo');
      if (!docTitle || !toName || !dateLabel || !issueDate || !docNo || !logo) return false;
      return (
        isNearHeader((docTitle as any).x, HEADER_LEGACY.doc_title.x) &&
        isNearHeader((docTitle as any).y, HEADER_LEGACY.doc_title.y) &&
        isNearHeader((docTitle as any).width, HEADER_LEGACY.doc_title.width) &&
        isNearHeader((toName as any).x, HEADER_LEGACY.to_name.x) &&
        isNearHeader((toName as any).y, HEADER_LEGACY.to_name.y) &&
        isNearHeader((toName as any).width, HEADER_LEGACY.to_name.width) &&
        isNearHeader((dateLabel as any).x, HEADER_LEGACY.date_label.x) &&
        isNearHeader((dateLabel as any).y, HEADER_LEGACY.date_label.y) &&
        isNearHeader((issueDate as any).x, HEADER_LEGACY.issue_date.x) &&
        isNearHeader((issueDate as any).y, HEADER_LEGACY.issue_date.y) &&
        isNearHeader((docNo as any).x, HEADER_LEGACY.doc_no.x) &&
        isNearHeader((docNo as any).y, HEADER_LEGACY.doc_no.y) &&
        isNearHeader((logo as any).x, HEADER_LEGACY.logo.x) &&
        isNearHeader((logo as any).y, HEADER_LEGACY.logo.y)
      );
    })();
  const hasCardList = Array.isArray(template.elements)
    ? template.elements.some((el) => el.type === 'cardList')
    : false;
  const needsCardListMigration = nextStructureType === 'cards_v1' && !hasCardList;

  if (
    !needsYModeMigration &&
    schemaVersion >= TEMPLATE_SCHEMA_VERSION &&
    !needsStructureUpdate &&
    !needsPageSizeUpdate &&
    !needsCardListMigration &&
    !needsElementsNormalization &&
    !needsMappingNormalization &&
    !needsListV1TableYAdjust &&
    !needsListV1FooterAdjust &&
    !needsListV1HeaderAdjust &&
    !needsEstimateV1PresetPatch
  ) {
    return template;
  }

  const elements = Array.isArray(template.elements) ? template.elements : [];
  const migratedElements = elements.map((element): TemplateElement => {
    if (element.type !== 'table') return element;
    const table = element as TableElement;
    const columns = Array.isArray(table.columns) ? table.columns : [];
    const nextColumns = columns.map((col) => {
      const overflowRaw = (col as any).overflow;
      const normalizedOverflow =
        overflowRaw === 'wrap' ||
        overflowRaw === 'shrink' ||
        overflowRaw === 'ellipsis' ||
        overflowRaw === 'clip'
          ? overflowRaw
          : undefined;
      if (normalizedOverflow) {
        return { ...col, overflow: normalizedOverflow };
      }
      return {
        ...col,
        overflow: isItemNameColumn(col) ? ('wrap' as const) : ('shrink' as const),
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

  if (nextStructureType === 'list_v1') {
    const headerBottomY = resolveHeaderBottomY(nextElements);
    if (headerBottomY != null) {
      nextElements = nextElements.map((element) => {
        if (element.type !== 'table') return element;
        const table = element as TableElement;
        const y = table.y;
        if (typeof y !== 'number') return element;
        const tableHeaderTopY = y;
        const gap = tableHeaderTopY - headerBottomY;
        if (gap < MIN_TABLE_GAP) {
          return { ...table, y: headerBottomY + MIN_TABLE_GAP };
        }
        if (gap > MAX_TABLE_GAP) {
          return { ...table, y: headerBottomY + MAX_TABLE_GAP };
        }
        return element;
      });
    }
  }

  if (nextStructureType === 'list_v1' && isLegacyFooterLayout(nextElements)) {
    const footer = resolveElementsBySlot(nextElements, 'footer');
    const targetSlots = new Set<string>(FOOTER_ORDER);
    const adjustedFooter: TemplateElement[] = [];
    for (const slotId of FOOTER_ORDER) {
      const existing = footer.get(slotId);
      const base = existing
        ? { ...existing }
        : {
            id: slotId,
            slotId,
            type: 'text',
            region: 'footer',
            footerRepeatMode: 'last',
            dataSource: { type: 'static', value: '' },
          };
      const layout = FOOTER_TARGETS[slotId];
      const next = { ...base, ...layout } as any;
      if (slotId === 'total') {
        next.fontWeight = 'bold';
      } else if ('fontWeight' in next) {
        delete next.fontWeight;
      }
      adjustedFooter.push(next as TemplateElement);
    }

    const nonFooter = nextElements.filter((el) => el.region !== 'footer');
    const otherFooter = nextElements.filter((el) => {
      if (el.region !== 'footer') return false;
      const slotId = (el as any).slotId ?? el.id;
      return !targetSlots.has(String(slotId));
    });
    nextElements = [...nonFooter, ...otherFooter, ...adjustedFooter];
  }

  if (nextStructureType === 'list_v1' && needsListV1HeaderAdjust) {
    const header = resolveElementsBySlot(nextElements, 'header');
    const applyHeaderPatch = (slotId: keyof typeof HEADER_TARGETS) => {
      const element = header.get(slotId);
      if (!element) return;
      const patch = HEADER_TARGETS[slotId];
      const next = { ...(element as any), ...patch };
      if (slotId === 'doc_title') {
        const ds = (next as any).dataSource;
        if (ds?.type === 'static' && (!ds.value || ds.value === '一覧表')) {
          next.dataSource = { ...ds, value: '御見積書' };
        }
      }
      const idx = nextElements.findIndex((el) => el.id === element.id);
      if (idx >= 0) nextElements[idx] = next as TemplateElement;
    };

    applyHeaderPatch('doc_title');
    applyHeaderPatch('to_name');
    applyHeaderPatch('date_label');
    applyHeaderPatch('issue_date');
    applyHeaderPatch('doc_no');
    applyHeaderPatch('logo');

    const companyIds = new Set(['company_name', 'company_address', 'company_tel', 'company_email']);
    const hasCompany = nextElements.some((el) => {
      const slotId = (el as any).slotId ?? el.id;
      return companyIds.has(String(slotId));
    });
    if (!hasCompany) {
      nextElements.push(
        {
          id: 'company_name',
          slotId: 'company_name',
          type: 'text',
          region: 'header',
          x: 360,
          y: 112,
          width: 200,
          height: 14,
          fontSize: 10,
          fontWeight: 'bold',
          dataSource: { type: 'static', value: '' },
        },
        {
          id: 'company_address',
          slotId: 'company_address',
          type: 'text',
          region: 'header',
          x: 360,
          y: 126,
          width: 200,
          height: 12,
          fontSize: 9,
          dataSource: { type: 'static', value: '' },
        },
        {
          id: 'company_tel',
          slotId: 'company_tel',
          type: 'text',
          region: 'header',
          x: 360,
          y: 138,
          width: 200,
          height: 12,
          fontSize: 9,
          dataSource: { type: 'static', value: '' },
        },
        {
          id: 'company_email',
          slotId: 'company_email',
          type: 'text',
          region: 'header',
          x: 360,
          y: 150,
          width: 200,
          height: 12,
          fontSize: 9,
          dataSource: { type: 'static', value: '' },
        },
      );
    }
  }

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

  const migratedTemplate: TemplateDefinition = {
    ...template,
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    structureType: nextStructureType,
    pageSize: template.pageSize ?? 'A4',
    elements: nextElements,
    mapping,
  };

  const patched = applyEstimateV1PresetPatch(migratedTemplate);
  const normalized = normalizeTemplateForPageSize(patched, debug);
  if (debugEnabled) {
    const after = buildTemplateFingerprint(normalized.template);
    console.debug(
      `[DBG_MIGRATE] requestId=${debug?.requestId ?? ''} templateId=${templateId} ` +
        `reason=${debug?.reason ?? ''} didNormalize=${normalized.didNormalize} ` +
        `afterHash=${after.hash} afterJsonLen=${after.jsonLen}`,
    );
  }
  return normalized.template;
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
