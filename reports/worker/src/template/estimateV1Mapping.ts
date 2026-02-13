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

export type EstimateV1Mapping = {
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
const HEADER_SLOT_IDS = new Set([
  "doc_title",
  "to_name",
  "to_honorific",
  "issue_date",
  "doc_no",
  "logo",
]);
const FOOTER_SLOT_IDS = new Set([
  "remarks",
  "subtotal",
  "tax",
  "total",
]);

export const applyEstimateV1MappingToTemplate = (
  template: TemplateDefinition,
  mapping: unknown,
): TemplateDefinition => {
  const m = mapping as Partial<EstimateV1Mapping> | undefined;
  const next: TemplateDefinition = structuredClone(template);

  next.structureType = "estimate_v1";
  next.mapping = mapping;

  const applyFieldRefToElement = (
    element: TemplateElement,
    ref: FieldRef | undefined,
  ): TemplateElement => {
    if (!ref) {
      if (element.type === "label") {
        if (element.text === "" && element.hidden === true) return element;
        return { ...element, text: "", hidden: true };
      }
      if (element.type === "text") {
        const nextSource = { type: "static", value: "" } as const;
        if (element.dataSource?.type === "static" && element.dataSource.value === "" && element.hidden === true) {
          return element;
        }
        return { ...element, dataSource: nextSource, hidden: true };
      }
      if (element.type === "image") {
        const nextSource = { type: "static", value: "" } as const;
        if (element.dataSource?.type === "static" && element.dataSource.value === "" && element.hidden === true) {
          return element;
        }
        return { ...element, dataSource: nextSource, hidden: true };
      }
      return { ...element, hidden: true };
    }

    if (ref.kind === "recordField") {
      if (element.type !== "text") return element;
      if (element.dataSource?.type === "kintone" && element.dataSource.fieldCode === ref.fieldCode) {
        return element.hidden ? { ...element, hidden: false } : element;
      }
      return { ...element, dataSource: { type: "kintone", fieldCode: ref.fieldCode }, hidden: false };
    }

    if (ref.kind === "staticText") {
      if (element.type === "label") {
        if (element.text === ref.text && !element.hidden) return element;
        return { ...element, text: ref.text ?? "", hidden: false };
      }
      if (element.type === "text") {
        const nextSource = { type: "static", value: ref.text ?? "" } as const;
        if (element.dataSource?.type === "static" && element.dataSource.value === nextSource.value && !element.hidden) {
          return element;
        }
        return { ...element, dataSource: nextSource, hidden: false };
      }
      return element;
    }

    if (ref.kind === "imageUrl") {
      if (element.type !== "image") return element;
      const nextSource = { type: "static", value: ref.url ?? "" } as const;
      if (element.dataSource?.type === "static" && element.dataSource.value === nextSource.value && !element.hidden) {
        return element;
      }
      return { ...element, dataSource: nextSource, hidden: false };
    }

    return element;
  };

  const elements = next.elements ?? [];
  const headerSlots = m?.header ?? {};
  const footerSlots = m?.footer ?? {};
  let slotSyncedElements = elements.map((element) => {
    if (!element.slotId) return element;
    if (element.region === "header") {
      if (!HEADER_SLOT_IDS.has(element.slotId)) return element;
      return applyFieldRefToElement(element, headerSlots[element.slotId]);
    }
    if (element.region === "footer") {
      if (!FOOTER_SLOT_IDS.has(element.slotId)) return element;
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
      alignX?: "left" | "center" | "right";
      borderWidth?: number;
      borderColorGray?: number;
      fillGray?: number;
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
    const nextHidden = !ref;

    if (idx >= 0) {
      const base = slotSyncedElements[idx] as any;

      const nextY = typeof base.y === "number" && base.y > safetyY ? safetyY : base.y;

      slotSyncedElements[idx] = {
        ...base,
        slotId,
        region,
        type,
        hidden: nextHidden,
        x: base.x ?? fallback.x,
        y: nextY ?? safetyY,
        width: base.width ?? fallback.width,
        height: base.height ?? fallback.height,
        fontSize: base.fontSize ?? fallback.fontSize,
        fontWeight: base.fontWeight ?? fallback.fontWeight,
        alignX: base.alignX ?? fallback.alignX,
        borderWidth: base.borderWidth ?? fallback.borderWidth,
        borderColorGray: base.borderColorGray ?? fallback.borderColorGray,
        fillGray: base.fillGray ?? fallback.fillGray,
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
        alignX: fallback.alignX,
        hidden: nextHidden,
        borderWidth: fallback.borderWidth,
        borderColorGray: fallback.borderColorGray,
        fillGray: fallback.fillGray,
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
      hidden: nextHidden,
      borderWidth: fallback.borderWidth,
      borderColorGray: fallback.borderColorGray,
      fillGray: fallback.fillGray,
      dataSource: mkDataSource(),
    } as any);
  };

  const ensureLabelElement = (
    id: string,
    region: "header" | "footer",
    text: string,
    fallback: {
      x: number;
      y: number;
      width?: number;
      height?: number;
      fontSize?: number;
      fontWeight?: "normal" | "bold";
      borderWidth?: number;
      borderColorGray?: number;
      fillGray?: number;
    },
  ) => {
    const idx = slotSyncedElements.findIndex((e) => e.id === id);
    const base = idx >= 0 ? (slotSyncedElements[idx] as any) : undefined;
    const nextElement: TemplateElement = {
      id,
      type: "label",
      region,
      x: base?.x ?? fallback.x,
      y: base?.y ?? fallback.y,
      width: base?.width ?? fallback.width,
      height: base?.height ?? fallback.height,
      fontSize: base?.fontSize ?? fallback.fontSize,
      fontWeight: base?.fontWeight ?? fallback.fontWeight,
      text,
      borderWidth: base?.borderWidth ?? fallback.borderWidth,
      borderColorGray: base?.borderColorGray ?? fallback.borderColorGray,
      fillGray: base?.fillGray ?? fallback.fillGray,
    } as any;
    if (idx >= 0) {
      slotSyncedElements[idx] = nextElement;
      return;
    }
    slotSyncedElements.push(nextElement);
  };

  const ensureTextLabelElement = (
    id: string,
    region: "header" | "footer",
    text: string,
    fallback: {
      x: number;
      y: number;
      width?: number;
      height?: number;
      fontSize?: number;
      fontWeight?: "normal" | "bold";
      alignX?: "left" | "center" | "right";
    },
  ) => {
    const idx = slotSyncedElements.findIndex((e) => e.id === id);
    const nextElement: TemplateElement = {
      id,
      type: "text",
      region,
      x: fallback.x,
      y: fallback.y,
      width: fallback.width,
      height: fallback.height,
      fontSize: fallback.fontSize,
      fontWeight: fallback.fontWeight,
      alignX: fallback.alignX,
      dataSource: { type: "static", value: text },
    } as any;
    if (idx >= 0) {
      slotSyncedElements[idx] = nextElement;
      return;
    }
    slotSyncedElements.push(nextElement);
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
  slotSyncedElements = slotSyncedElements.map((e) => {
    const slotId = (e as any).slotId as string | undefined;
    if (slotId && slotId.startsWith("company_") && e.type === "text") {
      const alignX = (e as any).alignX as "left" | "center" | "right" | undefined;
      if (alignX === "right") return e;
      return { ...e, alignX: "right" } as TemplateElement;
    }
    return e;
  });

  const FOOTER_Y_MAX = 260;
  const yFooter = (fromBottomPx: number) =>
    Math.min(Math.max(fromBottomPx, 0), FOOTER_Y_MAX);

  ensureSlotElement(
    "doc_title",
    "header",
    "text",
    { x: 0, y: 790, fontSize: 22, fontWeight: "bold", width: 595, height: 28, alignX: "center" },
    headerRef["doc_title"],
  );
  ensureSlotElement(
    "to_name",
    "header",
    "text",
    { x: 70, y: 725, fontSize: 12, fontWeight: "bold", width: 200, height: 18 },
    headerRef["to_name"],
  );
  if (shouldShowHonorific) {
    const toNameEl = slotSyncedElements.find((e) => (e as any).slotId === "to_name" || e.id === "to_name") as any;
    const baseX = typeof toNameEl?.x === "number" ? toNameEl.x : 70;
    const baseY = typeof toNameEl?.y === "number" ? toNameEl.y : 725;
    const baseWidth = typeof toNameEl?.width === "number" ? toNameEl.width : 200;
    const baseHeight = typeof toNameEl?.height === "number" ? toNameEl.height : 18;
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
    { x: 450, y: 772, width: 120, height: 60 },
    headerRef["logo"],
  );
  ensureSlotElement(
    "date_label",
    "header",
    "text",
    { x: 360, y: 720, fontSize: 10, width: 60, height: 16, alignX: "right" },
    { kind: "staticText", text: "発行日" },
  );
  ensureSlotElement(
    "issue_date",
    "header",
    "text",
    { x: 430, y: 720, fontSize: 10, width: 150, height: 16, alignX: "right" },
    headerRef["issue_date"],
  );
  ensureSlotElement(
    "doc_no",
    "header",
    "text",
    { x: 430, y: 740, fontSize: 10, width: 150, height: 16, alignX: "right" },
    headerRef["doc_no"],
  );
  ensureTextLabelElement(
    "doc_no_label",
    "header",
    "見積番号",
    { x: 360, y: 740, fontSize: 10, width: 60, height: 16, alignX: "right" },
  );

  const shouldShowAmountBox = !!footerRef["total"];
  ensureLabelElement(
    "amount_label",
    "header",
    "お見積金額",
    { x: 78, y: 690, fontSize: 10, width: 120, height: 14 },
  );
  ensureSlotElement(
    "amount_box",
    "header",
    "text",
    { x: 70, y: 650, fontSize: 18, fontWeight: "bold", width: 300, height: 60, borderWidth: 1, borderColorGray: 0.2, alignX: "right" },
    footerRef["total"],
  );
  slotSyncedElements = slotSyncedElements.map((e) => {
    if (e.id === "amount_label" || e.id === "amount_box") {
      return { ...e, hidden: !shouldShowAmountBox } as TemplateElement;
    }
    return e;
  });

  ensureLabelElement(
    "subtotal_label",
    "footer",
    "小計",
    { x: 360, y: yFooter(240), fontSize: 10, width: 60, height: 16 },
  );
  ensureSlotElement(
    "subtotal",
    "footer",
    "text",
    { x: 430, y: yFooter(240), fontSize: 10, width: 150, height: 16, alignX: "right" },
    footerRef["subtotal"],
  );
  ensureLabelElement(
    "tax_label",
    "footer",
    "消費税",
    { x: 360, y: yFooter(220), fontSize: 10, width: 60, height: 16 },
  );
  ensureSlotElement(
    "tax",
    "footer",
    "text",
    { x: 430, y: yFooter(220), fontSize: 10, width: 150, height: 16, alignX: "right" },
    footerRef["tax"],
  );
  ensureLabelElement(
    "total_label_fixed",
    "footer",
    "合計",
    { x: 360, y: yFooter(200), fontSize: 10, width: 60, height: 16, fontWeight: "bold", fillGray: 0.93 },
  );
  ensureSlotElement(
    "total",
    "footer",
    "text",
    { x: 430, y: yFooter(200), fontSize: 14, fontWeight: "bold", width: 150, height: 20, fillGray: 0.93, alignX: "right" },
    footerRef["total"],
  );
  ensureSlotElement(
    "remarks",
    "footer",
    "text",
    { x: 70, y: yFooter(120), fontSize: 10, width: 480, height: 80, borderWidth: 0.8, borderColorGray: 0.3 },
    footerRef["remarks"],
  );

  const sourceFieldCode = m?.table?.source?.kind === "subtable" ? m.table.source.fieldCode : undefined;
  const cols = m?.table?.columns ?? [];
  if (!sourceFieldCode || cols.length === 0) {
    next.elements = slotSyncedElements;
    return next;
  }

  const TABLE_ID = "items";
  const BASE_X = 70;
  const TOTAL_WIDTH = 480;
  const BASE_Y = 420;

  const existingIdx = slotSyncedElements.findIndex((e) => e.id === TABLE_ID);
  const existing = existingIdx >= 0 ? (slotSyncedElements[existingIdx] as any) : null;

  const widths = cols.map((c) => Math.max(1, Math.round((Number(c.widthPct ?? 0) / 100) * TOTAL_WIDTH)));
  const sumW = widths.reduce((a, b) => a + b, 0);
  const diff = TOTAL_WIDTH - sumW;
  if (widths.length > 0) {
    widths[widths.length - 1] = Math.max(1, widths[widths.length - 1] + diff);
  }

  const nextColumns: PdfTableColumn[] = cols.map((c, i) => {
    const fieldCode =
      c.value?.kind === "subtableField" ? c.value.fieldCode : "";

    return {
      id: c.id,
      title: c.label ?? c.id,
      fieldCode,
      width: widths[i] ?? 80,
      align: c.align ?? "left",
      minFontSize: 9,
    } as PdfTableColumn;
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
      console.warn("[estimate_v1] summary amount column not found", {
        summaryFieldCode,
        summaryColumnId,
      });
      warnedMissingAmountColumn = true;
    }
  }

  const summary =
    summaryMode !== "none" && summaryFieldCode && summaryColumnId
      ? (() => {
          const mode =
            summaryMode === "everyPageSubtotal+lastTotal"
              ? "everyPageSubtotal+lastTotal"
              : "lastPageOnly";
          const kind =
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
              subtotalFillGray: 0.95,
              totalFillGray: 0.93,
              totalTopBorderWidth: 1.2,
              borderColorGray: 0.3,
            },
          };
        })()
      : undefined;

  const tableEl = {
    id: TABLE_ID,
    type: "table",
    region: "body",
    x: typeof existing?.x === "number" ? existing.x : BASE_X,
    y: typeof existing?.y === "number" ? existing.y : BASE_Y,
    width: typeof existing?.width === "number" ? existing.width : TOTAL_WIDTH,
    rowHeight: typeof existing?.rowHeight === "number" ? existing.rowHeight : 20,
    headerHeight: typeof existing?.headerHeight === "number" ? existing.headerHeight : 24,
    showGrid: typeof existing?.showGrid === "boolean" ? existing.showGrid : true,
    borderColorGray:
      typeof (existing as any)?.borderColorGray === "number"
        ? (existing as any).borderColorGray
        : 0.3,
    borderWidth:
      typeof (existing as any)?.borderWidth === "number"
        ? (existing as any).borderWidth
        : 0.9,
    dataSource: { type: "kintoneSubtable", fieldCode: sourceFieldCode },
    columns: nextColumns,
    summary,
  } as TableElement & { borderColorGray?: number; borderWidth?: number };

  let nextElements: TemplateElement[];
  if (existingIdx >= 0) {
    nextElements = slotSyncedElements.map((e, i) => (i === existingIdx ? (tableEl as unknown as TemplateElement) : e));
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
