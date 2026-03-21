import { readFile } from 'node:fs/promises';
import path from 'node:path';

type JpFontFamily = 'noto' | 'bizud' | 'mplus';

type FontBundle = {
  latin: Uint8Array;
  jpByFamily: Record<JpFontFamily, Uint8Array>;
};

let bundlePromise: Promise<FontBundle> | null = null;

const FONT_DIR = path.resolve(process.cwd(), 'assets/fonts');

const resolveRequestedFamily = (value: unknown): JpFontFamily => {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'mplus') return 'mplus';
  if (normalized === 'bizud') return 'bizud';
  return 'noto';
};

const loadFontBytes = async (filename: string) => {
  const filePath = path.join(FONT_DIR, filename);
  const buffer = await readFile(filePath);
  return new Uint8Array(buffer);
};

const loadBundle = async (): Promise<FontBundle> => {
  const [latin, noto, mplus] = await Promise.all([
    loadFontBytes('Roboto-Regular.ttf'),
    loadFontBytes('NotoSansJP-BusinessSubset.ttf'),
    loadFontBytes('MPLUS1p-Regular.ttf'),
  ]);
  return {
    latin,
    jpByFamily: {
      noto,
      bizud: noto,
      mplus,
    },
  };
};

export const getFonts = async (requestedFamily?: unknown) => {
  if (!bundlePromise) {
    bundlePromise = loadBundle();
  }
  const bundle = await bundlePromise;
  const requested = resolveRequestedFamily(requestedFamily);
  const resolved = requested === 'bizud' ? 'noto' : requested;
  return {
    latin: bundle.latin,
    jp: bundle.jpByFamily[resolved],
    requestedFamily: requested,
    resolvedFamily: resolved,
    fellBackToNoto: requested === 'bizud',
  };
};
