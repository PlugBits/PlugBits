import type { TemplateDefinition } from './template';

export const isListV1 = (
  template?: TemplateDefinition | null,
): template is TemplateDefinition => !!template && template.structureType === 'list_v1';
