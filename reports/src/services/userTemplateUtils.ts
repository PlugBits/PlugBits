import type {
  TemplateDefinition,
  TemplateElement,
  TextElement,
  ImageElement,
  PageSize,
  LabelSheetSettings,
  TemplateSettings,
} from '@shared/template';
import { getAdapter } from '../editor/Mapping/adapters/getAdapter';

export type SlotFieldRef =
  | { kind: 'staticText'; text?: string }
  | { kind: 'recordField'; fieldCode: string }
  | { kind: 'imageUrl'; url?: string };

export type SlotLayoutOverride = {
  slotId: string;
  region: 'header' | 'footer';
  type: 'text' | 'image';
  x: number;
  y: number;
  width?: number;
  height?: number;
  fontSize?: number;
  fontWeight?: 'normal' | 'bold';
  alignX?: 'left' | 'center' | 'right';
};

export type UserTemplateOverrides = {
  slots?: Record<string, SlotFieldRef>;
  layout?: Record<string, SlotLayoutOverride>;
};

export type UserTemplatePayload = {
  baseTemplateId: string;
  pageSize?: PageSize;
  sheetSettings?: LabelSheetSettings;
  mapping?: unknown;
  overrides?: UserTemplateOverrides;
  settings?: TemplateSettings;
  meta?: { name?: string; updatedAt?: string };
};

export type UserTemplateRecord = UserTemplatePayload & {
  templateId: string;
  kintone: { baseUrl: string; appId: string };
};

const normalizeSlotRegion = (
  template: TemplateDefinition,
  slotId: string,
): 'header' | 'footer' => {
  const byElement = template.elements.find((el) => (el as any).slotId === slotId);
  if (byElement?.region === 'footer') return 'footer';
  if (byElement?.region === 'header') return 'header';

  const schema = template.slotSchema;
  if (schema?.footer?.some((slot) => slot.slotId === slotId)) return 'footer';
  return 'header';
};

const ensureTextElement = (
  base: Partial<TextElement>,
  dataSource: TextElement['dataSource'],
): TextElement => ({
  id: base.id ?? '',
  slotId: base.slotId,
  type: 'text',
  region: base.region,
  x: base.x ?? 0,
  y: base.y ?? 0,
  width: base.width,
  height: base.height,
  fontSize: base.fontSize,
  fontWeight: base.fontWeight,
  alignX: base.alignX,
  dataSource,
});

const ensureImageElement = (
  base: Partial<ImageElement>,
  dataSource: ImageElement['dataSource'],
): ImageElement => ({
  id: base.id ?? '',
  slotId: base.slotId,
  type: 'image',
  region: base.region,
  x: base.x ?? 0,
  y: base.y ?? 0,
  width: base.width,
  height: base.height,
  dataSource,
});

export const applySlotLayoutOverrides = (
  template: TemplateDefinition,
  overrides?: Record<string, SlotLayoutOverride>,
): TemplateDefinition => {
  if (!overrides || Object.keys(overrides).length === 0) {
    return template;
  }

  const next = structuredClone(template);
  const elements = [...(next.elements ?? [])];

  for (const slotId of Object.keys(overrides)) {
    const override = overrides[slotId];
    if (!override) continue;

    const idx = elements.findIndex((el) => (el as any).slotId === slotId);
    const region = override.region ?? normalizeSlotRegion(next, slotId);
    const base = idx >= 0 ? (elements[idx] as any) : null;

    const layoutBase = {
      id: base?.id ?? slotId,
      slotId,
      region,
      x: override.x ?? base?.x ?? 0,
      y: override.y ?? base?.y ?? 0,
      width: override.width ?? base?.width,
      height: override.height ?? base?.height,
      fontSize: override.fontSize ?? base?.fontSize,
      fontWeight: override.fontWeight ?? base?.fontWeight,
      alignX: override.alignX ?? base?.alignX,
    };

    const existingDataSource =
      override.type === 'image'
        ? base?.dataSource?.type === 'static'
          ? base.dataSource
          : { type: 'static', value: '' }
        : base?.dataSource ?? { type: 'static', value: '' };

    const nextElement: TemplateElement =
      override.type === 'image'
        ? ensureImageElement(layoutBase, existingDataSource)
        : ensureTextElement(layoutBase, existingDataSource);

    if (idx >= 0) {
      elements[idx] = nextElement;
    } else {
      elements.push(nextElement);
    }
  }

  next.elements = elements;
  return next;
};

export const applySlotDataOverrides = (
  template: TemplateDefinition,
  overrides?: Record<string, SlotFieldRef>,
): TemplateDefinition => {
  if (!overrides || Object.keys(overrides).length === 0) {
    return template;
  }

  if (import.meta.env.DEV) {
    console.info('[template] slot overrides keys', { keys: Object.keys(overrides) });
  }

  const next = structuredClone(template);
  const elements = [...(next.elements ?? [])];

  for (const slotId of Object.keys(overrides)) {
    const override = overrides[slotId];
    if (!override) continue;

    const idx = elements.findIndex((el) => (el as any).slotId === slotId);
    const region = normalizeSlotRegion(next, slotId);
    const base = idx >= 0 ? (elements[idx] as any) : null;

    const layoutBase = {
      id: base?.id ?? slotId,
      slotId,
      region,
      x: base?.x ?? 0,
      y: base?.y ?? 0,
      width: base?.width,
      height: base?.height,
      fontSize: base?.fontSize,
      fontWeight: base?.fontWeight,
    };

    const nextElement: TemplateElement =
      override.kind === 'imageUrl'
        ? ensureImageElement(layoutBase, { type: 'static', value: override.url ?? '' })
        : ensureTextElement(
            layoutBase,
            override.kind === 'recordField'
              ? { type: 'kintone', fieldCode: override.fieldCode }
              : { type: 'static', value: override.text ?? '' },
          );

    if (idx >= 0) {
      elements[idx] = nextElement;
    } else {
      elements.push(nextElement);
    }
  }

  next.elements = elements;
  return next;
};

export const extractSlotLayoutOverrides = (
  template: TemplateDefinition,
): Record<string, SlotLayoutOverride> => {
  const overrides: Record<string, SlotLayoutOverride> = {};
  for (const element of template.elements ?? []) {
    const slotId = (element as any).slotId as string | undefined;
    if (!slotId) continue;
    if (element.region !== 'header' && element.region !== 'footer') continue;

    const type = element.type === 'image' ? 'image' : 'text';
    overrides[slotId] = {
      slotId,
      region: element.region,
      type,
      x: element.x,
      y: element.y,
      width: element.width,
      height: element.height,
      fontSize: (element as any).fontSize,
      fontWeight: (element as any).fontWeight,
      alignX: (element as any).alignX,
    };
  }
  return overrides;
};

export const extractSlotDataOverrides = (
  template: TemplateDefinition,
): Record<string, SlotFieldRef> => {
  const overrides: Record<string, SlotFieldRef> = {};
  for (const element of template.elements ?? []) {
    const slotId = (element as any).slotId as string | undefined;
    if (!slotId) continue;
    if (element.region !== 'header' && element.region !== 'footer') continue;

    if (element.type === 'image') {
      const ds = element.dataSource;
      overrides[slotId] = { kind: 'imageUrl', url: ds?.type === 'static' ? ds.value ?? '' : '' };
      continue;
    }

    if (element.type === 'label') {
      overrides[slotId] = { kind: 'staticText', text: element.text ?? '' };
      continue;
    }

    const ds = (element as any).dataSource;
    if (!ds || ds.type === 'static') {
      overrides[slotId] = { kind: 'staticText', text: ds?.value ?? '' };
      continue;
    }
    if (ds.type === 'kintone') {
      overrides[slotId] = { kind: 'recordField', fieldCode: ds.fieldCode };
    }
  }
  return overrides;
};

export const buildTemplateFromUserTemplate = (
  baseTemplate: TemplateDefinition,
  record: UserTemplateRecord,
): TemplateDefinition => {
  const structureType = baseTemplate.structureType ?? 'list_v1';
  if (structureType === 'label_v1') {
    return {
      ...baseTemplate,
      id: record.templateId,
      name: record.meta?.name ?? baseTemplate.name,
      baseTemplateId: record.baseTemplateId,
      mapping: record.mapping ?? baseTemplate.mapping,
      sheetSettings: record.sheetSettings ?? baseTemplate.sheetSettings,
    };
  }
  const adapter = getAdapter(structureType);
  const mapping = record.mapping ?? adapter.createDefaultMapping();

  const mapped = adapter.applyMappingToTemplate(
    { ...baseTemplate, structureType, mapping },
    mapping,
  );
  const layoutApplied = applySlotLayoutOverrides(mapped, record.overrides?.layout);
  const dataApplied = applySlotDataOverrides(layoutApplied, record.overrides?.slots);

  return {
    ...dataApplied,
    id: record.templateId,
    name: record.meta?.name ?? dataApplied.name,
    baseTemplateId: record.baseTemplateId,
    settings: record.settings ?? dataApplied.settings,
  };
};
