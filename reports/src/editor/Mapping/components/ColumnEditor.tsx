// src/editor/Mapping/components/ColumnEditor.tsx
import React from 'react';
import FieldPicker, { type FieldRef } from './FieldPicker';
import { normalizeWidthPct } from '../mappingUtils';

type Option = { code: string; label: string };

export type Column = {
  id: string;
  label: string;
  value?: FieldRef;
  widthPct: number;
  align?: 'left' | 'center' | 'right';
  format?: 'text' | 'number' | 'currency' | 'date';
};

type BaseColumnDef = {
  id: string;
  label: string;
  defaultWidthPct: number;
  kind: 'text' | 'number' | 'currency' | 'date' | 'multiline';
};

type Props = {
  subtableCode: string;
  subtableFieldOptions: Option[];
  minCols: number;
  maxCols: number;
  baseColumns: BaseColumnDef[];
  columns: Column[];
  onChange: (next: Column[]) => void;
};

const ColumnEditor: React.FC<Props> = ({
  subtableCode,
  subtableFieldOptions,
  minCols,
  maxCols,
  baseColumns,
  columns,
  onChange,
}) => {
  const canAdd = columns.length < maxCols;
  const canRemove = columns.length > minCols;

  const handleNormalize = (next: Column[]) => {
    const normalized = normalizeWidthPct(next);
    onChange(normalized as Column[]);
  };

  const addBaseColumn = (baseId: string) => {
    const def = baseColumns.find((b) => b.id === baseId);
    if (!def || !canAdd) return;

    const next: Column[] = [
      ...columns,
      {
        id: def.id,
        label: def.label,
        widthPct: def.defaultWidthPct,
        align: def.kind === 'text' ? 'left' : 'right',
        format: def.kind === 'currency' ? 'currency' : def.kind === 'number' ? 'number' : def.kind === 'date' ? 'date' : 'text',
      },
    ];
    handleNormalize(next);
  };

  const addCustomColumn = () => {
    if (!canAdd) return;
    const customId = `user_col_${Date.now()}`;
    const next: Column[] = [
      ...columns,
      { id: customId, label: '追加列', widthPct: 10, align: 'left', format: 'text' },
    ];
    handleNormalize(next);
  };

  const updateColumn = (idx: number, patch: Partial<Column>) => {
    const next = columns.map((c, i) => (i === idx ? { ...c, ...patch } : c));
    onChange(next);
  };

  const removeColumn = (idx: number) => {
    if (!canRemove) return;
    const next = columns.filter((_, i) => i !== idx);
    handleNormalize(next);
  };

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ opacity: 0.8 }}>列追加:</span>
        {baseColumns.map((b) => (
          <button key={b.id} className="ghost" disabled={!canAdd} onClick={() => addBaseColumn(b.id)} type="button">
            + {b.label}
          </button>
        ))}
        <button className="ghost" disabled={!canAdd} onClick={addCustomColumn} type="button">
          + 追加列
        </button>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ textAlign: 'left' }}>
              <th style={{ padding: 6 }}>列名</th>
              <th style={{ padding: 6 }}>フィールド</th>
              <th style={{ padding: 6, width: 90 }}>幅%</th>
              <th style={{ padding: 6, width: 110 }}>align</th>
              <th style={{ padding: 6, width: 120 }}>format</th>
              <th style={{ padding: 6, width: 70 }}></th>
            </tr>
          </thead>
          <tbody>
            {columns.map((col, idx) => (
              <tr key={`${col.id}_${idx}`} style={{ borderTop: '1px solid #e5e7eb' }}>
                <td style={{ padding: 6, minWidth: 140 }}>
                  <input
                    value={col.label}
                    onChange={(e) => updateColumn(idx, { label: e.target.value })}
                    style={{ width: '100%' }}
                  />
                </td>
                <td style={{ padding: 6, minWidth: 260 }}>
                  <FieldPicker
                    mode="subtableField"
                    subtableCode={subtableCode}
                    subtableFieldOptions={subtableFieldOptions}
                    value={col.value}
                    onChange={(v) => updateColumn(idx, { value: v })}
                  />
                </td>
                <td style={{ padding: 6 }}>
                  <input
                    type="number"
                    value={col.widthPct}
                    min={1}
                    max={99}
                    onChange={(e) => updateColumn(idx, { widthPct: Number(e.target.value) })}
                    onBlur={() => handleNormalize(columns)}
                    style={{ width: 70 }}
                  />
                </td>
                <td style={{ padding: 6 }}>
                  <select value={col.align ?? 'left'} onChange={(e) => updateColumn(idx, { align: e.target.value as any })}>
                    <option value="left">left</option>
                    <option value="center">center</option>
                    <option value="right">right</option>
                  </select>
                </td>
                <td style={{ padding: 6 }}>
                  <select value={col.format ?? 'text'} onChange={(e) => updateColumn(idx, { format: e.target.value as any })}>
                    <option value="text">text</option>
                    <option value="number">number</option>
                    <option value="currency">currency</option>
                    <option value="date">date</option>
                  </select>
                </td>
                <td style={{ padding: 6 }}>
                  <button className="ghost" disabled={!canRemove} onClick={() => removeColumn(idx)} type="button">
                    削除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ opacity: 0.8 }}>
        列数: {columns.length}（{minCols}〜{maxCols}）
      </div>
    </div>
  );
};

export default ColumnEditor;
