import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import TemplateEditorPage from './pages/TemplateEditorPage.tsx';
import TemplateListPage from './pages/TemplateListPage.tsx';
import TemplatePreviewPage from './pages/TemplatePreviewPage.tsx';

const App = () => {
  return (
    <HashRouter>
      <div className="app-shell">
        <header className="app-header">
          <div>
            <p className="app-title">PlugBits 帳票デザイナー</p>
            <span className="app-subtitle">テンプレート管理と PDF プレビュー</span>
          </div>
          <nav className="app-nav">
            <a href="https://plugbits.com" target="_blank" rel="noreferrer">
              ドキュメント
            </a>
          </nav>
        </header>
        <main className="app-main">
          <Routes>
            <Route path="/" element={<TemplateListPage />} />
            <Route path="/templates" element={<TemplateListPage />} />
            <Route path="/picker" element={<TemplateListPage />} />
            <Route path="/templates/:templateId/edit" element={<TemplateEditorPage />} />
            <Route path="/templates/:templateId" element={<TemplateEditorPage />} />
            <Route path="/templates/:templateId/preview" element={<TemplatePreviewPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </HashRouter>
  );
};

export default App;
