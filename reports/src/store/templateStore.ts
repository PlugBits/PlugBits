// src/store/templateStore.ts

import { create } from 'zustand';
import type { TemplateDefinition, TemplateElement } from '@shared/template';
import { SAMPLE_TEMPLATE } from '@shared/template';
import { isDebugEnabled } from '../shared/debugFlag';
import {
  createUserTemplateFromBase,
  createTemplateRemote,
  buildTemplateFingerprint,
  fetchTemplateById,
  softDeleteTemplate,
} from '../services/templateService';

export type TemplateMap = Record<string, TemplateDefinition>;

export type TemplateStore = {
  templates: TemplateMap;
  activeTemplateId: string | null;
  loading: boolean;
  hasLoaded: boolean;
  error: string | null;
  fetchSeq: number;

  setActiveTemplate: (templateId: string | null) => void;
  clearError: () => void;
  loadTemplate: (templateId: string) => Promise<void>;

  createTemplate: (name?: string) => Promise<TemplateDefinition>;
  updateTemplate: (template: TemplateDefinition) => void;
  saveTemplate: (templateId: string, opts?: { nameOverride?: string }) => Promise<void>;
  deleteTemplate: (templateId: string) => Promise<void>;
  
  addElement: (templateId: string, element: TemplateElement) => void;
  updateElement: (
    templateId: string,
    elementId: string,
    updates: Partial<TemplateElement>,
  ) => void;
  removeElement: (templateId: string, elementId: string) => void;

};

// ---- 共通ユーティリティ ----

const cloneTemplate = <T>(template: T): T => structuredClone(template);

// ---- Zustand store ----

export const useTemplateStore = create<TemplateStore>((set, get) => ({
  templates: { [SAMPLE_TEMPLATE.id]: cloneTemplate(SAMPLE_TEMPLATE) },
  activeTemplateId: SAMPLE_TEMPLATE.id,
  loading: false,
  hasLoaded: false,
  error: null,
  fetchSeq: 0,

  setActiveTemplate: (templateId) => set({ activeTemplateId: templateId }),

  clearError: () => set({ error: null }),

  loadTemplate: async (templateId) => {
    if (!templateId) return;

    const existing = get().templates[templateId];
    if (existing) {
      set({ activeTemplateId: templateId, hasLoaded: true });
      return;
    }

    const seq = get().fetchSeq + 1;
    set({ loading: true, error: null, fetchSeq: seq });

    try {
      const template = await fetchTemplateById(templateId);

      if (get().fetchSeq !== seq) {
        console.warn('[templateStore.loadTemplate] stale fetch skipped', { seq });
        return;
      }

      set((state) => ({
        templates: {
          ...state.templates,
          [template.id]: template,
        },
        activeTemplateId: template.id,
        loading: false,
        hasLoaded: true,
      }));
    } catch (error) {
      if (get().fetchSeq !== seq) return;

      set({
        loading: false,
        error: error instanceof Error ? error.message : 'テンプレートの取得に失敗しました',
      });
    }
  },


  createTemplate: async (name) => {
    const templateName = name || '新しいテンプレート';

    try {
      // baseTemplateId ("list_v1") selects the catalog template; the created template.id is user-specific ("tpl_*").
      const created = await createUserTemplateFromBase('list_v1', templateName);

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
  saveTemplate: async (templateId, opts) => {
    const template = get().templates[templateId];
    if (!template) return;

    try {
      const normalizedName = opts?.nameOverride?.trim();
      const toSave = normalizedName ? { ...template, name: normalizedName } : template;
      const saved = await createTemplateRemote(toSave);
      if (isDebugEnabled()) {
        try {
          const draftFingerprint = await buildTemplateFingerprint(toSave);
          const savedTemplate = await fetchTemplateById(templateId);
          const savedFingerprint = await buildTemplateFingerprint(savedTemplate);
          const ok =
            Boolean(draftFingerprint.hash) &&
            draftFingerprint.hash === savedFingerprint.hash;
          console.log('[DBG_CLIENT_SAVE_VERIFY]', {
            templateId,
            hashDraft: draftFingerprint.hash,
            hashSaved: savedFingerprint.hash,
            ok,
            jsonLenDraft: draftFingerprint.jsonLen,
            jsonLenSaved: savedFingerprint.jsonLen,
            elementsCountDraft: draftFingerprint.elements,
            elementsCountSaved: savedFingerprint.elements,
          });
        } catch (error) {
          console.debug('[DBG_CLIENT_SAVE_VERIFY] failed', {
            templateId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      set((state) => {
        const current = state.templates[templateId];
        if (!current) return state;
        if (current.baseTemplateId || !saved.baseTemplateId) return state;
        return {
          templates: {
            ...state.templates,
            [templateId]: { ...current, baseTemplateId: saved.baseTemplateId },
          },
        };
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'テンプレートの保存に失敗しました',
      });
      throw error;
    }
  },

  deleteTemplate: async (templateId) => {
    try {
      await softDeleteTemplate(templateId);

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
  removeElement: (templateId, elementId) => {
    const template = get().templates[templateId];
    if (!template) return;

    const nextTemplate: TemplateDefinition = {
      ...template,
      elements: template.elements.filter((el) => el.id !== elementId),
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
