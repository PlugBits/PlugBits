import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import type { LabelMapping, LabelSheetSettings, TemplateDefinition } from '@shared/template';
import KintoneFieldSelect from '../../components/KintoneFieldSelect';
import { useKintoneFields } from '../../hooks/useKintoneFields';
import { useTenantStore } from '../../store/tenantStore';
import { getQueryParams } from '../../utils/urlParams';

type Props = {
  template: TemplateDefinition;
  onChange: (next: TemplateDefinition) => void;
};

type CalcResult = {
  cols: number;
  rows: number;
  total: number;
  invalid: boolean;
  warning?: string;
};

const DEFAULT_SHEET: LabelSheetSettings = {
  paperPreset: 'A4',
  paperWidthMm: 210,
  paperHeightMm: 297,
  cols: 2,
  rows: 5,
  marginMm: 8,
  gapMm: 2,
  offsetXmm: 0,
  offsetYmm: 0,
};

const PRESET_A4 = { paperPreset: 'A4' as const, paperWidthMm: 210, paperHeightMm: 297 };
const PRESET_LETTER = { paperPreset: 'Letter' as const, paperWidthMm: 215.9, paperHeightMm: 279.4 };

const toNumber = (value: unknown, fallback: number) => {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
};

const clampNonNegative = (value: number) => (Number.isFinite(value) ? Math.max(0, value) : 0);
const parsePositiveNumber = (value: string) => {
  const next = Number(value);
  return Number.isFinite(next) && next > 0 ? next : null;
};

const normalizeSheet = (raw: TemplateDefinition['sheetSettings']): LabelSheetSettings => {
  const source = raw && typeof raw === 'object' ? raw : DEFAULT_SHEET;
  const paperWidthMm = toNumber(source.paperWidthMm, DEFAULT_SHEET.paperWidthMm);
  const paperHeightMm = toNumber(source.paperHeightMm, DEFAULT_SHEET.paperHeightMm);
  const preset = source.paperPreset ?? (Math.abs(paperWidthMm - PRESET_A4.paperWidthMm) < 0.2 &&
    Math.abs(paperHeightMm - PRESET_A4.paperHeightMm) < 0.2
      ? 'A4'
      : Math.abs(paperWidthMm - PRESET_LETTER.paperWidthMm) < 0.2 &&
        Math.abs(paperHeightMm - PRESET_LETTER.paperHeightMm) < 0.2
      ? 'Letter'
      : 'Custom');

  return {
    paperPreset: preset,
    paperWidthMm,
    paperHeightMm,
    cols: Math.max(1, Math.floor(toNumber(source.cols, DEFAULT_SHEET.cols))),
    rows: Math.max(1, Math.floor(toNumber(source.rows, DEFAULT_SHEET.rows))),
    marginMm: clampNonNegative(toNumber(source.marginMm, DEFAULT_SHEET.marginMm)),
    gapMm: clampNonNegative(toNumber(source.gapMm, DEFAULT_SHEET.gapMm)),
    offsetXmm: toNumber(source.offsetXmm, DEFAULT_SHEET.offsetXmm),
    offsetYmm: toNumber(source.offsetYmm, DEFAULT_SHEET.offsetYmm),
  };
};

const normalizeMapping = (raw: TemplateDefinition['mapping']): LabelMapping => {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const slots = source.slots && typeof source.slots === 'object'
    ? (source.slots as Record<string, unknown>)
    : {};
  const normalizeField = (value: unknown) =>
    typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
  return {
    slots: {
      title: normalizeField(slots.title),
      code: normalizeField(slots.code),
      qty: normalizeField(slots.qty),
      qr: normalizeField(slots.qr),
      extra: normalizeField(slots.extra),
    },
    copiesFieldCode: normalizeField(source.copiesFieldCode),
  };
};

const computeColsRows = (
  paperW: number,
  paperH: number,
  sheet: LabelSheetSettings,
): CalcResult => {
  const cols = Math.max(1, Math.floor(sheet.cols));
  const rows = Math.max(1, Math.floor(sheet.rows));
  const invalid = cols < 1 || rows < 1 || !Number.isFinite(paperW) || !Number.isFinite(paperH);
  return {
    cols,
    rows,
    total: cols * rows,
    invalid,
    warning: invalid ? '列/行の設定が不正です。' : undefined,
  };
};

const TEXT_TYPES = [
  'SINGLE_LINE_TEXT',
  'MULTI_LINE_TEXT',
  'RICH_TEXT',
  'LINK',
  'DROP_DOWN',
  'RADIO_BUTTON',
  'CHECK_BOX',
  'MULTI_SELECT',
  'USER_SELECT',
  'ORGANIZATION_SELECT',
  'GROUP_SELECT',
];

const NUMBER_TYPES = ['NUMBER', 'CALC'];
const TEXT_OR_NUMBER_TYPES = [...TEXT_TYPES, ...NUMBER_TYPES];

const LabelEditorPanel: React.FC<Props> = ({ template, onChange }) => {
  const sheet = useMemo(() => normalizeSheet(template.sheetSettings), [template.sheetSettings]);
  const mapping = useMemo(() => normalizeMapping(template.mapping), [template.mapping]);
  const [widthStr, setWidthStr] = useState(() => String(sheet.paperWidthMm));
  const [heightStr, setHeightStr] = useState(() => String(sheet.paperHeightMm));
  const { fields, loading, error, errorCode } = useKintoneFields();
  const location = useLocation();
  const params = useMemo(
    () => getQueryParams(location.search, location.hash),
    [location.search, location.hash],
  );
  const returnOrigin = params.get('returnOrigin') ?? '';
  const resolveReturnOrigin = () => {
    if (!returnOrigin) return '';
    try {
      new URL(returnOrigin);
      return returnOrigin;
    } catch {
      return '';
    }
  };
  const handleReturnToSettings = () => {
    const origin = resolveReturnOrigin();
    if (origin) {
      window.location.href = origin;
      return;
    }
    const before = window.location.href;
    window.history.back();
    window.setTimeout(() => {
      if (window.location.href === before) {
        window.location.href = '/';
      }
    }, 200);
  };
  const tenantContext = useTenantStore((state) => state.tenantContext);
  const recordOptions = useMemo(
    () =>
      (fields ?? [])
        .filter((field) => !field.isSubtable)
        .map((field) => ({ code: field.code, label: field.label, type: field.type })),
    [fields],
  );

  useEffect(() => {
    setWidthStr(String(sheet.paperWidthMm));
    setHeightStr(String(sheet.paperHeightMm));
  }, [template.id]);

  useEffect(() => {
    if (sheet.paperPreset === 'Custom') return;
    setWidthStr(String(sheet.paperWidthMm));
    setHeightStr(String(sheet.paperHeightMm));
  }, [sheet.paperPreset, sheet.paperWidthMm, sheet.paperHeightMm]);

  const resolvedWidthMm = sheet.paperPreset === 'Custom'
    ? parsePositiveNumber(widthStr) ?? NaN
    : sheet.paperWidthMm;
  const resolvedHeightMm = sheet.paperPreset === 'Custom'
    ? parsePositiveNumber(heightStr) ?? NaN
    : sheet.paperHeightMm;

  const calcPaperW = template.orientation === 'landscape'
    ? resolvedHeightMm
    : resolvedWidthMm;
  const calcPaperH = template.orientation === 'landscape'
    ? resolvedWidthMm
    : resolvedHeightMm;

  const calcResult = useMemo(
    () => computeColsRows(calcPaperW, calcPaperH, sheet),
    [calcPaperW, calcPaperH, sheet],
  );

  const updateSheet = (patch: Partial<LabelSheetSettings>) => {
    onChange({ ...template, sheetSettings: { ...sheet, ...patch } });
  };

  const updateSlot = (slotId: keyof LabelMapping['slots'], value: string) => {
    const nextSlots = { ...mapping.slots, [slotId]: value || null };
    onChange({ ...template, mapping: { ...mapping, slots: nextSlots } });
  };

  const updateCopies = (value: string) => {
    onChange({ ...template, mapping: { ...mapping, copiesFieldCode: value || null } });
  };

  const openCalibration = () => {
    const baseUrl = tenantContext?.workerBaseUrl;
    if (!baseUrl) return;
    const customWidth = sheet.paperPreset === 'Custom'
      ? parsePositiveNumber(widthStr)
      : sheet.paperWidthMm;
    const customHeight = sheet.paperPreset === 'Custom'
      ? parsePositiveNumber(heightStr)
      : sheet.paperHeightMm;
    if (!customWidth || !customHeight) {
      alert('用紙幅/高さを正しく入力してください。');
      return;
    }
    const query = new URLSearchParams({
      paperWidthMm: String(customWidth),
      paperHeightMm: String(customHeight),
      cols: String(calcResult.cols),
      rows: String(calcResult.rows),
      marginMm: String(sheet.marginMm),
      gapMm: String(sheet.gapMm),
      offsetXmm: String(sheet.offsetXmm),
      offsetYmm: String(sheet.offsetYmm),
    });
    const url = `${baseUrl.replace(/\/$/, '')}/calibration/label?${query.toString()}`;
    window.open(url, '_blank');
  };

  const missingQr = !mapping.slots.qr;
  const computedSummary = `${calcResult.cols}列 × ${calcResult.rows}行（${calcResult.total}面）`;
  const isInvalid = calcResult.invalid;

  const previewScale = useMemo(() => {
    const maxWidth = 220;
    if (!Number.isFinite(calcPaperW) || calcPaperW <= 0) return { width: 220, height: 160, scale: 1 };
    const scale = maxWidth / calcPaperW;
    const height = Math.max(100, calcPaperH * scale);
    return { width: maxWidth, height, scale };
  }, [calcPaperW, calcPaperH]);

  const labelW = calcResult.cols > 0
    ? (calcPaperW - sheet.marginMm * 2 - sheet.gapMm * (calcResult.cols - 1)) / calcResult.cols
    : 0;
  const labelH = calcResult.rows > 0
    ? (calcPaperH - sheet.marginMm * 2 - sheet.gapMm * (calcResult.rows - 1)) / calcResult.rows
    : 0;
  const previewCount = Math.min(calcResult.total, 60);

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(260px, 360px) minmax(320px, 1fr)',
        gap: '1.25rem',
        alignItems: 'start',
        height: '100%',
        minHeight: 0,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ display: 'grid', gap: '1rem', flex: 1, minHeight: 0, overflowY: 'auto' }}>
        <div className="mapping-card" style={{ padding: '1rem' }}>
          <div className="mapping-card-title">面付けプレビュー</div>
          <div
            style={{
              width: previewScale.width,
              height: previewScale.height,
              border: '1px solid #e4e7ec',
              borderRadius: 8,
              background: '#fff',
              position: 'relative',
              overflow: 'auto',
            }}
          >
            {!isInvalid && previewCount > 0 && labelW > 0 && labelH > 0 && (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(${calcResult.cols}, ${labelW * previewScale.scale}px)`,
                  gridTemplateRows: `repeat(${calcResult.rows}, ${labelH * previewScale.scale}px)`,
                  columnGap: `${sheet.gapMm * previewScale.scale}px`,
                  rowGap: `${sheet.gapMm * previewScale.scale}px`,
                  paddingLeft: `${sheet.marginMm * previewScale.scale}px`,
                  paddingTop: `${sheet.marginMm * previewScale.scale}px`,
                }}
              >
                {Array.from({ length: previewCount }).map((_, idx) => (
                  <div
                    key={`label-preview-${idx}`}
                    style={{
                      border: '1px solid #cbd5e1',
                      borderRadius: 4,
                      background: idx === 0 ? '#e0f2fe' : '#f8fafc',
                    }}
                  />
                ))}
              </div>
            )}
          </div>
          {previewCount < calcResult.total && !isInvalid && (
            <div style={{ marginTop: 6, fontSize: '0.8rem', color: '#667085' }}>
              先頭 {previewCount} 面のみ表示しています。
            </div>
          )}
        </div>
        <div className="mapping-card" style={{ padding: '1rem' }}>
          <div className="mapping-card-title">用紙・面付け</div>
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            <label>
              用紙プリセット
              <select
                className="mapping-control mapping-select"
                value={sheet.paperPreset ?? 'Custom'}
                onChange={(event) => {
                  const value = event.target.value as 'A4' | 'Letter' | 'Custom';
                  if (value === 'A4') {
                    updateSheet({ ...PRESET_A4, paperPreset: 'A4' });
                    return;
                  }
                  if (value === 'Letter') {
                    updateSheet({ ...PRESET_LETTER, paperPreset: 'Letter' });
                    return;
                  }
                  setWidthStr(String(sheet.paperWidthMm));
                  setHeightStr(String(sheet.paperHeightMm));
                  updateSheet({ paperPreset: 'Custom' });
                }}
              >
                <option value="A4">A4</option>
                <option value="Letter">Letter</option>
                <option value="Custom">Custom</option>
              </select>
            </label>

            {sheet.paperPreset === 'Custom' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
                <label>
                  用紙幅(mm)
                  <input
                    type="number"
                    step="0.1"
                    className="mapping-control"
                    value={widthStr}
                    onChange={(event) => {
                      const value = event.target.value;
                      setWidthStr(value);
                      const parsed = parsePositiveNumber(value);
                      updateSheet({ paperWidthMm: parsed ?? 0 });
                    }}
                    onBlur={() => {
                      const parsed = parsePositiveNumber(widthStr);
                      if (parsed) updateSheet({ paperWidthMm: parsed });
                    }}
                  />
                </label>
                <label>
                  用紙高さ(mm)
                  <input
                    type="number"
                    step="0.1"
                    className="mapping-control"
                    value={heightStr}
                    onChange={(event) => {
                      const value = event.target.value;
                      setHeightStr(value);
                      const parsed = parsePositiveNumber(value);
                      updateSheet({ paperHeightMm: parsed ?? 0 });
                    }}
                    onBlur={() => {
                      const parsed = parsePositiveNumber(heightStr);
                      if (parsed) updateSheet({ paperHeightMm: parsed });
                    }}
                  />
                </label>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
              <label>
                列
                <input
                  type="number"
                  min={1}
                  step={1}
                  className="mapping-control"
                  value={sheet.cols}
                  onChange={(event) => updateSheet({ cols: Number(event.target.value) })}
                />
              </label>
              <label>
                行
                <input
                  type="number"
                  min={1}
                  step={1}
                  className="mapping-control"
                  value={sheet.rows}
                  onChange={(event) => updateSheet({ rows: Number(event.target.value) })}
                />
              </label>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
              <label>
                余白(mm)
                <input
                  type="number"
                  step="0.1"
                  className="mapping-control"
                  value={sheet.marginMm}
                  onChange={(event) => updateSheet({ marginMm: Number(event.target.value) })}
                />
              </label>
              <label>
                間隔(mm)
                <input
                  type="number"
                  step="0.1"
                  className="mapping-control"
                  value={sheet.gapMm}
                  onChange={(event) => updateSheet({ gapMm: Number(event.target.value) })}
                />
              </label>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
              <label>
                X補正(mm)
                <input
                  type="number"
                  step="0.1"
                  className="mapping-control"
                  value={sheet.offsetXmm}
                  onChange={(event) => updateSheet({ offsetXmm: Number(event.target.value) })}
                />
              </label>
              <label>
                Y補正(mm)
                <input
                  type="number"
                  step="0.1"
                  className="mapping-control"
                  value={sheet.offsetYmm}
                  onChange={(event) => updateSheet({ offsetYmm: Number(event.target.value) })}
                />
              </label>
            </div>

            <div style={{ fontSize: '0.9rem', color: isInvalid ? '#b42318' : '#475467' }}>
              {isInvalid ? calcResult.warning : `この設定だと ${computedSummary}`}
            </div>

            <button type="button" className="secondary" onClick={openCalibration}>
              校正PDFを開く
            </button>
            <p className="mapping-help">校正PDFでズレを確認し、X/Y補正を調整してください。</p>
          </div>
        </div>

        </div>
      </div>

      <div style={{ display: 'grid', gap: '1rem', alignContent: 'start' }}>
        <div className="mapping-card" style={{ padding: '1rem' }}>
          <div className="mapping-card-title">印刷枚数</div>
          <label>
            copies フィールド
            <KintoneFieldSelect
              value={mapping.copiesFieldCode ?? ''}
              onChange={updateCopies}
              fields={recordOptions}
              allowTypes={NUMBER_TYPES}
              placeholder="（未指定なら 1 枚）"
            />
          </label>
          <p className="mapping-help">未指定/0/空は1枚扱い。上限1000。</p>
        </div>

        <div className="mapping-card" style={{ padding: '1rem' }}>
          <div className="mapping-card-title">ラベル項目の割り当て</div>
          <div style={{ display: 'grid', gap: '0.8rem' }}>
            <label>
              タイトル（2行）
              <KintoneFieldSelect
                value={mapping.slots.title ?? ''}
                onChange={(value) => updateSlot('title', value)}
                fields={recordOptions}
                allowTypes={TEXT_TYPES}
                placeholder="（選択してください）"
              />
            </label>
            <label>
              コード
              <KintoneFieldSelect
                value={mapping.slots.code ?? ''}
                onChange={(value) => updateSlot('code', value)}
                fields={recordOptions}
                allowTypes={TEXT_OR_NUMBER_TYPES}
                placeholder="（選択してください）"
              />
            </label>
            <label>
              数量
              <KintoneFieldSelect
                value={mapping.slots.qty ?? ''}
                onChange={(value) => updateSlot('qty', value)}
                fields={recordOptions}
                allowTypes={NUMBER_TYPES}
                placeholder="（選択してください）"
              />
            </label>
            <label>
              QR（必須）
              <KintoneFieldSelect
                value={mapping.slots.qr ?? ''}
                onChange={(value) => updateSlot('qr', value)}
                fields={recordOptions}
                allowTypes={TEXT_OR_NUMBER_TYPES}
                placeholder="（選択してください）"
              />
            </label>
            <label>
              補足（任意）
              <KintoneFieldSelect
                value={mapping.slots.extra ?? ''}
                onChange={(value) => updateSlot('extra', value)}
                fields={recordOptions}
                allowTypes={TEXT_TYPES}
                placeholder="（任意）"
              />
            </label>
          </div>

          {missingQr && (
            <div style={{ marginTop: '0.8rem', color: '#b42318', fontSize: '0.9rem' }}>
              QR の割り当てが未設定です（必須）。
            </div>
          )}

          {loading && (
            <div style={{ marginTop: '0.8rem', color: '#475467', fontSize: '0.85rem' }}>
              フィールド一覧を取得しています...
            </div>
          )}
          {error && (
            <div style={{ marginTop: '0.8rem', color: '#b42318', fontSize: '0.85rem' }}>
              <div>{error}</div>
              {errorCode === 'MISSING_KINTONE_API_TOKEN' && (
                <button
                  type="button"
                  className="ghost"
                  style={{ marginTop: 6 }}
                  onClick={handleReturnToSettings}
                >
                  プラグイン設定に戻る
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default LabelEditorPanel;
