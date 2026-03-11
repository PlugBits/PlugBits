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
export type JpFontFamily = "noto" | "bizud" | "mplus";
export type JpFontSelection = {
  requestedFamily: JpFontFamily;
  resolvedFamily: JpFontFamily;
  sourceUrl: string | null;
  fellBackToNoto: boolean;
};

let cachedLatin: Uint8Array | null = null;
let pendingLatin: Promise<Uint8Array> | null = null;
let cachedJpByUrl = new Map<string, Uint8Array>();
let pendingJpByUrl = new Map<string, Promise<Uint8Array>>();

const fetchLatinFontCached = async (url: string): Promise<Uint8Array> => {
  if (cachedLatin) return cachedLatin;
  if (pendingLatin) return pendingLatin;
  const inflight = fetchFont(url).then((bytes) => {
    cachedLatin = bytes;
    return bytes;
  });
  pendingLatin = inflight;

  try {
    return await inflight;
  } finally {
    pendingLatin = null;
  }
};

const normalizeJpFontFamily = (value: unknown): JpFontFamily => {
  const family = String(value ?? "").trim().toLowerCase();
  if (family === "bizud") return "bizud";
  if (family === "mplus") return "mplus";
  return "noto";
};

export const resolveJpFontSelection = (
  env: Env,
  requestedFamily?: unknown,
): JpFontSelection => {
  const requested = normalizeJpFontFamily(requestedFamily ?? env.JP_FONT_FAMILY);
  const notoUrl = env.FONT_SOURCE_URL ?? null;
  const bizudUrl = env.JP_FONT_BIZUD_URL ?? null;
  const mplusUrl = env.JP_FONT_MPLUS_URL ?? null;
  let sourceUrl: string | null = null;
  let resolvedFamily: JpFontFamily = requested;
  let fellBackToNoto = false;

  if (requested === "bizud") {
    sourceUrl = bizudUrl;
  } else if (requested === "mplus") {
    sourceUrl = mplusUrl;
  } else {
    sourceUrl = notoUrl;
  }

  if (!sourceUrl && requested !== "noto") {
    sourceUrl = notoUrl;
    resolvedFamily = "noto";
    fellBackToNoto = true;
  }

  return {
    requestedFamily: requested,
    resolvedFamily,
    sourceUrl,
    fellBackToNoto,
  };
};

const fetchJpFontByUrl = async (url: string): Promise<Uint8Array> => {
  const cached = cachedJpByUrl.get(url);
  if (cached) return cached;
  const pending = pendingJpByUrl.get(url);
  if (pending) return pending;
  const inflight = fetchFont(url).then((bytes) => {
    cachedJpByUrl.set(url, bytes);
    return bytes;
  });
  pendingJpByUrl.set(url, inflight);
  try {
    return await inflight;
  } finally {
    pendingJpByUrl.delete(url);
  }
};

// 既存のまま使うならこれ（互換）
export async function getDefaultFontBytes(env: Env): Promise<Uint8Array> {
  const selection = resolveJpFontSelection(env, "noto");
  if (!selection.sourceUrl) {
    throw new Error("FONT_SOURCE_URL is not set");
  }
  return fetchJpFontByUrl(selection.sourceUrl);
}

// ★ 追加：JP + Latin 両方返す
export async function getFonts(
  env: Env,
  options?: { requireJp?: boolean; jpFontFamily?: JpFontFamily },
): Promise<FontBytes> {
  const requireJp = options?.requireJp !== false;

  let latin: Uint8Array | null = null;
  if (env.LATIN_FONT_URL) {
    latin = await fetchLatinFontCached(env.LATIN_FONT_URL);
  }

  let jp: Uint8Array | null = null;
  if (requireJp) {
    const selection = resolveJpFontSelection(env, options?.jpFontFamily);
    if (!selection.sourceUrl) {
      throw new Error(
        selection.requestedFamily === "noto"
          ? "FONT_SOURCE_URL is not set"
          : `JP font URL is not set for family=${selection.requestedFamily}`,
      );
    }
    jp = await fetchJpFontByUrl(selection.sourceUrl);
  }

  return { latin, jp };
}
