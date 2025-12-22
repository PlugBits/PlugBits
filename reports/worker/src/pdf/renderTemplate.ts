import { PDFDocument, rgb, type PDFPage, type PDFFont } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {
  CANVAS_HEIGHT,
  type TemplateDefinition,
  type TemplateElement,
  type TextElement,
  type LabelElement,
  type TableElement,
  type ImageElement,
  type TemplateDataRecord,
  type DataSource,
  type PageSize,
} from '../../../shared/template.js';
import type { PDFImage } from 'pdf-lib'; // 先頭の import に追加

const isHttpUrl = (value: string) => /^https?:\/\//i.test(value);

// 画像を事前に埋め込んでキャッシュ
async function preloadImages(
  pdfDoc: PDFDocument,
  template: TemplateDefinition,
  data: TemplateDataRecord | undefined,
): Promise<Map<string, PDFImage>> {
  const map = new Map<string, PDFImage>();

  const imageElements = template.elements.filter(
    (e) => e.type === 'image',
  ) as ImageElement[];

  const urls = Array.from(
    new Set(
      imageElements
        .map((e) => resolveDataSource(e.dataSource, data))
        .filter((u): u is string => !!u && isHttpUrl(u)),
    ),
  );

  for (const url of urls) {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn('Failed to fetch image:', url, res.status);
      continue;
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    const lower = url.toLowerCase();
    let embedded: PDFImage;
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
      embedded = await pdfDoc.embedJpg(buf);
    } else {
      embedded = await pdfDoc.embedPng(buf);
    }
    map.set(url, embedded);
    console.log('Embedded image', url, 'bytes=', buf.length);
  }

  return map;
}

/**
 * ページサイズ定義
 */
const PAGE_DIMENSIONS: Record<
  PageSize,
  { portrait: [number, number]; landscape: [number, number] }
> = {
  A4: {
    // ざっくり A4（もともとの値と同じくらい）
    portrait: [595.28, 841.89],
    landscape: [841.89, 595.28],
  },
};

/**
 * テンプレートからページ幅・高さを決定
 */
function getPageSize(template: TemplateDefinition): [number, number] {
  const dims = PAGE_DIMENSIONS[template.pageSize] ?? PAGE_DIMENSIONS.A4;
  return template.orientation === 'landscape'
    ? dims.landscape
    : dims.portrait;
}

/**
 * UI の Y（bottom基準） → PDF の Y（bottom基準）に変換
 */
function toPdfYFromBottom(uiBottomY: number, pageHeight: number): number {
  const scale = pageHeight / CANVAS_HEIGHT;
  return uiBottomY * scale;
}

const clampPdfY = (pdfY: number, maxY: number) => {
  if (Number.isNaN(pdfY)) return 0;
  const cappedMax = Number.isNaN(maxY) ? 0 : maxY;
  return Math.min(Math.max(pdfY, 0), cappedMax);
};

/**
 * kintone / static などのデータソースを解決
 */
function resolveDataSource(
  source: DataSource | undefined,
  data: TemplateDataRecord | undefined,
): string {
  if (!source) return '';

  // 固定値
  if (source.type === 'static') {
    return source.value ?? '';
  }

  if (!data) return '';

  // kintone / kintoneSubtable 系
  if ('fieldCode' in source && source.fieldCode) {
    const value = data[source.fieldCode];

    if (value === null || value === undefined) return '';

    if (typeof value === 'number') {
      return new Intl.NumberFormat('ja-JP').format(value);
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    if (Array.isArray(value)) {
      return value
        .map((item) => (typeof item === 'object' ? JSON.stringify(item) : String(item)))
        .join(', ');
    }

    return String(value);
  }

  return '';
}

/**
 * メイン：テンプレートを PDF のバイト列に変換
 */
export async function renderTemplateToPdf(
  template: TemplateDefinition,
  data: TemplateDataRecord | undefined,
  fonts: { jp: Uint8Array; latin: Uint8Array },
): Promise<Uint8Array> {
  console.log('==== renderTemplateToPdf START ====');

  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);

  const [pageWidth, pageHeight] = getPageSize(template);
  const imageMap = await preloadImages(pdfDoc, template, data);

  // ★ let にして、テーブル描画の途中で別ページに差し替えられるようにする
  let page = pdfDoc.addPage([pageWidth, pageHeight]);

  // フォント埋め込み
  const jpFont = await pdfDoc.embedFont(fonts.jp, { subset: false });
  const latinFont = await pdfDoc.embedFont(fonts.latin, { subset: false });

  console.log(
    'TEMPLATE ELEMENTS:',
    template.elements.map((e) => ({
      id: e.id,
      type: e.type,
      text: (e as any).text,
      x: e.x,
      y: e.y,
    })),
  );

  // ▼▼ 要素を分解：ヘッダー（毎ページ／1ページのみ）とフッター、テーブル ▼▼
  const nonTableElements = template.elements.filter(
    (e) => e.type !== 'table',
  );

  // region === 'footer' のものだけフッター扱い
  const footerElements = nonTableElements.filter(
    (e) => e.region === 'footer',
  );

  // それ以外（region 未指定 or 'header' 'body'）はヘッダー候補として扱う
  const headerCandidates = nonTableElements.filter(
    (e) => e.region !== 'footer',
  );

  // ヘッダー：毎ページ出すもの（デフォルト）
  const repeatingHeaderElements = headerCandidates.filter(
    (e) => e.repeatOnEveryPage !== false,
  );

  // ヘッダー：1ページ目だけ出すもの
  const firstPageOnlyHeaderElements = headerCandidates.filter(
    (e) => e.repeatOnEveryPage === false,
  );

  // フッター：全ページに出すもの（デフォルト）
  const footerAllPages = footerElements.filter(
    (e) => e.footerRepeatMode !== 'last',
  );

  // フッター：最終ページのみに出すもの
  const footerLastPageOnly = footerElements.filter(
    (e) => e.footerRepeatMode === 'last',
  );

     // --- フッター領域高さを計算 ---
  const estimatedFooterHeight = (() => {
    const allFooterElems = [...footerAllPages, ...footerLastPageOnly];
    if (allFooterElems.length === 0) return 0;

    // ラベル／テキストだけ対象にする
    const textFooterElems = allFooterElems.filter(
      (el) => el.type === "label" || el.type === "text",
    );
    if (textFooterElems.length === 0) return 0;

    // Y座標でソート（UI座標のままでOK）
    const sorted = [...textFooterElems].sort((a, b) => a.y - b.y);

    type RowInfo = { y: number; maxFontSize: number };

    const rows: RowInfo[] = [];
    const ROW_THRESHOLD = 5; // この差以内なら同じ行とみなす

    for (const el of sorted) {
      const fontSize = (el as any).fontSize ?? 12;
      if (rows.length === 0) {
        rows.push({ y: el.y, maxFontSize: fontSize });
        continue;
      }

      const lastRow = rows[rows.length - 1];
      if (Math.abs(el.y - lastRow.y) <= ROW_THRESHOLD) {
        // 同じ行とみなして、フォントサイズだけ更新
        if (fontSize > lastRow.maxFontSize) {
          lastRow.maxFontSize = fontSize;
        }
      } else {
        // 新しい行として追加
        rows.push({ y: el.y, maxFontSize: fontSize });
      }
    }

    // 各行の高さ = フォントサイズ + 行間(6pt) として足し合わせる
    const lineGap = 6;
    let total = 0;
    for (const row of rows) {
      total += row.maxFontSize + lineGap;
    }

    // 上下にちょっと余白を足す
    return total + 10;
  })();

  // テンプレが明示的に footerReserveHeight を持っていればそっちを優先
  const footerReserveHeight =
    template.footerReserveHeight ?? estimatedFooterHeight ?? 0;

  const tableElements = template.elements.filter(
    (e): e is TableElement => e.type === 'table',
  );
  if (tableElements.length > 1) {
    console.warn(
      'Multiple table elements found; rendering only one.',
      tableElements.map((el) => el.id),
    );
  }
  const tableElementToRender =
    tableElements.find((el) => el.id === 'items') ?? tableElements[0];

  // 1ページ目にヘッダー要素を描画
  drawHeaderElements(
    page,
    [...repeatingHeaderElements, ...firstPageOnlyHeaderElements],
    pageHeight,
    data,
    jpFont,
    latinFont,
    imageMap,
  );

  // テーブル（複数ある場合は順番に描画）
  // drawTable には「毎ページヘッダー」だけを渡す
  if (tableElementToRender) {
    page = drawTable(
      pdfDoc,
      page,
      pageWidth,
      pageHeight,
      tableElementToRender,
      jpFont,
      latinFont,
      data,
      repeatingHeaderElements,
      footerReserveHeight,
      imageMap,
    );
  }

  const pages = pdfDoc.getPages();
  const totalPages = pages.length;
  const footerFontSize = 9;

  for (let i = 0; i < totalPages; i++) {
    const p = pages[i];

    // --- フッター要素（固定文言など）を描画 ---
    //   - 最終ページだけの要素は最後のページにだけ描く
    const footerElementsForThisPage =
      i === totalPages - 1
        ? [...footerAllPages, ...footerLastPageOnly]
        : footerAllPages;

    drawFooterElements(
      p,
      footerElementsForThisPage,
      pageHeight,
      data,
      jpFont,
      latinFont,
      imageMap,
    );

    // --- ページ番号 (1 / N) を中央下に描画 ---
    const footerText = `${i + 1} / ${totalPages}`;
    const textWidth = latinFont.widthOfTextAtSize(
      footerText,
      footerFontSize,
    );
    const x = (pageWidth - textWidth) / 2;
    const y = 20; // 下から20pt

    p.drawText(footerText, {
      x,
      y,
      size: footerFontSize,
      font: latinFont,
      color: rgb(0.5, 0.5, 0.5),
    });
  }


  const bytes = await pdfDoc.save();
  console.log('==== renderTemplateToPdf END ====');
  return bytes;
}



function pickFontForText(text: string, jpFont: PDFFont, latinFont: PDFFont): PDFFont {
  // 数字・カンマ・ドット・通貨記号・スペースあたりは Latin に振る
  const numericLike = /^[0-9.,+\-() ¥$]*$/.test(text);
  return numericLike ? latinFont : jpFont;
}


// ============================
// Label
// ============================

function drawLabel(
  page: PDFPage,
  element: LabelElement,
  jpFont: PDFFont,
  pageHeight: number,
) {
  const fontSize = element.fontSize ?? 12;
  const textHeight = fontSize;
  const text = element.text ?? '';

  let pdfY = toPdfYFromBottom(element.y, pageHeight);
  pdfY = clampPdfY(pdfY, pageHeight - textHeight - 2);

  console.log('DRAW LABEL', {
    id: element.id,
    text,
    uiY: element.y,
    pdfY,
  });

  page.drawText(text, {
    x: element.x,
    y: pdfY,
    size: fontSize,
    font: jpFont,
    color: rgb(0, 0, 0),
  });
}

// ============================
// Text
// ============================

function drawText(
  page: PDFPage,
  element: TextElement,
  jpFont: PDFFont,
  latinFont: PDFFont,
  pageHeight: number,
  data: TemplateDataRecord | undefined,
) {
  const fontSize = element.fontSize ?? 12;
  const textHeight = fontSize;

  const resolved = resolveDataSource(element.dataSource, data);
  const text = resolved || element.text || '';

  let pdfY = toPdfYFromBottom(element.y, pageHeight);
  pdfY = clampPdfY(pdfY, pageHeight - textHeight - 2);
  const fontToUse = pickFontForText(text, jpFont, latinFont);

  console.log('DRAW TEXT', {
    id: element.id,
    text,
    uiY: element.y,
    pdfY,
  });

  page.drawText(text, {
    x: element.x,
    y: pdfY,
    size: fontSize,
    font: fontToUse,
    color: rgb(0, 0, 0),
  });
}

// ============================
// Header elements (label / text / image) for each page
// ============================

function drawHeaderElements(
  page: PDFPage,
  headerElements: TemplateElement[],
  pageHeight: number,
  data: TemplateDataRecord | undefined,
  jpFont: PDFFont,
  latinFont: PDFFont,
  imageMap: Map<string, PDFImage>,
) {
  for (const element of headerElements) {
    switch (element.type) {
      case 'label':
        drawLabel(page, element as LabelElement, jpFont, pageHeight);
        break;

      case 'text':
        drawText(
          page,
          element as TextElement,
          jpFont,
          latinFont,
          pageHeight,
          data,
        );
        break;

      case 'image':
        drawImageElement(
          page,
          element as ImageElement,
          pageHeight,
          data,
          imageMap,
        );
        break;


      case 'table':
        // ヘッダーには含めない（テーブルは別ルートで描画）
        break;

      default:
        console.warn(
          'Unknown header element type:',
          (element as TemplateElement).type,
        );
    }
  }
}

// ============================
// Footer elements（実装は header とほぼ同じ）
// ============================

function drawFooterElements(
  page: PDFPage,
  footerElements: TemplateElement[],
  pageHeight: number,
  data: TemplateDataRecord | undefined,
  jpFont: PDFFont,
  latinFont: PDFFont,
  imageMap: Map<string, PDFImage>,
) {
  for (const element of footerElements) {
    switch (element.type) {
      case 'label':
        drawLabel(page, element as LabelElement, jpFont, pageHeight);
        break;

      case 'text':
        drawText(
          page,
          element as TextElement,
          jpFont,
          latinFont,
          pageHeight,
          data,
        );
        break;

      case 'image':
        drawImageElement(
          page,
          element as ImageElement,
          pageHeight,
          data,
          imageMap,
        );
        break;

      case 'table':
        // フッターにはテーブルを描かない想定
        break;

      default:
        console.warn(
          'Unknown footer element type:',
          (element as TemplateElement).type,
        );
    }
  }
}

// ============================
// Table
// ============================

function drawTable(
  pdfDoc: PDFDocument,
  page: PDFPage,
  pageWidth: number,
  pageHeight: number,
  element: TableElement,
  jpFont: PDFFont,
  latinFont: PDFFont,
  data: TemplateDataRecord | undefined,
  headerElements: TemplateElement[],
  footerReserveHeight: number,
  imageMap: Map<string, PDFImage>, 
): PDFPage {
  const rowHeight = element.rowHeight ?? 18;
  const headerHeight = element.headerHeight ?? rowHeight;
  const fontSize = 10;

  const originX = element.x;
  const bottomMargin = footerReserveHeight + 40; // 下から40ptは余白

  // サブテーブル行
  const rows =
    data &&
    element.dataSource &&
    element.dataSource.type === 'kintoneSubtable'
      ? (data[element.dataSource.fieldCode] as any[] | undefined)
      : undefined;

  console.log('DRAW TABLE (multi-page + header)', {
    id: element.id,
    uiY: element.y,
    rows: rows?.length ?? 0,
  });

  if (!rows || rows.length === 0) {
    return page;
  }

  // テーブルヘッダー（列タイトル）を描画するヘルパー
  const drawTableHeaderRow = (targetPage: PDFPage, headerY: number) => {
    let currentX = originX;
    for (const col of element.columns) {
      const colWidth = col.width;

      // 枠線
      targetPage.drawRectangle({
        x: currentX,
        y: headerY,
        width: colWidth,
        height: headerHeight,
        borderColor: rgb(0.7, 0.7, 0.7),
        borderWidth: 0.5,
      });

      // 列タイトル
      targetPage.drawText(col.title, {
        x: currentX + 4,
        y: headerY + headerHeight / 2 - fontSize / 2,
        size: fontSize,
        font: jpFont,
        color: rgb(0, 0, 0),
      });

      currentX += colWidth;
    }
  };

  let currentPage = page;
  const minHeaderY = bottomMargin + headerHeight + rowHeight;
  const getHeaderY = () =>
    clampPdfY(toPdfYFromBottom(element.y, pageHeight), pageHeight - headerHeight);
  let headerY = getHeaderY();
  let rowIndexOnPage = 0;

  if (headerY < minHeaderY) {
    currentPage = pdfDoc.addPage([pageWidth, pageHeight]);

    drawHeaderElements(
      currentPage,
      headerElements,
      pageHeight,
      data,
      jpFont,
      latinFont,
      imageMap,
    );

    headerY = getHeaderY();
    if (headerY < minHeaderY) {
      console.warn('Table header Y is too low for minimum layout.', {
        id: element.id,
        headerY,
        minHeaderY,
      });
    }
  }

  // 1ページ目には、既に renderTemplateToPdf 側でヘッダー要素が描画済みなので、
  // ここではテーブルヘッダー行だけ描画する
  drawTableHeaderRow(currentPage, headerY);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    // このページでの行の下端
    let rowYBottom =
      headerY - headerHeight - rowIndexOnPage * rowHeight;

    // 下余白を割りそうなら改ページ
    if (rowYBottom < bottomMargin) {
      // 新しいページを追加
      currentPage = pdfDoc.addPage([pageWidth, pageHeight]);

      // ★ 新ページにもラベル・テキストなどのヘッダー要素を再描画
      drawHeaderElements(
        currentPage,
        headerElements,
        pageHeight,
        data,
        jpFont,
        latinFont,
        imageMap,
      );

      // テーブルヘッダーの位置を再計算して描画
      headerY = getHeaderY();
      rowIndexOnPage = 0;

      if (headerY < minHeaderY) {
        console.warn('Table header Y is too low for minimum layout.', {
          id: element.id,
          headerY,
          minHeaderY,
        });
      }

      drawTableHeaderRow(currentPage, headerY);

      // このページでの最初の行位置を再計算
      rowYBottom =
        headerY - headerHeight - rowIndexOnPage * rowHeight;
    }

    let currentX = originX;

    for (const col of element.columns) {
      const colWidth = col.width;

      if (element.showGrid) {
        currentPage.drawRectangle({
          x: currentX,
          y: rowYBottom,
          width: colWidth,
          height: rowHeight,
          borderColor: rgb(0.85, 0.85, 0.85),
          borderWidth: 0.5,
        });
      }

      const rawVal = row[col.fieldCode];
      const cellText = rawVal != null ? String(rawVal) : '';
      const fontForCell = pickFontForText(cellText, jpFont, latinFont);

      currentPage.drawText(cellText, {
        x: currentX + 4,
        y: rowYBottom + rowHeight / 2 - fontSize / 2,
        size: fontSize,
        font: fontForCell,
        color: rgb(0, 0, 0),
      });

      currentX += colWidth;
    }

    rowIndexOnPage += 1;
  }

  return currentPage;
}

function drawImageElement(
  page: PDFPage,
  element: ImageElement,
  pageHeight: number,
  data: TemplateDataRecord | undefined,
  imageMap: Map<string, PDFImage>,
) {
  const url = resolveDataSource(element.dataSource, data);
  if (!url || !isHttpUrl(url)) {
    drawImagePlaceholder(page, element, pageHeight);
    return;
  }

  const embedded = imageMap.get(url);
  if (!embedded) {
    drawImagePlaceholder(page, element, pageHeight);
    return;
  }

  const width = element.width ?? embedded.width;
  const height = element.height ?? embedded.height;
  let pdfY = toPdfYFromBottom(element.y, pageHeight);
  pdfY = clampPdfY(pdfY, pageHeight - height);

  const { width: imgW, height: imgH } = embedded.size();
  const fitMode = element.fitMode ?? 'fit';

  let drawWidth = width;
  let drawHeight = height;

  if (fitMode === 'fit') {
    const scale = Math.min(width / imgW, height / imgH);
    drawWidth = imgW * scale;
    drawHeight = imgH * scale;
  }

  page.drawImage(embedded, {
    x: element.x,
    y: pdfY,
    width: drawWidth,
    height: drawHeight,
  });
}


// ============================
// Image placeholder（まだ枠だけ）
// ============================

function drawImagePlaceholder(
  page: PDFPage,
  element: ImageElement,
  pageHeight: number,
) {
  const width = element.width ?? 120;
  const height = element.height ?? 80;

  let pdfY = toPdfYFromBottom(element.y, pageHeight);
  pdfY = clampPdfY(pdfY, pageHeight - height);

  page.drawRectangle({
    x: element.x,
    y: pdfY,
    width,
    height,
    borderColor: rgb(0.5, 0.5, 0.5),
    borderWidth: 1,
  });

  page.drawText('IMAGE', {
    x: element.x + 8,
    y: pdfY + height / 2 - 6,
    size: 10,
    color: rgb(0.4, 0.4, 0.4),
  });
}
