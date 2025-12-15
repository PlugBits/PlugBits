// src/editor/Mapping/components/RegionMappingPanel.tsx
import React, { useMemo } from 'react';
import type { TemplateDefinition } from '@shared/template';
import type { RegionDef } from '../adapters/StructureAdapter';
import FieldPicker, { type FieldRef } from './FieldPicker';
import ColumnEditor, { type Column } from './ColumnEditor';
import { extractSchemaFromSampleData, setPath, deepClone, normalizeWidthPct } from '../mappingUtils';

type Props = {
  template: TemplateDefinition;
  region: RegionDef;
  mapping: any;
  onChangeMapping: (nextMapping: any) => void;
};

const RegionMappingPanel: React.FC<Props> = ({ template, region, mapping, onChangeMapping }) => {
  const schema = useMemo(() => extractSchemaFromSampleData(template.sampleData), [template.sampleData]);

  if (region.kind === 'slots') {
    return (
      <div className="card" style={{ marginBottom: '1rem' }}>
        <h4 style={{ marginTop: 0 }}>{region.label}</h4>

        <div style={{ display: 'grid', gap: 12 }}>
          {region.slots.map((slot) => {
            const slotValue: FieldRef | undefined = mapping?.[region.id]?.[slot.id];

            const allowStaticText = slot.allowedSources?.includes('staticText');
            const allowImageUrl = slot.allowedSources?.includes('imageUrl');

            return (
              <div key={slot.id} style={{ borderTop: '1px solid #e5e7eb', paddingTop: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                  <div style={{ fontWeight: 600 }}>
                    {slot.label}
                    {slot.required ? <span style={{ color: '#d92d20' }}> *</span> : null}
                  </div>
                  <button
                    className="ghost"
                    type="button"
                    onClick={() => {
                      const next = setPath(mapping, [region.id, slot.id], undefined);
                      onChangeMapping(next);
                    }}
                  >
                    解除
                  </button>
                </div>

                <div style={{ marginTop: 6 }}>
                  <FieldPicker
                    mode="record"
                    recordOptions={schema.recordFields}
                    value={slotValue}
                    onChange={(v) => {
                      const next = setPath(mapping, [region.id, slot.id], v);
                      onChangeMapping(next);
                    }}
                    allowStaticText={allowStaticText}
                    allowImageUrl={allowImageUrl}
                    placeholderStaticText={slot.kind === 'date' ? '2025-12-14' : '固定文字'}
                  />
                </div>
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
    <div className="card" style={{ marginBottom: '1rem' }}>
      <h4 style={{ marginTop: 0 }}>{region.label}</h4>

      <div style={{ display: 'grid', gap: 12 }}>
        <div>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>
            明細サブテーブル{region.sourceRequired ? <span style={{ color: '#d92d20' }}> *</span> : null}
          </div>

          <select
            value={currentSubtableCode}
            onChange={(e) => {
              const nextCode = e.target.value;
              const next = deepClone(mapping ?? {});
              next[region.id] = next[region.id] ?? {};
              next[region.id].source = nextCode ? { kind: 'subtable', fieldCode: nextCode } : undefined;

              // サブテーブルが変わったら columns は維持するが fieldOptions が変わるので、value はそのまま（後でユーザーが調整）
              onChangeMapping(next);
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

        <div>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>列設定</div>
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
              const normalized = normalizeWidthPct(nextCols);
              const next = deepClone(mapping ?? {});
              next[region.id] = next[region.id] ?? {};
              next[region.id].columns = normalized;
              onChangeMapping(next);
            }}
          />
        </div>
      </div>
    </div>
  );
};

export default RegionMappingPanel;
