import { useMemo, useEffect, useState } from 'react';
import type { ChangeEvent } from 'react';
import type {
  ImageElement,
  LabelElement,
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
    if (isTable || isCardList) return;
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
    const structureType = template.structureType ?? 'list_v1';
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

  const slotDefs = useMemo(() => {
    if (!template) return [];
    const structureType = template.structureType ?? 'list_v1';
    const adapter = getAdapter(structureType);
    const defs: Array<{
      slotId: string;
      label: string;
      kind: string;
      region: 'header' | 'footer';
      required?: boolean;
    }> = [];
    for (const region of adapter.regions) {
      if (region.kind !== 'slots') continue;
      const regionId = region.id as 'header' | 'footer';
      for (const slot of region.slots) {
        defs.push({
          slotId: slot.id,
          label: slot.label,
          kind: slot.kind,
          region: regionId,
          required: slot.required,
        });
      }
    }
    return defs;
  }, [template?.structureType, template?.id]);

  const typeLabel = useMemo(() => {
    if (!element) return '';
    if (element.type === 'text') return 'テキスト';
    if (element.type === 'label') return 'ラベル';
    if (element.type === 'image') return '画像';
    if (element.type === 'table') return 'テーブル';
    if (element.type === 'cardList') return 'カード枠';
    return '要素';
  }, [element?.type]);

  const displayName = useMemo(() => {
    if (!element) return '';
    const slotId = (element as any).slotId as string | undefined;
    if (slotId && slotLabelMap[slotId]) return slotLabelMap[slotId];
    return typeLabel;
  }, [element, slotLabelMap, typeLabel]);

  if (!element) {
    return <p style={{ color: '#475467' }}>要素を選択してください。</p>;
  }

  const isTable = element.type === 'table';
  const isCardList = element.type === 'cardList';
  const currentSlotId = (element as any).slotId as string | undefined;
  const currentSlotDef = slotDefs.find((slot) => slot.slotId === currentSlotId);
  const isSlotElement = !!currentSlotId;
  // レイアウト編集可否（tableは常に固定）
  const canEditLayoutForElement = isAdvanced && !isTable && !isCardList;

  // region編集可否（tableは常に固定：body）
  const canEditRegionForElement = isAdvanced && !isTable && !isCardList;


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

  const renderTextControls = (textElement: TextElement) => (
    <>
      <label>
        フォントサイズ
        <input type="number" value={textElement.fontSize ?? 12} onChange={handleFontSizeChange} />
      </label>
      <p style={{ margin: '0.25rem 0 0', color: '#667085', fontSize: '0.8rem' }}>
        データソースの設定は「フィールド割当」タブで行ってください。
      </p>
    </>
  );

  const renderImageControls = (_imageElement: ImageElement) => (
    <p style={{ margin: '0.25rem 0 0', color: '#667085', fontSize: '0.8rem' }}>
      データソースの設定は「フィールド割当」タブで行ってください。
    </p>
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

      {element.type !== 'table' && element.type !== 'cardList' && slotDefs.length > 0 && (
        <label>
          スロット
          <select
            value={currentSlotId ?? ''}
            onChange={(event) => {
              const nextSlotId = event.target.value;
              if (!nextSlotId) {
                if (currentSlotDef?.required) return;
                updateElement(templateId, element.id, { slotId: undefined } as Partial<TemplateElement>);
                return;
              }

              const slotDef = slotDefs.find((slot) => slot.slotId === nextSlotId);
              const nextRegion = slotDef?.region ?? (element.region as any) ?? 'header';
              const nextY = clampYToRegion(element.y, nextRegion);
              const isImageSlot = slotDef?.kind === 'image';

              if (isImageSlot) {
                const nextDataSource =
                  element.type === 'image'
                    ? element.dataSource
                    : { type: 'static', value: '' };
                updateElement(templateId, element.id, {
                  slotId: nextSlotId,
                  region: nextRegion,
                  y: nextY,
                  type: 'image',
                  width: element.width ?? 120,
                  height: element.height ?? 60,
                  dataSource: nextDataSource,
                } as Partial<TemplateElement>);
                return;
              }

              const nextDataSource =
                element.type === 'text'
                  ? element.dataSource
                  : { type: 'static', value: element.type === 'label' ? element.text ?? '' : '' };

              updateElement(templateId, element.id, {
                slotId: nextSlotId,
                region: nextRegion,
                y: nextY,
                type: 'text',
                fontSize: (element as any).fontSize ?? 12,
                dataSource: nextDataSource,
              } as Partial<TemplateElement>);
            }}
          >
            <option value="" disabled={!!currentSlotDef?.required}>
              （スロットなし）
            </option>
            <optgroup label="ヘッダー">
              {slotDefs
                .filter((slot) => slot.region === 'header')
                .map((slot) => (
                  <option key={slot.slotId} value={slot.slotId}>
                    {slot.label}
                  </option>
                ))}
            </optgroup>
            <optgroup label="フッター">
              {slotDefs
                .filter((slot) => slot.region === 'footer')
                .map((slot) => (
                  <option key={slot.slotId} value={slot.slotId}>
                    {slot.label}
                  </option>
                ))}
            </optgroup>
          </select>
        </label>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
        <button
          type="button"
          className="ghost"
          style={{
            color: isSlotElement || !isAdvanced ? '#98a2b3' : '#b42318',
            borderColor: isSlotElement || !isAdvanced ? '#e4e7ec' : '#fda29b',
            cursor: isSlotElement || !isAdvanced ? 'not-allowed' : 'pointer',
          }}
          disabled={isSlotElement || !isAdvanced}
          title={
            isSlotElement
              ? 'この要素はテンプレ構造上必須のため削除できません'
              : !isAdvanced
              ? '初心者モードでは削除できません'
              : undefined
          }
          onClick={() => {
            if (!isSlotElement && isAdvanced) {
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
    
      {isAdvanced && (
        <>
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

          {element.type !== 'table' && element.type !== 'cardList' && (
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
      {element.type === 'cardList' && (
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
          カード枠は固定です。フィールドの割当は「フィールド割当」タブで行ってください。
        </div>
      )}

      {element.type === 'image' && renderImageControls(element )}
    </div>
  );
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
