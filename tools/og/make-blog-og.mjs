#!/usr/bin/env node
// ブログ記事の og:image(1200x630)を記事ごとに作る(2026-10-17)。
//
// 題材: tools/og/blog-og.html(見た目のテンプレ)を playwright で開き、
// #eyebrow / #theme-label / #title の中身を記事の frontmatter で書き換えてから撮る。
// 題名は最大3行。はみ出す時は文字を詰め(フォントサイズを下げ)、それでも収まらない
// 最後の手段として末尾を … で切る(blog-og.html 側のコメント参照)。
//
// playwright の在りか(このリポには入れない。環境変数で渡す):
//   PW_CORE_DIR   : playwright-core が入っている node_modules を持つディレクトリ(無ければ普通に require)
//   PW_CHROME     : Chromium の実行体(無ければ playwright-core の既定)
//   PW_NATIVE_LIBS: 足りない共有ライブラリの置き場(LD_LIBRARY_PATH の先頭に足す。任意)
//
// 使い方:
//   node tools/og/make-blog-og.mjs
//     → content/blog/*.md のうち assets/blog/og/<slug>.jpg が無いものを全部作る
//   node tools/og/make-blog-og.mjs <slug> [<slug>...]
//     → 指定した記事だけ、既にあっても作り直す(content/blog/<slug>.md を読む)
//   node tools/og/make-blog-og.mjs --md <path/to/試し.md> --out <path/to/出力.png>
//     → content/blog/ を見ない単体テストモード。frontmatter は js-yaml で読む。
//       (content/blog/ にまだ記事が無いうちの確認用。--out を省くと
//        /tmp 配下の一時ファイルに書き、assets/ には何も残さない)
//   node tools/og/make-blog-og.mjs --posts-json [--force] [<slug> ...]
//     → content/blog/*.md ではなく data/posts.json を見るモード(2026-10-17)。
//       status=public かつ og_image を明示していない記事だけを対象にする。題名は
//       posts.json の title(長い時は h1 の方が短ければそちら)。既にある
//       assets/blog/og/<slug>.jpg は --force を付けない限り作り直さない。
//       slug を続けて渡すとその中だけに絞る。
//
// 共通オプション:
//   --out <path>   出力先を1枚だけ差し替える(対象が1本のときだけ有効。本番の
//                  assets/blog/og/ を汚さずに試すため。--posts-json とは併用不可)
//   --content-dir <dir>  content/blog の代わりに読むディレクトリ(既定: content/blog)
//   --og-dir <dir>       assets/blog/og の代わりに書くディレクトリ(既定: assets/blog/og)
//   --force              (--posts-json 用)既にある jpg も作り直す

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(HERE, '..', '..'); // tools/og -> リポジトリ直下

const nodeRequire = createRequire(import.meta.url);
const yaml = nodeRequire('js-yaml');

const pwRequire = process.env.PW_CORE_DIR
  ? createRequire(path.join(process.env.PW_CORE_DIR, 'x.js'))
  : nodeRequire;
const { chromium } = pwRequire('playwright-core');

const CHROME_EXEC = process.env.PW_CHROME || undefined;
if (process.env.PW_NATIVE_LIBS) {
  process.env.LD_LIBRARY_PATH = process.env.PW_NATIVE_LIBS + ':' + (process.env.LD_LIBRARY_PATH || '');
}

const TEMPLATE_PATH = path.join(HERE, 'blog-og.html');

// 既定のテーマ名(data/blog-themes.json が無い/足りない時のフォールバック。
//  data/blog-themes.json を
// 作ったら、そちらにある値を優先して使う)
const FALLBACK_THEMES = {
  A: { label: 'kintone の一覧・入力・設定' },
  B: { label: '製造の kintone' },
};

function loadThemeLabels() {
  const p = path.join(REPO_ROOT, 'data', 'blog-themes.json');
  if (fs.existsSync(p)) {
    try {
      const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
      const out = {};
      for (const key of Object.keys(data)) out[key] = { label: data[key].label };
      return out;
    } catch (e) {
      console.error(`!! data/blog-themes.json の読み込みに失敗(フォールバックを使う): ${e.message}`);
    }
  }
  return FALLBACK_THEMES;
}

function parseFrontmatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) throw new Error('frontmatter(---で囲んだ部分)が見つからない');
  const fm = yaml.load(m[1]) || {};
  return fm;
}

function readArticle(mdPath) {
  const raw = fs.readFileSync(mdPath, 'utf-8');
  const fm = parseFrontmatter(raw);
  const slug = fm.slug || path.basename(mdPath, '.md');
  if (!fm.title) throw new Error(`${mdPath}: frontmatter に title が無い`);
  return { slug, title: String(fm.title), theme: fm.theme || null };
}

// data/posts.json から、公開済み(status=public)で og_image を明示していない記事を拾う
// (--posts-json 用、2026-10-17)。題名は posts.json の title を基本にし、
// h1 の方が短ければ h1 を使う(はみ出しにくい方を選ぶ)。
function readArticlesFromPostsJson() {
  const postsPath = path.join(REPO_ROOT, 'data', 'posts.json');
  if (!fs.existsSync(postsPath)) {
    console.error(`!! ${postsPath} が無い`);
    process.exit(2);
  }
  const posts = JSON.parse(fs.readFileSync(postsPath, 'utf-8'));
  const out = [];
  for (const p of posts) {
    if (p.status !== 'public') continue;
    if (p.og_image && String(p.og_image).trim() !== '') continue; // og_image 明示済みは対象外
    const title = p.h1 && p.h1.length < p.title.length ? p.h1 : p.title;
    out.push({ slug: p.slug, title: String(title), theme: p.theme || null });
  }
  return out;
}

async function fitTitle(page, text) {
  return page.evaluate((text) => {
    const el = document.getElementById('title');
    const wrap = document.getElementById('title-wrap');
    const MAX_FONT = 64;
    const MIN_FONT = 34;
    const MAX_LINES = 3;
    const LINE_HEIGHT_RATIO = 1.32;
    const maxBoxHeight = wrap.clientHeight;

    el.style.lineHeight = String(LINE_HEIGHT_RATIO);
    el.textContent = text;

    let fontSize = MAX_FONT;
    const setSize = (px) => { el.style.fontSize = px + 'px'; fontSize = px; };
    const currentLines = () => {
      const lh = fontSize * LINE_HEIGHT_RATIO;
      return Math.round(el.scrollHeight / lh);
    };
    const fitsBox = () => el.scrollHeight <= maxBoxHeight + 1 && currentLines() <= MAX_LINES;

    setSize(MAX_FONT);
    while (fontSize > MIN_FONT && !fitsBox()) {
      setSize(fontSize - 1);
    }

    let truncated = false;
    if (!fitsBox()) {
      // 最後の手段: 末尾から1文字ずつ削って … を付ける(フォントは最小のまま)
      let t = text;
      while (t.length > 1 && !fitsBox()) {
        t = t.slice(0, -1);
        el.textContent = t + '…';
        truncated = true;
      }
    }

    return {
      fontSize,
      finalText: el.textContent,
      lines: currentLines(),
      truncated,
    };
  }, text);
}

async function renderOne({ browser, slug, title, theme, themeLabels, outPath }) {
  const ctx = await browser.newContext({
    viewport: { width: 1200, height: 630 },
    // deviceScaleFactor: 2 だと screenshot の実ピクセルが 2400x1260 になり、og:image の
    // 規定(1200x630)とずれる(2026-10-17)。
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();
  const fileUrl = 'file://' + TEMPLATE_PATH;
  await page.goto(fileUrl, { waitUntil: 'load', timeout: 30000 });

  // Web フォント(Noto Sans JP)の読み終わりを待つ(読む前に撮ると和文がフォールバック
  // フォントの太さ・幅のまま測ってしまい、行数の判定がずれる)
  await page.evaluate(async () => {
    const specs = [
      '900 64px "Noto Sans JP"',
      '700 17px "Noto Sans JP"',
      '700 18px "Noto Sans JP"',
      '400 18px "Noto Sans JP"',
    ];
    await Promise.all(specs.map((s) => document.fonts.load(s).catch(() => {})));
    await document.fonts.ready;
  });

  const themeInfo = theme ? themeLabels[theme] : null;
  await page.evaluate(({ themeLabel }) => {
    const badge = document.getElementById('theme-badge');
    const label = document.getElementById('theme-label');
    if (themeLabel) {
      label.textContent = themeLabel;
      badge.classList.remove('is-hidden');
    } else {
      badge.classList.add('is-hidden');
    }
  }, { themeLabel: themeInfo ? themeInfo.label : null });

  const fit = await fitTitle(page, title);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  // JPEG(品質 85)。PNG だと 1 枚 1.2MB あり、公開リポに毎日積むと重い(2026-10-17)
  await page.screenshot({ path: outPath, type: 'jpeg', quality: 85 });
  await ctx.close();

  return fit;
}

async function main() {
  const argv = process.argv.slice(2);
  const opt = (name) => {
    const i = argv.indexOf('--' + name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const outOverride = opt('out');
  const mdOverride = opt('md');
  const contentDir = path.resolve(REPO_ROOT, opt('content-dir') || path.join('content', 'blog'));
  const ogDir = path.resolve(REPO_ROOT, opt('og-dir') || path.join('assets', 'blog', 'og'));
  // data/posts.json の記事から og_image 未指定のものをまとめて作るモード(2026-10-17)
  const postsJsonMode = argv.includes('--posts-json');
  // 既にある jpg も作り直す(現状は --posts-json でだけ意味を持つ)
  const forceFlag = argv.includes('--force');

  // --xxx とその値を除いた残りを slug 引数として扱う(--posts-json / --force は値を取らないブール)
  const valueFlags = new Set(['out', 'md', 'content-dir', 'og-dir']);
  const slugArgs = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      if (valueFlags.has(a.slice(2))) i++; // 値をスキップ
      continue;
    }
    slugArgs.push(a);
  }

  const themeLabels = loadThemeLabels();

  /** @type {{slug:string, title:string, theme:string|null, outPath:string}[]} */
  const targets = [];

  if (mdOverride) {
    const mdPath = path.resolve(mdOverride);
    const art = readArticle(mdPath);
    const outPath = outOverride
      ? path.resolve(outOverride)
      : path.join(os.tmpdir(), `blog-og-test-${art.slug}.jpg`);
    targets.push({ ...art, outPath });
  } else if (postsJsonMode) {
    // data/posts.json 側のモード(2026-10-17): 公開済みで og_image 未指定の記事を
    // まとめて作る。slug を一緒に渡した時はその中だけに絞る。既にある jpg は --force
    // が無い限り作り直さない。
    if (outOverride) {
      console.error('!! --out は --posts-json とは併用不可(対象が複数件になりうる)');
      process.exit(2);
    }
    const articles = readArticlesFromPostsJson();
    const wanted = slugArgs.length > 0 ? articles.filter((a) => slugArgs.includes(a.slug)) : articles;
    for (const art of wanted) {
      const outPath = path.join(ogDir, `${art.slug}.jpg`);
      if (fs.existsSync(outPath) && !forceFlag) continue; // 既にある jpg は作り直さない(--force で作り直す)
      targets.push({ ...art, outPath });
    }
  } else if (slugArgs.length > 0) {
    if (outOverride && slugArgs.length > 1) {
      console.error('!! --out は対象が1本のときだけ使える(slug を複数渡した)');
      process.exit(2);
    }
    for (const slug of slugArgs) {
      const mdPath = path.join(contentDir, `${slug}.md`);
      if (!fs.existsSync(mdPath)) {
        console.error(`!! ${mdPath} が無い`);
        process.exit(2);
      }
      const art = readArticle(mdPath);
      const outPath = outOverride ? path.resolve(outOverride) : path.join(ogDir, `${art.slug}.jpg`);
      targets.push({ ...art, outPath });
    }
  } else {
    if (outOverride) {
      console.error('!! --out は対象が1本のときだけ使える(引数なし=全件スキャンでは使えない)');
      process.exit(2);
    }
    if (!fs.existsSync(contentDir)) {
      console.log(`${contentDir} が無いので何もしない`);
      return;
    }
    const files = fs.readdirSync(contentDir).filter((f) => f.endsWith('.md'));
    for (const f of files) {
      const mdPath = path.join(contentDir, f);
      const art = readArticle(mdPath);
      const outPath = path.join(ogDir, `${art.slug}.jpg`);
      if (fs.existsSync(outPath)) continue; // 既にあるものは作り直さない
      targets.push({ ...art, outPath });
    }
  }

  if (targets.length === 0) {
    console.log('作る対象なし');
    return;
  }

  const browser = await chromium.launch({ executablePath: CHROME_EXEC, args: ['--no-sandbox'] });
  try {
    for (const t of targets) {
      const fit = await renderOne({ browser, slug: t.slug, title: t.title, theme: t.theme, themeLabels, outPath: t.outPath });
      console.log(JSON.stringify({
        slug: t.slug,
        out: t.outPath,
        文字数: t.title.length,
        フォントサイズ: fit.fontSize,
        行数: fit.lines,
        省略: fit.truncated,
        表示文字列: fit.finalText,
      }));
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error('!! 失敗:', e.message);
  process.exit(1);
});
