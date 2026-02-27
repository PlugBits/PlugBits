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
          const DIFF_KEYS_COMMON = [
            'id',
            'type',
            'x',
            'y',
            'width',
            'height',
            'rotation',
            'region',
            'slotId',
            'fitMode',
          ] as const;
          const DIFF_KEYS_TEXT_ONLY = [
            'fontSize',
            'lineHeight',
            'alignX',
            'align',
            'valign',
            'paddingX',
            'paddingY',
            'text',
            'style',
            'dataSource',
          ] as const;
          const diffKeyCounts: Record<string, number> = {};
          const MISSING = '__MISSING__' as const;
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
          const hasOwn = (obj: unknown, key: string) =>
            obj != null && Object.prototype.hasOwnProperty.call(obj as any, key);
          const getNorm = (obj: unknown, key: string) => {
            if (!hasOwn(obj, key)) return MISSING;
            const value = (obj as any)[key];
            if (value === undefined) return MISSING;
            return normalizeValue(value);
          };
          const getNormSlotId = (obj: unknown) => {
            if (!hasOwn(obj, 'slotId')) return MISSING;
            const value = (obj as any).slotId;
            if (value == null) return MISSING;
            return normalizeValue(value);
          };
          const stableStringify = (input: unknown): string => {
            if (input === null) return 'null';
            const type = typeof input;
            if (type === 'string') return JSON.stringify(input);
            if (type === 'number' || type === 'boolean') return String(input);
            if (type !== 'object') return JSON.stringify(input);
            if (Array.isArray(input)) {
              return `[${input.map(stableStringify).join(',')}]`;
            }
            const obj = input as Record<string, unknown>;
            const keys = Object.keys(obj).sort();
            return `{${keys
              .map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`)
              .join(',')}}`;
          };
          const firstDiffIndex = (a: string, b: string): number => {
            const n = Math.min(a.length, b.length);
            for (let i = 0; i < n; i += 1) {
              if (a.charCodeAt(i) !== b.charCodeAt(i)) return i;
            }
            return a.length === b.length ? -1 : n;
          };
          const canonicalizePlainObject = (input: unknown): unknown => {
            if (input == null) return input;
            if (Array.isArray(input)) return input.map(canonicalizePlainObject);
            if (typeof input !== 'object') return input;
            const obj = input as Record<string, unknown>;
            const out: Record<string, unknown> = {};
            const keys = Object.keys(obj).sort();
            for (const key of keys) {
              const value = obj[key];
              if (value === undefined || value === null) continue;
              out[key] = canonicalizePlainObject(value);
            }
            return out;
          };
          const canonicalizeDataSource = (ds: unknown) => {
            if (ds == null || typeof ds !== 'object') return null;
            const source = ds as Record<string, unknown>;
            const type = source.type ?? source.kind ?? null;
            if (!type || typeof type !== 'string') return null;
            let picked: Record<string, unknown> = { type };
            if (type === 'static') {
              picked.value = source.value ?? source.text ?? '';
            } else if (type === 'kintone' || type === 'recordField') {
              picked.fieldCode = source.fieldCode ?? source.code ?? '';
            } else if (type === 'kintoneSubtable') {
              picked.fieldCode = source.fieldCode ?? '';
            } else if (type === 'templateField') {
              picked.field = source.field ?? source.name ?? '';
            } else {
              picked = { type, ...source };
            }
            return canonicalizePlainObject(picked);
          };
          const dbgCompareDataSource = (elementId: string, draftDs: unknown, savedDs: unknown) => {
            const normDraft = canonicalizeDataSource(draftDs);
            const normSaved = canonicalizeDataSource(savedDs);
            const sa = stableStringify(normDraft);
            const sb = stableStringify(normSaved);
            const same = sa === sb;
            if (!same) {
              const idx = firstDiffIndex(sa, sb);
              console.log('[DBG_DS_EQ_FALSE]', {
                elementId,
                saLen: sa.length,
                sbLen: sb.length,
                idx,
                saSlice: sa.slice(Math.max(0, idx - 20), idx + 40),
                sbSlice: sb.slice(Math.max(0, idx - 20), idx + 40),
                normDraft,
                normSaved,
              });
            } else if (elementId === 'doc_title') {
              console.log('[DBG_DS_EQ_TRUE]', { elementId, sa });
            }
            return same;
          };
          const isTextElement = (el: TemplateElement | undefined) =>
            el?.type === 'text' || el?.type === 'label';
          const getNormTextAlignX = (obj: unknown) => {
            if (!hasOwn(obj, 'alignX')) return 'left';
            const value = (obj as any).alignX;
            if (value == null) return 'left';
            return normalizeValue(value);
          };
          const getNormTextFontSize = (obj: unknown) => {
            if (!hasOwn(obj, 'fontSize')) return 12;
            const value = (obj as any).fontSize;
            if (value == null) return 12;
            return normalizeValue(value);
          };
          const getComparableKeys = (el: TemplateElement | undefined) => {
            const keys = [...DIFF_KEYS_COMMON];
            if (isTextElement(el)) keys.push(...DIFF_KEYS_TEXT_ONLY);
            return keys;
          };
          const pickElement = (t: TemplateDefinition, targetId: string) =>
            t.elements?.find((e) => e.id === targetId) ??
            t.elements?.find((e) => (e as any).slotId === targetId);
          const pickElementId = (t: TemplateDefinition, id: string) =>
            pickElement(t, id)?.id ?? id;
          const diffElementNormalized = (
            elementId: string,
            draftEl: TemplateElement | undefined,
            savedEl: TemplateElement | undefined,
          ) => {
            const keys = getComparableKeys(draftEl ?? savedEl);
            const diffs: Array<{ key: string; draft: unknown; saved: unknown }> = [];
            for (const key of keys) {
              let draftVal: unknown;
              let savedVal: unknown;
              if (key === 'slotId') {
                draftVal = getNormSlotId(draftEl);
                savedVal = getNormSlotId(savedEl);
              } else if (key === 'dataSource') {
                const draftDs = draftEl ? (draftEl as any).dataSource : undefined;
                const savedDs = savedEl ? (savedEl as any).dataSource : undefined;
                const same = dbgCompareDataSource(elementId, draftDs, savedDs);
                if (!same) {
                  draftVal = canonicalizeDataSource(draftDs) ?? MISSING;
                  savedVal = canonicalizeDataSource(savedDs) ?? MISSING;
                } else {
                  continue;
                }
              } else if (isTextElement(draftEl ?? savedEl) && key === 'alignX') {
                draftVal = getNormTextAlignX(draftEl);
                savedVal = getNormTextAlignX(savedEl);
              } else if (isTextElement(draftEl ?? savedEl) && key === 'fontSize') {
                draftVal = getNormTextFontSize(draftEl);
                savedVal = getNormTextFontSize(savedEl);
              } else {
                draftVal = getNorm(draftEl, key);
                savedVal = getNorm(savedEl, key);
              }
              if (!Object.is(draftVal, savedVal)) {
                diffs.push({ key, draft: draftVal, saved: savedVal });
              }
            }
            return { elementId, diffs };
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
          const elementDiffs: Array<{
            elementId: string;
            diffs: Array<{ key: string; draft: unknown; saved: unknown }>;
          }> = [];
          for (const targetId of elementIdsToCheck) {
            const draftEl = pickElement(canonicalDraft, targetId);
            const savedEl = pickElement(canonicalSaved, targetId);
            const elementId = pickElementId(canonicalDraft, targetId);
            const diffEntry = diffElementNormalized(elementId, draftEl, savedEl);
            if (diffEntry.diffs.length > 0) {
              if (elementId === 'doc_title') {
                const draftRaw = pickElement(toSave, targetId);
                const savedRaw = pickElement(savedTemplate, targetId);
                console.log('[DBG_DS_RAW]', {
                  draft: draftRaw?.dataSource,
                  saved: savedRaw?.dataSource,
                  normDraft: canonicalizeDataSource(draftRaw?.dataSource),
                  normSaved: canonicalizeDataSource(savedRaw?.dataSource),
                });
              }
              elementDiffs.push(diffEntry);
            }
          }
          const hasAnyDiff = elementDiffs.length > 0;
          if (!(ok && !hasAnyDiff)) {
            for (const entry of elementDiffs) {
              const changedKeys = entry.diffs.map((diff) => diff.key);
              const values: Record<string, { draft: unknown; saved: unknown }> = {};
              for (const diff of entry.diffs) {
                values[diff.key] = {
                  draft: diff.draft,
                  saved: diff.saved,
                };
                diffKeyCounts[diff.key] = (diffKeyCounts[diff.key] ?? 0) + 1;
              }
              if (
                draftFingerprint.hash === savedFingerprint.hash &&
                !changedKeys.length
              ) {
                continue;
              }
              if (changedKeys.includes('dataSource')) {
                console.log('[DBG_ELEM_DIFF_STACK]', new Error('DBG_ELEM_DIFF').stack);
              }
              console.log('[DBG_ELEM_DIFF]', {
                elementId: entry.elementId,
                changedKeys,
                values,
              });
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
