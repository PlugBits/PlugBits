import { useMemo } from 'react';
import type { ChangeEvent } from 'react';
import type {
  ImageElement,
  TableElement,
  TemplateElement,
  TextElement,
} from '@shared/template.ts';
import { useTemplateStore } from '../store/templateStore.ts';

type ElementInspectorProps = {
  templateId: string;
  element: TemplateElement | null;
};

const ElementInspector = ({ templateId, element }: ElementInspectorProps) => {
  const updateElement = useTemplateStore((state) => state.updateElement);

  const coordinatesLabel = useMemo(() => {
    if (!element) return '';
    return `X: ${element.x}px / Y: ${element.y}px`;
  }, [element]);

  if (!element) {
    return <p style={{ color: '#475467' }}>編集する要素をキャンバスから選択してください。</p>;
  }

  const handleNumberChange = (field: keyof TemplateElement) => (event: ChangeEvent<HTMLInputElement>) => {
    const value = Number(event.target.value);
    updateElement(templateId, element.id, { [field]: Number.isNaN(value) ? 0 : value });
  };

  const renderTextControls = (textElement: TextElement) => (
    <>
      <label>
        フォントサイズ
        <input type="number" value={textElement.fontSize ?? 12} onChange={handleNumberChange('fontSize')} />
      </label>
      <label>
        フィールドコード
        <input
          type="text"
          value={textElement.dataSource.type === 'static' ? textElement.dataSource.value : textElement.dataSource.fieldCode}
          onChange={(event) => {
            const payload = textElement.dataSource.type === 'static'
              ? { ...textElement.dataSource, value: event.target.value }
              : { ...textElement.dataSource, fieldCode: event.target.value };
            updateElement(templateId, element.id, { dataSource: payload } as Partial<TemplateElement>);
          }}
        />
      </label>
    </>
  );

  const renderTableControls = (tableElement: TableElement) => (
    <>
      <label>
        行の高さ
        <input
          type="number"
          value={tableElement.rowHeight ?? 18}
          onChange={(event) => {
            const value = Number(event.target.value);
            updateElement(templateId, element.id, { rowHeight: Number.isNaN(value) ? 18 : value } as Partial<TemplateElement>);
          }}
        />
      </label>
      <label>
        ヘッダー高さ
        <input
          type="number"
          value={tableElement.headerHeight ?? 24}
          onChange={(event) => {
            const value = Number(event.target.value);
            updateElement(templateId, element.id, { headerHeight: Number.isNaN(value) ? 24 : value } as Partial<TemplateElement>);
          }}
        />
      </label>
    </>
  );

  const renderImageControls = (imageElement: ImageElement) => (
    <label>
      画像ID
      <input
        type="text"
        value={imageElement.dataSource.value}
        onChange={(event) => {
          updateElement(templateId, element.id, {
            dataSource: { ...imageElement.dataSource, value: event.target.value },
          } as Partial<TemplateElement>);
        }}
      />
    </label>
  );

  return (
    <div className="inspector-fields">
      <p style={{ margin: 0, color: '#101828', fontWeight: 600 }}>{element.type.toUpperCase()}</p>
      <p style={{ margin: 0, color: '#475467', fontSize: '0.85rem' }}>{coordinatesLabel}</p>

      <label>
        X 座標
        <input type="number" value={element.x} onChange={handleNumberChange('x')} />
      </label>
      <label>
        Y 座標
        <input type="number" value={element.y} onChange={handleNumberChange('y')} />
      </label>

      {element.type !== 'table' && (
        <>
          <label>
            幅
            <input
              type="number"
              value={element.width ?? 120}
              onChange={handleNumberChange('width')}
            />
          </label>
          <label>
            高さ
            <input
              type="number"
              value={element.height ?? 32}
              onChange={handleNumberChange('height')}
            />
          </label>
        </>
      )}

      {element.type === 'text' && renderTextControls(element)}
      {element.type === 'table' && renderTableControls(element)}
      {element.type === 'image' && renderImageControls(element)}
    </div>
  );
};

export default ElementInspector;
