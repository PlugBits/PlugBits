// src/store/templateStore.ts

import { create } from 'zustand';
import type {
  TemplateDefinition,
  TemplateElement,
  TemplateDataRecord,
} from '@shared/template';
import { SAMPLE_DATA, SAMPLE_TEMPLATE } from '@shared/template';
import {
  createTemplateRemote,
  deleteTemplateRemote,
  fetchTemplates,
} from '../services/templateService';

export type TemplateMap = Record<string, TemplateDefinition>;

export type TemplateStore = {
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

// ---- 共通ユーティリティ ----

const cloneTemplate = <T>(template: T): T => structuredClone(template);
const cloneData = <T>(value: T): T => structuredClone(value);

const generateTemplateId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? `tpl_${crypto.randomUUID()}`
    : `tpl_${Date.now()}`;

// SAMPLE_TEMPLATE から下書きをつくる
const createDraftTemplate = (name: string): TemplateDefinition => {
  const draft = cloneTemplate(SAMPLE_TEMPLATE);
  const newId = generateTemplateId();

  draft.id = newId;
  draft.name = name;

  draft.elements = draft.elements.map((element): TemplateElement => ({
    ...element,
    id: `${element.id}_${newId.slice(0, 4)}`,
  }));

  draft.sampleData = cloneData(
    (SAMPLE_TEMPLATE.sampleData as TemplateDataRecord | undefined) ?? SAMPLE_DATA,
  );

  return draft;
};

const templatesToMap = (templates: TemplateDefinition[]): TemplateMap =>
  templates.reduce<TemplateMap>((acc, template) => {
    acc[template.id] = template;
    return acc;
  }, {} as TemplateMap);

// ---- Zustand store ----

export const useTemplateStore = create<TemplateStore>((set, get) => ({
  templates: { [SAMPLE_TEMPLATE.id]: cloneTemplate(SAMPLE_TEMPLATE) },
  activeTemplateId: SAMPLE_TEMPLATE.id,
  loading: false,
  hasLoaded: false,
  error: null,

  setActiveTemplate: (templateId) => set({ activeTemplateId: templateId }),

  clearError: () => set({ error: null }),

  initialize: async () => {
    if (get().loading || get().hasLoaded) return;
    await get().refreshTemplates();
  },

  refreshTemplates: async () => {
    set({ loading: true, error: null });

    try {
      const templates = await fetchTemplates();
      const map = templatesToMap(templates.length > 0 ? templates : [SAMPLE_TEMPLATE]);

      const currentActiveId = get().activeTemplateId;
      const activeTemplateId =
        currentActiveId && map[currentActiveId]
          ? currentActiveId
          : templates[0]?.id ?? SAMPLE_TEMPLATE.id;

      set({
        templates: map,
        activeTemplateId,
        loading: false,
        hasLoaded: true,
      });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : 'テンプレートの取得に失敗しました',
      });
    }
  },

  createTemplate: async (name) => {
    const templateName = name || '新しいテンプレート';
    const draft = createDraftTemplate(templateName);

    try {
      const created = await createTemplateRemote(draft);

      set((state) => ({
        templates: {
          ...state.templates,
          [created.id]: created,
        },
        activeTemplateId: created.id,
      }));

      return created;
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'テンプレートの作成に失敗しました',
      });
      throw error;
    }
  },

  updateTemplate: (template) => {
    set((state) => ({
      templates: {
        ...state.templates,
        [template.id]: template,
      },
    }));
  },

  // ★いまは createTemplateRemote を "保存" にも流用
  saveTemplate: async (templateId) => {
    const template = get().templates[templateId];
    if (!template) return;

    try {
      const saved = await createTemplateRemote(template);
      set((state) => ({
        templates: {
          ...state.templates,
          [templateId]: saved,
        },
      }));
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'テンプレートの保存に失敗しました',
      });
      throw error;
    }
  },

  deleteTemplate: async (templateId) => {
    try {
      await deleteTemplateRemote(templateId);

      set((state) => {
        const nextTemplates = { ...state.templates };
        delete nextTemplates[templateId];

        const remainingIds = Object.keys(nextTemplates);
        const nextActiveId =
          state.activeTemplateId === templateId ? remainingIds[0] ?? null : state.activeTemplateId;

        return {
          templates: nextTemplates,
          activeTemplateId: nextActiveId,
        };
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'テンプレートの削除に失敗しました',
      });
      throw error;
    }
  },

  addElement: (templateId, element) => {
    const template = get().templates[templateId];
    if (!template) return;

    const nextTemplate: TemplateDefinition = {
      ...template,
      elements: [...template.elements, element],
    };

    set((state) => ({
      templates: {
        ...state.templates,
        [templateId]: nextTemplate,
      },
    }));
  },

  // templateStore.ts 内の updateElement をこの形で上書き

updateElement: (templateId, elementId, updates) => {
  const template = get().templates[templateId];
  if (!template) return;

  const nextElements: TemplateElement[] = template.elements.map((element) =>
    element.id === elementId
      ? ({ ...element, ...updates } as TemplateElement) // ← ここで TemplateElement として固定
      : element,
  );

  const nextTemplate: TemplateDefinition = {
    ...template,
    elements: nextElements,
  };

  set((state) => ({
    templates: {
      ...state.templates,
      [templateId]: nextTemplate,
    },
  }));
},

}));

// 画面側用セレクタ
export const selectTemplateById = (
  state: TemplateStore,
  templateId: string | undefined,
) => (templateId ? state.templates[templateId] : undefined);
