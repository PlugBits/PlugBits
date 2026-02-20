// src/utils/regionBounds.ts
import type { TemplateDefinition, TemplateElement } from '@shared/template';
import { getPageDimensions, resolveRegionBounds } from '@shared/template';

export type Region = 'header' | 'body' | 'footer';

export const getRegionOf = (el: TemplateElement): Region => (el.region ?? 'body');

export const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

export const getCanvasDimensions = (
  template?: Pick<TemplateDefinition, 'pageSize' | 'orientation'>,
) => getPageDimensions(template?.pageSize ?? 'A4', template?.orientation ?? 'portrait');

export const REGION_BOUNDS = (pageHeight: number) => ({
  header: { yTop: 0, yBottom: 250 },
  body: { yTop: 250, yBottom: pageHeight - 150 },
  footer: { yTop: pageHeight - 150, yBottom: pageHeight },
});

export const resolveRegionBoundsTop = (template?: TemplateDefinition) => {
  const { height } = getCanvasDimensions(template);
  return resolveRegionBounds(template, height);
};

export const clampYToRegion = (y: number, region: Region, template?: TemplateDefinition) => {
  const { height } = getCanvasDimensions(template);
  const b = template ? resolveRegionBoundsTop(template)[region] : REGION_BOUNDS(height)[region];
  return clamp(y, b.yTop, b.yBottom);
};
