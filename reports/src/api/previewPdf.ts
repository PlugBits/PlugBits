// src/api/previewPdf.ts
import type { TemplateDefinition } from '../../shared/template';

// Worker（ローカル）の URL
const WORKER_URL = 'http://localhost:8787/render';

export async function previewPdf(template: TemplateDefinition) {
  try {
    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        template,
        data: template.sampleData, // とりあえず sampleData を使う
      }),
    });

    if (!res.ok) {
      console.error('PDF render failed', await res.text());
      alert('PDF生成に失敗しました');
      return;
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
  } catch (e) {
    console.error(e);
    alert('PDF生成でエラーが発生しました');
  }
}
