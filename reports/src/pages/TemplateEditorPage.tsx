import { previewPdf } from '../api/previewPdf';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { TemplateElement, TextElement, TableElement, LabelElement, ImageElement, PageSize } from '@shared/template';
import TemplateCanvas from '../components/TemplateCanvas';
import ElementInspector from '../components/ElementInspector';
import Toast from '../components/Toast';
import { selectTemplateById, useTemplateStore } from '../store/templateStore';
import { useTemplateListStore } from '../store/templateListStore';
import MappingPage from '../editor/Mapping/MappingPage';
import LabelEditorPanel from '../editor/Label/LabelEditorPanel';
import {
  normalizeEasyAdjustBlockSettings,
  resolveElementBlock,
  resolvePagePaddingPreset,
  resolveFontScalePreset,
} from '../utils/easyAdjust';
import { CANVAS_WIDTH, clampYToRegion } from '../utils/regionBounds';
import { computeDocumentMetaLayout } from '@shared/documentMetaLayout';
import { getAdapter } from '../editor/Mapping/adapters/getAdapter';
import { useEditorSession } from '../hooks/useEditorSession';

const AUTOSAVE_DELAY = 4000;

const TemplateEditorPage = () => {
  const { templateId } = useParams();
  const navigate = useNavigate();
  const template = useTemplateStore((state) => selectTemplateById(state, templateId));
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const loadTemplate = useTemplateStore((state) => state.loadTemplate);
  const loading = useTemplateStore((state) => state.loading);
  const error = useTemplateStore((state) => state.error);
  const saveTemplate = useTemplateStore((state) => state.saveTemplate);
  const upsertMeta = useTemplateListStore((state) => state.upsertMeta);
  const updateElement = useTemplateStore((state) => state.updateElement);
  const updateTemplate = useTemplateStore((state) => state.updateTemplate);
  const addElementToTemplate = useTemplateStore((state) => state.addElement);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [saveError, setSaveError] = useState('');
  const [nameDraft, setNameDraft] = useState('');
  const [toast, setToast] = useState<{ type: 'success' | 'error' | 'info'; message: string; subMessage?: string } | null>(null);
  const previousTemplateId = useRef<string | null>(null);
  const isEditingNameRef = useRef(false);
  const isUserInteractingRef = useRef(false);
  const isComposingRef = useRef(false);
  const imeJustEndedRef = useRef(false);
  const autosaveTimer = useRef<number | null>(null);
  const pendingSave = useRef(false);
  const lastSavedSignature = useRef<string>('');
  const [gridVisible, setGridVisible] = useState(true);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [guideVisible, setGuideVisible] = useState(true);
  const [advancedLayoutEditing, setAdvancedLayoutEditing] = useState(!!template?.advancedLayoutEditing);
  const [activeTab, setActiveTab] = useState<'adjust' | 'mapping'>('mapping');
  const LS_KEY = 'pb_reports_controls_open';
  const [controlsOpen, setControlsOpen] = useState<boolean>(() => {
    const v = localStorage.getItem(LS_KEY);
    return v === 'true';
  });

  const [highlightRef, setHighlightRef] = useState<any>(null);
  const { authState, tenantContext, params } = useEditorSession();
  const preservedQuery = useMemo(() => {
    const qs = params.toString();
    return qs ? `?${qs}` : '';
  }, [params]);
  const headerTemplateId = template?.id ?? templateId ?? '';
  const isLabelTemplate = template?.structureType === 'label_v1';
  const isCardTemplate =
    template?.structureType === 'cards_v1' &&
    ['cards_v1', 'cards_v2', 'card_v1', 'multiTable_v1'].includes(
      template?.baseTemplateId ?? '',
    );
  const EASY_ADJUST_GROUPS = [
    { key: 'header', label: 'Header' },
    { key: 'recipient', label: 'Recipient' },
    { key: 'body', label: 'Body' },
    { key: 'footer', label: 'Footer' },
  ] as const;
  const sheetSettings = template?.sheetSettings;
  const isLabelConfigInvalid =
    isLabelTemplate &&
    ((sheetSettings?.cols ?? 1) < 1 ||
      (sheetSettings?.rows ?? 1) < 1 ||
      !Number.isFinite(sheetSettings?.paperWidthMm ?? NaN) ||
      !Number.isFinite(sheetSettings?.paperHeightMm ?? NaN) ||
      (sheetSettings?.paperWidthMm ?? 0) <= 0 ||
      (sheetSettings?.paperHeightMm ?? 0) <= 0);

  useEffect(() => {
    if (!templateId || authState !== 'authorized') return;
    void loadTemplate(templateId);
  }, [templateId, loadTemplate, authState]);

  useEffect(() => {
    if (!template) return;

    if (previousTemplateId.current !== template.id) {
      setSelectedElementId(template.elements[0]?.id ?? null);
      setNameDraft(template.name);
      setAdvancedLayoutEditing(!!template.advancedLayoutEditing);
      previousTemplateId.current = template.id;
      return;
    }

    if (selectedElementId && template.elements.some((el) => el.id === selectedElementId)) {
      return;
    }

    setSelectedElementId(template.elements[0]?.id ?? null);
  }, [template?.id]);


  const templateSignature = useMemo(() => {
    if (!template) return '';
      return JSON.stringify({
        name: template.name,
        elements: template.elements,
        mapping: template.mapping ?? null,
        structureType: template.structureType ?? null,
        settings: template.settings ?? null,
        sheetSettings: template.sheetSettings ?? null,
        footerRepeatMode: template.footerRepeatMode ?? null,
        footerReserveHeight: template.footerReserveHeight ?? null,
        advancedLayoutEditing: !!template.advancedLayoutEditing,
        pageSize: template.pageSize ?? 'A4',
    });
  }, [template]);

  const isDirty = !!templateSignature && templateSignature !== lastSavedSignature.current;

  const updateTemplateSettings = (patch: Record<string, unknown>) => {
    if (!template) return;
    updateTemplate({
      ...template,
      settings: {
        ...(template.settings ?? {}),
        ...patch,
      },
    });
  };

  const updateEasyAdjustGroupSettings = (
    group: 'header' | 'recipient' | 'body' | 'footer' | 'documentMeta',
    patch: Record<string, unknown>,
  ) => {
    if (!template) return;
    const easyAdjust = { ...(template.settings?.easyAdjust ?? {}) } as Record<string, any>;
    const current = easyAdjust[group] ?? {};
    easyAdjust[group] = { ...current, ...patch };
    updateTemplateSettings({ easyAdjust });
  };

  const resetEasyAdjustGroupSettings = (
    group: 'header' | 'recipient' | 'body' | 'footer' | 'documentMeta',
  ) => {
    if (!template) return;
    const easyAdjust = { ...(template.settings?.easyAdjust ?? {}) } as Record<string, any>;
    delete easyAdjust[group];
    updateTemplateSettings({ easyAdjust });
  };


  useEffect(() => {
    if (!templateSignature || templateSignature === lastSavedSignature.current) {
      return undefined;
    }

    if (autosaveTimer.current) {
      window.clearTimeout(autosaveTimer.current);
    }

    autosaveTimer.current = window.setTimeout(() => {
      if (pendingSave.current) return;
      pendingSave.current = true;
      if (isEditingNameRef.current) {
        pendingSave.current = false;
        return;
      }
      if (isUserInteractingRef.current) {
        pendingSave.current = false;
        return;
      }
      handleSave(true)
        .catch((error) => console.error('Autosave failed', error))
        .finally(() => {
          pendingSave.current = false;
        });
    }, AUTOSAVE_DELAY);

    return () => {
      if (autosaveTimer.current) {
        window.clearTimeout(autosaveTimer.current);
        autosaveTimer.current = null;
      }
    };
  }, [templateSignature]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!isDirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [isDirty]);

  useEffect(() => {
    if (!template) return;
    const isUserTemplate = template.id.startsWith('tpl_') && !!template.baseTemplateId;
    if (isUserTemplate) return;

    const structureType = template.structureType ?? 'list_v1';
    if (structureType === 'label_v1') return;
    const adapter = getAdapter(structureType);
    const mapping = template.mapping ?? adapter.createDefaultMapping();

    const synced = adapter.applyMappingToTemplate(
      { ...template, structureType, mapping },
      mapping,
    );

    const elementsSig = (els: TemplateElement[]) => {
      const norm = [...(els ?? [])]
        .sort((a, b) => (a.id ?? '').localeCompare(b.id ?? ''))
        .map((e) => {
          const base = {
            id: e.id,
            type: e.type,
            slotId: (e as any).slotId ?? null,
            region: (e as any).region ?? null,
          };

          // dataSource（text / image / table）
          const ds = (e as any).dataSource;
          const dsSig =
            ds?.type === 'static'
              ? `static:${ds.value ?? ''}`
              : ds?.type === 'kintone'
              ? `kintone:${ds.fieldCode ?? ''}`
              : ds?.type === 'kintoneSubtable'
              ? `subtable:${ds.fieldCode ?? ''}`
              : '';

          if (e.type === 'label') {
            return { ...base, ds: '', text: (e as any).text ?? '' };
          }

          if (e.type === 'text') {
            return { ...base, ds: dsSig };
          }

          if (e.type === 'image') {
            return { ...base, ds: dsSig };
          }

          if (e.type === 'table') {
            const cols = ((e as any).columns ?? [])
              .slice()
              .sort((a: any, b: any) => (a.id ?? '').localeCompare(b.id ?? ''))
              .map((c: any) => ({
                id: c.id ?? '',
                title: c.title ?? '',
                fieldCode: c.fieldCode ?? '',
                width: Number(c.width ?? 0),
                align: c.align ?? null,
              }));

            return { ...base, ds: dsSig, cols };
          }

          if (e.type === 'cardList') {
            const fields = ((e as any).fields ?? [])
              .slice()
              .sort((a: any, b: any) => (a.id ?? '').localeCompare(b.id ?? ''))
              .map((f: any) => ({
                id: f.id ?? '',
                label: f.label ?? '',
                fieldCode: f.fieldCode ?? '',
              }));
            return {
              ...base,
              ds: dsSig,
              cardHeight: Number((e as any).cardHeight ?? 0),
              fields,
            };
          }

          return { ...base, ds: dsSig };
        });

      // JSON stringifyは「norm（軽量化済み）」に対してだけ許可
      return JSON.stringify(norm);
    };

    // 無限ループ防止：mapping が変わった時だけ反映
    const beforeSig = JSON.stringify({
      structureType: template.structureType,
      mapping: template.mapping ?? null,
      elementsSig: elementsSig(template.elements ?? []),
    });
    const afterSig = JSON.stringify({
      structureType: synced.structureType,
      mapping: synced.mapping ?? null,
      elementsSig: elementsSig(synced.elements ?? []),
    });

    if (beforeSig !== afterSig) {
      updateTemplate(synced);
    }
  }, [template?.id, template?.mapping, template?.structureType, template?.baseTemplateId, updateTemplate]);

  useEffect(() => {
    if (!template) return;
    if (template.structureType === 'label_v1') return;

    const docMetaSettings = normalizeEasyAdjustBlockSettings(template, 'documentMeta');
    let normalizedSettings = template.settings ?? {};
    let settingsChanged = false;
    const rawEasyAdjust = (template.settings?.easyAdjust ?? {}) as Record<string, any>;
    const rawDocMeta = rawEasyAdjust.documentMeta;
    if (rawDocMeta && typeof rawDocMeta === 'object') {
      const { layoutMode, metaLayout, metaPosition, ...rest } = rawDocMeta as Record<string, unknown>;
      if ('layoutMode' in rawDocMeta || 'metaLayout' in rawDocMeta || 'metaPosition' in rawDocMeta) {
        normalizedSettings = {
          ...(template.settings ?? {}),
          easyAdjust: {
            ...rawEasyAdjust,
            documentMeta: rest,
          },
        };
        settingsChanged = true;
      }
    }

    const elements = template.elements ?? [];
    const nextElements = [...elements];
    let changed = false;
    const indexById = new Map<string, number>();
    nextElements.forEach((el, idx) => indexById.set(el.id, idx));

    const applyPatch = <T extends TemplateElement>(el: T, patch: Partial<T>) => {
      let hasDiff = false;
      for (const [key, value] of Object.entries(patch)) {
        if (!Object.is((el as any)[key], value)) {
          hasDiff = true;
          break;
        }
      }
      if (!hasDiff) return el;
      changed = true;
      return { ...el, ...patch };
    };

    const updateElement = <T extends TemplateElement>(el: T, patch: Partial<T>) => {
      const idx = indexById.get(el.id);
      if (idx === undefined) return;
      const next = applyPatch(el, patch);
      if (next !== el) {
        nextElements[idx] = next;
      }
    };

    const ensureTextElement = (id: string, base: TextElement) => {
      const idx = indexById.get(id);
      if (idx !== undefined) return nextElements[idx] as TextElement;
      const next = { ...base };
      nextElements.push(next);
      indexById.set(id, nextElements.length - 1);
      changed = true;
      return next;
    };

    const findBySlotOrId = (slotId: string) =>
      nextElements.find((el) => (el as any).slotId === slotId || el.id === slotId) as
        | TemplateElement
        | undefined;

    const logo = findBySlotOrId('logo') as ImageElement | undefined;
    const logoX = Number.isFinite(logo?.x) ? (logo?.x as number) : 450;
    const logoY = Number.isFinite(logo?.y) ? (logo?.y as number) : 752;
    const logoW = Number.isFinite(logo?.width) ? (logo?.width as number) : 120;
    const logoH = Number.isFinite(logo?.height) ? (logo?.height as number) : 60;

    const docNo = findBySlotOrId('doc_no') as TextElement | undefined;
    const issueDate = findBySlotOrId('issue_date') as TextElement | undefined;

    if (docNo || issueDate) {
      const headerSettings = normalizeEasyAdjustBlockSettings(template, 'header');
      const headerFontScale = resolveFontScalePreset(headerSettings.fontPreset);
      const headerPadding = resolvePagePaddingPreset(headerSettings.paddingPreset);
      const docNoFontSize = (docNo?.fontSize ?? 10) * headerFontScale;
      const dateFontSize = (issueDate?.fontSize ?? 10) * headerFontScale;
      const labelFontSize = 9 * headerFontScale;
      const blockWidth = Math.min(280, Math.max(200, logoW));
      const blockRight = CANVAS_WIDTH - headerPadding;
      const blockX = Math.max(headerPadding, blockRight - blockWidth);
      const fallbackLabelWidth = Math.min(56, blockWidth);
      const fallbackTopY = logoY - 12;

      const ensureDocNoLabel = () => {
        const docNoLabel = ensureTextElement('doc_no_label', {
          id: 'doc_no_label',
          type: 'text',
          region: 'header',
          x: blockX,
          y: fallbackTopY,
          width: fallbackLabelWidth,
          height: 16,
          fontSize: 9,
          repeatOnEveryPage: true,
          dataSource: { type: 'static', value: '文書番号' },
        });
        const labelSource = (docNoLabel as any).dataSource as { type?: string; value?: string } | undefined;
        const labelPatch: Partial<TextElement> = {
          region: 'header',
          fontSize: 9,
          repeatOnEveryPage: true,
        };
        if (labelSource?.type !== 'static' || !labelSource.value) {
          labelPatch.dataSource = { type: 'static', value: '文書番号' };
        }
        updateElement(docNoLabel, labelPatch);
      };
      const ensureDateLabel = () => {
        const existing = findBySlotOrId('date_label') as TextElement | undefined;
        if (existing) {
          const ds = (existing as any).dataSource as { type?: string; value?: string } | undefined;
          const patch: Partial<TextElement> = {
            region: 'header',
            fontSize: 9,
            repeatOnEveryPage: true,
          };
          if (!ds || ds.type !== 'static' || !ds.value) {
            patch.dataSource = { type: 'static', value: '日付' };
          }
          updateElement(existing, patch);
          return existing;
        }
        const next = ensureTextElement('date_label', {
          id: 'date_label',
          slotId: 'date_label',
          type: 'text',
          region: 'header',
          x: blockX,
          y: logoY - 12,
          width: fallbackLabelWidth,
          height: 16,
          fontSize: 9,
          repeatOnEveryPage: true,
          dataSource: { type: 'static', value: '日付' },
        });
        return next;
      };

      if (docMetaSettings.docNoVisible) {
        ensureDocNoLabel();
      }
      if (docMetaSettings.dateVisible) {
        ensureDateLabel();
      }

      const layout = computeDocumentMetaLayout({
        logoX,
        logoY,
        logoWidth: logoW,
        logoHeight: logoH,
        blockX,
        blockWidth,
        gap: 12,
        labelWidth: 56,
        columnGap: 8,
        rowGap: 6,
        minValueWidth: 80,
        docNoVisible: docMetaSettings.docNoVisible,
        dateVisible: docMetaSettings.dateVisible,
        fontSizes: {
          docNoLabel: labelFontSize,
          docNoValue: docNoFontSize,
          dateLabel: labelFontSize,
          dateValue: dateFontSize,
        },
        heights: {
          docNoLabel: (findBySlotOrId('doc_no_label') as TextElement | undefined)?.height,
          docNoValue: docNo?.height,
          dateLabel: (findBySlotOrId('date_label') as TextElement | undefined)?.height,
          dateValue: issueDate?.height,
        },
      });

      const docNoLabelEl = findBySlotOrId('doc_no_label') as TextElement | undefined;
      if (docNoLabelEl && layout.docNoLabel) {
        updateElement(docNoLabelEl, {
          region: 'header',
          x: layout.docNoLabel.x,
          y: layout.docNoLabel.y,
          width: layout.docNoLabel.width,
          height: layout.docNoLabel.height,
          fontSize: 9,
          repeatOnEveryPage: true,
        });
      }
      if (docNo && layout.docNoValue) {
        updateElement(docNo, {
          region: 'header',
          x: layout.docNoValue.x,
          y: layout.docNoValue.y,
          width: layout.docNoValue.width,
          height: layout.docNoValue.height,
          repeatOnEveryPage: true,
        });
      }
      const dateLabelEl = findBySlotOrId('date_label') as TextElement | undefined;
      if (dateLabelEl && layout.dateLabel) {
        updateElement(dateLabelEl, {
          region: 'header',
          x: layout.dateLabel.x,
          y: layout.dateLabel.y,
          width: layout.dateLabel.width,
          height: layout.dateLabel.height,
          fontSize: 9,
          repeatOnEveryPage: true,
        });
      }
      if (issueDate && layout.dateValue) {
        updateElement(issueDate, {
          region: 'header',
          x: layout.dateValue.x,
          y: layout.dateValue.y,
          width: layout.dateValue.width,
          height: layout.dateValue.height,
          repeatOnEveryPage: true,
        });
      }
    }

    const toName = findBySlotOrId('to_name') as TextElement | undefined;
    if (toName) {
      const baseWidth = Number.isFinite(toName.width) ? (toName.width as number) : 280;
      const baseHeight = Number.isFinite(toName.height) ? (toName.height as number) : 18;
      const baseY = clampYToRegion(
        Number.isFinite(toName.y) ? (toName.y as number) : 720,
        'header',
      );
      const labelWidth = 46;
      const honorificWidth = 24;
      const gap = 6;
      let nameX = 60;
      let nameWidth = baseWidth;

      const toLabel = ensureTextElement('to_label', {
        id: 'to_label',
        type: 'text',
        region: 'header',
        x: nameX,
        y: baseY,
        width: labelWidth,
        height: baseHeight,
        fontSize: 9,
        repeatOnEveryPage: true,
        dataSource: { type: 'static', value: '宛先' },
      });
      const toLabelSource = (toLabel as any).dataSource as { type?: string; value?: string } | undefined;
      const toLabelPatch: Partial<TextElement> = {
        region: 'header',
        x: nameX,
        y: baseY,
        width: labelWidth,
        height: baseHeight,
        fontSize: 9,
        repeatOnEveryPage: true,
      };
      if (toLabelSource?.type !== 'static' || !toLabelSource.value) {
        toLabelPatch.dataSource = { type: 'static', value: '宛先' };
      }
      updateElement(toLabel, toLabelPatch);
      nameX = nameX + labelWidth + gap;
      nameWidth = Math.max(120, baseWidth - labelWidth - gap);

      const honorific = findBySlotOrId('to_honorific') as TextElement | undefined;
      if (honorific) {
        nameWidth = Math.max(120, nameWidth - honorificWidth - gap);
        updateElement(honorific, {
          region: 'header',
          x: nameX + nameWidth + gap,
          y: baseY,
          width: honorificWidth,
          height: baseHeight,
          repeatOnEveryPage: true,
          fontSize: 9,
        });
      }

      updateElement(toName, {
        region: 'header',
        x: nameX,
        y: baseY,
        width: nameWidth,
        height: baseHeight,
        repeatOnEveryPage: true,
      });
    }

    if (changed || settingsChanged) {
      const nextTemplate = settingsChanged
        ? { ...template, elements: nextElements, settings: normalizedSettings }
        : { ...template, elements: nextElements };
      updateTemplate(nextTemplate);
    }
  }, [template, updateTemplate]);

  const isDocumentMetaElement = (element: TemplateElement | null | undefined) => {
    if (!element) return false;
    const slotId = (element as any).slotId as string | undefined;
    return (
      slotId === 'doc_no' ||
      slotId === 'date_label' ||
      slotId === 'issue_date' ||
      element.id === 'doc_no_label'
    );
  };


  const selectedElement = useMemo<TemplateElement | null>(() => {
    if (!template || !selectedElementId) return null;
    return template.elements.find((element) => element.id === selectedElementId) ?? null;
  }, [template, selectedElementId]);

  useEffect(() => {
    if (!template || !selectedElementId) return;
    if (!selectedElement) return;
    if (!isDocumentMetaElement(selectedElement)) return;
    const fallback = template.elements.find((el) => !isDocumentMetaElement(el))?.id ?? null;
    if (fallback !== selectedElementId) {
      setSelectedElementId(fallback);
    }
  }, [template, selectedElementId, selectedElement]);

  const blockLabelMap = useMemo(
    () => ({
      header: 'Header',
      recipient: 'Recipient',
      documentMeta: '文書情報',
      body: 'Body',
      footer: 'Footer',
    }),
    [],
  );
  const currentBlockLabel = useMemo(() => {
    if (!template || !selectedElement) return '未選択';
    const block = resolveElementBlock(selectedElement, template);
    return blockLabelMap[block] ?? '未選択';
  }, [template, selectedElement, blockLabelMap]);

  const highlightedElementIds = useMemo(() => {
    const set = new Set<string>();
    if (!template || !highlightRef) return set;

    if (highlightRef.kind === 'slot') {
      for (const el of template.elements) {
        if ((el as any).slotId === highlightRef.slotId) {
          set.add(el.id);
        }
      }
      return set;
    }

    if (highlightRef.kind === 'recordField') {
      for (const el of template.elements) {
        const ds = (el as any).dataSource;
        if (ds?.type === 'kintone' && ds.fieldCode === highlightRef.fieldCode) {
          set.add(el.id);
        }
      }
    }

    if (highlightRef.kind === 'subtable') {
      for (const el of template.elements) {
        if (
          (el.type === 'table' || el.type === 'cardList') &&
          el.dataSource?.fieldCode === highlightRef.fieldCode
        ) {
          set.add(el.id);
        }
      }
    }

    if (highlightRef.kind === 'subtableField') {
      // MVP：列単位ではなく「そのサブテーブルの table 要素」を光らせる
      for (const el of template.elements) {
        if (
          (el.type === 'table' || el.type === 'cardList') &&
          el.dataSource?.fieldCode === highlightRef.subtableCode
        ) {
          set.add(el.id);
        }
      }
    }

    return set;
  }, [template, highlightRef]);

  const slotLabelMap = useMemo(() => {
    const structureType = template?.structureType ?? 'list_v1';
    if (structureType === 'label_v1') return {};
    const adapter = getAdapter(structureType);
    const map: Record<string, string> = {};
    for (const region of adapter.regions) {
      if (region.kind !== 'slots') continue;
      for (const slot of region.slots) {
        map[slot.id] = slot.label;
      }
    }
    return map;
  }, [template?.structureType]);

  const describeElementForList = (el: any) => {
    if (el.type === 'table') {
      const ds = el.dataSource;
      return ds?.fieldCode ? `サブテーブル: ${ds.fieldCode}` : 'サブテーブル: (未設定)';
    }
    if (el.type === 'cardList') {
      const ds = el.dataSource;
      return ds?.fieldCode ? `サブテーブル: ${ds.fieldCode}` : 'サブテーブル: (未設定)';
    }
    if (el.type === 'label') return el.text ?? '';
    const ds = el.dataSource;
    if (!ds) return '';
    if (ds.type === 'static') return ds.value ?? '';
    if (ds.type === 'kintone') return ds.fieldCode ?? '';
    if (ds.type === 'kintoneSubtable') return ds.fieldCode ?? '';
    return '';
  };

  const typeLabelForList = (type: string) => {
    if (type === 'text') return 'テキスト';
    if (type === 'label') return 'ラベル';
    if (type === 'image') return '画像';
    if (type === 'table') return 'テーブル';
    if (type === 'cardList') return 'カード枠';
    return '要素';
  };

  const SLOT_ORDER = [
    'doc_title',
    'to_name',
    'issue_date',
    'doc_no',
    'logo',
    'remarks',
    'subtotal',
    'tax',
    'total',
  ] as const;

  const slotRank = (slotId?: string) => {
    if (!slotId) return 9999;
    const idx = SLOT_ORDER.indexOf(slotId as any);
    return idx >= 0 ? idx : 9998;
  };

  const regionOf = (el: any) => (el.region ?? 'body') as 'header' | 'body' | 'footer';

  const sortedByRegion = (elements: any[], region: 'header' | 'body' | 'footer') => {
    const list = elements.filter((e) => regionOf(e) === region);
    return list.sort((a, b) => {
      const aHasSlot = !!a.slotId;
      const bHasSlot = !!b.slotId;
      if (aHasSlot !== bHasSlot) return aHasSlot ? -1 : 1;

      const ar = slotRank(a.slotId);
      const br = slotRank(b.slotId);
      if (ar !== br) return ar - br;

      const ay = typeof a.y === 'number' ? a.y : 0;
      const by = typeof b.y === 'number' ? b.y : 0;
      if (ay !== by) return by - ay;

      const ax = typeof a.x === 'number' ? a.x : 0;
      const bx = typeof b.x === 'number' ? b.x : 0;
      return ax - bx;
    });
  };

  const toggleControls = () => {
    setControlsOpen((prev) => {
      const next = !prev;
      localStorage.setItem(LS_KEY, String(next));
      return next;
    });
  };

  const persistTemplateName = () => {
    if (!template) return '';
    const normalized = nameDraft.trim() || template.name || '名称未設定';
    if (normalized !== nameDraft) {
      setNameDraft(normalized);
    }
    updateTemplate({ ...template, name: normalized });
    return normalized;
  };

  const handleAddText = () => {
    if (!template) return;
    const newElement: TextElement = {
      id: `text_${Date.now()}`,
      type: 'text',
      x: 40,
      y: 700,
      fontSize: 12,
      width: 160,
      height: 24,
      dataSource: { type: 'static', value: '新しいテキスト' },
    };
    addElementToTemplate(template.id, newElement);
    setSelectedElementId(newElement.id);
  };

  const handleAddTable = () => {
    if (!template) return;
    const newElement: TableElement = {
      id: `table_${Date.now()}`,
      type: 'table',
      x: 40,
      y: 600,
      width: 400,
      rowHeight: 18,
      headerHeight: 24,
      showGrid: true,
      dataSource: { type: 'kintoneSubtable', fieldCode: 'Subtable' },
      columns: [
        { id: `col_${Date.now()}_1`, title: '列1', fieldCode: 'Field1', width: 160 },
        { id: `col_${Date.now()}_2`, title: '列2', fieldCode: 'Field2', width: 160 },
      ],
    };
    addElementToTemplate(template.id, newElement);
    setSelectedElementId(newElement.id);
  };

  const handleAddLabel = () => {
    if (!template) return;
    const newElement: LabelElement = {
      id: `label_${Date.now()}`,
      type: 'label',
      x: 40,
      y: 750,
      fontSize: 12,
      text: 'ラベル',
    };
    addElementToTemplate(template.id, newElement);
    setSelectedElementId(newElement.id);
  };

  const handleAddImage = () => {
    if (!template) return;
    const newElement: ImageElement = {
      id: `image_${Date.now()}`,
      type: 'image',
      x: 60,
      y: 520,
      width: 120,
      height: 80,
      dataSource: { type: 'static', value: 'logo-placeholder' },
    };
    addElementToTemplate(template.id, newElement);
    setSelectedElementId(newElement.id);
  };

  const handleSave = async (isAutosave = false) => {
    if (!template) return;
    if (isLabelTemplate && isLabelConfigInvalid) {
      if (!isAutosave) {
        setSaveStatus('error');
        setSaveError('面付けが成立しません。ラベルサイズと余白を確認してください。');
      }
      return;
    }
    setSaveStatus('saving');
    setSaveError('');
    try {
      const normalizedName = persistTemplateName();
      updateTemplate({ ...template, name: normalizedName });
      await saveTemplate(template.id, { nameOverride: normalizedName });
      upsertMeta({
        templateId: template.id,
        name: normalizedName,
        updatedAt: new Date().toISOString(),
      });
      lastSavedSignature.current = JSON.stringify({
        name: normalizedName,
        elements: template.elements,
        mapping: template.mapping ?? null,
        structureType: template.structureType ?? null,
        sheetSettings: template.sheetSettings ?? null,
        footerRepeatMode: template.footerRepeatMode ?? null,
        footerReserveHeight: template.footerReserveHeight ?? null,
        advancedLayoutEditing: !!template.advancedLayoutEditing,
        pageSize: template.pageSize ?? 'A4',
      });
      setSaveStatus('success');
      setToast({
        type: 'success',
        message: 'テンプレートを保存しました',
        subMessage: isAutosave ? '自動保存が完了しました' : undefined,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '保存に失敗しました';
      setSaveStatus('error');
      setSaveError(message);
      setToast({ type: 'error', message });
    }
  };

  useEffect(() => {
    if (saveStatus === 'success') {
      const handle = setTimeout(() => setSaveStatus('idle'), 2000);
      return () => clearTimeout(handle);
    }
    return undefined;
  }, [saveStatus]);

  return (
    <section
      style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}
      onPointerDownCapture={() => {
        isUserInteractingRef.current = true;
      }}
      onKeyDownCapture={(event) => {
        const nativeEvent = event.nativeEvent as KeyboardEvent;
        if (nativeEvent?.isComposing) return;
        isUserInteractingRef.current = true;
      }}
      onPointerUpCapture={() => {
        window.setTimeout(() => {
          isUserInteractingRef.current = false;
        }, 100);
      }}
      onBlurCapture={() => {
        window.setTimeout(() => {
          isUserInteractingRef.current = false;
        }, 100);
      }}
    >
      {authState === 'checking' && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <p style={{ margin: 0, color: '#475467' }}>Loading...</p>
        </div>
      )}

      {authState === 'unauthorized' && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <p style={{ margin: 0, color: '#475467' }}>
            プラグインから起動してください（短命トークンが必要です）。
          </p>
        </div>
      )}

      {authState === 'authorized' && !template && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <p>
            {loading
              ? 'テンプレートを読み込み中...'
              : error
              ? error
              : 'テンプレートが見つかりませんでした。'}
          </p>
          <button className="secondary" onClick={() => navigate(`/${preservedQuery}`)}>一覧へ戻る</button>
        </div>
      )}

      {authState === 'authorized' && template && (
      <>
        <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '0.75rem 0.75rem 0.5rem',
            gap: '0.75rem',
          }}
        >
          <div>
            {headerTemplateId && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '2px 10px',
                  borderRadius: 999,
                  border: '1px solid #e4e7ec',
                  background: '#f2f4f7',
                  color: '#344054',
                  fontSize: '0.85rem',
                  marginBottom: '0.6rem',
                }}
              >
                選択中テンプレ: {headerTemplateId}
              </span>
            )}
            <input
              type="text"
              value={nameDraft}
              onChange={(event) => setNameDraft(event.target.value)}
              onCompositionStart={() => {
                isComposingRef.current = true;
              }}
              onCompositionEnd={() => {
                isComposingRef.current = false;
                imeJustEndedRef.current = true;
                window.setTimeout(() => {
                  imeJustEndedRef.current = false;
                }, 0);
              }}
              onFocus={() => {
                isEditingNameRef.current = true;
              }}
              onBlur={() => {
                isEditingNameRef.current = false;
                persistTemplateName();
              }}
              onKeyDown={(event) => {
                const nativeEvent = event.nativeEvent as any;
                if (nativeEvent?.isComposing) return;
                if (isComposingRef.current) return;
                if (imeJustEndedRef.current) return;
                if (nativeEvent?.keyCode === 229) return;
                if (event.key === 'Enter') {
                  event.currentTarget.blur();
                }
              }}
              style={{
                fontSize: '1.2rem',
                fontWeight: 600,
                border: '1px solid #d0d5dd',
                borderRadius: '0.6rem',
                padding: '0.4rem 0.8rem',
                width: 'min(420px, 60vw)',
              }}
            />
            <p style={{ margin: 0, color: '#475467' }}>要素数: {template.elements.length}</p>
            <p style={{ margin: 0, color: '#98a2b3', fontSize: '0.85rem' }}>
              保存先: {tenantContext?.workerBaseUrl ?? '未設定'}
            </p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.35rem' }}>
            {isLabelTemplate && (
              <div className="button-row">
                <button
                  className="secondary"
                  onClick={() => { void previewPdf(template); }}
                >
                  PDFプレビュー
                </button>
                <button
                  className="ghost"
                  onClick={() => { void handleSave(); }}
                  disabled={saveStatus === 'saving' || isLabelConfigInvalid}
                >
                  {saveStatus === 'saving' ? '保存中...' : '保存'}
                </button>
              </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              {saveStatus === 'success' && <span className="status-pill success">保存しました</span>}
              {saveStatus === 'error' && <span className="status-pill error">{saveError}</span>}
              {isLabelConfigInvalid && (
                <span className="status-pill error">面付けが成立しません</span>
              )}
            </div>
          </div>
        </div>
      {controlsOpen && !isLabelTemplate && (
        <div
          style={{
            padding: '0.5rem 0.75rem 0.75rem',
            borderTop: '1px solid #e4e7ec',
            background: '#fff',
            }}
          >
            <div className="button-row" style={{ marginBottom: '0.6rem' }}>
              <button className="ghost" onClick={handleAddLabel} disabled={!template.advancedLayoutEditing}>
                + ラベル
              </button>
              <button className="ghost" onClick={handleAddText} disabled={!template.advancedLayoutEditing}>
                + テキスト
              </button>
              <button className="ghost" disabled title="明細テーブルはフィールド割当で編集します">
                + テーブル
              </button>
              <button className="ghost" onClick={handleAddImage} disabled={!template.advancedLayoutEditing}>
                + 画像
              </button>
            </div>
            <div
              style={{
                display: 'flex',
                gap: '1.25rem',
                flexWrap: 'wrap',
                fontSize: '0.9rem',
              }}
            >
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <input type="checkbox" checked={gridVisible} onChange={(event) => setGridVisible(event.target.checked)} />
                グリッド表示
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <input type="checkbox" checked={snapEnabled} onChange={(event) => setSnapEnabled(event.target.checked)} />
                グリッドにスナップ
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <input type="checkbox" checked={guideVisible} onChange={(event) => setGuideVisible(event.target.checked)} />
                ガイドライン表示
              </label>
              <label>
                <input type="checkbox" checked={!!template.advancedLayoutEditing} onChange={(event) =>{
                  const enabled = event.target.checked; 
                  setAdvancedLayoutEditing(enabled); 
                  updateTemplate({...template,advancedLayoutEditing: enabled});
                  }}
                />
                上級者モード（レイアウトXY編集・自己責任）
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                用紙サイズ
                <select
                  value={template.pageSize ?? 'A4'}
                  onChange={(event) => {
                    const next = event.target.value as PageSize;
                    updateTemplate({ ...template, pageSize: next });
                  }}
                >
                  <option value="A4">A4</option>
                  <option value="Letter">Letter</option>
                </select>
              </label>
            </div>
          </div>
        )}
      </div>
      {isCardTemplate ? (
        <div className="card" style={{ padding: '1rem' }}>
          <h3 style={{ marginTop: 0 }}>Card テンプレートは非推奨です</h3>
          <p style={{ color: '#475467' }}>
            Card 系テンプレートの編集・複製は終了しました。既存テンプレートは引き続きPDF出力に利用できます。
          </p>
          <button className="secondary" onClick={() => navigate(`/${preservedQuery}`)}>
            一覧へ戻る
          </button>
        </div>
      ) : isLabelTemplate ? (
        <div
          className="card"
          style={{
            padding: '1rem',
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            overflowX: 'hidden',
          }}
        >
          <LabelEditorPanel template={template} onChange={updateTemplate} />
        </div>
      ) : (
        <div className="editor-layout" style={{ flex: 1, minHeight: 0 }}>
          <div className="canvas-wrapper" style={{ minHeight: 0, maxHeight: '100%', height: '100%', overflow: 'auto' }}>
            <TemplateCanvas
              template={template}
              selectedElementId={selectedElementId}
              onSelect={(element) => {
                if (!element) {
                  setSelectedElementId(null);
                  return;
                }
                if (isDocumentMetaElement(element)) {
                  return;
                }
                setSelectedElementId(element.id);
              }}
              onUpdateElement={(elementId, updates) => updateElement(template.id, elementId, updates)}
              showGrid={gridVisible}
              snapEnabled={snapEnabled}
              showGuides={guideVisible}
              highlightedElementIds={highlightedElementIds}
              slotLabels={slotLabelMap}
            />
          </div>
          <div
            className="editor-panel"
            style={{
              position: 'sticky',
              top: 24,
              alignSelf: 'flex-start',
              maxHeight: '100%',
              height: '100%',
              minHeight: 0,
              overflow: 'hidden',
            }}
          >
            <div style={{ maxHeight: '100%', height: '100%', minHeight: 0, overflowY: 'auto' }}>
              {!isLabelTemplate && !isCardTemplate && template && (
                <div
                  style={{
                    position: 'sticky',
                    top: 0,
                    zIndex: 5,
                    background: '#fff',
                    borderBottom: '1px solid #e4e7ec',
                    padding: '10px 12px',
                    margin: '-10px -12px 12px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          fontWeight: 700,
                          fontSize: 14,
                          color: '#101828',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          maxWidth: 180,
                        }}
                        title={template.name}
                      >
                        {template.name}
                      </div>
                      <div style={{ fontSize: 12, color: '#344054', marginTop: 2, fontWeight: 600 }}>
                        編集対象: {currentBlockLabel}
                      </div>
                      <div style={{ fontSize: 11, color: '#667085', marginTop: 2 }}>
                        {isDirty ? '未保存' : '保存済'}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="secondary" onClick={() => { void previewPdf(template); }}>
                        PDFプレビュー
                      </button>
                      <button
                        className="ghost"
                        onClick={() => { void handleSave(); }}
                        disabled={saveStatus === 'saving' || isLabelConfigInvalid}
                      >
                        {saveStatus === 'saving' ? '保存中...' : '保存'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {/* 右ペイン切替ボタン（ここに移動） */}
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <button
                  className={activeTab === 'adjust' ? 'secondary' : 'ghost'}
                  onClick={() => setActiveTab('adjust')}
                  type="button"
                >
                  かんたん調整
                </button>
                <button
                  className={activeTab === 'mapping' ? 'secondary' : 'ghost'}
                  onClick={() => setActiveTab('mapping')}
                  type="button"
                >
                  割当
                </button>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                <button
                  className="ghost"
                  onClick={() => {
                    if (isDirty && !window.confirm('未保存の変更があります。一覧へ戻りますか？')) {
                      return;
                    }
                    navigate(`/${preservedQuery}`);
                  }}
                  type="button"
                >
                  一覧へ戻る
                </button>
                {!isLabelTemplate && (
                  <button className="ghost" onClick={toggleControls} type="button">
                    詳細設定 {controlsOpen ? '▲' : '▼'}
                  </button>
                )}
              </div>
              {activeTab === 'adjust' && template && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {(() => {
                    const docMeta = normalizeEasyAdjustBlockSettings(template, 'documentMeta');
                    return (
                      <div
                        style={{
                          border: '1px solid #e4e7ec',
                          borderRadius: 12,
                          padding: 10,
                          background: '#fff',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                          <div style={{ fontWeight: 700, fontSize: 13, color: '#101828' }}>文書情報</div>
                          <button
                            type="button"
                            className="ghost"
                            onClick={() => resetEasyAdjustGroupSettings('documentMeta')}
                            style={{ fontSize: 11, padding: '4px 8px' }}
                          >
                            リセット
                          </button>
                        </div>
                        <div style={{ fontSize: 12, color: '#475467', marginBottom: 6, fontWeight: 600 }}>
                          表示
                        </div>
                        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                          {([
                            { key: 'docNoVisible', label: '文書番号', active: docMeta.docNoVisible },
                            { key: 'dateVisible', label: '日付', active: docMeta.dateVisible },
                          ] as const).map((item) => (
                            <button
                              key={item.key}
                              type="button"
                              onClick={() =>
                                updateEasyAdjustGroupSettings('documentMeta', {
                                  [item.key]: !item.active,
                                })
                              }
                              style={{
                                padding: '4px 10px',
                                borderRadius: 6,
                                border: `1px solid ${item.active ? '#2563eb' : '#d0d5dd'}`,
                                background: item.active ? '#eff6ff' : '#fff',
                                color: item.active ? '#1d4ed8' : '#344054',
                                fontSize: '0.8rem',
                                fontWeight: 600,
                                cursor: 'pointer',
                              }}
                            >
                              {item.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                  {EASY_ADJUST_GROUPS.map((group) => {
                    const settings = normalizeEasyAdjustBlockSettings(template, group.key);
                    return (
                      <div
                        key={group.key}
                        style={{
                          border: '1px solid #e4e7ec',
                          borderRadius: 12,
                          padding: 10,
                          background: '#fff',
                        }}
                        >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                          <div style={{ fontWeight: 700, fontSize: 13, color: '#101828' }}>{group.label}</div>
                          <button
                            type="button"
                            className="ghost"
                            onClick={() => resetEasyAdjustGroupSettings(group.key)}
                            style={{ fontSize: 11, padding: '4px 8px' }}
                          >
                            リセット
                          </button>
                        </div>
                        <div style={{ fontSize: 12, color: '#475467', marginBottom: 6, fontWeight: 600 }}>
                          ブロック
                        </div>
                        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                          {([
                            { key: true, label: '表示' },
                            { key: false, label: '非表示' },
                          ] as const).map((item) => {
                            const active = settings.enabled === item.key;
                            return (
                              <button
                                key={String(item.key)}
                                type="button"
                                onClick={() => updateEasyAdjustGroupSettings(group.key, { enabled: item.key })}
                                style={{
                                  padding: '4px 10px',
                                  borderRadius: 6,
                                  border: `1px solid ${active ? '#2563eb' : '#d0d5dd'}`,
                                  background: active ? '#eff6ff' : '#fff',
                                  color: active ? '#1d4ed8' : '#344054',
                                  fontSize: '0.8rem',
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                }}
                              >
                                {item.label}
                              </button>
                            );
                          })}
                        </div>
                        <div style={{ fontSize: 12, color: '#475467', marginBottom: 6, fontWeight: 600 }}>
                          フォントサイズ
                        </div>
                        <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                          {(['S', 'M', 'L'] as const).map((value) => {
                            const active = settings.fontPreset === value;
                            return (
                              <button
                                key={value}
                                type="button"
                                onClick={() => updateEasyAdjustGroupSettings(group.key, { fontPreset: value })}
                                style={{
                                  padding: '4px 10px',
                                  borderRadius: 6,
                                  border: `1px solid ${active ? '#2563eb' : '#d0d5dd'}`,
                                  background: active ? '#eff6ff' : '#fff',
                                  color: active ? '#1d4ed8' : '#344054',
                                  fontSize: '0.8rem',
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                }}
                              >
                                {value === 'S' ? '小' : value === 'M' ? '標準' : '大'}
                              </button>
                            );
                          })}
                        </div>
                        <div style={{ fontSize: 12, color: '#475467', marginBottom: 6, fontWeight: 600 }}>
                          余白
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          {([
                            { key: 'Narrow', label: '狭い' },
                            { key: 'Normal', label: '標準' },
                            { key: 'Wide', label: '広い' },
                          ] as const).map((item) => {
                            const active = settings.paddingPreset === item.key;
                            return (
                              <button
                                key={item.key}
                                type="button"
                                onClick={() => updateEasyAdjustGroupSettings(group.key, { paddingPreset: item.key })}
                                style={{
                                  padding: '4px 10px',
                                  borderRadius: 6,
                                  border: `1px solid ${active ? '#2563eb' : '#d0d5dd'}`,
                                  background: active ? '#eff6ff' : '#fff',
                                  color: active ? '#1d4ed8' : '#344054',
                                  fontSize: '0.8rem',
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                }}
                              >
                                {item.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {activeTab === 'mapping' && template && (
                <>
                  <div
                    style={{
                      marginBottom: 12,
                      border: '1px solid #e4e7ec',
                      borderRadius: 12,
                      padding: 10,
                      maxHeight: 240,
                      overflowY: 'auto',
                    }}
                  >
                    <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: '#101828' }}>
                      要素一覧（クリックで選択）
                    </div>

                    {(['header', 'body', 'footer'] as const).map((region) => {
                      const items = sortedByRegion(template.elements ?? [], region).filter(
                        (el) => !isDocumentMetaElement(el),
                      );
                      if (items.length === 0) return null;

                      const regionLabel = region === 'header' ? 'Header' : region === 'body' ? 'Body' : 'Footer';
                      return (
                        <div key={region} style={{ marginBottom: 10 }}>
                          <div style={{ fontSize: 12, color: '#475467', marginBottom: 6, fontWeight: 600 }}>
                            {regionLabel}
                          </div>

                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {items.map((el: any) => {
                              const isSelected = selectedElementId === el.id;
                              const title = el.slotId && slotLabelMap[el.slotId]
                                ? slotLabelMap[el.slotId]
                                : el.type === 'label' && el.text
                                ? el.text
                                : typeLabelForList(el.type);
                              const desc = describeElementForList(el);

                              return (
                                <button
                                  key={el.id}
                                  type="button"
                                  onClick={() => setSelectedElementId(el.id)}
                                  className={isSelected ? 'secondary' : 'ghost'}
                                  style={{
                                    textAlign: 'left',
                                    padding: '8px 10px',
                                    borderRadius: 10,
                                    border: '1px solid #e4e7ec',
                                    background: isSelected ? '#f0f9ff' : '#fff',
                                  }}
                                >
                                  <div style={{ fontWeight: 700, fontSize: 12, color: '#101828' }}>
                                    {title}
                                  </div>
                                  {desc && (
                                    <div style={{ fontSize: 11, color: '#667085', marginTop: 3 }}>
                                      {desc}
                                    </div>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div
                    style={{
                      border: '1px solid #e4e7ec',
                      borderRadius: 12,
                      padding: 10,
                      marginBottom: 12,
                    }}
                  >
                    <ElementInspector templateId={template.id} element={selectedElement} />
                  </div>

                  <MappingPage
                    template={template}
                    updateTemplate={updateTemplate}
                    onFocusFieldRef={(ref) => {
                      setHighlightRef(ref);
                    }}
                    onClearFocus={() => setHighlightRef(null)}
                  />
                </>
              )}
            </div>
          </div>
        </div>
      )}
      </>
      )}

      {toast && (
        <div className="toast-container">
          <Toast type={toast.type} message={toast.message} subMessage={toast.subMessage} onClose={() => setToast(null)} />
        </div>
      )}
    </section>
  );
};

export default TemplateEditorPage;
