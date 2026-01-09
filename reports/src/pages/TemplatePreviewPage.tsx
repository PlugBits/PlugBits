import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { SAMPLE_DATA, type TemplateDataRecord } from '@shared/template';
import { requestPreviewPdf } from '../services/renderService.ts';
import { selectTemplateById, useTemplateStore } from '../store/templateStore.ts';
import { useEditorSession } from '../hooks/useEditorSession';

const TemplatePreviewPage = () => {
  const { templateId } = useParams();
  const navigate = useNavigate();
  const template = useTemplateStore((state) => selectTemplateById(state, templateId));
  const loadTemplate = useTemplateStore((state) => state.loadTemplate);
  const loading = useTemplateStore((state) => state.loading);
  const error = useTemplateStore((state) => state.error);
  const saveTemplate = useTemplateStore((state) => state.saveTemplate);
  const updateTemplateState = useTemplateStore((state) => state.updateTemplate);
  const [status, setStatus] = useState<'idle' | 'saving' | 'rendering' | 'success' | 'error'>('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [initialPreviewDone, setInitialPreviewDone] = useState(false);
  const [sampleDataDraft, setSampleDataDraft] = useState('');
  const [sampleDataDirty, setSampleDataDirty] = useState(false);
  const [sampleDataError, setSampleDataError] = useState<string | null>(null);
  const [sampleDataInfo, setSampleDataInfo] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [sampleDataSaving, setSampleDataSaving] = useState(false);
  const { authState, params } = useEditorSession();
  const preservedQuery = useMemo(() => {
    const qs = params.toString();
    return qs ? `?${qs}` : '';
  }, [params]);

  const templateSampleData = useMemo<TemplateDataRecord>(() => template?.sampleData ?? SAMPLE_DATA, [template]);

  useEffect(() => {
    if (!templateId || authState !== 'authorized') return;
    void loadTemplate(templateId);
  }, [templateId, loadTemplate, authState]);

  useEffect(() => {
    setInitialPreviewDone(false);
  }, [templateId]);

  useEffect(() => {
    if (!template) return;
    if (sampleDataDirty) return;
    setSampleDataDraft(JSON.stringify(templateSampleData, null, 2));
    setSampleDataError(null);
    setSampleDataInfo(null);
  }, [template, templateId, templateSampleData, sampleDataDirty]);

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const parseSampleDataDraft = (): TemplateDataRecord | null => {
    try {
      const parsed = JSON.parse(sampleDataDraft || '{}') as TemplateDataRecord;
      return parsed;
    } catch (error) {
      console.error('Failed to parse sample data', error);
      setSampleDataError('JSON の形式を確認してください');
      return null;
    }
  };

  const commitSampleDataDraft = () => {
    if (!template) return null;
    if (!sampleDataDirty) {
      return {
        template,
        data: (template.sampleData as TemplateDataRecord | undefined) ?? SAMPLE_DATA,
      };
    }

    const parsed = parseSampleDataDraft();
    if (!parsed) {
      return null;
    }

    const nextTemplate = { ...template, sampleData: parsed };
    updateTemplateState(nextTemplate);
    setSampleDataDirty(false);
    setSampleDataError(null);
    return { template: nextTemplate, data: parsed };
  };

  const handlePreview = async () => {
    if (!template) return;

    const committed = commitSampleDataDraft();
    if (!committed) {
      setStatus('error');
      setStatusMessage('サンプルデータの JSON を確認してください');
      return;
    }

    const { template: previewTemplate, data } = committed;

    setStatus('saving');
    setStatusMessage('テンプレートを保存しています...');

    try {
      await saveTemplate(previewTemplate.id);
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
      const blob = await requestPreviewPdf(previewTemplate, data);
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

  const handleSampleDataSave = async () => {
    if (!template) return;
    const committed = commitSampleDataDraft();
    if (!committed) {
      setSampleDataInfo({ type: 'error', message: 'JSON の形式を確認してください' });
      return;
    }

    setSampleDataSaving(true);
    setSampleDataInfo(null);
    try {
      await saveTemplate(committed.template.id);
      setSampleDataInfo({ type: 'success', message: 'サンプルデータを保存しました' });
    } catch (error) {
      setSampleDataInfo({
        type: 'error',
        message: error instanceof Error ? error.message : 'サンプルデータの保存に失敗しました',
      });
    } finally {
      setSampleDataSaving(false);
    }
  };

  const handleSampleDataRevert = () => {
    if (!template) return;
    setSampleDataDraft(JSON.stringify(templateSampleData, null, 2));
    setSampleDataDirty(false);
    setSampleDataError(null);
    setSampleDataInfo(null);
  };

  useEffect(() => {
    if (template && !initialPreviewDone) {
      handlePreview();
      setInitialPreviewDone(true);
    }
  }, [templateId, template, initialPreviewDone]);

  if (authState === 'checking') {
    return (
      <div className="card">
        <p style={{ margin: 0, color: '#475467' }}>Loading...</p>
      </div>
    );
  }

  if (authState === 'unauthorized') {
    return (
      <div className="card">
        <p style={{ margin: 0, color: '#475467' }}>
          プラグインから起動してください（短命トークンが必要です）。
        </p>
      </div>
    );
  }

  if (!template) {
    return (
      <div className="card">
        <p>
          {loading
            ? 'テンプレートを読み込み中...'
            : error
            ? error
            : 'テンプレートが見つかりませんでした。'}
        </p>
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
          <button className="ghost" onClick={() => navigate(`/templates/${template.id}${preservedQuery}`)}>
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

      <div className="card" style={{ marginTop: '1.5rem' }}>
        <h3 style={{ marginTop: 0 }}>プレビュー用サンプルデータ</h3>
        <p style={{ color: '#475467', marginTop: 0 }}>
          kintone から取得されるレコードを想定した JSON を入力すると、プレビューにそのまま反映されます。
        </p>
        <textarea
          style={{ width: '100%', minHeight: '240px', fontFamily: 'monospace', fontSize: '0.9rem', padding: '0.75rem' }}
          value={sampleDataDraft}
          onChange={(event) => {
            setSampleDataDraft(event.target.value);
            setSampleDataDirty(true);
            setSampleDataError(null);
            setSampleDataInfo(null);
          }}
        />
        {sampleDataError && <p style={{ color: '#b42318' }}>{sampleDataError}</p>}
        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
          <button className="primary" type="button" onClick={handleSampleDataSave} disabled={sampleDataSaving}>
            {sampleDataSaving ? '保存中...' : 'サンプルデータを保存'}
          </button>
          <button className="ghost" type="button" onClick={handleSampleDataRevert} disabled={!sampleDataDirty}>
            編集を破棄
          </button>
        </div>
        {sampleDataInfo && (
          <p className={`status-pill ${sampleDataInfo.type === 'success' ? 'success' : 'error'}`} style={{ marginTop: '0.75rem' }}>
            {sampleDataInfo.message}
          </p>
        )}
      </div>
    </section>
  );
};

export default TemplatePreviewPage;
