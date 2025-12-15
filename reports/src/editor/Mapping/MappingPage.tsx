// src/editor/Mapping/MappingPage.tsx
import React, { useEffect, useMemo } from 'react';
import type { TemplateDefinition } from '@shared/template';
import { getAdapter } from './adapters/getAdapter';
import RegionMappingPanel from './components/RegionMappingPanel';

type Props = {
  template: TemplateDefinition;
  updateTemplate: (template: TemplateDefinition) => void;
};

const MappingPage: React.FC<Props> = ({ template, updateTemplate }) => {
  const structureType = template.structureType ?? 'line_items_v1';
  const adapter = useMemo(() => getAdapter(structureType), [structureType]);

  // mapping が無ければ default 注入（後方互換）
  useEffect(() => {
    if (!template.mapping || template.structureType !== structureType) {
      updateTemplate({
        ...template,
        structureType,
        mapping: template.mapping ?? adapter.createDefaultMapping(),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template.id, structureType, adapter]);

  const mapping = template.mapping ?? adapter.createDefaultMapping();
  const validation = adapter.validate(mapping);

  const onChangeMapping = (nextMapping: any) => {
    updateTemplate({ ...template, mapping: nextMapping });
  };

  return (
    <section>
      <div className="card" style={{ marginBottom: '1rem' }}>
        <h3 style={{ marginTop: 0 }}>フィールド割当（{adapter.structureType}）</h3>

        <div style={{ marginBottom: 10, opacity: 0.85 }}>
          {validation.ok ? <span>✅ 必須項目OK</span> : <span>❌ 必須未完了：{validation.errors.length}件</span>}
        </div>

        {!validation.ok && (
          <ul style={{ margin: 0 }}>
            {validation.errors.map((e, idx) => (
              <li key={idx}>
                <code>{e.path}</code>：{e.message}
              </li>
            ))}
          </ul>
        )}
      </div>

      {adapter.regions.map((region) => (
        <RegionMappingPanel
          key={region.id}
          template={template}
          region={region}
          mapping={mapping}
          onChangeMapping={onChangeMapping}
        />
      ))}
    </section>
  );
};

export default MappingPage;
