import type { TemplateDefinition } from '@shared/template.ts';

const WORKER_BASE_URL = import.meta.env.VITE_WORKER_BASE_URL ?? 'http://localhost:8787';
const WORKER_API_KEY = import.meta.env.VITE_WORKER_API_KEY;

const buildHeaders = () => ({
  'Content-Type': 'application/json',
  ...(WORKER_API_KEY ? { 'x-api-key': WORKER_API_KEY } : {}),
});

const handleResponse = async <T>(response: Response): Promise<T> => {
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || 'API request failed');
  }
  return (await response.json()) as T;
};

export const fetchTemplates = async (): Promise<TemplateDefinition[]> => {
  const response = await fetch(`${WORKER_BASE_URL}/templates`, {
    method: 'GET',
    headers: buildHeaders(),
  });
  const payload = await handleResponse<{ templates: TemplateDefinition[] }>(response);
  return payload.templates;
};

export const createTemplateRemote = async (template: TemplateDefinition): Promise<TemplateDefinition> => {
  const response = await fetch(`${WORKER_BASE_URL}/templates`, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify(template),
  });
  return handleResponse<TemplateDefinition>(response);
};

export const updateTemplateRemote = async (template: TemplateDefinition): Promise<TemplateDefinition> => {
  const response = await fetch(`${WORKER_BASE_URL}/templates/${encodeURIComponent(template.id)}`, {
    method: 'PUT',
    headers: buildHeaders(),
    body: JSON.stringify(template),
  });
  return handleResponse<TemplateDefinition>(response);
};

export const deleteTemplateRemote = async (templateId: string): Promise<void> => {
  const response = await fetch(`${WORKER_BASE_URL}/templates/${encodeURIComponent(templateId)}`, {
    method: 'DELETE',
    headers: buildHeaders(),
  });
  // 204 = 正常削除、404 = もともと存在しない → どちらも成功扱いで OK
  if (response.status === 204 || response.status === 404) {
    return;
  }

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || "Failed to delete template");
  }
};
