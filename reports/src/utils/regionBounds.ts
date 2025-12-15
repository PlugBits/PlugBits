// src/utils/regionBounds.ts
import type { TemplateElement } from '@shared/template';

// Canvasの座標系：bottom基準（あなたのTemplateCanvasの実装に合わせる）
export const CANVAS_WIDTH = 595;
export const CANVAS_HEIGHT = 842;

// 仮境界（必要なら後で数値調整）
export const REGION_BOUNDS = {
  header: { yMin: 660, yMax: CANVAS_HEIGHT },
  body: { yMin: 180, yMax: 660 },
  footer: { yMin: 0, yMax: 180 },
} as const;

export type Region = keyof typeof REGION_BOUNDS;

export const getRegionOf = (el: TemplateElement): Region => (el.region ?? 'body');

export const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

export const clampYToRegion = (y: number, region: Region) => {
  const b = REGION_BOUNDS[region];
  return clamp(y, b.yMin, b.yMax);
};
