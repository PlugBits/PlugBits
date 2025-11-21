const FONT_KV_KEY = 'font:SourceHanSans';
const DEFAULT_FONT_SOURCE_URL =
  'https://raw.githubusercontent.com/adobe-fonts/source-han-sans/release/SubsetOTF/JP/SourceHanSansJP-Regular.otf';

let cachedFontBytes: Uint8Array | null = null;

export type FontLoaderEnv = {
  TEMPLATE_KV?: KVNamespace;
  FONT_SOURCE_URL?: string;
};

export async function loadFontFromKv(env: FontLoaderEnv): Promise<Uint8Array> {
  if (cachedFontBytes) {
    return cachedFontBytes;
  }

  const kv = env.TEMPLATE_KV;
  if (!kv) {
    throw new Error('Font KV is not configured');
  }

  const existing = await kv.get(FONT_KV_KEY, 'arrayBuffer');
  if (existing) {
    cachedFontBytes = new Uint8Array(existing);
    return cachedFontBytes;
  }

  const sourceUrl = env.FONT_SOURCE_URL || DEFAULT_FONT_SOURCE_URL;
  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw new Error(`Failed to download font from ${sourceUrl}`);
  }

  const buffer = await response.arrayBuffer();
  await kv.put(FONT_KV_KEY, buffer);
  cachedFontBytes = new Uint8Array(buffer);
  return cachedFontBytes;
}
