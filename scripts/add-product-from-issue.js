const fs = require('fs');
const path = require('path');

function splitLines(s){ return String(s||'').split('\n').map(v=>v.trim()).filter(Boolean); }

// ラベル → キーの正規化（括弧内や記号を除去し、英数アンダースコアに）
function canonKey(label){
  return String(label || '')
    .replace(/\(.*?\)/g, '')         // () 内を除去 例: "slug (英数字…)" → "slug "
    .replace(/[:：]/g, ' ')          // コロン系もスペース化
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')     // 非英数字 → _
    .replace(/^_+|_+$/g, '');        // 先頭/末尾の _ を削除
}

// Issue Forms は本文に「### {Label}\n{value}」で落ちる。
// _No response_ は未入力なので空扱いにする。
function parseIssueBody(body){
  const map = {};
  const parts = String(body||'').split(/\n(?=###\s)/g);
  for(const block of parts){
    const m = block.match(/^###\s+([^\n]+)\n([\s\S]*)$/);
    if(!m) continue;
    const label = m[1].trim();
    const key = canonKey(label);    // ← 正規化キー
    let val = (m[2]||'').trim();
    if(/^_no response_$/i.test(val)) val = '';  // フォーム未入力
    map[key] = val;
  }
  return map;
}

function toArrayMaybe(s){ return splitLines(s); }

function main(){
  const body = process.env.ISSUE_BODY || '';
  const dataPath = path.join(__dirname, '..', 'data', 'products.json');
  const products = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

  const f = parseIssueBody(body);

  // 主要キーのエイリアス吸収（念のため prefix マッチでも拾う）
  const pick = (name) => {
    if (name in f) return f[name];
    const k = Object.keys(f).find(k => k === name || k.startsWith(name + '_'));
    return k ? f[k] : '';
  };

  const slug = pick('slug');
  if(!slug) throw new Error('slug is required');

  if(products.some(p => p.slug === slug)){
    throw new Error(`slug "${slug}" already exists`);
  }

  const item = {
    slug,
    purchase_url: pick('purchase_url'),
    purchase_url_jpy: pick('purchase_url_jpy'),
    purchase_url_usd: pick('purchase_url_usd'),
    price_jpy: pick('price_jpy'),
    price_usd: pick('price_usd'),
    hero_image: pick('hero_image'),

    title_ja: pick('title_ja'),
    summary_ja: pick('summary_ja'),
    tags_ja: pick('tags_ja'),
    features_ja: pick('features_ja'),
    screenshots_ja: pick('screenshots_ja'),
    steps_ja: toArrayMaybe(pick('steps_ja')),
    limitations_ja: pick('limitations_ja'),
    faq_ja: toArrayMaybe(pick('faq_ja')),
    supported_screens_ja: pick('supported_screens_ja'),
    category_ja: pick('category_ja'),
    file_size_ja: pick('file_size_ja'),
    updated_at_ja: pick('updated_at_ja'),

    title_en: pick('title_en'),
    summary_en: pick('summary_en'),
    tags_en: pick('tags_en'),
    features_en: pick('features_en'),
    screenshots_en: pick('screenshots_en'),
    steps_en: toArrayMaybe(pick('steps_en')),
    limitations_en: pick('limitations_en'),
    faq_en: toArrayMaybe(pick('faq_en')),
    supported_screens_en: pick('supported_screens_en'),
    category_en: pick('category_en'),
    file_size_en: pick('file_size_en'),
    updated_at_en: pick('updated_at_en'),

    // 既存データから共通値を継承
    support_mail: products[0]?.support_mail || 'support@example.com',
    site_copyright: products[0]?.site_copyright || ''
  };

  products.push(item);
  fs.writeFileSync(dataPath, JSON.stringify(products, null, 2));
  console.log('Appended:', item.slug);
}

main();
