/* build.js — stable version */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const PRODUCTS_DIR = path.join(DIST, 'products');
const PRODUCTS_EN_DIR = path.join(PRODUCTS_DIR, 'en');

function esc(s){ return String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&gt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

function ensureDirs() {
  // まっさらに
  fs.rmSync(DIST, { recursive: true, force: true });
  // 明示的に全階層を作る
  fs.mkdirSync(DIST, { recursive: true });
  fs.mkdirSync(PRODUCTS_DIR, { recursive: true });
  fs.mkdirSync(PRODUCTS_EN_DIR, { recursive: true });
}

function readJSON(p){ return JSON.parse(fs.readFileSync(p, 'utf-8')); }
function readText(p){ return fs.readFileSync(p, 'utf-8'); }

function renderTags(csv){
  return (csv||'').split(',').map(s=>s.trim()).filter(Boolean)
    .map(t=>`<span class="kb-tag">${esc(t)}</span>`).join('');
}
function renderFeatures(semicolon){
  return (semicolon||'').split(';').map(s=>s.trim()).filter(Boolean)
    .map(x=>`<li>${esc(x)}</li>`).join('');
}
function renderScreenshots(semicolon, prefix=''){
  return (semicolon||'').split(';').map(s=>s.trim()).filter(Boolean)
    .map(pair=>{
      const [url, alt] = pair.split('|').map(x=>x.trim());
      const src = prefix ? (prefix + url) : url;
      return `<img src="${esc(src)}" alt="${esc(alt||'')}" loading="lazy">`;
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
    return `<a class="kb-related-card" href="${esc(href)}"><div class="kb-related-title">${esc(title||'')}</div><div class="kb-related-price" data-price-jpy="${esc(priceJPY||'')}" data-price-usd="">¥${esc(priceJPY||'')}</div></a>`;
  }).join('');
}

// === build start ===
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

  // 一覧カード（あなたの版）
  function cardJA(p){
    const tags = String(p.tags_ja||'').split(',').map(s=>s.trim()).filter(Boolean)
      .slice(0,3).map(t=>`<span class="kb-badge">${esc(t)}</span>`).join('');
    return `
    <a class="kb-card" href="products/${p.slug}.html">
      <div class="kb-card-img">
        <img class="kb-hero-image" src="${esc(p.hero_image)}" alt="${esc(p.title_ja)}" loading="lazy">
      </div>
      <div class="kb-card-body">
        <h3 class="kb-card-title">${esc(p.title_ja)}</h3>
        <div class="kb-card-sub">${esc(p.category_ja)}・${esc(p.supported_screens_ja)}</div>
        <div class="kb-badges">${tags}</div>
        <div class="kb-card-foot">
          <div class="kb-price-badge" data-price-jpy="${esc(p.price_jpy)}" data-price-usd="${esc(p.price_usd)}">¥${esc(p.price_jpy)}</div>
          <span class="kb-btn ghost">詳細</span>
        </div>
      </div>
    </a>`;
  }
  function cardEN(p){
    const tags = String(p.tags_en||'').split(',').map(s=>s.trim()).filter(Boolean)
      .slice(0,3).map(t=>`<span class="kb-badge">${esc(t)}</span>`).join('');
    return `
    <a class="kb-card" href="products/en/${p.slug}.html">
      <div class="kb-card-img">
        <img class="kb-hero-image" src="../${esc(p.hero_image)}" alt="${esc(p.title_en)}" loading="lazy">
      </div>
      <div class="kb-card-body">
        <h3 class="kb-card-title">${esc(p.title_en)}</h3>
        <div class="kb-card-sub">${esc(p.category_en)} · ${esc(p.supported_screens_en)}</div>
        <div class="kb-badges">${tags}</div>
        <div class="kb-card-foot">
          <div class="kb-price-badge" data-price-jpy="${esc(p.price_jpy)}" data-price-usd="${esc(p.price_usd)}">¥${esc(p.price_jpy)}</div>
          <span class="kb-btn ghost">Details</span>
        </div>
      </div>
    </a>`;
  }

  // --- build products ---
  for(const p of products){
    const jaOut = fillProductJA(p);
    const enOut = fillProductEN(p);
    fs.writeFileSync(path.join(PRODUCTS_DIR, `${p.slug}.html`), jaOut);
    fs.writeFileSync(path.join(PRODUCTS_EN_DIR, `${p.slug}.html`), enOut);
  }

  // --- build indexes ---
  const cardsJa = products.map(cardJA).join('\n');
  const cardsEn = products.map(cardEN).join('\n');

  let indexJa = tpl.indexJa
    .replaceAll('%%PRODUCT_CARDS_JA%%', cardsJa)
    .replaceAll('%%SUPPORT_MAIL%%', esc(products[0]?.support_mail || 'support@example.com'))
    .replaceAll('%%SITE_COPYRIGHT%%', esc(products[0]?.site_copyright || ''))
    .replaceAll('%%SITE_NAME_JA%%', esc(products[0]?.site_name_ja || 'Kintone向けミニプラグイン'));

  let indexEn = tpl.indexEn
    .replaceAll('%%PRODUCT_CARDS_EN%%', cardsEn)
    .replaceAll('%%SUPPORT_MAIL%%', esc(products[0]?.support_mail || 'support@example.com'))
    .replaceAll('%%SITE_COPYRIGHT%%', esc(products[0]?.site_copyright || ''))
    .replaceAll('%%SITE_NAME_EN%%', esc(products[0]?.site_name_en || 'Mini Plugins for Kintone'));

  fs.writeFileSync(path.join(DIST, 'index.html'), indexJa);
  fs.mkdirSync(path.join(DIST, 'en'), { recursive: true });
  fs.writeFileSync(path.join(DIST, 'en', 'index.html'), indexEn);

  // --- copy static ---
  function copyFileIfExists(rel){
    const src = path.join(ROOT, rel);
    if (fs.existsSync(src)) {
      const dst = path.join(DIST, rel);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
    }
  }
  copyFileIfExists('style.css');
  // assets 下は全部コピー
  const ASSETS_SRC = path.join(ROOT, 'assets');
  if (fs.existsSync(ASSETS_SRC)){
    for (const f of fs.readdirSync(ASSETS_SRC)){
      copyFileIfExists(path.join('assets', f));
    }
  }
  ['terms.html','robots.txt','sitemap-base.xml','404.html'].forEach(copyFileIfExists);

  // --- sitemap ---
  const basePath = path.join(DIST, 'sitemap-base.xml');
  const base = fs.existsSync(basePath)
    ? fs.readFileSync(basePath,'utf-8')
    : `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>`;
  const urls = ['/index.html','/en/index.html','/terms.html'];
  for(const p of products){
    urls.push(`/products/${p.slug}.html`, `/products/en/${p.slug}.html`);
  }
  const injected = base.replace('</urlset>', urls.map(u=>`<url><loc>{{BASE_URL}}${u}</loc></url>`).join('') + '</urlset>');
  fs.writeFileSync(path.join(DIST, 'sitemap.xml'), injected);

  // --- .nojekyll ---
  fs.writeFileSync(path.join(DIST, '.nojekyll'), '');

  // --- Finish & log ---
  function list(dir, prefix='.') {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const rel = path.relative(DIST, full);
      if (fs.statSync(full).isDirectory()) list(full, prefix);
      else console.log('ARTIFACT:', './' + rel.replace(/\\/g,'/'));
    }
  }
  console.log('Build completed.');
  list(DIST);
} catch (e) {
  console.error('BUILD FAILED:', e);
  process.exit(1); // ← 失敗時は必ず Actions を失敗にする
}
