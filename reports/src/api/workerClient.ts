const BASE_URL = (import.meta.env.VITE_WORKER_BASE_URL ?? '').replace(/\/$/, '');
const PROXY_PATH = import.meta.env.VITE_WORKER_PROXY_PATH ?? '/worker-proxy';
const API_KEY = import.meta.env.VITE_WORKER_API_KEY;

const buildUrl = (path: string) => {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const target = BASE_URL ? `${BASE_URL}${normalized}` : `${PROXY_PATH}${normalized}`;
  if (import.meta.env.DEV) {
    console.debug('[workerClient] ping URL:', target, {
      BASE_URL,
      PROXY_PATH,
      hasProxyTarget: Boolean(import.meta.env.VITE_WORKER_PROXY_TARGET),
    });
  }
  return target;
};

export async function pingWorker() {
  const headers: Record<string, string> = {};
  if (API_KEY) {
    headers['x-api-key'] = API_KEY;
  }

  const res = await fetch(buildUrl('/ping'), { headers });

  if (!res.ok) {
    throw new Error(`Worker error: ${res.status}`);
  }

  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    const text = await res.text();
    throw new Error(`Invalid response: ${text.slice(0, 80)}`);
  }

  return res.json();
}
