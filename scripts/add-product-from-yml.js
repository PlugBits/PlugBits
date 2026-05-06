#!/usr/bin/env node
// Usage: node scripts/add-product-from-yml.js path/to/product.yml

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const ymlPath = process.argv[2];
if (!ymlPath) {
  console.error('Usage: node scripts/add-product-from-yml.js <product.yml>');
  process.exit(1);
}

function splitSemicolon(v) {
  return String(v || '').split(';').map(s => s.trim()).filter(Boolean);
}

function splitLines(v) {
  if (Array.isArray(v)) return v.map(s => String(s).trim()).filter(Boolean);
  return String(v || '').split('\n').map(s => s.trim()).filter(Boolean);
}

const src = yaml.load(fs.readFileSync(ymlPath, 'utf-8'));

if (!src.slug) {
  console.error('Error: slug is required');
  process.exit(1);
}

const dataPath = path.join(__dirname, '..', 'data', 'products.json');
const products = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

if (products.some(p => p.slug === src.slug)) {
  console.error(`Error: slug "${src.slug}" already exists`);
  process.exit(1);
}

const item = {
  slug:         src.slug,
  type:         src.type         || 'plugin',
  status:       src.status       || 'public',
  page_url:     src.page_url     || null,
  install_url:  src.install_url  || '',
  hero_image:   src.hero_image   || '',
  file_size:    src.file_size    || '',
  updated_at:   src.updated_at   || '',

  title_ja:             src.title_ja             || '',
  title_en:             src.title_en             || '',
  short_summary_ja:     src.short_summary_ja     || '',
  short_summary_en:     src.short_summary_en     || '',
  summary_ja:           src.summary_ja           || '',
  summary_en:           src.summary_en           || '',
  category_ja:          src.category_ja          || '',
  category_en:          src.category_en          || '',
  tags_ja:              src.tags_ja              || '',
  tags_en:              src.tags_en              || '',
  supported_screens_ja: src.supported_screens_ja || '',
  supported_screens_en: src.supported_screens_en || '',
  features_ja:          src.features_ja          || '',
  features_en:          src.features_en          || '',
  limitations_ja:       src.limitations_ja       || '',
  limitations_en:       src.limitations_en       || '',
  steps_ja:             splitLines(src.steps_ja),
  steps_en:             splitLines(src.steps_en),
  faq_ja:               splitLines(src.faq_ja),
  faq_en:               splitLines(src.faq_en),
  screenshots:          [],
};

products.push(item);
fs.writeFileSync(dataPath, JSON.stringify(products, null, 2));
console.log(`Appended: ${item.slug}`);
