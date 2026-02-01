import { useMemo, useState } from 'react';
import type { LabelMapping, LabelSheetSettings, TemplateDefinition } from '@shared/template';
import KintoneFieldSelect from '../../components/KintoneFieldSelect';
import { useKintoneFields } from '../../hooks/useKintoneFields';
import { useTenantStore } from '../../store/tenantStore';

type Props = {
  template: TemplateDefinition;
  onChange: (next: TemplateDefinition) => void;
};

type SheetInputs = {
  paperWidthMm: number;
  paperHeightMm: number;
  labelWidthMm: number;
  labelHeightMm: number;
  marginTopMm: number;
  marginLeftMm: number;
  gapXmm: number;
  gapYmm: number;
  offsetXmm: number;
  offsetYmm: number;
};

type CalcResult = {
  cols: number;
  rows: number;
  total: number;
  invalid: boolean;
  warning?: string;
};

const DEFAULT_SHEET: LabelSheetSettings = {
  paperWidthMm: 210,
  paperHeightMm: 297,
  cols: 2,
  rows: 5,
  marginMm: 8,
  gapMm: 2,
  offsetXmm: 0,
  offsetYmm: 0,
};

const PRESET_A4 = { paperWidthMm: 210, paperHeightMm: 297 };
const PRESET_LETTER = { paperWidthMm: 215.9, paperHeightMm: 279.4 };

const toNumber = (value: unknown, fallback: number) => {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
};

const clampNonNegative = (value: number) => (Number.isFinite(value) ? Math.max(0, value) : 0);

const normalizeLegacySheet = (raw: TemplateDefinition['sheetSettings']): LabelSheetSettings => {
  const source = raw && typeof raw === 'object' ? raw : DEFAULT_SHEET;
  return {
    paperWidthMm: toNumber(source.paperWidthMm, DEFAULT_SHEET.paperWidthMm),
    paperHeightMm: toNumber(source.paperHeightMm, DEFAULT_SHEET.paperHeightMm),
    cols: Math.max(1, Math.floor(toNumber(source.cols, DEFAULT_SHEET.cols))),
    rows: Math.max(1, Math.floor(toNumber(source.rows, DEFAULT_SHEET.rows))),
    marginMm: clampNonNegative(toNumber(source.marginMm, DEFAULT_SHEET.marginMm)),
    gapMm: clampNonNegative(toNumber(source.gapMm, DEFAULT_SHEET.gapMm)),
    offsetXmm: toNumber(source.offsetXmm, DEFAULT_SHEET.offsetXmm),
    offsetYmm: toNumber(source.offsetYmm, DEFAULT_SHEET.offsetYmm),
  };
};

const deriveLabelSizeFromLegacy = (sheet: LabelSheetSettings) => {
  const cols = Math.max(1, sheet.cols);
  const rows = Math.max(1, sheet.rows);
  const usableW = sheet.paperWidthMm - sheet.marginMm * 2 - sheet.gapMm * (cols - 1);
  const usableH = sheet.paperHeightMm - sheet.marginMm * 2 - sheet.gapMm * (rows - 1);
  return {
    labelWidthMm: usableW > 0 ? usableW / cols : 0,
    labelHeightMm: usableH > 0 ? usableH / rows : 0,
  };
};

const computeColsRows = (
  paperW: number,
  paperH: number,
  inputs: SheetInputs,
): CalcResult => {
  const labelW = inputs.labelWidthMm;
  const labelH = inputs.labelHeightMm;
  const gapX = clampNonNegative(inputs.gapXmm);
  const gapY = clampNonNegative(inputs.gapYmm);
  const marginLeft = clampNonNegative(inputs.marginLeftMm);
  const marginTop = clampNonNegative(inputs.marginTopMm);

  if (labelW <= 0 || labelH <= 0) {
    return { cols: 0, rows: 0, total: 0, invalid: true, warning: 'ラベルサイズが不正です。' };
  }

  const usableW = paperW - marginLeft;
  const usableH = paperH - marginTop;
  const cols = Math.floor((usableW + gapX) / (labelW + gapX));
  const rows = Math.floor((usableH + gapY) / (labelH + gapY));
  const safeCols = cols > 0 ? cols : 0;
  const safeRows = rows > 0 ? rows : 0;
  const invalid = safeCols < 1 || safeRows < 1;
  return {
    cols: safeCols,
    rows: safeRows,
    total: safeCols * safeRows,
    invalid,
    warning: invalid ? '面付けが成立しません。入力値を調整してください。' : undefined,
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
  const legacySheet = useMemo(
    () => normalizeLegacySheet(template.sheetSettings),
    [template.sheetSettings],
  );
  const mapping = useMemo(() => normalizeMapping(template.mapping), [template.mapping]);
  const { fields, loading, error } = useKintoneFields();
  const tenantContext = useTenantStore((state) => state.tenantContext);
  const recordOptions = useMemo(
    () =>
      (fields ?? [])
        .filter((field) => !field.isSubtable)
        .map((field) => ({ code: field.code, label: field.label, type: field.type })),
    [fields],
  );

  const rawSheet = (template.sheetSettings && typeof template.sheetSettings === 'object')
    ? template.sheetSettings
    : {};
  const hasCustomSizing =
    Number.isFinite((rawSheet as LabelSheetSettings).labelWidthMm) &&
    Number.isFinite((rawSheet as LabelSheetSettings).labelHeightMm);

  const derivedLabelSize = useMemo(() => deriveLabelSizeFromLegacy(legacySheet), [legacySheet]);

  const inputs = useMemo<SheetInputs>(() => {
    const labelWidthMm = toNumber(
      (rawSheet as LabelSheetSettings).labelWidthMm,
      derivedLabelSize.labelWidthMm,
    );
    const labelHeightMm = toNumber(
      (rawSheet as LabelSheetSettings).labelHeightMm,
      derivedLabelSize.labelHeightMm,
    );
    const marginBase = clampNonNegative(
      toNumber(
        (rawSheet as LabelSheetSettings).marginTopMm ??
          (rawSheet as LabelSheetSettings).marginLeftMm,
        legacySheet.marginMm,
      ),
    );
    const gapBase = clampNonNegative(
      toNumber(
        (rawSheet as LabelSheetSettings).gapXmm ??
          (rawSheet as LabelSheetSettings).gapYmm,
        legacySheet.gapMm,
      ),
    );

    return {
      paperWidthMm: toNumber((rawSheet as LabelSheetSettings).paperWidthMm, legacySheet.paperWidthMm),
      paperHeightMm: toNumber((rawSheet as LabelSheetSettings).paperHeightMm, legacySheet.paperHeightMm),
      labelWidthMm,
      labelHeightMm,
      marginTopMm: marginBase,
      marginLeftMm: marginBase,
      gapXmm: gapBase,
      gapYmm: gapBase,
      offsetXmm: toNumber((rawSheet as LabelSheetSettings).offsetXmm, legacySheet.offsetXmm),
      offsetYmm: toNumber((rawSheet as LabelSheetSettings).offsetYmm, legacySheet.offsetYmm),
    };
  }, [rawSheet, legacySheet, derivedLabelSize]);

  const [mode, setMode] = useState<'preset' | 'custom'>(() => (hasCustomSizing ? 'custom' : 'preset'));

  const calcPaperW = template.orientation === 'landscape'
    ? inputs.paperHeightMm
    : inputs.paperWidthMm;
  const calcPaperH = template.orientation === 'landscape'
    ? inputs.paperWidthMm
    : inputs.paperHeightMm;

  const calcResult = useMemo(
    () => computeColsRows(calcPaperW, calcPaperH, inputs),
    [calcPaperW, calcPaperH, inputs],
  );

  const applyInputs = (patch: Partial<SheetInputs>) => {
    const next: SheetInputs = { ...inputs, ...patch };
    const nextPaperW =
      template.orientation === 'landscape' ? next.paperHeightMm : next.paperWidthMm;
    const nextPaperH =
      template.orientation === 'landscape' ? next.paperWidthMm : next.paperHeightMm;
    const nextCalc = computeColsRows(nextPaperW, nextPaperH, next);
    const nextSheet: LabelSheetSettings = {
      paperWidthMm: next.paperWidthMm,
      paperHeightMm: next.paperHeightMm,
      cols: nextCalc.cols,
      rows: nextCalc.rows,
      marginMm: clampNonNegative(next.marginTopMm),
      gapMm: clampNonNegative(next.gapXmm),
      offsetXmm: next.offsetXmm,
      offsetYmm: next.offsetYmm,
      labelWidthMm: next.labelWidthMm,
      labelHeightMm: next.labelHeightMm,
      marginTopMm: next.marginTopMm,
      marginLeftMm: next.marginLeftMm,
      gapXmm: next.gapXmm,
      gapYmm: next.gapYmm,
    };
    onChange({ ...template, sheetSettings: nextSheet });
  };

  const updateSlot = (slotId: keyof LabelMapping['slots'], value: string) => {
    const nextSlots = { ...mapping.slots, [slotId]: value || null };
    onChange({ ...template, mapping: { ...mapping, slots: nextSlots } });
  };

  const updateCopies = (value: string) => {
    onChange({ ...template, mapping: { ...mapping, copiesFieldCode: value || null } });
  };

  const updatePaperPreset = (preset: 'A4' | 'Letter') => {
    const nextPaper = preset === 'A4' ? PRESET_A4 : PRESET_LETTER;
    applyInputs({ paperWidthMm: nextPaper.paperWidthMm, paperHeightMm: nextPaper.paperHeightMm });
  };

  const openCalibration = () => {
    const baseUrl = tenantContext?.workerBaseUrl;
    if (!baseUrl) return;
    const query = new URLSearchParams({
      paperWidthMm: String(inputs.paperWidthMm),
      paperHeightMm: String(inputs.paperHeightMm),
      cols: String(calcResult.cols),
      rows: String(calcResult.rows),
      marginMm: String(clampNonNegative(inputs.marginTopMm)),
      gapMm: String(clampNonNegative(inputs.gapXmm)),
      offsetXmm: String(inputs.offsetXmm),
      offsetYmm: String(inputs.offsetYmm),
      labelWidthMm: String(inputs.labelWidthMm),
      labelHeightMm: String(inputs.labelHeightMm),
      marginTopMm: String(inputs.marginTopMm),
      marginLeftMm: String(inputs.marginLeftMm),
      gapXmm: String(inputs.gapXmm),
      gapYmm: String(inputs.gapYmm),
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

  const previewCount = Math.min(calcResult.total, 60);

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(260px, 360px) minmax(320px, 1fr)',
        gap: '1.25rem',
        alignItems: 'start',
      }}
    >
      <div style={{ display: 'grid', gap: '1rem' }}>
        <div className="mapping-card" style={{ padding: '1rem' }}>
          <div className="mapping-card-title" style={{ marginBottom: 8 }}>設定モード</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <button
              type="button"
              className={mode === 'preset' ? 'secondary' : 'ghost'}
              onClick={() => setMode('preset')}
            >
              Preset（推奨）
            </button>
            <button
              type="button"
              className={mode === 'custom' ? 'secondary' : 'ghost'}
              onClick={() => setMode('custom')}
            >
              Custom（mm入力）
            </button>
          </div>
          {!hasCustomSizing && (
            <div style={{ color: '#b42318', fontSize: '0.85rem' }}>
              旧テンプレのため mm 設定が未保存です。一度保存すると mm 設定が有効になります。
            </div>
          )}
        </div>

        <div className="mapping-card" style={{ padding: '1rem' }}>
          <div className="mapping-card-title">用紙・面付け（mm）</div>
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            <label>
              用紙プリセット
              <select
                className="mapping-control mapping-select"
                value={
                  Math.abs(inputs.paperWidthMm - PRESET_A4.paperWidthMm) < 0.2 &&
                  Math.abs(inputs.paperHeightMm - PRESET_A4.paperHeightMm) < 0.2
                    ? 'A4'
                    : Math.abs(inputs.paperWidthMm - PRESET_LETTER.paperWidthMm) < 0.2 &&
                      Math.abs(inputs.paperHeightMm - PRESET_LETTER.paperHeightMm) < 0.2
                    ? 'Letter'
                    : 'Custom'
                }
                onChange={(event) => {
                  const value = event.target.value;
                  if (value === 'A4') updatePaperPreset('A4');
                  if (value === 'Letter') updatePaperPreset('Letter');
                }}
              >
                <option value="A4">A4</option>
                <option value="Letter">Letter</option>
                <option value="Custom">Custom</option>
              </select>
            </label>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
              <label>
                ラベル幅(mm)
                <input
                  type="number"
                  step="0.1"
                  className="mapping-control"
                  value={inputs.labelWidthMm}
                  disabled={mode === 'preset'}
                  onChange={(event) => applyInputs({ labelWidthMm: Number(event.target.value) })}
                />
              </label>
              <label>
                ラベル高さ(mm)
                <input
                  type="number"
                  step="0.1"
                  className="mapping-control"
                  value={inputs.labelHeightMm}
                  disabled={mode === 'preset'}
                  onChange={(event) => applyInputs({ labelHeightMm: Number(event.target.value) })}
                />
              </label>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
              <label>
                上余白(mm)
                <input
                  type="number"
                  step="0.1"
                  className="mapping-control"
                  value={inputs.marginTopMm}
                  disabled={mode === 'preset'}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    applyInputs({ marginTopMm: value, marginLeftMm: value });
                  }}
                />
              </label>
              <label>
                左余白(mm)
                <input
                  type="number"
                  step="0.1"
                  className="mapping-control"
                  value={inputs.marginLeftMm}
                  disabled={mode === 'preset'}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    applyInputs({ marginTopMm: value, marginLeftMm: value });
                  }}
                />
              </label>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
              <label>
                横間隔(mm)
                <input
                  type="number"
                  step="0.1"
                  className="mapping-control"
                  value={inputs.gapXmm}
                  disabled={mode === 'preset'}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    applyInputs({ gapXmm: value, gapYmm: value });
                  }}
                />
              </label>
              <label>
                縦間隔(mm)
                <input
                  type="number"
                  step="0.1"
                  className="mapping-control"
                  value={inputs.gapYmm}
                  disabled={mode === 'preset'}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    applyInputs({ gapXmm: value, gapYmm: value });
                  }}
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
                  value={inputs.offsetXmm}
                  onChange={(event) => applyInputs({ offsetXmm: Number(event.target.value) })}
                />
              </label>
              <label>
                Y補正(mm)
                <input
                  type="number"
                  step="0.1"
                  className="mapping-control"
                  value={inputs.offsetYmm}
                  onChange={(event) => applyInputs({ offsetYmm: Number(event.target.value) })}
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
              overflow: 'hidden',
            }}
          >
            {!isInvalid && previewCount > 0 && (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(${calcResult.cols}, ${inputs.labelWidthMm * previewScale.scale}px)`,
                  gridTemplateRows: `repeat(${calcResult.rows}, ${inputs.labelHeightMm * previewScale.scale}px)`,
                  columnGap: `${inputs.gapXmm * previewScale.scale}px`,
                  rowGap: `${inputs.gapYmm * previewScale.scale}px`,
                  paddingLeft: `${inputs.marginLeftMm * previewScale.scale}px`,
                  paddingTop: `${inputs.marginTopMm * previewScale.scale}px`,
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
            {error}
          </div>
        )}
      </div>
    </div>
  );
};

export default LabelEditorPanel;
