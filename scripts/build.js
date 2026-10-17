/* build.js */
console.log('BUILD.JS REV', new Date().toISOString(), process.env.GITHUB_SHA || 'local');

const fs = require('fs');
const path = require('path');
const { marked } = require('marked');
const blogLib = require('./blog-lib');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const PRODUCTS_DIR = path.join(DIST, 'products');
const PRODUCTS_EN_DIR = path.join(PRODUCTS_DIR, 'en');
const MANUALS_SRC = path.join(ROOT, 'manuals');
const BLOG_CONTENT_SRC = path.join(ROOT, 'content', 'blog');
const BLOG_DIST = path.join(DIST, 'blog');

// サイト共通定数（products.json に持たせない）
const SUPPORT_MAIL = 'support@plugbits.app';
const SITE_COPYRIGHT = `© ${new Date().getFullYear()} PlugBits. All rights reserved.`;
const SITE_ORIGIN = 'https://plugbits.app';
// ブログ記事の既定 og:image(2026-09-22 差し替え)。
// 以前は note_eyecatch_v2.png だったが、中身が PlugBits Launcher の宣伝画像で、
// og_image を指定していない記事(6本すべて)がこれに落ちていた。図面や kintone の記事を
// note に貼ると Launcher の広告がサムネイルに出ていたため、中立の1枚に替えた。
// note_eyecatch_v2.png は Launcher の宣伝物としては有効なのでファイルは残してある。
// 記事ごとの上書きは data/posts.json の og_image が効く(後から1本ずつ足せる)。
// 画像の元は tools/og/og_blog_default.html(HTML→スクショ。assets/ に置くと公開されるので tools/ 側)。
const DEFAULT_BLOG_OG_IMAGE = 'assets/blog/og_blog_default.png';
// /deals/ 以下は 2026-09-20 に dorutoku.com へ移した。旧 URL は案内ページだけ残して
// noindex にしてあるので、sitemap には載せない。
// Drawing(図面の類似検索)は2026年9月30日に提供を終了したため、案内ページのみ残し
// sitemap からは外している(/drawing/, /drawing/demo/)。
const DOCS_INDEXABLE_PAGES = ['/factory-tools/', '/launcher/'];

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

function withQuery(url, query) {
  return url + (url.includes('?') ? '&' : '?') + query;
}

function shortText(s, n = 64) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function formatDateJa(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return iso || '';
  return `${Number(m[1])}年${Number(m[2])}月${Number(m[3])}日`;
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
    blogPost:  readText(path.join(ROOT, 'templates', 'blog-post.html')),
    blogIndex: readText(path.join(ROOT, 'templates', 'blog-index.html')),
  };

  const plugins = products.filter(p => p.type === 'plugin');

  // Launcher（主力拡張機能）のストアURLを全テンプレートで共有
  const storeExt = products.find(p => p.type === 'extension' && p.store_url);
  const LAUNCHER_STORE_URL = (storeExt && storeExt.store_url) || '/launcher/';

  // クロスセルバナー用のutm付きストアURL。utm_source はページ種別（blog/product/manual等）で出し分ける
  function bannerStoreUrl(utmSource) {
    return withQuery(LAUNCHER_STORE_URL, `utm_source=${utmSource}&utm_medium=banner`);
  }

  // 価格バッジ：pricing (free / freemium / paid) で出し分け。未設定は free 扱い
  // paid (kintone プラグインの買い切り) は price_ja/price_en +「 / kintoneプラグイン」で出す。
  // 「無料」の固定札は paid/freemium では出さない。
  function priceBadge(p, isJa) {
    if (p.status === 'coming-soon') {
      return '<div class="kb-price-badge kb-price-coming">COMING SOON</div>';
    }
    const pricing = p.pricing || 'free';
    if (pricing === 'paid') {
      // カードの札は短い形(例「¥3,980 買い切り」)。税込などの詳細は商品ページ側に書く
      const price = (isJa ? p.price_short_ja : p.price_short_en) || (isJa ? p.price_ja : p.price_en) || (isJa ? '有料' : 'Paid');
      // 価格は文字だけ(塗り・枠なし): 「¥3,980」を太字、続く「買い切り/one-time」を小さく灰色で
      const sp = String(price).indexOf(' ');
      const amount = sp > 0 ? String(price).slice(0, sp) : String(price);
      const unit = sp > 0 ? String(price).slice(sp + 1) : '';
      return `<div class="kb-price-plain"><span class="kb-price-amount">${esc(amount)}</span>${unit ? ` <span class="kb-price-unit">${esc(unit)}</span>` : ''}</div>`;
    }
    if (pricing === 'freemium') {
      const fallback = isJa ? '無料+Pro' : 'Free+Pro';
      const label = (isJa ? p.price_label_ja : p.price_label_en) || fallback;
      return `<div class="kb-price-badge kb-price-paid">${esc(label)}</div>`;
    }
    return `<div class="kb-price-badge kb-price-free">${isJa ? '無料' : 'Free'}</div>`;
  }

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
      '%%MANUAL_CTA%%':       hasManual ? [
        '<div class="kb-manual-cta kb-container">',
        '  <div class="kb-manual-cta-inner">',
        `    <div class="kb-manual-cta-text"><p class="kb-manual-cta-label">${isJa ? '詳しい使い方はマニュアルで' : 'Need more details?'}</p><p class="kb-manual-cta-sub">${isJa ? 'セットアップ手順・各設定項目・よくある質問をまとめています。' : 'Setup steps, settings reference, and FAQ in one place.'}</p></div>`,
        `    <a class="kb-btn kb-btn-primary" href="${manualUrl}">${isJa ? 'マニュアルを見る →' : 'View Manual →'}</a>`,
        '  </div>',
        '</div>',
      ].join('\n') : '',
      '%%OG_IMAGE%%':         `https://plugbits.app/${((p.og_image || p.hero_image) || '').replace(/^\.?\/+/, '')}`,
      '%%OG_URL%%':           isJa
                                ? `https://plugbits.app/products/${p.slug}.html`
                                : `https://plugbits.app/products/en/${p.slug}.html`,
      '%%ALT_LANG_URL%%':     altLangUrl,
      '%%LAUNCHER_STORE_URL%%': LAUNCHER_STORE_URL,
      '%%LAUNCHER_STORE_URL_BANNER%%': bannerStoreUrl('product'),
      '%%SUPPORT_MAIL%%':     SUPPORT_MAIL,
      '%%SITE_COPYRIGHT%%':   SITE_COPYRIGHT,
    };

    let out = html;
    for (const [k, v] of Object.entries(map)) out = out.replaceAll(k, String(v ?? ''));
    return out;
  }

  /* manuals/<slug>.<lang>.md 内の画像の相対パスを、別担当が置く
     assets/manuals/<slug>/<basename> を指すように出力時に書き換える。
     md 側が images/manual/xxx.png のような旧式の相対パスで書いていても、
     すでに assets/manuals/<slug>/xxx.png を直接指していても、最後は
     basename だけを取り出して同じ場所に組み直すので、どちらでも壊れない。
     http(s): や / 始まりの絶対パス、data: はそのまま触らない。 */
  function rewriteManualImagePaths(markdown, slug, imgPrefix) {
    const isAbsolute = src => /^([a-z][a-z0-9+.-]*:|\/)/i.test(src);
    const target = basename => `${imgPrefix}assets/manuals/${slug}/${basename}`;
    let out = String(markdown || '');
    // Markdown image syntax: ![alt](src "title")
    out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)((?:\s+"[^"]*")?)\)/g, (m, alt, src, title) => {
      if (isAbsolute(src)) return m;
      const basename = src.split('/').pop();
      return `![${alt}](${target(basename)}${title})`;
    });
    // Raw <img src="..."> tags embedded in markdown
    out = out.replace(/(<img\b[^>]*\bsrc=["'])([^"']+)(["'])/gi, (m, pre, src, post) => {
      if (isAbsolute(src)) return m;
      const basename = src.split('/').pop();
      return `${pre}${target(basename)}${post}`;
    });
    return out;
  }

  /* redirect_to を持つ製品は専用LPが正のページなので、詳細ページの
     代わりにリダイレクトスタブを置く(数字・文言の二重管理を避ける)。 */
  function redirectStub(target) {
    const url = `${SITE_ORIGIN}${target}`;
    return `<!doctype html><html lang="ja"><head><meta charset="utf-8">` +
      `<meta http-equiv="refresh" content="0; url=${target}">` +
      `<link rel="canonical" href="${url}">` +
      `<meta name="robots" content="noindex">` +
      `<title>Redirecting…</title></head>` +
      `<body><p><a href="${target}">${url}</a> へ移動します。</p></body></html>`;
  }

  // プラグイン詳細ページ生成
  for (const p of plugins) {
    if (p.redirect_to) {
      // redirect_to がある製品は専用LPが正のページなので詳細ページの代わりに
      // スタブを置くが、マニュアル(ja/en)の生成はスキップせず続ける。
      fs.writeFileSync(path.join(PRODUCTS_DIR, `${p.slug}.html`),    redirectStub(p.redirect_to));
      fs.writeFileSync(path.join(PRODUCTS_EN_DIR, `${p.slug}.html`), redirectStub(p.redirect_to));
    } else {
      fs.writeFileSync(path.join(PRODUCTS_DIR, `${p.slug}.html`),    fillProduct(p, 'ja'));
      fs.writeFileSync(path.join(PRODUCTS_EN_DIR, `${p.slug}.html`), fillProduct(p, 'en'));
    }

    // マニュアルページ生成
    // 戻る導線(購入・商品ページへの導線)は、専用LPがあれば products/ のリダイレクト
    // スタブを経由させず page_url(redirect_to) へ直接送る。無ければ元の詳細ページへ。
    const backTarget = p.page_url || p.redirect_to || null;
    const manualJaPath = path.join(MANUALS_SRC, `${p.slug}.ja.md`);
    const manualEnPath = path.join(MANUALS_SRC, `${p.slug}.en.md`);

    if (fileExists(manualJaPath)) {
      const imgPrefix = '../';
      const md = rewriteManualImagePaths(readText(manualJaPath), p.slug, imgPrefix);
      const content = marked.parse(md);
      let out = tpl.manualJa
        .replaceAll('%%SLUG%%.html',      backTarget || `${p.slug}.html`)
        .replaceAll('%%TITLE%%',          esc(p.title_ja))
        .replaceAll('%%SLUG%%',           p.slug)
        .replaceAll('%%MANUAL_CONTENT%%', content)
        .replaceAll('%%LAUNCHER_STORE_URL%%', LAUNCHER_STORE_URL)
        .replaceAll('%%LAUNCHER_STORE_URL_BANNER%%', bannerStoreUrl('manual'))
        .replaceAll('%%SUPPORT_MAIL%%',   SUPPORT_MAIL)
        .replaceAll('%%SITE_COPYRIGHT%%', SITE_COPYRIGHT);
      fs.writeFileSync(path.join(PRODUCTS_DIR, `${p.slug}-manual.html`), out);
    }

    if (fileExists(manualEnPath)) {
      const imgPrefix = '../../';
      const md = rewriteManualImagePaths(readText(manualEnPath), p.slug, imgPrefix);
      const content = marked.parse(md);
      let out = tpl.manualEn
        .replaceAll('%%SLUG%%.html',      backTarget || `${p.slug}.html`)
        .replaceAll('%%TITLE%%',          esc(p.title_en))
        .replaceAll('%%SLUG%%',           p.slug)
        .replaceAll('%%MANUAL_CONTENT%%', content)
        .replaceAll('%%LAUNCHER_STORE_URL%%', LAUNCHER_STORE_URL)
        .replaceAll('%%LAUNCHER_STORE_URL_BANNER%%', bannerStoreUrl('manual'))
        .replaceAll('%%SUPPORT_MAIL%%',   SUPPORT_MAIL)
        .replaceAll('%%SITE_COPYRIGHT%%', SITE_COPYRIGHT);
      fs.writeFileSync(path.join(PRODUCTS_EN_DIR, `${p.slug}-manual.html`), out);
    }
  }

  // ブログ記事生成（data/posts.json + content/blog/*.html・*.md）
  // テーマ・製品の定義。無ければ空オブジェクトで動く(テーマ無し＝「すべて」のみ)。
  const BLOG_THEMES_PATH = path.join(ROOT, 'data', 'blog-themes.json');
  const BLOG_PRODUCTS_PATH = path.join(ROOT, 'data', 'blog-products.json');
  const BLOG_THEMES = fileExists(BLOG_THEMES_PATH) ? readJSON(BLOG_THEMES_PATH) : {};
  // 売っている kintone プラグインも product に書ける(excel-report / kintone-excel-report 等。2026-10-17)
  const BLOG_PRODUCTS = blogLib.withKintonePlugins(fileExists(BLOG_PRODUCTS_PATH) ? readJSON(BLOG_PRODUCTS_PATH) : {}, products);
  const BLOG_PAGE_SIZE = Number(process.env.BLOG_PAGE_SIZE) > 0 ? Number(process.env.BLOG_PAGE_SIZE) : 20;

  // 今日(Asia/Tokyo)。確認用に BLOG_TODAY=YYYY-MM-DD で上書きできる。日本に夏時間は無いので固定+9時間で足りる。
  function todayJST() {
    if (process.env.BLOG_TODAY) return process.env.BLOG_TODAY;
    const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
    return jst.toISOString().slice(0, 10);
  }
  const BLOG_TODAY = todayJST();

  const postsJsonPath = path.join(ROOT, 'data', 'posts.json');
  const posts = fileExists(postsJsonPath) ? readJSON(postsJsonPath) : [];
  const visibleJsonPosts = posts.filter(post => (post.status || 'public') === 'public');

  // content/blog/*.md: frontmatter(js-yaml)を読み、approved && date<=今日 のものだけ対象にする。
  // _ で始まるファイル名は確認用の試し記事として常に飛ばす。
  const blogDirEntries = fs.existsSync(BLOG_CONTENT_SRC) ? fs.readdirSync(BLOG_CONTENT_SRC) : [];
  const mdFiles = blogDirEntries.filter(name => name.endsWith('.md') && !blogLib.isSampleFile(name));
  const mdParsed = mdFiles.map(name => {
    const raw = readText(path.join(BLOG_CONTENT_SRC, name));
    const { data, body } = blogLib.parseFrontmatter(raw);
    return { file: name, data, body };
  });

  // md の slug と posts.json の slug が重なったら build を止める(md 同士の重複も検査)。
  const mdSlugs = mdParsed.map(m => m.data && m.data.slug).filter(Boolean);
  const jsonSlugs = visibleJsonPosts.map(p => p.slug);
  const slugConflicts = blogLib.findSlugConflicts(mdSlugs, jsonSlugs);
  if (slugConflicts.length > 0) {
    throw new Error(`blog slug conflict: ${slugConflicts.join(', ')}`);
  }

  const publishableMd = mdParsed.filter(m => blogLib.isPublishable(m.data, BLOG_TODAY));

  const mdPosts = publishableMd.map(({ data, body }) => {
    const rawHtml = marked.parse(blogLib.protectBareUrls(body || ''));
    // 表は .pb-table-wrap で包む(溢れた時に表だけ横スクロール。blog.css)
    const contentHtml = blogLib.figureizeImages(blogLib.stripHtmlComments(rawHtml))
      .replace(/<table>/g, '<div class="pb-table-wrap"><table>')
      .replace(/<\/table>/g, '</table></div>');
    const ogAssetExists = fileExists(path.join(ROOT, 'assets', 'blog', 'og', `${data.slug}.jpg`));
    const post = blogLib.frontmatterToPost(data, body, contentHtml, {
      ogAssetExists,
      defaultOgImage: DEFAULT_BLOG_OG_IMAGE,
    });
    // 知らない product は止めずに none 扱い。BLOG_WARN の行は自動公開(publish.py)が拾って通知する
    const resolved = blogLib.resolveProduct(post.product, BLOG_PRODUCTS);
    if (resolved.warning) console.warn(`BLOG_WARN ${post.slug}: ${resolved.warning} → none`);
    post.product = resolved.product;
    return post;
  });

  // posts.json の既存記事を同じ内部形に揃える(theme は任意。product は無い＝tool_url/tool_name で案内枠を作る)。
  const jsonPosts = visibleJsonPosts.map(post => {
    const contentPath = path.join(BLOG_CONTENT_SRC, post.content_file);
    const rawHtml = fileExists(contentPath) ? readText(contentPath) : '';
    return {
      slug: post.slug,
      title: post.title,
      h1: post.h1 || post.title,
      description: post.description,
      keywords: post.keywords,
      theme: post.theme || null,
      product: 'none',
      published_at: post.published_at,
      updated_at: post.updated_at || post.published_at,
      read_time: post.read_time,
      card_summary: post.card_summary || post.description,
      content_html: blogLib.stripHtmlComments(rawHtml),
      // md と同じ決め方: 明示の og_image → assets/blog/og/<slug>.jpg が在ればそれ → 既定画像
      og_image: blogLib.resolveOgImage(
        post.og_image,
        post.slug,
        fileExists(path.join(ROOT, 'assets', 'blog', 'og', `${post.slug}.jpg`)),
        DEFAULT_BLOG_OG_IMAGE
      ),
      hero_label: post.hero_label,
      tool_url: post.tool_url || null,
      tool_name: post.tool_name || null,
      cta_intro: post.cta_intro || null,
    };
  });

  const allBlogPosts = [...jsonPosts, ...mdPosts];

  for (const post of allBlogPosts) {
    const { html: taggedHtml, headings } = blogLib.addHeadingIds(post.content_html);
    const contentHtmlWrapped = `<div class="pb-prose">${taggedHtml}</div>`;

    const canonical = `${SITE_ORIGIN}/blog/${post.slug}/`;
    const ogImagePath = String(post.og_image || DEFAULT_BLOG_OG_IMAGE).replace(/^\.?\/+/, '');
    const ogImageTag = `<meta property="og:image" content="${SITE_ORIGIN}/${ogImagePath}">`;

    const articleObj = {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: post.title,
      description: post.description,
      datePublished: post.published_at,
      dateModified: post.updated_at || post.published_at,
      author: { '@type': 'Organization', name: 'PlugBits' },
      publisher: { '@type': 'Organization', name: 'PlugBits' },
      mainEntityOfPage: canonical,
    };
    const breadcrumbItems = [
      { name: 'ホーム', url: `${SITE_ORIGIN}/` },
      { name: 'ブログ', url: `${SITE_ORIGIN}/blog/` },
    ];
    const theme = post.theme && BLOG_THEMES[post.theme] ? BLOG_THEMES[post.theme] : null;
    if (theme) breadcrumbItems.push({ name: theme.label, url: `${SITE_ORIGIN}/blog/${theme.slug}/` });
    breadcrumbItems.push({ name: post.title, url: canonical });
    const jsonLd = blogLib.buildJsonLd(articleObj, breadcrumbItems);

    const metaLine = (post.updated_at && post.updated_at !== post.published_at)
      ? `${formatDateJa(post.published_at)}公開（${formatDateJa(post.updated_at)}更新）・ ${post.read_time}`
      : `${formatDateJa(post.published_at)}公開 ・ ${post.read_time}`;

    const related = blogLib.selectRelatedPosts(post, allBlogPosts, 3);

    const map = {
      // 既存の差し込み(そのまま残す)
      '%%TITLE%%':                 esc(post.title),
      '%%H1%%':                    esc(post.h1 || post.title),
      '%%DESCRIPTION%%':           esc(post.description),
      '%%KEYWORDS%%':              esc(post.keywords),
      '%%OG_URL%%':                canonical,
      '%%OG_IMAGE_TAG%%':          ogImageTag,
      '%%HERO_LABEL%%':            esc(post.hero_label),
      '%%READ_TIME%%':             esc(post.read_time),
      '%%PUBLISHED_AT_DISPLAY%%':  esc(formatDateJa(post.published_at)),
      '%%UPDATED_AT_DISPLAY%%':    esc(formatDateJa(post.updated_at || post.published_at)),
      '%%META_LINE%%':             esc(metaLine),
      '%%CTA_INTRO%%':             esc(post.cta_intro),
      '%%TOOL_URL%%':              post.tool_url || '',
      '%%TOOL_NAME%%':             esc(post.tool_name),
      '%%CONTENT_HTML%%':          contentHtmlWrapped,
      '%%LAUNCHER_STORE_URL%%':    LAUNCHER_STORE_URL,
      '%%LAUNCHER_STORE_URL_BANNER%%': bannerStoreUrl('blog'),
      '%%SUPPORT_MAIL%%':          SUPPORT_MAIL,
      '%%SITE_COPYRIGHT%%':        SITE_COPYRIGHT,
      '%%JSONLD%%':                jsonLd,
      // 2026-10-17 blog-seo で新規に足した差し込み
      '%%CANONICAL%%':             canonical,
      '%%BREADCRUMB_HTML%%':       blogLib.buildBreadcrumbHtml(post.theme, BLOG_THEMES),
      '%%TOC_HTML%%':              blogLib.buildToc(headings),
      '%%META_HTML%%':             blogLib.buildMetaHtml(post.published_at, post.updated_at, post.read_time),
      '%%THEME_BADGE%%':           blogLib.buildThemeBadgeHtml(post.theme, BLOG_THEMES),
      '%%PRODUCT_BOX_HTML%%':      blogLib.buildProductBoxHtml(post.product, BLOG_PRODUCTS, post.slug, {
        toolUrl: post.tool_url,
        toolName: post.tool_name,
        ctaIntro: post.cta_intro,
      }),
      '%%RELATED_HTML%%':          blogLib.buildRelatedHtml(related, BLOG_THEMES),
      '%%AUTHOR_HTML%%':           blogLib.buildAuthorHtml(),
    };

    let out = tpl.blogPost;
    for (const [k, v] of Object.entries(map)) out = out.replaceAll(k, String(v ?? ''));

    const postDir = path.join(BLOG_DIST, post.slug);
    fs.mkdirSync(postDir, { recursive: true });
    fs.writeFileSync(path.join(postDir, 'index.html'), out);
  }

  // ブログ一覧ページ生成: /blog/(すべて)・/blog/<theme.slug>/。20件ごとにページ送り。
  const BLOG_LIST_LEAD_ALL = 'kintoneの業務改善や3Dデータ活用など、現場で役立つ情報をお届けするPlugBitsのブログです。';

  function writeBlogListScope(themeKey) {
    const theme = themeKey ? BLOG_THEMES[themeKey] : null;
    const baseUrl = theme ? `/blog/${theme.slug}/` : '/blog/';
    const activeSlug = theme ? theme.slug : 'all';
    const listTitle = theme ? theme.label : 'ブログ';
    const listLead = theme ? theme.lead : BLOG_LIST_LEAD_ALL;

    const scoped = allBlogPosts
      .filter(post => (theme ? post.theme === themeKey : true))
      .slice()
      .sort((a, b) => (a.published_at < b.published_at ? 1 : -1));

    const pages = blogLib.paginate(scoped, BLOG_PAGE_SIZE);
    const totalPages = pages.length || 1;
    const pageLists = pages.length > 0 ? pages : [[]];

    pageLists.forEach((pagePosts, idx) => {
      const pageNum = idx + 1;
      const postCardsHtml = pagePosts.map(post => {
        const theme2 = post.theme && BLOG_THEMES[post.theme] ? BLOG_THEMES[post.theme] : null;
        const cardOgSrc = `/${String(post.og_image || DEFAULT_BLOG_OG_IMAGE).replace(/^\.?\/+/, '')}`;
        return [
          `<a class="pb-card" href="/blog/${post.slug}/">`,
          `  <img class="pb-card-img" src="${esc(cardOgSrc)}" alt="" loading="lazy" width="1200" height="630">`,
          `  <span class="pb-card-theme">${esc(theme2 ? theme2.label : '')}</span>`,
          `  <h3 class="pb-card-title">${esc(post.title)}</h3>`,
          `  <p class="pb-card-desc">${esc(post.card_summary || post.description)}</p>`,
          `  <time class="pb-card-date">${esc(formatDateJa(post.published_at))}</time>`,
          '</a>',
        ].join('\n');
      }).join('\n');

      const pagerHtml = blogLib.buildPagerHtml(pageNum, totalPages, baseUrl);
      const prevNextLinks = blogLib.buildPrevNextLinkTags(pageNum, totalPages, baseUrl);
      const pageCanonical = `${SITE_ORIGIN}${pageNum <= 1 ? baseUrl : `${baseUrl}page/${pageNum}/`}`;

      const html = tpl.blogIndex
        .replaceAll('%%POST_CARDS%%',       postCardsHtml)
        .replaceAll('%%LIST_TITLE%%',       esc(listTitle))
        .replaceAll('%%LIST_LEAD%%',        esc(listLead))
        .replaceAll('%%CANONICAL%%',        pageCanonical)
        .replaceAll('%%TABS_HTML%%',        blogLib.buildTabsHtml(activeSlug, BLOG_THEMES))
        .replaceAll('%%PAGER_HTML%%',       pagerHtml)
        .replaceAll('%%PREV_NEXT_LINKS%%',  prevNextLinks)
        .replaceAll('%%SUPPORT_MAIL%%',     SUPPORT_MAIL)
        .replaceAll('%%SITE_COPYRIGHT%%',   SITE_COPYRIGHT);

      const outDir = pageNum <= 1
        ? path.join(BLOG_DIST, theme ? theme.slug : '')
        : path.join(BLOG_DIST, theme ? theme.slug : '', 'page', String(pageNum));
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, 'index.html'), html);
    });
  }

  fs.mkdirSync(BLOG_DIST, { recursive: true });
  writeBlogListScope(null); // /blog/ すべて
  for (const key of Object.keys(BLOG_THEMES)) writeBlogListScope(key); // /blog/a/ /blog/b/

  // RSS(/blog/feed.xml・新しい順20件)
  fs.writeFileSync(path.join(BLOG_DIST, 'feed.xml'), blogLib.buildFeedXml(allBlogPosts, SITE_ORIGIN, 20));

  // インデックスページ用カード生成
  function buildCards(lang) {
    const isJa = lang === 'ja';
    // EN index は /en/ 配下にあるため、相対パスには ../ を付ける（絶対パス・URLはそのまま）
    const pre = isJa ? '' : '../';
    const rel = s => /^([a-z]+:)?\//i.test(s || '') ? s : pre + s;
    const visible = products.filter(p => (p.status || 'public') !== 'unlisted');
    const extensions = visible.filter(p => p.type === 'extension');
    const pluginList  = visible.filter(p => p.type === 'plugin');
    const websites    = visible.filter(p => p.type === 'website');

    const websiteHtml = websites.map(p => {
      const title   = isJa ? p.title_ja        : p.title_en;
      const summary = isJa ? p.short_summary_ja : p.short_summary_en;
      const href    = rel(p.page_url || '#');
      const label   = isJa ? '詳しく見る →' : 'Learn more →';
      const badge   = isJa ? '無料 / Webツール' : 'Free / Web Tool';
      return [
        `<a class="kb-launcher-card kb-website-card" href="${esc(href)}">`,
        '  <div class="kb-launcher-card-body">',
        `    <span class="kb-launcher-tag kb-website-tag">${badge}</span>`,
        `    <h3>${esc(title)}</h3>`,
        `    <p>${esc(summary)}</p>`,
        `    <span class="kb-btn kb-btn-primary kb-launcher-cta">${label}</span>`,
        '  </div>',
        '  <div class="kb-launcher-card-visual">',
        `    <img src="${esc(rel(p.hero_image))}" alt="${esc(title)}" class="kb-launcher-logo">`,
        '  </div>',
        '</a>',
      ].join('\n');
    }).join('\n');

    const extHtml = extensions.map(p => {
      const title   = isJa ? p.title_ja         : p.title_en;
      const summary = isJa ? p.short_summary_ja  : p.short_summary_en;
      const href    = rel(p.page_url || (isJa ? `products/${p.slug}.html` : `products/en/${p.slug}.html`));
      const label   = isJa ? '詳しく見る →' : 'Learn more →';
      const isFreemium = p.pricing === 'freemium';
      const badge   = isFreemium
        ? (isJa ? '無料 + Pro / ブラウザ拡張機能' : 'Free + Pro / Browser Extension')
        : (isJa ? '無料 / ブラウザ拡張機能' : 'Free / Browser Extension');
      const highlights = renderFeatures(isJa ? p.highlights_ja : p.highlights_en);
      const trialNote = isJa ? p.trial_note_ja : p.trial_note_en;

      // store_url か highlights があれば主力プロダクトとして大きく見せる
      if (p.store_url || highlights) {
        const storeBtn = p.store_url
          ? `<a class="kb-cta-primary" href="${esc(p.store_url)}" target="_blank" rel="noopener">${isJa ? 'Chromeに追加（無料）' : 'Add to Chrome — Free'}</a>`
          : '';
        return [
          '<div class="kb-ext-featured">',
          '  <div class="kb-ext-featured-body">',
          `    <span class="kb-launcher-tag">${badge}</span>`,
          `    <h3>${esc(title)}</h3>`,
          `    <p>${esc(summary)}</p>`,
          highlights ? `    <ul class="kb-ext-highlights">${highlights}</ul>` : '',
          '    <div class="kb-ext-cta-row">',
          `      ${storeBtn}`,
          `      <a class="kb-cta-secondary" href="${esc(href)}">${label}</a>`,
          p.pro_url ? `      <a class="kb-ext-prolink" href="${esc(p.pro_url)}">${isJa ? 'Proの機能と料金 →' : 'Pro features & pricing →'}</a>` : '',
          '    </div>',
          trialNote ? `    <p class="kb-ext-note">${esc(trialNote)}</p>` : '',
          '  </div>',
          '  <div class="kb-ext-featured-visual">',
          `    <img src="${esc(rel(p.hero_image))}" alt="${esc(title)}">`,
          '  </div>',
          '</div>',
        ].filter(Boolean).join('\n');
      }

      return [
        `<a class="kb-launcher-card" href="${esc(href)}">`,
        '  <div class="kb-launcher-card-body">',
        `    <span class="kb-launcher-tag">${badge}</span>`,
        `    <h3>${esc(title)}</h3>`,
        `    <p>${esc(summary)}</p>`,
        `    <span class="kb-btn kb-btn-primary kb-launcher-cta">${label}</span>`,
        '  </div>',
        '  <div class="kb-launcher-card-visual">',
        `    <img src="${esc(rel(p.hero_image))}" alt="${esc(title)}" class="kb-launcher-logo">`,
        '  </div>',
        '</a>',
      ].join('\n');
    }).join('\n');

    const pluginHtml = pluginList.map(p => {
      const isComing = p.status === 'coming-soon';
      // A coming-soon plugin with its own page_url (e.g. a waitlist LP) links
      // out to that page instead of showing a disabled "準備中" card — the
      // COMING SOON badge still renders via priceBadge() either way.
      const hasComingPage = isComing && !!p.page_url;
      const title    = isJa ? p.title_ja : p.title_en;
      const desc     = shortText(isJa ? (p.short_summary_ja || p.summary_ja) : (p.short_summary_en || p.summary_en), 64);
      const tags     = renderTags(isJa ? p.tags_ja : p.tags_en);
      // page_url を持つ製品（専用LPが正のページ）は、products/ のリダイレクト
      // スタブを経由させず直接そのLPへ送る。リダイレクト1ホップはSEO上も
      // 計測上も損なので、coming-soon かどうかに関わらず page_url を優先する。
      const href     = p.page_url ? rel(p.page_url)
                      : isComing ? '#'
                      : rel(isJa ? `products/${p.slug}.html` : `products/en/${p.slug}.html`);
      const badge    = priceBadge(p, isJa);
      const btnLabel = hasComingPage ? (isJa ? '先行案内 →' : 'Waitlist →')
                      : isComing ? (isJa ? '準備中' : 'Coming Soon')
                      : (isJa ? '詳細' : 'Details');
      const cardClass = 'kb-card' + (isComing && !hasComingPage ? ' kb-card--coming' : '');
      return [
        `<a class="${cardClass}" href="${esc(href)}">`,
        '  <div class="kb-card-img">',
        `    <img class="kb-hero-image" src="${esc(rel(p.hero_image))}" alt="${esc(title)}" loading="lazy">`,
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

    return { extHtml, pluginHtml, websiteHtml };
  }

  const { extHtml: extJa, pluginHtml: pluginsJa, websiteHtml: websitesJa } = buildCards('ja');
  const { extHtml: extEn, pluginHtml: pluginsEn, websiteHtml: websitesEn } = buildCards('en');

  fs.writeFileSync(path.join(DIST, 'index.html'),
    tpl.indexJa
      .replaceAll('%%EXTENSION_CARDS%%', extJa)
      .replaceAll('%%PRODUCT_CARDS%%',   pluginsJa)
      .replaceAll('%%WEBSITE_CARDS%%',   websitesJa)
      .replaceAll('%%LAUNCHER_STORE_URL%%', LAUNCHER_STORE_URL)
      .replaceAll('%%SUPPORT_MAIL%%',    SUPPORT_MAIL)
      .replaceAll('%%SITE_COPYRIGHT%%',  SITE_COPYRIGHT)
  );

  fs.mkdirSync(path.join(DIST, 'en'), {recursive: true});
  fs.writeFileSync(path.join(DIST, 'en', 'index.html'),
    tpl.indexEn
      .replaceAll('%%EXTENSION_CARDS%%', extEn)
      .replaceAll('%%PRODUCT_CARDS%%',   pluginsEn)
      .replaceAll('%%WEBSITE_CARDS%%',   websitesEn)
      .replaceAll('%%LAUNCHER_STORE_URL%%', LAUNCHER_STORE_URL)
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

  // 計測用の go スタブ(launcher・gep・売っている kintone プラグイン)。
  // docs/ 側に投稿slug専用のスタブが手で置かれていれば(=既存の go 入口)それを優先し、
  // 無ければ docs/launcher/go/x/index.html と同じ作りの noindex スタブを自動で作る。
  // gep(Launcher Pro)は /pro/go/<slug>/、kintone プラグインは /kintone/go/<slug>/。
  // mfg(製造のプラグイン)は発売前なので定義しない=知らない値と同じく枠なし+BLOG_WARN(2026-10-17)。
  // 発売して店に置かれたら products.json の slug でそのまま受ける
  function goStubPaths(hrefPattern, slug) {
    const rel = hrefPattern.replace('{slug}', slug).replace(/^\/+|\/+$/g, '');
    return {
      docsPath: path.join(ROOT, 'docs', rel, 'index.html'),
      distPath: path.join(DIST, rel, 'index.html'),
    };
  }
  let goStubsCreated = 0;
  for (const post of allBlogPosts) {
    const prodDef = post.product && post.product !== 'none' ? BLOG_PRODUCTS[post.product] : null;
    if (!prodDef) continue;
    const { docsPath, distPath } = goStubPaths(prodDef.href, post.slug);
    if (fileExists(docsPath)) continue; // 手で置かれた専用スタブはそのまま(docs マージ済み)
    const canonicalUrl = `${SITE_ORIGIN}${prodDef.stub_canonical}`;
    const redirectUrl = prodDef.stub_target.replace('{slug}', encodeURIComponent(post.slug));
    const html = blogLib.buildGoStub({
      canonicalUrl,
      redirectUrl,
      pageTitle: prodDef.stub_title,
      ogDescription: prodDef.stub_description,
    });
    fs.mkdirSync(path.dirname(distPath), { recursive: true });
    fs.writeFileSync(distPath, html);
    goStubsCreated++;
  }
  console.log(`blog go stubs created: ${goStubsCreated}`);

  // sitemap 生成
  const basePath = path.join(DIST, 'sitemap-base.xml');
  const base = fileExists(basePath)
    ? readText(basePath)
    : '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>';
  const urls = ['/index.html', '/en/index.html', '/terms.html', '/install2.html'];
  for (const p of plugins) {
    if (p.redirect_to) continue; // リダイレクトスタブは sitemap に載せない
    urls.push(`/products/${p.slug}.html`);
    urls.push(`/products/en/${p.slug}.html`);
    if (fileExists(path.join(MANUALS_SRC, `${p.slug}.ja.md`))) urls.push(`/products/${p.slug}-manual.html`);
    if (fileExists(path.join(MANUALS_SRC, `${p.slug}.en.md`))) urls.push(`/products/en/${p.slug}-manual.html`);
  }
  // docs/ にそのまま置いている独立LP。products.json 由来ではないので
  // 明示的に列挙する（/drawing/setup.html のような申込後ページは載せない）。
  urls.push(...DOCS_INDEXABLE_PAGES);
  urls.push('/blog/');
  for (const key of Object.keys(BLOG_THEMES)) urls.push(`/blog/${BLOG_THEMES[key].slug}/`);
  for (const post of allBlogPosts) urls.push(`/blog/${post.slug}/`); // 一覧のページ送りは入れない
  const xml = base.replace('</urlset>',
    urls.map(u => `<url><loc>${SITE_ORIGIN}${u}</loc></url>`).join('') + '</urlset>'
  );
  fs.writeFileSync(path.join(DIST, 'sitemap.xml'), xml);

  // ファビコン: テンプレート・docs/・404 など出どころが散っているので、
  // 書き出し後の dist/ の全 HTML の </head> の前に一括で入れる(自前で icon を持つページは触らない)
  const FAVICON_TAGS =
    '<link rel="icon" href="/favicon.ico" sizes="any">' +
    '<link rel="icon" href="/favicon-32.png" type="image/png" sizes="32x32">' +
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png">' +
    '<link rel="manifest" href="/site.webmanifest">';
  let faviconPages = 0;
  (function walk(dir) {
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(p); continue; }
      if (!entry.name.endsWith('.html')) continue;
      const html = readText(p);
      if (/rel=["']?(?:shortcut )?icon["'\s>]/i.test(html)) continue;
      const heads = html.match(/<\/head>/gi);
      if (!heads || heads.length !== 1) continue;
      fs.writeFileSync(p, html.replace(/<\/head>/i, FAVICON_TAGS + '</head>'));
      faviconPages++;
    }
  })(DIST);
  console.log(`favicon tags: ${faviconPages} page(s)`);

  fs.writeFileSync(path.join(DIST, '.nojekyll'), '');
  console.log(`Build completed. ${plugins.length} plugin(s), ${products.filter(p=>p.type==='extension').length} extension(s).`);
} catch (e) {
  console.error('BUILD FAILED:', e);
  process.exit(1);
}
