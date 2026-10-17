/* blog-lib.js
 * ブログの純関数集(入出力はすべて引数と戻り値。fs/process に触らない)。
 * build.js から呼ばれる。テストは test/blog-lib.test.mjs(node:assert)。
 */
const yaml = require('js-yaml');

const SITE_ORIGIN = 'https://plugbits.app';

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

function formatDateJa(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return iso || '';
  return `${Number(m[1])}年${Number(m[2])}月${Number(m[3])}日`;
}

/* js-yaml は "date: 2026-10-01" のような引用なしの日付を Date オブジェクトに変換してしまう。
   frontmatter の date/updated はそのまま文字列比較で使うので、YYYY-MM-DD の文字列に戻す。 */
function normalizeFrontmatterDates(data) {
  const out = { ...data };
  for (const key of Object.keys(out)) {
    if (out[key] instanceof Date) {
      const d = out[key];
      const y = d.getUTCFullYear();
      const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
      const da = String(d.getUTCDate()).padStart(2, '0');
      out[key] = `${y}-${mo}-${da}`;
    }
  }
  return out;
}

/* frontmatter: "---\nkey: val\n---\n本文" を {data, body} に分ける。
   frontmatter が無い/壊れている場合は data={} body=raw 全体。 */
function parseFrontmatter(raw) {
  const text = String(raw ?? '');
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) return { data: {}, body: text };
  let data;
  try {
    data = normalizeFrontmatterDates(yaml.load(m[1]) || {});
  } catch (e) {
    data = {};
  }
  return { data, body: m[2] };
}

/* HTML コメント <!-- ... --> を出力から消す(出どころのメモ等が漏れないように)。 */
function stripHtmlComments(html) {
  return String(html ?? '').replace(/<!--[\s\S]*?-->/g, '');
}

/* 本文の文字数(空白除去前の生テキスト)から読了時間を出す。
   N = ceil(文字数 / 500)、最低1分。ラベルは「N分で読めます」。 */
function computeReadTime(bodyText) {
  const chars = String(bodyText ?? '').replace(/\s+/g, '').length;
  const minutes = Math.max(1, Math.ceil(chars / 500));
  return { minutes, label: `${minutes}分で読めます` };
}

/* 公開条件: approved === true かつ date <= today(文字列比較。YYYY-MM-DD前提なので可)。 */
function isPublishable(frontmatter, todayStr) {
  if (!frontmatter || frontmatter.approved !== true) return false;
  const date = String(frontmatter.date || '');
  if (!/^\d{4}-\d{2}-\d{2}/.test(date)) return false;
  return date <= String(todayStr || '');
}

/* _ で始まる md ファイル名は常に飛ばす(確認用の試し記事)。 */
function isSampleFile(filename) {
  return /^_/.test(String(filename || ''));
}

/* md の slug と posts.json の slug が重なっていないか調べる。重複の配列を返す(空なら衝突なし)。 */
function findSlugConflicts(mdSlugs, jsonSlugs) {
  const jsonSet = new Set(jsonSlugs || []);
  const seen = new Set();
  const conflicts = new Set();
  for (const s of (mdSlugs || [])) {
    if (jsonSet.has(s)) conflicts.add(s);
    if (seen.has(s)) conflicts.add(s);
    seen.add(s);
  }
  return Array.from(conflicts);
}

/* 本文 HTML の H2 に id="h-1"・"h-2"… を順に付け、見出し一覧も返す。
   既存の id 属性があれば上書きする(記事ごとに連番を振り直すため)。 */
function addHeadingIds(html) {
  let i = 0;
  const headings = [];
  const out = String(html ?? '').replace(/<h2\b([^>]*)>([\s\S]*?)<\/h2>/gi, (m, attrs, inner) => {
    i += 1;
    const id = `h-${i}`;
    const text = inner.replace(/<[^>]+>/g, '').trim();
    headings.push({ id, text });
    const cleanedAttrs = String(attrs || '').replace(/\s*id\s*=\s*"(?:[^"]*)"/i, '').replace(/\s*id\s*=\s*'(?:[^']*)'/i, '');
    return `<h2${cleanedAttrs} id="${id}">${inner}</h2>`;
  });
  return { html: out, headings };
}

/* H2 が2つ以上の時だけ目次を返す。無ければ ''。 */
function buildToc(headings) {
  const arr = Array.isArray(headings) ? headings : [];
  // 本文に手書きの「目次」の見出しがある記事(既存の HTML 記事)には自動の目次を出さない(二重になるため)
  if (arr.some(h => String(h.text).trim() === '目次')) return '';
  if (arr.length < 2) return '';
  const items = arr.map(h => `<li><a href="#${esc(h.id)}">${esc(h.text)}</a></li>`).join('');
  return `<nav class="pb-toc" aria-label="目次"><p class="pb-toc-title">目次</p><ol>${items}</ol></nav>`;
}

/* パンくず。theme があればテーマの行を足す。themesData は data/blog-themes.json の内容。 */
function buildBreadcrumbHtml(theme, themesData) {
  const base = '<a href="/">ホーム</a><span>›</span><a href="/blog/">ブログ</a>';
  const t = theme && themesData ? themesData[theme] : null;
  const themePart = t ? `<span>›</span><a href="/blog/${esc(t.slug)}/">${esc(t.label)}</a>` : '';
  return `<nav class="pb-crumbs" aria-label="パンくず">${base}${themePart}</nav>`;
}

/* 記事メタ(公開日[・更新日]・読了時間)。 */
function buildMetaHtml(publishedAt, updatedAt, readTimeLabel) {
  const pub = `<time datetime="${esc(publishedAt)}">${esc(formatDateJa(publishedAt))}</time>`;
  const hasUpdate = updatedAt && updatedAt !== publishedAt;
  const upd = hasUpdate ? `・<time datetime="${esc(updatedAt)}">${esc(formatDateJa(updatedAt))}</time>更新` : '';
  return `<p class="pb-post-meta">${pub}公開${upd}・${esc(readTimeLabel)}</p>`;
}

/* テーマバッジ。テーマが無ければ ''。 */
function buildThemeBadgeHtml(theme, themesData) {
  const t = theme && themesData ? themesData[theme] : null;
  if (!t) return '';
  return `<a class="pb-theme-badge" href="/blog/${esc(t.slug)}/">${esc(t.label)}</a>`;
}

/* 製品案内の1枠。product(md の product キー、data/blog-products.json 参照)が優先。
   無ければ既存記事の tool_url/tool_name/cta_intro にフォールバック。どちらも無ければ ''。
   productsData の href は "{slug}" を post の slug に置き換える。 */
function buildProductBoxHtml(product, productsData, slug, legacy) {
  const entry = product && product !== 'none' && productsData ? productsData[product] : null;
  if (entry) {
    const href = String(entry.href || '').replace('{slug}', encodeURIComponent(slug || ''));
    return `<aside class="pb-product-box"><p class="pb-product-label">この記事で触れた道具</p><p class="pb-product-name">${esc(entry.name)}</p><p class="pb-product-line">${esc(entry.line)}</p><a class="pb-product-link" href="${esc(href)}">詳しく見る</a></aside>`;
  }
  const lg = legacy || {};
  if (lg.toolUrl && lg.toolName) {
    const line = lg.ctaIntro || '';
    return `<aside class="pb-product-box"><p class="pb-product-label">この記事で触れた道具</p><p class="pb-product-name">${esc(lg.toolName)}</p><p class="pb-product-line">${esc(line)}</p><a class="pb-product-link" href="${esc(lg.toolUrl)}">詳しく見る</a></aside>`;
  }
  return '';
}

/* 関連記事3本: 同テーマの新しい順→足りなければ他の新しい順。自分は除く。0本なら []。 */
function selectRelatedPosts(post, allPosts, count) {
  const n = count || 3;
  const others = (allPosts || []).filter(p => p.slug !== post.slug);
  const byNewest = (a, b) => (a.published_at < b.published_at ? 1 : a.published_at > b.published_at ? -1 : 0);
  const sameTheme = others.filter(p => post.theme && p.theme === post.theme).sort(byNewest);
  const rest = others.filter(p => !(post.theme && p.theme === post.theme)).sort(byNewest);
  return [...sameTheme, ...rest].slice(0, n);
}

/* 関連記事セクション。0本なら ''。 */
function buildRelatedHtml(related, themesData) {
  const arr = Array.isArray(related) ? related : [];
  if (arr.length === 0) return '';
  const items = arr.map(p => {
    const t = p.theme && themesData ? themesData[p.theme] : null;
    const themeLabel = t ? t.label : '';
    return `<li><a class="pb-related-card" href="/blog/${esc(p.slug)}/"><span class="pb-related-theme">${esc(themeLabel)}</span><span class="pb-related-name">${esc(p.title)}</span><span class="pb-related-date">${esc(formatDateJa(p.published_at))}</span></a></li>`;
  }).join('');
  return `<section class="pb-related"><h2 class="pb-related-title">関連する記事</h2><ul class="pb-related-list">${items}</ul></section>`;
}

/* 著者の1行。固定文言(個人名は出さない)。 */
function buildAuthorHtml() {
  return '<p class="pb-author">PlugBits — kintone のプラグインと拡張を作っています。</p>';
}

/* JSON-LD: Article + BreadcrumbList を配列で返す(文字列化まで行う)。
   breadcrumbItems: [{name, url}, ...] ホーム→ブログ[→テーマ]→記事 の順で渡す。 */
function buildJsonLd(article, breadcrumbItems) {
  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: (breadcrumbItems || []).map((item, idx) => ({
      '@type': 'ListItem',
      position: idx + 1,
      name: item.name,
      item: item.url,
    })),
  };
  return JSON.stringify([article, breadcrumb]);
}

/* ページ送り: items を pageSize 件ごとの配列に分ける。0件なら [[]] ではなく [] を返す。 */
function paginate(items, pageSize) {
  const arr = Array.isArray(items) ? items : [];
  const size = pageSize || 20;
  if (arr.length === 0) return [];
  const pages = [];
  for (let i = 0; i < arr.length; i += size) pages.push(arr.slice(i, i + size));
  return pages;
}

/* ページ送りナビ。1ページのみなら ''。baseUrl は末尾 / 付き(例 "/blog/" "/blog/a/")。 */
function buildPagerHtml(currentPage, totalPages, baseUrl) {
  if (!totalPages || totalPages <= 1) return '';
  const pageUrl = n => (n <= 1 ? baseUrl : `${baseUrl}page/${n}/`);
  const prev = currentPage > 1 ? `<a rel="prev" href="${esc(pageUrl(currentPage - 1))}">前へ</a>` : '';
  const next = currentPage < totalPages ? `<a rel="next" href="${esc(pageUrl(currentPage + 1))}">次へ</a>` : '';
  return `<nav class="pb-pager">${prev}<span>${currentPage} / ${totalPages}</span>${next}</nav>`;
}

/* <head> 用の rel=prev/next <link> タグ。1ページのみなら ''。buildPagerHtml と同じ URL 規則。 */
function buildPrevNextLinkTags(currentPage, totalPages, baseUrl) {
  if (!totalPages || totalPages <= 1) return '';
  const pageUrl = n => (n <= 1 ? baseUrl : `${baseUrl}page/${n}/`);
  const prev = currentPage > 1 ? `<link rel="prev" href="${esc(pageUrl(currentPage - 1))}">` : '';
  const next = currentPage < totalPages ? `<link rel="next" href="${esc(pageUrl(currentPage + 1))}">` : '';
  return prev + next;
}

/* 一覧タブ(すべて/テーマA/テーマB)。activeSlug は 'all'|themesData[x].slug。 */
function buildTabsHtml(activeSlug, themesData) {
  const tabs = [{ slug: 'all', href: '/blog/', label: 'すべて' }];
  for (const key of Object.keys(themesData || {})) {
    const t = themesData[key];
    tabs.push({ slug: t.slug, href: `/blog/${t.slug}/`, label: t.label });
  }
  return `<nav class="pb-tabs">${tabs.map(t => {
    const isActive = t.slug === activeSlug;
    const cls = isActive ? 'pb-tab is-active' : 'pb-tab';
    const current = isActive ? ' aria-current="page"' : '';
    return `<a class="${cls}" href="${esc(t.href)}"${current}>${esc(t.label)}</a>`;
  }).join('')}</nav>`;
}

/* RSS 2.0。新しい順20件。 */
function buildFeedXml(posts, siteOrigin, limit) {
  const origin = siteOrigin || SITE_ORIGIN;
  const sorted = (posts || []).slice().sort((a, b) => (a.published_at < b.published_at ? 1 : -1)).slice(0, limit || 20);
  const items = sorted.map(p => {
    const link = `${origin}/blog/${p.slug}/`;
    const pubDate = new Date(`${p.published_at}T00:00:00+09:00`).toUTCString();
    return `<item><title>${escXml(p.title)}</title><link>${escXml(link)}</link><description>${escXml(p.description || p.card_summary || '')}</description><pubDate>${pubDate}</pubDate><guid>${escXml(link)}</guid></item>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>PlugBits Blog</title><link>${origin}/blog/</link><description>PlugBits のブログ</description>${items}</channel></rss>`;
}

function escXml(s) {
  return String(s ?? '').replace(/[&<>]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]));
}

/* 計測用の go スタブ(docs/launcher/go/x/index.html と同じ作り)。
   noindex・beacon 読み込み後にリダイレクト。sitemap には載せない(呼び側で入れない)。 */
function buildGoStub({ canonicalUrl, redirectUrl, pageTitle, ogDescription }) {
  // HTML 属性・本文には HTML エスケープ(&amp; 等)、<script> の中は HTML エスケープしない
  // (<script> の内容は HTML エンティティとして解釈されないので、&amp; を書くと URL が壊れる)。
  // JS の文字列リテラルとして安全なように \ と " だけエスケープする。
  const url = esc(redirectUrl);
  const jsUrl = String(redirectUrl ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(pageTitle)}</title>
<link rel="canonical" href="${esc(canonicalUrl)}">
<meta name="robots" content="noindex, follow">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(pageTitle)}">
<meta property="og:description" content="${esc(ogDescription || '')}">
<meta property="og:url" content="${esc(canonicalUrl)}">
<!-- Cloudflare Web Analytics --><script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "86511d1154774394986239de33d21882"}'></script><!-- End Cloudflare Web Analytics -->
<noscript><meta http-equiv="refresh" content="0; url=${url}"></noscript>
<script>
// ブログ記事からの入口を数えるページ。数えるのは Cloudflare の beacon(上の defer の script)。
// 読み込み(load)を待ってから移る。load が来なくても 1.5 秒で必ず移る
(function () {
  var done = false;
  function go() { if (done) return; done = true; location.replace("${jsUrl}"); }
  window.addEventListener("load", function () { setTimeout(go, 0); });
  setTimeout(go, 1500);
})();
</script>
</head>
<body>
<p><a href="${url}">${url}</a> へ移動します。</p>
</body>
</html>`;
}

/* og_image の決め方: md の og_image → assets/blog/og/<slug>.png が在ればそれ → 既定画像。
   ファイル存在チェックは呼び側(build.js)の責務なので、ここでは ogAssetExists を bool で受け取る。 */
function resolveOgImage(mdOgImage, slug, ogAssetExists, defaultImage) {
  if (mdOgImage) return mdOgImage;
  if (ogAssetExists) return `assets/blog/og/${slug}.png`;
  return defaultImage;
}

/* frontmatter + 本文(raw markdown, HTML どちらでも渡した文字列)から、
   posts.json と同じ形の内部オブジェクトを作る。
   contentHtmlRaw はすでに marked でレンダリング済みの HTML(呼び側で変換)。 */
function frontmatterToPost(data, bodyRawText, contentHtmlRaw, opts) {
  const o = opts || {};
  const published = data.date;
  const updated = data.updated || data.date;
  const rt = computeReadTime(bodyRawText);
  return {
    slug: data.slug,
    status: 'public',
    title: data.title,
    h1: data.title,
    description: data.description,
    keywords: data.keyword || '',
    theme: data.theme || null,
    product: data.product || 'none',
    published_at: published,
    updated_at: updated,
    read_time: rt.label,
    read_minutes: rt.minutes,
    card_summary: data.description,
    content_html: contentHtmlRaw,
    og_image: resolveOgImage(data.og_image, data.slug, !!o.ogAssetExists, o.defaultOgImage),
    tool_url: null,
    tool_name: null,
    cta_intro: null,
  };
}

/* 裸の URL を <URL> で囲む(marked の自動リンクは全角の句点や後ろの日本語までリンクに取り込むため。
   10/17 実機: 「(経緯: https://note.com/...)。項目が…」の href が文末まで伸びた)。URL は ASCII の
   URL 文字だけ(括弧は含めない)・末尾の . , は外す。Markdown リンク (…)・<…>・属性値の中・
   コードブロックの中は触らない。 */
function protectBareUrls(md) {
  const parts = String(md || '').split(/(^```[\s\S]*?^```)/m);
  return parts.map((part, i) => {
    if (i % 2 === 1) return part; // フェンスの中
    return part.replace(/(^|[^(<"'=\w/])(https?:\/\/[A-Za-z0-9\-._~:\/?#@!$&*+;=%]+)/gm, (m, pre, url) => {
      const trail = (url.match(/[.,;:!?]+$/) || [''])[0];
      const core = trail ? url.slice(0, -trail.length) : url;
      return `${pre}<${core}>${trail}`;
    });
  }).join('');
}

module.exports = {
  protectBareUrls,
  esc,
  formatDateJa,
  parseFrontmatter,
  stripHtmlComments,
  computeReadTime,
  isPublishable,
  isSampleFile,
  findSlugConflicts,
  addHeadingIds,
  buildToc,
  buildBreadcrumbHtml,
  buildMetaHtml,
  buildThemeBadgeHtml,
  buildProductBoxHtml,
  selectRelatedPosts,
  buildRelatedHtml,
  buildAuthorHtml,
  buildJsonLd,
  paginate,
  buildPagerHtml,
  buildPrevNextLinkTags,
  buildTabsHtml,
  buildFeedXml,
  buildGoStub,
  resolveOgImage,
  frontmatterToPost,
};
