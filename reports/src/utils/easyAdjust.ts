import type { TemplateDefinition, TemplateElement } from '@shared/template';

export type EasyAdjustGroup = 'title' | 'header' | 'body' | 'footer';

export type EasyAdjustGroupSettings = {
  fontPreset: 'S' | 'M' | 'L';
  paddingPreset: 'Narrow' | 'Normal' | 'Wide';
  hiddenLabelIds: string[];
};

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

export const resolveElementGroup = (
  element: TemplateElement,
  template: TemplateDefinition,
): EasyAdjustGroup => {
  const slotId = (element as any).slotId as string | undefined;
  if (slotId === 'doc_title' || element.id === 'doc_title' || element.id === 'title') {
    return 'title';
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

export const normalizeEasyAdjustGroupSettings = (
  template: TemplateDefinition,
  group: EasyAdjustGroup,
): EasyAdjustGroupSettings => {
  const legacyFontPreset = template.settings?.fontScalePreset ?? 'M';
  const legacyPaddingPreset = template.settings?.pagePaddingPreset ?? 'Normal';
  const easyAdjust = template.settings?.easyAdjust ?? {};
  const groupSettings = (easyAdjust as Record<string, any>)[group] ?? {};

  return {
    fontPreset: (groupSettings.fontPreset ?? legacyFontPreset) as EasyAdjustGroupSettings['fontPreset'],
    paddingPreset:
      (groupSettings.paddingPreset ?? legacyPaddingPreset) as EasyAdjustGroupSettings['paddingPreset'],
    hiddenLabelIds: Array.isArray(groupSettings.hiddenLabelIds) ? groupSettings.hiddenLabelIds : [],
  };
};

export const resolveFontScalePreset = (preset: EasyAdjustGroupSettings['fontPreset']) => {
  if (preset === 'S') return 0.9;
  if (preset === 'L') return 1.1;
  return 1.0;
};

export const resolvePagePaddingPreset = (preset: EasyAdjustGroupSettings['paddingPreset']) => {
  if (preset === 'Narrow') return 8;
  if (preset === 'Wide') return 24;
  return 16;
};

export const isElementHiddenByEasyAdjust = (
  element: TemplateElement,
  template: TemplateDefinition,
) => {
  if ((element as any).hidden) return true;
  const group = resolveElementGroup(element, template);
  const settings = normalizeEasyAdjustGroupSettings(template, group);
  return settings.hiddenLabelIds.includes(element.id);
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
