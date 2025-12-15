// src/editor/Mapping/components/FieldPicker.tsx
import React, { useMemo, useState } from 'react';

export type FieldRef =
  | { kind: 'recordField'; fieldCode: string }
  | { kind: 'subtable'; fieldCode: string }
  | { kind: 'subtableField'; subtableCode: string; fieldCode: string }
  | { kind: 'staticText'; text: string }
  | { kind: 'imageUrl'; url: string };

type Option = { code: string; label: string };

type Props = {
  mode: 'record' | 'subtableField';
  recordOptions?: Option[];
  subtableCode?: string;
  subtableFieldOptions?: Option[];
  value?: FieldRef;
  onChange: (next?: FieldRef) => void;

  // allowed sources (MVP)
  allowStaticText?: boolean;
  allowImageUrl?: boolean;
  placeholderStaticText?: string;
};

const FieldPicker: React.FC<Props> = ({
  mode,
  recordOptions = [],
  subtableCode,
  subtableFieldOptions = [],
  value,
  onChange,
  allowStaticText,
  allowImageUrl,
  placeholderStaticText = '固定テキスト',
}) => {
  const [q, setQ] = useState('');

  const options = useMemo(() => {
    const base = mode === 'record' ? recordOptions : subtableFieldOptions;
    const qq = q.trim().toLowerCase();
    if (!qq) return base;
    return base.filter((o) => `${o.label} ${o.code}`.toLowerCase().includes(qq));
  }, [mode, recordOptions, subtableFieldOptions, q]);

  // source type selection (record/subtableField/static/image)
  const currentKind = value?.kind ?? '';

  const sourceKinds: Array<{ kind: string; label: string }> = [];
  if (mode === 'record') sourceKinds.push({ kind: 'recordField', label: 'レコード' });
  if (mode === 'subtableField') sourceKinds.push({ kind: 'subtableField', label: 'サブテーブル' });
  if (allowStaticText) sourceKinds.push({ kind: 'staticText', label: '固定文字' });
  if (allowImageUrl) sourceKinds.push({ kind: 'imageUrl', label: '画像URL' });

  const selectedKind = sourceKinds.some((k) => k.kind === currentKind) ? currentKind : sourceKinds[0]?.kind;

  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <select
          value={selectedKind}
          onChange={(e) => {
            const k = e.target.value;
            if (k === 'recordField') onChange(undefined);
            else if (k === 'subtableField') onChange(undefined);
            else if (k === 'staticText') onChange({ kind: 'staticText', text: '' });
            else if (k === 'imageUrl') onChange({ kind: 'imageUrl', url: '' });
          }}
        >
          {sourceKinds.map((k) => (
            <option key={k.kind} value={k.kind}>
              {k.label}
            </option>
          ))}
        </select>

        {(selectedKind === 'recordField' || selectedKind === 'subtableField') && (
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="検索（部分一致）"
            style={{ flex: 1, minWidth: 120 }}
          />
        )}
      </div>

      {selectedKind === 'recordField' && (
        <select
          value={value?.kind === 'recordField' ? value.fieldCode : ''}
          onChange={(e) => {
            const code = e.target.value;
            if (!code) onChange(undefined);
            else onChange({ kind: 'recordField', fieldCode: code });
          }}
        >
          <option value="">（選択してください）</option>
          {options.map((o) => (
            <option key={o.code} value={o.code}>
              {o.label} ({o.code})
            </option>
          ))}
        </select>
      )}

      {selectedKind === 'subtableField' && (
        <select
          value={value?.kind === 'subtableField' ? value.fieldCode : ''}
          onChange={(e) => {
            const code = e.target.value;
            if (!code || !subtableCode) onChange(undefined);
            else onChange({ kind: 'subtableField', subtableCode, fieldCode: code });
          }}
        >
          <option value="">（選択してください）</option>
          {options.map((o) => (
            <option key={o.code} value={o.code}>
              {o.label} ({o.code})
            </option>
          ))}
        </select>
      )}

      {selectedKind === 'staticText' && (
        <input
          value={value?.kind === 'staticText' ? value.text : ''}
          onChange={(e) => onChange({ kind: 'staticText', text: e.target.value })}
          placeholder={placeholderStaticText}
        />
      )}

      {selectedKind === 'imageUrl' && (
        <input
          value={value?.kind === 'imageUrl' ? value.url : ''}
          onChange={(e) => onChange({ kind: 'imageUrl', url: e.target.value })}
          placeholder="https://..."
        />
      )}
    </div>
  );
};

export default FieldPicker;
