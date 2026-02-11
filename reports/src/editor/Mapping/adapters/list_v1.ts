// src/editor/Mapping/adapters/list_v1.ts
import type { StructureAdapter, ValidationResult } from "./StructureAdapter";
import type { TemplateDefinition, TemplateElement, TableElement, TableColumn as PdfTableColumn, TableSummary } from "@shared/template";
import { clampYToRegion } from "../../../utils/regionBounds";

const ok = (): ValidationResult => ({ ok: true, errors: [] });
const ng = (errors: ValidationResult["errors"]): ValidationResult => ({ ok: false, errors });

/**
 * list_v1 用の mapping の形（MVP）
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

type SummaryTarget = {
  kind: "subtableField";
  subtableCode: string;
  fieldCode: string;
};

type TableSummaryConfig = {
  mode?: "none" | "lastPageOnly" | "everyPageSubtotal+lastTotal";
  target?: SummaryTarget;
  footerEnabled?: boolean;
};

export type ListV1Mapping = {
  header: Record<string, FieldRef | undefined>;
  table: {
    source?: { kind: "subtable"; fieldCode: string };
    columns: TableColumn[];
    summaryMode?: "none" | "lastPageOnly" | "everyPageSubtotal+lastTotal";
    summary?: TableSummaryConfig;
  };
  footer: Record<string, FieldRef | undefined>;
};

let warnedMissingAmountColumn = false;

export const listV1Adapter: StructureAdapter = {
  structureType: "list_v1",

  regions: [
    {
      kind: "slots",
      id: "header",
      label: "Header",
      slots: [
        { id: "doc_title", label: "タイトル", kind: "text", allowedSources: ["staticText", "recordField"] },
        { id: "to_name", label: "宛先名", kind: "text", required: true, allowedSources: ["recordField"] },
        { id: "date_label", label: "日付ラベル", kind: "text", allowedSources: ["staticText", "recordField"] },
        { id: "issue_date", label: "日付", kind: "date", required: true, allowedSources: ["recordField"] },
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
        { id: "total_label", label: "合計ラベル", kind: "text", allowedSources: ["recordField", "staticText"] },
        { id: "subtotal", label: "小計", kind: "currency", allowedSources: ["recordField"] },
        { id: "tax", label: "税", kind: "currency", allowedSources: ["recordField"] },
        { id: "total", label: "合計", kind: "currency", allowedSources: ["recordField"] },
      ],
    },
    
  ],

  createDefaultMapping(): ListV1Mapping {
    return {
      header: {
        doc_title: { kind: "staticText", text: "御見積書" },
        date_label: { kind: "staticText", text: "見積日" },
        to_honorific: { kind: "staticText", text: "様" },
      },
      table: {
        columns: [],
        summaryMode: "lastPageOnly",
      },
      footer: {},
    };
  },

  validate(mapping: unknown): ValidationResult {
    const m = mapping as Partial<ListV1Mapping> | undefined;
    if (!m) return ng([{ path: "mapping", message: "mapping がありません" }]);

    const errors: ValidationResult["errors"] = [];

    const toName = m.header?.["to_name"];
    const issueDate = m.header?.["issue_date"];

    if (!toName || toName.kind !== "recordField") {
      errors.push({ path: "header.to_name", message: "宛先名（レコードフィールド）を選択してください" });
    }
    if (!issueDate || issueDate.kind !== "recordField") {
      errors.push({ path: "header.issue_date", message: "発行日（レコードフィールド）を選択してください" });
    }

    const source = m.table?.source;
    if (!source || source.kind !== "subtable" || !source.fieldCode) {
      errors.push({ path: "table.source", message: "明細サブテーブルを選択してください" });
    }

    const cols = m.table?.columns ?? [];
    if (cols.length < 3) {
      errors.push({ path: "table.columns", message: "列は最低3列必要です" });
    }
    

    return errors.length ? ng(errors) : ok();
  },

  applyMappingToTemplate(template: TemplateDefinition, mapping: unknown): TemplateDefinition {
    const m = mapping as Partial<ListV1Mapping> | undefined;
    const next: TemplateDefinition = structuredClone(template);

    next.structureType = "list_v1";
    next.mapping = mapping;

    const applyFieldRefToElement = (element: TemplateElement, ref: FieldRef | undefined): TemplateElement => {
      if (!ref) {
        if (element.type === "label") {
          return element.text === "" ? element : { ...element, text: "" };
        }
        if (element.type === "text") {
          const nextSource = { type: "static", value: "" } as const;
          if (element.dataSource?.type === "static" && element.dataSource.value === "") {
            return element;
          }
          return { ...element, dataSource: nextSource };
        }
        if (element.type === "image") {
          const nextSource = { type: "static", value: "" } as const;
          if (element.dataSource?.type === "static" && element.dataSource.value === "") {
            return element;
          }
          return { ...element, dataSource: nextSource };
        }
        return element;
      }

      if (ref.kind === "recordField") {
        if (element.type !== "text") return element;
        if (element.dataSource?.type === "kintone" && element.dataSource.fieldCode === ref.fieldCode) {
          return element;
        }
        return { ...element, dataSource: { type: "kintone", fieldCode: ref.fieldCode } };
      }

      if (ref.kind === "staticText") {
        if (element.type === "label") {
          return element.text === ref.text ? element : { ...element, text: ref.text ?? "" };
        }
        if (element.type === "text") {
          const nextSource = { type: "static", value: ref.text ?? "" } as const;
          if (element.dataSource?.type === "static" && element.dataSource.value === nextSource.value) {
            return element;
          }
          return { ...element, dataSource: nextSource };
        }
        return element;
      }

      if (ref.kind === "imageUrl") {
        if (element.type !== "image") return element;
        const nextSource = { type: "static", value: ref.url ?? "" } as const;
        if (element.dataSource?.type === "static" && element.dataSource.value === nextSource.value) {
          return element;
        }
        return { ...element, dataSource: nextSource };
      }

      return element;
    };

    const elements = next.elements ?? [];
    const headerSlots = m?.header ?? {};
    const footerSlots = m?.footer ?? {};
    let slotSyncedElements = elements.map((element) => {
      if (!element.slotId) return element;
      if (element.region === "header") {
        return applyFieldRefToElement(element, headerSlots[element.slotId]);
      }
      if (element.region === "footer") {
        return applyFieldRefToElement(element, footerSlots[element.slotId]);
      }
      return element;
    });

    // suffix方式に寄せるため、headerの「御中」ラベルを除去（重複防止）
    slotSyncedElements = slotSyncedElements.filter((e) => {
      if (e.region !== "header") return true;
      if (e.type !== "label") return true;
      const text = (e as any).text ?? "";
      return text !== "御中";
    });
    // footerの固定「合計」ラベルを除去（slot化対応）
    slotSyncedElements = slotSyncedElements.filter((e) => {
      if (e.region !== "footer") return true;
      if (e.type !== "label") return true;
      if ((e as any).slotId) return true;
      const text = (e as any).text ?? "";
      return text !== "合計";
    });
    // date_label スロット化のため、headerの固定「見積日」ラベルを除去（重複防止）
    slotSyncedElements = slotSyncedElements.filter((e) => {
      if (e.region !== "header") return true;
      if (e.type !== "label") return true;
      if ((e as any).slotId) return true;
      const text = (e as any).text ?? "";
      const id = String((e as any).id ?? "");
      if (text === "見積日") return false;
      if (id.includes("estimate_date_label")) return false;
      return true;
    });

    const ensureSlotElement = (
      slotId: string,
      region: "header" | "footer",
      type: "text" | "image",
      fallback: {
        x: number;
        y: number; // bottom座標（safetyYとしても使う）
        width?: number;
        height?: number;
        fontSize?: number;
        fontWeight?: "normal" | "bold";
      },
      ref: FieldRef | undefined,
    ) => {
      const mkDataSource = (): any => {
        if (!ref) return { type: "static", value: "" };
        if (ref.kind === "staticText") return { type: "static", value: ref.text ?? "" };
        if (ref.kind === "recordField") return { type: "kintone", fieldCode: ref.fieldCode };
        if (ref.kind === "imageUrl") return { type: "static", value: ref.url ?? "" };
        return { type: "static", value: "" };
      };

      // 優先: slotId一致 → 次: id一致
      const idxBySlot = slotSyncedElements.findIndex((e) => (e as any).slotId === slotId);
      const idxById = slotSyncedElements.findIndex((e) => e.id === slotId);
      const idx = idxBySlot >= 0 ? idxBySlot : idxById;

      const safetyY = fallback.y;

      if (idx >= 0) {
        const base = slotSyncedElements[idx] as any;

        // yが上に寄りすぎなら下げる（bottom座標なので「大きいほど上」）
        const nextY = typeof base.y === "number" && base.y > safetyY ? safetyY : base.y;

        slotSyncedElements[idx] = {
          ...base,
          slotId,
          region,
          type,
          x: base.x ?? fallback.x,
          y: nextY ?? safetyY,
          width: base.width ?? fallback.width,
          height: base.height ?? fallback.height,
          fontSize: base.fontSize ?? fallback.fontSize,
          fontWeight: base.fontWeight ?? fallback.fontWeight,
          ...(type === "text" ? { dataSource: mkDataSource() } : {}),
          ...(type === "image" ? { dataSource: mkDataSource() } : {}),
        } as any;
        return;
      }

      if (type === "text") {
        slotSyncedElements.push({
          id: slotId,
          slotId,
          type: "text",
          region,
          x: fallback.x,
          y: fallback.y,
          width: fallback.width ?? 220,
          height: fallback.height ?? 24,
          fontSize: fallback.fontSize ?? 12,
          fontWeight: fallback.fontWeight ?? "normal",
          dataSource: mkDataSource(),
        } as any);
        return;
      }

      // image
      slotSyncedElements.push({
        id: slotId,
        slotId,
        type: "image",
        region,
        x: fallback.x,
        y: fallback.y,
        width: fallback.width ?? 120,
        height: fallback.height ?? 60,
        dataSource: mkDataSource(),
      } as any);
    };

    const headerRef = m?.header ?? {};
    const footerRef = m?.footer ?? {};
    const honorificRef = headerRef["to_honorific"];
    const honorificText =
      honorificRef?.kind === "staticText" ? honorificRef.text ?? "" : "";
    const shouldShowHonorific =
      !!honorificRef &&
      (honorificRef.kind !== "staticText" || honorificText.trim() !== "");
    if (!shouldShowHonorific) {
      slotSyncedElements = slotSyncedElements.filter((e) => {
        const slotId = (e as any).slotId ?? "";
        return e.id !== "to_honorific" && slotId !== "to_honorific";
      });
    }

    const yFooter = (fromBottomPx: number) =>
      clampYToRegion(fromBottomPx, "footer");

    // header slots (fallback = safety position)
    ensureSlotElement(
      "doc_title",
      "header",
      "text",
      { x: 50, y: 765, fontSize: 24, fontWeight: "bold", width: 320, height: 32 },
      headerRef["doc_title"],
    );
    ensureSlotElement(
      "to_name",
      "header",
      "text",
      { x: 50, y: 715, fontSize: 12, fontWeight: "bold", width: 300, height: 24 },
      headerRef["to_name"],
    );
    if (shouldShowHonorific) {
      const toNameEl = slotSyncedElements.find((e) => (e as any).slotId === "to_name" || e.id === "to_name") as any;
      const baseX = typeof toNameEl?.x === "number" ? toNameEl.x : 50;
      const baseY = typeof toNameEl?.y === "number" ? toNameEl.y : 715;
      const baseWidth = typeof toNameEl?.width === "number" ? toNameEl.width : 300;
      const baseHeight = typeof toNameEl?.height === "number" ? toNameEl.height : 24;
      ensureSlotElement(
        "to_honorific",
        "header",
        "text",
        { x: baseX + baseWidth + 6, y: baseY, fontSize: 9, width: 24, height: baseHeight },
        honorificRef,
      );
    }
    ensureSlotElement(
      "logo",
      "header",
      "image",
      { x: 450, y: 742, width: 120, height: 60 },
      headerRef["logo"],
    );
    ensureSlotElement(
      "date_label",
      "header",
      "text",
      { x: 350, y: 715, fontSize: 12, width: 50, height: 24 },
      headerRef["date_label"],
    );
    ensureSlotElement(
      "issue_date",
      "header",
      "text",
      { x: 410, y: 715, fontSize: 12, width: 160, height: 24 },
      headerRef["issue_date"],
    );
    ensureSlotElement(
      "doc_no",
      "header",
      "text",
      { x: 350, y: 742, fontSize: 10, width: 220, height: 20 },
      headerRef["doc_no"],
    );

    ensureSlotElement(
      "remarks",
      "footer",
      "text",
      { x: 50, y: yFooter(60), fontSize: 10, width: 520, height: 60 },
      footerRef["remarks"],
    );
    ensureSlotElement(
      "total_label",
      "footer",
      "text",
      { x: 300, y: yFooter(130), fontSize: 10, width: 80, height: 20 },
      footerRef["total_label"],
    );
    ensureSlotElement(
      "total",
      "footer",
      "text",
      { x: 360, y: yFooter(126), fontSize: 14, fontWeight: "bold", width: 210, height: 24 },
      footerRef["total"],
    );

    // table同期に必要な情報が無いなら、elements は触らない（安全運用）
    const sourceFieldCode = m?.table?.source?.kind === "subtable" ? m.table.source.fieldCode : undefined;
    const cols = m?.table?.columns ?? [];
    if (!sourceFieldCode || cols.length === 0) {
      next.elements = slotSyncedElements;
      return next;
    }

    // ---- ここから table element の同期 ----
    const TABLE_ID = "items";
    const BASE_X = 50;
    const TOTAL_WIDTH = 520;

    // items が無い場合のデフォルト位置（header直下を狙う）
    const BASE_Y = 600;

    // 既存 items を探して位置等を引き継ぐ
    const existingIdx = slotSyncedElements.findIndex((e) => e.id === TABLE_ID);
    const existing = existingIdx >= 0 ? (slotSyncedElements[existingIdx] as any) : null;

    // widthPct → px（最後の列に誤差寄せ）
    const widths = cols.map((c) => Math.max(1, Math.round((Number(c.widthPct ?? 0) / 100) * TOTAL_WIDTH)));
    const sumW = widths.reduce((a, b) => a + b, 0);
    const diff = TOTAL_WIDTH - sumW;
    if (widths.length > 0) {
      widths[widths.length - 1] = Math.max(1, widths[widths.length - 1] + diff);
    }

    const nextColumns: PdfTableColumn[] = cols.map((c, i) => {
      // subtableField を想定（それ以外は空で持つ：validateで弾く運用でもOK）
      const fieldCode =
        c.value?.kind === "subtableField" ? c.value.fieldCode : "";

      return {
        id: c.id,
        title: c.label ?? c.id,
        fieldCode,
        width: widths[i] ?? 80,
        align: c.align ?? "left",
      };
    });

    const summaryConfig = m?.table?.summary;
    const rawSummaryMode = m?.table?.summaryMode ?? summaryConfig?.mode ?? "lastPageOnly";
    const summaryMode =
      rawSummaryMode === "everyPageSubtotal+lastTotal" ||
      rawSummaryMode === "lastPageOnly" ||
      rawSummaryMode === "none"
        ? rawSummaryMode
        : "lastPageOnly";

    const amountColumnById = cols.find(
      (c) => c.id === "amount" && c.value?.kind === "subtableField" && c.value.fieldCode,
    );
    const amountColumnByField = cols.find(
      (c) => c.value?.kind === "subtableField" && c.value.fieldCode === "Amount",
    );
    const amountColumn = amountColumnById ?? amountColumnByField;
    const summaryFieldCode =
      amountColumn?.value?.kind === "subtableField" ? amountColumn.value.fieldCode : undefined;
    const summaryColumnId = amountColumn?.id;

    if (summaryMode !== "none" && (!summaryFieldCode || !summaryColumnId)) {
      if (!warnedMissingAmountColumn) {
        console.warn("[list_v1] summary amount column not found", {
          summaryFieldCode,
          summaryColumnId,
        });
        warnedMissingAmountColumn = true;
      }
    }

    const summary =
      summaryMode !== "none" && summaryFieldCode && summaryColumnId
        ? (() => {
            const mode: TableSummary["mode"] =
              summaryMode === "everyPageSubtotal+lastTotal"
                ? "everyPageSubtotal+lastTotal"
                : "lastPageOnly";
            const kind: TableSummary["rows"][number]["kind"] =
              summaryMode === "everyPageSubtotal+lastTotal" ? "both" : "total";
            return {
              mode,
              rows: [
                {
                  op: "sum" as const,
                  fieldCode: summaryFieldCode,
                  columnId: summaryColumnId,
                  kind,
                  label: "合計",
                  labelSubtotal: "小計",
                  labelTotal: "合計",
                },
              ],
              style: {
                subtotalFillGray: 0.96,
                totalFillGray: 0.92,
                totalTopBorderWidth: 1.5,
                borderColorGray: 0.85,
              },
            };
          })()
        : undefined;

    const tableEl: TableElement = {
      id: TABLE_ID,
      type: "table",
      region: "body",
      x: typeof existing?.x === "number" ? existing.x : BASE_X,
      y: typeof existing?.y === "number" ? existing.y : BASE_Y,
      width: typeof existing?.width === "number" ? existing.width : TOTAL_WIDTH,
      rowHeight: typeof existing?.rowHeight === "number" ? existing.rowHeight : 20,
      headerHeight: typeof existing?.headerHeight === "number" ? existing.headerHeight : 24,
      showGrid: typeof existing?.showGrid === "boolean" ? existing.showGrid : true,
      dataSource: { type: "kintoneSubtable", fieldCode: sourceFieldCode },
      columns: nextColumns,
      summary,
    };

    let nextElements: TemplateElement[];
    if (existingIdx >= 0) {
      // 既存の items を置換（他の要素は維持）
      nextElements = slotSyncedElements.map((e, i) => (i === existingIdx ? (tableEl as unknown as TemplateElement) : e));
    } else {
      nextElements = [...slotSyncedElements, tableEl as unknown as TemplateElement];
    }

    // ✅ list_v1 では table は items の1つだけに正規化する
    nextElements = nextElements.filter((e) => {
      if (e.type !== "table") return true;
      return e.id === TABLE_ID; // items 以外の table は削除
    });

    next.elements = nextElements;
    return next;
  },

};
