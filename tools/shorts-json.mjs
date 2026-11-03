// ~/vault/PlugBits/shorts/posted.md の ok 行から data/shorts.json を作る(自動投稿分の漏れ防止)。
// 題は 今の shorts.json(手で直した本番の題)→ posts/<日付>_<slug>/final-*-youtube-*.txt の「## 題」→ queue/<slug>/post.json → slug の順。#Shorts は外す。
// 使い方: node tools/shorts-json.mjs  (SHORTS_POSTED / SHORTS_QUEUE / SHORTS_POSTS で場所を上書き可)
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const posted = process.env.SHORTS_POSTED || path.join(os.homedir(), 'vault/PlugBits/shorts/posted.md');
const queue = process.env.SHORTS_QUEUE || path.join(os.homedir(), 'vault/PlugBits/shorts/queue');
const posts = process.env.SHORTS_POSTS || path.join(os.homedir(), 'vault/PlugBits/shorts/posts');
const out = path.join(root, 'data', 'shorts.json');
const stripShorts = t => t.replace(/\s*#Shorts\b/gi, '').trim();
const prevTitle = new Map();
try { for (const e of JSON.parse(fs.readFileSync(out, 'utf-8'))) if (e.slug && e.title) prevTitle.set(e.slug, e.title); } catch {}
const titleFromPosts = slug => {
  if (!fs.existsSync(posts)) return null;
  for (const d of fs.readdirSync(posts).filter(d => d.endsWith('_' + slug)).sort().reverse()) {
    const dir = path.join(posts, d);
    for (const f of fs.readdirSync(dir).filter(f => /^final-.*-youtube-.*\.txt$/.test(f))) {
      const m = /^## 題\s*\n+\s*(.+)$/m.exec(fs.readFileSync(path.join(dir, f), 'utf-8'));
      if (m) return stripShorts(m[1]);
    }
  }
  return null;
};

const bySlug = new Map();
const lines = fs.existsSync(posted) ? fs.readFileSync(posted, 'utf-8').split('\n') : [];
for (const line of lines) {
  if (!line.trim().startsWith('|')) continue;
  const c = line.trim().replace(/^\||\|$/g, '').split('|').map(s => s.trim());
  if (c.length < 5) continue;
  const [when, slug, target, url, result] = c;
  if (!result.startsWith('ok')) continue;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(when);
  if (!m || !slug) continue;
  const e = bySlug.get(slug) || { slug, title: slug, date: m[1], x: null, youtube: null };
  if (m[1] < e.date) e.date = m[1];
  const u = /^https?:\/\//.test(url) ? url : null;
  if (/^x$|twitter/i.test(target) && u) e.x = e.x || u;
  else if (/youtube|yt/i.test(target) && u) e.youtube = e.youtube || u;
  bySlug.set(slug, e);
}
for (const e of bySlug.values()) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(queue, e.slug, 'post.json'), 'utf-8'));
    if (j.title) e.title = stripShorts(j.title);
  } catch {}
  e.title = prevTitle.get(e.slug) || titleFromPosts(e.slug) || e.title;
  if (!e.x) delete e.x;   // 無い鍵は入れない(空・null にしない)
  if (!e.youtube) delete e.youtube;
}
const list = [...bySlug.values()].sort((a, b) => b.date.localeCompare(a.date) || b.slug.localeCompare(a.slug));
fs.writeFileSync(out, JSON.stringify(list, null, 2) + '\n');
console.log(`shorts.json: ${list.length} item(s)`);
