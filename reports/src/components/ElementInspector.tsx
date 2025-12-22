import { useMemo, useEffect, useState } from 'react';
import type { ChangeEvent } from 'react';
import type {
  DataSource,
  ImageElement,
  LabelElement,
  TableElement,
  TableColumn,
  TemplateElement,
  TextElement,
} from '@shared/template';
import { useTemplateStore } from '../store/templateStore';
import { selectTemplateById } from '../store/templateStore';
import { clampYToRegion } from '../utils/regionBounds';
import { getAdapter } from '../editor/Mapping/adapters/getAdapter';



type ElementInspectorProps = {
  templateId: string;
  element: TemplateElement | null;
};

const ElementInspector = ({ templateId, element }: ElementInspectorProps) => {
  const template = useTemplateStore((s) => selectTemplateById(s, templateId));
  const isAdvanced = !!template?.advancedLayoutEditing;

  // 通常モードではレイアウト系（X/Y/幅/高さ）はロック（上級者のみ）
  const canEditLayout = isAdvanced;

  const updateElement = useTemplateStore((state) => state.updateElement);
  const removeElement = useTemplateStore((state) => state.removeElement);

  const [labelDraft, setLabelDraft] = useState('');
  const commitNumber = (
    elementId: string,
    field: 'x' | 'y' | 'width' | 'height',
    raw: string,
  ) => {
    if (isTable) return;
    const trimmed = raw.trim();
    if (trimmed === '') return;

    const n = Number(trimmed);
    if (Number.isNaN(n)) return;

    updateElement(templateId, elementId, { [field]: n } as Partial<TemplateElement>);
  };

  const [xDraft, setXDraft] = useState('');
  const [yDraft, setYDraft] = useState('');
  const [wDraft, setWDraft] = useState('');
  const [hDraft, setHDraft] = useState('');

  useEffect(() => {
    if (element?.type === 'label') {
      setLabelDraft(element.text ?? '');
    }
  }, [element]);

  useEffect(() => {
    if (!element) return;
    setXDraft(String(element.x ?? 0));
    setYDraft(String(element.y ?? 0));
    setWDraft(String(element.width ?? 120));
    setHDraft(String(element.height ?? 32));
  }, [element?.id]);


  const coordinatesLabel = useMemo(() => {
    if (!element) return '';
    return `X: ${element.x}px / Y: ${element.y}px`;
  }, [element]);

  const slotLabelMap = useMemo(() => {
    if (!template) return {};
    const structureType = template.structureType ?? 'line_items_v1';
    const adapter = getAdapter(structureType);
    const map: Record<string, string> = {};
    for (const region of adapter.regions) {
      if (region.kind !== 'slots') continue;
      for (const slot of region.slots) {
        map[slot.id] = slot.label;
      }
    }
    return map;
  }, [template?.structureType, template?.id]);

  const typeLabel = useMemo(() => {
    if (!element) return '';
    if (element.type === 'text') return 'テキスト';
    if (element.type === 'label') return 'ラベル';
    if (element.type === 'image') return '画像';
    if (element.type === 'table') return 'テーブル';
    return '要素';
  }, [element?.type]);

  const displayName = useMemo(() => {
    if (!element) return '';
    const slotId = (element as any).slotId as string | undefined;
    if (slotId && slotLabelMap[slotId]) return slotLabelMap[slotId];
    return typeLabel;
  }, [element, slotLabelMap, typeLabel]);

  if (!element) {
    return <p style={{ color: '#475467' }}>編集する要素をキャンバスから選択してください。</p>;
  }

  const isTable = element.type === 'table';
  const isSlotElement = !!(element as any).slotId;

  // レイアウト編集可否（tableは常に固定）
  const canEditLayoutForElement = isAdvanced && !isTable;

  // region編集可否（tableは常に固定：body）
  const canEditRegionForElement = isAdvanced && !isTable;


  const handleNumberChange =
  (field: keyof TemplateElement) => (event: ChangeEvent<HTMLInputElement>) => {
    const raw = event.target.value;

    // ✅ 入力途中の空文字は許容（0に戻さない）
    if (raw === '') return;

    const value = Number(raw);
    if (Number.isNaN(value)) return;

    updateElement(templateId, element.id, { [field]: value } as Partial<TemplateElement>);
  };


  const handleFontSizeChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = Number(event.target.value);
    const next = Number.isNaN(value) ? 12 : value;

    updateElement(templateId, element.id, { fontSize: next } as Partial<TemplateElement>);
  };

  const ensureDataSource = (ds: any): DataSource => {
    if (ds) return ds as DataSource;
    return { type: 'static', value: '' };
  };

  const renderTextControls = (textElement: TextElement) => (
    <>
      <label>
        フォントサイズ
        <input type="number" value={textElement.fontSize ?? 12} onChange={handleFontSizeChange} />
        
      </label>
      {renderDataSourceControls(ensureDataSource(textElement.dataSource), (next) =>
        updateElement(templateId, element.id, { dataSource: next } as Partial<TemplateElement>),
      )}
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

      <label>
        サブテーブルフィールド
        <input
          type="text"
          value={tableElement.dataSource.fieldCode}
          onChange={(event) =>
            updateElement(templateId, element.id, {
              dataSource: { ...tableElement.dataSource, fieldCode: event.target.value },
            } as Partial<TemplateElement>)
          }
        />
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

  const renderImageControls = (imageElement: ImageElement) =>
    renderDataSourceControls(
      imageElement.dataSource,
      (next) =>
        updateElement(templateId, element.id, {
          dataSource: next,
        } as Partial<TemplateElement>),
      ['static'],
    );

  return (
    <div className="inspector-fields">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <div style={{ margin: 0, color: '#101828', fontWeight: 700, fontSize: '0.95rem' }}>
          {displayName}
        </div>
        <span
          style={{
            fontSize: '0.7rem',
            fontWeight: 600,
            padding: '2px 6px',
            borderRadius: 999,
            background: '#f2f4f7',
            color: '#475467',
          }}
        >
          {typeLabel}
        </span>
      </div>
      <p style={{ margin: '2px 0 0', color: '#475467', fontSize: '0.8rem' }}>{coordinatesLabel}</p>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
        <button
          type="button"
          className="ghost"
          style={{
            color: isSlotElement ? '#98a2b3' : '#b42318',
            borderColor: isSlotElement ? '#e4e7ec' : '#fda29b',
            cursor: isSlotElement ? 'not-allowed' : 'pointer',
          }}
          disabled={isSlotElement}
          title={isSlotElement ? 'この要素はテンプレ構造上必須のため削除できません' : undefined}
          onClick={() => {
            if (!isSlotElement) {
              removeElement(templateId, element.id);
            }
          }}
        >
          この要素を削除
        </button>
      </div>

          
    {canEditRegionForElement && (
      <label>
        領域（region）
        <select
          value={element.region ?? 'body'}
          onChange={(e) => {
            const nextRegion = e.target.value as 'header' | 'body' | 'footer';
            const nextY = clampYToRegion(element.y, nextRegion);
            updateElement(templateId, element.id, {
              region: nextRegion,
              y: nextY,
            } as Partial<TemplateElement>);
          }}
        >
          <option value="header">header</option>
          <option value="body">body</option>
          <option value="footer">footer</option>
        </select>
      </label>
    )}
    
      <label>
        X 座標
        <input
          inputMode="numeric"
          value={xDraft}
          onChange={(e) => setXDraft(e.target.value)}
          onBlur={() => commitNumber(element.id,'x', xDraft)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
          }}
          disabled={!canEditLayoutForElement}
        />

      </label>
      <label>
        Y 座標
        <input
          inputMode="numeric"
          value={yDraft}
          onChange={(e) => setYDraft(e.target.value)}
          onBlur={() => commitNumber(element.id,'y', yDraft)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
          }}
          disabled={!canEditLayoutForElement}
        />

      </label>
      {!canEditLayout && (
        <p style={{ margin: '0.25rem 0 0', color: '#667085', fontSize: '0.8rem' }}>
          レイアウト（X/Y）の編集は「テンプレ設定 → 上級者モード」をONにすると有効になります。
        </p>
      )}


      {element.type !== 'table' && (
        <>
          <label>
            幅
            <input
              inputMode="numeric"
              value={wDraft}
              onChange={(e) => setWDraft(e.target.value)}
              onBlur={() => commitNumber(element.id,'width', wDraft)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
              }}
              disabled={!canEditLayoutForElement}
            />
          </label>
          <label>
            高さ
            <input
              inputMode="numeric"
              value={hDraft}
              onChange={(e) => setHDraft(e.target.value)}
              onBlur={() => commitNumber(element.id,'height', hDraft)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
              }}
              disabled={!canEditLayoutForElement}
            />
          </label>
        </>
      )}

      {element.type === 'text' && renderTextControls(element as TextElement)}
      {element.type === 'label' &&
        renderLabelControls(labelDraft, setLabelDraft, templateId, element as TextElement, updateElement)}
      {element.type === 'table' && (
        <div
          style={{
            marginTop: '0.75rem',
            padding: '0.75rem',
            border: '1px solid #e4e7ec',
            borderRadius: '0.6rem',
            color: '#475467',
            lineHeight: 1.5,
          }}
        >
          明細テーブルは固定です。列・サブテーブル・幅の設定は「フィールド割当」タブで行ってください。
        </div>
      )}

      {element.type === 'image' && renderImageControls(element )}
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

const renderDataSourceControls = (
  dataSource: DataSource,
  onChange: (next: DataSource) => void,
  allowedTypes: DataSource['type'][] = ['static', 'kintone', 'kintoneSubtable'],
) => {
  const typeOptions = allowedTypes;
  const handleTypeChange = (nextType: DataSource['type']) => {
    if (nextType === dataSource.type) return;
    if (nextType === 'static') {
      onChange({ type: 'static', value: '' });
      return;
    }
    onChange({ type: nextType, fieldCode: '' });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <label>
        データソース種別
        <select
          value={dataSource.type}
          onChange={(event) => handleTypeChange(event.target.value as DataSource['type'])}
          disabled={typeOptions.length === 1}
        >
          {typeOptions.map((type) => (
            <option key={type} value={type}>
              {type === 'static' ? '固定文字' : type === 'kintone' ? 'kintone フィールド' : 'kintone サブテーブル'}
            </option>
          ))}
        </select>
      </label>
      {dataSource.type === 'static' ? (
        <label>
          固定テキスト
          <input
            type="text"
            value={dataSource.value}
            onChange={(event) => onChange({ type: 'static', value: event.target.value })}
          />
        </label>
      ) : (
        <label>
          フィールドコード
          <input
            type="text"
            value={dataSource.fieldCode}
            onChange={(event) =>
              onChange({ type: dataSource.type, fieldCode: event.target.value })
            }
          />
        </label>
      )}
    </div>
  );
};

export default ElementInspector;
