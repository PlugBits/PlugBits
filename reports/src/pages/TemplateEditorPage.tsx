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
  const [activeTab, setActiveTab] = useState<'layout' | 'mapping'>('layout');
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
      footerRepeatMode: template.footerRepeatMode ?? null,
      footerReserveHeight: template.footerReserveHeight ?? null,
      advancedLayoutEditing: !!template.advancedLayoutEditing,
      pageSize: template.pageSize ?? 'A4',
    });
  }, [template]);

  const isDirty = !!templateSignature && templateSignature !== lastSavedSignature.current;


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


  const selectedElement = useMemo<TemplateElement | null>(() => {
    if (!template || !selectedElementId) return null;
    return template.elements.find((element) => element.id === selectedElementId) ?? null;
  }, [template, selectedElementId]);

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
        if (el.type === 'table' && el.dataSource?.fieldCode === highlightRef.fieldCode) {
          set.add(el.id);
        }
      }
    }

    if (highlightRef.kind === 'subtableField') {
      // MVP：列単位ではなく「そのサブテーブルの table 要素」を光らせる
      for (const el of template.elements) {
        if (el.type === 'table' && el.dataSource?.fieldCode === highlightRef.subtableCode) {
          set.add(el.id);
        }
      }
    }

    return set;
  }, [template, highlightRef]);

  const slotLabelMap = useMemo(() => {
    const structureType = template?.structureType ?? 'list_v1';
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
    if (el.type === 'label') return el.text ?? '';
    const ds = el.dataSource;
    if (!ds) return '';
    if (ds.type === 'static') return ds.value ?? '';
    if (ds.type === 'kintone') return `{{${ds.fieldCode}}}`;
    if (ds.type === 'kintoneSubtable') return `{{${ds.fieldCode}}}`;
    return '';
  };

  const typeLabelForList = (type: string) => {
    if (type === 'text') return 'テキスト';
    if (type === 'label') return 'ラベル';
    if (type === 'image') return '画像';
    if (type === 'table') return 'テーブル';
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
            <div className="button-row">
              <button
                className="secondary"
                onClick={() => { void previewPdf(template); }}
              >
                PDFプレビュー
              </button>
              <button className="ghost" onClick={() => { void handleSave(); }} disabled={saveStatus === 'saving'}>
                {saveStatus === 'saving' ? '保存中...' : '保存'}
              </button>
              <button
                className="ghost"
                onClick={() => {
                  if (isDirty && !window.confirm('未保存の変更があります。一覧へ戻りますか？')) {
                    return;
                  }
                  navigate(`/${preservedQuery}`);
                }}
              >
                一覧
              </button>
              <button className="ghost" onClick={toggleControls}>
                設定 {controlsOpen ? '▲' : '▼'}
              </button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: 6 }}>
              {saveStatus === 'success' && <span className="status-pill success">保存しました</span>}
              {saveStatus === 'error' && <span className="status-pill error">{saveError}</span>}
            </div>
          </div>
        </div>
        {controlsOpen && (
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
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.6rem' }}>
              <button className={activeTab === 'layout' ? 'secondary' : 'ghost'} onClick={() => setActiveTab('layout')}>
                レイアウト
              </button>
              <button className={activeTab === 'mapping' ? 'secondary' : 'ghost'} onClick={() => setActiveTab('mapping')}>
                フィールド割当
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
      <div className="editor-layout" style={{ flex: 1, minHeight: 0 }}>
        <div className="canvas-wrapper" style={{ minHeight: 0, maxHeight: '100%', height: '100%', overflow: 'auto' }}>
          <TemplateCanvas
            template={template}
            selectedElementId={selectedElementId}
            onSelect={(element) => setSelectedElementId(element?.id ?? null)}
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
            {/* 右ペイン切替ボタン（ここに移動） */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <button
                className={activeTab === 'layout' ? 'secondary' : 'ghost'}
                onClick={() => setActiveTab('layout')}
                type="button"
              >
                要素
              </button>
              <button
                className={activeTab === 'mapping' ? 'secondary' : 'ghost'}
                onClick={() => setActiveTab('mapping')}
                type="button"
              >
                割当
              </button>
            </div>
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
                const items = sortedByRegion(template.elements ?? [], region);
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
                        const typeLabel = typeLabelForList(el.type);
                        const title = el.slotId && slotLabelMap[el.slotId]
                          ? slotLabelMap[el.slotId]
                          : el.type === 'label' && el.text
                          ? el.text
                          : typeLabel;
                        const subtitle = typeLabel;
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
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                              <div style={{ fontWeight: 700, fontSize: 12, color: '#101828' }}>
                                {title}
                              </div>
                              <div style={{ fontSize: 11, color: '#667085' }}>{subtitle}</div>
                            </div>
                            {desc && <div style={{ fontSize: 12, color: '#475467', marginTop: 4 }}>{desc}</div>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            {activeTab === 'layout' ? (
              <ElementInspector templateId={template.id} element={selectedElement} />
            ) : (
              <MappingPage
                template={template}
                updateTemplate={updateTemplate}
                onFocusFieldRef={(ref) => {
                  setHighlightRef(ref);
                }}
                onClearFocus={() => setHighlightRef(null)}
              />
            )}
          </div>
        </div>
        </div>
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
