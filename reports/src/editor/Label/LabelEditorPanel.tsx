import { useEffect, useMemo, useState } from 'react';
import type { LabelMapping, LabelSheetSettings, TemplateDefinition } from '@shared/template';
import KintoneFieldSelect from '../../components/KintoneFieldSelect';
import { useKintoneFields } from '../../hooks/useKintoneFields';
import { useTenantStore } from '../../store/tenantStore';

type Props = {
  template: TemplateDefinition;
  onChange: (next: TemplateDefinition) => void;
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

const normalizeSheet = (raw: TemplateDefinition['sheetSettings']): LabelSheetSettings => {
  const source = (raw && typeof raw === 'object') ? raw : DEFAULT_SHEET;
  const num = (value: unknown, fallback: number) => {
    const next = Number(value);
    return Number.isFinite(next) ? next : fallback;
  };
  return {
    paperWidthMm: num(source.paperWidthMm, DEFAULT_SHEET.paperWidthMm),
    paperHeightMm: num(source.paperHeightMm, DEFAULT_SHEET.paperHeightMm),
    cols: Math.max(1, Math.floor(num(source.cols, DEFAULT_SHEET.cols))),
    rows: Math.max(1, Math.floor(num(source.rows, DEFAULT_SHEET.rows))),
    marginMm: Math.max(0, num(source.marginMm, DEFAULT_SHEET.marginMm)),
    gapMm: Math.max(0, num(source.gapMm, DEFAULT_SHEET.gapMm)),
    offsetXmm: num(source.offsetXmm, DEFAULT_SHEET.offsetXmm),
    offsetYmm: num(source.offsetYmm, DEFAULT_SHEET.offsetYmm),
  };
};

const normalizeMapping = (raw: TemplateDefinition['mapping']): LabelMapping => {
  const source = (raw && typeof raw === 'object') ? (raw as Record<string, unknown>) : {};
  const slots = (source.slots && typeof source.slots === 'object')
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

const isPreset = (sheet: LabelSheetSettings, preset: { paperWidthMm: number; paperHeightMm: number }) =>
  Math.abs(sheet.paperWidthMm - preset.paperWidthMm) < 0.2 &&
  Math.abs(sheet.paperHeightMm - preset.paperHeightMm) < 0.2;

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
  const { fields, loading, error } = useKintoneFields();
  const tenantContext = useTenantStore((state) => state.tenantContext);
  const recordOptions = useMemo(
    () =>
      (fields ?? [])
        .filter((field) => !field.isSubtable)
        .map((field) => ({ code: field.code, label: field.label, type: field.type })),
    [fields],
  );

  const derivedPreset = useMemo(() => {
    if (isPreset(sheet, PRESET_A4)) return 'A4';
    if (isPreset(sheet, PRESET_LETTER)) return 'Letter';
    return 'custom';
  }, [sheet]);
  const [presetOverride, setPresetOverride] = useState<null | 'custom'>(null);
  const presetValue = presetOverride ?? derivedPreset;
  useEffect(() => {
    if (presetOverride && derivedPreset !== 'custom') {
      setPresetOverride(null);
    }
  }, [derivedPreset, presetOverride]);

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
    const query = new URLSearchParams({
      paperWidthMm: String(sheet.paperWidthMm),
      paperHeightMm: String(sheet.paperHeightMm),
      cols: String(sheet.cols),
      rows: String(sheet.rows),
      marginMm: String(sheet.marginMm),
      gapMm: String(sheet.gapMm),
      offsetXmm: String(sheet.offsetXmm),
      offsetYmm: String(sheet.offsetYmm),
    });
    const url = `${baseUrl.replace(/\/$/, '')}/calibration/label?${query.toString()}`;

    window.open(url, '_blank');
  };

  const missingQr = !mapping.slots.qr;

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
          <div className="mapping-card-title">用紙・面付け</div>
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            <label>
              用紙プリセット
              <select
                className="mapping-control mapping-select"
                value={presetValue}
                onChange={(event) => {
                  const value = event.target.value;
                  if (value === 'A4') {
                    setPresetOverride(null);
                    updateSheet(PRESET_A4);
                    return;
                  }
                  if (value === 'Letter') {
                    setPresetOverride(null);
                    updateSheet(PRESET_LETTER);
                    return;
                  }
                  if (value === 'custom') {
                    setPresetOverride('custom');
                  }
                }}
              >
                <option value="A4">A4</option>
                <option value="Letter">Letter</option>
                <option value="custom">Custom</option>
              </select>
            </label>

            {presetValue === 'custom' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
                <label>
                  用紙幅(mm)
                  <input
                    type="number"
                    step="0.1"
                    className="mapping-control"
                    value={sheet.paperWidthMm}
                    onChange={(event) => updateSheet({ paperWidthMm: Number(event.target.value) })}
                  />
                </label>
                <label>
                  用紙高さ(mm)
                  <input
                    type="number"
                    step="0.1"
                    className="mapping-control"
                    value={sheet.paperHeightMm}
                    onChange={(event) => updateSheet({ paperHeightMm: Number(event.target.value) })}
                  />
                </label>
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
              <label>
                列数(cols)
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
                行数(rows)
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

            <button type="button" className="secondary" onClick={openCalibration}>
              校正PDFを開く
            </button>
            <p className="mapping-help">校正PDFでズレを確認し、X/Y補正を調整してください。</p>
          </div>
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
