// 英語ページの点検(レポートのみ・常に exit 0)。build 後に実行: node tools/check-en.mjs
// (a) 英語のページ(enDirs: /en/・products/en・launcher/en・pro/en・kintone 5 本の /en/)の可視テキストに日本語が残っていないか
// (b) data/products.json の *_ja に対して *_en が欠け・空・日本語混じりでないか
// (c) /en/ に Launcher カードが出ているか
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const OUT = process.env.CHECK_EN_OUT || '';   // 指定した時だけファイルにも書く(既定は標準出力だけ)
const JA = /[぀-ヿ㐀-䶿一-鿿＀-￯]/;
const snip = (s, n = 70) => { const i = s.search(JA); const a = Math.max(0, i - 20); return s.slice(a, a + n).replace(/\s+/g, ' '); };
const lines = [];
const out = s => lines.push(s);

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (dir === path.join(DIST, 'products') && e.name !== 'en') continue;
      walk(p, acc);
    } else if (e.name.endsWith('.html')) acc.push(p);
  }
  return acc;
}

// (a) built pages
// 英語のページがある場所(Launcher・Pro・kintone プラグイン 5 本の /en/)
const enDirs = ['en', 'products/en', 'launcher/en', 'pro/en',
  ...['gallery', 'listkit', 'rule-builder', 'excel-report', 'signage'].map(s => `kintone/kintone-${s}/en`)];
const files = enDirs.map(d => path.join(DIST, d)).flatMap(d => walk(d));
const textHits = [], attrHits = [];
let redirects = 0;
for (const f of files) {
  const rel = path.relative(DIST, f);
  let h = fs.readFileSync(f, 'utf8');
  if (/http-equiv=["']refresh/i.test(h)) { redirects++; continue; }
  h = h.replace(/<!--[\s\S]*?-->/g, '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
  // 言語切替リンク(日本語 / JP)は対象外
  h = h.replace(/<a\b[^>]*class="[^"]*kb-lang[^"]*"[^>]*>[\s\S]*?<\/a>/gi, '')
       .replace(/<a\b[^>]*hreflang=[^>]*>[\s\S]*?<\/a>/gi, '')
       .replace(/<a\b[^>]*>\s*日本語\s*<\/a>/gi, '');
  for (const m of h.matchAll(/<(title)[^>]*>([\s\S]*?)<\/title>/gi)) if (JA.test(m[2])) textHits.push([rel, 'title', snip(m[2])]);
  const attrs = [...h.matchAll(/\b(alt|aria-label|title|placeholder|content)="([^"]*)"/gi)];
  for (const m of attrs) if (JA.test(m[2])) attrHits.push([rel, `[attr ${m[1]}]`, snip(m[2])]);
  const body = h.replace(/<head[\s\S]*?<\/head>/i, '').replace(/<[^>]+>/g, '\n');
  for (const l of body.split('\n')) if (JA.test(l)) textHits.push([rel, 'text', snip(l)]);
}

// (b) products.json
const prods = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'products.json'), 'utf8'));
const hasJa = v => JA.test(JSON.stringify(v ?? ''));
const empty = v => v == null || v === '' || (Array.isArray(v) && v.length === 0);
const jsonHits = [];
for (const p of prods) {
  for (const k of Object.keys(p).filter(k => k.endsWith('_ja'))) {
    const ek = k.replace(/_ja$/, '_en');
    if (empty(p[k])) continue;
    if (!(ek in p) || empty(p[ek])) { jsonHits.push([p.slug, ek, 'MISSING/EMPTY', snip(JSON.stringify(p[k]).replace(/^"|"$/g, ''), 40)]); continue; }
    if (hasJa(p[ek])) jsonHits.push([p.slug, ek, 'HAS JAPANESE', snip(JSON.stringify(p[ek]))]);
  }
  // screenshots の caption
  (p.screenshots || []).forEach((s, i) => {
    if (s.caption_ja && (!s.caption_en || hasJa(s.caption_en))) jsonHits.push([p.slug, `screenshots[${i}].caption_en`, s.caption_en ? 'HAS JAPANESE' : 'MISSING/EMPTY', s.caption_ja.slice(0, 40)]);
  });
}

// (c) Launcher card
let card = 'dist/en/index.html not found';
const enIdx = path.join(DIST, 'en', 'index.html');
if (fs.existsSync(enIdx)) {
  const h = fs.readFileSync(enIdx, 'utf8');
  const feat = /<div class="kb-ext-featured">[\s\S]*?PlugBits Launcher/.test(h);
  const link = /<a[^>]*href="\/launcher\/(en\/)?"/.exec(h);
  card = feat ? `YES: featured Launcher block (.kb-ext-featured, "PlugBits Launcher")${link ? ` with "Learn more" link to ${link[1] ? '/launcher/en/' : '/launcher/ (JP LP)'}` : ''}` : 'NO Launcher block found in dist/en/index.html';
}

out('# English site check');
out('');
out(`Scanned ${files.length} built page(s) under ${enDirs.join(', ')} (${redirects} are redirect stubs, skipped).`);
out(`- Japanese in visible text: ${textHits.length}`);
out(`- Japanese in attributes (alt/aria/title/content): ${attrHits.length}`);
out(`- products.json *_en problems: ${jsonHits.length}`);
out('');
out(`## /en/ Launcher card\n${card}\n`);
out('## products.json (slug / field / problem / snippet)');
jsonHits.forEach(r => out(`- ${r[0]} / ${r[1]} / ${r[2]} -> ${r[3]}`));
out('\n## Built pages: Japanese in visible text (file / where -> snippet)');
textHits.forEach(r => out(`- ${r[0]} / ${r[1]} -> ${r[2]}`));
out('\n## Built pages: Japanese in attributes');
attrHits.forEach(r => out(`- ${r[0]} / ${r[1]} -> ${r[2]}`));
const report = lines.join('\n') + '\n';
if (OUT) {
  try { fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, report); } catch (e) { console.error('write failed', e.message); }
}
console.log(report);
if (OUT) console.log(`(written to ${OUT})`);
process.exit(0);
