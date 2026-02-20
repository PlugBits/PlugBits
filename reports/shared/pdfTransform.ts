type PdfTransformInput = {
  pageWidthPt: number;
  pageHeightPt: number;
  canvasWidth: number;
  canvasHeight: number;
};

export type PdfTransform = {
  pageWidthPt: number;
  pageHeightPt: number;
  canvasWidth: number;
  canvasHeight: number;
  scaleX: number;
  scaleY: number;
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
}: PdfTransformInput): PdfTransform => {
  const scaleX = safeScale(pageWidthPt, canvasWidth);
  const scaleY = safeScale(pageHeightPt, canvasHeight);
  return {
    pageWidthPt,
    pageHeightPt,
    canvasWidth,
    canvasHeight,
    scaleX,
    scaleY,
    toPdfX: (x) => x * scaleX,
    toPdfW: (w) => w * scaleX,
    toPdfH: (h) => h * scaleY,
    toPdfYTop: (yTop) => pageHeightPt - yTop * scaleY,
    toPdfYBox: (yTop, h) => pageHeightPt - yTop * scaleY - h * scaleY,
    toPdfTop: (yTop, _h) => pageHeightPt - yTop * scaleY,
  };
};
