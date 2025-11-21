import { useMemo, useEffect, useState } from 'react';
import type { ChangeEvent } from 'react';
import type {
  ImageElement,
  LabelElement,
  TableElement,
  TableColumn,
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
  const [labelDraft, setLabelDraft] = useState('');

  useEffect(() => {
    if (element?.type === 'label') {
      setLabelDraft(element.text);
    }
  }, [element]);

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
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
        <label>
          行の高さ
          <input
            type="number"
            value={tableElement.rowHeight ?? 18}
            onChange={(event) => {
              const value = Number(event.target.value);
              updateElement(templateId, element.id, {
                rowHeight: Number.isNaN(value) ? 18 : value,
              });
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
              updateElement(templateId, element.id, {
                headerHeight: Number.isNaN(value) ? 24 : value,
              });
            }}
          />
        </label>
      </div>
      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <input
          type="checkbox"
          checked={tableElement.showGrid ?? true}
          onChange={(event) => updateElement(templateId, element.id, { showGrid: event.target.checked })}
        />
        グリッド線を表示
      </label>

      <div style={{ marginTop: '0.5rem' }}>
        <p style={{ margin: '0 0 0.5rem', fontWeight: 600 }}>列設定</p>
        {tableElement.columns.map((column, index) => (
          <div key={column.id} style={{ border: '1px solid #e4e7ec', padding: '0.5rem', borderRadius: '0.6rem', marginBottom: '0.5rem' }}>
            <label>
              列名
              <input
                type="text"
                value={column.title}
                onChange={(event) => updateTableColumn(tableElement, index, { title: event.target.value }, templateId, element)}
              />
            </label>
            <label>
              フィールドコード
              <input
                type="text"
                value={column.fieldCode}
                onChange={(event) => updateTableColumn(tableElement, index, { fieldCode: event.target.value }, templateId, element)}
              />
            </label>
            <label>
              幅
              <input
                type="number"
                value={column.width}
                onChange={(event) => updateTableColumn(tableElement, index, { width: Number(event.target.value) || column.width }, templateId, element)}
              />
            </label>
            <label>
              文字揃え
              <select
                value={column.align ?? 'left'}
                onChange={(event) => updateTableColumn(tableElement, index, { align: event.target.value as TableColumn['align'] }, templateId, element)}
              >
                <option value="left">左</option>
                <option value="center">中央</option>
                <option value="right">右</option>
              </select>
            </label>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem' }}>
              <button
                type="button"
                className="ghost"
                onClick={() => addTableColumn(tableElement, index, templateId, element)}
              >
                列を追加
              </button>
              {tableElement.columns.length > 1 && (
                <button
                  type="button"
                  className="ghost"
                  style={{ color: '#b42318', borderColor: '#fda29b' }}
                  onClick={() => removeTableColumn(tableElement, index, templateId, element)}
                >
                  削除
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
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
      {element.type === 'label' &&
        renderLabelControls(labelDraft, setLabelDraft, templateId, element, updateElement)}
      {element.type === 'table' && renderTableControls(element)}
      {element.type === 'image' && renderImageControls(element)}
    </div>
  );
};

const updateTableColumn = (
  tableElement: TableElement,
  index: number,
  updates: Partial<TableColumn>,
  templateId: string,
  element: TemplateElement,
) => {
  const nextColumns = tableElement.columns.map((column, idx) => (idx === index ? { ...column, ...updates } : column));
  useTemplateStore.getState().updateElement(templateId, element.id, { columns: nextColumns } as Partial<TemplateElement>);
};

const addTableColumn = (
  tableElement: TableElement,
  index: number,
  templateId: string,
  element: TemplateElement,
) => {
  const newColumn: TableColumn = {
    id: `col_${Date.now()}`,
    title: '新しい列',
    fieldCode: 'FieldCode',
    width: 120,
  };
  const nextColumns = [...tableElement.columns];
  nextColumns.splice(index + 1, 0, newColumn);
  useTemplateStore.getState().updateElement(templateId, element.id, { columns: nextColumns } as Partial<TemplateElement>);
};

const removeTableColumn = (
  tableElement: TableElement,
  index: number,
  templateId: string,
  element: TemplateElement,
) => {
  const nextColumns = tableElement.columns.filter((_, idx) => idx !== index);
  useTemplateStore.getState().updateElement(templateId, element.id, { columns: nextColumns } as Partial<TemplateElement>);
};

const renderLabelControls = (
  labelDraft: string,
  setLabelDraft: (value: string) => void,
  templateId: string,
  element: TemplateElement,
  updateElement: (templateId: string, elementId: string, updates: Partial<TemplateElement>) => void,
) => (
  <>
    <label>
      テキスト
      <input
        type="text"
        value={labelDraft}
        onChange={(event) => {
          const value = event.target.value;
          setLabelDraft(value);
          updateElement(templateId, element.id, { text: value } as Partial<TemplateElement>);
        }}
      />
    </label>
    <label>
      フォントサイズ
      <input
        type="number"
        value={(element as LabelElement).fontSize ?? 12}
        onChange={(event) => {
          const value = Number(event.target.value);
          updateElement(templateId, element.id, {
            fontSize: Number.isNaN(value) ? 12 : value,
          } as Partial<TemplateElement>);
        }}
      />
    </label>
  </>
);

export default ElementInspector;
