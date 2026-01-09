import React, { useMemo } from 'react';

export type KintoneFieldOption = {
  code: string;
  label: string;
  type?: string;
};

type Props = {
  value: string;
  onChange: (fieldCode: string) => void;
  fields: KintoneFieldOption[];
  placeholder?: string;
  disabled?: boolean;
  allowTypes?: string[];
  fallbackToInput?: boolean;
};

const KintoneFieldSelect: React.FC<Props> = ({
  value,
  onChange,
  fields,
  placeholder,
  disabled,
  allowTypes,
  fallbackToInput = true,
}) => {
  const filtered = useMemo(() => {
    const list = Array.isArray(fields) ? fields : [];
    const allowed =
      allowTypes && allowTypes.length > 0
        ? list.filter((field) => !field.type || allowTypes.includes(field.type))
        : list;

    return [...allowed].sort((a, b) => {
      const labelCompare = a.label.localeCompare(b.label);
      if (labelCompare !== 0) return labelCompare;
      return a.code.localeCompare(b.code);
    });
  }, [fields, allowTypes]);

  if (filtered.length === 0 && fallbackToInput) {
    return (
      <input
        className="mapping-control mapping-select"
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder ?? 'フィールドコード'}
        disabled={disabled}
      />
    );
  }

  return (
    <select
      className="mapping-control mapping-select"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
    >
      <option value="">{placeholder ?? '（選択）'}</option>
      {filtered.map((field) => (
        <option key={field.code} value={field.code}>
          {field.label} ({field.code})
        </option>
      ))}
    </select>
  );
};

export default KintoneFieldSelect;
