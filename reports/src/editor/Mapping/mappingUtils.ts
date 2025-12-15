// src/editor/Mapping/mappingUtils.ts
import type { TemplateDataRecord } from '@shared/template';

export type RecordFieldOption = { code: string; label: string };
export type SubtableOption = { code: string; label: string; fields: RecordFieldOption[] };

export type SchemaFromSample = {
  recordFields: RecordFieldOption[];
  subtables: SubtableOption[];
};

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
export function normalizeWidthPct(columns: Array<{ widthPct: number }>): Array<{ widthPct: number }> {
  if (columns.length === 0) return columns;

  const sum = columns.reduce((acc, c) => acc + (Number.isFinite(c.widthPct) ? c.widthPct : 0), 0);
  if (sum <= 0) {
    const base = Math.floor(100 / columns.length);
    const rem = 100 - base * columns.length;
    return columns.map((c, i) => ({ ...c, widthPct: i === columns.length - 1 ? base + rem : base }));
  }

  // まずスケール
  const scaled = columns.map((c) => ({
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
