import { previewPdf } from '../api/previewPdf';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { TemplateElement, TextElement, TableElement, LabelElement, ImageElement } from '@shared/template';
import TemplateCanvas from '../components/TemplateCanvas';
import ElementInspector from '../components/ElementInspector';
import Toast from '../components/Toast';
import { selectTemplateById, useTemplateStore } from '../store/templateStore';
import MappingPage from '../editor/Mapping/MappingPage';


const AUTOSAVE_DELAY = 4000;


const TemplateEditorPage = () => {
  const { templateId } = useParams();
  const navigate = useNavigate();
  const template = useTemplateStore((state) => selectTemplateById(state, templateId));
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const initialize = useTemplateStore((state) => state.initialize);
  const hasLoaded = useTemplateStore((state) => state.hasLoaded);
  const saveTemplate = useTemplateStore((state) => state.saveTemplate);
  const updateElement = useTemplateStore((state) => state.updateElement);
  const updateTemplate = useTemplateStore((state) => state.updateTemplate);
  const addElementToTemplate = useTemplateStore((state) => state.addElement);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [saveError, setSaveError] = useState('');
  const [nameDraft, setNameDraft] = useState('');
  const [toast, setToast] = useState<{ type: 'success' | 'error' | 'info'; message: string; subMessage?: string } | null>(null);
  const previousTemplateId = useRef<string | null>(null);
  const autosaveTimer = useRef<number | null>(null);
  const pendingSave = useRef(false);
  const lastSavedSignature = useRef<string>('');
  const [gridVisible, setGridVisible] = useState(true);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [guideVisible, setGuideVisible] = useState(true);
  const [advancedLayoutEditing, setAdvancedLayoutEditing] = useState(!!template?.advancedLayoutEditing);
  const [activeTab, setActiveTab] = useState<'layout' | 'mapping'>('layout');



  useEffect(() => {
    if (!hasLoaded) {
      void initialize();
    }
  }, [hasLoaded, initialize]);

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
  }, [template, selectedElementId]);

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
    });
  }, [template]);


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

  const selectedElement = useMemo<TemplateElement | null>(() => {
    if (!template || !selectedElementId) return null;
    return template.elements.find((element) => element.id === selectedElementId) ?? null;
  }, [template, selectedElementId]);

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
      await saveTemplate(template.id);
      lastSavedSignature.current = JSON.stringify({
        name: normalizedName,
        elements: template.elements,
        mapping: template.mapping ?? null,
        structureType: template.structureType ?? null,
        footerRepeatMode: template.footerRepeatMode ?? null,
        footerReserveHeight: template.footerReserveHeight ?? null,
        advancedLayoutEditing: !!template.advancedLayoutEditing,
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

  if (!template) {
    return (
      <div className="card">
        <p>テンプレートが見つかりませんでした。</p>
        <button className="secondary" onClick={() => navigate('/')}>一覧へ戻る</button>
      </div>
    );
  }

  return (
    <section>
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <input
              type="text"
              value={nameDraft}
              onChange={(event) => setNameDraft(event.target.value)}
              onBlur={persistTemplateName}
              onKeyDown={(event) => {
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
          </div>
          <div className="button-row">
            <button className="ghost" onClick={handleAddLabel}>
              + ラベル
            </button>
            <button className="ghost" onClick={handleAddText}>
              + テキスト
            </button>
            <button className="ghost" onClick={handleAddTable}>
              + テーブル
            </button>
            <button className="ghost" onClick={handleAddImage}>
              + 画像
            </button>
            <button
              className="secondary"
              onClick={() => { void previewPdf(template); }}
            >
              PDFプレビュー
            </button>


            <button className="ghost" onClick={() => { void handleSave(); }}  disabled={saveStatus === 'saving'}>
              {saveStatus === 'saving' ? '保存中...' : '保存'}
            </button>
            <button className="ghost" onClick={() => navigate('/')}>一覧</button>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
            <button className={activeTab === 'layout' ? 'secondary' : 'ghost'} onClick={() => setActiveTab('layout')}>
              レイアウト
            </button>
            <button className={activeTab === 'mapping' ? 'secondary' : 'ghost'} onClick={() => setActiveTab('mapping')}>
              フィールド割当
            </button>
          </div>

        </div>
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
          <button className={activeTab === 'layout' ? 'secondary' : 'ghost'} onClick={() => setActiveTab('layout')}>
            レイアウト
          </button>
          <button className={activeTab === 'mapping' ? 'secondary' : 'ghost'} onClick={() => setActiveTab('mapping')}>
            フィールド割当
          </button>
        </div>
        <div style={{ marginTop: '0.5rem', minHeight: 28, display: 'flex', alignItems: 'center' }}>
          {saveStatus === 'success' && <span className="status-pill success">保存しました</span>}
          {saveStatus === 'error' && <span className="status-pill error">{saveError}</span>}
        </div>
        <div
          style={{
            display: 'flex',
            gap: '1.25rem',
            flexWrap: 'wrap',
            marginTop: '0.75rem',
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
        </div>
      </div>

      {activeTab === 'layout' ? (
        <div className="editor-layout">
          <div className="canvas-wrapper">
            <TemplateCanvas
              template={template}
              selectedElementId={selectedElementId}
              onSelect={(element) => setSelectedElementId(element?.id ?? null)}
              onUpdateElement={(elementId, updates) => updateElement(template.id, elementId, updates)}
              showGrid={gridVisible}
              snapEnabled={snapEnabled}
              showGuides={guideVisible}
            />
          </div>
          <div className="editor-panel">
            <ElementInspector templateId={template.id} element={selectedElement} />
          </div>
        </div>
      ) : (
      <MappingPage template={template} updateTemplate={updateTemplate} />
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
