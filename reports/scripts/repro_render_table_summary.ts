import { readFile } from 'node:fs/promises';
import { renderTemplateToPdf } from '../worker/src/pdf/renderTemplate.ts';
import type { TemplateDefinition, TemplateDataRecord } from '../shared/template.ts';

const loadJson = async <T>(path: string): Promise<T> => {
  const data = await readFile(new URL(path, import.meta.url), 'utf-8');
  return JSON.parse(data) as T;
};

const main = async () => {
  const payload = await loadJson<{ template: TemplateDefinition }>(
    '../req_summary.json',
  );
  const template = payload.template;
  const data: TemplateDataRecord = {
    Items: [
      {
        ItemName: 'Item A',
        Qty: '1',
        UnitPrice: '100',
        Amount: '100',
      },
    ],
    TotalAmount: '100',
  };

  const jp = await readFile(
    new URL('../worker/src/fonts/NotoSansJP-BusinessSubset.ttf', import.meta.url),
  );
  const latin = await readFile(
    new URL('../worker/src/fonts/Roboto-Regular.ttf', import.meta.url),
  );

  const { bytes } = await renderTemplateToPdf(
    template,
    data,
    { jp: new Uint8Array(jp), latin: new Uint8Array(latin) },
    { debug: true, previewMode: 'record', requestId: 'repro_summary' },
  );

  if (!bytes || bytes.byteLength === 0) {
    throw new Error('renderTemplateToPdf returned empty bytes');
  }

  console.log('[repro_render_table_summary] ok', { bytes: bytes.byteLength });
};

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('[repro_render_table_summary] failed', { error: message });
  process.exit(1);
});
