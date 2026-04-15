/* build.js */
console.log('BUILD.JS REV', new Date().toISOString(), process.env.GITHUB_SHA || 'local');

const fs = require('fs');
const path = require('path');
const { marked } = require('marked');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const PRODUCTS_DIR = path.join(DIST, 'products');
const PRODUCTS_EN_DIR = path.join(PRODUCTS_DIR, 'en');
const MANUALS_SRC = path.join(ROOT, 'manuals');

// サイト共通定数（products.json に持たせない）
const SUPPORT_MAIL = 'support@plugbits.app';
const SITE_COPYRIGHT = '© 2025 PlugBits. All rights reserved.';

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

function ensureDirs() {
  fs.rmSync(DIST, {recursive: true, force: true});
  fs.mkdirSync(PRODUCTS_DIR, {recursive: true});
  fs.mkdirSync(PRODUCTS_EN_DIR, {recursive: true});
}

function readJSON(p) { return JSON.parse(fs.readFileSync(p, 'utf-8')); }
function readText(p) { return fs.readFileSync(p, 'utf-8'); }
function fileExists(p) { return fs.existsSync(p); }

function renderTags(csv) {
  return (csv || '').split(',').map(s => s.trim()).filter(Boolean)
    .map(t => `<span class="kb-tag">${esc(t)}</span>`).join('');
}

function renderFeatures(semicolon) {
  return (semicolon || '').split(';').map(s => s.trim()).filter(Boolean)
    .map(x => `<li>${esc(x)}</li>`).join('');
}

function renderSteps(lines) {
  const arr = Array.isArray(lines) ? lines : [];
  return arr.map(line => {
    const [n, h, b] = String(line).split('|');
    return `<div class="kb-step"><div class="kb-step-number">${esc(n||'')}</div><div><h3>${esc(h||'')}</h3><p>${esc(b||'')}</p></div></div>`;
  }).join('');
}

function renderLimitations(semicolon) {
  return (semicolon || '').split(';').map(s => s.trim()).filter(Boolean)
    .map(x => `<li>${esc(x)}</li>`).join('');
}

function renderFAQ(lines) {
  const arr = Array.isArray(lines) ? lines : [];
  return arr.map(line => {
    const [q, a] = String(line).split('|');
    return `<div class="kb-faq-item"><h3>${esc(q||'')}</h3><p>${esc(a||'')}</p></div>`;
  }).join('');
}

function shortText(s, n = 64) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/* screenshots: [{ src, caption_ja, caption_en }, ...] */
function renderScreenshots(screenshots, captionKey, imgPrefix) {
  const arr = Array.isArray(screenshots) ? screenshots : [];
  return arr.map(item => {
    const srcRel = item.src || '';
    const cap = item[captionKey] || '';
    const src = imgPrefix + srcRel;
    const ext = srcRel.split('.').pop().toLowerCase();
    if (ext === 'mp4') {
      const poster = esc(src.replace(/\.mp4$/i, '.png'));
      return `<figure class="kb-shot"><div class="kb-shot-media"><button class="kb-video-play" aria-label="Play"><svg viewBox="0 0 64 64" width="56" height="56"><circle cx="32" cy="32" r="30" fill="rgba(0,0,0,.55)"></circle><polygon points="26,20 26,44 46,32" fill="#fff"></polygon></svg></button><video class="kb-video-el" preload="metadata" playsinline webkit-playsinline poster="${poster}"><source src="${esc(src)}" type="video/mp4"></video></div><figcaption>${esc(cap)}</figcaption></figure>`;
    }
    return `<figure class="kb-shot"><div class="kb-shot-media"><img src="${esc(src)}" alt="${esc(cap)}" loading="lazy"></div><figcaption>${esc(cap)}</figcaption></figure>`;
  }).join('');
}

function renderBrevoFormHtml(formSrc) {
  if (!formSrc) return '';
  return `<iframe width="540" height="305" src="${esc(formSrc)}" frameborder="0" scrolling="auto" allowfullscreen style="display:block;margin:0 auto;max-width:100%;"></iframe>`;
}

try {
  ensureDirs();

  const products = readJSON(path.join(ROOT, 'data', 'products.json'));
  const tpl = {
    ja:       readText(path.join(ROOT, 'templates', 'product-ja.html')),
    en:       readText(path.join(ROOT, 'templates', 'product-en.html')),
    manualJa: readText(path.join(ROOT, 'templates', 'manual-ja.html')),
    manualEn: readText(path.join(ROOT, 'templates', 'manual-en.html')),
    indexJa:  readText(path.join(ROOT, 'templates', 'index-ja.html')),
    indexEn:  readText(path.join(ROOT, 'templates', 'index-en.html')),
  };

  const plugins = products.filter(p => p.type === 'plugin');

  /**
   * プラグイン詳細ページを生成する。
   * JA: dist/products/{slug}.html      (imgPrefix: ../)
   * EN: dist/products/en/{slug}.html   (imgPrefix: ../../)
   */
  function fillProduct(p, lang) {
    const isJa = lang === 'ja';
    const imgPrefix = isJa ? '../' : '../../';
    const html = isJa ? tpl.ja : tpl.en;

    const hasManualJa = fileExists(path.join(MANUALS_SRC, `${p.slug}.ja.md`));
    const hasManualEn = fileExists(path.join(MANUALS_SRC, `${p.slug}.en.md`));
    const hasManual = isJa ? hasManualJa : hasManualEn;
    const manualUrl = isJa ? `${p.slug}-manual.html` : `${p.slug}-manual.html`;
    const manualBtnHtml = hasManual
      ? `<a class="kb-btn kb-btn-manual" href="${manualUrl}">${isJa ? 'マニュアルを見る' : 'View Manual'}</a>`
      : '';

    const altLangUrl = isJa ? `en/${p.slug}.html` : `../${p.slug}.html`;

    const map = {
      '%%SLUG%%':             p.slug,
      '%%STATUS_CLASS%%':     p.status === 'coming-soon' ? 'is-coming-soon' : '',
      '%%TITLE%%':            isJa ? p.title_ja    : p.title_en,
      '%%SUMMARY%%':          isJa ? p.summary_ja  : p.summary_en,
      '%%HERO_IMAGE%%':       imgPrefix + (p.hero_image || '').replace(/^\.?\/+/, ''),
      '%%TAGS_HTML%%':        renderTags(isJa ? p.tags_ja : p.tags_en),
      '%%FEATURES_HTML%%':    renderFeatures(isJa ? p.features_ja : p.features_en),
      '%%SCREENSHOTS_HTML%%': renderScreenshots(p.screenshots, isJa ? 'caption_ja' : 'caption_en', imgPrefix),
      '%%STEPS_HTML%%':       renderSteps(isJa ? p.steps_ja : p.steps_en),
      '%%LIMITATIONS_HTML%%': renderLimitations(isJa ? p.limitations_ja : p.limitations_en),
      '%%FAQ_HTML%%':         renderFAQ(isJa ? p.faq_ja : p.faq_en),
      '%%SUPPORTED_SCREENS%%': isJa ? p.supported_screens_ja : p.supported_screens_en,
      '%%CATEGORY%%':         isJa ? p.category_ja  : p.category_en,
      '%%FILE_SIZE%%':        p.file_size  || '',
      '%%UPDATED_AT%%':       p.updated_at || '',
      '%%INSTALL_URL%%':      p.install_url || '',
      '%%MANUAL_BTN%%':       manualBtnHtml,
      '%%ALT_LANG_URL%%':     altLangUrl,
      '%%SUPPORT_MAIL%%':     SUPPORT_MAIL,
      '%%SITE_COPYRIGHT%%':   SITE_COPYRIGHT,
    };

    let out = html;
    for (const [k, v] of Object.entries(map)) out = out.replaceAll(k, String(v ?? ''));
    return out;
  }

  // プラグイン詳細ページ生成
  for (const p of plugins) {
    fs.writeFileSync(path.join(PRODUCTS_DIR, `${p.slug}.html`),    fillProduct(p, 'ja'));
    fs.writeFileSync(path.join(PRODUCTS_EN_DIR, `${p.slug}.html`), fillProduct(p, 'en'));

    // マニュアルページ生成
    const manualJaPath = path.join(MANUALS_SRC, `${p.slug}.ja.md`);
    const manualEnPath = path.join(MANUALS_SRC, `${p.slug}.en.md`);

    if (fileExists(manualJaPath)) {
      const content = marked.parse(readText(manualJaPath));
      let out = tpl.manualJa
        .replaceAll('%%TITLE%%',          esc(p.title_ja))
        .replaceAll('%%SLUG%%',           p.slug)
        .replaceAll('%%MANUAL_CONTENT%%', content)
        .replaceAll('%%SUPPORT_MAIL%%',   SUPPORT_MAIL)
        .replaceAll('%%SITE_COPYRIGHT%%', SITE_COPYRIGHT);
      fs.writeFileSync(path.join(PRODUCTS_DIR, `${p.slug}-manual.html`), out);
    }

    if (fileExists(manualEnPath)) {
      const content = marked.parse(readText(manualEnPath));
      let out = tpl.manualEn
        .replaceAll('%%TITLE%%',          esc(p.title_en))
        .replaceAll('%%SLUG%%',           p.slug)
        .replaceAll('%%MANUAL_CONTENT%%', content)
        .replaceAll('%%SUPPORT_MAIL%%',   SUPPORT_MAIL)
        .replaceAll('%%SITE_COPYRIGHT%%', SITE_COPYRIGHT);
      fs.writeFileSync(path.join(PRODUCTS_EN_DIR, `${p.slug}-manual.html`), out);
    }
  }

  // インデックスページ用カード生成
  function buildCards(lang) {
    const isJa = lang === 'ja';
    const visible = products.filter(p => (p.status || 'public') !== 'unlisted');
    const extensions = visible.filter(p => p.type === 'extension');
    const pluginList  = visible.filter(p => p.type === 'plugin');

    const extHtml = extensions.map(p => {
      const title   = isJa ? p.title_ja         : p.title_en;
      const summary = isJa ? p.short_summary_ja  : p.short_summary_en;
      const href    = p.page_url || (isJa ? `products/${p.slug}.html` : `products/en/${p.slug}.html`);
      const label   = isJa ? '詳しく見る →' : 'Learn more →';
      const badge   = isJa ? '無料 / ブラウザ拡張機能' : 'Free / Browser Extension';
      return [
        `<a class="kb-launcher-card" href="${esc(href)}">`,
        '  <div class="kb-launcher-card-body">',
        `    <span class="kb-launcher-tag">${badge}</span>`,
        `    <h3>${esc(title)}</h3>`,
        `    <p>${esc(summary)}</p>`,
        `    <span class="kb-btn kb-btn-primary kb-launcher-cta">${label}</span>`,
        '  </div>',
        '  <div class="kb-launcher-card-visual">',
        `    <img src="${esc(p.hero_image)}" alt="${esc(title)}" class="kb-launcher-logo">`,
        '  </div>',
        '</a>',
      ].join('\n');
    }).join('\n');

    const pluginHtml = pluginList.map(p => {
      const isComing = p.status === 'coming-soon';
      const title    = isJa ? p.title_ja : p.title_en;
      const desc     = shortText(isJa ? (p.short_summary_ja || p.summary_ja) : (p.short_summary_en || p.summary_en), 64);
      const tags     = renderTags(isJa ? p.tags_ja : p.tags_en);
      const href     = isComing ? '#' : (isJa ? `products/${p.slug}.html` : `products/en/${p.slug}.html`);
      const badge    = isComing
        ? `<div class="kb-price-badge kb-price-coming">COMING SOON</div>`
        : `<div class="kb-price-badge kb-price-free">${isJa ? '無料' : 'Free'}</div>`;
      const btnLabel = isComing ? (isJa ? '準備中' : 'Coming Soon') : (isJa ? '詳細' : 'Details');
      const cardClass = 'kb-card' + (isComing ? ' kb-card--coming' : '');
      return [
        `<a class="${cardClass}" href="${esc(href)}">`,
        '  <div class="kb-card-img">',
        `    <img class="kb-hero-image" src="${esc(p.hero_image)}" alt="${esc(title)}" loading="lazy">`,
        '  </div>',
        '  <div class="kb-card-body">',
        `    <h3 class="kb-card-title">${esc(title)}</h3>`,
        `    <p class="kb-card-desc">${esc(desc)}</p>`,
        `    <div class="kb-card-tags">${tags}</div>`,
        '    <div class="kb-card-foot">',
        `      ${badge}`,
        `      <span class="kb-btn">${btnLabel}</span>`,
        '    </div>',
        '  </div>',
        '</a>',
      ].join('\n');
    }).join('\n');

    return { extHtml, pluginHtml };
  }

  const { extHtml: extJa, pluginHtml: pluginsJa } = buildCards('ja');
  const { extHtml: extEn, pluginHtml: pluginsEn } = buildCards('en');

  fs.writeFileSync(path.join(DIST, 'index.html'),
    tpl.indexJa
      .replaceAll('%%EXTENSION_CARDS%%', extJa)
      .replaceAll('%%PRODUCT_CARDS%%',   pluginsJa)
      .replaceAll('%%SUPPORT_MAIL%%',    SUPPORT_MAIL)
      .replaceAll('%%SITE_COPYRIGHT%%',  SITE_COPYRIGHT)
  );

  fs.mkdirSync(path.join(DIST, 'en'), {recursive: true});
  fs.writeFileSync(path.join(DIST, 'en', 'index.html'),
    tpl.indexEn
      .replaceAll('%%EXTENSION_CARDS%%', extEn)
      .replaceAll('%%PRODUCT_CARDS%%',   pluginsEn)
      .replaceAll('%%SUPPORT_MAIL%%',    SUPPORT_MAIL)
      .replaceAll('%%SITE_COPYRIGHT%%',  SITE_COPYRIGHT)
  );

  // 静的ファイルコピー
  const copy = rel => {
    const src = path.join(ROOT, rel);
    if (!fs.existsSync(src)) return;
    const dst = path.join(DIST, rel);
    const st = fs.lstatSync(src);
    if (st.isDirectory()) {
      fs.cpSync(src, dst, {recursive: true, force: true});
    } else {
      fs.mkdirSync(path.dirname(dst), {recursive: true});
      fs.copyFileSync(src, dst);
    }
  };
  copy('assets');
  ['style.css', 'terms.html', 'install2.html', 'robots.txt', 'sitemap-base.xml', '404.html'].forEach(copy);

  // docs/ → dist/ マージ（launcher 等）
  const docsDir = path.join(ROOT, 'docs');
  if (fs.existsSync(docsDir)) {
    for (const entry of fs.readdirSync(docsDir)) {
      if (entry === '.DS_Store') continue;
      const src = path.join(docsDir, entry);
      const dst = path.join(DIST, entry);
      fs.cpSync(src, dst, {recursive: true, force: true});
    }
  }

  // sitemap 生成
  const basePath = path.join(DIST, 'sitemap-base.xml');
  const base = fileExists(basePath)
    ? readText(basePath)
    : '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>';
  const urls = ['/index.html', '/en/index.html', '/terms.html', '/install2.html'];
  for (const p of plugins) {
    urls.push(`/products/${p.slug}.html`);
    urls.push(`/products/en/${p.slug}.html`);
    if (fileExists(path.join(MANUALS_SRC, `${p.slug}.ja.md`))) urls.push(`/products/${p.slug}-manual.html`);
    if (fileExists(path.join(MANUALS_SRC, `${p.slug}.en.md`))) urls.push(`/products/en/${p.slug}-manual.html`);
  }
  const xml = base.replace('</urlset>',
    urls.map(u => `<url><loc>{{BASE_URL}}${u}</loc></url>`).join('') + '</urlset>'
  );
  fs.writeFileSync(path.join(DIST, 'sitemap.xml'), xml);

  fs.writeFileSync(path.join(DIST, '.nojekyll'), '');
  console.log(`Build completed. ${plugins.length} plugin(s), ${products.filter(p=>p.type==='extension').length} extension(s).`);
} catch (e) {
  console.error('BUILD FAILED:', e);
  process.exit(1);
}
