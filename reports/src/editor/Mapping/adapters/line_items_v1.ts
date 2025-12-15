// src/editor/Mapping/adapters/line_items_v1.ts
import type { StructureAdapter, ValidationResult } from "./StructureAdapter";

const ok = (): ValidationResult => ({ ok: true, errors: [] });
const ng = (errors: ValidationResult["errors"]): ValidationResult => ({ ok: false, errors });

/**
 * line_items_v1 用の mapping の形（MVP）
 * - header: slotId -> FieldRef
 * - table: source(subtable) + columns[]
 * - footer: slotId -> FieldRef
 *
 * ※ FieldRefの厳密型は shared/types/mapping.ts に寄せてもOK。
 *   ここでは adapter と MappingPage を動かすために最低限の構造だけ置く。
 */
type FieldRef =
  | { kind: "recordField"; fieldCode: string }
  | { kind: "staticText"; text: string }
  | { kind: "imageUrl"; url: string }
  | { kind: "subtable"; fieldCode: string }
  | { kind: "subtableField"; subtableCode: string; fieldCode: string };

type TableColumn = {
  id: string;
  label: string;
  value: FieldRef; // 基本 subtableField
  widthPct: number;
  align?: "left" | "center" | "right";
  format?: "text" | "number" | "currency" | "date";
};

export type LineItemsV1Mapping = {
  header: Record<string, FieldRef | undefined>;
  table: {
    source?: { kind: "subtable"; fieldCode: string };
    columns: TableColumn[];
  };
  footer: Record<string, FieldRef | undefined>;
};

export const lineItemsV1Adapter: StructureAdapter = {
  structureType: "line_items_v1",

  regions: [
    {
      kind: "slots",
      id: "header",
      label: "Header",
      slots: [
        { id: "doc_title", label: "タイトル", kind: "text", allowedSources: ["staticText", "recordField"] },
        { id: "to_name", label: "宛先名", kind: "text", required: true, allowedSources: ["recordField"] },
        { id: "issue_date", label: "発行日", kind: "date", required: true, allowedSources: ["recordField"] },
        { id: "doc_no", label: "文書番号", kind: "text", allowedSources: ["recordField"] },
        { id: "logo", label: "ロゴ", kind: "image", allowedSources: ["imageUrl"] },
      ],
    },
    {
      kind: "table",
      id: "table",
      label: "明細テーブル",
      sourceRequired: true,
      minCols: 3,
      maxCols: 8,
      baseColumns: [
        { id: "item_name", label: "品名", kind: "text", required: true, defaultWidthPct: 52 },
        { id: "qty", label: "数量", kind: "number", defaultWidthPct: 12 },
        { id: "unit_price", label: "単価", kind: "currency", defaultWidthPct: 18 },
        { id: "amount", label: "金額", kind: "currency", defaultWidthPct: 18 },
      ],
    },
    {
      kind: "slots",
      id: "footer",
      label: "Footer",
      slots: [
        { id: "remarks", label: "備考", kind: "multiline", allowedSources: ["recordField", "staticText"] },
        { id: "subtotal", label: "小計", kind: "currency", allowedSources: ["recordField"] },
        { id: "tax", label: "税", kind: "currency", allowedSources: ["recordField"] },
        { id: "total", label: "合計", kind: "currency", allowedSources: ["recordField"] },
      ],
    },
  ],

  createDefaultMapping(): LineItemsV1Mapping {
    return {
      header: {
        doc_title: { kind: "staticText", text: "御見積書" },
      },
      table: {
        columns: [],
      },
      footer: {},
    };
  },

  validate(mapping: unknown): ValidationResult {
    const m = mapping as Partial<LineItemsV1Mapping> | undefined;
    if (!m) return ng([{ path: "mapping", message: "mapping がありません" }]);

    const errors: ValidationResult["errors"] = [];

    const toName = m.header?.["to_name"];
    const issueDate = m.header?.["issue_date"];

    if (!toName || toName.kind !== "recordField") {
      errors.push({ path: "header.to_name", message: "宛先名（レコードフィールド）が必須です" });
    }
    if (!issueDate || issueDate.kind !== "recordField") {
      errors.push({ path: "header.issue_date", message: "発行日（レコードフィールド）が必須です" });
    }

    const source = m.table?.source;
    if (!source || source.kind !== "subtable" || !source.fieldCode) {
      errors.push({ path: "table.source", message: "明細サブテーブルの指定が必須です" });
    }

    const cols = m.table?.columns ?? [];
    if (cols.length < 3) {
      errors.push({ path: "table.columns", message: "列は最低3列必要です" });
    }

    return errors.length ? ng(errors) : ok();
  },
};
