import type {
  TemplateDefinition,
  TemplateElement,
  TableElement,
  TableColumn as PdfTableColumn,
} from "../../../shared/template.js";

type FieldRef =
  | { kind: "recordField"; fieldCode: string }
  | { kind: "staticText"; text: string }
  | { kind: "imageUrl"; url: string }
  | { kind: "subtable"; fieldCode: string }
  | { kind: "subtableField"; subtableCode: string; fieldCode: string };

type TableColumn = {
  id: string;
  label: string;
  value: FieldRef;
  widthPct: number;
  align?: "left" | "center" | "right";
  format?: "text" | "number" | "currency" | "date";
};

export type ListV1Mapping = {
  header: Record<string, FieldRef | undefined>;
  table: {
    source?: { kind: "subtable"; fieldCode: string };
    columns: TableColumn[];
    summaryMode?: "none" | "lastPageOnly" | "everyPageSubtotal+lastTotal";
    summary?: {
      mode?: "none" | "lastPageOnly" | "everyPageSubtotal+lastTotal";
      target?: { kind: "subtableField"; subtableCode: string; fieldCode: string };
      footerEnabled?: boolean;
    };
  };
  footer: Record<string, FieldRef | undefined>;
};

const CANVAS_HEIGHT = 842;
const REGION_BOUNDS = {
  header: { yMin: 660, yMax: CANVAS_HEIGHT },
  body: { yMin: 180, yMax: 660 },
  footer: { yMin: 0, yMax: 180 },
} as const;

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);
const clampYToRegion = (y: number, region: "header" | "body" | "footer") => {
  const b = REGION_BOUNDS[region];
  return clamp(y, b.yMin, b.yMax);
};

let warnedMissingAmountColumn = false;

export const applyListV1MappingToTemplate = (
  template: TemplateDefinition,
  mapping: unknown,
): TemplateDefinition => {
  const m = mapping as Partial<ListV1Mapping> | undefined;
  const next: TemplateDefinition = structuredClone(template);

  next.structureType = "list_v1";
  next.mapping = mapping;

  const applyFieldRefToElement = (
    element: TemplateElement,
    ref: FieldRef | undefined,
  ): TemplateElement => {
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

  slotSyncedElements = slotSyncedElements.filter((e) => {
    if (e.region !== "header") return true;
    if (e.type !== "label") return true;
    const text = (e as any).text ?? "";
    return text !== "御中";
  });
  slotSyncedElements = slotSyncedElements.filter((e) => {
    if (e.region !== "footer") return true;
    if (e.type !== "label") return true;
    if ((e as any).slotId) return true;
    const text = (e as any).text ?? "";
    return text !== "合計";
  });
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
      y: number;
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

    const idxBySlot = slotSyncedElements.findIndex((e) => (e as any).slotId === slotId);
    const idxById = slotSyncedElements.findIndex((e) => e.id === slotId);
    const idx = idxBySlot >= 0 ? idxBySlot : idxById;

    const safetyY = fallback.y;

    if (idx >= 0) {
      const base = slotSyncedElements[idx] as any;
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

  const yFooter = (fromBottomPx: number) =>
    clampYToRegion(fromBottomPx, "footer");

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
    { x: 50, y: yFooter(130), fontSize: 10, width: 520, height: 60 },
    footerRef["remarks"],
  );
  ensureSlotElement(
    "total_label",
    "footer",
    "text",
    { x: 300, y: yFooter(70), fontSize: 10, width: 80, height: 20 },
    footerRef["total_label"],
  );
  ensureSlotElement(
    "total",
    "footer",
    "text",
    { x: 360, y: yFooter(70), fontSize: 14, fontWeight: "bold", width: 210, height: 24 },
    footerRef["total"],
  );

  const sourceFieldCode =
    m?.table?.source?.kind === "subtable" ? m.table.source.fieldCode : undefined;
  const cols = m?.table?.columns ?? [];
  if (!sourceFieldCode || cols.length === 0) {
    next.elements = slotSyncedElements;
    return next;
  }

  const TABLE_ID = "items";
  const BASE_X = 50;
  const TOTAL_WIDTH = 520;
  const BASE_Y = 620;

  const existingIdx = slotSyncedElements.findIndex((e) => e.id === TABLE_ID);
  const existing = existingIdx >= 0 ? (slotSyncedElements[existingIdx] as any) : null;

  const widths = cols.map((c) =>
    Math.max(1, Math.round((Number(c.widthPct ?? 0) / 100) * TOTAL_WIDTH)),
  );
  const sumW = widths.reduce((a, b) => a + b, 0);
  const diff = TOTAL_WIDTH - sumW;
  if (widths.length > 0) {
    widths[widths.length - 1] = Math.max(1, widths[widths.length - 1] + diff);
  }

  const nextColumns: PdfTableColumn[] = cols.map((c, i) => {
    const fieldCode = c.value?.kind === "subtableField" ? c.value.fieldCode : "";
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
      ? {
          mode:
            summaryMode === "everyPageSubtotal+lastTotal"
              ? ("everyPageSubtotal+lastTotal" as const)
              : ("lastPageOnly" as const),
          rows: [
            {
              op: "sum" as const,
              fieldCode: summaryFieldCode,
              columnId: summaryColumnId,
              kind: summaryMode === "everyPageSubtotal+lastTotal" ? ("both" as const) : ("total" as const),
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
        }
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
    nextElements = slotSyncedElements.map((e, i) =>
      i === existingIdx ? (tableEl as unknown as TemplateElement) : e,
    );
  } else {
    nextElements = [...slotSyncedElements, tableEl as unknown as TemplateElement];
  }

  nextElements = nextElements.filter((e) => {
    if (e.type !== "table") return true;
    return e.id === TABLE_ID;
  });

  next.elements = nextElements;
  return next;
};
