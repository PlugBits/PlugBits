import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react';
import type { TemplateDefinition, TemplateElement, DataSource } from '@shared/template';
import { CANVAS_WIDTH, CANVAS_HEIGHT, REGION_BOUNDS, getRegionOf, clampYToRegion } from '../utils/regionBounds';


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

const resolveAlignedX = (element: TemplateElement, width: number) => {
  const alignX = (element as any).alignX as 'left' | 'center' | 'right' | undefined;
  if (!alignX) return element.x;
  const safeWidth = Number.isFinite(width) ? width : 0;
  if (safeWidth <= 0) return element.x;
  if (alignX === 'left') return ALIGN_PADDING;
  if (alignX === 'center') return (CANVAS_WIDTH - safeWidth) / 2;
  if (alignX === 'right') return CANVAS_WIDTH - safeWidth - ALIGN_PADDING;
  return element.x;
};

const getElementStyle = (element: TemplateElement): CSSProperties => {
  const widthValue = getElementWidthValue(element);
  const base: CSSProperties = {
    left: `${resolveAlignedX(element, widthValue)}px`,
    bottom: `${element.y}px`,
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

const describeDataSource = (element: TemplateElement) => {
  // table
  if (element.type === 'table') {
    const ds = element.dataSource;
    return ds ? `サブテーブル: ${ds.fieldCode}` : 'サブテーブル: (未設定)';
  }
  if (element.type === 'cardList') {
    const ds = element.dataSource;
    return ds ? `サブテーブル: ${ds.fieldCode}` : 'サブテーブル: (未設定)';
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
}: CanvasProps) => {
  const isAdvanced = !!template.advancedLayoutEditing;

  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [resizeState, setResizeState] = useState<ResizeState | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const selectedElement = selectedElementId
    ? template.elements.find((el) => el.id === selectedElementId)
    : null;

  const canvasStyle: CSSProperties = showGrid
    ? {
        backgroundImage:
          'linear-gradient(90deg, rgba(15,23,42,0.05) 1px, transparent 1px), linear-gradient(0deg, rgba(15,23,42,0.05) 1px, transparent 1px)',
        backgroundSize: `${GRID_SIZE * 4}px ${GRID_SIZE * 4}px`,
        backgroundColor: '#fff',
      }
    : { backgroundColor: '#fff' };

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
        const bounds = REGION_BOUNDS[region];

        const nextX = clampToCanvas(applySnap(dragState.startX + deltaX), CANVAS_WIDTH);
        const rawY = applySnap(dragState.startY - deltaY);

        // region内に収める（yはbottom基準）
        const nextY = clampYToRegion(rawY, region);
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
          y: CANVAS_HEIGHT - (event.clientY - rect.top),
        }
      : null;

    const hitList = point
      ? template.elements.filter((el) => {
          const width = getElementWidthValue(el);
          const height = getElementHeightValue(el);
          const left = resolveAlignedX(el, width);
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
        const alignedX = resolveAlignedX(selectedElement, width);
        const badgeLeft = Math.min(alignedX + width + 12, CANVAS_WIDTH - 80);
        const badgeBottom = Math.min(selectedElement.y + height + 12, CANVAS_HEIGHT - 24);
        return (
          <>
            <div className="canvas-guide horizontal" style={{ bottom: `${selectedElement.y}px` }} />
            <div className="canvas-guide vertical" style={{ left: `${alignedX}px` }} />
            <div className="canvas-coord-badge" style={{ left: `${badgeLeft}px`, bottom: `${badgeBottom}px` }}>
              {Math.round(alignedX)}px / {selectedElement.y}px
            </div>
          </>
        );
      })()
    : null;

  return (
    <div className="template-canvas" style={canvasStyle} onMouseDown={handleCanvasMouseDown} ref={canvasRef}>
      {template.elements.map((element) => (
        <div
          key={element.id}
          className={[
            'canvas-element',
            selectedElementId === element.id ? 'selected' : '',
            highlightedElementIds?.has(element.id) ? 'highlighted' : '',
          ].filter(Boolean).join(' ')}
          style={{
            ...getElementStyle(element),
            zIndex: selectedElementId === element.id ? 50 : highlightedElementIds?.has(element.id) ? 40 : undefined,
          }}
          onMouseDown={(event) => handleElementMouseDown(event, element)}
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
          ) : (
            <>
              <strong
                style={{
                  display: 'block',
                  fontSize: '0.7rem',
                  color: slotLabels?.[(element as any).slotId] ? '#344054' : '#475467',
                }}
              >
                {slotLabels?.[(element as any).slotId] ?? element.type}
              </strong>
              <span style={{ fontSize: '0.85rem' }}>{describeDataSource(element)}</span>
            </>
          )}
          {isAdvanced && element.type !== 'table' && element.type !== 'cardList' && (
            <div className="resize-handle" onMouseDown={(event) => handleResizeMouseDown(event, element)} />
          )}

        </div>
      ))}
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
