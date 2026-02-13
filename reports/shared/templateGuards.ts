import type { TemplateDefinition } from './template';

export const isListV1 = (
  template?: TemplateDefinition | null,
): template is TemplateDefinition => !!template && template.structureType === 'list_v1';

export const isEstimateV1 = (
  template?: TemplateDefinition | null,
): template is TemplateDefinition => !!template && template.structureType === 'estimate_v1';
