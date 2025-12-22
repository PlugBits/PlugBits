// src/editor/Mapping/MappingPage.tsx
import React, { useEffect, useMemo } from 'react';
import type { TemplateDefinition } from '@shared/template';
import { getAdapter } from './adapters/getAdapter';
import RegionMappingPanel from './components/RegionMappingPanel';


type Props = {
  template: TemplateDefinition;
  updateTemplate: (template: TemplateDefinition) => void;
  onFocusFieldRef: (ref: any) => void;      // MVP: any（後で FieldRef に寄せる）
  onClearFocus: () => void;
};

const MappingPage: React.FC<Props> = ({ template, updateTemplate, onFocusFieldRef, onClearFocus }) => {
  const structureType = template.structureType ?? 'line_items_v1';
  const adapter = useMemo(() => getAdapter(structureType), [structureType]);

  // mapping が無ければ default 注入（後方互換）
  useEffect(() => {
    const baseMapping = template.mapping ?? adapter.createDefaultMapping();
    const next = adapter.applyMappingToTemplate(
      { ...template, structureType, mapping: baseMapping },
      baseMapping,
    );

    // すでに同値なら updateしない（無限ループ防止）
    // ※ 雑でOKなら JSON.stringify 比較でも良い
    if (JSON.stringify(next) !== JSON.stringify(template)) {
      updateTemplate(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template.id, structureType, adapter]);


  const mapping = template.mapping ?? adapter.createDefaultMapping();
  const validation = adapter.validate(mapping);

  const onChangeMapping = (nextMapping: any) => {  
    const next = adapter.applyMappingToTemplate(
      { ...template, structureType }, // 念のためstructureType固定
      nextMapping,
    );
    updateTemplate(next);
  };


  return (
    <section>
      <div className="mapping-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <h3 style={{ margin: 0 }}>フィールド割当</h3>
            <span className="mapping-badge">{adapter.structureType}</span>
          </div>

          <div className={validation.ok ? 'mapping-status ok' : 'mapping-status ng'}>
            {validation.ok ? '✅ 必須項目OK' : `❌ 未完了 ${validation.errors.length}`}
          </div>
        </div>

        {!validation.ok && (
          <div style={{ marginTop: 10 }}>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {validation.errors.map((e, idx) => (
                <li key={idx}>
                  <code>{e.path}</code>：{e.message}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>


      {adapter.regions.map((region) => (
        <RegionMappingPanel
          key={region.id}
          template={template}
          region={region}
          mapping={mapping}
          onChangeMapping={onChangeMapping}
          onFocusFieldRef={onFocusFieldRef}
          onClearFocus={onClearFocus}
        />
      ))}
    </section>
  );
};

export default MappingPage;
