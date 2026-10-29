// ~/vault/PlugBits/shorts/posted.md と queue/<slug>/post.json から data/shorts.json を作る。
// 使い方: node tools/shorts-json.mjs  (SHORTS_POSTED / SHORTS_QUEUE で場所を上書き可)
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const posted = process.env.SHORTS_POSTED || path.join(os.homedir(), 'vault/PlugBits/shorts/posted.md');
const queue = process.env.SHORTS_QUEUE || path.join(os.homedir(), 'vault/PlugBits/shorts/queue');
const out = path.join(root, 'data', 'shorts.json');

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
    if (j.title) e.title = j.title;
  } catch {}
}
const list = [...bySlug.values()].sort((a, b) => b.date.localeCompare(a.date) || b.slug.localeCompare(a.slug));
fs.writeFileSync(out, JSON.stringify(list, null, 2) + '\n');
console.log(`shorts.json: ${list.length} item(s)`);
