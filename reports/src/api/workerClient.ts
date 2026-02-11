import { WORKER_BASE_URL } from '../constants';

const BASE_URL = WORKER_BASE_URL.replace(/\/$/, '');


const buildUrl = (path: string) => {
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
  // ★ /ping ではなく / を叩く（Worker実装に合わせる）
  const res = await fetch(buildUrl('/'));

  if (!res.ok) {
    throw new Error('処理に失敗しました。もう一度お試しください。');
  }

  // ★ JSON縛りはやめる（あなたのWorker "/" は text を返す）
  const text = await res.text();
  return { ok: true, text };
}
