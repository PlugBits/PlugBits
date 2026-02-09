import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import AppHeader from './components/AppHeader';
import TemplateEditorPage from './pages/TemplateEditorPage';
import TemplateListPage from './pages/TemplateListPage';
import TemplatePreviewPage from './pages/TemplatePreviewPage';

const App = () => {
  return (
    <HashRouter>
      <div className="app-shell">
        <AppHeader />
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
