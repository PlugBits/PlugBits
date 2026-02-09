import { previewPdf } from '../api/previewPdf';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { TemplateDefinition, TemplateElement, TextElement, TableElement, LabelElement, ImageElement, PageSize } from '@shared/template';
import TemplateCanvas from '../components/TemplateCanvas';
import Toast from '../components/Toast';
import { selectTemplateById, useTemplateStore } from '../store/templateStore';
import { useTemplateListStore } from '../store/templateListStore';
import MappingPage from '../editor/Mapping/MappingPage';
import LabelEditorPanel from '../editor/Label/LabelEditorPanel';
import type { ListV1Mapping } from '../editor/Mapping/adapters/list_v1';
import { createTemplateRemote } from '../services/templateService';
import {
  normalizeEasyAdjustBlockSettings,
  resolvePagePaddingPreset,
  resolveFontScalePreset,
  isElementHiddenByEasyAdjust,
} from '../utils/easyAdjust';
import { CANVAS_WIDTH, clampYToRegion } from '../utils/regionBounds';
import { computeDocumentMetaLayout } from '@shared/documentMetaLayout';
import { getAdapter } from '../editor/Mapping/adapters/getAdapter';
import { useEditorSession } from '../hooks/useEditorSession';
import {
  collectIssues,
  summarizeIssues,
  resolvePresetId,
  getPresetDefinition,
  ISSUE_GROUP_ORDER,
  type Issue,
} from '../editor/editorIssues';

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
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [cloneModalOpen, setCloneModalOpen] = useState(false);
  const [clonePresetId, setClonePresetId] = useState<'estimate_v1' | 'invoice_v1'>('invoice_v1');
  const [isCloning, setIsCloning] = useState(false);
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
  const rawReturnOrigin = params.get('returnOrigin') ?? '';
  const safeReturnOrigin = useMemo(() => {
    if (!rawReturnOrigin) return '';
    try {
      const url = new URL(rawReturnOrigin);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
      return url.toString();
    } catch {
      return '';
    }
  }, [rawReturnOrigin]);
  const headerTemplateId = template?.id ?? templateId ?? '';
  const isLabelTemplate = template?.structureType === 'label_v1';
  const isCardTemplate =
    template?.structureType === 'cards_v1' &&
    ['cards_v1', 'cards_v2', 'card_v1', 'multiTable_v1'].includes(
      template?.baseTemplateId ?? '',
    );
  const presetId = useMemo(
    () => resolvePresetId(template),
    [template?.settings?.presetId, template?.id],
  );
  const preset = useMemo(() => getPresetDefinition(presetId), [presetId]);
  const issues = useMemo(() => {
    if (!template) return [];
    return collectIssues({
      preset,
      template,
    });
  }, [template, preset]);
  const issueSummary = useMemo(() => summarizeIssues(issues), [issues]);

  const getPresetDisplayLabel = (id: 'estimate_v1' | 'invoice_v1') =>
    id === 'invoice_v1' ? '請求書' : '見積書';

  const buildPresetFixedText = (id: 'estimate_v1' | 'invoice_v1') => {
    if (id === 'invoice_v1') {
      return {
        doc_title: '請求書',
        date_label: '請求日',
        total_label: '合計',
      };
    }
    return {
      doc_title: '御見積書',
      date_label: '見積日',
      total_label: '合計',
    };
  };

  const applyPresetFixedText = (
    mapping: Partial<ListV1Mapping> | null | undefined,
    id: 'estimate_v1' | 'invoice_v1',
  ) => {
    const fixed = buildPresetFixedText(id);
    const next = structuredClone(mapping ?? {}) as Partial<ListV1Mapping>;
    next.header = { ...(next.header ?? {}) };
    next.footer = { ...(next.footer ?? {}) };
    next.header.doc_title = { kind: 'staticText', text: fixed.doc_title };
    next.header.date_label = { kind: 'staticText', text: fixed.date_label };
    next.footer.total_label = { kind: 'staticText', text: fixed.total_label };
    return next;
  };

  const generateUserTemplateId = () =>
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? `tpl_${crypto.randomUUID()}`
      : `tpl_${Date.now()}`;
  const EASY_ADJUST_GROUPS = [
    { key: 'header', label: 'タイトル/ヘッダー' },
    { key: 'recipient', label: '宛先' },
    { key: 'body', label: '本文' },
    { key: 'footer', label: 'フッター' },
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
    const current = easyAdjust[group] ?? {};
    const { fontPreset, paddingPreset, ...rest } = current as Record<string, unknown>;
    if (Object.keys(rest).length === 0) {
      delete easyAdjust[group];
    } else {
      easyAdjust[group] = rest;
    }
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

  const selectedSlotLabel = useMemo(() => {
    if (!selectedElement) return '';
    const slotId = (selectedElement as any).slotId as string | undefined;
    if (slotId && slotLabelMap[slotId]) return slotLabelMap[slotId];
    if (selectedElement.type === 'label' && (selectedElement as any).text) {
      return (selectedElement as any).text as string;
    }
    if (selectedElement.type === 'text') return 'テキスト';
    if (selectedElement.type === 'image') return '画像';
    if (selectedElement.type === 'table') return 'テーブル';
    if (selectedElement.type === 'cardList') return 'カード枠';
    return '要素';
  }, [selectedElement, slotLabelMap]);
  const isTitleSelected =
    !!selectedElement && (selectedElement as any).slotId === 'doc_title';
  const handlePreviewClick = async () => {
    if (!template) return;
    if (issueSummary.errorCount > 0) {
      setIssuesOpen(true);
      setToast({
        type: 'error',
        message: '必須項目が未設定です',
      });
      return;
    }
    try {
      await previewPdf(template);
      setToast({ type: 'success', message: 'PDFプレビューを開きました' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'PDFプレビューに失敗しました';
      setToast({ type: 'error', message });
    }
  };

  const handleBackToSettings = () => {
    if (safeReturnOrigin) {
      window.location.href = safeReturnOrigin;
      return;
    }
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    window.location.href = '/#/';
  };

  const openCloneModal = () => {
    if (!template) return;
    const nextPreset = presetId === 'invoice_v1' ? 'estimate_v1' : 'invoice_v1';
    setClonePresetId(nextPreset);
    setCloneModalOpen(true);
  };

  const handleCloneTemplate = async () => {
    if (!template || isCloning) return;
    setIsCloning(true);
    try {
      const baseTemplateId = template.baseTemplateId ?? 'list_v1';
      const newId = generateUserTemplateId();
      const targetLabel = getPresetDisplayLabel(clonePresetId);
      const nextName = `${template.name}（${targetLabel}）`;

      const nextSettings = {
        ...(template.settings ?? {}),
        presetId: clonePresetId,
      };
      const nextMapping = applyPresetFixedText(
        template.mapping as Partial<ListV1Mapping> | null | undefined,
        clonePresetId,
      );

      let nextTemplate: TemplateDefinition = {
        ...structuredClone(template),
        id: newId,
        name: nextName,
        baseTemplateId,
        settings: nextSettings,
        mapping: nextMapping,
      };

      const structureType = nextTemplate.structureType ?? 'list_v1';
      if (structureType === 'list_v1') {
        const adapter = getAdapter(structureType);
        const mapping = nextTemplate.mapping ?? adapter.createDefaultMapping();
        const applied = adapter.applyMappingToTemplate(
          { ...nextTemplate, structureType, mapping },
          mapping,
        );
        nextTemplate = {
          ...applied,
          id: newId,
          name: nextName,
          baseTemplateId,
          settings: nextSettings,
        };
      }

      const saved = await createTemplateRemote(nextTemplate);
      updateTemplate({
        ...nextTemplate,
        baseTemplateId: saved.baseTemplateId ?? baseTemplateId,
      });

      setCloneModalOpen(false);
      setToast({
        type: 'success',
        message: `${targetLabel}に複製しました。`,
        subMessage:
          clonePresetId === 'invoice_v1'
            ? '支払期限が必須です。未設定の場合は出力できません。'
            : '必要な項目を確認して設定してください。',
      });
      navigate(`/templates/${newId}/edit${preservedQuery}`);
    } catch (error) {
      setToast({
        type: 'error',
        message: '複製に失敗しました',
        subMessage: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setIsCloning(false);
    }
  };

  const focusIssue = (issue: Issue) => {
    if (!template) return;
    setActiveTab('mapping');
    setIssuesOpen(false);
    const elements = template.elements ?? [];
    let target = null as TemplateElement | null;
    if (issue.slotId) {
      target = elements.find((el) => (el as any).slotId === issue.slotId) ?? null;
    }
    if (!target && issue.tableId) {
      target = elements.find((el) => el.id === issue.tableId) ?? null;
      if (!target) {
        target = elements.find((el) => el.type === 'table') ?? null;
      }
    }
    if (!target && issue.colSlotId) {
      target = elements.find((el) => el.type === 'table') ?? null;
    }
    if (target) {
      setSelectedElementId(target.id);
    }
    window.setTimeout(() => {
      const scrollKey = issue.slotId ?? issue.tableId ?? issue.colSlotId;
      if (!scrollKey) return;
      const node = document.getElementById(`slot-item-${scrollKey}`);
      if (node) node.scrollIntoView({ block: 'nearest' });
    }, 0);
  };

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
        message: '保存しました',
        subMessage: isAutosave ? '自動保存' : undefined,
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
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
            padding: '0.5rem 0.75rem',
            background: '#fff',
            border: '1px solid #e4e7ec',
            borderRadius: 12,
            marginBottom: '0.75rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <button className="ghost" onClick={handleBackToSettings} type="button">
              ← 設定に戻る
            </button>
            <div style={{ minWidth: 0 }}>
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
                  fontSize: '1.05rem',
                  fontWeight: 600,
                  border: '1px solid #d0d5dd',
                  borderRadius: '0.5rem',
                  padding: '0.3rem 0.6rem',
                  width: 'min(320px, 36vw)',
                }}
              />
              <div
                style={{
                  marginTop: 4,
                  fontSize: 11,
                  color: '#667085',
                  display: 'flex',
                  gap: 12,
                  flexWrap: 'wrap',
                }}
              >
                {headerTemplateId && <span>ID: {headerTemplateId}</span>}
                <span>要素数: {template.elements.length}</span>
                <span>保存先: {tenantContext?.workerBaseUrl ?? '未設定'}</span>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
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
            {!isLabelTemplate && !isCardTemplate && template?.structureType === 'list_v1' && (
              <button className="ghost" onClick={openCloneModal} type="button">
                別用途として複製
              </button>
            )}
            {!isLabelTemplate && (
              <button className="ghost" onClick={toggleControls} type="button">
                詳細設定 {controlsOpen ? '▲' : '▼'}
              </button>
            )}
            <button
              className="secondary"
              onClick={() => { void handleSave(); }}
              disabled={saveStatus === 'saving' || isLabelConfigInvalid}
            >
              {saveStatus === 'saving' ? '保存中...' : '保存'}
            </button>
            <button className="primary" onClick={handlePreviewClick}>
              PDFプレビュー
            </button>
          </div>
        </div>
      {controlsOpen && !isLabelTemplate && (
        <div
          className="card"
          style={{
            padding: '0.5rem 0.75rem 0.75rem',
            marginBottom: '0.75rem',
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
              {!isLabelTemplate && !isCardTemplate && template?.structureType === 'list_v1' && (
                <>
                  {issueSummary.errorCount > 0 && (
                    <div
                      style={{
                        padding: '10px 12px',
                        borderRadius: 10,
                        border: '1px solid #fda29b',
                        background: '#fef3f2',
                        color: '#b42318',
                        fontSize: 13,
                        fontWeight: 600,
                        marginBottom: 10,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                      }}
                    >
                      <span>必須項目が未設定です（{issueSummary.errorCount}件）</span>
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => setIssuesOpen(true)}
                        style={{ fontSize: 12, padding: '4px 8px' }}
                      >
                        一覧を見る
                      </button>
                    </div>
                  )}
                  {issueSummary.errorCount === 0 && issueSummary.warnCount > 0 && (
                    <div
                      style={{
                        padding: '10px 12px',
                        borderRadius: 10,
                        border: '1px solid #fcd34d',
                        background: '#fffbeb',
                        color: '#92400e',
                        fontSize: 13,
                        fontWeight: 600,
                        marginBottom: 10,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                      }}
                    >
                      <span>
                        推奨項目が未入力です（{issueSummary.warnCount}件）・出力は可能です
                      </span>
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => setIssuesOpen(true)}
                        style={{ fontSize: 12, padding: '4px 8px' }}
                      >
                        一覧を見る
                      </button>
                    </div>
                  )}
                  {issuesOpen && issueSummary.errorCount + issueSummary.warnCount > 0 && (
                    <div
                      style={{
                        border: '1px solid #e4e7ec',
                        borderRadius: 12,
                        padding: 12,
                        background: '#fff',
                        marginBottom: 12,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <div style={{ fontWeight: 700, fontSize: 13, color: '#101828' }}>未設定一覧</div>
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => setIssuesOpen(false)}
                          style={{ fontSize: 11, padding: '4px 8px' }}
                        >
                          閉じる
                        </button>
                      </div>
                      {ISSUE_GROUP_ORDER.map((group) => {
                        const groupIssues = issueSummary.byGroup.get(group) ?? [];
                        if (groupIssues.length === 0) return null;
                        return (
                          <div key={group} style={{ marginBottom: 10 }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: '#344054', marginBottom: 6 }}>
                              {group}
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                              {groupIssues.map((issue, idx) => (
                                <div
                                  key={`${issue.code}-${issue.label}-${idx}`}
                                  style={{
                                    border: '1px solid #e4e7ec',
                                    borderRadius: 10,
                                    padding: '8px 10px',
                                    background: issue.severity === 'error' ? '#fef3f2' : '#fffbeb',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    gap: 8,
                                  }}
                                >
                                  <div style={{ fontSize: 12, color: '#101828' }}>{issue.message}</div>
                                  <button
                                    type="button"
                                    className="ghost"
                                    onClick={() => focusIssue(issue)}
                                    style={{ fontSize: 11, padding: '4px 8px' }}
                                  >
                                    設定する
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
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
              {activeTab === 'adjust' && template && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div
                    style={{
                      border: '1px solid #e4e7ec',
                      borderRadius: 12,
                      padding: 10,
                      background: '#fff',
                    }}
                  >
                    <div style={{ fontWeight: 700, fontSize: 13, color: '#101828', marginBottom: 6 }}>
                      {selectedElement ? `選択中: ${selectedSlotLabel}` : '要素を選択してください'}
                    </div>
                    <div style={{ fontSize: 12, color: '#475467', marginBottom: 6, fontWeight: 600 }}>
                      タイトル位置
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {(['left', 'center', 'right'] as const).map((value) => {
                        const active = (selectedElement as any)?.alignX === value;
                        const disabled = !isTitleSelected;
                        return (
                          <button
                            key={value}
                            type="button"
                            disabled={disabled}
                            onClick={() => {
                              if (!template || !selectedElement || disabled) return;
                              updateElement(template.id, selectedElement.id, {
                                alignX: value,
                              });
                            }}
                            style={{
                              padding: '4px 10px',
                              borderRadius: 6,
                              border: `1px solid ${active ? '#2563eb' : '#d0d5dd'}`,
                              background: active ? '#eff6ff' : '#fff',
                              color: active ? '#1d4ed8' : '#344054',
                              fontSize: '0.8rem',
                              fontWeight: 600,
                              cursor: disabled ? 'not-allowed' : 'pointer',
                              opacity: disabled ? 0.5 : 1,
                            }}
                          >
                            {value === 'left' ? '左' : value === 'center' ? '中央' : '右'}
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        disabled={!isTitleSelected}
                        onClick={() => {
                          if (!template || !selectedElement || !isTitleSelected) return;
                          updateElement(template.id, selectedElement.id, {
                            alignX: undefined,
                          });
                        }}
                        style={{
                          padding: '4px 10px',
                          borderRadius: 6,
                          border: '1px solid #d0d5dd',
                          background: '#fff',
                          color: '#344054',
                          fontSize: '0.8rem',
                          fontWeight: 600,
                          cursor: !isTitleSelected ? 'not-allowed' : 'pointer',
                          opacity: !isTitleSelected ? 0.5 : 1,
                        }}
                      >
                        元に戻す
                      </button>
                    </div>
                    {!isTitleSelected && (
                      <div style={{ marginTop: 6, fontSize: 11, color: '#667085' }}>
                        タイトル選択時のみ調整できます。
                      </div>
                    )}
                  </div>
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
                            元に戻す
                          </button>
                        </div>
                        <div style={{ fontSize: 12, color: '#475467', marginBottom: 6, fontWeight: 600 }}>
                          文字サイズ
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
                        <div style={{ marginTop: 6, fontSize: 11, color: '#667085' }}>
                          全体の調整（ブロック単位）
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
                              const isHidden = isElementHiddenByEasyAdjust(el, template);
                              const elementIssues =
                                el.type === 'table'
                                  ? issues.filter((issue) => issue.tableId === el.id || issue.group === '明細')
                                  : el.slotId
                                  ? issueSummary.bySlot.get(el.slotId) ?? []
                                  : [];
                              const hasError = !isHidden && elementIssues.some((issue) => issue.severity === 'error');
                              const hasWarn = !isHidden && !hasError && elementIssues.some((issue) => issue.severity === 'warn');
                              const slotKey = el.slotId ?? el.id;

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
                                  id={`slot-item-${slotKey}`}
                                >
                                  <div style={{ fontWeight: 700, fontSize: 12, color: '#101828' }}>
                                    {title}
                                    {hasError && (
                                      <span
                                        style={{
                                          marginLeft: 8,
                                          fontSize: 10,
                                          fontWeight: 700,
                                          padding: '2px 6px',
                                          borderRadius: 999,
                                          background: '#fecaca',
                                          color: '#7f1d1d',
                                        }}
                                      >
                                        必須
                                      </span>
                                    )}
                                    {!hasError && hasWarn && (
                                      <span
                                        style={{
                                          marginLeft: 8,
                                          fontSize: 10,
                                          fontWeight: 700,
                                          padding: '2px 6px',
                                          borderRadius: 999,
                                          background: '#fde68a',
                                          color: '#92400e',
                                        }}
                                      >
                                        推奨
                                      </span>
                                    )}
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

                  <div style={{ fontSize: 12, color: '#475467', marginBottom: 8 }}>
                    {selectedElement ? `選択中: ${selectedSlotLabel}` : '要素を選択してください'}
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

      {cloneModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 50,
          }}
        >
          <div
            style={{
              width: 'min(420px, 90vw)',
              background: '#fff',
              borderRadius: 12,
              border: '1px solid #e4e7ec',
              padding: 16,
              boxShadow: '0 18px 40px rgba(15, 23, 42, 0.18)',
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 14, color: '#101828', marginBottom: 6 }}>
              別用途として複製
            </div>
            <div style={{ fontSize: 12, color: '#475467', marginBottom: 12 }}>
              新しいテンプレートを作成します。元のテンプレートは変更されません。
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
              {(['estimate_v1', 'invoice_v1'] as const).map((id) => (
                <label key={id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    type="radio"
                    name="clonePreset"
                    value={id}
                    checked={clonePresetId === id}
                    onChange={() => setClonePresetId(id)}
                  />
                  <span style={{ fontSize: 13, color: '#101828', fontWeight: 600 }}>
                    {getPresetDisplayLabel(id)}
                  </span>
                </label>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                type="button"
                className="ghost"
                onClick={() => setCloneModalOpen(false)}
                disabled={isCloning}
              >
                キャンセル
              </button>
              <button
                type="button"
                className="secondary"
                onClick={handleCloneTemplate}
                disabled={isCloning}
              >
                {isCloning ? '複製中...' : '複製する'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

export default TemplateEditorPage;
