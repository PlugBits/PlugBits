// src/fonts/fontLoader.ts

// Env 型は index.ts の Env と同じでOK or ここで定義してもOK
export interface Env {
  FONT_SOURCE_URL?: string;
}

// Worker外部に置いたフォントを取得する
export async function getDefaultFontBytes(env: Env): Promise<Uint8Array> {
  const url =
    env.FONT_SOURCE_URL ??
    "https://raw.githubusercontent.com/xxxx/your-font-path/NotoSansJP-Regular.otf";

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch font from ${url}: ${res.status}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}
