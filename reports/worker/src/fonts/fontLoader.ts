// worker/src/fonts/fontLoader.ts
import type { Env } from "../index.ts";

// 共通のフェッチ関数
async function fetchFont(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch font: ${url} (${res.status})`);
  }
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

// 既存のまま使うならこれ（互換）
export async function getDefaultFontBytes(env: Env): Promise<Uint8Array> {
  if (!env.FONT_SOURCE_URL) {
    throw new Error("FONT_SOURCE_URL is not set");
  }
  return fetchFont(env.FONT_SOURCE_URL);
}

// ★ 追加：JP + Latin 両方返す
export async function getFonts(env: Env): Promise<{
  jp: Uint8Array;
  latin: Uint8Array;
}> {
  if (!env.FONT_SOURCE_URL) {
    throw new Error("FONT_SOURCE_URL is not set");
  }

  const jpPromise = fetchFont(env.FONT_SOURCE_URL);

  let latinPromise: Promise<Uint8Array>;
  if (env.LATIN_FONT_URL) {
    latinPromise = fetchFont(env.LATIN_FONT_URL);
  } else {
    // 未設定ならとりあえずJPを使い回す
    latinPromise = jpPromise;
  }

  const [jp, latin] = await Promise.all([jpPromise, latinPromise]);
  return { jp, latin };
}
