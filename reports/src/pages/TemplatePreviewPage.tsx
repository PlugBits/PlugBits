import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { SAMPLE_DATA, type TemplateDataRecord } from '@shared/template.ts';
import { requestPreviewPdf } from '../services/renderService.ts';
import { selectTemplateById, useTemplateStore } from '../store/templateStore.ts';

const TemplatePreviewPage = () => {
  const { templateId } = useParams();
  const navigate = useNavigate();
  const template = useTemplateStore((state) => selectTemplateById(state, templateId));
  const initialize = useTemplateStore((state) => state.initialize);
  const hasLoaded = useTemplateStore((state) => state.hasLoaded);
  const saveTemplate = useTemplateStore((state) => state.saveTemplate);
  const [status, setStatus] = useState<'idle' | 'saving' | 'rendering' | 'success' | 'error'>('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [initialPreviewDone, setInitialPreviewDone] = useState(false);

  const sampleData = useMemo<TemplateDataRecord>(() => SAMPLE_DATA, []);

  useEffect(() => {
    if (!hasLoaded) {
      void initialize();
    }
  }, [hasLoaded, initialize]);

  useEffect(() => {
    setInitialPreviewDone(false);
  }, [templateId]);

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const handlePreview = async () => {
    if (!template) return;

    setStatus('saving');
    setStatusMessage('テンプレートを保存しています...');

    try {
      await saveTemplate(template.id);
    } catch (error) {
      setStatus('error');
      setStatusMessage(
        error instanceof Error
          ? error.message
          : 'テンプレートの保存に失敗しました。API設定を確認してください。',
      );
      return;
    }

    setStatus('rendering');
    setStatusMessage('PDF を生成しています...');
    try {
      const blob = await requestPreviewPdf(template, sampleData);
      const nextUrl = URL.createObjectURL(blob);
      setPreviewUrl((previous) => {
        if (previous) URL.revokeObjectURL(previous);
        return nextUrl;
      });
      setStatus('success');
      setStatusMessage('最新のプレビューを表示しています');
    } catch (error) {
      setStatus('error');
      setStatusMessage(error instanceof Error ? error.message : 'プレビューに失敗しました');
    }
  };

  useEffect(() => {
    if (template && hasLoaded && !initialPreviewDone) {
      handlePreview();
      setInitialPreviewDone(true);
    }
  }, [templateId, template, hasLoaded, initialPreviewDone]);

  if (!template) {
    return (
      <div className="card">
        <p>テンプレートが見つかりませんでした。</p>
        <button className="secondary" onClick={() => navigate('/')}>一覧へ戻る</button>
      </div>
    );
  }

  return (
    <section className="editor-panel" style={{ padding: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <div>
          <h2 style={{ margin: 0 }}>{template.name || '名称未設定'} プレビュー</h2>
          <p style={{ margin: 0, color: '#475467', fontSize: '0.9rem' }}>サンプルデータで PDF を生成します</p>
        </div>
        <div className="button-row">
          <button className="secondary" onClick={handlePreview} disabled={status === 'saving' || status === 'rendering'}>
            再生成
          </button>
          <button className="ghost" onClick={() => navigate(`/templates/${template.id}`)}>
            エディタに戻る
          </button>
        </div>
      </div>

      <div style={{ marginBottom: '1rem' }}>
        {status !== 'idle' && (
          <span
            className={`status-pill ${
              status === 'error' ? 'error' : status === 'success' ? 'success' : 'pending'
            }`}
          >
            {statusMessage}
          </span>
        )}
      </div>

      {previewUrl ? (
        <iframe title="PDF Preview" className="preview-frame" src={previewUrl} />
      ) : (
        <div className="preview-frame" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <p style={{ color: '#475467' }}>プレビューを生成して表示します。</p>
        </div>
      )}
    </section>
  );
};

export default TemplatePreviewPage;
