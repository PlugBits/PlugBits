/* build.js — clean stable */
console.log('BUILD.JS REV', new Date().toISOString(), process.env.GITHUB_SHA || 'local');

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const PRODUCTS_DIR = path.join(DIST, 'products');
const PRODUCTS_EN_DIR = path.join(PRODUCTS_DIR, 'en');

const ENABLE_EN = false;
const ENABLE_USD = false;

function esc(s){return String(s ?? '').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
function ensureDirs(){
  fs.rmSync(DIST,{recursive:true,force:true});
  fs.mkdirSync(PRODUCTS_DIR,{recursive:true});
  if(ENABLE_EN) fs.mkdirSync(PRODUCTS_EN_DIR,{recursive:true});
}
function readJSON(p){ return JSON.parse(fs.readFileSync(p,'utf-8')); }
function readText(p){ return fs.readFileSync(p,'utf-8'); }

function renderTags(csv){ return (csv||'').split(',').map(s=>s.trim()).filter(Boolean).map(t=>`<span class="kb-tag">${esc(t)}</span>`).join(''); }
function renderFeatures(semicolon){ return (semicolon||'').split(';').map(s=>s.trim()).filter(Boolean).map(x=>`<li>${esc(x)}</li>`).join(''); }
function renderSteps(lines){ const arr=Array.isArray(lines)?lines:[]; return arr.map(line=>{const [n,h,b]=String(line).split('|');return `<div class="kb-step"><div class="kb-step-number">${esc(n||'')}</div><div><h3>${esc(h||'')}</h3><p>${esc(b||'')}</p></div></div>`;}).join(''); }
function renderLimitations(semicolon){ return (semicolon||'').split(';').map(s=>s.trim()).filter(Boolean).map(x=>`<li>${esc(x)}</li>`).join(''); }
function renderFAQ(lines){ const arr=Array.isArray(lines)?lines.slice(0,3):[]; return arr.map(line=>{const [q,a]=String(line).split('|');return `<div class="kb-faq-item"><h3>${esc(q||'')}</h3><p>${esc(a||'')}</p></div>`;}).join(''); }
function renderRelated(lines){
  const arr=Array.isArray(lines)?lines.slice(0,2):[];
  return arr.map(line=>{
    const [href,title,priceJPY]=String(line).split('|');
    return `<a class="kb-related-card" href="${esc(href)}"><div class="kb-related-title">${esc(title||'')}</div><div class="kb-related-price" data-price-jpy="${esc(priceJPY||'')}">¥${esc(priceJPY||'')}</div></a>`;
  }).join('');
}

function firstFilled(){
  for(const arg of arguments){
    if(arg) return arg;
  }
  return '';
}

/* Screenshots: "path|caption" (img), "path|video|caption" (mp4) */
function renderScreenshots(list, prefix=''){
  const arr = Array.isArray(list) ? list : (list||'').split(';');
  return arr.map(item=>{
    const parts=String(item).split('|').map(s=>s.trim());
    const srcRel=parts[0]||''; const kind=(parts[1]||'').toLowerCase();
    const cap=(kind==='video')?(parts[2]||''):(parts[1]||'');
    const src = prefix ? (prefix+srcRel) : srcRel;
    if(kind==='video'){
      const poster=src.replace(/\.mp4$/i,'.png');
      return `<figure class="kb-shot"><div class="kb-shot-media"><button class="kb-video-play" aria-label="Play"><svg viewBox="0 0 64 64" width="56" height="56"><circle cx="32" cy="32" r="30" fill="rgba(0,0,0,.55)"></circle><polygon points="26,20 26,44 46,32" fill="#fff"></polygon></svg></button><video class="kb-video-el" preload="metadata" playsinline webkit-playsinline poster="${poster}"><source src="${src}" type="video/mp4"></video></div><figcaption>${esc(cap)}</figcaption></figure>`;
    }
    return `<figure class="kb-shot"><div class="kb-shot-media"><img src="${esc(src)}" alt="${esc(cap||'')}" loading="lazy"></div><figcaption>${esc(cap||'')}</figcaption></figure>`;
  }).join('');
}

try{
  ensureDirs();

  const products=readJSON(path.join(ROOT,'data','products.json'));
  const tpl={
    ja:readText(path.join(ROOT,'templates','product-ja.html')),
    indexJa:readText(path.join(ROOT,'templates','index-ja.html')),
  };
  if(ENABLE_EN){
    tpl.en=readText(path.join(ROOT,'templates','product-en.html'));
    tpl.indexEn=readText(path.join(ROOT,'templates','index-en.html'));
  }

  function fillJA(p){
    let html=tpl.ja;
    const buyUrlJpy = firstFilled(p.purchase_url_ja_jpy, p.purchase_url_ja, p.purchase_url_jpy, p.purchase_url);
    const buyUrlUsd = ENABLE_USD
      ? firstFilled(p.purchase_url_ja_usd, p.purchase_url_ja, p.purchase_url_usd, p.purchase_url, buyUrlJpy)
      : buyUrlJpy;
    const map={
      '%%SLUG%%':p.slug,'%%SITE_NAME_JA%%':p.site_name_ja||'Puchi Add-on Plugins',
      '%%TITLE_JA%%':p.title_ja,'%%SUMMARY_JA%%':p.summary_ja,
      '%%PRICE_JPY%%':p.price_jpy,'%%PRICE_USD%%':ENABLE_USD ? p.price_usd : '',
      '%%PURCHASE_URL%%':buyUrlJpy,
      '%%PURCHASE_URL_JPY%%':buyUrlJpy,
      '%%PURCHASE_URL_USD%%':buyUrlUsd,
      '%%HERO_IMAGE%%':p.hero_image.replace(/^\.?\/*/,''),
      '%%SUPPORTED_SCREENS_JA%%':p.supported_screens_ja,'%%CATEGORY_JA%%':p.category_ja,
      '%%FILE_SIZE_JA%%':p.file_size_ja,'%%UPDATED_AT_JA%%':p.updated_at_ja,
      '%%TAGS_JA_HTML%%':renderTags(p.tags_ja),'%%FEATURES_JA_HTML%%':renderFeatures(p.features_ja),
      '%%SCREENSHOTS_JA_HTML%%':renderScreenshots(p.screenshots_ja,'../'),
      '%%STEPS_JA_HTML%%':renderSteps(p.steps_ja),'%%LIMITATIONS_JA_HTML%%':renderLimitations(p.limitations_ja),
      '%%FAQ_JA_HTML%%':renderFAQ(p.faq_ja),'%%RELATED_JA_HTML%%':renderRelated(p.related_ja),
      '%%CTA_HEADLINE_JA%%':p.cta_headline_ja,'%%CTA_TEXT_JA%%':p.cta_text_ja,
      '%%SUPPORT_MAIL%%':p.support_mail,'%%SITE_COPYRIGHT%%':p.site_copyright
    };
    for(const [k,v] of Object.entries(map)) html=html.replaceAll(k,String(v??''));
    return html;
  }
  let fillEN;
  if(ENABLE_EN){
    fillEN = function(p){
      let html=tpl.en;
      const buyUrlUsd = ENABLE_USD
        ? firstFilled(p.purchase_url_en_usd, p.purchase_url_en, p.purchase_url_usd, p.purchase_url)
        : firstFilled(p.purchase_url_en, p.purchase_url, p.purchase_url_jpy, p.purchase_url_ja);
      const buyUrlJpy = firstFilled(p.purchase_url_en_jpy, p.purchase_url_en, p.purchase_url_jpy, p.purchase_url, buyUrlUsd);
      const map={
        '%%SLUG%%':p.slug,'%%SITE_NAME_EN%%':p.site_name_en||'Puchi Add-on Plugins',
        '%%TITLE_EN%%':p.title_en,'%%SUMMARY_EN%%':p.summary_en,
        '%%PRICE_JPY%%':p.price_jpy,'%%PRICE_USD%%':ENABLE_USD ? p.price_usd : '',
        '%%PURCHASE_URL%%':buyUrlUsd,
        '%%PURCHASE_URL_JPY%%':buyUrlJpy,
        '%%PURCHASE_URL_USD%%':buyUrlUsd,
        '%%HERO_IMAGE%%':p.hero_image.replace(/^\.?\/*/,''),
        '%%SUPPORTED_SCREENS_EN%%':p.supported_screens_en,'%%CATEGORY_EN%%':p.category_en,
        '%%FILE_SIZE_EN%%':p.file_size_en,'%%UPDATED_AT_EN%%':p.updated_at_en,
        '%%TAGS_EN_HTML%%':renderTags(p.tags_en),'%%FEATURES_EN_HTML%%':renderFeatures(p.features_en),
        '%%SCREENSHOTS_EN_HTML%%':renderScreenshots(p.screenshots_en,'../../'),
        '%%STEPS_EN_HTML%%':renderSteps(p.steps_en),'%%LIMITATIONS_EN_HTML%%':renderLimitations(p.limitations_en),
        '%%FAQ_EN_HTML%%':renderFAQ(p.faq_en),'%%RELATED_EN_HTML%%':renderRelated(p.related_en),
        '%%CTA_HEADLINE_EN%%':p.cta_headline_en,'%%CTA_TEXT_EN%%':p.cta_text_en,
        '%%SUPPORT_MAIL%%':p.support_mail,'%%SITE_COPYRIGHT%%':p.site_copyright
      };
      for(const [k,v] of Object.entries(map)) html=html.replaceAll(k,String(v??''));
      return html;
    };
  }

  // product pages
  for(const p of products){
    fs.writeFileSync(path.join(PRODUCTS_DIR,`${p.slug}.html`),fillJA(p));
    if(ENABLE_EN && fillEN){
      fs.writeFileSync(path.join(PRODUCTS_EN_DIR,`${p.slug}.html`),fillEN(p));
    }
  }

  // index pages (カード簡易版)
  const cardsJa=products.map(p=>`
    <a class="kb-card" href="products/${p.slug}.html">
      <div class="kb-card-img"><img class="kb-hero-image" src="${esc(p.hero_image)}" alt="${esc(p.title_ja)}" loading="lazy"></div>
      <div class="kb-card-body">
        <h3 class="kb-card-title">${esc(p.title_ja)}</h3>
        <div class="kb-card-foot"><div class="kb-price-badge" data-price-jpy="${esc(p.price_jpy)}">¥${esc(p.price_jpy)}</div><span class="kb-btn">詳細</span></div>
      </div>
    </a>`).join('\n');

  let cardsEn='';
  if(ENABLE_EN){
    cardsEn=products.map(p=>`
      <a class="kb-card" href="../products/en/${p.slug}.html">
        <div class="kb-card-img"><img class="kb-hero-image" src="../${esc(p.hero_image)}" alt="${esc(p.title_en)}" loading="lazy"></div>
        <div class="kb-card-body">
          <h3 class="kb-card-title">${esc(p.title_en)}</h3>
          <div class="kb-card-foot"><div class="kb-price-badge" data-price-jpy="${esc(p.price_jpy)}"${ENABLE_USD?` data-price-usd="${esc(p.price_usd)}"`:''}>${ENABLE_USD?`$${esc(p.price_usd)}`:`¥${esc(p.price_jpy)}`}</div><span class="kb-btn">Details</span></div>
        </div>
      </a>`).join('\n');
  }

  if(ENABLE_EN) fs.mkdirSync(path.join(DIST,'en'),{recursive:true});
  fs.writeFileSync(path.join(DIST,'index.html'),
    tpl.indexJa
      .replaceAll('%%PRODUCT_CARDS_JA%%',cardsJa)
      .replaceAll('%%SUPPORT_MAIL%%',esc(products[0]?.support_mail||'c.otkyaaa@gmail.com'))
      .replaceAll('%%SITE_COPYRIGHT%%',esc(products[0]?.site_copyright||''))
      .replaceAll('%%SITE_NAME_JA%%',esc(products[0]?.site_name_ja||'Puchi Add-on Plugins'))
  );
  if(ENABLE_EN){
    fs.writeFileSync(path.join(DIST,'en','index.html'),
      tpl.indexEn
        .replaceAll('%%PRODUCT_CARDS_EN%%',cardsEn)
        .replaceAll('%%SUPPORT_MAIL%%',esc(products[0]?.support_mail||'c.otkyaaa@gmail.com'))
        .replaceAll('%%SITE_COPYRIGHT%%',esc(products[0]?.site_copyright||''))
        .replaceAll('%%SITE_NAME_EN%%',esc(products[0]?.site_name_en||'Puchi Add-on Plugins'))
    );
  }

  // static files
  const copy = rel=>{
    const src=path.join(ROOT,rel); if(!fs.existsSync(src)) return;
    const dst=path.join(DIST,rel); const st=fs.lstatSync(src);
    if(st.isDirectory()){ fs.cpSync(src,dst,{recursive:true,force:true}); }
    else { fs.mkdirSync(path.dirname(dst),{recursive:true}); fs.copyFileSync(src,dst); }
  };
  // assets は丸ごと
  copy('assets');
  // 単体ファイル
  ['style.css','terms.html','install.html','robots.txt','sitemap-base.xml','404.html'].forEach(copy);

  // sitemap
  const basePath=path.join(DIST,'sitemap-base.xml');
  const base=fs.existsSync(basePath)?fs.readFileSync(basePath,'utf-8'):'<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>';
  const urls=['/index.html'];
  if(ENABLE_EN) urls.push('/en/index.html');
  urls.push('/terms.html');
  urls.push('/install.html');
  for(const p of products){
    urls.push(`/products/${p.slug}.html`);
    if(ENABLE_EN) urls.push(`/products/en/${p.slug}.html`);
  }
  const xml=base.replace('</urlset>',urls.map(u=>`<url><loc>{{BASE_URL}}${u}</loc></url>`).join('')+'</urlset>');
  fs.writeFileSync(path.join(DIST,'sitemap.xml'),xml);

  fs.writeFileSync(path.join(DIST,'.nojekyll'),'');
  console.log('Build completed.');
}catch(e){
  console.error('BUILD FAILED:',e);
  process.exit(1);
}
