import type { TemplateDataRecord, TemplateDefinition } from '@shared/template.ts';

const WORKER_BASE_URL = import.meta.env.VITE_WORKER_BASE_URL ?? 'http://localhost:8787';
const WORKER_API_KEY = import.meta.env.VITE_WORKER_API_KEY;

export const requestPreviewPdf = async (
  template: TemplateDefinition,
  data: TemplateDataRecord,
): Promise<Blob> => {
  const response = await fetch(`${WORKER_BASE_URL}/render-preview`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(WORKER_API_KEY ? { 'x-api-key': WORKER_API_KEY } : {}),
    },
    body: JSON.stringify({ templateId: template.id, template, data }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || 'PDF preview failed');
  }

  return response.blob();
};
