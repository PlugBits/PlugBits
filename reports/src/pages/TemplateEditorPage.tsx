import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { TemplateElement } from '@shared/template.ts';
import TemplateCanvas from '../components/TemplateCanvas.tsx';
import ElementInspector from '../components/ElementInspector.tsx';
import { selectTemplateById, useTemplateStore } from '../store/templateStore.ts';

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
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [saveError, setSaveError] = useState('');
  const [nameDraft, setNameDraft] = useState('');

  useEffect(() => {
    if (!hasLoaded) {
      void initialize();
    }
  }, [hasLoaded, initialize]);

  useEffect(() => {
    if (template) {
      setSelectedElementId(template.elements[0]?.id ?? null);
      setNameDraft(template.name);
    }
  }, [templateId, template]);

  const selectedElement = useMemo<TemplateElement | null>(() => {
    if (!template || !selectedElementId) return null;
    return template.elements.find((element) => element.id === selectedElementId) ?? null;
  }, [template, selectedElementId]);

  const persistTemplateName = () => {
    if (!template) return template?.name ?? '';
    const normalized = nameDraft.trim() || template.name || '名称未設定';
    if (normalized !== nameDraft) {
      setNameDraft(normalized);
    }
    updateTemplate({ ...template, name: normalized });
    return normalized;
  };

  const handleSave = async () => {
    if (!template) return;
    setSaveStatus('saving');
    setSaveError('');
    try {
      const normalizedName = persistTemplateName();
      updateTemplate({ ...template, name: normalizedName });
      await saveTemplate(template.id);
      setSaveStatus('success');
    } catch (error) {
      setSaveStatus('error');
      setSaveError(error instanceof Error ? error.message : '保存に失敗しました');
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
            <button className="secondary" onClick={() => navigate(`/templates/${template.id}/preview`)}>
              プレビュー
            </button>
            <button className="ghost" onClick={handleSave} disabled={saveStatus === 'saving'}>
              {saveStatus === 'saving' ? '保存中...' : '保存'}
            </button>
            <button className="ghost" onClick={() => navigate('/')}>一覧</button>
          </div>
        </div>
        <div style={{ marginTop: '0.5rem' }}>
          {saveStatus === 'success' && <span className="status-pill success">保存しました</span>}
          {saveStatus === 'error' && <span className="status-pill error">{saveError}</span>}
        </div>
      </div>

      <div className="editor-layout">
        <div className="canvas-wrapper">
          <TemplateCanvas
            template={template}
            selectedElementId={selectedElementId}
            onSelect={(element) => setSelectedElementId(element?.id ?? null)}
            onUpdateElement={(elementId, updates) => updateElement(template.id, elementId, updates)}
          />
        </div>
        <div className="editor-panel">
          <ElementInspector templateId={template.id} element={selectedElement} />
        </div>
      </div>
    </section>
  );
};

export default TemplateEditorPage;
