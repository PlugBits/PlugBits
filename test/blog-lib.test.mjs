// test/blog-lib.test.mjs
// blog-lib.js の純関数テスト。フレームワークは使わず node:assert だけ。
// 実行: node test/blog-lib.test.mjs (または npm test)
import assert from 'node:assert/strict';
import lib from '../scripts/blog-lib.js';

const {
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
} = lib;

let pass = 0;
let fail = 0;
function test(name, fn) {
  try {
    fn();
    pass++;
    console.log(`ok - ${name}`);
  } catch (e) {
    fail++;
    console.error(`NOT OK - ${name}`);
    console.error(e);
  }
}

const THEMES = {
  A: { slug: 'a', label: 'kintone の一覧・入力・設定', lead: 'テーマAの説明' },
  B: { slug: 'b', label: '製造の kintone', lead: 'テーマBの説明' },
};
const PRODUCTS = {
  launcher: { name: 'PlugBits Launcher', line: 'Launcherの説明', href: '/launcher/go/{slug}/' },
};

// --- esc / formatDateJa ---
test('esc escapes html special chars', () => {
  assert.equal(esc('<a>&"\''), '&lt;a&gt;&amp;&quot;&#39;');
});
test('formatDateJa formats YYYY-MM-DD to Japanese date', () => {
  assert.equal(formatDateJa('2026-10-20'), '2026年10月20日');
});
test('formatDateJa returns input as-is when not a date', () => {
  assert.equal(formatDateJa('bogus'), 'bogus');
});

// --- parseFrontmatter ---
test('parseFrontmatter splits frontmatter and body', () => {
  const raw = '---\nslug: foo\ntitle: タイトル\napproved: true\n---\n本文です\n';
  const { data, body } = parseFrontmatter(raw);
  assert.equal(data.slug, 'foo');
  assert.equal(data.title, 'タイトル');
  assert.equal(data.approved, true);
  assert.equal(body.trim(), '本文です');
});
test('parseFrontmatter keeps unquoted YAML dates as YYYY-MM-DD strings, not Date objects', () => {
  const raw = '---\nslug: foo\ndate: 2026-10-01\nupdated: 2026-10-05\napproved: true\n---\n本文\n';
  const { data } = parseFrontmatter(raw);
  assert.equal(typeof data.date, 'string');
  assert.equal(data.date, '2026-10-01');
  assert.equal(data.updated, '2026-10-05');
  // 肝心なのは isPublishable がこの文字列をそのまま比較に使えること
  assert.equal(isPublishable(data, '2026-10-01'), true);
  assert.equal(isPublishable(data, '2026-09-30'), false);
});
test('parseFrontmatter handles missing frontmatter gracefully', () => {
  const { data, body } = parseFrontmatter('本文だけ');
  assert.deepEqual(data, {});
  assert.equal(body, '本文だけ');
});

// --- stripHtmlComments ---
test('stripHtmlComments removes HTML comments', () => {
  const html = '<p>本文</p><!-- 出どころ: 実装 -->\n<p>続き</p>';
  assert.equal(stripHtmlComments(html), '<p>本文</p>\n<p>続き</p>');
});
test('stripHtmlComments removes multiple and multiline comments', () => {
  const html = '<!-- a\nb -->x<!-- c -->y';
  assert.equal(stripHtmlComments(html), 'xy');
});

// --- computeReadTime ---
test('computeReadTime rounds up to the nearest minute, min 1', () => {
  assert.equal(computeReadTime('a').minutes, 1);
  assert.equal(computeReadTime('').minutes, 1);
  assert.equal(computeReadTime('あ'.repeat(500)).minutes, 1);
  assert.equal(computeReadTime('あ'.repeat(501)).minutes, 2);
  assert.equal(computeReadTime('あ'.repeat(1000)).minutes, 2);
});
test('computeReadTime label is "N分で読めます"', () => {
  assert.equal(computeReadTime('あ'.repeat(1000)).label, '2分で読めます');
});
test('computeReadTime ignores whitespace when counting', () => {
  const withSpaces = computeReadTime('a '.repeat(300)); // 300 non-space chars
  const withoutSpaces = computeReadTime('a'.repeat(300));
  assert.equal(withSpaces.minutes, withoutSpaces.minutes);
});

// --- isPublishable ---
test('isPublishable true when approved and date <= today', () => {
  assert.equal(isPublishable({ approved: true, date: '2026-10-17' }, '2026-10-17'), true);
  assert.equal(isPublishable({ approved: true, date: '2026-10-16' }, '2026-10-17'), true);
});
test('isPublishable false when not approved', () => {
  assert.equal(isPublishable({ approved: false, date: '2026-10-16' }, '2026-10-17'), false);
  assert.equal(isPublishable({ date: '2026-10-16' }, '2026-10-17'), false);
});
test('isPublishable false when date is in the future', () => {
  assert.equal(isPublishable({ approved: true, date: '2026-10-18' }, '2026-10-17'), false);
});

// --- isSampleFile ---
test('isSampleFile detects leading underscore', () => {
  assert.equal(isSampleFile('_sample-a.md'), true);
  assert.equal(isSampleFile('_template.md'), true);
  assert.equal(isSampleFile('kintone-xxxx.md'), false);
});

// --- findSlugConflicts ---
test('findSlugConflicts finds overlap between md and json slugs', () => {
  const conflicts = findSlugConflicts(['foo', 'bar'], ['bar', 'baz']);
  assert.deepEqual(conflicts, ['bar']);
});
test('findSlugConflicts finds duplicate slugs within md itself', () => {
  const conflicts = findSlugConflicts(['foo', 'foo'], []);
  assert.deepEqual(conflicts, ['foo']);
});
test('findSlugConflicts returns empty array when no overlap', () => {
  assert.deepEqual(findSlugConflicts(['foo'], ['bar']), []);
});

// --- addHeadingIds / buildToc ---
test('addHeadingIds assigns h-1, h-2... in order and extracts text', () => {
  const html = '<p>x</p><h2>見出し1</h2><p>y</p><h2>見出し<b>2</b></h2>';
  const { html: out, headings } = addHeadingIds(html);
  assert.match(out, /<h2 id="h-1">見出し1<\/h2>/);
  assert.match(out, /<h2 id="h-2">見出し<b>2<\/b><\/h2>/);
  assert.deepEqual(headings, [{ id: 'h-1', text: '見出し1' }, { id: 'h-2', text: '見出し2' }]);
});
test('addHeadingIds overwrites an existing id attribute', () => {
  const html = '<h2 id="old">A</h2><h2 class="x" id="old2">B</h2>';
  const { html: out } = addHeadingIds(html);
  assert.match(out, /<h2 id="h-1">A<\/h2>/);
  assert.match(out, /<h2 class="x" id="h-2">B<\/h2>/);
});
test('buildToc returns "" when fewer than 2 H2s', () => {
  assert.equal(buildToc([]), '');
  assert.equal(buildToc([{ id: 'h-1', text: 'a' }]), '');
});
test('buildToc returns "" when the body already has a 目次 heading', () => {
  assert.equal(buildToc([{ id: 'h-1', text: '目次' }, { id: 'h-2', text: 'A' }, { id: 'h-3', text: 'B' }]), '');
});
test('buildToc builds nav with ol/li/a for 2+ headings', () => {
  const toc = buildToc([{ id: 'h-1', text: 'A' }, { id: 'h-2', text: 'B' }]);
  assert.match(toc, /^<nav class="pb-toc" aria-label="目次"><p class="pb-toc-title">目次<\/p><ol>/);
  assert.match(toc, /<li><a href="#h-1">A<\/a><\/li>/);
  assert.match(toc, /<li><a href="#h-2">B<\/a><\/li>/);
});

// --- buildBreadcrumbHtml ---
test('buildBreadcrumbHtml without theme', () => {
  const html = buildBreadcrumbHtml(null, THEMES);
  assert.equal(html, '<nav class="pb-crumbs" aria-label="パンくず"><a href="/">ホーム</a><span>›</span><a href="/blog/">ブログ</a></nav>');
});
test('buildBreadcrumbHtml with theme appends theme link', () => {
  const html = buildBreadcrumbHtml('A', THEMES);
  assert.match(html, /<span>›<\/span><a href="\/blog\/a\/">kintone の一覧・入力・設定<\/a><\/nav>$/);
});

// --- buildMetaHtml ---
test('buildMetaHtml without update shows only published date', () => {
  const html = buildMetaHtml('2026-10-20', '2026-10-20', '5分で読めます');
  assert.equal(html, '<p class="pb-post-meta"><time datetime="2026-10-20">2026年10月20日</time>公開・5分で読めます</p>');
});
test('buildMetaHtml with update shows both dates', () => {
  const html = buildMetaHtml('2026-10-20', '2026-10-25', '5分で読めます');
  assert.ok(html.includes('公開・<time datetime="2026-10-25">2026年10月25日</time>更新・5分で読めます'));
});

// --- buildThemeBadgeHtml ---
test('buildThemeBadgeHtml returns "" when no theme', () => {
  assert.equal(buildThemeBadgeHtml(null, THEMES), '');
  assert.equal(buildThemeBadgeHtml('C', THEMES), '');
});
test('buildThemeBadgeHtml returns link when theme set', () => {
  assert.equal(buildThemeBadgeHtml('B', THEMES), '<a class="pb-theme-badge" href="/blog/b/">製造の kintone</a>');
});

// --- buildProductBoxHtml ---
test('buildProductBoxHtml returns "" when product is none and no legacy fields', () => {
  assert.equal(buildProductBoxHtml('none', PRODUCTS, 'my-slug', null), '');
  assert.equal(buildProductBoxHtml(null, PRODUCTS, 'my-slug', null), '');
});
test('buildProductBoxHtml builds box from product + substitutes slug in href', () => {
  const html = buildProductBoxHtml('launcher', PRODUCTS, 'my-slug', null);
  assert.ok(html.includes('<p class="pb-product-name">PlugBits Launcher</p>'));
  assert.ok(html.includes('href="/launcher/go/my-slug/"'));
  assert.ok(html.startsWith('<aside class="pb-product-box">'));
});
test('buildProductBoxHtml falls back to legacy tool_url/tool_name', () => {
  const html = buildProductBoxHtml('none', PRODUCTS, 'slug', { toolUrl: 'https://x.example/', toolName: 'ツール', ctaIntro: '紹介文' });
  assert.ok(html.includes('<p class="pb-product-name">ツール</p>'));
  assert.ok(html.includes('<p class="pb-product-line">紹介文</p>'));
  assert.ok(html.includes('href="https://x.example/"'));
});

// --- selectRelatedPosts / buildRelatedHtml ---
const POSTS = [
  { slug: 'a1', title: 'A1', theme: 'A', published_at: '2026-10-01' },
  { slug: 'a2', title: 'A2', theme: 'A', published_at: '2026-10-05' },
  { slug: 'b1', title: 'B1', theme: 'B', published_at: '2026-10-10' },
  { slug: 'b2', title: 'B2', theme: 'B', published_at: '2026-10-02' },
  { slug: 'none1', title: 'N1', theme: null, published_at: '2026-10-12' },
];
test('selectRelatedPosts prefers same theme, newest first, excludes self', () => {
  const self = { slug: 'a3', theme: 'A', published_at: '2026-10-15' };
  const related = selectRelatedPosts(self, POSTS, 3);
  assert.deepEqual(related.map(p => p.slug), ['a2', 'a1', 'none1']);
});
test('selectRelatedPosts falls back to other newest when same theme is short', () => {
  const self = { slug: 'onlyA', theme: 'A', published_at: '2026-10-20' };
  const limited = [POSTS[0]]; // only a1 (theme A)
  const related = selectRelatedPosts(self, limited.concat(POSTS.slice(2)), 3);
  assert.deepEqual(related.map(p => p.slug), ['a1', 'none1', 'b1']);
});
test('selectRelatedPosts returns [] when nothing else exists', () => {
  assert.deepEqual(selectRelatedPosts({ slug: 'only' }, [{ slug: 'only', theme: null, published_at: '2026-01-01' }], 3), []);
});
test('buildRelatedHtml returns "" for empty list', () => {
  assert.equal(buildRelatedHtml([], THEMES), '');
});
test('buildRelatedHtml renders cards with theme label, title, date', () => {
  const html = buildRelatedHtml([{ slug: 'a1', title: 'A1', theme: 'A', published_at: '2026-10-01' }], THEMES);
  assert.ok(html.startsWith('<section class="pb-related"><h2 class="pb-related-title">関連する記事</h2>'));
  assert.ok(html.includes('<span class="pb-related-theme">kintone の一覧・入力・設定</span>'));
  assert.ok(html.includes('<span class="pb-related-name">A1</span>'));
  assert.ok(html.includes('href="/blog/a1/"'));
});

// --- buildAuthorHtml ---
test('buildAuthorHtml is a fixed PlugBits line with no personal name', () => {
  const html = buildAuthorHtml();
  assert.equal(html, '<p class="pb-author">PlugBits — kintone のプラグインと拡張を作っています。</p>');
});

// --- buildJsonLd ---
test('buildJsonLd returns an array of [Article, BreadcrumbList]', () => {
  const article = { '@type': 'Article', headline: 'タイトル' };
  const json = buildJsonLd(article, [{ name: 'ホーム', url: 'https://plugbits.app/' }, { name: 'ブログ', url: 'https://plugbits.app/blog/' }]);
  const parsed = JSON.parse(json);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].headline, 'タイトル');
  assert.equal(parsed[1]['@type'], 'BreadcrumbList');
  assert.equal(parsed[1].itemListElement[1].position, 2);
});

// --- paginate ---
test('paginate splits into chunks of pageSize', () => {
  const items = Array.from({ length: 45 }, (_, i) => i);
  const pages = paginate(items, 20);
  assert.equal(pages.length, 3);
  assert.equal(pages[0].length, 20);
  assert.equal(pages[1].length, 20);
  assert.equal(pages[2].length, 5);
});
test('paginate returns [] for empty input', () => {
  assert.deepEqual(paginate([], 20), []);
});

// --- buildPagerHtml ---
test('buildPagerHtml returns "" for a single page', () => {
  assert.equal(buildPagerHtml(1, 1, '/blog/'), '');
});
test('buildPagerHtml shows next only on first page', () => {
  const html = buildPagerHtml(1, 3, '/blog/');
  assert.ok(!html.includes('rel="prev"'));
  assert.ok(html.includes('rel="next" href="/blog/page/2/"'));
  assert.ok(html.includes('<span>1 / 3</span>'));
});
test('buildPagerHtml shows both prev and next on a middle page', () => {
  const html = buildPagerHtml(2, 3, '/blog/a/');
  assert.ok(html.includes('rel="prev" href="/blog/a/"'));
  assert.ok(html.includes('rel="next" href="/blog/a/page/3/"'));
});
test('buildPagerHtml shows prev only on the last page', () => {
  const html = buildPagerHtml(3, 3, '/blog/');
  assert.ok(html.includes('rel="prev" href="/blog/page/2/"'));
  assert.ok(!html.includes('rel="next"'));
});

// --- buildPrevNextLinkTags ---
test('buildPrevNextLinkTags returns "" for a single page', () => {
  assert.equal(buildPrevNextLinkTags(1, 1, '/blog/'), '');
});
test('buildPrevNextLinkTags emits rel=next on first page, both on middle page', () => {
  assert.equal(buildPrevNextLinkTags(1, 2, '/blog/'), '<link rel="next" href="/blog/page/2/">');
  assert.equal(
    buildPrevNextLinkTags(2, 3, '/blog/a/'),
    '<link rel="prev" href="/blog/a/"><link rel="next" href="/blog/a/page/3/">'
  );
});

// --- buildTabsHtml ---
test('buildTabsHtml marks the active tab', () => {
  const html = buildTabsHtml('a', THEMES);
  assert.ok(html.includes('<a class="pb-tab is-active" href="/blog/a/" aria-current="page">kintone の一覧・入力・設定</a>'));
  assert.ok(html.includes('<a class="pb-tab" href="/blog/">すべて</a>'));
  assert.ok(html.includes('<a class="pb-tab" href="/blog/b/">製造の kintone</a>'));
});

// --- buildFeedXml ---
test('buildFeedXml includes title/link/description/pubDate, newest first', () => {
  const xml = buildFeedXml([
    { slug: 'old', title: '古い記事', description: '説明1', published_at: '2026-01-01' },
    { slug: 'new', title: '新しい記事', description: '説明2', published_at: '2026-10-01' },
  ], 'https://plugbits.app', 20);
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?><rss version="2.0">'));
  const firstIdx = xml.indexOf('<item>');
  assert.ok(xml.slice(firstIdx).startsWith('<item><title>新しい記事</title>'));
  assert.ok(xml.includes('<link>https://plugbits.app/blog/new/</link>'));
  assert.ok(xml.includes('<pubDate>'));
});
test('buildFeedXml limits to N items', () => {
  const posts = Array.from({ length: 25 }, (_, i) => ({ slug: `s${i}`, title: `T${i}`, description: 'd', published_at: `2026-01-${String(i + 1).padStart(2, '0')}` }));
  const xml = buildFeedXml(posts, 'https://plugbits.app', 20);
  assert.equal((xml.match(/<item>/g) || []).length, 20);
});

// --- buildGoStub ---
test('buildGoStub builds a noindex redirect stub', () => {
  const html = buildGoStub({
    canonicalUrl: 'https://plugbits.app/launcher/',
    redirectUrl: 'https://chromewebstore.google.com/detail/xxx?utm_source=blog',
    pageTitle: 'タイトル',
    ogDescription: '説明',
  });
  assert.ok(html.includes('<meta name="robots" content="noindex, follow">'));
  assert.ok(html.includes('<link rel="canonical" href="https://plugbits.app/launcher/">'));
  assert.ok(html.includes('location.replace("https://chromewebstore.google.com/detail/xxx?utm_source=blog")'));
  assert.ok(html.includes('<noscript><meta http-equiv="refresh" content="0; url=https://chromewebstore.google.com/detail/xxx?utm_source=blog"></noscript>'));
});
test('buildGoStub does not HTML-escape the "&" inside <script> (it would corrupt the JS string + URL)', () => {
  const html = buildGoStub({
    canonicalUrl: 'https://plugbits.app/pro.html',
    redirectUrl: 'https://plugbits.app/pro.html?utm_source=blog&utm_campaign=slug',
    pageTitle: 'タイトル',
    ogDescription: '説明',
  });
  assert.ok(html.includes('location.replace("https://plugbits.app/pro.html?utm_source=blog&utm_campaign=slug")'));
  assert.ok(!html.includes('location.replace("https://plugbits.app/pro.html?utm_source=blog&amp;utm_campaign=slug")'));
  // HTML 属性側(noscript の refresh・本文のリンク)は & をエスケープしてよい
  assert.ok(html.includes('url=https://plugbits.app/pro.html?utm_source=blog&amp;utm_campaign=slug'));
});

// --- resolveOgImage ---
test('resolveOgImage prefers md og_image', () => {
  assert.equal(resolveOgImage('custom.png', 'slug', true, 'default.png'), 'custom.png');
});
test('resolveOgImage falls back to per-slug asset when it exists', () => {
  assert.equal(resolveOgImage('', 'my-slug', true, 'default.png'), 'assets/blog/og/my-slug.png');
});
test('resolveOgImage falls back to default image otherwise', () => {
  assert.equal(resolveOgImage('', 'my-slug', false, 'default.png'), 'default.png');
});

// --- frontmatterToPost ---
test('frontmatterToPost maps frontmatter + body into the posts.json shape', () => {
  const data = { slug: 'kintone-x', title: 'タイトル', description: '説明', date: '2026-10-20', theme: 'A', product: 'launcher', keyword: 'kintone x' };
  const post = frontmatterToPost(data, 'あ'.repeat(600), '<p>本文</p>', { ogAssetExists: false, defaultOgImage: 'assets/blog/og_blog_default.png' });
  assert.equal(post.slug, 'kintone-x');
  assert.equal(post.h1, 'タイトル');
  assert.equal(post.published_at, '2026-10-20');
  assert.equal(post.updated_at, '2026-10-20'); // updated 省略時は date
  assert.equal(post.read_time, '2分で読めます');
  assert.equal(post.card_summary, '説明');
  assert.equal(post.keywords, 'kintone x');
  assert.equal(post.theme, 'A');
  assert.equal(post.product, 'launcher');
  assert.equal(post.og_image, 'assets/blog/og_blog_default.png');
  assert.equal(post.content_html, '<p>本文</p>');
});
test('frontmatterToPost uses updated field when present', () => {
  const data = { slug: 's', title: 't', description: 'd', date: '2026-10-01', updated: '2026-10-10' };
  const post = frontmatterToPost(data, 'x', '<p/>', {});
  assert.equal(post.published_at, '2026-10-01');
  assert.equal(post.updated_at, '2026-10-10');
});
test('frontmatterToPost defaults product to "none" when absent', () => {
  const data = { slug: 's', title: 't', description: 'd', date: '2026-10-01' };
  const post = frontmatterToPost(data, 'x', '<p/>', {});
  assert.equal(post.product, 'none');
  assert.equal(post.theme, null);
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
