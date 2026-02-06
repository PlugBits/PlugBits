import type { TextElement } from './template';

export type DocumentMetaLayoutInput = {
  logoX: number;
  logoY: number;
  logoWidth: number;
  logoHeight: number;
  gap: number;
  labelWidth: number;
  columnGap: number;
  rowGap: number;
  minValueWidth: number;
  docNoVisible: boolean;
  dateVisible: boolean;
  fontSizes: {
    docNoLabel: number;
    docNoValue: number;
    dateLabel: number;
    dateValue: number;
  };
  heights?: {
    docNoLabel?: number;
    docNoValue?: number;
    dateLabel?: number;
    dateValue?: number;
  };
};

export type DocumentMetaLayoutFrame = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type DocumentMetaLayoutResult = {
  docNoLabel?: DocumentMetaLayoutFrame;
  docNoValue?: DocumentMetaLayoutFrame;
  dateLabel?: DocumentMetaLayoutFrame;
  dateValue?: DocumentMetaLayoutFrame;
};

const resolveMinHeight = (fontSize: number, current?: number) => {
  const base = Math.ceil(fontSize * 1.4);
  return Math.max(current ?? 0, base);
};

const resolveRowLayout = (
  topY: number,
  blockX: number,
  blockW: number,
  labelW: number,
  gap: number,
  minValueW: number,
  labelH: number,
  valueH: number,
): { label: DocumentMetaLayoutFrame; value: DocumentMetaLayoutFrame; bottom: number } => {
  const valueW = Math.max(0, blockW - labelW - gap);
  if (valueW >= minValueW) {
    const rowH = Math.max(labelH, valueH);
    const y = topY - rowH;
    return {
      label: { x: blockX, y, width: labelW, height: rowH },
      value: { x: blockX + labelW + gap, y, width: valueW, height: rowH },
      bottom: y,
    };
  }

  const labelY = topY - labelH;
  const valueY = labelY - gap - valueH;
  return {
    label: { x: blockX, y: labelY, width: blockW, height: labelH },
    value: { x: blockX, y: valueY, width: blockW, height: valueH },
    bottom: valueY,
  };
};

export const computeDocumentMetaLayout = (
  input: DocumentMetaLayoutInput,
): DocumentMetaLayoutResult => {
  const {
    logoX,
    logoY,
    logoWidth,
    gap,
    labelWidth,
    columnGap,
    rowGap,
    minValueWidth,
    docNoVisible,
    dateVisible,
    fontSizes,
    heights,
  } = input;

  if (!docNoVisible && !dateVisible) return {};
  if (!Number.isFinite(logoX) || !Number.isFinite(logoY) || !Number.isFinite(logoWidth)) {
    return {};
  }

  const blockX = logoX;
  const blockW = Math.max(0, logoWidth);
  const labelW = Math.min(labelWidth, blockW);
  let rowTop = logoY - gap;
  const result: DocumentMetaLayoutResult = {};

  const docNoLabelH = resolveMinHeight(fontSizes.docNoLabel, heights?.docNoLabel);
  const docNoValueH = resolveMinHeight(fontSizes.docNoValue, heights?.docNoValue);
  const dateLabelH = resolveMinHeight(fontSizes.dateLabel, heights?.dateLabel);
  const dateValueH = resolveMinHeight(fontSizes.dateValue, heights?.dateValue);

  if (docNoVisible) {
    const row = resolveRowLayout(
      rowTop,
      blockX,
      blockW,
      labelW,
      columnGap,
      minValueWidth,
      docNoLabelH,
      docNoValueH,
    );
    result.docNoLabel = row.label;
    result.docNoValue = row.value;
    rowTop = row.bottom - rowGap;
  }

  if (dateVisible) {
    const row = resolveRowLayout(
      rowTop,
      blockX,
      blockW,
      labelW,
      columnGap,
      minValueWidth,
      dateLabelH,
      dateValueH,
    );
    result.dateLabel = row.label;
    result.dateValue = row.value;
  }

  return result;
};

export const applyFrameToTextElement = (
  element: TextElement,
  frame: DocumentMetaLayoutFrame,
): TextElement => ({
  ...element,
  x: frame.x,
  y: frame.y,
  width: frame.width,
  height: frame.height,
});
