import type { TemplateDefinition } from '@shared/template';

const API_BASE_URL = (import.meta.env.VITE_REPORTS_API_BASE_URL as string | undefined)
  ?? 'http://127.0.0.1:8787';

export async function previewPdf(template: TemplateDefinition) {
  const res = await fetch(`${API_BASE_URL}/render`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ template, data: template.sampleData }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Render failed: ${res.status} ${text}`);
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank');
}
