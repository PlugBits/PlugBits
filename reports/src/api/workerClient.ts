const BASE_URL = ((import.meta.env.VITE_REPORTS_API_BASE_URL ?? import.meta.env.VITE_WORKER_BASE_URL ?? '') as string).replace(/\/$/, '');
const API_KEY = import.meta.env.VITE_WORKER_API_KEY;


const buildUrl = (path: string) => {
  if (!BASE_URL) {
    throw new Error('Missing VITE_REPORTS_API_BASE_URL (or VITE_WORKER_BASE_URL)');
  }

  const normalized = path.startsWith('/') ? path : `/${path}`;
  const target = `${BASE_URL}${normalized}`;
  if (import.meta.env.DEV) {
    console.debug('[workerClient] ping URL:', target, {
      BASE_URL,
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

  // ★ /ping ではなく / を叩く（Worker実装に合わせる）
  const res = await fetch(buildUrl('/'), { headers });

  if (!res.ok) {
    throw new Error(`Worker error: ${res.status}`);
  }

  // ★ JSON縛りはやめる（あなたのWorker "/" は text を返す）
  const text = await res.text();
  return { ok: true, text };
}

