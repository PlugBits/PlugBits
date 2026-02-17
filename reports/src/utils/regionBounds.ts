// src/utils/regionBounds.ts
import type { TemplateDefinition, TemplateElement } from '@shared/template';
import { CANVAS_HEIGHT, resolveRegionBounds, toBottomBasedRegionBounds } from '@shared/template';

// Canvasの座標系：bottom基準（TemplateCanvasの実装に合わせる）
export const CANVAS_WIDTH = 595;
export { CANVAS_HEIGHT };

export const REGION_BOUNDS = {
  header: { yMin: 680, yMax: CANVAS_HEIGHT },
  body: { yMin: 180, yMax: 680 },
  footer: { yMin: 0, yMax: 180 },
} as const;

export type Region = keyof typeof REGION_BOUNDS;

export const getRegionOf = (el: TemplateElement): Region => (el.region ?? 'body');

export const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

export const resolveRegionBoundsBottom = (template?: TemplateDefinition) => {
  const bounds = resolveRegionBounds(template, CANVAS_HEIGHT);
  return toBottomBasedRegionBounds(bounds, CANVAS_HEIGHT);
};

export const clampYToRegion = (y: number, region: Region, template?: TemplateDefinition) => {
  const b = template ? resolveRegionBoundsBottom(template)[region] : REGION_BOUNDS[region];
  return clamp(y, b.yMin, b.yMax);
};
