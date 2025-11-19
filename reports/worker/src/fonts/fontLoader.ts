const FONT_KV_KEY = 'font:SourceHanSans';

let cachedFontBytes: Uint8Array | null = null;

export async function loadFontFromKv(kv?: KVNamespace): Promise<Uint8Array> {
  if (cachedFontBytes) {
    return cachedFontBytes;
  }

  if (!kv) {
    throw new Error('Font KV is not configured');
  }

  const arrayBuffer = await kv.get(FONT_KV_KEY, 'arrayBuffer');
  if (!arrayBuffer) {
    throw new Error(`Font data not found in KV under key ${FONT_KV_KEY}`);
  }

  cachedFontBytes = new Uint8Array(arrayBuffer);
  return cachedFontBytes;
}
