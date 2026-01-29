// src/editor/Mapping/components/RegionMappingPanel.tsx
import React, { useEffect, useMemo, useState } from 'react';
import type { TemplateDefinition } from '@shared/template';
import type { RegionDef } from '../adapters/StructureAdapter';
import FieldPicker, { type FieldRef } from './FieldPicker';
import ColumnEditor, { type Column } from './ColumnEditor';
import KintoneFieldSelect from '../../../components/KintoneFieldSelect';
import { extractSchemaFromSampleData, setPath, deepClone, type SchemaFromSample } from '../mappingUtils';

type Props = {
  template: TemplateDefinition;
  schemaOverride?: SchemaFromSample | null;
  region: RegionDef;
  mapping: any;
  onChangeMapping: (nextMapping: any) => void;
  onFocusFieldRef: (ref: FieldRef | undefined) => void;
  onClearFocus: () => void;
};

const TEXT_ALLOW_TYPES = [
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

const DATE_ALLOW_TYPES = ['DATE', 'DATETIME', 'TIME'];
const NUMBER_ALLOW_TYPES = ['NUMBER', 'CALC'];
const RECORD_ALLOW_TYPES = [
  ...TEXT_ALLOW_TYPES,
  ...NUMBER_ALLOW_TYPES,
  ...DATE_ALLOW_TYPES,
];

const SUBTABLE_ALLOW_TYPES = [...RECORD_ALLOW_TYPES];

const getRecordAllowTypesForSlot = (kind?: string) => {
  if (kind === 'date') return DATE_ALLOW_TYPES;
  if (kind === 'number' || kind === 'currency') return NUMBER_ALLOW_TYPES;
  if (kind === 'image') return [];
  return RECORD_ALLOW_TYPES;
};

const RegionMappingPanel: React.FC<Props> = ({
  template,
  schemaOverride,
  region,
  mapping,
  onChangeMapping,
  onFocusFieldRef,
  onClearFocus,

  }) => {
  const schema = useMemo(
    () => schemaOverride ?? extractSchemaFromSampleData(template.sampleData),
    [schemaOverride, template.sampleData],
  );
  const isListV1 = (template.structureType ?? 'list_v1') === 'list_v1';
  const [openSlotId, setOpenSlotId] = useState<string | null>(null);
  const [openTableRow, setOpenTableRow] = useState<'source' | 'columns' | 'summary' | null>(null);
  const [openCardFieldId, setOpenCardFieldId] = useState<string | null>(null);

  const tableMapping = region.kind === 'table' ? mapping?.[region.id] ?? {} : {};
  const listSummaryModeRaw = tableMapping.summaryMode;

  useEffect(() => {
    if (!isListV1 || region.kind !== 'table') return;
    if (listSummaryModeRaw && listSummaryModeRaw !== 'none') return;

    const next = deepClone(mapping ?? {});
    next[region.id] = next[region.id] ?? {};
    next[region.id].summaryMode = 'lastPageOnly';
    onChangeMapping(next);
  }, [isListV1, listSummaryModeRaw, mapping, onChangeMapping, region.id, region.kind]);

  if (region.kind === 'slots') {
    return (
      <div className="mapping-card">
        <div className="mapping-card-title">{region.label}</div>

        <div className="mapping-list">
          {region.slots.map((slot) => {
            const slotValue: FieldRef | undefined = mapping?.[region.id]?.[slot.id];
            const isOpen = openSlotId === slot.id;

            const allowStaticText = slot.allowedSources?.includes('staticText');
            const allowImageUrl = slot.allowedSources?.includes('imageUrl');

            const valueLabel = describeFieldRef(slotValue);
            const isEmpty = !slotValue;

            return (
              <div key={slot.id} 
                className={`mapping-row ${isOpen ? 'open' : ''}`}
                onMouseEnter={() => {
                  onFocusFieldRef({ kind: 'slot', slotId: slot.id } as any);
                }}
                onMouseLeave={() => onClearFocus()}
              >
                <button
                  type="button"
                  className="mapping-row-summary"
                  onClick={() => setOpenSlotId(isOpen ? null : slot.id)}
                >
                  <div className="mapping-row-left">
                    <span className="mapping-row-label">
                      {slot.label}
                      {slot.required ? <span className="mapping-required"> *</span> : null}
                    </span>
                  </div>

                  <div className={`mapping-row-right ${isEmpty ? 'empty' : 'filled'}`}>
                    {valueLabel || '未設定'}
                  </div>
                </button>

                {isOpen && (
                  <div className="mapping-row-detail">
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                      <div style={{ fontSize: '0.85rem', color: '#667085' }}>
                        {slot.kind === 'date' ? '日付' : slot.kind === 'image' ? '画像' : 'テキスト'}
                      </div>

                      <button
                        className="ghost"
                        type="button"
                        onClick={() => {
                          const next = setPath(mapping, [region.id, slot.id], undefined);
                          onChangeMapping(next);
                        }}
                        disabled={!slotValue}
                      >
                        解除
                      </button>
                    </div>

                    <div style={{ marginTop: 8 }}>
                      <FieldPicker
                        mode="record"
                        recordOptions={schema.recordFields}
                        recordAllowTypes={getRecordAllowTypesForSlot(slot.kind)}
                        value={slotValue}
                        onChange={(v) => {
                          const next = setPath(mapping, [region.id, slot.id], v);
                          onChangeMapping(next);
                          onFocusFieldRef({ kind: 'slot', slotId: slot.id } as any);
                        }}
                        allowStaticText={allowStaticText}
                        allowImageUrl={allowImageUrl}
                        placeholderStaticText={slot.kind === 'date' ? '2025-12-14' : '固定文字'}
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  if (region.kind === 'cardList') {
    const cardMapping = mapping?.[region.id] ?? {};
    const currentSource = cardMapping?.source as { kind: 'subtable'; fieldCode: string } | undefined;
    const currentSubtableCode = currentSource?.fieldCode ?? '';
    const subtableOptions = schema.subtables;
    const currentSubtable = subtableOptions.find((s) => s.code === currentSubtableCode);
    const subtableFieldOptions = currentSubtable?.fields ?? [];

    return (
      <div className="mapping-card">
        <div className="mapping-card-title">{region.label}</div>

        <div className="mapping-list">
          {(() => {
            const isOpen = openTableRow === 'source';
            const isEmpty = !currentSubtableCode;

            return (
              <div
                className={`mapping-row ${isOpen ? 'open' : ''}`}
                onMouseEnter={() => {
                  if (currentSubtableCode) {
                    onFocusFieldRef({ kind: 'subtable', fieldCode: currentSubtableCode } as any);
                  }
                }}
                onMouseLeave={() => onClearFocus()}
              >
                <button
                  type="button"
                  className="mapping-row-summary"
                  onClick={() => setOpenTableRow(isOpen ? null : 'source')}
                >
                  <div className="mapping-row-left">
                    <span className="mapping-row-label">
                      カード用サブテーブル
                      {region.sourceRequired ? <span className="mapping-required"> *</span> : null}
                    </span>
                  </div>

                  <div className={`mapping-row-right ${isEmpty ? 'empty' : 'filled'}`}>
                    {isEmpty ? '未設定' : `サブテーブル: ${currentSubtableCode}`}
                  </div>
                </button>

                {isOpen && (
                  <div className="mapping-row-detail">
                    <KintoneFieldSelect
                      value={currentSubtableCode}
                      onChange={(nextCode) => {
                        const next = deepClone(mapping ?? {});
                        next[region.id] = next[region.id] ?? {};
                        next[region.id].source = nextCode ? { kind: 'subtable', fieldCode: nextCode } : undefined;
                        onChangeMapping(next);

                        if (nextCode) onFocusFieldRef({ kind: 'subtable', fieldCode: nextCode } as any);
                        else onClearFocus();
                      }}
                      fields={subtableOptions}
                      allowTypes={['SUBTABLE']}
                      placeholder="（選択してください）"
                    />
                  </div>
                )}
              </div>
            );
          })()}

          {region.fields.map((field) => {
            const fieldValueRaw = cardMapping?.fields?.[field.id] ?? undefined;
            const fieldValue: FieldRef | undefined =
              fieldValueRaw && typeof fieldValueRaw === 'object' ? fieldValueRaw : undefined;
            const isOpen = openCardFieldId === field.id;
            const isEmpty = !fieldValue;
            const canClear = field.id !== 'fieldA' && fieldValueRaw != null;

            return (
              <div
                key={field.id}
                className={`mapping-row ${isOpen ? 'open' : ''}`}
                onMouseEnter={() => {
                  if (fieldValue?.kind === 'subtableField') {
                    onFocusFieldRef(fieldValue as any);
                  } else if (currentSubtableCode) {
                    onFocusFieldRef({ kind: 'subtable', fieldCode: currentSubtableCode } as any);
                  }
                }}
                onMouseLeave={() => onClearFocus()}
              >
                <button
                  type="button"
                  className="mapping-row-summary"
                  onClick={() => setOpenCardFieldId(isOpen ? null : field.id)}
                >
                  <div className="mapping-row-left">
                    <span className="mapping-row-label">
                      {field.label}
                      {field.required ? <span className="mapping-required"> *</span> : null}
                    </span>
                  </div>

                  <div className={`mapping-row-right ${isEmpty ? 'empty' : 'filled'}`}>
                    {describeFieldRef(fieldValue) || '未設定'}
                  </div>
                </button>

                {isOpen && (
                  <div className="mapping-row-detail">
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                      <div style={{ fontSize: '0.85rem', color: '#667085' }}>
                        サブテーブル項目
                      </div>
                      <button
                        className="ghost"
                        type="button"
                        disabled={!canClear}
                        onClick={() => {
                          if (!canClear) return;
                          const next = setPath(mapping, [region.id, 'fields', field.id], null);
                          onChangeMapping(next);
                          onClearFocus();
                        }}
                      >
                        解除
                      </button>
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <FieldPicker
                        mode="subtableField"
                        subtableCode={currentSubtableCode}
                        subtableFieldOptions={subtableFieldOptions}
                        subtableAllowTypes={SUBTABLE_ALLOW_TYPES}
                        value={fieldValue}
                        onChange={(v) => {
                          const next = setPath(mapping, [region.id, 'fields', field.id], v);
                          onChangeMapping(next);
                          if (v?.kind === 'subtableField') onFocusFieldRef(v as any);
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }


  // region.kind === 'table'
  const currentSource = mapping?.[region.id]?.source as { kind: 'subtable'; fieldCode: string } | undefined;
  const currentSubtableCode = currentSource?.fieldCode ?? '';
  const subtableOptions = schema.subtables;

  const currentSubtable = subtableOptions.find((s) => s.code === currentSubtableCode);
  const subtableFieldOptions = currentSubtable?.fields ?? [];

  const columnsRaw = (mapping?.[region.id]?.columns ?? []) as Column[];
  const columns = Array.isArray(columnsRaw) ? columnsRaw : [];
  const summaryConfig = tableMapping.summary ?? {};
  const summaryMode =
    summaryConfig.mode ?? tableMapping.summaryMode ?? 'none';
  const listSummaryMode =
    listSummaryModeRaw === 'everyPageSubtotal+lastTotal'
      ? 'everyPageSubtotal+lastTotal'
      : 'lastPageOnly';
  const summaryTarget =
    summaryConfig.target?.kind === 'subtableField'
      ? summaryConfig.target
      : undefined;
  const summaryTargetCode = summaryTarget?.fieldCode ?? '';
  const summaryFooterEnabled = summaryConfig.footerEnabled ?? false;
  const canConfigureSummaryTarget = summaryMode !== 'none' && !!currentSubtableCode;

  const updateSummary = (patch: Record<string, unknown>) => {
    const next = deepClone(mapping ?? {});
    next[region.id] = next[region.id] ?? {};
    const current = next[region.id].summary ?? {};
    const merged = { ...current, ...patch };
    next[region.id].summary = merged;
    next[region.id].summaryMode = merged.mode ?? next[region.id].summaryMode;
    onChangeMapping(next);
  };

  const updateListSummaryMode = (mode: 'lastPageOnly' | 'everyPageSubtotal+lastTotal') => {
    const next = deepClone(mapping ?? {});
    next[region.id] = next[region.id] ?? {};
    next[region.id].summaryMode = mode;
    onChangeMapping(next);
  };

    return (
    <div className="mapping-card">
      <div className="mapping-card-title">{region.label}</div>

      <div className="mapping-list">
        {/* Row 1: サブテーブル */}
        {(() => {
          const isOpen = openTableRow === 'source';
          const isEmpty = !currentSubtableCode;

          return (
            <div
              className={`mapping-row ${isOpen ? 'open' : ''}`}
              onMouseEnter={() => {
                if (currentSubtableCode) onFocusFieldRef({ kind: 'subtable', fieldCode: currentSubtableCode } as any);
              }}
              onMouseLeave={() => onClearFocus()}
            >
              <button
                type="button"
                className="mapping-row-summary"
                onClick={() => setOpenTableRow(isOpen ? null : 'source')}
              >
                <div className="mapping-row-left">
                  <span className="mapping-row-label">
                    明細サブテーブル
                    {region.sourceRequired ? <span className="mapping-required"> *</span> : null}
                  </span>
                </div>

                <div className={`mapping-row-right ${isEmpty ? 'empty' : 'filled'}`}>
                  {isEmpty ? '未設定' : `サブテーブル: ${currentSubtableCode}`}
                </div>
              </button>

              {isOpen && (
                <div className="mapping-row-detail">
                  <KintoneFieldSelect
                    value={currentSubtableCode}
                    onChange={(nextCode) => {
                      const next = deepClone(mapping ?? {});
                      next[region.id] = next[region.id] ?? {};
                      next[region.id].source = nextCode ? { kind: 'subtable', fieldCode: nextCode } : undefined;

                      onChangeMapping(next);

                      if (nextCode) onFocusFieldRef({ kind: 'subtable', fieldCode: nextCode } as any);
                      else onClearFocus();
                    }}
                    fields={subtableOptions}
                    allowTypes={['SUBTABLE']}
                    placeholder="（選択してください）"
                  />
                </div>
              )}
            </div>
          );
        })()}

        {/* Row 2: 列設定 */}
        {(() => {
          const isOpen = openTableRow === 'columns';

          return (
            <div className={`mapping-row ${isOpen ? 'open' : ''}`}>
              <button
                type="button"
                className="mapping-row-summary"
                onClick={() => setOpenTableRow(isOpen ? null : 'columns')}
              >
                <div className="mapping-row-left">
                  <span className="mapping-row-label">列設定</span>
                </div>

                <div className="mapping-row-right filled">
                  {`列数: ${columns.length}（${region.minCols}〜${region.maxCols}）`}
                </div>
              </button>

              {isOpen && (
                <div className="mapping-row-detail">
                  <ColumnEditor
                    subtableCode={currentSubtableCode}
                    subtableFieldOptions={subtableFieldOptions}
                    allowSubtableTypes={SUBTABLE_ALLOW_TYPES}
                    minCols={region.minCols}
                    maxCols={region.maxCols}
                    baseColumns={region.baseColumns.map((b) => ({
                      id: b.id,
                      label: b.label,
                      defaultWidthPct: b.defaultWidthPct,
                      kind: b.kind as any,
                    }))}
                    columns={columns}
                    onChange={(nextCols) => {
                      const next = deepClone(mapping ?? {});
                      next[region.id] = next[region.id] ?? {};
                      next[region.id].columns = nextCols;
                      onChangeMapping(next);

                      // ✅ ここでは source を投げない（ColumnEditor側の hover/focus に任せる）
                    }}
                    onFocusFieldRef={onFocusFieldRef}
                    onClearFocus={onClearFocus}
                  />
                </div>
              )}
            </div>
          );
        })()}

        {/* Row 3: 合計設定 */}
        {(() => {
          const isOpen = openTableRow === 'summary';
          const summaryLabel =
            listSummaryMode === 'everyPageSubtotal+lastTotal'
              ? '各ページ小計 + 最終合計'
              : '合計のみ（最終ページ）';

          if (isListV1) {
            return (
              <div className={`mapping-row ${isOpen ? 'open' : ''}`}>
                <button
                  type="button"
                  className="mapping-row-summary"
                  onClick={() => setOpenTableRow(isOpen ? null : 'summary')}
                >
                  <div className="mapping-row-left">
                    <span className="mapping-row-label">合計設定</span>
                  </div>

                  <div className="mapping-row-right filled">
                    {summaryLabel}
                  </div>
                </button>

                {isOpen && (
                  <div className="mapping-row-detail" style={{ display: 'grid', gap: 10 }}>
                    <label style={{ display: 'grid', gap: 6 }}>
                      <span className="mapping-help">小計/合計の出し方</span>
                      <select
                        className="mapping-control mapping-select"
                        value={listSummaryMode}
                        onChange={(e) => {
                          const mode = e.target.value as typeof listSummaryMode;
                          updateListSummaryMode(mode);
                        }}
                      >
                        <option value="lastPageOnly">合計のみ（最終ページ）</option>
                        <option value="everyPageSubtotal+lastTotal">各ページ小計 + 最終合計</option>
                      </select>
                    </label>
                  </div>
                )}
              </div>
            );
          }

          const isEmpty = summaryMode === 'none';

          return (
            <div className={`mapping-row ${isOpen ? 'open' : ''}`}>
              <button
                type="button"
                className="mapping-row-summary"
                onClick={() => setOpenTableRow(isOpen ? null : 'summary')}
              >
                <div className="mapping-row-left">
                  <span className="mapping-row-label">合計設定</span>
                </div>

                <div className={`mapping-row-right ${isEmpty ? 'empty' : 'filled'}`}>
                  {isEmpty ? '未設定' : summaryMode}
                </div>
              </button>

              {isOpen && (
                <div className="mapping-row-detail" style={{ display: 'grid', gap: 10 }}>
                  <label style={{ display: 'grid', gap: 6 }}>
                    <span className="mapping-help">表示モード</span>
                    <select
                      className="mapping-control mapping-select"
                      value={summaryMode}
                      onChange={(e) => {
                        const mode = e.target.value as typeof summaryMode;
                        updateSummary({
                          mode,
                          target: mode === 'none' ? undefined : summaryConfig.target,
                        });
                      }}
                    >
                      <option value="none">表示しない</option>
                      <option value="lastPageOnly">最終ページのみ</option>
                      <option value="everyPageSubtotal+lastTotal">毎ページ小計 + 最終合計</option>
                    </select>
                  </label>

                  <label style={{ display: 'grid', gap: 6 }}>
                    <span className="mapping-help">合計対象列</span>
                    <KintoneFieldSelect
                      value={summaryTargetCode}
                      onChange={(code) => {
                        if (!code || !currentSubtableCode) {
                          updateSummary({ target: undefined });
                          return;
                        }
                        updateSummary({
                          target: {
                            kind: 'subtableField',
                            subtableCode: currentSubtableCode,
                            fieldCode: code,
                          },
                        });
                      }}
                      fields={subtableFieldOptions}
                      allowTypes={SUBTABLE_ALLOW_TYPES}
                      placeholder={
                        currentSubtableCode
                          ? '（選択してください）'
                          : 'サブテーブルを先に選択してください'
                      }
                      disabled={!canConfigureSummaryTarget}
                    />
                  </label>

                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <input
                      type="checkbox"
                      checked={summaryFooterEnabled}
                      onChange={(e) => updateSummary({ footerEnabled: e.target.checked })}
                    />
                    フッターにも合計を表示する
                  </label>
                </div>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );

};
function describeFieldRef(v?: FieldRef): string {
  if (!v) return '';

  if (v.kind === 'recordField') return v.fieldCode;
  if (v.kind === 'staticText') return v.text ? `固定: ${v.text}` : '固定文字';
  if (v.kind === 'imageUrl') return v.url ? '画像URL' : '画像';
  if (v.kind === 'subtable') return v.fieldCode ? `サブテーブル: ${v.fieldCode}` : 'サブテーブル';
  if (v.kind === 'subtableField') return v.fieldCode ? v.fieldCode : 'サブテーブル項目';

  return '';
}

export default RegionMappingPanel;
