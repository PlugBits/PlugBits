#!/usr/bin/env node
// ブログ記事の og:image(1200x630)を記事ごとに作る(2026-10-17、担当H)。
//
// 題材: tools/og/blog-og.html(見た目のテンプレ)を playwright で開き、
// #eyebrow / #theme-label / #title の中身を記事の frontmatter で書き換えてから撮る。
// 題名は最大3行。はみ出す時は文字を詰め(フォントサイズを下げ)、それでも収まらない
// 最後の手段として末尾を … で切る(blog-og.html 側のコメント参照)。
//
// playwright の在りか(install はしていない。探して見つけた既存のものを使う):
//   playwright-core 本体: ~/tiny-pulse-next/tools/pdf/node_modules/playwright-core (v1.63.0)
//     (tools/shot.mjs と同じ createRequire の手口で、そのディレクトリから解決する)
//   Chromium 実行体    : ~/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome
//   不足する共有ライブラリ: ~/tiny-pulse-next/tools/native-libs (LD_LIBRARY_PATH に足す。
//     shot.mjs と同じ。これが無いと headless chromium が libnss3.so 等で起動に失敗する)
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
//
// 共通オプション:
//   --out <path>   出力先を1枚だけ差し替える(対象が1本のときだけ有効。本番の
//                  assets/blog/og/ を汚さずに試すため)
//   --content-dir <dir>  content/blog の代わりに読むディレクトリ(既定: content/blog)
//   --og-dir <dir>       assets/blog/og の代わりに書くディレクトリ(既定: assets/blog/og)

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(HERE, '..', '..'); // tools/og -> リポジトリ直下

const nodeRequire = createRequire(import.meta.url);
const yaml = nodeRequire('js-yaml');

// playwright-core は tiny-pulse-next 側の node_modules から借りる(install しない)
const PW_ANCHOR = path.join(os.homedir(), 'tiny-pulse-next', 'tools', 'pdf', 'x.js');
const pwRequire = createRequire(PW_ANCHOR);
const { chromium } = pwRequire('playwright-core');

const CHROME_EXEC = path.join(os.homedir(), '.cache', 'ms-playwright', 'chromium-1243', 'chrome-linux64', 'chrome');
const NATIVE_LIBS = path.join(os.homedir(), 'tiny-pulse-next', 'tools', 'native-libs');
process.env.LD_LIBRARY_PATH = NATIVE_LIBS + ':' + (process.env.LD_LIBRARY_PATH || '');

const TEMPLATE_PATH = path.join(HERE, 'blog-og.html');

// 既定のテーマ名(data/blog-themes.json が無い/足りない時のフォールバック。
// 値は CONTRACT.md §OGP画像 の例と揃えてある。G1 が data/blog-themes.json を
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
    deviceScaleFactor: 2,
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
  // JPEG(品質 85)。PNG だと 1 枚 1.2MB あり、公開リポに毎日積むと重い(rc 10/17)
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

  // --xxx とその値を除いた残りを slug 引数として扱う
  const flags = new Set(['out', 'md', 'content-dir', 'og-dir']);
  const slugArgs = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      if (flags.has(a.slice(2))) i++; // 値をスキップ
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
