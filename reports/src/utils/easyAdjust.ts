import type { TemplateDefinition, TemplateElement } from '@shared/template';

export type EasyAdjustBlock =
  | 'header'
  | 'recipient'
  | 'body'
  | 'footer'
  | 'documentMeta';

export type EasyAdjustBlockSettings = {
  fontPreset: 'S' | 'M' | 'L';
  paddingPreset: 'Narrow' | 'Normal' | 'Wide';
  enabled: boolean;
  docNoVisible: boolean;
  dateVisible: boolean;
  hiddenLabelIds: string[];
};

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

export const resolveElementBlock = (
  element: TemplateElement,
  template: TemplateDefinition,
): EasyAdjustBlock => {
  const slotId = (element as any).slotId as string | undefined;
  if (slotId === 'doc_no' || slotId === 'date_label' || slotId === 'issue_date') {
    return 'documentMeta';
  }
  if (element.id === 'doc_no_label') {
    return 'documentMeta';
  }
  if (slotId === 'to_name' || element.id === 'to_name') {
    return 'recipient';
  }
  if (element.id === 'to_label' || element.id === 'to_honorific') {
    return 'recipient';
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
  const legacyTitle = (easyAdjust as Record<string, any>).title ?? {};
  const legacyCustomer = (easyAdjust as Record<string, any>).customer ?? {};

  return {
    fontPreset: (blockSettings.fontPreset ?? (block === 'header' ? legacyTitle.fontPreset : undefined) ?? (block === 'recipient' ? legacyCustomer.fontPreset : undefined) ?? legacyFontPreset) as EasyAdjustBlockSettings['fontPreset'],
    paddingPreset:
      (blockSettings.paddingPreset ?? (block === 'header' ? legacyTitle.paddingPreset : undefined) ?? (block === 'recipient' ? legacyCustomer.paddingPreset : undefined) ?? legacyPaddingPreset) as EasyAdjustBlockSettings['paddingPreset'],
    enabled: blockSettings.enabled !== false,
    docNoVisible: blockSettings.docNoVisible !== false,
    dateVisible: blockSettings.dateVisible !== false,
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
  if (!settings.enabled && block !== 'documentMeta') return true;
  if (block === 'documentMeta') {
    const headerSettings = normalizeEasyAdjustBlockSettings(template, 'header');
    if (!headerSettings.enabled) return true;
  }
  const slotId = (element as any).slotId as string | undefined;
  if (block === 'documentMeta') {
    if (!settings.docNoVisible && (slotId === 'doc_no' || element.id === 'doc_no_label')) {
      return true;
    }
    if (!settings.dateVisible && (slotId === 'date_label' || slotId === 'issue_date')) {
      return true;
    }
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
