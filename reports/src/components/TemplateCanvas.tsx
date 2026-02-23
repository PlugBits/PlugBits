import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react';
import type {
  TemplateDefinition,
  TemplateElement,
  DataSource,
  CompanyProfile,
  RegionBounds,
} from '@shared/template';
import { getPageDimensions, resolveRegionBounds } from '@shared/template';
import { isDebugEnabled } from '../shared/debugFlag';
import { isEstimateV1 } from '@shared/templateGuards';
import {
  REGION_BOUNDS,
  getCanvasDimensions,
  getRegionOf,
  clamp,
  clampYToRegion,
} from '../utils/regionBounds';
import { snapPixel } from '@shared/pixelSnap';
import {
  isElementHiddenByEasyAdjust,
  normalizeEasyAdjustBlockSettings,
  resolveElementBlock,
  resolveFontScalePreset,
  resolvePagePaddingPreset,
} from '../utils/easyAdjust';
import { useTenantStore } from '../store/tenantStore';


type CanvasProps = {
  template: TemplateDefinition;
  selectedElementId: string | null;
  onSelect: (element: TemplateElement | null) => void;
  onUpdateElement: (elementId: string, updates: Partial<TemplateElement>) => void;
  snapEnabled?: boolean;
  showGrid?: boolean;
  showGuides?: boolean;
  highlightedElementIds?: Set<string>;
  slotLabels?: Record<string, string>;
  adminMode?: boolean;
  regionBounds?: RegionBounds;
  errorElementIds?: Set<string>;

};

type DragState = {
  id: string;
  originX: number;
  originY: number;
  startX: number;
  startY: number;
};

type ResizeState = {
  id: string;
  originX: number;
  originY: number;
  startWidth: number;
  startHeight: number;
};

const GRID_SIZE = 5;
const ALIGN_PADDING = 12;
type TextElement = Extract<TemplateElement, { type: 'text' }>;
type TableElement = Extract<TemplateElement, { type: 'table' }>;
const TABLE_CELL_DEBUG_ID = 'items:row0:item_name';
const DBG_TEXT_TARGETS = new Set([
  'doc_title',
  'doc_no',
  'date_label',
  'issue_date',
  TABLE_CELL_DEBUG_ID,
]);

const resolvePagePadding = resolvePagePaddingPreset;
const resolveFontScale = resolveFontScalePreset;

const getTableWidth = (element: TemplateElement) => {
  if (element.type === 'table') {
    return element.columns.reduce((sum, column) => sum + column.width, 0);
  }
  if (element.type === 'cardList') {
    return element.width ?? 520;
  }
  return element.width ?? 140;
};

const getElementWidthValue = (element: TemplateElement) => {
  if (element.type === 'table') {
    return getTableWidth(element);
  }
  return element.width ?? 140;
};

const getElementHeightValue = (element: TemplateElement) => {
  if (element.type === 'table') {
    const header = element.headerHeight ?? 24;
    const rows = (element.rowHeight ?? 18) * 3;
    return header + rows;
  }
  if (element.type === 'cardList') {
    return element.cardHeight ?? 90;
  }
  return element.height ?? 32;
};

const resolveAlignedX = (
  element: TemplateElement,
  width: number,
  pagePadding: number,
  canvasWidth: number,
) => {
  const slotId = (element as any).slotId as string | undefined;
  if (slotId !== 'doc_title') return element.x;
  const alignX = (element as any).alignX as 'left' | 'center' | 'right' | undefined;
  if (!alignX) return element.x;
  const safeWidth = Number.isFinite(width) ? width : 0;
  if (safeWidth <= 0) return element.x;
  const padding = Number.isFinite(pagePadding) ? pagePadding : ALIGN_PADDING;
  if (alignX === 'left') return padding;
  if (alignX === 'center') return (canvasWidth - safeWidth) / 2;
  if (alignX === 'right') return canvasWidth - safeWidth - padding;
  return element.x;
};

const isItemNameColumn = (column: TableElement['columns'][number]) =>
  column.id === 'item_name' || column.fieldCode === 'ItemName';

const resolveTableDebugCell = (template: TemplateDefinition) => {
  const tables = template.elements.filter(
    (el): el is TableElement => el.type === 'table',
  );
  if (tables.length === 0) return null;
  const table = tables.find((el) => el.id === 'items') ?? tables[0];
  if (!table.columns || table.columns.length === 0) return null;
  const itemColumn = table.columns.find(isItemNameColumn) ?? table.columns[0];
  if (!itemColumn) return null;
  const itemColumnIndex = table.columns.indexOf(itemColumn);
  const offsetX = table.columns.slice(0, itemColumnIndex).reduce((sum, column) => {
    const width = typeof column.width === 'number' ? column.width : 0;
    return sum + width;
  }, 0);
  const baseX = Number.isFinite(table.x) ? table.x : 0;
  const baseY = Number.isFinite(table.y) ? table.y : 0;
  const headerHeight = table.headerHeight ?? table.rowHeight ?? 18;
  const rowHeight = table.rowHeight ?? 18;
  const headerRowGap = Math.min(8, Math.max(4, Math.round(rowHeight * 0.3)));
  const gridBorderWidth = (table as any).borderWidth ?? 0.5;
  const computedRowTop = baseY + headerHeight + headerRowGap;
  return {
    tableId: table.id,
    elementId: TABLE_CELL_DEBUG_ID,
    x: baseX + offsetX,
    y: computedRowTop,
    width: typeof itemColumn.width === 'number' ? itemColumn.width : 1,
    headerHeight,
    headerRowGap,
    rowHeight,
    gridBorderWidth,
    tableY: baseY,
    computedRowTop,
  };
};

const getElementStyle = (
  element: TemplateElement,
  pagePadding: number,
  canvasWidth: number,
): CSSProperties => {
  const widthValue = getElementWidthValue(element);
  const base: CSSProperties = {
    left: `${resolveAlignedX(element, widthValue, pagePadding, canvasWidth)}px`,
    top: `${element.y}px`,
  };

  if ('width' in element && element.width) {
    base.width = `${element.width}px`;
  }

  if (element.type === 'table') {
    const header = element.headerHeight ?? 24;
    const rows = (element.rowHeight ?? 18) * 3;
    base.height = `${header + rows}px`;
  } else if (element.type === 'cardList') {
    base.height = `${element.cardHeight ?? 90}px`;
  } else if (element.height) {
    base.height = `${element.height}px`;
  }

  return base;
};

const describeDataSource = (
  element: TemplateElement,
  companyProfile?: CompanyProfile,
) => {
  const slotId = (element as any).slotId as string | undefined;
  if (slotId && slotId.startsWith('company_') && companyProfile) {
    const value =
      slotId === 'company_name'
        ? companyProfile.companyName
        : slotId === 'company_address'
          ? companyProfile.companyAddress
          : slotId === 'company_tel'
            ? companyProfile.companyTel
            : slotId === 'company_email'
              ? companyProfile.companyEmail
              : '';
    return value ?? '';
  }
  // table
  if (element.type === 'table') {
    const ds = element.dataSource;
    return ds ? `サブテーブル: ${ds.fieldCode}` : 'サブテーブル: (未選択)';
  }
  if (element.type === 'cardList') {
    const ds = element.dataSource;
    return ds ? `サブテーブル: ${ds.fieldCode}` : 'サブテーブル: (未選択)';
  }

  // label
  if (element.type === 'label') {
    return element.text ?? '';
  }

  // text / image など dataSource を持つ可能性がある要素
  const ds = (element as any).dataSource as DataSource | undefined;
  if (!ds) return '';

  if (ds.type === 'static') {
    return ds.value ?? '';
  }

  // kintone / kintoneSubtable
  if ('fieldCode' in ds) {
    return `{{${ds.fieldCode}}}`;
  }

  return '';
};


const TemplateCanvas = ({
  template,
  selectedElementId,
  onSelect,
  onUpdateElement,
  snapEnabled = true,
  showGrid = true,
  showGuides = true,
  highlightedElementIds,
  slotLabels,
  adminMode,
  regionBounds,
  errorElementIds,
}: CanvasProps) => {
  const resolvedAdminMode = useMemo(() => {
    if (adminMode !== undefined) return adminMode;
    if (import.meta.env.VITE_ADMIN_MODE === '1') return true;
    if (typeof window === 'undefined') return false;
    return (window.location.hash ?? '').includes('/admin/tuner');
  }, [adminMode]);
  const isAdvanced = !resolvedAdminMode && !!template.advancedLayoutEditing;
  const isEstimate = isEstimateV1(template);
  const companyProfile = useTenantStore((state) => state.tenantContext?.companyProfile);
  const { width: canvasWidth, height: canvasHeight } = useMemo(
    () => getCanvasDimensions(template),
    [template],
  );
  const activeRegionBounds = useMemo(
    () => regionBounds ?? resolveRegionBounds(template, canvasHeight),
    [regionBounds, template, canvasHeight],
  );
  const activeBoundsTop = activeRegionBounds;
  const debugLabelsEnabled = useMemo(() => isDebugEnabled(), []);
  const tableDebugCellRaw = useMemo(
    () => (debugLabelsEnabled ? resolveTableDebugCell(template) : null),
    [debugLabelsEnabled, template],
  );
  const tableDebugCell = useMemo(() => {
    if (!tableDebugCellRaw) return null;
    const dpr =
      typeof window === 'undefined' ? 1 : Number(window.devicePixelRatio ?? 1);
    const rawRowTop = tableDebugCellRaw.computedRowTop;
    const snapInput = rawRowTop + tableDebugCellRaw.gridBorderWidth;
    const snappedTop = snapPixel(snapInput, 'stroke', dpr);
    const cellTopDraw = Math.round(snappedTop);
    return {
      ...tableDebugCellRaw,
      computedRowTopRaw: rawRowTop,
      snapInput,
      computedRowTopSnapped: snappedTop,
      cellTopDraw,
      y: cellTopDraw,
      dpr,
    };
  }, [tableDebugCellRaw]);
  const companyBlockEnabled = template.settings?.companyBlock?.enabled !== false;
  const loggedEstimateRef = useRef(false);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    if (!isEstimate || loggedEstimateRef.current) return;
    console.log('[canvas] estimate_v1 mode');
    loggedEstimateRef.current = true;
  }, [isEstimate]);
  useEffect(() => {
    if (!debugLabelsEnabled) return;
    const raf = window.requestAnimationFrame(() => {
      const root = canvasRef.current;
      if (!root) return;
      const rootRect = root.getBoundingClientRect();
      const map = (window as any).__DBG_CANVAS_TOP__ ?? {};
      const markers = root.querySelectorAll('[data-dbg-marker="1"]');
      console.log('[DBG_MARKER_PRESENT]', {
        found: markers.length > 0,
        count: markers.length,
      });
      const markerIds = Array.from(
        root.querySelectorAll<HTMLElement>('[data-element-id]'),
      )
        .map((el) => el.dataset.elementId)
        .filter((elementId): elementId is string => !!elementId);
      console.log('[DBG_CANVAS_MARKERS]', { ids: markerIds });
      if (tableDebugCell) {
        const snapDelta = tableDebugCell.cellTopDraw - tableDebugCell.computedRowTopRaw;
        console.log('[DBG_TABLE_DRAW_COORDS_CANVAS]', {
          tableY_ui: tableDebugCell.tableY,
          headerHeightUsed: tableDebugCell.headerHeight,
          headerRowGapUsed: tableDebugCell.headerRowGap,
          computedRowTopUsed: tableDebugCell.cellTopDraw,
          computedCellTopUsed: tableDebugCell.cellTopDraw,
          rowHeightUsed: tableDebugCell.rowHeight,
          gridBorderWidthUsed: tableDebugCell.gridBorderWidth,
          rawRowTop: tableDebugCell.computedRowTopRaw,
          snapInput: tableDebugCell.snapInput,
          snapMode: 'stroke',
          snapDelta,
          cellTopDraw: tableDebugCell.cellTopDraw,
          note: 'these are the coordinates used to draw the first row cell frame',
        });
      }
      const tableCellEl = root.querySelector<HTMLElement>(
        `[data-element-id="${TABLE_CELL_DEBUG_ID}"]`,
      );
      const tableCellRect = tableCellEl?.getBoundingClientRect();
      if (tableCellRect) {
        const relativeTop = tableCellRect.top - rootRect.top - root.clientTop;
        const measuredTop = relativeTop;
        const measuredTopOffset =
          tableCellEl && root
            ? tableCellEl.offsetTop - root.clientTop
            : measuredTop;
        const cellTop =
          typeof tableDebugCell?.cellTopDraw === 'number'
            ? tableDebugCell.cellTopDraw
            : snapPixel(
                measuredTop,
                'stroke',
                tableDebugCell?.dpr ?? window.devicePixelRatio ?? 1,
              );
        const markerStyle = tableCellEl ? window.getComputedStyle(tableCellEl) : null;
        const offsetParent = tableCellEl?.offsetParent as HTMLElement | null;
        const offsetParentStyle = offsetParent ? window.getComputedStyle(offsetParent) : null;
        const rootStyle = window.getComputedStyle(root);
        console.log('[DBG_TABLE_CELL_CANVAS]', {
          elementId: TABLE_CELL_DEBUG_ID,
          cellTop: measuredTop,
          cellHeight: tableCellRect.height,
        });
        console.log('[DBG_TABLE_MEASURE_CANVAS]', {
          canvasRootTop: rootRect.top,
          canvasRootClientTop: root.clientTop,
          canvasRootOffsetTop: root.offsetTop,
          markerTop: tableCellRect.top,
          markerOffsetTop: tableCellEl?.offsetTop ?? null,
          markerClientTop: tableCellEl?.clientTop ?? null,
          relativeTop,
          measuredTopOffset,
          markerCssTop: markerStyle?.top ?? null,
          offsetParentTag: offsetParent?.tagName ?? null,
          offsetParentClass: offsetParent?.className ?? null,
          offsetParentPaddingTop: offsetParentStyle?.paddingTop ?? null,
          offsetParentBorderTopWidth: offsetParentStyle?.borderTopWidth ?? null,
          clientTop: root.clientTop,
          borderTop: rootStyle.borderTopWidth,
          scrollTop: root.scrollTop,
          devicePixelRatio: window.devicePixelRatio,
        });
        if (tableDebugCell) {
          console.log('[DBG_TABLE_CANVAS_DELTA]', {
            drawCellTop: tableDebugCell.cellTopDraw,
            measuredTop,
            delta: measuredTop - tableDebugCell.cellTopDraw,
            deltaOffsetInfo: measuredTopOffset - tableDebugCell.cellTopDraw,
          });
        }
      }
      const tableTextEl = root.querySelector<HTMLElement>(
        `[data-text-element-id="${TABLE_CELL_DEBUG_ID}"]`,
      );
      if (tableTextEl) {
        const rect = tableTextEl.getBoundingClientRect();
        const textTop = rect.top - rootRect.top;
        const cellTop = tableCellRect
          ? typeof tableDebugCell?.cellTopDraw === 'number'
            ? tableDebugCell.cellTopDraw
            : snapPixel(
                (tableCellEl?.offsetTop ?? tableCellRect.top - rootRect.top) -
                  root.clientTop,
                'stroke',
                tableDebugCell?.dpr ?? window.devicePixelRatio ?? 1,
              )
          : null;
        console.log('[DBG_TABLE_TEXT_CANVAS]', {
          elementId: TABLE_CELL_DEBUG_ID,
          textTop,
          textHeight: rect.height,
          computedOffsetInCell:
            typeof cellTop === 'number' ? textTop - cellTop : null,
        });
      }
      root.querySelectorAll<HTMLElement>('[data-element-id]').forEach((el) => {
        const elementId = el.dataset.elementId;
        if (!elementId || !DBG_TEXT_TARGETS.has(elementId)) return;
        const rect = el.getBoundingClientRect();
        const canvasTop = rect.top - rootRect.top;
        console.log('[DBG_CANVAS_RECT]', {
          elementId,
          canvasTop,
          height: rect.height,
        });
        map[elementId] = canvasTop;
      });
      (window as any).__DBG_CANVAS_TOP__ = map;
    });
    return () => window.cancelAnimationFrame(raf);
  }, [
    debugLabelsEnabled,
    template,
    canvasWidth,
    canvasHeight,
    tableDebugCell?.elementId,
    tableDebugCell?.cellTopDraw,
  ]);
  const isDocumentMetaElement = (element: TemplateElement) => {
    if (isEstimate) return false;
    const slotId = (element as any).slotId as string | undefined;
    return (
      slotId === 'doc_no' ||
      slotId === 'date_label' ||
      slotId === 'issue_date' ||
      element.id === 'doc_no_label'
    );
  };
  const getElementSettings = (element: TemplateElement) => {
    const block = resolveElementBlock(element, template);
    const settings = normalizeEasyAdjustBlockSettings(template, block);
    return {
      fontScale: resolveFontScale(settings.fontPreset),
      pagePadding: resolvePagePadding(settings.paddingPreset),
    };
  };
  const docNoLabelElement = !isEstimate
    ? template.elements.find((el): el is TextElement => el.id === 'doc_no_label' && el.type === 'text')
    : undefined;
  const dateLabelElement = !isEstimate
    ? template.elements.find((el): el is TextElement => {
        const slotId = (el as any).slotId as string | undefined;
        return el.type === 'text' && (slotId === 'date_label' || el.id === 'date_label');
      })
    : undefined;
  const companyNameElement = template.elements.find((el): el is TextElement => {
    const slotId = (el as any).slotId as string | undefined;
    return el.type === 'text' && slotId === 'company_name';
  });
  const slotMetaById = useMemo(() => {
    const map = new Map<string, { label: string; required?: boolean }>();
    template.slotSchema?.header?.forEach((slot) => {
      map.set(slot.slotId, { label: slot.label, required: slot.required });
    });
    template.slotSchema?.footer?.forEach((slot) => {
      map.set(slot.slotId, { label: slot.label, required: slot.required });
    });
    return map;
  }, [template.slotSchema]);
  const isCompanyNameEmpty = (() => {
    const profileName = String(companyProfile?.companyName ?? '').trim();
    if (profileName) return false;
    const ds = (companyNameElement as any)?.dataSource as DataSource | undefined;
    if (ds?.type !== 'static') return true;
    return String(ds.value ?? '').trim().length === 0;
  })();

  const visibleElements = template.elements.filter((el) => {
    if (resolvedAdminMode) return true;
    if (isElementHiddenByEasyAdjust(el, template)) return false;
    const slotId = (el as any).slotId as string | undefined;
    const slotMeta = slotId ? slotMetaById.get(slotId) : undefined;
    if (el.hidden && !slotMeta) return false;
    if (!isEstimate) {
      if (el.id === 'doc_no_label') return false;
      if (slotId === 'date_label' || el.id === 'date_label') return false;
    }
    if (!companyBlockEnabled && slotId && slotId.startsWith('company_')) return false;
    if (isCompanyNameEmpty && slotId && slotId.startsWith('company_')) return false;
    if (el.type === 'image' && (slotId === 'logo' || el.id === 'logo')) {
      const ds = (el as any).dataSource as DataSource | undefined;
      const staticValue = ds?.type === 'static' ? String(ds.value ?? '').trim() : '';
      const kintoneField = ds?.type === 'kintone' ? String(ds.fieldCode ?? '').trim() : '';
      if (!staticValue && !kintoneField) return false;
    }
    return true;
  });

  const [dragState, setDragState] = useState<DragState | null>(null);
  const [resizeState, setResizeState] = useState<ResizeState | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const selectedElement = selectedElementId
    ? template.elements.find((el) => el.id === selectedElementId)
    : null;
  useEffect(() => {
    if (!debugLabelsEnabled) return;
    const page = getPageDimensions(template.pageSize ?? 'A4', template.orientation ?? 'portrait');
    const scaleX = canvasWidth / page.width;
    const scaleY = canvasHeight / page.height;
    const selected = selectedElement;
    if (!selected) {
      console.debug(
        `[DBG_CANVAS] page(pt)=${page.width}x${page.height} canvas(px)=${canvasWidth}x${canvasHeight} ` +
          `scale=${scaleX.toFixed(4)}x${scaleY.toFixed(4)} selected=(none)`,
      );
      return;
    }
    const width = getElementWidthValue(selected);
    const height = getElementHeightValue(selected);
    const { pagePadding } = getElementSettings(selected);
    const alignedX = resolveAlignedX(selected, width, pagePadding, canvasWidth);
    console.debug(
      `[DBG_CANVAS] page(pt)=${page.width}x${page.height} canvas(px)=${canvasWidth}x${canvasHeight} ` +
        `scale=${scaleX.toFixed(4)}x${scaleY.toFixed(4)} selected=${selected.id} ` +
        `pt(x=${selected.x},y=${selected.y},w=${width},h=${height}) ` +
        `px(x=${(selected.x * scaleX).toFixed(2)},y=${(selected.y * scaleY).toFixed(2)},` +
        `w=${(width * scaleX).toFixed(2)},h=${(height * scaleY).toFixed(2)}) ` +
        `alignedPxX=${alignedX.toFixed(2)}`,
    );
  }, [
    debugLabelsEnabled,
    template.pageSize,
    template.orientation,
    canvasWidth,
    canvasHeight,
    selectedElement,
  ]);

  const canvasStyle: CSSProperties = showGrid
    ? {
        backgroundImage:
          'linear-gradient(90deg, rgba(15,23,42,0.05) 1px, transparent 1px), linear-gradient(0deg, rgba(15,23,42,0.05) 1px, transparent 1px)',
        backgroundSize: `${GRID_SIZE * 4}px ${GRID_SIZE * 4}px`,
        backgroundColor: '#fff',
        width: `${canvasWidth}px`,
        height: `${canvasHeight}px`,
      }
    : { backgroundColor: '#fff', width: `${canvasWidth}px`, height: `${canvasHeight}px` };

  const applySnap = (value: number) => (snapEnabled ? snapToGrid(value) : value);

  useEffect(() => {
    if (!dragState && !resizeState) return;

    const handleMove = (event: MouseEvent) => {
      event.preventDefault();

      if (dragState) {
        const el = template.elements.find((e) => e.id === dragState.id);
        if (el?.type === 'table' || el?.type === 'cardList') return;
        if (!isAdvanced) return;

        const deltaX = event.clientX - dragState.originX;
        const deltaY = event.clientY - dragState.originY;
        
        const region = el ? getRegionOf(el) : 'body';
        const bounds = resolvedAdminMode
          ? activeBoundsTop[region]
          : REGION_BOUNDS(canvasHeight)[region];

          const nextX = clampToCanvas(applySnap(dragState.startX + deltaX), canvasWidth);
        const rawY = applySnap(dragState.startY + deltaY);

        // region内に収める（yはtop基準）
        const nextY = resolvedAdminMode
          ? clamp(rawY, bounds.yTop, bounds.yBottom)
          : clampYToRegion(rawY, region);
        onUpdateElement(dragState.id, { x: nextX, y: nextY });

      }

      if (resizeState) {
        if (!isAdvanced) return;

        const deltaX = event.clientX - resizeState.originX;
        const deltaY = event.clientY - resizeState.originY;
        const nextWidth = Math.max(20, applySnap(resizeState.startWidth + deltaX));
        const nextHeight = Math.max(12, applySnap(resizeState.startHeight + deltaY));
        onUpdateElement(resizeState.id, { width: nextWidth, height: nextHeight });
      }
    };

    const handleUp = () => {
      setDragState(null);
      setResizeState(null);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp, { once: true });
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [dragState, resizeState, onUpdateElement]);

  const handleElementMouseDown = (event: ReactMouseEvent<HTMLDivElement>, element: TemplateElement) => {
    if (event.button !== 0) return;
    event.stopPropagation();

    const rect = canvasRef.current?.getBoundingClientRect();
    const point = rect
      ? {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        }
      : null;

    const hitList = point
      ? visibleElements.filter((el) => {
          const width = getElementWidthValue(el);
          const height = getElementHeightValue(el);
          const { pagePadding } = getElementSettings(el);
          const left = resolveAlignedX(el, width, pagePadding, canvasWidth);
          return (
            point.x >= left &&
            point.x <= left + width &&
            point.y >= el.y &&
            point.y <= el.y + height
          );
        })
      : [element];

    if (hitList.length === 0) {
      onSelect(null);
      return;
    }

    const currentIdx = hitList.findIndex((el) => el.id === selectedElementId);
    const nextIdx = currentIdx >= 0
      ? (currentIdx - 1 + hitList.length) % hitList.length
      : hitList.length - 1;
    const nextElement = hitList[nextIdx] ?? element;

    onSelect(nextElement);

    // 通常モードはレイアウト編集しない
    if (!isAdvanced) return;

    // 明細テーブルは Mapping で管理するので、キャンバス上は固定
    if (nextElement.type === 'table' || nextElement.type === 'cardList') {
      setHint('この要素は固定です（フィールド割当で設定してください）');
      window.setTimeout(() => setHint(null), 1500);
      return;
    }

    setDragState({
      id: nextElement.id,
      originX: event.clientX,
      originY: event.clientY,
      startX: nextElement.x,
      startY: nextElement.y,
    });
  };


  const handleResizeMouseDown = (event: ReactMouseEvent<HTMLDivElement>, element: TemplateElement) => {
    event.stopPropagation();
    onSelect(element);

    if (!isAdvanced) return;

    // tableは固定（Mappingで制御）
    if (element.type === 'table' || element.type === 'cardList') return;

    const startWidth = element.width ?? 120;
    const startHeight = element.height ?? 32;
    setResizeState({
      id: element.id,
      originX: event.clientX,
      originY: event.clientY,
      startWidth,
      startHeight,
    });
  };


  const handleCanvasMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      onSelect(null);
    }
  };

  const guideElements = showGuides && selectedElement
    ? (() => {
        const width = getElementWidthValue(selectedElement);
        const height = getElementHeightValue(selectedElement);
        const { pagePadding } = getElementSettings(selectedElement);
        const alignedX = resolveAlignedX(selectedElement, width, pagePadding, canvasWidth);
        const badgeLeft = Math.min(alignedX + width + 12, canvasWidth - 80);
        const badgeTop = Math.min(selectedElement.y + height + 12, canvasHeight - 24);
        return (
          <>
            <div className="canvas-guide horizontal" style={{ top: `${selectedElement.y}px` }} />
            <div className="canvas-guide vertical" style={{ left: `${alignedX}px` }} />
            <div className="canvas-coord-badge" style={{ left: `${badgeLeft}px`, top: `${badgeTop}px` }}>
              {Math.round(alignedX)}px / {selectedElement.y}px
            </div>
          </>
        );
      })()
    : null;

  return (
    <div className="template-canvas" style={canvasStyle} onMouseDown={handleCanvasMouseDown} ref={canvasRef}>
      {debugLabelsEnabled && tableDebugCell ? (
        <span
          data-element-id={tableDebugCell.elementId}
          data-dbg-marker="1"
          style={{
            position: 'absolute',
            left: `${tableDebugCell.x}px`,
            top: `${tableDebugCell.y}px`,
            width: `${tableDebugCell.width}px`,
            height: `${tableDebugCell.rowHeight}px`,
            pointerEvents: 'none',
            opacity: 0,
          }}
        >
          <span
            data-text-element-id={tableDebugCell.elementId}
            style={{
              position: 'absolute',
              left: '6px',
              top: '4px',
              fontSize: '10px',
              lineHeight: '1.2',
              whiteSpace: 'nowrap',
            }}
          >
            品名
          </span>
        </span>
      ) : null}
      {resolvedAdminMode && showGuides ? (
        <div className="canvas-region-guides">
          {(['header', 'body', 'footer'] as const).flatMap((region) => {
            const bounds = activeRegionBounds[region];
            const top = bounds.yTop;
            const bottom = bounds.yBottom;
            return [
              <div
                key={`${region}-top`}
                className={`canvas-region-guide ${region}`}
                style={{ top: `${top}px` }}
              />,
              <div
                key={`${region}-bottom`}
                className={`canvas-region-guide ${region}`}
                style={{ top: `${bottom}px` }}
              />,
            ];
          })}
        </div>
      ) : null}
      {visibleElements.map((element) => {
        const slotId = (element as any).slotId as string | undefined;
        const slotMeta = slotId ? slotMetaById.get(slotId) : undefined;
        const placeholderText = (() => {
          if (element.type !== 'text') return '';
          if (!slotMeta && !resolvedAdminMode) return '';
          if (resolvedAdminMode) {
            const ds = (element as any).dataSource as DataSource | undefined;
            const hasStatic = ds?.type === 'static';
            const staticValue = hasStatic ? String(ds?.value ?? '') : '';
            const isMissingKintone = ds?.type === 'kintone' && !ds.fieldCode;
            const isMissingSubtable = ds?.type === 'kintoneSubtable' && !ds.fieldCode;
            if (!isMissingKintone && !isMissingSubtable && staticValue.trim()) return '';
            const label = slotMeta?.label || slotId || element.id || '未設定';
            return `{{${label}}}`;
          }
          const ds = (element as any).dataSource as DataSource | undefined;
          const hasStatic = ds?.type === 'static';
          const staticValue = hasStatic ? String(ds?.value ?? '') : '';
          const isEmptyStatic = hasStatic && staticValue.trim().length === 0;
          const isMissingKintone = ds?.type === 'kintone' && !ds.fieldCode;
          const isMissingSubtable = ds?.type === 'kintoneSubtable' && !ds.fieldCode;
          if (!element.hidden && !isEmptyStatic && !isMissingKintone && !isMissingSubtable && ds) return '';
          const label = slotMeta.label || slotId || '未設定';
          return `{{${label}}}`;
        })();
        const valueText = placeholderText || describeDataSource(element, companyProfile);
        const isPlaceholder = placeholderText.length > 0;
        const hasMultiline = valueText.includes('\n');
        const isDocMeta = isDocumentMetaElement(element);
        const isDocMetaValue = !isEstimate && (slotId === 'doc_no' || slotId === 'issue_date');
        const docMetaLabelEl = isDocMetaValue
          ? slotId === 'doc_no'
            ? docNoLabelElement
            : dateLabelElement
          : undefined;
        const docMetaLabelText = (() => {
          const ds = (docMetaLabelEl as any)?.dataSource as DataSource | undefined;
          if (ds?.type === 'static' && ds.value) return String(ds.value);
          if ((docMetaLabelEl as any)?.text) return String((docMetaLabelEl as any).text);
          if (slotId === 'doc_no') return '文書番号';
          if (slotId === 'issue_date') return '日付';
          return '';
        })();
        const docMetaLabelWidth = Number.isFinite(docMetaLabelEl?.width)
          ? (docMetaLabelEl?.width as number)
          : 56;
        const resolveDocMetaBounds = () => {
          if (!docMetaLabelEl || !('width' in element) || !element.width) return null;
          const labelX = Number.isFinite(docMetaLabelEl.x) ? (docMetaLabelEl.x as number) : element.x;
          const labelY = Number.isFinite(docMetaLabelEl.y) ? (docMetaLabelEl.y as number) : element.y;
          const labelW = Number.isFinite(docMetaLabelEl.width) ? (docMetaLabelEl.width as number) : docMetaLabelWidth;
          const valueX = Number.isFinite(element.x) ? element.x : labelX;
          const valueW = Number.isFinite(element.width) ? (element.width as number) : 0;
          const left = Math.min(labelX, valueX);
          const right = Math.max(labelX + labelW, valueX + valueW);
          const top = Math.min(labelY, element.y);
          const height = Math.max(docMetaLabelEl.height ?? 0, element.height ?? 0);
          return {
            x: left,
            y: top,
            width: Math.max(0, right - left),
            height,
          };
        };
        const metaTextStyle: CSSProperties | undefined = isDocMeta
          ? {
              whiteSpace: 'nowrap',
              wordBreak: 'keep-all',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }
          : undefined;
        const elementStyle = getElementStyle(
          element,
          getElementSettings(element).pagePadding,
          canvasWidth,
        );
        const alignX = (element as any).alignX as 'left' | 'center' | 'right' | undefined;
        const textAlign =
          alignX === 'center' ? 'center' : alignX === 'right' ? 'right' : 'left';
        const justifySelf =
          alignX === 'center' ? 'center' : alignX === 'right' ? 'end' : 'start';
        const docMetaBounds = isDocMetaValue ? resolveDocMetaBounds() : null;
        const valueMultilineStyle: CSSProperties | undefined =
          !isDocMetaValue && hasMultiline
            ? { whiteSpace: 'pre-line', lineHeight: '1.2' }
            : undefined;
        const elementWidthValue = getElementWidthValue(element);
        const elementHeightValue = getElementHeightValue(element);
        const debugInfo =
          resolvedAdminMode && debugLabelsEnabled
            ? `x:${Math.round(element.x)} y:${Math.round(element.y)} w:${Math.round(elementWidthValue)} h:${Math.round(elementHeightValue)}`
            : '';
        const labelText = resolvedAdminMode
          ? (slotId ?? element.id)
          : slotId && slotLabels?.[slotId]
            ? slotLabels[slotId]
            : debugLabelsEnabled
              ? element.type
              : '';
        const mergedStyle = docMetaBounds
          ? {
              ...elementStyle,
              left: `${docMetaBounds.x}px`,
              top: `${docMetaBounds.y}px`,
              width: `${docMetaBounds.width}px`,
              height: `${docMetaBounds.height}px`,
            }
          : elementStyle;
        const hasWidth = mergedStyle.width !== undefined;
        const hasHeight = mergedStyle.height !== undefined;
        return (
          <div
            key={element.id}
            className="canvas-element-wrapper"
            data-element-id={slotId ?? element.id}
            style={{
              ...mergedStyle,
              zIndex: selectedElementId === element.id ? 50 : highlightedElementIds?.has(element.id) ? 40 : undefined,
            }}
            onMouseDown={(event) => handleElementMouseDown(event, element)}
          >
            <div
              className={[
                'canvas-element',
                resolvedAdminMode ? 'admin' : '',
                errorElementIds?.has(element.id) ? 'error' : '',
                selectedElementId === element.id ? 'selected' : '',
                highlightedElementIds?.has(element.id) ? 'highlighted' : '',
              ].filter(Boolean).join(' ')}
              style={{
                ...(hasWidth ? { width: '100%' } : null),
                ...(hasHeight ? { height: '100%' } : null),
                ...(isDocMeta ? { overflow: 'hidden' } : null),
                ...(adminMode ? { borderColor: 'rgba(148, 163, 184, 0.8)' } : null),
              }}
            >
              {element.type === 'cardList' ? (
                <>
                  <div
                    style={{
                      position: 'absolute',
                      top: 4,
                      left: 6,
                      fontSize: '0.65rem',
                      fontWeight: 700,
                      color: '#344054',
                      background: 'rgba(255,255,255,0.8)',
                      padding: '1px 6px',
                      borderRadius: 999,
                    }}
                  >
                    カード枠
                  </div>
                  <div
                    style={{
                      position: 'absolute',
                      top: 22,
                      left: 6,
                      right: 6,
                      bottom: 6,
                      border: '1px solid #cbd5e1',
                      borderRadius: 8,
                      background: '#f8fafc',
                      display: 'grid',
                      gridTemplateColumns: '62% 38%',
                      gridTemplateRows: '45% 30% 25%',
                      gap: 4,
                      padding: 6,
                      fontSize: '0.7rem',
                      color: '#475467',
                    }}
                  >
                    <div style={{ fontWeight: 600, color: '#101828' }}>Field A</div>
                    <div style={{ textAlign: 'right' }}>Field B</div>
                    <div>Field C</div>
                    <div style={{ textAlign: 'right' }}>Field D</div>
                    <div>Field E</div>
                    <div style={{ textAlign: 'right' }}>Field F</div>
                  </div>
                </>
              ) : null}
              {isAdvanced && element.type !== 'table' && element.type !== 'cardList' && (
                <div className="resize-handle" onMouseDown={(event) => handleResizeMouseDown(event, element)} />
              )}
            </div>
            {element.type !== 'cardList' && (
              <div
                className="canvas-element-overlay"
                style={
                  isDocMetaValue
                    ? {
                        display: 'grid',
                        gridTemplateColumns: docMetaLabelText ? `${docMetaLabelWidth}px 1fr` : '1fr',
                        columnGap: 8,
                        alignItems: 'center',
                        textAlign,
                      }
                    : { textAlign }
                }
              >
                {isDocMetaValue ? (
                  <>
                    {docMetaLabelText ? (
                      <span
                        className="canvas-element-label"
                        style={{
                          fontSize: '0.7rem',
                          color: '#475467',
                          textAlign,
                          justifySelf,
                          ...(metaTextStyle ?? {}),
                        }}
                      >
                        {docMetaLabelText}
                      </span>
                    ) : null}
                    <span
                      className="canvas-element-value"
                      style={{
                        fontSize: `${0.85 * getElementSettings(element).fontScale}rem`,
                        textAlign,
                        justifySelf,
                        color: isPlaceholder ? '#98a2b3' : undefined,
                        opacity: isPlaceholder ? 0.7 : undefined,
                        ...(metaTextStyle ?? {}),
                        ...(valueMultilineStyle ?? {}),
                      }}
                    >
                      {valueText}
                    </span>
                    {debugInfo ? (
                      <span
                        className="canvas-element-label"
                        style={{
                          gridColumn: '1 / -1',
                          fontSize: '0.62rem',
                          color: '#98a2b3',
                          textAlign,
                        }}
                      >
                        {debugInfo}
                      </span>
                    ) : null}
                  </>
                ) : (
                  <>
                    {labelText ? (
                      <strong
                        className="canvas-element-label"
                        style={{
                          display: 'block',
                          fontSize: '0.7rem',
                          color: slotLabels?.[(element as any).slotId] ? '#344054' : '#475467',
                          textAlign,
                          ...(metaTextStyle ?? {}),
                        }}
                      >
                        {labelText}
                      </strong>
                    ) : null}
                    {debugInfo ? (
                      <span
                        className="canvas-element-label"
                        style={{
                          display: 'block',
                          fontSize: '0.62rem',
                          color: '#98a2b3',
                          textAlign,
                        }}
                      >
                        {debugInfo}
                      </span>
                    ) : null}
                    <span
                      className="canvas-element-value"
                      style={{
                        fontSize: `${0.85 * getElementSettings(element).fontScale}rem`,
                        textAlign,
                        color: isPlaceholder ? '#98a2b3' : undefined,
                        opacity: isPlaceholder ? 0.7 : undefined,
                        ...(metaTextStyle ?? {}),
                        ...(valueMultilineStyle ?? {}),
                      }}
                    >
                      {valueText}
                    </span>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
      {guideElements}
      {hint && (
        <div
          style={{
            position: 'absolute',
            left: 16,
            bottom: 16,
            padding: '8px 10px',
            borderRadius: 10,
            background: 'rgba(16,24,40,0.85)',
            color: '#fff',
            fontSize: 12,
            zIndex: 1000,
          }}
        >
          {hint}
        </div>
      )}
      <div className="canvas-meta">
        <span className="canvas-pill">{snapEnabled ? 'SNAP ON' : 'SNAP OFF'}</span>
        {showGrid && <span className="canvas-pill">GRID</span>}
      </div>
    </div>
  );
};

const snapToGrid = (value: number) => Math.round(value / GRID_SIZE) * GRID_SIZE;

const clampToCanvas = (value: number, limit: number) => {
  if (Number.isNaN(value)) return 0;
  return Math.min(Math.max(value, 0), limit);
};

export default TemplateCanvas;
