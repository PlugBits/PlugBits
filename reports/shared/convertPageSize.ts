import type {
  TemplateDefinition,
  TemplateElement,
  TableElement,
  CardListElement,
  TextElement,
  LabelElement,
  ImageElement,
  RegionBounds,
  PageSize,
  Orientation,
  TableColumn,
} from './template';
import { getPageDimensions } from './template';

type Scale = { sx: number; sy: number; sMin: number };
type ConvertDebugOptions = {
  enabled?: boolean;
  requestId?: string;
  reason?: string;
  templateId?: string;
};

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

const scaleNumber = (value: number | undefined, scale: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value * scale : value;

const scaleElementBase = (element: TemplateElement, scale: Scale): TemplateElement => ({
  ...element,
  x: element.x * scale.sx,
  y: element.y * scale.sy,
  width: scaleNumber(element.width, scale.sx),
  height: scaleNumber(element.height, scale.sy),
  borderWidth: scaleNumber(element.borderWidth, scale.sMin),
  cornerRadius: scaleNumber(element.cornerRadius, scale.sMin),
});

const scaleTextLike = (
  element: TextElement | LabelElement,
  scale: Scale,
): TemplateElement => ({
  ...scaleElementBase(element, scale),
  fontSize: scaleNumber(element.fontSize, scale.sy),
});

const scaleTableColumns = (columns: TableColumn[], scale: Scale): TableColumn[] =>
  columns.map((col) => ({
    ...col,
    width: col.width * scale.sx,
    minFontSize: scaleNumber(col.minFontSize, scale.sy),
  }));

const scaleTableElement = (element: TableElement, scale: Scale): TemplateElement => ({
  ...scaleElementBase(element, scale),
  rowHeight: scaleNumber(element.rowHeight, scale.sy),
  headerHeight: scaleNumber(element.headerHeight, scale.sy),
  columns: scaleTableColumns(element.columns, scale),
  summary: element.summary
    ? {
        ...element.summary,
        style: element.summary.style
          ? {
              ...element.summary.style,
              totalTopBorderWidth: scaleNumber(
                element.summary.style.totalTopBorderWidth,
                scale.sMin,
              ),
            }
          : undefined,
      }
    : undefined,
});

const scaleCardListElement = (element: CardListElement, scale: Scale): TemplateElement => ({
  ...scaleElementBase(element, scale),
  cardHeight: element.cardHeight * scale.sy,
  gapY: scaleNumber(element.gapY, scale.sy),
  padding: scaleNumber(element.padding, scale.sMin),
  borderWidth: scaleNumber(element.borderWidth, scale.sMin),
  cornerRadius: scaleNumber(element.cornerRadius, scale.sMin),
});

const scaleImageElement = (element: ImageElement, scale: Scale): TemplateElement => ({
  ...scaleElementBase(element, scale),
});

export const convertRegionBounds = (
  bounds: RegionBounds,
  scale: Scale,
): RegionBounds => ({
  header: { yTop: bounds.header.yTop * scale.sy, yBottom: bounds.header.yBottom * scale.sy },
  body: { yTop: bounds.body.yTop * scale.sy, yBottom: bounds.body.yBottom * scale.sy },
  footer: { yTop: bounds.footer.yTop * scale.sy, yBottom: bounds.footer.yBottom * scale.sy },
});

export const convertElement = (element: TemplateElement, scale: Scale): TemplateElement => {
  switch (element.type) {
    case 'text':
    case 'label':
      return scaleTextLike(element, scale);
    case 'table':
      return scaleTableElement(element, scale);
    case 'cardList':
      return scaleCardListElement(element, scale);
    case 'image':
      return scaleImageElement(element, scale);
    default:
      return scaleElementBase(element, scale);
  }
};

export const convertTemplateForPageSize = (
  template: TemplateDefinition,
  nextPageSize: PageSize,
  nextOrientation: Orientation = template.orientation,
  debug?: ConvertDebugOptions,
): TemplateDefinition => {
  if (template.structureType === 'label_v1') {
    return { ...template, pageSize: nextPageSize, orientation: nextOrientation };
  }

  const debugEnabled = debug?.enabled === true;
  const before = debugEnabled ? buildTemplateFingerprint(template) : null;
  const currentSize = template.pageSize ?? 'A4';
  const currentOrientation = template.orientation ?? 'portrait';
  const current = getPageDimensions(currentSize, currentOrientation);
  const next = getPageDimensions(nextPageSize, nextOrientation);
  const sx = next.width / current.width;
  const sy = next.height / current.height;
  const scale: Scale = { sx, sy, sMin: Math.min(sx, sy) };

  const elements = template.elements.map((el) => convertElement(el, scale));
  const regionBounds = template.regionBounds
    ? convertRegionBounds(template.regionBounds, scale)
    : undefined;

  const converted = {
    ...template,
    pageSize: nextPageSize,
    orientation: nextOrientation,
    elements,
    regionBounds,
    footerReserveHeight: scaleNumber(template.footerReserveHeight, scale.sy),
  };
  if (debugEnabled) {
    const after = buildTemplateFingerprint(converted);
    const templateId = debug?.templateId ?? template.id ?? '';
    const regionCount = converted.regionBounds ? 3 : 0;
    console.debug(
      `[DBG_CONVERT_PAGESIZE] requestId=${debug?.requestId ?? ''} templateId=${templateId} ` +
        `reason=${debug?.reason ?? ''} from=${currentSize}/${currentOrientation} to=${nextPageSize}/${nextOrientation} ` +
        `scaleX=${sx.toFixed(6)} scaleY=${sy.toFixed(6)} elements=${elements.length} regionBounds=${regionCount} ` +
        `beforeHash=${before?.hash ?? ''} afterHash=${after.hash} beforeJsonLen=${before?.jsonLen ?? ''} afterJsonLen=${after.jsonLen}`,
    );
  }
  return converted;
};

const approxLessOrEqual = (value: number, limit: number) =>
  Number.isFinite(value) && value <= limit * 1.02;

const getElementWidthValue = (element: TemplateElement) => {
  if (element.type === 'table') {
    return element.columns.reduce((sum, col) => sum + col.width, 0);
  }
  if (element.type === 'cardList') {
    return element.width ?? 520;
  }
  return element.width ?? 0;
};

const getElementHeightValue = (element: TemplateElement) => {
  if (element.type === 'table') {
    const header = element.headerHeight ?? 24;
    const rows = (element.rowHeight ?? 18) * 3;
    return header + rows;
  }
  if (element.type === 'cardList') {
    return element.cardHeight ?? 90;
  }
  return element.height ?? 0;
};

export const needsPageSizeNormalization = (
  template: TemplateDefinition,
  assumedPageSize: PageSize,
  assumedOrientation: Orientation = template.orientation,
): boolean => {
  if (template.structureType === 'label_v1') return false;
  const { width, height } = getPageDimensions(assumedPageSize, assumedOrientation);
  const maxRight = Math.max(
    0,
    ...template.elements.map((el) => {
      const w = getElementWidthValue(el);
      return (Number.isFinite(el.x) ? el.x : 0) + w;
    }),
  );
  const maxBottom = Math.max(
    0,
    ...template.elements.map((el) => {
      const h = getElementHeightValue(el);
      return (Number.isFinite(el.y) ? el.y : 0) + h;
    }),
  );

  const withinWidth = approxLessOrEqual(maxRight, width);
  const withinHeight = approxLessOrEqual(maxBottom, height);
  return !(withinWidth && withinHeight);
};

export const normalizeTemplateForPageSize = (
  template: TemplateDefinition,
  debug?: ConvertDebugOptions,
): { template: TemplateDefinition; didNormalize: boolean } => {
  if (template.structureType === 'label_v1') {
    return { template, didNormalize: false };
  }
  const debugEnabled = debug?.enabled === true;
  const before = debugEnabled ? buildTemplateFingerprint(template) : null;
  const currentSize = template.pageSize ?? 'A4';
  const altSize: PageSize = currentSize === 'A4' ? 'Letter' : 'A4';
  const needsCurrent = needsPageSizeNormalization(
    template,
    currentSize,
    template.orientation ?? 'portrait',
  );
  if (!needsCurrent) {
    if (debugEnabled) {
      const templateId = debug?.templateId ?? template.id ?? '';
      console.debug(
        `[DBG_NORMALIZE_PAGESIZE] requestId=${debug?.requestId ?? ''} templateId=${templateId} ` +
          `reason=${debug?.reason ?? ''} pageSize=${currentSize} didNormalize=false needsCurrent=false ` +
          `hash=${before?.hash ?? ''} jsonLen=${before?.jsonLen ?? ''}`,
      );
    }
    return { template, didNormalize: false };
  }

  const fitsAlt = !needsPageSizeNormalization(
    template,
    altSize,
    template.orientation ?? 'portrait',
  );

  if (!fitsAlt) {
    if (debugEnabled) {
      const templateId = debug?.templateId ?? template.id ?? '';
      console.debug(
        `[DBG_NORMALIZE_PAGESIZE] requestId=${debug?.requestId ?? ''} templateId=${templateId} ` +
          `reason=${debug?.reason ?? ''} pageSize=${currentSize} didNormalize=false fitsAlt=false ` +
          `hash=${before?.hash ?? ''} jsonLen=${before?.jsonLen ?? ''}`,
      );
    }
    return { template, didNormalize: false };
  }

  const converted = convertTemplateForPageSize(
    { ...template, pageSize: altSize },
    currentSize,
    template.orientation ?? 'portrait',
    debug,
  );
  if (debugEnabled) {
    const after = buildTemplateFingerprint(converted);
    const templateId = debug?.templateId ?? template.id ?? '';
    console.debug(
      `[DBG_NORMALIZE_PAGESIZE] requestId=${debug?.requestId ?? ''} templateId=${templateId} ` +
        `reason=${debug?.reason ?? ''} pageSize=${currentSize} didNormalize=true ` +
        `beforeHash=${before?.hash ?? ''} afterHash=${after.hash} beforeJsonLen=${before?.jsonLen ?? ''} afterJsonLen=${after.jsonLen}`,
    );
  }
  return { template: converted, didNormalize: true };
};
