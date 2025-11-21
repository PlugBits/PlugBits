import { create } from 'zustand';
import type { TemplateDefinition, TemplateElement } from '@shared/template.ts';
import { SAMPLE_TEMPLATE } from '@shared/template.ts';
import {
  createTemplateRemote,
  deleteTemplateRemote,
  fetchTemplates,
  updateTemplateRemote,
} from '../services/templateService.ts';

export type TemplateMap = Record<string, TemplateDefinition>;

type TemplateStore = {
  templates: TemplateMap;
  activeTemplateId: string | null;
  loading: boolean;
  hasLoaded: boolean;
  error: string | null;
  setActiveTemplate: (templateId: string | null) => void;
  clearError: () => void;
  initialize: () => Promise<void>;
  refreshTemplates: () => Promise<void>;
  createTemplate: (name?: string) => Promise<TemplateDefinition>;
  updateTemplate: (template: TemplateDefinition) => void;
  saveTemplate: (templateId: string) => Promise<void>;
  deleteTemplate: (templateId: string) => Promise<void>;
  addElement: (templateId: string, element: TemplateElement) => void;
  updateElement: (
    templateId: string,
    elementId: string,
    updates: Partial<TemplateElement>,
  ) => void;
};

const cloneTemplate = <T>(template: T): T => structuredClone(template);

const generateTemplateId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? `tpl_${crypto.randomUUID()}`
    : `tpl_${Date.now()}`;

const createDraftTemplate = (name: string): TemplateDefinition => {
  const draft = cloneTemplate(SAMPLE_TEMPLATE);
  const newId = generateTemplateId();
  draft.id = newId;
  draft.name = name;
  draft.elements = draft.elements.map((element) => ({
    ...element,
    id: `${element.id}_${newId.slice(0, 4)}`,
  }));
  return draft;
};

const templatesToMap = (templates: TemplateDefinition[]) => {
  return templates.reduce<TemplateMap>((acc, template) => {
    acc[template.id] = template;
    return acc;
  }, {} as TemplateMap);
};

const withFallbackTemplate = (templates: TemplateDefinition[]): TemplateDefinition[] => {
  if (templates.length === 0) {
    return [cloneTemplate(SAMPLE_TEMPLATE)];
  }
  return templates;
};

export const useTemplateStore = create<TemplateStore>((set, get) => ({
  templates: { [SAMPLE_TEMPLATE.id]: cloneTemplate(SAMPLE_TEMPLATE) },
  activeTemplateId: SAMPLE_TEMPLATE.id,
  loading: false,
  hasLoaded: false,
  error: null,
  setActiveTemplate: (templateId) => set({ activeTemplateId: templateId }),
  clearError: () => set({ error: null }),
  initialize: async () => {
    if (get().loading || get().hasLoaded) {
      return;
    }
    await get().refreshTemplates();
  },
  refreshTemplates: async () => {
    set({ loading: true, error: null });
    try {
      const templates = await fetchTemplates();
      const normalized = templatesToMap(withFallbackTemplate(templates));
      set((state) => ({
        templates: normalized,
        loading: false,
        hasLoaded: true,
        activeTemplateId: state.activeTemplateId ?? SAMPLE_TEMPLATE.id,
      }));
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'テンプレートの取得に失敗しました',
        loading: false,
      });
      throw error;
    }
  },
  createTemplate: async (name = 'カスタムテンプレート') => {
    const draft = createDraftTemplate(name);
    set({ error: null });
    try {
      const remote = await createTemplateRemote(draft);
      set((state) => ({
        templates: { ...state.templates, [remote.id]: remote },
        activeTemplateId: remote.id,
      }));
      return remote;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'テンプレートの作成に失敗しました' });
      throw error;
    }
  },
  updateTemplate: (template) =>
    set((state) => ({ templates: { ...state.templates, [template.id]: template } })),
  saveTemplate: async (templateId) => {
    const template = get().templates[templateId];
    if (!template) return;
    try {
      const updated = await updateTemplateRemote(template);
      set((state) => ({ templates: { ...state.templates, [templateId]: updated } }));
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'テンプレートの保存に失敗しました' });
      throw error;
    }
  },
  deleteTemplate: async (templateId) => {
    try {
      await deleteTemplateRemote(templateId);
      set((state) => {
        const nextTemplates = { ...state.templates };
        delete nextTemplates[templateId];
        const nextActive = state.activeTemplateId === templateId ? Object.keys(nextTemplates)[0] ?? null : state.activeTemplateId;
        return { templates: nextTemplates, activeTemplateId: nextActive };
      });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'テンプレートの削除に失敗しました' });
      throw error;
    }
  },
  addElement: (templateId, element) => {
    set((state) => {
      const template = state.templates[templateId];
      if (!template) return state;
      return {
        templates: {
          ...state.templates,
          [templateId]: { ...template, elements: [...template.elements, element] },
        },
      };
    });
  },
  updateElement: (templateId, elementId, updates) => {
    const template = get().templates[templateId];
    if (!template) return;

    const nextTemplate: TemplateDefinition = {
      ...template,
      elements: template.elements.map((element) =>
        element.id === elementId ? { ...element, ...updates } : element,
      ),
    };

    set((state) => ({ templates: { ...state.templates, [templateId]: nextTemplate } }));
  },
}));

export const selectTemplateById = (state: TemplateStore, templateId: string | undefined) =>
  templateId ? state.templates[templateId] : undefined;
