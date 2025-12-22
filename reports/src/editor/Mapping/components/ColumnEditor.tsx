// src/editor/Mapping/components/ColumnEditor.tsx
import React, { useEffect, useState } from 'react';
import { normalizeWidthPct, normalizeWidthPctKeepIndex } from '../mappingUtils';
import FieldPicker, { type FieldRef } from './FieldPicker';

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
  onFocusFieldRef: (ref: FieldRef | undefined) => void;
  onClearFocus: () => void;
};

const ColumnEditor: React.FC<Props> = ({
  subtableCode,
  subtableFieldOptions,
  minCols,
  maxCols,
  baseColumns,
  columns,
  onChange,
  onFocusFieldRef,
  onClearFocus,
}) => {
  const canAdd = columns.length < maxCols;
  const canRemove = columns.length > minCols;
  const [widthDraft, setWidthDraft] = useState<string[]>([]);

  useEffect(() => {
    setWidthDraft(columns.map((c) => String(c.widthPct ?? '')));
  }, [columns]);


    const handleNormalizeAll = (next: Column[]) => {
        onChange(normalizeWidthPct(next));
    };

    const commitWidthPct = (idx: number, rawValue: string) => {
        const n = Number(rawValue);
        if (!Number.isFinite(n)) return;

        const nextCols = columns.map((c, i) =>
        i === idx ? { ...c, widthPct: Math.max(1, Math.round(n)) } : c,
        );

        const normalized = normalizeWidthPctKeepIndex(nextCols, idx);
        onChange(normalized);
        setWidthDraft(normalized.map((c) => String(c.widthPct ?? '')));
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
    handleNormalizeAll(next);
  };

  const addCustomColumn = () => {
    if (!canAdd) return;
    const customId = `user_col_${Date.now()}`;
    const next: Column[] = [
      ...columns,
      { id: customId, label: '追加列', widthPct: 10, align: 'left', format: 'text' },
    ];
    handleNormalizeAll(next);
  };

  const updateColumn = (idx: number, patch: Partial<Column>) => {
    const next = columns.map((c, i) => (i === idx ? { ...c, ...patch } : c));
    onChange(next);
  };

  const removeColumn = (idx: number) => {
    if (!canRemove) return;
    const next = columns.filter((_, i) => i !== idx);
    handleNormalizeAll(next);
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

      <div style={{ display: 'grid', gap: 10 }}>
        {columns.map((col, idx) => (
          <div
            key={`${col.id}_${idx}`}
            className="mapping-row-detail"
            style={{
              border: '1px solid #e5e7eb',
              borderRadius: '0.9rem',
              padding: 10,
            }}
            onMouseEnter={() => {
              // 列自体が subtableField ならそれを渡す（無ければ subtable を渡す）
              onFocusFieldRef(col.value ?? (subtableCode ? { kind: 'subtable', fieldCode: subtableCode } : undefined));
            }}
            onMouseLeave={onClearFocus}
          >
            {/* 上段 */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '160px 1fr auto auto',
                gap: 10,
                alignItems: 'center',
              }}
            >
              <input
                className="mapping-control"
                value={col.label}
                onChange={(e) => updateColumn(idx, { label: e.target.value })}
              />

              <FieldPicker
                mode="subtableField"
                subtableCode={subtableCode}
                subtableFieldOptions={subtableFieldOptions}
                value={col.value}
                onChange={(v: FieldRef | undefined) => {
                  updateColumn(idx, { value: v });
                  onFocusFieldRef(v);
                }}
              />

              <button
                className="ghost"
                type="button"
                onClick={() => updateColumn(idx, { value: undefined })}
              >
                解除
              </button>

              <button
                className="ghost"
                disabled={!canRemove}
                onClick={() => removeColumn(idx)}
                type="button"
                style={{ color: '#b42318', borderColor: '#fda29b' }}
              >
                削除
              </button>
            </div>

            {/* 下段 */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '120px 140px 160px 1fr',
                gap: 10,
                marginTop: 10,
                alignItems: 'center',
              }}
            >
              <label style={{ display: 'grid', gap: 6 }}>
                <span className="mapping-help">幅%</span>
                <input
                  className="mapping-control"
                  type="number"
                  inputMode="numeric"
                  value={widthDraft[idx] ?? ''}
                  min={1}
                  max={99}
                  onChange={(e) => {
                    const next = [...widthDraft];
                    next[idx] = e.target.value;     // ← draftだけ更新
                    setWidthDraft(next);
                  }}
                  onBlur={() => commitWidthPct(idx, widthDraft[idx] ?? '')} // ← ここで確定＆正規化
                />

              </label>

              <label style={{ display: 'grid', gap: 6 }}>
                <span className="mapping-help">align</span>
                <select
                  className="mapping-control mapping-select"
                  value={col.align ?? 'left'}
                  onChange={(e) => updateColumn(idx, { align: e.target.value as any })}
                >
                  <option value="left">left</option>
                  <option value="center">center</option>
                  <option value="right">right</option>
                </select>
              </label>

              <label style={{ display: 'grid', gap: 6 }}>
                <span className="mapping-help">format</span>
                <select
                  className="mapping-control mapping-select"
                  value={col.format ?? 'text'}
                  onChange={(e) => updateColumn(idx, { format: e.target.value as any })}
                >
                  <option value="text">text</option>
                  <option value="number">number</option>
                  <option value="currency">currency</option>
                  <option value="date">date</option>
                </select>
              </label>

              <div />
            </div>
          </div>
        ))}
      </div>


      <div style={{ opacity: 0.8 }}>
        列数: {columns.length}（{minCols}〜{maxCols}）
      </div>
    </div>
  );
};

export default ColumnEditor;
