import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import type { TemplateDefinition, TemplateElement, RegionBounds } from '@shared/template';
import { CANVAS_HEIGHT, resolveRegionBounds } from '@shared/template';
import TemplateCanvas from '../components/TemplateCanvas';
import { CANVAS_WIDTH } from '../utils/regionBounds';
import { fetchBaseTemplate, updateBaseTemplate } from '../services/templateService';

type IssueType = 'out_of_region' | 'overlap' | 'invalid';
type ElementIssue = {
  id: string;
  type: IssueType;
  message: string;
};

const ADMIN_MODE =
  import.meta.env.VITE_ADMIN_MODE === '1';
const ADMIN_API_KEY = import.meta.env.VITE_ADMIN_API_KEY ?? '';

const parseNumber = (value: string) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const getElementWidthValue = (element: TemplateElement) => {
  if (element.type === 'table') {
    return element.columns.reduce((sum, column) => sum + column.width, 0);
  }
  if (element.type === 'cardList') {
    return element.width ?? 520;
  }
  return element.width ?? 140;
};

const getElementHeightValue = (element: TemplateElement) => {
  if (element.type === 'table') {
    const header = element.headerHeight ?? 24;
    const rows = (element.rowHeight ?? 18) * 3;
    return header + rows;
  }
  if (element.type === 'cardList') {
    return element.cardHeight ?? 90;
  }
  return element.height ?? 32;
};

const resolveAlignedX = (element: TemplateElement, width: number) => {
  const slotId = (element as any).slotId as string | undefined;
  if (slotId !== 'doc_title') return element.x;
  const alignX = (element as any).alignX as 'left' | 'center' | 'right' | undefined;
  if (!alignX) return element.x;
  if (alignX === 'center') return (CANVAS_WIDTH - width) / 2;
  if (alignX === 'right') return CANVAS_WIDTH - width;
  return element.x;
};

const computeElementBox = (element: TemplateElement) => {
  const width = getElementWidthValue(element);
  const height = getElementHeightValue(element);
  const x = resolveAlignedX(element, width);
  const top = CANVAS_HEIGHT - element.y - height;
  return { x, yTop: top, yBottom: top + height, width, height };
};

const AdminTemplateTunerPage = () => {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const baseTemplateId = params.get('baseTemplateId') ?? '';
  const isAdmin = ADMIN_MODE || params.get('admin') === '1';

  const [template, setTemplate] = useState<TemplateDefinition | null>(null);
  const [regionBounds, setRegionBounds] = useState<RegionBounds | null>(null);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [filterRegion, setFilterRegion] = useState<'all' | 'header' | 'body' | 'footer'>('all');
  const [filterType, setFilterType] = useState<'all' | TemplateElement['type']>('all');
  const [filterText, setFilterText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isAdmin || !baseTemplateId) return;
    let mounted = true;
    setError(null);
    fetchBaseTemplate(baseTemplateId)
      .then((tpl) => {
        if (!mounted) return;
        setTemplate(tpl);
        setRegionBounds(resolveRegionBounds(tpl, CANVAS_HEIGHT));
      })
      .catch((err) => {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : 'Failed to load template');
      });
    return () => {
      mounted = false;
    };
  }, [isAdmin, baseTemplateId]);

  const activeRegionBounds = useMemo(() => {
    if (!template) return null;
    return regionBounds ?? resolveRegionBounds(template, CANVAS_HEIGHT);
  }, [template, regionBounds]);

  const updateRegionBounds = (
    region: keyof RegionBounds,
    field: 'yTop' | 'yBottom',
    value: number,
  ) => {
    if (!activeRegionBounds || !template) return;
    const nextBounds: RegionBounds = {
      ...activeRegionBounds,
      [region]: {
        ...activeRegionBounds[region],
        [field]: value,
      },
    };
    setRegionBounds(nextBounds);
    setTemplate({ ...template, regionBounds: nextBounds });
  };

  const updateElement = (id: string, updates: Partial<TemplateElement>) => {
    if (!template) return;
    const nextElements = template.elements.map((el) => {
      if (el.id !== id) return el;
      if (el.type === 'table') {
        const next = { ...el, ...updates } as TemplateElement & { columns?: Array<{ width: number }> };
        if (typeof updates.width === 'number' && updates.width > 0 && Array.isArray(el.columns)) {
          const currentWidth = getElementWidthValue(el);
          const scale = currentWidth > 0 ? updates.width / currentWidth : 1;
          const scaledColumns = el.columns.map((col) => ({
            ...col,
            width: Math.max(1, Math.round(col.width * scale)),
          }));
          return { ...next, columns: scaledColumns } as TemplateElement;
        }
        if (typeof updates.height === 'number' && updates.height > 0) {
          const headerHeight = el.headerHeight ?? 24;
          const nextRowHeight = Math.max(10, Math.round((updates.height - headerHeight) / 3));
          return { ...next, rowHeight: nextRowHeight } as TemplateElement;
        }
        return next;
      }
      return { ...el, ...updates };
    });
    setTemplate({ ...template, elements: nextElements });
  };

  const setElementTopY = (element: TemplateElement, nextTopY: number) => {
    const height = getElementHeightValue(element);
    const nextY = CANVAS_HEIGHT - (nextTopY + height);
    updateElement(element.id, { y: nextY });
  };

  const elementsSorted = useMemo(() => {
    if (!template) return [];
    const regionOrder: Record<string, number> = { header: 0, body: 1, footer: 2 };
    const list = template.elements.filter((el) => {
      if (filterRegion !== 'all' && el.region !== filterRegion) return false;
      if (filterType !== 'all' && el.type !== filterType) return false;
      if (filterText.trim()) {
        const token = filterText.trim().toLowerCase();
        const slotId = ((el as any).slotId as string | undefined)?.toLowerCase() ?? '';
        const id = el.id.toLowerCase();
        if (!slotId.includes(token) && !id.includes(token)) return false;
      }
      return true;
    });
    return list.sort((a, b) => {
      const regionA = regionOrder[a.region ?? 'body'] ?? 1;
      const regionB = regionOrder[b.region ?? 'body'] ?? 1;
      if (regionA !== regionB) return regionA - regionB;
      const boxA = computeElementBox(a);
      const boxB = computeElementBox(b);
      if (boxA.yTop !== boxB.yTop) return boxA.yTop - boxB.yTop;
      return boxA.x - boxB.x;
    });
  }, [template, filterRegion, filterType, filterText]);

  const issues = useMemo(() => {
    if (!template || !activeRegionBounds) return [];
    const boxes = template.elements.map((el) => ({
      id: el.id,
      region: el.region ?? 'body',
      ...computeElementBox(el),
    }));
    const nextIssues: ElementIssue[] = [];
    const boundsByRegion = activeRegionBounds;

    for (const item of boxes) {
      if (item.width <= 0 || item.height <= 0) {
        nextIssues.push({
          id: item.id,
          type: 'invalid',
          message: 'サイズが無効です',
        });
      }
      const regionBounds = boundsByRegion[item.region as keyof RegionBounds];
      if (item.x < 0 || item.x + item.width > CANVAS_WIDTH || item.yTop < regionBounds.yTop || item.yBottom > regionBounds.yBottom) {
        nextIssues.push({
          id: item.id,
          type: 'out_of_region',
          message: `${item.region} 範囲外`,
        });
      }
    }

    for (let i = 0; i < boxes.length; i += 1) {
      const a = boxes[i];
      for (let j = i + 1; j < boxes.length; j += 1) {
        const b = boxes[j];
        const overlapsX = a.x < b.x + b.width && a.x + a.width > b.x;
        const overlapsY = a.yTop < b.yBottom && a.yBottom > b.yTop;
        if (overlapsX && overlapsY) {
          nextIssues.push({
            id: a.id,
            type: 'overlap',
            message: `重なり: ${a.id} / ${b.id}`,
          });
          nextIssues.push({
            id: b.id,
            type: 'overlap',
            message: `重なり: ${a.id} / ${b.id}`,
          });
        }
      }
    }

    return nextIssues;
  }, [template, activeRegionBounds]);

  const issuesById = useMemo(() => {
    const map = new Map<string, IssueType[]>();
    issues.forEach((issue) => {
      const current = map.get(issue.id) ?? [];
      if (!current.includes(issue.type)) current.push(issue.type);
      map.set(issue.id, current);
    });
    return map;
  }, [issues]);
  const errorElementIds = useMemo(() => new Set(issues.map((issue) => issue.id)), [issues]);

  const canSave = issues.length === 0 && !!template && isAdmin;

  const handleSave = async () => {
    if (!template) return;
    if (issues.length > 0) {
      setError('保存できません: 範囲外/重なり/サイズ不正があります。');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await updateBaseTemplate(template, ADMIN_API_KEY);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save template');
    } finally {
      setSaving(false);
    }
  };

  if (!isAdmin) {
    return (
      <div className="admin-tuner">
        <h2>Admin Template Tuner</h2>
        <p>管理者モードが有効ではありません。</p>
      </div>
    );
  }

  if (!baseTemplateId) {
    return (
      <div className="admin-tuner">
        <h2>Admin Template Tuner</h2>
        <p>baseTemplateId を指定してください。</p>
      </div>
    );
  }

  if (!template || !activeRegionBounds) {
    return (
      <div className="admin-tuner">
        <h2>Admin Template Tuner</h2>
        <p>テンプレートを読み込み中...</p>
        {error ? <p style={{ color: '#b42318' }}>{error}</p> : null}
      </div>
    );
  }

  return (
    <div className="admin-tuner">
      <div className="admin-tuner-header">
        <div>
          <h2>Admin Template Tuner</h2>
          <div className="admin-tuner-subtitle">baseTemplateId: {baseTemplateId}</div>
        </div>
        <button
          className="admin-tuner-save"
          disabled={!canSave || saving}
          onClick={handleSave}
        >
          {saving ? '保存中...' : '保存'}
        </button>
      </div>
      {error ? <div className="admin-tuner-error">{error}</div> : null}
      {issues.length > 0 ? (
        <div className="admin-tuner-error">
          保存前に修正が必要です: {issues.length} 件
        </div>
      ) : null}
      <div className="admin-tuner-body">
        <div className="admin-tuner-canvas">
          <TemplateCanvas
            template={template}
            selectedElementId={selectedElementId}
            onSelect={(el) => setSelectedElementId(el?.id ?? null)}
            onUpdateElement={(elementId, updates) => updateElement(elementId, updates)}
            snapEnabled={false}
            showGrid
            showGuides
            adminMode
            regionBounds={activeRegionBounds}
            errorElementIds={errorElementIds}
          />
        </div>
        <div className="admin-tuner-panel">
          <section className="admin-tuner-section">
            <h3>Region Bounds</h3>
            {(['header', 'body', 'footer'] as const).map((region) => {
              const bounds = activeRegionBounds[region];
              return (
                <div key={region} className="admin-tuner-row">
                  <strong className="admin-tuner-label">{region}</strong>
                  <label>
                    yTop
                    <input
                      type="number"
                      value={bounds.yTop}
                      onChange={(event) =>
                        updateRegionBounds(region, 'yTop', parseNumber(event.target.value))
                      }
                    />
                  </label>
                  <label>
                    yBottom
                    <input
                      type="number"
                      value={bounds.yBottom}
                      onChange={(event) =>
                        updateRegionBounds(region, 'yBottom', parseNumber(event.target.value))
                      }
                    />
                  </label>
                </div>
              );
            })}
          </section>
          <section className="admin-tuner-section">
            <h3>Elements</h3>
            <div className="admin-tuner-filters">
              <label>
                Region
                <select
                  value={filterRegion}
                  onChange={(event) => setFilterRegion(event.target.value as typeof filterRegion)}
                >
                  <option value="all">all</option>
                  <option value="header">header</option>
                  <option value="body">body</option>
                  <option value="footer">footer</option>
                </select>
              </label>
              <label>
                Type
                <select
                  value={filterType}
                  onChange={(event) => setFilterType(event.target.value as typeof filterType)}
                >
                  <option value="all">all</option>
                  <option value="text">text</option>
                  <option value="label">label</option>
                  <option value="table">table</option>
                  <option value="image">image</option>
                  <option value="cardList">cardList</option>
                </select>
              </label>
              <label>
                Slot/ID
                <input
                  type="text"
                  value={filterText}
                  onChange={(event) => setFilterText(event.target.value)}
                />
              </label>
            </div>
            <div className="admin-tuner-table">
              {elementsSorted.map((element) => {
                const slotId = (element as any).slotId as string | undefined;
                const width = getElementWidthValue(element);
                const height = getElementHeightValue(element);
                const topY = CANVAS_HEIGHT - element.y - height;
                const badges = issuesById.get(element.id) ?? [];
                return (
                  <div
                    key={element.id}
                    className={[
                      'admin-tuner-row',
                      selectedElementId === element.id ? 'selected' : '',
                    ].join(' ')}
                    onClick={() => setSelectedElementId(element.id)}
                  >
                    <div className="admin-tuner-cell">
                      <strong>{element.id}</strong>
                      <div className="admin-tuner-muted">{slotId ?? '-'}</div>
                      <div className="admin-tuner-badges">
                        {badges.includes('out_of_region') && <span>OUT OF REGION</span>}
                        {badges.includes('overlap') && <span>OVERLAP</span>}
                        {badges.includes('invalid') && <span>INVALID</span>}
                      </div>
                    </div>
                    <div className="admin-tuner-cell">{element.region ?? 'body'}</div>
                    <div className="admin-tuner-cell">{element.type}</div>
                    <label>
                      x
                      <input
                        type="number"
                        value={element.x}
                        onChange={(event) =>
                          updateElement(element.id, { x: parseNumber(event.target.value) })
                        }
                      />
                    </label>
                    <label>
                      y(top)
                      <input
                        type="number"
                        value={Math.round(topY)}
                        onChange={(event) =>
                          setElementTopY(element, parseNumber(event.target.value))
                        }
                      />
                    </label>
                    <label>
                      w
                      <input
                        type="number"
                        value={Math.round(width)}
                        onChange={(event) =>
                          updateElement(element.id, { width: parseNumber(event.target.value) })
                        }
                      />
                    </label>
                    <label>
                      h
                      <input
                        type="number"
                        value={Math.round(height)}
                        onChange={(event) =>
                          updateElement(element.id, { height: parseNumber(event.target.value) })
                        }
                      />
                    </label>
                    {'fontSize' in element ? (
                      <label>
                        font
                        <input
                          type="number"
                          value={(element as any).fontSize ?? ''}
                          onChange={(event) =>
                            updateElement(element.id, { fontSize: parseNumber(event.target.value) } as Partial<TemplateElement>)
                          }
                        />
                      </label>
                    ) : null}
                    {'alignX' in element ? (
                      <label>
                        align
                        <select
                          value={(element as any).alignX ?? ''}
                          onChange={(event) =>
                            updateElement(element.id, { alignX: event.target.value || undefined } as Partial<TemplateElement>)
                          }
                        >
                          <option value="">-</option>
                          <option value="left">left</option>
                          <option value="center">center</option>
                          <option value="right">right</option>
                        </select>
                      </label>
                    ) : null}
                    <label>
                      hidden
                      <input
                        type="checkbox"
                        checked={!!element.hidden}
                        onChange={(event) =>
                          updateElement(element.id, { hidden: event.target.checked })
                        }
                      />
                    </label>
                  </div>
                );
              })}
            </div>
          </section>
          {issues.length > 0 ? (
            <section className="admin-tuner-section">
              <h3>Issues</h3>
              <ul className="admin-tuner-issues">
                {issues.map((issue, index) => (
                  <li key={`${issue.id}-${issue.type}-${index}`}>
                    {issue.id}: {issue.message}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default AdminTemplateTunerPage;
