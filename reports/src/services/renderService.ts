import type { TemplateDataRecord, TemplateDefinition } from '@shared/template';
const WORKER_BASE_URL =
  (import.meta.env.VITE_WORKER_BASE_URL as string) ||
  "https://plugbits-reports.b-otkyaaa.workers.dev";

const API_KEY = import.meta.env.VITE_WORKER_API_KEY as string | undefined;

function buildHeaders() {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (API_KEY) {
    headers["x-api-key"] = API_KEY;
  }
  return headers;
}

export async function requestPreviewPdf(
  template: TemplateDefinition,
  data?: TemplateDataRecord,
): Promise<Blob> {
  const res = await fetch(`${WORKER_BASE_URL}/render-preview`, {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify({
      templateId: template.id,
      template,
      data,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    console.error("requestPreviewPdf error:", res.status, text);
    throw new Error(text || "Failed to render preview");
  }

  return await res.blob();
}