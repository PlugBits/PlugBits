// src/store/templateStore.ts

import { create } from 'zustand';
import type { TemplateDefinition, TemplateElement } from '@shared/template';
import { SAMPLE_TEMPLATE } from '@shared/template';
import { isDebugEnabled } from '../shared/debugFlag';
import {
  createUserTemplateFromBase,
  createTemplateRemote,
  canonicalizeTemplateForStorage,
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
          const canonicalDraft = canonicalizeTemplateForStorage(toSave);
          const savedTemplate = await fetchTemplateById(templateId);
          const canonicalSaved = canonicalizeTemplateForStorage(savedTemplate);
          const draftFingerprint = await buildTemplateFingerprint(canonicalDraft);
          const savedFingerprint = await buildTemplateFingerprint(canonicalSaved);
          const ok =
            Boolean(draftFingerprint.hash) &&
            draftFingerprint.hash === savedFingerprint.hash;
          const DIFF_KEYS = [
            'x',
            'y',
            'width',
            'height',
            'fontSize',
            'lineHeight',
            'alignX',
            'align',
            'valign',
            'paddingX',
            'paddingY',
            'region',
            'type',
            'slotId',
            'dataSource',
            'style',
            'fitMode',
          ];
          const diffKeyCounts: Record<string, number> = {};
          const round3 = (value: unknown) => {
            if (typeof value !== 'number' || !Number.isFinite(value)) return value;
            return Math.round(value * 1000) / 1000;
          };
          const normalizeValue = (value: unknown): unknown => {
            if (value === null || value === undefined) return value;
            if (typeof value === 'number') return round3(value);
            if (typeof value !== 'object') return value;
            if (Array.isArray(value)) return value.map(normalizeValue);
            const obj = value as Record<string, unknown>;
            const keys = Object.keys(obj).sort();
            const out: Record<string, unknown> = {};
            for (const key of keys) {
              out[key] = normalizeValue(obj[key]);
            }
            return out;
          };
          const readField = (obj: unknown, key: string) => {
            if (!obj || typeof obj !== 'object') {
              return { present: false, value: undefined };
            }
            const has = Object.prototype.hasOwnProperty.call(obj, key);
            if (!has) return { present: false, value: undefined };
            return { present: true, value: (obj as any)[key] };
          };
          const representField = (obj: unknown, key: string) => {
            const { present, value } = readField(obj, key);
            if (!present) return '__MISSING__';
            if (value === undefined) return '__MISSING__';
            if (key === 'slotId' && (value === null || value === undefined)) {
              return '__MISSING__';
            }
            return normalizeValue(value);
          };
          const compareField = (a: unknown, b: unknown) =>
            JSON.stringify(a) === JSON.stringify(b);
          const pickElement = (t: TemplateDefinition, targetId: string) =>
            t.elements?.find((e) => e.id === targetId) ??
            t.elements?.find((e) => (e as any).slotId === targetId);
          const pickElementId = (t: TemplateDefinition, id: string) =>
            pickElement(t, id)?.id ?? id;
          const isTextLike = (el: TemplateElement | undefined) =>
            el?.type === 'text' || el?.type === 'label';
          const toElemDiffEntry = (
            elementId: string,
            draftEl: TemplateElement | undefined,
            savedEl: TemplateElement | undefined,
          ) => {
            const draftFields: Record<string, unknown> = {};
            const savedFields: Record<string, unknown> = {};
            const changedKeys: string[] = [];
            const textLike = isTextLike(draftEl) || isTextLike(savedEl);
            for (const key of DIFF_KEYS) {
              if (!textLike) {
                if (
                  key === 'fontSize' ||
                  key === 'lineHeight' ||
                  key === 'alignX' ||
                  key === 'align' ||
                  key === 'valign' ||
                  key === 'paddingX' ||
                  key === 'paddingY' ||
                  key === 'style'
                ) {
                  continue;
                }
              }
              const draftVal = representField(draftEl, key);
              const savedVal = representField(savedEl, key);
              draftFields[key] = draftVal;
              savedFields[key] = savedVal;
              if (!compareField(draftVal, savedVal)) changedKeys.push(key);
            }
            return { draftFields, savedFields, changedKeys };
          };
          const pickElementSample = (t: TemplateDefinition, targetId: string) => {
            const el =
              t.elements?.find((e) => e.id === targetId) ??
              t.elements?.find((e) => (e as any).slotId === targetId);
            if (!el) return null;
            return {
              id: el.id ?? targetId,
              slotId: (el as any).slotId ?? null,
              type: el.type,
              x: (el as any).x ?? null,
              y: (el as any).y ?? null,
              width: (el as any).width ?? null,
              height: (el as any).height ?? null,
              fontSize: (el as any).fontSize ?? null,
              alignX: (el as any).alignX ?? null,
            };
          };
          const elementSampleIds = ['doc_title', 'items', 'total', 'remarks'];
          const elementsDiffSample = elementSampleIds.reduce(
            (acc, id) => {
              acc[id] = {
                draft: pickElementSample(toSave, id),
                saved: pickElementSample(savedTemplate, id),
              };
              return acc;
            },
            {} as Record<string, { draft: Record<string, unknown> | null; saved: Record<string, unknown> | null }>,
          );
          const settingsDiffSample = {
            draft: {
              coordSystem: (toSave as any).settings?.coordSystem ?? null,
              yMode: (toSave as any).settings?.yMode ?? null,
              presetId: (toSave as any).settings?.presetId ?? null,
              presetRevision: (toSave as any).settings?.presetRevision ?? null,
            },
            saved: {
              coordSystem: (savedTemplate as any).settings?.coordSystem ?? null,
              yMode: (savedTemplate as any).settings?.yMode ?? null,
              presetId: (savedTemplate as any).settings?.presetId ?? null,
              presetRevision: (savedTemplate as any).settings?.presetRevision ?? null,
            },
          };
          const regionBoundsDiffSample = {
            draft: (toSave as any).regionBounds ?? null,
            saved: (savedTemplate as any).regionBounds ?? null,
          };
          const sheetSettingsDraft = (toSave as any).sheetSettings;
          const sheetSettingsSaved = (savedTemplate as any).sheetSettings;
          const sheetSettingsDiffSample = {
            draft: {
              exists: Boolean(sheetSettingsDraft),
              keys: sheetSettingsDraft ? Object.keys(sheetSettingsDraft) : [],
            },
            saved: {
              exists: Boolean(sheetSettingsSaved),
              keys: sheetSettingsSaved ? Object.keys(sheetSettingsSaved) : [],
            },
          };
          console.log('[DBG_CLIENT_SAVE_VERIFY]', {
            templateId,
            hashDraft: draftFingerprint.hash,
            hashSaved: savedFingerprint.hash,
            ok,
            jsonLenDraft: draftFingerprint.jsonLen,
            jsonLenSaved: savedFingerprint.jsonLen,
            elementsCountDraft: draftFingerprint.elements,
            elementsCountSaved: savedFingerprint.elements,
            elementsDiffSample,
            settingsDiffSample,
            regionBoundsDiffSample,
            sheetSettingsDiffSample,
          });
          const elementIdsToCheck = new Set<string>([
            'doc_title',
            'items',
            'total',
            'remarks',
          ]);
          const allDraftIds = (canonicalDraft.elements ?? []).map((el) => el.id ?? '');
          const allSavedIds = (canonicalSaved.elements ?? []).map((el) => el.id ?? '');
          for (const id of [...allDraftIds, ...allSavedIds]) {
            if (id) elementIdsToCheck.add(id);
          }
          for (const targetId of elementIdsToCheck) {
            const draftEl = pickElement(canonicalDraft, targetId);
            const savedEl = pickElement(canonicalSaved, targetId);
            const elementId = pickElementId(canonicalDraft, targetId);
            const { draftFields, savedFields, changedKeys } = toElemDiffEntry(
              elementId,
              draftEl,
              savedEl,
            );
            if (changedKeys.length > 0) {
              const values: Record<string, { draft: unknown; saved: unknown }> = {};
              for (const key of changedKeys) {
                values[key] = {
                  draft: draftFields[key],
                  saved: savedFields[key],
                };
              }
              console.log('[DBG_ELEM_DIFF]', {
                elementId,
                changedKeys,
                values,
              });
              for (const key of changedKeys) {
                diffKeyCounts[key] = (diffKeyCounts[key] ?? 0) + 1;
              }
            } else if (
              targetId === 'doc_title' ||
              targetId === 'items' ||
              targetId === 'total' ||
              targetId === 'remarks'
            ) {
              console.log('[DBG_ELEM_SAME]', { elementId });
            }
          }
          const summaryKeys = Object.keys(diffKeyCounts).sort(
            (a, b) => diffKeyCounts[b] - diffKeyCounts[a],
          );
          if (summaryKeys.length > 0) {
            const keysSummary: Record<string, number> = {};
            for (const key of summaryKeys) {
              keysSummary[key] = diffKeyCounts[key];
            }
            console.log('[DBG_DIFF_KEYS_SUMMARY]', keysSummary);
          }
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
