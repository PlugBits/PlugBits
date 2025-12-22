// src/editor/Mapping/components/RegionMappingPanel.tsx
import React, { useMemo, useState } from 'react';
import type { TemplateDefinition } from '@shared/template';
import type { RegionDef } from '../adapters/StructureAdapter';
import FieldPicker, { type FieldRef } from './FieldPicker';
import ColumnEditor, { type Column } from './ColumnEditor';
import { extractSchemaFromSampleData, setPath, deepClone } from '../mappingUtils';

type Props = {
  template: TemplateDefinition;
  region: RegionDef;
  mapping: any;
  onChangeMapping: (nextMapping: any) => void;
  onFocusFieldRef: (ref: FieldRef | undefined) => void;
  onClearFocus: () => void;
};

const RegionMappingPanel: React.FC<Props> = ({
  template, 
  region, 
  mapping, 
  onChangeMapping, 
  onFocusFieldRef,
  onClearFocus,

  }) => {
  const schema = useMemo(() => extractSchemaFromSampleData(template.sampleData), [template.sampleData]);
  const [openSlotId, setOpenSlotId] = useState<string | null>(null);
  const [openTableRow, setOpenTableRow] = useState<'source' | 'columns' | null>(null);


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


  // region.kind === 'table'
  const currentSource = mapping?.[region.id]?.source as { kind: 'subtable'; fieldCode: string } | undefined;
  const currentSubtableCode = currentSource?.fieldCode ?? '';
  const subtableOptions = schema.subtables;

  const currentSubtable = subtableOptions.find((s) => s.code === currentSubtableCode);
  const subtableFieldOptions = currentSubtable?.fields ?? [];

  const columnsRaw = (mapping?.[region.id]?.columns ?? []) as Column[];
  const columns = Array.isArray(columnsRaw) ? columnsRaw : [];

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
                  <select
                    className="mapping-control mapping-select"
                    value={currentSubtableCode}
                    onChange={(e) => {
                      const nextCode = e.target.value;

                      const next = deepClone(mapping ?? {});
                      next[region.id] = next[region.id] ?? {};
                      next[region.id].source = nextCode ? { kind: 'subtable', fieldCode: nextCode } : undefined;

                      onChangeMapping(next);

                      // ✅ ハイライト：選択された subtable を光らせる
                      if (nextCode) onFocusFieldRef({ kind: 'subtable', fieldCode: nextCode } as any);
                      else onClearFocus();
                    }}
                  >
                    <option value="">（選択してください）</option>
                    {subtableOptions.map((st) => (
                      <option key={st.code} value={st.code}>
                        {st.label} ({st.code})
                      </option>
                    ))}
                  </select>
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
