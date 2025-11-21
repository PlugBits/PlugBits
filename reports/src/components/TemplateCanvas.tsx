import { useEffect, useState } from 'react';
import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react';
import type { TemplateDefinition, TemplateElement } from '@shared/template.ts';

type CanvasProps = {
  template: TemplateDefinition;
  selectedElementId: string | null;
  onSelect: (element: TemplateElement | null) => void;
  onUpdateElement: (elementId: string, updates: Partial<TemplateElement>) => void;
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

const CANVAS_WIDTH = 595;
const CANVAS_HEIGHT = 842;
const GRID_SIZE = 5;

const getElementStyle = (element: TemplateElement): CSSProperties => {
  const base: CSSProperties = {
    left: `${element.x}px`,
    bottom: `${element.y}px`,
  };

  if ('width' in element && element.width) {
    base.width = `${element.width}px`;
  }

  if (element.type === 'table') {
    const header = element.headerHeight ?? 24;
    const rows = (element.rowHeight ?? 18) * 3;
    base.height = `${header + rows}px`;
  } else if (element.height) {
    base.height = `${element.height}px`;
  }

  return base;
};

const describeDataSource = (element: TemplateElement) => {
  if (element.type === 'table') {
    return `サブテーブル: ${element.dataSource.fieldCode}`;
  }

  if (element.type === 'label') {
    return element.text;
  }

  if (element.dataSource.type === 'static') {
    return element.dataSource.value;
  }

  return `{{${element.dataSource.fieldCode}}}`;
};

const TemplateCanvas = ({ template, selectedElementId, onSelect, onUpdateElement }: CanvasProps) => {
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [resizeState, setResizeState] = useState<ResizeState | null>(null);

  useEffect(() => {
    if (!dragState && !resizeState) return;

    const handleMove = (event: MouseEvent) => {
      event.preventDefault();

      if (dragState) {
        const deltaX = event.clientX - dragState.originX;
        const deltaY = event.clientY - dragState.originY;
        const nextX = clampToCanvas(snapToGrid(dragState.startX + deltaX), CANVAS_WIDTH);
        const nextY = clampToCanvas(snapToGrid(dragState.startY - deltaY), CANVAS_HEIGHT);
        onUpdateElement(dragState.id, { x: nextX, y: nextY });
      }

      if (resizeState) {
        const deltaX = event.clientX - resizeState.originX;
        const deltaY = event.clientY - resizeState.originY;
        const nextWidth = Math.max(20, snapToGrid(resizeState.startWidth + deltaX));
        const nextHeight = Math.max(12, snapToGrid(resizeState.startHeight + deltaY));
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
    onSelect(element);
    setDragState({
      id: element.id,
      originX: event.clientX,
      originY: event.clientY,
      startX: element.x,
      startY: element.y,
    });
  };

  const handleResizeMouseDown = (event: ReactMouseEvent<HTMLDivElement>, element: TemplateElement) => {
    event.stopPropagation();
    onSelect(element);
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

  return (
    <div className="template-canvas" onMouseDown={handleCanvasMouseDown}>
      {template.elements.map((element) => (
        <div
          key={element.id}
          className={`canvas-element${selectedElementId === element.id ? ' selected' : ''}`}
          style={getElementStyle(element)}
          onMouseDown={(event) => handleElementMouseDown(event, element)}
        >
          <strong style={{ display: 'block', fontSize: '0.7rem', color: '#475467' }}>{element.type}</strong>
          <span style={{ fontSize: '0.85rem' }}>{describeDataSource(element)}</span>
          {element.type !== 'table' && (
            <div className="resize-handle" onMouseDown={(event) => handleResizeMouseDown(event, element)} />
          )}
        </div>
      ))}
    </div>
  );
};

const snapToGrid = (value: number) => Math.round(value / GRID_SIZE) * GRID_SIZE;

const clampToCanvas = (value: number, limit: number) => {
  if (Number.isNaN(value)) return 0;
  return Math.min(Math.max(value, 0), limit);
};

export default TemplateCanvas;
