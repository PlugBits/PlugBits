// src/editor/Mapping/mappingUtils.ts
import type { TemplateDataRecord } from '@shared/template';

export type RecordFieldOption = { code: string; label: string; type?: string };
export type SubtableOption = {
  code: string;
  label: string;
  fields: RecordFieldOption[];
  type?: string;
};

export type SchemaFromSample = {
  recordFields: RecordFieldOption[];
  subtables: SubtableOption[];
};

export type KintoneFormField = {
  code?: string;
  label?: string;
  type?: string;
  fields?: Record<string, KintoneFormField>;
};

export type FlatKintoneField = {
  code?: string;
  label?: string;
  type?: string;
  isSubtable?: boolean;
  subtableCode?: string;
};

const isNonNull = <T>(value: T | null | undefined): value is T => value != null;

export function buildSchemaFromKintoneProperties(
  properties?: Record<string, KintoneFormField>,
): SchemaFromSample {
  if (!properties || typeof properties !== 'object') {
    return { recordFields: [], subtables: [] };
  }

  const recordFields: RecordFieldOption[] = [];
  const subtables: SubtableOption[] = [];

  for (const prop of Object.values(properties)) {
    const code = prop.code ?? '';
    if (!code) continue;
    const label = prop.label ?? code;
    if (prop.type === 'SUBTABLE' && prop.fields) {
      const fields = Object.values(prop.fields)
        .map((f) => {
          const subCode = f.code ?? '';
          if (!subCode) return null;
          return { code: subCode, label: f.label ?? subCode, type: f.type };
        })
        .filter(isNonNull);
      subtables.push({ code, label, fields, type: prop.type });
      continue;
    }
    recordFields.push({ code, label, type: prop.type });
  }

  return { recordFields, subtables };
}

export function buildSchemaFromFlatFields(
  fields?: FlatKintoneField[] | null,
): SchemaFromSample {
  if (!fields || fields.length === 0) {
    return { recordFields: [], subtables: [] };
  }

  const recordFields: RecordFieldOption[] = [];
  const subtables = new Map<string, SubtableOption>();

  fields.forEach((field) => {
    const code = field.code ?? '';
    if (!code) return;
    const label = field.label ?? code;
    const type = field.type;

    if (type === 'SUBTABLE') {
      if (!subtables.has(code)) {
        subtables.set(code, { code, label, fields: [], type });
      }
      return;
    }

    if (field.isSubtable) {
      const parentCode = field.subtableCode ?? '';
      if (!parentCode) return;
      const parent =
        subtables.get(parentCode) ??
        (() => {
          const created = { code: parentCode, label: parentCode, fields: [] as RecordFieldOption[] };
          subtables.set(parentCode, created);
          return created;
        })();
      parent.fields.push({ code, label, type });
      return;
    }

    recordFields.push({ code, label, type });
  });

  return { recordFields, subtables: Array.from(subtables.values()) };
}

/**
 * SAMPLE_DATA から候補を作る（暫定）
 * - recordFields: 値が配列じゃないキー
 * - subtables: 値が Array<object> のキー。fields は先頭行のキー
 */
export function extractSchemaFromSampleData(sampleData?: TemplateDataRecord): SchemaFromSample {
  if (!sampleData || typeof sampleData !== 'object') {
    return { recordFields: [], subtables: [] };
  }

  const recordFields: RecordFieldOption[] = [];
  const subtables: SubtableOption[] = [];

  for (const [key, value] of Object.entries(sampleData)) {
    if (Array.isArray(value)) {
      const first = value[0];
      if (first && typeof first === 'object' && !Array.isArray(first)) {
        const fields = Object.keys(first).map((k) => ({ code: k, label: k }));
        subtables.push({ code: key, label: key, fields });
      }
      continue;
    }
    recordFields.push({ code: key, label: key });
  }

  return { recordFields, subtables };
}

export function deepClone<T>(v: T): T {
  return structuredClone(v);
}

/**
 * widthPct 合計を 100 に正規化（丸め誤差は最後に寄せる）
 */
/**
 * widthPct 合計を 100 に正規化（丸め誤差は最後に寄せる）
 * ※型を落とさないためジェネリクスで返す
 */
export function normalizeWidthPct<T extends { widthPct: number }>(columns: readonly T[]): T[] {
  if (columns.length === 0) return [...columns];

  // T を保ったまま clone
  const next: T[] = columns.map((c) => ({ ...c }));

  const sum = next.reduce((acc, c) => acc + (Number.isFinite(c.widthPct) ? c.widthPct : 0), 0);

  if (sum <= 0) {
    const base = Math.floor(100 / next.length);
    const rem = 100 - base * next.length;
    return next.map((c, i) => ({
      ...c,
      widthPct: i === next.length - 1 ? base + rem : base,
    }));
  }

  // まずスケール
  const scaled: T[] = next.map((c) => ({
    ...c,
    widthPct: Math.max(1, Math.round((c.widthPct / sum) * 100)),
  }));

  // 合計調整（最後に寄せる）
  const s2 = scaled.reduce((acc, c) => acc + c.widthPct, 0);
  const diff = 100 - s2;
  scaled[scaled.length - 1].widthPct = Math.max(1, scaled[scaled.length - 1].widthPct + diff);

  return scaled;
}


/**
 * mapping への安全なパス更新（MVP：anyで扱う）
 */
export function setPath(obj: any, path: string[], value: any): any {
  const next = deepClone(obj ?? {});
  let cur = next;
  for (let i = 0; i < path.length - 1; i += 1) {
    const k = path[i];
    cur[k] = cur[k] ?? {};
    cur = cur[k];
  }
  cur[path[path.length - 1]] = value;
  return next;
}

/**
 * 指定indexの widthPct はユーザー入力を優先して固定し、
 * それ以外の列に差分を配って合計100にする
 */
export function normalizeWidthPctKeepIndex<T extends { widthPct: number }>(
  columns: readonly T[],
  keepIndex: number,
): T[] {
  if (columns.length === 0) return [...columns];

  // T を保ったまま clone
  const next: T[] = columns.map((c) => ({ ...c }));

  if (keepIndex < 0 || keepIndex >= next.length) {
    return normalizeWidthPct(next);
  }

  // keepIndex の列はユーザー入力を優先
  next[keepIndex].widthPct = Math.max(
    1,
    Math.round(Number(next[keepIndex].widthPct) || 1),
  );

  const otherIdx = next.map((_, i) => i).filter((i) => i !== keepIndex);

  if (otherIdx.length === 0) {
    next[keepIndex].widthPct = 100;
    return next;
  }

  const rest = 100 - next[keepIndex].widthPct;

  // 他列の合計
  const sumOther =
    otherIdx.reduce((acc, i) => acc + (Number(next[i].widthPct) || 0), 0) ||
    otherIdx.length;

  let allocated = 0;
  otherIdx.forEach((i) => {
    const base = Number(next[i].widthPct) || 1;
    const v = Math.max(1, Math.round((base / sumOther) * rest));
    next[i].widthPct = v;
    allocated += v;
  });

  // 丸め誤差は最後の列へ
  const diff =
    100 -
    (next[keepIndex].widthPct +
      otherIdx.reduce((acc, i) => acc + next[i].widthPct, 0));

  const last = otherIdx[otherIdx.length - 1];
  next[last].widthPct = Math.max(1, next[last].widthPct + diff);

  return next;
}
