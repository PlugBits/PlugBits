import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTemplateStore } from '../store/templateStore.ts';
import Toast from '../components/Toast.tsx';

const TemplateListPage = () => {
  const navigate = useNavigate();
  const templates = useTemplateStore((state) => state.templates);
  const templateList = useMemo(() => Object.values(templates), [templates]);
  const createTemplate = useTemplateStore((state) => state.createTemplate);
  const deleteTemplate = useTemplateStore((state) => state.deleteTemplate);
  const initialize = useTemplateStore((state) => state.initialize);
  const refreshTemplates = useTemplateStore((state) => state.refreshTemplates);
  const loading = useTemplateStore((state) => state.loading);
  const error = useTemplateStore((state) => state.error);
  const hasLoaded = useTemplateStore((state) => state.hasLoaded);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);

  useEffect(() => {
    if (!hasLoaded) {
      void initialize();
    }
  }, [hasLoaded, initialize]);

  const hint = useMemo(() => {
    return `現在 ${templateList.length} 件のテンプレートがあります`;
  }, [templateList.length]);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const template = await createTemplate(`カスタムテンプレート ${templateList.length + 1}`);
      setToast({ type: 'success', message: 'テンプレートを作成しました' });
      navigate(`/templates/${template.id}`);
    } catch (error) {
      setToast({
        type: 'error',
        message: error instanceof Error ? error.message : 'テンプレートの作成に失敗しました',
      });
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (templateId: string) => {
    if (!window.confirm('このテンプレートを削除しますか？')) return;
    setDeletingId(templateId);
    try {
      await deleteTemplate(templateId);
      setToast({ type: 'success', message: 'テンプレートを削除しました' });
    } catch (error) {
      setToast({
        type: 'error',
        message: error instanceof Error ? error.message : 'テンプレートの削除に失敗しました',
      });
    } finally {
      setDeletingId((current) => (current === templateId ? null : current));
    }
  };

  const handleRefresh = () => {
    void refreshTemplates()
      .then(() => setToast({ type: 'info', message: '最新のテンプレートを取得しました' }))
      .catch((refreshError) =>
        setToast({
          type: 'error',
          message:
            refreshError instanceof Error ? refreshError.message : 'テンプレートの取得に失敗しました',
        }),
      );
  };

  return (
    <section>
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ margin: 0 }}>テンプレートライブラリ</h2>
            <p style={{ margin: 0, color: '#475467', fontSize: '0.9rem' }}>{hint}</p>
          </div>
          <button className="primary" onClick={handleCreate} disabled={loading || creating}>
            新規テンプレート
          </button>
        </div>
        <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="ghost" onClick={handleRefresh} disabled={loading}>
            {loading ? '更新中...' : '再読み込み'}
          </button>
          {loading && <span className="status-pill pending">読み込み中...</span>}
          {error && <span className="status-pill error">{error}</span>}
        </div>
      </div>

      <div className="card-grid">
        {templateList.map((template) => {
          if (!template) return null;
          const elementCount = Array.isArray(template.elements) ? template.elements.length : 0;
          return (
            <div className="card" key={template.id}>
              <div>
                <h3>{template.name ?? '名称未設定'}</h3>
                <p style={{ color: '#475467' }}>要素数: {elementCount}</p>
              </div>
              <div className="button-row">
                <button className="primary" onClick={() => navigate(`/templates/${template.id}`)}>
                  編集
                </button>
                <button className="secondary" onClick={() => navigate(`/templates/${template.id}/preview`)}>
                  プレビュー
                </button>
                <button
                  className="ghost"
                  onClick={() => handleDelete(template.id)}
                  disabled={deletingId === template.id}
                >
                  {deletingId === template.id ? '削除中...' : '削除'}
                </button>
              </div>
            </div>
          );
        })}

        <div className="card">
          <h3>テンプレートを追加</h3>
          <p style={{ color: '#475467' }}>ドラッグ&ドロップデザイナーで帳票を作成しましょう。</p>
          <button className="ghost" onClick={handleCreate}>
            追加する
          </button>
        </div>
      </div>

      {toast && (
        <div className="toast-container">
          <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />
        </div>
      )}
    </section>
  );
};

export default TemplateListPage;
