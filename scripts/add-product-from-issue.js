const fs = require('fs');
const path = require('path');

function splitLines(s){ return String(s||'').split('\n').map(v=>v.trim()).filter(Boolean); }

// Issue Forms は本体に「### {Label}\n{value}」の並びで落ちてくる
function parseIssueBody(body){
  const map = {};
  const parts = String(body).split(/\n(?=###\s)/g);
  for(const block of parts){
    const m = block.match(/^###\s+([^\n]+)\n([\s\S]*)$/);
    if(!m) continue;
    const key = m[1].trim().toLowerCase().replace(/\s+/g,'_'); // label → key
    const val = m[2].trim();
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

  // 必須チェック（slug重複はPR化せずに失敗させる）
  if(!f.slug) throw new Error('slug is required');
  if(products.some(p => p.slug === f.slug)){
    throw new Error(`slug "${f.slug}" already exists`);
  }

  const item = {
    slug: f.slug,
    purchase_url: f.purchase_url,
    price_jpy: f.price_jpy,
    price_usd: f.price_usd,
    hero_image: f.hero_image,

    title_ja: f.title_ja,
    summary_ja: f.summary_ja,
    tags_ja: f.tags_ja,
    features_ja: f.features_ja,
    screenshots_ja: f.screenshots_ja,
    steps_ja: toArrayMaybe(f.steps_ja),
    limitations_ja: f.limitations_ja,
    faq_ja: toArrayMaybe(f.faq_ja),
    supported_screens_ja: f.supported_screens_ja,
    category_ja: f.category_ja,
    file_size_ja: f.file_size_ja,
    updated_at_ja: f.updated_at_ja,

    title_en: f.title_en,
    summary_en: f.summary_en,
    tags_en: f.tags_en,
    features_en: f.features_en,
    screenshots_en: f.screenshots_en,
    steps_en: toArrayMaybe(f.steps_en),
    limitations_en: f.limitations_en,
    faq_en: toArrayMaybe(f.faq_en),
    supported_screens_en: f.supported_screens_en,
    category_en: f.category_en,
    file_size_en: f.file_size_en,
    updated_at_en: f.updated_at_en,

    // 既存データから継承（サイト共通値）
    support_mail: products[0]?.support_mail || 'support@example.com',
    site_copyright: products[0]?.site_copyright || ''
  };

  products.push(item);
  fs.writeFileSync(dataPath, JSON.stringify(products, null, 2));
  console.log('Appended:', item.slug);
}

main();
