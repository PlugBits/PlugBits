type PdfTransformInput = {
  pageWidthPt: number;
  pageHeightPt: number;
  canvasWidth: number;
  canvasHeight: number;
  yMode?: 'top' | 'bottom';
};

export type PdfTransform = {
  pageWidthPt: number;
  pageHeightPt: number;
  canvasWidth: number;
  canvasHeight: number;
  scaleX: number;
  scaleY: number;
  yMode: 'top' | 'bottom';
  toPdfX: (x: number) => number;
  toPdfW: (w: number) => number;
  toPdfH: (h: number) => number;
  toPdfYTop: (yTop: number) => number;
  toPdfYBox: (yTop: number, h: number) => number;
  toPdfTop: (yTop: number, h: number) => number;
};

const safeScale = (numerator: number, denominator: number) =>
  Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0
    ? numerator / denominator
    : 1;

export const buildPdfTransform = ({
  pageWidthPt,
  pageHeightPt,
  canvasWidth,
  canvasHeight,
  yMode,
}: PdfTransformInput): PdfTransform => {
  const scaleX = safeScale(pageWidthPt, canvasWidth);
  const scaleY = safeScale(pageHeightPt, canvasHeight);
  const resolvedYMode: 'top' | 'bottom' = yMode ?? 'top';
  const toPdfYBox =
    resolvedYMode === 'top'
      ? (yTop: number, h: number) => pageHeightPt - yTop * scaleY - h * scaleY
      : (yTop: number, _h: number) => yTop * scaleY;
  const toPdfYTop =
    resolvedYMode === 'top'
      ? (yTop: number) => pageHeightPt - yTop * scaleY
      : (yTop: number) => yTop * scaleY;
  const toPdfTop =
    resolvedYMode === 'top'
      ? (yTop: number, _h: number) => pageHeightPt - yTop * scaleY
      : (yTop: number, h: number) => yTop * scaleY + h * scaleY;
  return {
    pageWidthPt,
    pageHeightPt,
    canvasWidth,
    canvasHeight,
    scaleX,
    scaleY,
    yMode: resolvedYMode,
    toPdfX: (x) => x * scaleX,
    toPdfW: (w) => w * scaleX,
    toPdfH: (h) => h * scaleY,
    toPdfYTop,
    toPdfYBox,
    toPdfTop,
  };
};
