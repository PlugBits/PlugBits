export type SnapMode = 'stroke' | 'fill';

export const snapPixel = (value: number, mode: SnapMode, dpr = 1): number => {
  if (!Number.isFinite(value)) return value;
  const scale = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  if (mode === 'stroke') {
    return (Math.floor(value * scale) + 0.5) / scale;
  }
  return Math.round(value * scale) / scale;
};
