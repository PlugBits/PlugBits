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

type FontBytes = { latin: Uint8Array | null; jp: Uint8Array | null };

let cachedLatin: Uint8Array | null = null;
let cachedJp: Uint8Array | null = null;
let pendingLatin: Promise<Uint8Array> | null = null;
let pendingJp: Promise<Uint8Array> | null = null;

const fetchFontCached = async (
  url: string,
  kind: "latin" | "jp",
): Promise<Uint8Array> => {
  if (kind === "latin" && cachedLatin) return cachedLatin;
  if (kind === "jp" && cachedJp) return cachedJp;

  const pending = kind === "latin" ? pendingLatin : pendingJp;
  if (pending) return pending;

  const inflight = fetchFont(url).then((bytes) => {
    if (kind === "latin") cachedLatin = bytes;
    else cachedJp = bytes;
    return bytes;
  });
  if (kind === "latin") pendingLatin = inflight;
  else pendingJp = inflight;

  try {
    return await inflight;
  } finally {
    if (kind === "latin") pendingLatin = null;
    else pendingJp = null;
  }
};

// 既存のまま使うならこれ（互換）
export async function getDefaultFontBytes(env: Env): Promise<Uint8Array> {
  if (!env.FONT_SOURCE_URL) {
    throw new Error("FONT_SOURCE_URL is not set");
  }
  return fetchFontCached(env.FONT_SOURCE_URL, "jp");
}

// ★ 追加：JP + Latin 両方返す
export async function getFonts(
  env: Env,
  options?: { requireJp?: boolean },
): Promise<FontBytes> {
  const requireJp = options?.requireJp !== false;

  let latin: Uint8Array | null = null;
  if (env.LATIN_FONT_URL) {
    latin = await fetchFontCached(env.LATIN_FONT_URL, "latin");
  }

  let jp: Uint8Array | null = null;
  if (requireJp) {
    if (!env.FONT_SOURCE_URL) {
      throw new Error("FONT_SOURCE_URL is not set");
    }
    jp = await fetchFontCached(env.FONT_SOURCE_URL, "jp");
  }

  return { latin, jp };
}
