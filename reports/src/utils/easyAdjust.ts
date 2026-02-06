import type { TemplateDefinition, TemplateElement } from '@shared/template';

export type EasyAdjustBlock =
  | 'title'
  | 'documentMeta'
  | 'customer'
  | 'header'
  | 'body'
  | 'footer';

export type EasyAdjustBlockSettings = {
  fontPreset: 'S' | 'M' | 'L';
  paddingPreset: 'Narrow' | 'Normal' | 'Wide';
  spacingPreset: 'tight' | 'normal' | 'loose';
  labelMode: 'labelValue' | 'valueOnly';
  honorific: 'sama' | 'onchu' | 'none';
  hiddenLabelIds: string[];
};

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

export const resolveElementBlock = (
  element: TemplateElement,
  template: TemplateDefinition,
): EasyAdjustBlock => {
  const slotId = (element as any).slotId as string | undefined;
  if (slotId === 'doc_title' || element.id === 'doc_title' || element.id === 'title') {
    return 'title';
  }
  if (slotId === 'doc_no' || slotId === 'date_label' || slotId === 'issue_date') {
    return 'documentMeta';
  }
  if (element.id === 'doc_no_label') {
    return 'documentMeta';
  }
  if (slotId === 'to_name' || element.id === 'to_name') {
    return 'customer';
  }
  if (element.id === 'to_label' || element.id === 'to_honorific') {
    return 'customer';
  }

  if (element.region === 'header') return 'header';
  if (element.region === 'footer') return 'footer';
  if (element.region === 'body') return 'body';

  const headerSlots = new Set(template.slotSchema?.header?.map((slot) => slot.slotId) ?? []);
  const footerSlots = new Set(template.slotSchema?.footer?.map((slot) => slot.slotId) ?? []);
  if (slotId) {
    if (headerSlots.has(slotId)) return 'header';
    if (footerSlots.has(slotId)) return 'footer';
    if (slotId.startsWith('header')) return 'header';
    if (slotId.startsWith('footer')) return 'footer';
  }

  if (element.id.startsWith('header')) return 'header';
  if (element.id.startsWith('footer')) return 'footer';

  return 'body';
};

export const normalizeEasyAdjustBlockSettings = (
  template: TemplateDefinition,
  block: EasyAdjustBlock,
): EasyAdjustBlockSettings => {
  const legacyFontPreset = template.settings?.fontScalePreset ?? 'M';
  const legacyPaddingPreset = template.settings?.pagePaddingPreset ?? 'Normal';
  const easyAdjust = template.settings?.easyAdjust ?? {};
  const blockSettings = (easyAdjust as Record<string, any>)[block] ?? {};

  return {
    fontPreset: (blockSettings.fontPreset ?? legacyFontPreset) as EasyAdjustBlockSettings['fontPreset'],
    paddingPreset:
      (blockSettings.paddingPreset ?? legacyPaddingPreset) as EasyAdjustBlockSettings['paddingPreset'],
    spacingPreset:
      (blockSettings.spacingPreset ?? 'normal') as EasyAdjustBlockSettings['spacingPreset'],
    labelMode:
      (blockSettings.labelMode ?? 'labelValue') as EasyAdjustBlockSettings['labelMode'],
    honorific:
      (blockSettings.honorific ?? 'sama') as EasyAdjustBlockSettings['honorific'],
    hiddenLabelIds: Array.isArray(blockSettings.hiddenLabelIds) ? blockSettings.hiddenLabelIds : [],
  };
};

export const resolveFontScalePreset = (preset: EasyAdjustBlockSettings['fontPreset']) => {
  if (preset === 'S') return 0.9;
  if (preset === 'L') return 1.1;
  return 1.0;
};

export const resolvePagePaddingPreset = (preset: EasyAdjustBlockSettings['paddingPreset']) => {
  if (preset === 'Narrow') return 8;
  if (preset === 'Wide') return 24;
  return 16;
};

export const isElementHiddenByEasyAdjust = (
  element: TemplateElement,
  template: TemplateDefinition,
) => {
  if ((element as any).hidden) return true;
  const block = resolveElementBlock(element, template);
  const settings = normalizeEasyAdjustBlockSettings(template, block);
  if (settings.hiddenLabelIds.includes(element.id)) return true;
  const slotId = (element as any).slotId as string | undefined;
  if (block === 'documentMeta' && settings.labelMode === 'valueOnly') {
    if (element.id === 'doc_no_label' || slotId === 'date_label') return true;
  }
  if (block === 'customer' && settings.labelMode === 'valueOnly') {
    if (element.id === 'to_label') return true;
  }
  if (block === 'customer' && element.id === 'to_honorific' && settings.honorific === 'none') {
    return true;
  }
  return false;
};

export const extractStaticLabelText = (element: TemplateElement) => {
  if (element.type === 'label' && isNonEmptyString(element.text)) {
    return element.text.trim();
  }
  if (element.type === 'text') {
    const ds = (element as any).dataSource as { type?: string; value?: string } | undefined;
    if (ds?.type === 'static' && isNonEmptyString(ds.value)) {
      return ds.value.trim();
    }
    const rawText = (element as any).text;
    if (isNonEmptyString(rawText)) return rawText.trim();
  }
  return '';
};
