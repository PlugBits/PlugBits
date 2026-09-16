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

const PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.7.76/pdf.min.mjs';
const PDFJS_WORKER_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.7.76/pdf.worker.min.mjs';

const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ------------------------------------------------------------------ */
/* state                                                                */
/* ------------------------------------------------------------------ */
const state = {
  files: [],          // [{ file, name, status: 'pending'|'done'|'failed', vectors, thumbUrl, thumbFailed }]
  currentQueryIndex: 0,
  uploading: false,
  resultsShown: false,   // pushState /drawing/demo/results/ が済んだか
  sampleClickShown: false,
  objectUrls: [],
  samples: null,
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

function fireWarmup() {
  // レスポンスボディを読み捨てないと、一部のサーバー(chunked応答)相手では
  // リクエストがブラウザ内で「読み込み中」のまま残り続け、同一オリジンへの
  // 接続を専有し続けることがある(実機検証で確認)。必ず本文を消費する。
  fetch(DEMO_API_BASE + '/demo/warmup')
    .then(res => res.text())
    .catch(() => { /* ignore */ });
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
    const scale = Math.min(240 / baseViewport.width, 240 / baseViewport.height, 4);
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

async function attachThumb(entry, placeholderEl, imgClass) {
  const url = await getThumbUrl(entry);
  if (!url || !placeholderEl.isConnected) return;
  const img = document.createElement('img');
  img.className = imgClass;
  img.src = url;
  img.alt = '';
  img.loading = 'lazy';
  placeholderEl.replaceWith(img);
}

/* ------------------------------------------------------------------ */
/* drop zone                                                            */
/* ------------------------------------------------------------------ */
(function initDropzone() {
  const dropzone = $('dropzone');
  const fileInput = $('file-input');
  if (!dropzone || !fileInput) return;

  function openFileDialog() {
    if (state.uploading) return;
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
    if (state.uploading) return;
    dropzone.classList.add('is-dragging');
    // dragover は1回のドラッグ中に何十回も発火するため、ウォームアップは
    // dragenter だけで撃つ(dragover でも撃つとリクエストが積み上がる)。
    fireWarmup();
  });

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (state.uploading) return;
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
    if (state.uploading) return;
    const dt = e.dataTransfer;
    if (dt && dt.files && dt.files.length) {
      handleFileSelection(dt.files);
    }
  });

  fileInput.addEventListener('change', () => {
    if (!state.uploading && fileInput.files && fileInput.files.length) {
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
  hideResultsSection();
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

  const firstDone = state.files.findIndex(f => f.status === 'done');
  state.currentQueryIndex = firstDone === -1 ? 0 : firstDone;
  renderResults();
}

/* ------------------------------------------------------------------ */
/* results rendering                                                    */
/* ------------------------------------------------------------------ */
function hideResultsSection() {
  const section = $('results-section');
  if (section) section.hidden = true;
  const queryRow = $('query-row');
  if (queryRow) queryRow.innerHTML = '';
  const rankedList = $('ranked-list');
  if (rankedList) rankedList.innerHTML = '';
}

function renderResults() {
  const section = $('results-section');
  const queryRow = $('query-row');
  const rankedList = $('ranked-list');
  if (!section || !queryRow || !rankedList) return;

  queryRow.innerHTML = '';
  rankedList.innerHTML = '';

  state.files.forEach((entry, idx) => {
    const card = document.createElement('button');
    card.type = 'button';
    const isActive = idx === state.currentQueryIndex;
    card.className = 'demo-query-card' + (entry.status !== 'done' ? ' is-disabled' : '') + (isActive ? ' is-active' : '');
    card.disabled = entry.status !== 'done';
    card.setAttribute('aria-pressed', isActive ? 'true' : 'false');

    const placeholder = document.createElement('div');
    placeholder.className = 'demo-thumb-fallback';
    placeholder.textContent = entry.status === 'done' ? entry.name : '読み取れませんでした';
    card.appendChild(placeholder);

    const nameEl = document.createElement('span');
    nameEl.className = 'demo-query-card-name';
    nameEl.textContent = entry.name;
    card.appendChild(nameEl);

    if (entry.status === 'done') {
      card.addEventListener('click', () => {
        state.currentQueryIndex = idx;
        renderResults();
      });
      attachThumb(entry, placeholder, 'demo-thumb-img');
    }

    queryRow.appendChild(card);
  });

  const query = state.files[state.currentQueryIndex];
  const others = state.files
    .map((entry, idx) => ({ entry, idx }))
    .filter(x => x.entry.status === 'done' && x.idx !== state.currentQueryIndex)
    .map(x => ({ entry: x.entry, sim: similarity(query, x.entry) }))
    .sort((a, b) => b.sim - a.sim);

  others.forEach((r, i) => {
    const li = document.createElement('li');
    li.className = 'demo-ranked-item';

    const rank = document.createElement('span');
    rank.className = 'demo-ranked-rank';
    rank.textContent = (i + 1) + '.';
    li.appendChild(rank);

    const thumbPlaceholder = document.createElement('div');
    thumbPlaceholder.className = 'demo-ranked-thumb-fallback';
    li.appendChild(thumbPlaceholder);
    attachThumb(r.entry, thumbPlaceholder, 'demo-ranked-thumb');

    const nameEl = document.createElement('span');
    nameEl.className = 'demo-ranked-name';
    nameEl.textContent = r.entry.name;
    li.appendChild(nameEl);

    if (i < 3 && r.sim >= NEAR_THRESHOLD) {
      const badge = document.createElement('span');
      badge.className = 'demo-badge-near';
      badge.textContent = '近い';
      li.appendChild(badge);
    }

    rankedList.appendChild(li);
  });

  section.hidden = false;

  if (!state.resultsShown) {
    state.resultsShown = true;
    try { history.pushState({}, '', '/drawing/demo/results/'); } catch (e) { /* ignore */ }
  }

  section.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'start' });
}

/* ------------------------------------------------------------------ */
/* restart                                                              */
/* ------------------------------------------------------------------ */
(function initRestart() {
  const btn = $('restart-btn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    state.objectUrls.forEach(url => { try { URL.revokeObjectURL(url); } catch (e) { /* ignore */ } });
    state.objectUrls = [];
    state.files = [];
    state.currentQueryIndex = 0;
    state.resultsShown = false;

    hideResultsSection();
    hideProgress();
    setDropzoneMessage('');

    try { history.pushState({}, '', '/drawing/demo/'); } catch (e) { /* ignore */ }

    const dropzone = $('dropzone');
    if (dropzone) dropzone.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'start' });
  });
})();

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
    renderSamplesGrid(data.items);
    const section = $('samples-section');
    if (section) section.hidden = false;
  } catch (e) {
    // samples.json が無い/壊れている場合はセクションを出さないだけ
  }
}

function renderSamplesGrid(items) {
  const grid = $('samples-grid');
  if (!grid) return;
  grid.innerHTML = '';
  items.forEach((item, idx) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'demo-sample-item';

    const img = document.createElement('img');
    img.src = 'samples/' + item.thumb;
    img.alt = item.title || ('サンプル図面 ' + (idx + 1));
    img.loading = 'lazy';
    img.width = 160;
    img.height = 120;
    img.onerror = () => { img.style.visibility = 'hidden'; };
    btn.appendChild(img);

    btn.addEventListener('click', () => openSamplePanel(idx));
    grid.appendChild(btn);
  });
}

function openSamplePanel(idx) {
  if (!state.samples) return;
  const items = state.samples.items;
  const query = items[idx];
  if (!query) return;

  const ranked = items
    .map((it, i) => ({ item: it, idx: i, sim: dot(query.vector, it.vector) }))
    .filter(r => r.idx !== idx)
    .sort((a, b) => b.sim - a.sim)
    .slice(0, 10);

  const list = $('samples-panel-list');
  if (list) {
    list.innerHTML = '';
    ranked.forEach((r, i) => {
      const li = document.createElement('li');
      li.className = 'demo-ranked-item';

      const rank = document.createElement('span');
      rank.className = 'demo-ranked-rank';
      rank.textContent = (i + 1) + '.';
      li.appendChild(rank);

      const img = document.createElement('img');
      img.className = 'demo-ranked-thumb';
      img.src = 'samples/' + r.item.thumb;
      img.alt = '';
      img.loading = 'lazy';
      li.appendChild(img);

      const nameEl = document.createElement('span');
      nameEl.className = 'demo-ranked-name';
      nameEl.textContent = r.item.title || r.item.id || ('サンプル ' + (r.idx + 1));
      li.appendChild(nameEl);

      if (i < 3 && r.sim >= NEAR_THRESHOLD) {
        const badge = document.createElement('span');
        badge.className = 'demo-badge-near';
        badge.textContent = '近い';
        li.appendChild(badge);
      }

      list.appendChild(li);
    });
  }

  const titleEl = $('samples-panel-title');
  if (titleEl) titleEl.textContent = 'この図面に似ている順';

  const panel = $('samples-panel');
  if (panel) panel.hidden = false;

  if (!state.sampleClickShown) {
    state.sampleClickShown = true;
    try { history.pushState({}, '', '/drawing/demo/sample-click/'); } catch (e) { /* ignore */ }
  }
}

function closeSamplePanel() {
  const panel = $('samples-panel');
  if (panel) panel.hidden = true;
}

(function initSamplePanel() {
  const closeBtn = $('samples-panel-close');
  const backBtn = $('samples-panel-back');
  const overlay = $('samples-panel');
  if (closeBtn) closeBtn.addEventListener('click', closeSamplePanel);
  if (backBtn) backBtn.addEventListener('click', closeSamplePanel);
  if (overlay) {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeSamplePanel();
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSamplePanel();
  });
})();

/* ------------------------------------------------------------------ */
/* init                                                                 */
/* ------------------------------------------------------------------ */
fireWarmup();
loadSamples();
