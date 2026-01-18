import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { TemplateMeta, TemplateStatus } from '@shared/template';
import Toast from '../components/Toast.tsx';
import { createUserTemplateFromBase, type TemplateCatalogItem } from '../services/templateService.ts';
import { useTemplateStore } from '../store/templateStore.ts';
import { useTemplateListStore } from '../store/templateListStore.ts';
import { useEditorSession } from '../hooks/useEditorSession';

const buildListKey = (status: TemplateStatus, baseTemplateId?: string) =>
  `${status}:${baseTemplateId ?? ''}`;

const TemplateListPage = () => {
  const navigate = useNavigate();
  const createTemplate = useTemplateStore((state) => state.createTemplate);
  const updateTemplate = useTemplateStore((state) => state.updateTemplate);
  const setActiveTemplate = useTemplateStore((state) => state.setActiveTemplate);

  const metasById = useTemplateListStore((state) => state.metasById);
  const listStateByKey = useTemplateListStore((state) => state.listStateByKey);
  const hasLoadedByKey = useTemplateListStore((state) => state.hasLoadedByKey);
  const fetchTemplateMetas = useTemplateListStore((state) => state.fetchTemplateMetas);
  const ensureCatalog = useTemplateListStore((state) => state.ensureCatalog);
  const catalogItems = useTemplateListStore((state) => state.catalogItems);
  const catalogError = useTemplateListStore((state) => state.catalogError);
  const catalogLoading = useTemplateListStore((state) => state.catalogLoading);
  const archiveTemplate = useTemplateListStore((state) => state.archiveTemplate);
  const unarchiveTemplate = useTemplateListStore((state) => state.unarchiveTemplate);
  const softDeleteTemplate = useTemplateListStore((state) => state.softDeleteTemplate);
  const restoreTemplate = useTemplateListStore((state) => state.restoreTemplate);
  const purgeTemplate = useTemplateListStore((state) => state.purgeTemplate);

  const [activeTab, setActiveTab] = useState<TemplateStatus>('active');
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [sortMode, setSortMode] = useState<'updated' | 'name' | 'created'>('updated');
  const [creating, setCreating] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const { authState, tenantContext, params: pickerParams } = useEditorSession();
  const isPickerMode = pickerParams.get('mode') === 'picker' || pickerParams.has('returnOrigin');
  const returnOrigin = pickerParams.get('returnOrigin') ?? '';
  const [selectedTemplateId, setSelectedTemplateId] = useState(
    pickerParams.get('selectedTemplateId') ?? '',
  );
  const preservedQuery = useMemo(() => {
    const qs = pickerParams.toString();
    return qs ? `?${qs}` : '';
  }, [pickerParams]);
  const isAuthMissing = authState !== 'authorized';

  const listKey = buildListKey(activeTab);
  const listState = listStateByKey[listKey] ?? { ids: [], loading: false, error: null };
  const hasLoaded = hasLoadedByKey[listKey] ?? false;
  const isRefreshing = hasLoaded && listState.loading;
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const templateMetas = useMemo(
    () =>
      listState.ids
        .map((id) => metasById[id])
        .filter(Boolean) as TemplateMeta[],
    [listState.ids, metasById],
  );

  const catalogMap = useMemo(() => {
    const map = new Map<string, { name: string; description?: string }>();
    catalogItems.forEach((item) => {
      map.set(item.templateId, {
        name: item.displayName,
        description: item.description,
      });
    });
    return map;
  }, [catalogItems]);

  const grouped = useMemo(() => {
    const filtered = normalizedQuery
      ? templateMetas.filter((meta) => meta.name?.toLowerCase().includes(normalizedQuery))
      : templateMetas;

    const sorted = [...filtered].sort((a, b) => {
      if (sortMode === 'name') {
        return (a.name ?? '').localeCompare(b.name ?? '');
      }
      if (sortMode === 'created') {
        return (b.createdAt ?? '').localeCompare(a.createdAt ?? '');
      }
      return (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '');
    });

    const groups: Record<string, TemplateMeta[]> = {};
    sorted.forEach((meta) => {
      const key = meta.baseTemplateId || 'unknown';
      if (!groups[key]) groups[key] = [];
      groups[key].push(meta);
    });
    return Object.entries(groups).map(([baseTemplateId, items]) => ({
      baseTemplateId,
      items,
    }));
  }, [templateMetas, normalizedQuery, sortMode]);

  useEffect(() => {
    if (isAuthMissing) return;
    void fetchTemplateMetas({ status: activeTab });
  }, [activeTab, fetchTemplateMetas, isAuthMissing]);

  useEffect(() => {
    setSelectedTemplateId(pickerParams.get('selectedTemplateId') ?? '');
  }, [pickerParams]);

  useEffect(() => {
    if (isAuthMissing) return;
    void ensureCatalog();
  }, [ensureCatalog, isAuthMissing]);

  const hint = useMemo(() => {
    return `ユーザー ${templateMetas.length} 件 / 配布 ${catalogItems.length} 件`;
  }, [templateMetas.length, catalogItems.length]);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const template = await createTemplate(`カスタムテンプレート ${templateMetas.length + 1}`);
      await fetchTemplateMetas({ status: 'active' });
      setToast({ type: 'success', message: 'テンプレートを作成しました' });
      navigate(`/templates/${template.id}${preservedQuery}`);
    } catch (error) {
      setToast({
        type: 'error',
        message: error instanceof Error ? error.message : 'テンプレートの作成に失敗しました',
      });
    } finally {
      setCreating(false);
    }
  };

  const handleRefresh = () => {
    if (isAuthMissing) return;
    void fetchTemplateMetas({ status: activeTab })
      .then(() => setToast({ type: 'info', message: '最新のテンプレートを取得しました' }))
      .catch((refreshError) =>
        setToast({
          type: 'error',
          message:
            refreshError instanceof Error ? refreshError.message : 'テンプレートの取得に失敗しました',
        }),
      );
  };

  const handleDuplicateFromCatalog = async (catalogItem: TemplateCatalogItem) => {
    setCreating(true);
    try {
      const created = await createUserTemplateFromBase(
        catalogItem.templateId,
        `${catalogItem.displayName}（カスタム）`,
      );
      updateTemplate(created);
      setActiveTemplate(created.id);
      await fetchTemplateMetas({ status: 'active' });
      setToast({ type: 'success', message: 'テンプレートを複製しました' });
      navigate(`/templates/${created.id}${preservedQuery}`);
    } catch (error) {
      setToast({
        type: 'error',
        message: error instanceof Error ? error.message : 'テンプレートの複製に失敗しました',
      });
    } finally {
      setCreating(false);
    }
  };

  const resolveReturnOrigin = () => {
    if (!returnOrigin) return '';
    try {
      new URL(returnOrigin);
      return returnOrigin;
    } catch {
      return '';
    }
  };

  const fallbackBack = () => {
    const before = window.location.href;
    window.history.back();
    window.setTimeout(() => {
      if (window.location.href === before) {
        window.location.href = '/';
      }
    }, 200);
  };

  const handlePickTemplate = (templateId: string) => {
    const origin = resolveReturnOrigin();
    if (!origin) {
      fallbackBack();
      return;
    }
    let nextUrl = origin;
    try {
      const url = new URL(origin);
      url.searchParams.set('selectedTemplateId', templateId);
      nextUrl = url.toString();
    } catch {
      const joiner = origin.includes('?') ? '&' : '?';
      nextUrl = `${origin}${joiner}selectedTemplateId=${encodeURIComponent(templateId)}`;
    }
    window.location.href = nextUrl;
  };

  const clearSelectionAndReturn = (status: 'deleted' | 'archived') => {
    setSelectedTemplateId('');
    const origin = resolveReturnOrigin();
    if (!origin) {
      fallbackBack();
      return false;
    }
    try {
      const url = new URL(origin);
      url.searchParams.set('selectedTemplateId', '');
      url.searchParams.set('status', status);
      window.location.href = url.toString();
      return true;
    } catch {
      const joiner = origin.includes('?') ? '&' : '?';
      window.location.href = `${origin}${joiner}selectedTemplateId=&status=${status}`;
      return true;
    }
  };

  const toggleGroup = (baseTemplateId: string) => {
    setCollapsedGroups((prev) => ({
      ...prev,
      [baseTemplateId]: !prev[baseTemplateId],
    }));
  };

  const handleArchive = async (templateId: string) => {
    try {
      await archiveTemplate(templateId);
      setToast({ type: 'success', message: 'テンプレートをアーカイブしました' });
      if (selectedTemplateId && selectedTemplateId === templateId) {
        if (clearSelectionAndReturn('archived')) return;
      }
    } catch (error) {
      setToast({
        type: 'error',
        message: error instanceof Error ? error.message : 'テンプレートのアーカイブに失敗しました',
      });
    }
  };

  const handleUnarchive = async (templateId: string) => {
    try {
      await unarchiveTemplate(templateId);
      setToast({ type: 'success', message: 'テンプレートのアーカイブを解除しました' });
    } catch (error) {
      setToast({
        type: 'error',
        message: error instanceof Error ? error.message : 'アーカイブ解除に失敗しました',
      });
    }
  };

  const handleSoftDelete = async (templateId: string) => {
    try {
      await softDeleteTemplate(templateId, activeTab);
      setToast({ type: 'success', message: 'テンプレートをゴミ箱へ移動しました' });
      if (selectedTemplateId && selectedTemplateId === templateId) {
        if (clearSelectionAndReturn('deleted')) return;
      }
    } catch (error) {
      setToast({
        type: 'error',
        message: error instanceof Error ? error.message : 'テンプレートの削除に失敗しました',
      });
    }
  };

  const handleRestore = async (templateId: string) => {
    try {
      await restoreTemplate(templateId);
      setToast({ type: 'success', message: 'テンプレートを復元しました' });
    } catch (error) {
      setToast({
        type: 'error',
        message: error instanceof Error ? error.message : 'テンプレートの復元に失敗しました',
      });
    }
  };

  const handlePurge = async (templateId: string) => {
    if (!window.confirm('このテンプレートを完全に削除しますか？')) return;
    try {
      await purgeTemplate(templateId);
      setToast({ type: 'success', message: 'テンプレートを完全に削除しました' });
      if (selectedTemplateId && selectedTemplateId === templateId) {
        if (clearSelectionAndReturn('deleted')) return;
      }
    } catch (error) {
      setToast({
        type: 'error',
        message: error instanceof Error ? error.message : '完全削除に失敗しました',
      });
    }
  };

  return (
    <section>
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
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
            }}
          >
            選択中テンプレ: {selectedTemplateId || '未選択'}
          </span>
        </div>
      </div>
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h2 style={{ margin: 0 }}>テンプレートライブラリ</h2>
            <p style={{ margin: 0, color: '#475467', fontSize: '0.9rem' }}>{hint}</p>
            {tenantContext?.workerBaseUrl && (
              <p style={{ margin: 0, color: '#667085', fontSize: '0.85rem' }}>
                Connected workerBaseUrl: {tenantContext.workerBaseUrl.replace(/\/$/, '')}
              </p>
            )}
          </div>
          <button className="primary" onClick={handleCreate} disabled={creating || isAuthMissing}>
            新規テンプレート
          </button>
        </div>
        <div style={{ marginTop: '0.75rem', display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="ghost" onClick={handleRefresh} disabled={listState.loading || isAuthMissing}>
            {listState.loading ? '更新中...' : '再読み込み'}
          </button>
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search templates..."
            style={{
              minWidth: '220px',
              padding: '0.4rem 0.6rem',
              borderRadius: '0.5rem',
              border: '1px solid #d0d5dd',
            }}
          />
          <select
            value={sortMode}
            onChange={(event) => setSortMode(event.target.value as typeof sortMode)}
            style={{
              padding: '0.4rem 0.6rem',
              borderRadius: '0.5rem',
              border: '1px solid #d0d5dd',
            }}
          >
            <option value="updated">Updated</option>
            <option value="name">Name</option>
            <option value="created">Created</option>
          </select>
          <button
            className={activeTab === 'active' ? 'secondary' : 'ghost'}
            onClick={() => setActiveTab('active')}
          >
            Active
          </button>
          <button
            className={activeTab === 'archived' ? 'secondary' : 'ghost'}
            onClick={() => setActiveTab('archived')}
          >
            Archived
          </button>
          <button
            className={activeTab === 'deleted' ? 'secondary' : 'ghost'}
            onClick={() => setActiveTab('deleted')}
          >
            Trash
          </button>
      {!hasLoaded && listState.loading && <span className="status-pill pending">読み込み中...</span>}
      {isRefreshing && <span className="status-pill pending">Refreshing...</span>}
      {listState.error && <span className="status-pill error">{listState.error}</span>}
    </div>
  </div>

      {authState === 'checking' && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <p style={{ margin: 0, color: '#475467' }}>Loading...</p>
        </div>
      )}

      {authState === 'unauthorized' && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <h3 style={{ marginTop: 0 }}>プラグインから起動してください</h3>
          <p style={{ margin: 0, color: '#475467' }}>
            エディタはプラグインが発行する短命トークンで起動します。
          </p>
        </div>
      )}

      {!isAuthMissing && !hasLoaded && listState.loading && (
        <div className="card">
          <p style={{ margin: 0, color: '#475467' }}>Loading...</p>
        </div>
      )}

      {!isAuthMissing && grouped.length === 0 && !listState.loading && (
        <div className="card">
          <p style={{ margin: 0, color: '#475467' }}>テンプレートがまだありません。</p>
        </div>
      )}

      {!isAuthMissing && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {grouped.map(({ baseTemplateId, items }) => {
          const collapsed = collapsedGroups[baseTemplateId];
          const catalogInfo = catalogMap.get(baseTemplateId);
          return (
            <div className="card" key={`${activeTab}-${baseTemplateId}`}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}>
                <div>
                  <h3 style={{ margin: 0 }}>
                    {catalogInfo?.name ?? baseTemplateId}
                    <span style={{ marginLeft: '0.5rem', color: '#98a2b3', fontSize: '0.85rem' }}>
                      ({baseTemplateId})
                    </span>
                  </h3>
                  <p style={{ margin: 0, color: '#475467' }}>
                    {catalogInfo?.description ?? 'ユーザーテンプレート'}
                  </p>
                </div>
                <button className="ghost" onClick={() => toggleGroup(baseTemplateId)}>
                  {collapsed ? '展開' : '折りたたむ'}
                </button>
              </div>

              {!collapsed && (
                <div className="card-grid" style={{ marginTop: '1rem' }}>
                  {items.map((meta) => (
                    <div className="card" key={meta.templateId}>
                      <div>
                        <h3>{meta.name || '名称未設定'}</h3>
                        <p style={{ color: '#475467' }}>
                          更新: {new Date(meta.updatedAt).toLocaleString()}
                        </p>
                      </div>
                      <div className="button-row">
                        {(activeTab === 'active' || activeTab === 'archived') && (
                          <button
                            className="primary"
                            onClick={() => {
                              if (isPickerMode) {
                                handlePickTemplate(meta.templateId);
                                return;
                              }
                              navigate(`/templates/${meta.templateId}${preservedQuery}`);
                            }}
                          >
                            {isPickerMode ? '選択' : '開く'}
                          </button>
                        )}
                        {isPickerMode && (activeTab === 'active' || activeTab === 'archived') && (
                          <button
                            className="ghost"
                            onClick={() => navigate(`/templates/${meta.templateId}${preservedQuery}`)}
                          >
                            編集
                          </button>
                        )}
                        {activeTab === 'active' && (
                          <button className="secondary" onClick={() => handleArchive(meta.templateId)}>
                            Archive
                          </button>
                        )}
                        {activeTab === 'archived' && (
                          <button className="secondary" onClick={() => handleUnarchive(meta.templateId)}>
                            Unarchive
                          </button>
                        )}
                        {(activeTab === 'active' || activeTab === 'archived') && (
                          <button className="ghost" onClick={() => handleSoftDelete(meta.templateId)}>
                            Delete
                          </button>
                        )}
                        {activeTab === 'deleted' && (
                          <>
                            <button className="secondary" onClick={() => handleRestore(meta.templateId)}>
                              Restore
                            </button>
                            <button className="ghost" onClick={() => handlePurge(meta.templateId)}>
                              Delete permanently
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        </div>
      )}

      {activeTab === 'active' && (
        <div style={{ marginTop: '1.5rem' }}>
          <h3 style={{ marginBottom: '0.75rem' }}>配布テンプレート</h3>
          {catalogLoading && <span className="status-pill pending">読み込み中...</span>}
          {catalogError && <span className="status-pill error">{catalogError}</span>}
          <div className="card-grid" style={{ marginTop: '0.75rem' }}>
            {catalogItems.map((catalogItem) => (
              <div className="card" key={`catalog-${catalogItem.templateId}`}>
                <div>
                  <h3>{catalogItem.displayName}</h3>
                  <p style={{ color: '#475467' }}>{catalogItem.description ?? '配布テンプレート'}</p>
                </div>
                <div className="button-row">
                  <button
                    className="primary"
                    onClick={() => handleDuplicateFromCatalog(catalogItem)}
                    disabled={creating}
                  >
                    複製して編集
                  </button>
                </div>
              </div>
            ))}

            <div className="card">
              <h3>テンプレートを追加</h3>
              <p style={{ color: '#475467' }}>ドラッグ&ドロップデザイナーで帳票を作成しましょう。</p>
              <button className="ghost" onClick={handleCreate} disabled={creating}>
                追加する
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="toast-container">
          <Toast type={toast.type} message={toast.message} onClose={() => setToast(null)} />
        </div>
      )}
    </section>
  );
};

export default TemplateListPage;
