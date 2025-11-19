const BASE_URL = import.meta.env.VITE_WORKER_BASE_URL!;
const API_KEY  = import.meta.env.VITE_WORKER_API_KEY!;

export async function pingWorker() {
  const res = await fetch(`${BASE_URL}/ping`, {
    headers: {
      "x-api-key": API_KEY,
    } as Record<string, string>,
  });

  if (!res.ok) {
    throw new Error(`Worker error: ${res.status}`);
  }

  return res.json();
}
