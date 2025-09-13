/* build.js — clean stable version */
console.log('BUILD.JS REV', new Date().toISOString(), process.env.GITHUB_SHA || 'local');

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const PRODUCTS_DIR = path.join(DIST, 'products');
const PRODUCTS_EN_DIR = path.join(PRODUCTS_DIR, 'en');

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, m => (
    {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]
  ));
}

function ensureDirs() {
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(PRODUCTS_EN_DIR, { recursive: true });
}

function readJSON(p){ return JSON.parse(fs.readFileSync(p, 'utf-8')); }
function readText(p){ return fs.readFileSync(p, 'utf-8'); }

/* ----- render helpers ----- */
function renderTags(csv){
  return (csv||'').split(',').map(s=>s.trim()).filter(Boolean)
    .map(t=>`<span class="kb-tag">${esc(t)}</span>`).join('');
}
function renderFeatures(semicolon){
  return (semicolon||'').split(';').map(s=>s.trim()).filter(Boolean)
    .map(x=>`<li>${esc(x)}</li>`).join('');
}
// 先頭付近に追加（ユーティリティ）
function assetExists(relPath){ // relPath: "assets/..." の形
  try { return fs.existsSync(path.join(ROOT, relPath)); } catch { return false; }
}

function renderScreenshots(list, prefix=''){
  const arr = Array.isArray(list) ? list : (list||'').split(';');
  return arr.map(item=>{
    // 形式: "path|video|caption" もしくは "path|caption"
    const parts = String(item).split('|').map(s=>s.trim());
    const srcPath = parts[0] || '';
    const type    = (parts[1] || '').toLowerCase();
    const caption = (type === 'video') ? (parts[2] || '') : (parts[1] || '');
    const src = prefix ? (prefix + srcPath) : srcPath;

    if (type === 'video') {
      const poster = src.replace(/\.mp4$/i, '.png'); // なければ 404 でも再生には影響なし
      return `
      <figure class="kb-shot">
        <div class="kb-shot-media">
          <button class="kb-video-play" aria-label="動画を再生">
            <svg viewBox="0 0 64 64" width="56" height="56">
              <circle cx="32" cy="32" r="30" fill="rgba(0,0,0,.55)"></circle>
              <polygon points="26,20 26,44 46,32" fill="#fff"></polygon>
            </svg>
          </button>
          <video class="kb-video-el" preload="metadata" playsinline poster="${poster}">
            <source src="${src}" type="video/mp4">
          </video>
        </div>
        <figcaption>${esc(caption)}</figcaption>
      </figure>`;
    }

    // 画像（2項目パターン: path|caption）
    return `
    <figure class="kb-shot">
      <div class="kb-shot-media">
        <img src="${esc(src)}" alt="${esc(caption || '')}" loading="lazy">
      </div>
      <figcaption>${esc(caption || '')}</figcaption>
    </figure>`;
  }).join('');
}


function renderSteps(lines){
  const arr = Array.isArray(lines) ? lines : [];
  return arr.map(line=>{
    const [num, h, body] = String(line).split('|');
    return `<div class="kb-step"><div class="kb-step-number">${esc(num||'')}</div><div><h3>${esc(h||'')}</h3><p>${esc(body||'')}</p></div></div>`;
  }).join('');
}
function renderLimitations(semicolon){
  return (semicolon||'').split(';').map(s=>s.trim()).filter(Boolean)
    .map(x=>`<li>${esc(x)}</li>`).join('');
}
function renderFAQ(lines){
  const arr = Array.isArray(lines) ? lines.slice(0,3) : [];
  return arr.map(line=>{
    const [q,a] = String(line).split('|');
    return `<div class="kb-faq-item"><h3>${esc(q||'')}</h3><p>${esc(a||'')}</p></div>`;
  }).join('');
}
function renderRelated(lines){
  const arr = Array.isArray(lines) ? lines.slice(0,2) : [];
  return arr.map(line=>{
    const [href, title, priceJPY] = String(line).split('|');
    return `<a class="kb-related-card" href="${esc(href)}">
      <div class="kb-related-title">${esc(title||'')}</div>
      <div class="kb-related-price" data-price-jpy="${esc(priceJPY||'')}" data-price-usd="">
        ¥${esc(priceJPY||'')}
      </div></a>`;
  }).join('');
}

/* ----- main build ----- */
try {
  ensureDirs();

  const products = readJSON(path.join(ROOT, 'data', 'products.json'));
  const tpl = {
    ja: readText(path.join(ROOT, 'templates', 'product-ja.html')),
    en: readText(path.join(ROOT, 'templates', 'product-en.html')),
    indexJa: readText(path.join(ROOT, 'templates', 'index-ja.html')),
    indexEn: readText(path.join(ROOT, 'templates', 'index-en.html')),
  };

  function fillProductJA(p){
    let html = tpl.ja;
    const map = {
      '%%SLUG%%': p.slug,
      '%%SITE_NAME_JA%%': p.site_name_ja || 'Kintone向けミニプラグイン',
      '%%TITLE_JA%%': p.title_ja,
      '%%SUMMARY_JA%%': p.summary_ja,
      '%%PRICE_JPY%%': p.price_jpy,
      '%%PRICE_USD%%': p.price_usd,
      '%%PURCHASE_URL%%': p.purchase_url,
      '%%HERO_IMAGE%%': p.hero_image.replace(/^\.?\/*/, ''),
      '%%SUPPORTED_SCREENS_JA%%': p.supported_screens_ja,
      '%%CATEGORY_JA%%': p.category_ja,
      '%%FILE_SIZE_JA%%': p.file_size_ja,
      '%%UPDATED_AT_JA%%': p.updated_at_ja,
      '%%TAGS_JA_HTML%%': renderTags(p.tags_ja),
      '%%FEATURES_JA_HTML%%': renderFeatures(p.features_ja),
      '%%SCREENSHOTS_JA_HTML%%': renderScreenshots(p.screenshots_ja, '../'),
      '%%STEPS_JA_HTML%%': renderSteps(p.steps_ja),
      '%%LIMITATIONS_JA_HTML%%': renderLimitations(p.limitations_ja),
      '%%FAQ_JA_HTML%%': renderFAQ(p.faq_ja),
      '%%RELATED_JA_HTML%%': renderRelated(p.related_ja),
      '%%CTA_HEADLINE_JA%%': p.cta_headline_ja,
      '%%CTA_TEXT_JA%%': p.cta_text_ja,
      '%%SUPPORT_MAIL%%': p.support_mail,
      '%%SITE_COPYRIGHT%%': p.site_copyright
    };
    for(const [k,v] of Object.entries(map)){ html = html.replaceAll(k, String(v ?? '')); }
    return html;
  }

  function fillProductEN(p){
    let html = tpl.en;
    const map = {
      '%%SLUG%%': p.slug,
      '%%SITE_NAME_EN%%': p.site_name_en || 'Mini Plugins for Kintone',
      '%%TITLE_EN%%': p.title_en,
      '%%SUMMARY_EN%%': p.summary_en,
      '%%PRICE_JPY%%': p.price_jpy,
      '%%PRICE_USD%%': p.price_usd,
      '%%PURCHASE_URL%%': p.purchase_url,
      '%%HERO_IMAGE%%': p.hero_image.replace(/^\.?\/*/, ''),
      '%%SUPPORTED_SCREENS_EN%%': p.supported_screens_en,
      '%%CATEGORY_EN%%': p.category_en,
      '%%FILE_SIZE_EN%%': p.file_size_en,
      '%%UPDATED_AT_EN%%': p.updated_at_en,
      '%%TAGS_EN_HTML%%': renderTags(p.tags_en),
      '%%FEATURES_EN_HTML%%': renderFeatures(p.features_en),
      '%%SCREENSHOTS_EN_HTML%%': renderScreenshots(p.screenshots_en, '../../'),
      '%%STEPS_EN_HTML%%': renderSteps(p.steps_en),
      '%%LIMITATIONS_EN_HTML%%': renderLimitations(p.limitations_en),
      '%%FAQ_EN_HTML%%': renderFAQ(p.faq_en),
      '%%RELATED_EN_HTML%%': renderRelated(p.related_en),
      '%%CTA_HEADLINE_EN%%': p.cta_headline_en,
      '%%CTA_TEXT_EN%%': p.cta_text_en,
      '%%SUPPORT_MAIL%%': p.support_mail,
      '%%SITE_COPYRIGHT%%': p.site_copyright
    };
    for(const [k,v] of Object.entries(map)){ html = html.replaceAll(k, String(v ?? '')); }
    return html;
  }

  // product pages
  for(const p of products){
    fs.writeFileSync(path.join(PRODUCTS_DIR, `${p.slug}.html`), fillProductJA(p));
    fs.writeFileSync(path.join(PRODUCTS_EN_DIR, `${p.slug}.html`), fillProductEN(p));
  }

  // index pages
  const cardsJa = products.map(p=>`
    <a class="kb-card" href="products/${p.slug}.html">
      <div class="kb-card-img"><img class="kb-hero-image" src="${esc(p.hero_image)}" alt="${esc(p.title_ja)}"></div>
      <div class="kb-card-body"><h3 class="kb-card-title">${esc(p.title_ja)}</h3></div>
    </a>`).join('\n');
  const cardsEn = products.map(p=>`
    <a class="kb-card" href="../products/en/${p.slug}.html">
      <div class="kb-card-img"><img class="kb-hero-image" src="../${esc(p.hero_image)}" alt="${esc(p.title_en)}"></div>
      <div class="kb-card-body"><h3 class="kb-card-title">${esc(p.title_en)}</h3></div>
    </a>`).join('\n');

  fs.writeFileSync(path.join(DIST, 'index.html'),
    tpl.indexJa.replace('%%PRODUCT_CARDS_JA%%', cardsJa)
  );
  fs.mkdirSync(path.join(DIST, 'en'), { recursive: true });
  fs.writeFileSync(path.join(DIST, 'en/index.html'),
    tpl.indexEn.replace('%%PRODUCT_CARDS_EN%%', cardsEn)
  );

  // static
  function copyFileIfExists(rel){
    // ▼ デバッグ＆保険：呼び出しログ
    console.log('[copyFileIfExists]', rel);
    // ▼ assets はここで扱わない（下の fs.cpSync で一括対応）
    if (rel.startsWith('assets')) {
      console.log('  skip (assets is handled separately)');
      return;
    }
    const src = path.join(ROOT, rel);
    if (!fs.existsSync(src)) return;
    const dst = path.join(DIST, rel);
    const st  = fs.lstatSync(src);                   // lstat でシンボリックも識別
    if (st.isDirectory()) {
      fs.cpSync(src, dst, { recursive: true, force: true });
      return;
    }
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
  copyFileIfExists('style.css');
  copyFileIfExists('terms.html');
  copyFileIfExists('robots.txt');
  copyFileIfExists('sitemap-base.xml');
  copyFileIfExists('404.html');

  // assets (always recursive)
  const ASSETS_SRC = path.join(ROOT, 'assets');
  const ASSETS_DST = path.join(DIST, 'assets');
  if (fs.existsSync(ASSETS_SRC)) {
    fs.cpSync(ASSETS_SRC, ASSETS_DST, { recursive: true, force: true });
  }

  // sitemap
  const basePath = path.join(DIST, 'sitemap-base.xml');
  const base = fs.existsSync(basePath)
    ? fs.readFileSync(basePath,'utf-8')
    : `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>`;
  const urls = ['/index.html','/en/index.html','/terms.html'];
  for(const p of products){
    urls.push(`/products/${p.slug}.html`, `/products/en/${p.slug}.html`);
  }
  const injected = base.replace('</urlset>',
    urls.map(u=>`<url><loc>{{BASE_URL}}${u}</loc></url>`).join('') + '</urlset>'
  );
  fs.writeFileSync(path.join(DIST, 'sitemap.xml'), injected);

  fs.writeFileSync(path.join(DIST, '.nojekyll'), '');
  console.log('Build completed.');
} catch (e) {
  console.error('BUILD FAILED:', e);
  process.exit(1);
}
