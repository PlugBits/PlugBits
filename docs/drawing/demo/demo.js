'use strict';

/* ------------------------------------------------------------------ */
/* Demo API endpoint（drawing-similarity-api-free の /demo/* ）。       */
/* バックエンドは並行して実装中。デプロイ後もこの定数だけ差し替えれば動く。*/
/* ------------------------------------------------------------------ */
const DEMO_API_BASE = 'https://drawing-similarity-api-free-939943665629.asia-northeast1.run.app';

const MIN_FILES = 5;
const MAX_FILES = 20;
const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB
const ALLOWED_MIME = ['application/pdf', 'image/png', 'image/jpeg'];
const ALLOWED_EXT = ['.pdf', '.png', '.jpg', '.jpeg'];
const NEAR_THRESHOLD = 0.87;
const MAX_RETRY_WAIT_SEC = 20;
const MAX_RETRIES = 3;
const SLOW_WARNING_MS = 8000;

// サムネイルは絶対パスで参照する(pushState で /drawing/demo/sample-click/ 等に URL が変わると相対パスが壊れるため)
const SAMPLES_BASE = '/drawing/demo/samples/';
const PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.7.76/pdf.min.mjs';
const PDFJS_WORKER_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.7.76/pdf.worker.min.mjs';

// 「kintone の中ではこう見えます」ブロック。パスをここ1箇所にまとめてあるので、
// 実際のデモ撮影画像が届いたら KINTONE_LOOK_IMAGE_SRC を
// '/drawing/assets/demo-in-kintone.webp' に差し替えるだけでよい
// (docs/drawing/demo/README.md にも同じ手順を記載)。
const KINTONE_LOOK_IMAGE_SRC = '/drawing/assets/howto-3.webp';
const KINTONE_LOOK_IMAGE_WIDTH = 1052;
const KINTONE_LOOK_IMAGE_HEIGHT = 889;
const KINTONE_LOOK_IMAGE_ALT = 'kintoneのレコード詳細で類似図面検索モーダルが開いた実画面';

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ------------------------------------------------------------------ */
/* state                                                                */
/* ------------------------------------------------------------------ */
const state = {
  files: [],          // [{ file, name, status: 'pending'|'done'|'failed', vectors, thumbUrl, thumbFailed }]
  uploading: false,
  resultsShown: false,   // pushState /drawing/demo/results/ が済んだか
  sampleClickShown: false,
  objectUrls: [],
  samples: null,
  apiDisabled: false,    // /demo/warmup が 404 or ネットワークエラー → 自分の図面アップロードを封じる
  gallery: { order: null, expanded: false }, // order: [{item, idx}, ...] 家系(family)分散済みの表示順
};

let pdfjsLibPromise = null;

/* ------------------------------------------------------------------ */
/* helpers                                                              */
/* ------------------------------------------------------------------ */
function $(id) { return document.getElementById(id); }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function dot(a, b) {
  let s = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) s += a[i] * b[i];
  return s;
}

/* A/B の類似度 = 全回転ペアの内積の最大値（ベクトルはL2正規化済みなのでcos=内積） */
function similarity(a, b) {
  let max = -Infinity;
  const rotsA = Object.keys(a.vectors);
  const rotsB = Object.keys(b.vectors);
  for (let i = 0; i < rotsA.length; i++) {
    const va = a.vectors[rotsA[i]];
    for (let j = 0; j < rotsB.length; j++) {
      const d = dot(va, b.vectors[rotsB[j]]);
      if (d > max) max = d;
    }
  }
  return max;
}

function isAllowedFile(file) {
  if (file.type && ALLOWED_MIME.indexOf(file.type) !== -1) return true;
  const name = (file.name || '').toLowerCase();
  for (let i = 0; i < ALLOWED_EXT.length; i++) {
    if (name.endsWith(ALLOWED_EXT[i])) return true;
  }
  return false;
}

function isImageFile(file) {
  if (file.type === 'image/png' || file.type === 'image/jpeg') return true;
  return /\.(png|jpe?g)$/i.test(file.name || '');
}

// samples.json の manifest 由来の英語トークンを日本語に変換する
// (候補リストのメタ行にそのまま出さない)。
const VIEWS_LABELS = { 'three-view': '三面図', 'two-view': '二面図', 'section': '断面図' };
function formatSampleMeta(item) {
  const parts = [];
  if (item.sheet) parts.push(item.sheet);
  if (item.views) parts.push(VIEWS_LABELS[item.views] || item.views);
  if (item.scan) parts.push('スキャン');
  return parts.join(' ・ ');
}

function fileTypeLabel(file) {
  if (!file) return '';
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name || '')) return 'PDF';
  if (file.type === 'image/png' || /\.png$/i.test(file.name || '')) return 'PNG';
  if (file.type === 'image/jpeg' || /\.jpe?g$/i.test(file.name || '')) return 'JPG';
  return '';
}

function fireWarmup() {
  // レスポンスボディを読み捨てないと、一部のサーバー(chunked応答)相手では
  // リクエストがブラウザ内で「読み込み中」のまま残り続け、同一オリジンへの
  // 接続を専有し続けることがある(実機検証で確認)。必ず本文を消費する。
  fetch(DEMO_API_BASE + '/demo/warmup')
    .then(res => res.text())
    .catch(() => { /* ignore */ });
}

/* 初回ロード時だけ: warmup の結果でアップロード機能の可否を判定する。
   - 200: 通常どおり(コールドスタートで時間がかかっても、200が返れば利用可能)
   - 404: デモがサーバー側で無効 → ドロップ枠をサンプル誘導に差し替え
   - ネットワークエラー: サーバー未デプロイ/到達不可 → 同様に差し替え
   - 5xx: 一時的に落ちているだけの可能性があるのでドロップ枠は有効なまま
     (実際のアップロード時に既存の 503/ネットワークエラー処理に任せる) */
function checkApiAvailabilityOnLoad() {
  fetch(DEMO_API_BASE + '/demo/warmup')
    .then(res => {
      res.text().catch(() => { /* ignore */ });
      if (res.status === 404) disableDropzoneForUnavailable();
      // 200 はそのまま有効。5xx もそのまま有効(既存のアップロード時エラー処理に委ねる)。
    })
    .catch(() => {
      disableDropzoneForUnavailable();
    });
}

function disableDropzoneForUnavailable() {
  // アップロードを開始済みなら、進行中の処理を邪魔しない。
  if (state.uploading || state.apiDisabled) return;
  state.apiDisabled = true;

  const normal = $('dropzone-normal');
  const notice = $('dropzone-unavailable');
  if (normal) normal.hidden = true;
  if (notice) notice.hidden = false;
  setDropzoneMessage('');

  const fileInput = $('file-input');
  if (fileInput) fileInput.disabled = true;
}

/* ------------------------------------------------------------------ */
/* validation                                                           */
/* ------------------------------------------------------------------ */
function validateFiles(files) {
  if (files.length < MIN_FILES) return { ok: false, message: '5枚以上入れてください' };
  if (files.length > MAX_FILES) return { ok: false, message: '20枚までです' };
  for (let i = 0; i < files.length; i++) {
    if (files[i].size > MAX_FILE_BYTES) {
      return { ok: false, message: '1枚が大きすぎます(10MBまで): ' + files[i].name };
    }
  }
  for (let i = 0; i < files.length; i++) {
    if (!isAllowedFile(files[i])) {
      return { ok: false, message: 'PDFではないファイルがあります: ' + files[i].name };
    }
  }
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* embed API                                                            */
/* ------------------------------------------------------------------ */
async function embedWithRetry(file) {
  let attempts = 0;
  for (;;) {
    let res;
    try {
      res = await fetch(DEMO_API_BASE + '/demo/embed', {
        method: 'POST',
        body: file,
        headers: { 'Content-Type': file.type || 'application/octet-stream' }
      });
    } catch (e) {
      throw { type: 'network' };
    }

    if (res.status === 200) {
      return res.json();
    }

    if (res.status === 429) {
      attempts++;
      if (attempts > MAX_RETRIES) throw { type: 'busy' };
      let retryAfter = MAX_RETRY_WAIT_SEC;
      const headerVal = res.headers.get('Retry-After');
      if (headerVal && !isNaN(parseInt(headerVal, 10))) retryAfter = parseInt(headerVal, 10);
      try {
        const data = await res.json();
        if (data && typeof data.retryAfterSec === 'number') retryAfter = data.retryAfterSec;
      } catch (e) { /* keep header-derived value */ }
      retryAfter = Math.max(1, Math.min(MAX_RETRY_WAIT_SEC, retryAfter));
      await sleep(retryAfter * 1000);
      continue;
    }

    if (res.status === 503 || res.status === 404) {
      throw { type: 'unavailable' };
    }

    // 400 empty / 413 too_large / 415 unsupported_format / 422 render_failed
    // → ファイル単位の失敗として扱い、アップロード全体は続行する
    throw { type: 'unreadable' };
  }
}

/* ------------------------------------------------------------------ */
/* thumbnails                                                           */
/* ------------------------------------------------------------------ */
function loadPdfJs() {
  if (!pdfjsLibPromise) {
    pdfjsLibPromise = import(/* webpackIgnore: true */ PDFJS_URL).then(lib => {
      lib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
      return lib;
    });
  }
  return pdfjsLibPromise;
}

async function renderPdfThumb(file) {
  try {
    const pdfjsLib = await loadPdfJs();
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    const page = await pdf.getPage(1);
    const baseViewport = page.getViewport({ scale: 1 });
    // 結果モーダルの左ペイン(大きいプレビュー)にもそのまま使うため、一覧の
    // 小さいサムネイル用よりずっと高い解像度でレンダリングしておく。
    const scale = Math.min(900 / baseViewport.width, 900 / baseViewport.height, 4);
    const viewport = page.getViewport({ scale: scale > 0 ? scale : 1 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(viewport.width));
    canvas.height = Math.max(1, Math.ceil(viewport.height));
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
    return canvas.toDataURL('image/png');
  } catch (e) {
    return null;
  }
}

async function getThumbUrl(entry) {
  if (entry.thumbUrl) return entry.thumbUrl;
  if (entry.thumbFailed) return null;
  let url = null;
  if (isImageFile(entry.file)) {
    try {
      url = URL.createObjectURL(entry.file);
      state.objectUrls.push(url);
    } catch (e) {
      url = null;
    }
  } else {
    url = await renderPdfThumb(entry.file);
  }
  if (url) entry.thumbUrl = url;
  else entry.thumbFailed = true;
  return url;
}

/* ------------------------------------------------------------------ */
/* drop zone                                                            */
/* ------------------------------------------------------------------ */
(function initDropzone() {
  const dropzone = $('dropzone');
  const fileInput = $('file-input');
  if (!dropzone || !fileInput) return;

  function openFileDialog() {
    if (state.uploading || state.apiDisabled) return;
    fileInput.click();
  }

  dropzone.addEventListener('click', openFileDialog);
  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      openFileDialog();
    }
  });

  dropzone.addEventListener('dragenter', (e) => {
    e.preventDefault();
    if (state.uploading || state.apiDisabled) return;
    dropzone.classList.add('is-dragging');
    // dragover は1回のドラッグ中に何十回も発火するため、ウォームアップは
    // dragenter だけで撃つ(dragover でも撃つとリクエストが積み上がる)。
    fireWarmup();
  });

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (state.uploading || state.apiDisabled) return;
    dropzone.classList.add('is-dragging');
  });

  ['dragleave', 'dragend'].forEach(evt => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.remove('is-dragging');
    });
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('is-dragging');
    if (state.uploading || state.apiDisabled) return;
    const dt = e.dataTransfer;
    if (dt && dt.files && dt.files.length) {
      handleFileSelection(dt.files);
    }
  });

  fileInput.addEventListener('change', () => {
    if (!state.uploading && !state.apiDisabled && fileInput.files && fileInput.files.length) {
      fireWarmup();
      handleFileSelection(fileInput.files);
    }
    fileInput.value = '';
  });

  function handleFileSelection(fileList) {
    const files = Array.prototype.slice.call(fileList);
    const validation = validateFiles(files);
    if (!validation.ok) {
      setDropzoneMessage(validation.message);
      return;
    }
    setDropzoneMessage('');
    startUpload(files);
  }
})();

(function initUnavailableNotice() {
  const btn = $('dropzone-unavailable-btn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const el = $('samples-section');
    if (el) el.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'start' });
  });
})();

function setDropzoneMessage(text) {
  const el = $('dropzone-message');
  if (el) el.textContent = text || '';
}

/* ------------------------------------------------------------------ */
/* upload progress UI                                                   */
/* ------------------------------------------------------------------ */
function showProgress() { const el = $('upload-progress'); if (el) el.hidden = false; }
function hideProgress() {
  const el = $('upload-progress');
  if (el) el.hidden = true;
  const bar = $('upload-progress-bar');
  if (bar) bar.style.width = '0%';
  const fileEl = $('upload-progress-file');
  if (fileEl) fileEl.textContent = '';
  const extraEl = $('upload-progress-extra');
  if (extraEl) extraEl.textContent = '';
}
function updateProgress(index, total, name) {
  const label = $('upload-progress-label');
  if (label) label.textContent = '図面を読み取っています(1枚あたり数秒) ' + (index + 1) + '/' + total + '枚';
  const bar = $('upload-progress-bar');
  if (bar) bar.style.width = Math.round((index / total) * 100) + '%';
  const fileEl = $('upload-progress-file');
  if (fileEl) fileEl.textContent = name;
  setProgressExtra('');
}
function setProgressExtra(text) {
  const el = $('upload-progress-extra');
  if (el) el.textContent = text || '';
}

/* ------------------------------------------------------------------ */
/* upload sequence                                                      */
/* ------------------------------------------------------------------ */
async function startUpload(files) {
  const dropzone = $('dropzone');
  state.uploading = true;
  if (dropzone) dropzone.classList.add('is-uploading');
  if (activeModal) activeModal.close();
  showProgress();

  state.files = files.map(f => ({ file: f, name: f.name, status: 'pending', vectors: null, thumbUrl: null, thumbFailed: false }));

  let succeeded = 0;
  let aborted = false;
  let abortMessage = '';

  for (let i = 0; i < state.files.length; i++) {
    const entry = state.files[i];
    updateProgress(i, state.files.length, entry.name);

    let slowShown = false;
    const slowTimer = setTimeout(() => {
      slowShown = true;
      setProgressExtra('サーバーを起こしています。初回だけ少し待ちます');
    }, SLOW_WARNING_MS);

    try {
      const data = await embedWithRetry(entry.file);
      clearTimeout(slowTimer);
      if (slowShown) setProgressExtra('');
      entry.status = 'done';
      entry.vectors = data.vectors;
      succeeded++;
    } catch (err) {
      clearTimeout(slowTimer);
      if (slowShown) setProgressExtra('');
      entry.status = 'failed';
      if (err && err.type === 'network') {
        aborted = true;
        abortMessage = 'サーバーに接続できませんでした。少し待ってからもう一度お試しください';
        break;
      }
      if (err && err.type === 'unavailable') {
        aborted = true;
        abortMessage = 'サーバーに接続できませんでした。少し待ってからもう一度お試しください';
        break;
      }
      if (err && err.type === 'busy') {
        aborted = true;
        abortMessage = '混雑しています。少し待ってからもう一度お試しください';
        break;
      }
      // 'unreadable' 等: このファイルだけ失敗として次へ続行
    }
  }

  hideProgress();
  state.uploading = false;
  if (dropzone) dropzone.classList.remove('is-uploading');

  if (aborted) {
    setDropzoneMessage(abortMessage);
    return;
  }
  if (succeeded < MIN_FILES) {
    setDropzoneMessage('5枚以上、正しく読み取れませんでした。図面を確認してもう一度お試しください');
    return;
  }

  openUploadResultsModal();
}

function performRestart() {
  state.objectUrls.forEach(url => { try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ } });
  state.objectUrls = [];
  state.files = [];
  state.resultsShown = false;

  hideProgress();
  setDropzoneMessage('');

  try { history.pushState({}, '', '/drawing/demo/'); } catch (e) { /* ignore */ }

  const dropzone = $('dropzone');
  if (dropzone) dropzone.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'start' });
}

/* ------------------------------------------------------------------ */
/* sample drawings                                                      */
/* ------------------------------------------------------------------ */
async function loadSamples() {
  try {
    const res = await fetch('samples/samples.json');
    if (!res.ok) return;
    const data = await res.json();
    if (!data || !Array.isArray(data.items) || data.items.length === 0) return;
    state.samples = data;
    state.gallery.order = buildFamilySpanningOrder(data.items);
    state.gallery.expanded = false;
    const section = $('samples-section');
    if (section) section.hidden = false;
    renderGallery();
  } catch (e) {
    // samples.json が無い/壊れている場合はセクションを出さないだけ
  }
}

// タイトル末尾の図番(例:「ガイドレール PB-3014-F」→ PB-3014)を家系キーとして
// 使う。改訂サフィックス(末尾の英字1文字)は同じ家系とみなして落とす。
// サフィックスが無い図番(単発部品)はそのままキーになり、自然に1件だけの
// 家系になる。パターンに一致しない場合はタイトル全体をキーにする(孤立扱い)。
function familyKeyForItem(item) {
  const title = (item && (item.title || item.id)) || '';
  const m = title.match(/(PB-\d+)(?:-[A-Za-z])?\s*$/);
  return m ? m[1] : title;
}

// 初期表示(折りたたみ時)が特定の家系(例:フランジ)だけで埋まらないよう、
// 「各家系から1枚ずつ→まだ残っている家系から2枚目ずつ→…」の順に並べ替えた
// 表示順を作る。ファイル内の初出順を家系順として使うので、結果は毎回同じ
// (決定的)になる。折りたたみ数(9/18)は常にこの並びの先頭からのスライスな
// ので、展開してもすでに見えているカードの位置は動かない。
function buildFamilySpanningOrder(items) {
  const byFamily = new Map();
  items.forEach((item, idx) => {
    const key = familyKeyForItem(item);
    if (!byFamily.has(key)) byFamily.set(key, []);
    byFamily.get(key).push({ item, idx });
  });
  const families = Array.from(byFamily.values());
  const order = [];
  let round = 0;
  while (order.length < items.length) {
    let addedAny = false;
    for (let i = 0; i < families.length; i++) {
      const arr = families[i];
      if (arr.length > round) {
        order.push(arr[round]);
        addedAny = true;
      }
    }
    if (!addedAny) break;
    round++;
  }
  return order;
}

// グリッドの実際の列数を「CSSが今どう解決しているか」から読む
// (ブレークポイントを変えてもここは追従する)。
function getGalleryColumnCount() {
  const grid = $('samples-grid');
  if (!grid) return 3;
  try {
    const value = window.getComputedStyle(grid).gridTemplateColumns;
    const count = value.split(' ').map(s => s.trim()).filter(Boolean).length;
    return count > 0 ? count : 3;
  } catch (e) {
    return 3;
  }
}

function renderGallery() {
  const grid = $('samples-grid');
  const toggleBtn = $('samples-toggle-btn');
  const order = state.gallery.order;
  if (!grid || !order) return;

  const total = order.length;
  const collapsedCount = getGalleryColumnCount() * 3;
  const showCount = state.gallery.expanded ? total : Math.min(collapsedCount, total);
  const slice = order.slice(0, showCount);

  grid.innerHTML = '';
  slice.forEach(({ item, idx }) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'demo-sample-item';

    const img = document.createElement('img');
    img.src = SAMPLES_BASE + item.thumb;
    img.alt = item.title || ('サンプル図面 ' + (idx + 1));
    img.loading = 'lazy';
    img.width = 160;
    img.height = 120;
    img.onerror = () => { img.style.visibility = 'hidden'; };
    btn.appendChild(img);

    btn.addEventListener('click', () => openSampleResultsModal(idx));
    grid.appendChild(btn);
  });

  if (toggleBtn) {
    if (total <= collapsedCount) {
      toggleBtn.hidden = true;
    } else {
      toggleBtn.hidden = false;
      toggleBtn.textContent = state.gallery.expanded
        ? '3行に戻す'
        : '残りの' + (total - showCount) + '枚を見る';
    }
  }
}

(function initGalleryToggle() {
  const toggleBtn = $('samples-toggle-btn');
  if (!toggleBtn) return;

  toggleBtn.addEventListener('click', () => {
    const wasExpanded = state.gallery.expanded;
    state.gallery.expanded = !wasExpanded;
    renderGallery();
    if (wasExpanded) {
      // 展開→折りたたみ: ページが大きく縮むので、見出しが画面内に残るよう
      // その場でスクロール位置を合わせ直す(スムーズスクロールだと縮んだ
      // 先を追いかけて変な動きになるため instant)。
      const section = $('samples-section');
      if (section) section.scrollIntoView({ behavior: 'auto', block: 'start' });
    }
  });

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    if (!state.samples || state.gallery.expanded) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(renderGallery, 150);
  });
})();

/* ==================================================================== */
/* 結果モーダル — 本番kintoneプラグインの openSimilarModal 相当。          */
/* サンプル図面クリック・自分の図面アップロードの両方でこれ1つを共有する。 */
/* ==================================================================== */

let activeModal = null;

function buildKintoneLookBlock() {
  const wrap = document.createElement('div');
  wrap.className = 'demo-modal-kintone-look';
  wrap.id = 'kintone-look';

  const heading = document.createElement('p');
  heading.className = 'demo-modal-kintone-look-heading';
  heading.textContent = 'kintone の中ではこう見えます';
  wrap.appendChild(heading);

  const img = document.createElement('img');
  img.className = 'demo-modal-kintone-look-img';
  img.src = KINTONE_LOOK_IMAGE_SRC;
  img.alt = KINTONE_LOOK_IMAGE_ALT;
  img.width = KINTONE_LOOK_IMAGE_WIDTH;
  img.height = KINTONE_LOOK_IMAGE_HEIGHT;
  img.loading = 'lazy';
  wrap.appendChild(img);

  const caption = document.createElement('p');
  caption.className = 'demo-modal-kintone-look-caption';
  caption.appendChild(document.createTextNode('kintoneの中では、図面を開いてボタンを1つ押すと、この画面が出ます。'));
  caption.appendChild(document.createElement('br'));
  caption.appendChild(document.createTextNode('左がいま開いている図面、右が似ている順の候補です。'));
  wrap.appendChild(caption);

  const note = document.createElement('p');
  note.className = 'demo-modal-kintone-look-note';
  note.textContent = 'プラグインが動いている実際のkintone画面です。データはデモ用に作成したものです。';
  wrap.appendChild(note);

  return wrap;
}

// plugin.js の createModalShell(L310-360) 相当: overlay・×・Esc・オーバーレイ
// クリックで閉じる。本番はShadow DOMを使うが、デモは単一ページのスタイルを
// そのままかぶせたいので通常DOM + name-spaced class(demo-modal-*)で代用する。
function createResultsModal() {
  const overlay = document.createElement('div');
  overlay.className = 'demo-modal-overlay';

  const modal = document.createElement('div');
  modal.className = 'demo-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'demo-modal-title');
  modal.tabIndex = -1;

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'demo-modal-close';
  closeBtn.setAttribute('aria-label', '閉じる');
  closeBtn.textContent = '×';

  const header = document.createElement('div');
  header.className = 'demo-modal-header';
  const title = document.createElement('h2');
  title.id = 'demo-modal-title';
  header.appendChild(title);
  const actions = document.createElement('div');
  actions.className = 'demo-modal-header-actions';
  header.appendChild(actions);

  const layout = document.createElement('div');
  layout.className = 'demo-modal-layout';

  const preview = document.createElement('div');
  preview.className = 'demo-modal-preview';
  const previewLabel = document.createElement('div');
  previewLabel.className = 'demo-modal-preview-label';
  const previewBody = document.createElement('div');
  previewBody.className = 'demo-modal-preview-body';
  const previewActions = document.createElement('div');
  previewActions.className = 'demo-modal-preview-actions';
  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'demo-modal-preview-reset';
  resetBtn.textContent = '元の図面に戻す';
  resetBtn.hidden = true;
  const rerankBtn = document.createElement('button');
  rerankBtn.type = 'button';
  rerankBtn.className = 'demo-modal-preview-reset demo-modal-preview-rerank';
  rerankBtn.textContent = 'この図面を元に並べ直す';
  rerankBtn.hidden = true;
  previewActions.append(resetBtn, rerankBtn);
  preview.append(previewLabel, previewBody, previewActions);

  const list = document.createElement('div');
  list.className = 'demo-modal-list';

  layout.append(preview, list);
  modal.append(closeBtn, header, layout);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  let onCloseCb = null;
  const onKeydown = (e) => { if (e.key === 'Escape') close(); };
  function close() {
    document.removeEventListener('keydown', onKeydown, true);
    overlay.remove();
    if (activeModal === handle) activeModal = null;
    if (onCloseCb) onCloseCb();
  }
  document.addEventListener('keydown', onKeydown, true);
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  setTimeout(() => modal.focus(), 0);

  const handle = {
    title, actions, previewLabel, previewBody, resetBtn, rerankBtn, list, close,
    currentEntry: null,
    setOnClose: (cb) => { onCloseCb = cb; },
  };
  activeModal = handle;
  return handle;
}

// 左ペインの大きいプレビューを差し替える。entry.getImageUrl() は文字列 or
// Promise<string|null> のどちらでもよい(サンプルは同期パス、アップロード
// ファイルは getThumbUrl の非同期解決)。
let previewToken = 0;
async function setModalPreview(handle, entry, isOriginal) {
  const token = ++previewToken;
  handle.currentEntry = entry;
  handle.previewLabel.textContent = entry.name || '';
  handle.resetBtn.hidden = !!isOriginal;
  handle.rerankBtn.hidden = !!isOriginal;
  handle.previewBody.innerHTML = '';

  const placeholder = document.createElement('div');
  placeholder.className = 'demo-modal-preview-placeholder';
  placeholder.textContent = 'プレビューを読み込み中...';
  handle.previewBody.appendChild(placeholder);

  const url = await Promise.resolve(entry.getImageUrl());
  if (token !== previewToken) return; // 別の候補がその間にクリックされた

  handle.previewBody.innerHTML = '';
  if (url) {
    const img = document.createElement('img');
    img.className = 'demo-modal-preview-img';
    img.src = url;
    img.alt = entry.name || '';
    handle.previewBody.appendChild(img);
  } else {
    const msg = document.createElement('div');
    msg.className = 'demo-modal-preview-placeholder';
    msg.textContent = 'プレビューを表示できません';
    handle.previewBody.appendChild(msg);
  }
}

function highlightCurrentRow(handle, rowEl) {
  Array.prototype.forEach.call(handle.list.querySelectorAll('.demo-modal-item'), el => {
    el.classList.remove('is-current');
  });
  if (rowEl) rowEl.classList.add('is-current');
}

async function resolveRowThumb(thumbBox, entry) {
  const url = await Promise.resolve(entry.getImageUrl());
  if (!thumbBox.isConnected || !url) return;
  const img = document.createElement('img');
  img.src = url;
  img.alt = '';
  img.loading = 'lazy';
  thumbBox.appendChild(img);
}

// candidates: [{ name, meta, sim, unreadable, getImageUrl }]
// plugin.js の .sim-item 行(L4683〜)を1つの見た目に統一して移植したもの
// (本番は上位3件だけ .sim-hero-card に拡大するが、デモは全件この行サイズで
// 統一し、代わりにサムネイルそのものを68px=本番の一覧サムネイルサイズにした)。
function renderModalList(handle, candidates, onSelect) {
  handle.list.innerHTML = '';
  let readableRank = 0;

  candidates.forEach((c) => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'demo-modal-item' + (c.unreadable ? ' is-unreadable' : '');
    if (c.unreadable) row.disabled = true;

    const thumbBox = document.createElement('div');
    thumbBox.className = 'demo-modal-item-thumb';
    row.appendChild(thumbBox);

    let rankNum = null;
    if (!c.unreadable) {
      readableRank += 1;
      rankNum = readableRank;
      resolveRowThumb(thumbBox, c);
      const rankBadge = document.createElement('span');
      rankBadge.className = 'demo-modal-item-rank';
      rankBadge.textContent = rankNum + '位';
      thumbBox.appendChild(rankBadge);
    } else {
      thumbBox.textContent = '×';
    }

    const info = document.createElement('div');
    info.className = 'demo-modal-item-info';
    const nameEl = document.createElement('div');
    nameEl.className = 'demo-modal-item-name';
    nameEl.textContent = c.name;
    info.appendChild(nameEl);
    const metaEl = document.createElement('div');
    metaEl.className = 'demo-modal-item-meta';
    metaEl.textContent = c.unreadable ? '読み取れませんでした' : (c.meta || '');
    if (metaEl.textContent) info.appendChild(metaEl);
    row.appendChild(info);

    // 「近い」バッジ: 数値は出さず、上位3件かつ類似度0.87以上だけ、本番の
    // scoreBandClass 最上位バンド(sim-score.band-high)の見た目で出す。
    if (!c.unreadable && rankNum <= 3 && c.sim >= NEAR_THRESHOLD) {
      const badge = document.createElement('span');
      badge.className = 'demo-modal-badge-near';
      badge.textContent = '近い';
      row.appendChild(badge);
    }

    if (!c.unreadable) {
      row.addEventListener('click', () => {
        setModalPreview(handle, c, false);
        highlightCurrentRow(handle, row);
        onSelect && onSelect(c);
      });
    }

    handle.list.appendChild(row);
  });
}

function openSampleResultsModal(idx) {
  if (!state.samples) return;
  const items = state.samples.items;
  const original = items[idx];
  if (!original) return;

  const toEntry = (item) => ({
    name: item.title || item.id,
    meta: formatSampleMeta(item),
    getImageUrl: () => SAMPLES_BASE + item.thumb,
    raw: item,
  });

  const handle = createResultsModal();
  handle.title.textContent = 'この図面に似ている順';

  const backBtn = document.createElement('button');
  backBtn.type = 'button';
  backBtn.className = 'demo-modal-btn-secondary';
  backBtn.textContent = '別の図面で試す';
  backBtn.addEventListener('click', handle.close);
  handle.actions.appendChild(backBtn);

  // baseline = 候補リストが現在誰を基準にランキングされているか。
  // スワップ(プレビュー切替)はこれを変えない。「並べ直す」だけがこれを進める。
  let baseline = original;

  const buildCandidates = (sourceItem) => items
    .map((it, i) => ({ item: it, i, sim: dot(sourceItem.vector, it.vector) }))
    .filter(r => r.item !== sourceItem)
    .sort((a, b) => b.sim - a.sim)
    .slice(0, 10)
    .map(r => Object.assign(toEntry(r.item), { sim: r.sim }));

  const showBaseline = () => {
    setModalPreview(handle, toEntry(baseline), true);
    highlightCurrentRow(handle, null);
  };

  const renderListFor = (sourceItem) => {
    renderModalList(handle, buildCandidates(sourceItem));
    handle.list.appendChild(buildKintoneLookBlock());
  };

  renderListFor(baseline);
  showBaseline();

  handle.resetBtn.addEventListener('click', showBaseline);
  handle.rerankBtn.addEventListener('click', () => {
    baseline = handle.currentEntry.raw;
    renderListFor(baseline);
    showBaseline();
  });

  if (!state.sampleClickShown) {
    state.sampleClickShown = true;
    try { history.pushState({}, '', '/drawing/demo/sample-click/'); } catch (e) { /* ignore */ }
  }
}

function openUploadResultsModal() {
  const doneFiles = state.files.filter(f => f.status === 'done');
  const original = doneFiles[0];
  if (!original) return;

  const toEntry = (entry) => ({
    name: entry.name,
    meta: fileTypeLabel(entry.file),
    getImageUrl: () => getThumbUrl(entry),
    raw: entry,
  });

  const handle = createResultsModal();
  handle.title.textContent = 'この図面に似ている順';

  const restartBtn = document.createElement('button');
  restartBtn.type = 'button';
  restartBtn.className = 'demo-modal-btn-secondary';
  restartBtn.textContent = 'やり直す';
  restartBtn.addEventListener('click', () => {
    handle.close();
    performRestart();
  });
  handle.actions.appendChild(restartBtn);

  // baseline = 候補リストが現在誰を基準にランキングされているか。
  // スワップ(プレビュー切替)はこれを変えない。「並べ直す」だけがこれを進める。
  let baseline = original;

  // 元は「クエリ行」として別枠に出していた読み取り失敗ファイルも、ここでは
  // 同じ候補リストの中に(読み取れませんでした・クリック不可)で混ぜて出す
  // (要件5: クエリ行を候補リストへ統合)。並び替えは類似度降順、失敗分は末尾。
  const buildCandidates = (sourceEntry) => state.files
    .filter(f => f !== sourceEntry)
    .map(f => (f.status === 'done'
      ? Object.assign(toEntry(f), { sim: similarity(sourceEntry, f) })
      : { name: f.name, unreadable: true }))
    .sort((a, b) => {
      if (!!a.unreadable !== !!b.unreadable) return a.unreadable ? 1 : -1;
      if (a.unreadable) return 0;
      return b.sim - a.sim;
    });

  const showBaseline = () => {
    setModalPreview(handle, toEntry(baseline), true);
    highlightCurrentRow(handle, null);
  };

  const renderListFor = (sourceEntry) => {
    renderModalList(handle, buildCandidates(sourceEntry));
    handle.list.appendChild(buildKintoneLookBlock());
  };

  renderListFor(baseline);
  showBaseline();

  handle.resetBtn.addEventListener('click', showBaseline);
  handle.rerankBtn.addEventListener('click', () => {
    baseline = handle.currentEntry.raw;
    renderListFor(baseline);
    showBaseline();
  });

  if (!state.resultsShown) {
    state.resultsShown = true;
    try { history.pushState({}, '', '/drawing/demo/results/'); } catch (e) { /* ignore */ }
  }
}

/* ------------------------------------------------------------------ */
/* init                                                                 */
/* ------------------------------------------------------------------ */
checkApiAvailabilityOnLoad();
loadSamples();
