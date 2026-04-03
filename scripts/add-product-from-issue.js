const fs = require('fs');
const path = require('path');

function splitLines(s) {
  return String(s || '').split('\n').map(v => v.trim()).filter(Boolean);
}

// ラベル → キーの正規化（括弧内・記号を除去し、英数アンダースコアに）
function canonKey(label) {
  return String(label || '')
    .replace(/\(.*?\)/g, '')
    .replace(/[:：]/g, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// Issue Forms 本文「### {Label}\n{value}」形式をパース
function parseIssueBody(body) {
  const map = {};
  const parts = String(body || '').split(/\n(?=###\s)/g);
  for (const block of parts) {
    const m = block.match(/^###\s+([^\n]+)\n([\s\S]*)$/);
    if (!m) continue;
    const key = canonKey(m[1].trim());
    let val = (m[2] || '').trim();
    if (/^_no response_$/i.test(val)) val = '';
    map[key] = val;
  }
  return map;
}

function pick(f, name) {
  if (name in f) return f[name];
  const k = Object.keys(f).find(k => k === name || k.startsWith(name + '_'));
  return k ? f[k] : '';
}

function main() {
  const body = process.env.ISSUE_BODY || '';
  const dataPath = path.join(__dirname, '..', 'data', 'products.json');
  const products = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

  const f = parseIssueBody(body);

  const slug = pick(f, 'slug');
  if (!slug) throw new Error('slug is required');
  if (products.some(p => p.slug === slug)) throw new Error(`slug "${slug}" already exists`);

  const item = {
    slug,
    type:        pick(f, 'type') || 'plugin',
    status:      pick(f, 'status') || 'public',
    page_url:    pick(f, 'page_url') || null,
    install_url: pick(f, 'install_url'),
    hero_image:  pick(f, 'hero_image'),
    file_size:   pick(f, 'file_size'),
    updated_at:  pick(f, 'updated_at'),

    title_ja:            pick(f, 'title_ja'),
    title_en:            pick(f, 'title_en'),
    short_summary_ja:    pick(f, 'short_summary_ja'),
    short_summary_en:    pick(f, 'short_summary_en'),
    summary_ja:          pick(f, 'summary_ja'),
    summary_en:          pick(f, 'summary_en'),
    category_ja:         pick(f, 'category_ja'),
    category_en:         pick(f, 'category_en'),
    tags_ja:             pick(f, 'tags_ja'),
    tags_en:             pick(f, 'tags_en'),
    supported_screens_ja: pick(f, 'supported_screens_ja'),
    supported_screens_en: pick(f, 'supported_screens_en'),
    features_ja:         pick(f, 'features_ja'),
    features_en:         pick(f, 'features_en'),
    limitations_ja:      pick(f, 'limitations_ja'),
    limitations_en:      pick(f, 'limitations_en'),
    steps_ja:            splitLines(pick(f, 'steps_ja')),
    steps_en:            splitLines(pick(f, 'steps_en')),
    faq_ja:              splitLines(pick(f, 'faq_ja')),
    faq_en:              splitLines(pick(f, 'faq_en')),
    screenshots:         [],  // Issue 経由では空、後から手動で追加
  };

  products.push(item);
  fs.writeFileSync(dataPath, JSON.stringify(products, null, 2));
  console.log('Appended:', item.slug);
}

main();
