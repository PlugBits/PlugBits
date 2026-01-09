import { create } from 'zustand';
import type { TemplateMeta, TemplateStatus } from '@shared/template';
import {
  archiveTemplate,
  fetchTemplateCatalog,
  listUserTemplateMetas,
  purgeTemplate,
  restoreTemplate,
  softDeleteTemplate,
  unarchiveTemplate,
  type TemplateCatalogItem,
} from '../services/templateService';

type TemplateListState = {
  ids: string[];
  nextCursor?: string;
  loading: boolean;
  error: string | null;
};

type TemplateListStore = {
  metasById: Record<string, TemplateMeta>;
  listStateByKey: Record<string, TemplateListState>;
  fetchSeqByKey: Record<string, number>;
  hasLoadedByKey: Record<string, boolean>;
  catalogItems: TemplateCatalogItem[];
  catalogLoading: boolean;
  catalogError: string | null;

  fetchTemplateMetas: (params: { status: TemplateStatus; baseTemplateId?: string }) => Promise<void>;
  ensureCatalog: () => Promise<void>;
  archiveTemplate: (templateId: string) => Promise<void>;
  unarchiveTemplate: (templateId: string) => Promise<void>;
  softDeleteTemplate: (templateId: string, fromStatus: TemplateStatus) => Promise<void>;
  restoreTemplate: (templateId: string) => Promise<void>;
  purgeTemplate: (templateId: string) => Promise<void>;
  upsertMeta: (patch: { templateId: string; name?: string; updatedAt?: string }) => void;
};

const buildListKey = (status: TemplateStatus, baseTemplateId?: string) =>
  `${status}:${baseTemplateId ?? ''}`;

const emptyListState = (): TemplateListState => ({
  ids: [],
  nextCursor: undefined,
  loading: false,
  error: null,
});

export const useTemplateListStore = create<TemplateListStore>((set, get) => ({
  metasById: {},
  listStateByKey: {},
  fetchSeqByKey: {},
  hasLoadedByKey: {},
  catalogItems: [],
  catalogLoading: false,
  catalogError: null,

  fetchTemplateMetas: async ({ status, baseTemplateId }) => {
    const key = buildListKey(status, baseTemplateId);
    const seq = (get().fetchSeqByKey[key] ?? 0) + 1;

    set((state) => ({
      fetchSeqByKey: { ...state.fetchSeqByKey, [key]: seq },
      listStateByKey: {
        ...state.listStateByKey,
        [key]: { ...(state.listStateByKey[key] ?? emptyListState()), loading: true, error: null },
      },
    }));

    try {
      const { items, nextCursor } = await listUserTemplateMetas({ status, baseTemplateId });
      if (get().fetchSeqByKey[key] !== seq) {
        console.warn('[templateListStore.fetchTemplateMetas] stale fetch skipped', { key, seq });
        return;
      }

      set((state) => {
        const metasById = { ...state.metasById };
        items.forEach((meta) => {
          metasById[meta.templateId] = meta;
        });
        return {
          metasById,
          hasLoadedByKey: {
            ...state.hasLoadedByKey,
            [key]: true,
          },
          listStateByKey: {
            ...state.listStateByKey,
            [key]: {
              ids: items.map((meta) => meta.templateId),
              nextCursor,
              loading: false,
              error: null,
            },
          },
        };
      });
    } catch (error) {
      if (get().fetchSeqByKey[key] !== seq) return;
      set((state) => ({
        listStateByKey: {
          ...state.listStateByKey,
          [key]: {
            ...(state.listStateByKey[key] ?? emptyListState()),
            loading: false,
            error: error instanceof Error ? error.message : 'テンプレートの取得に失敗しました',
          },
        },
      }));
    }
  },

  ensureCatalog: async () => {
    if (get().catalogLoading || get().catalogItems.length > 0) return;
    set({ catalogLoading: true, catalogError: null });
    try {
      const items = await fetchTemplateCatalog();
      set({ catalogItems: items, catalogLoading: false });
    } catch (error) {
      set({
        catalogLoading: false,
        catalogError: error instanceof Error ? error.message : 'テンプレートカタログの取得に失敗しました',
      });
    }
  },

  archiveTemplate: async (templateId) => {
    await archiveTemplate(templateId);
    await Promise.all([
      get().fetchTemplateMetas({ status: 'active' }),
      get().fetchTemplateMetas({ status: 'archived' }),
    ]);
  },

  unarchiveTemplate: async (templateId) => {
    await unarchiveTemplate(templateId);
    await Promise.all([
      get().fetchTemplateMetas({ status: 'archived' }),
      get().fetchTemplateMetas({ status: 'active' }),
    ]);
  },

  softDeleteTemplate: async (templateId, fromStatus) => {
    await softDeleteTemplate(templateId);
    await Promise.all([
      get().fetchTemplateMetas({ status: fromStatus }),
      get().fetchTemplateMetas({ status: 'deleted' }),
    ]);
  },

  restoreTemplate: async (templateId) => {
    await restoreTemplate(templateId);
    await Promise.all([
      get().fetchTemplateMetas({ status: 'deleted' }),
      get().fetchTemplateMetas({ status: 'active' }),
    ]);
  },

  purgeTemplate: async (templateId) => {
    await purgeTemplate(templateId);
    await get().fetchTemplateMetas({ status: 'deleted' });
  },

  upsertMeta: (patch) => {
    set((state) => {
      const current = state.metasById[patch.templateId];
      if (!current) return state;
      return {
        metasById: {
          ...state.metasById,
          [patch.templateId]: {
            ...current,
            ...patch,
          },
        },
      };
    });
  },
}));
