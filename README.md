# PlugBits — サイト管理ガイド

kintone向けプラグイン＆ブラウザ拡張機能のマーケットプレイス。  
GitHub Pages で静的サイトとして配信。`data/products.json` を編集して `npm run build` するだけで更新できます。

---

## ディレクトリ構成

```
PlugBits/
├── data/
│   └── products.json          # 全製品データ（ここを編集する）
├── manuals/
│   ├── {slug}.ja.md           # 各プラグインの日本語マニュアル（任意）
│   └── {slug}.en.md           # 各プラグインの英語マニュアル（任意）
├── templates/
│   ├── product-ja.html        # プラグイン詳細ページ（JA）
│   ├── product-en.html        # プラグイン詳細ページ（EN）
│   ├── manual-ja.html         # マニュアルページ（JA）
│   ├── manual-en.html         # マニュアルページ（EN）
│   ├── index-ja.html          # トップページ（JA）
│   └── index-en.html          # トップページ（EN）
├── assets/
│   └── {slug}/                # 各製品の画像・動画
│       ├── hero.webp          # カード・詳細ページのメイン画像
│       └── *.png / *.mp4      # スクリーンショット・デモ動画
├── docs/
│   └── launcher/              # Launcher拡張機能のLP（独立したHTML、変更不要）
├── scripts/
│   ├── build.js               # 静的サイト生成スクリプト
│   └── add-product-from-issue.js  # GitHub Issue → products.json 追記
├── dist/                      # ビルド成果物（自動生成、編集不要）
├── style.css                  # サイト共通スタイル
└── .github/
    ├── ISSUE_TEMPLATE/
    │   └── new_product.yml    # 製品追加用 Issue フォーム
    └── workflows/
        ├── build.yml          # push → ビルド → GitHub Pages デプロイ
        └── new-product.yml    # Issue 作成 → products.json 更新 PR 自動生成
```

---

## ローカル開発

```bash
npm install
npm run build   # dist/ を生成
npm run serve   # http://localhost:8080 でプレビュー
```

---

## 製品を追加する

### 方法 A：GitHub Issue（推奨）

1. GitHub の **Issues → New issue → New product** を開く
2. フォームに必要事項を入力して Submit
3. 自動で PR が作成されるのでレビューしてマージ
4. マージ後、自動ビルドが走り GitHub Pages に反映される

> スクリーンショット（`screenshots` フィールド）は Issue 経由では設定できないため、  
> PR マージ後に `data/products.json` を直接編集して追加してください。

### 方法 B：products.json を直接編集

`data/products.json` に以下の形式でオブジェクトを追加し、`npm run build` を実行。

```json
{
  "slug": "link-button",
  "type": "plugin",
  "status": "public",
  "page_url": null,
  "install_url": "https://example.com/install",
  "hero_image": "assets/link-button/hero.webp",
  "file_size": "~15KB",
  "updated_at": "2025-03",

  "title_ja": "リンクボタン化",
  "title_en": "Link Button",
  "short_summary_ja": "URLフィールドをボタンで開けるようにします",
  "short_summary_en": "Opens URL fields as clickable buttons",
  "summary_ja": "詳細ページ用の長めの説明（160文字程度）",
  "summary_en": "Longer description for the detail page (approx. 160 chars)",
  "category_ja": "UI改善",
  "category_en": "UI Enhancement",
  "tags_ja": "リンク, ボタン",
  "tags_en": "link, button",
  "supported_screens_ja": "PC / 詳細",
  "supported_screens_en": "PC / Detail",
  "features_ja": "機能A;機能B;機能C",
  "features_en": "Feature A;Feature B;Feature C",
  "limitations_ja": "モバイル非対応",
  "limitations_en": "PC only",
  "steps_ja": [
    "1|インストール|kintone管理画面からプラグインをインストールします",
    "2|アプリに追加|対象アプリの設定画面でプラグインを有効にします",
    "3|完了|URLフィールドにボタンが表示されます"
  ],
  "steps_en": [
    "1|Install|Install the plugin from the kintone admin panel",
    "2|Add to app|Enable the plugin in the app settings",
    "3|Done|A button appears on URL fields"
  ],
  "faq_ja": [
    "モバイルで使えますか？|現在はPC専用です",
    "複数フィールドに対応していますか？|同一アプリ内の全URLフィールドに対応しています"
  ],
  "faq_en": [
    "Does it work on mobile?|PC only at this time",
    "Multiple fields supported?|Yes, all URL fields in the app are supported"
  ],
  "screenshots": [
    { "src": "assets/link-button/before.png", "caption_ja": "適用前", "caption_en": "Before" },
    { "src": "assets/link-button/after.png",  "caption_ja": "適用後", "caption_en": "After" },
    { "src": "assets/link-button/demo.mp4",   "caption_ja": "デモ",   "caption_en": "Demo" }
  ]
}
```

---

## フィールドリファレンス

### 共通フィールド

| フィールド | 必須 | 説明 |
|-----------|------|------|
| `slug` | ✅ | URL識別子（英数字とハイフン）。公開後は変更不可 |
| `type` | ✅ | `"plugin"` または `"extension"` |
| `status` | ✅ | `"public"` / `"coming-soon"` / `"unlisted"` |
| `page_url` | — | `type: extension` のみ。専用LPのパス（例: `/launcher/`）。設定すると詳細ページを生成せずLPへ直リンク |
| `install_url` | — | GitHub Releases の `.zip` URL（Brevo 自動メール内で使用） |
| `brevo_form_html` | — | Brevo 埋め込みフォームの HTML スニペット（後述） |
| `hero_image` | ✅ | カード・詳細ページのメイン画像パス（`assets/{slug}/hero.webp` 推奨） |
| `file_size` | — | ファイルサイズ（例: `~15KB`） |
| `updated_at` | — | 更新日（例: `2025-03`） |

### 多言語フィールド（`_ja` / `_en` ペア）

| フィールド | 説明 |
|-----------|------|
| `title_ja` / `title_en` | 製品名 |
| `short_summary_ja` / `short_summary_en` | カード表示用の短い説明（64文字以内） |
| `summary_ja` / `summary_en` | 詳細ページ用の説明（160文字程度） |
| `category_ja` / `category_en` | カテゴリ |
| `tags_ja` / `tags_en` | タグ（カンマ区切り） |
| `supported_screens_ja` / `supported_screens_en` | 対応画面（例: `PC / 詳細`） |
| `features_ja` / `features_en` | 機能一覧（セミコロン区切り） |
| `limitations_ja` / `limitations_en` | 制限事項（セミコロン区切り） |
| `steps_ja` / `steps_en` | 使い方ステップ（配列、各要素: `"番号\|見出し\|本文"`） |
| `faq_ja` / `faq_en` | よくある質問（配列、各要素: `"質問\|回答"`） |

### screenshots フィールド

画像パスは言語共通、キャプションのみ言語別に設定します。

```json
"screenshots": [
  { "src": "assets/{slug}/image.png", "caption_ja": "説明", "caption_en": "Caption" },
  { "src": "assets/{slug}/demo.mp4",  "caption_ja": "デモ", "caption_en": "Demo" }
]
```

- 画像: `.png` / `.webp`
- 動画: `.mp4`（同名の `.png` がサムネイルとして自動使用される）

---

## ダウンロードフロー（Brevo 連携）

ダウンロードボタンはZIPに直リンクせず、Brevo フォームを経由します。

```
ユーザーが「無料でダウンロード」をクリック
  → モーダルが開く（Brevo 埋め込みフォーム）
  → メールアドレスを入力・送信
  → Brevo が自動メールを送信（GitHub Releases の ZIP リンク含む）
  → ユーザーがメール内リンクからダウンロード
```

### Brevo 側の設定手順

1. Brevo でプラグインごとに**リスト**を作成（例：ListKit登録者）
2. **フォーム**を作成（メールアドレスのみ、対象リストに紐づける）
3. **Automation** を設定：フォーム送信 → 自動メール送信（ZIPリンクを本文に記載）
4. フォームの「**埋め込みコード**」を取得

### products.json への設定

```json
{
  "install_url": "https://github.com/henpin-box/PlugBits/releases/latest/download/link-button.zip",
  "brevo_form_html": "<div><!-- Brevoの埋め込みコードをここに1行で貼る --></div>"
}
```

> `brevo_form_html` は Brevo の埋め込みスニペット（HTML）をそのまま貼ります。  
> JSON の文字列として1行に収める必要があるため、改行は `\n` に置換してください。  
> 設定前（空の場合）はモーダルのフォームエリアが空白になります。

---

## マニュアルを追加する（プラグインのみ）

`manuals/{slug}.ja.md`（および `manuals/{slug}.en.md`）を作成するだけでOK。  
ビルド時に自動検出され、製品詳細ページに「マニュアルを見る」ボタンが表示されます。

```
manuals/
  link-button.ja.md   → /products/link-button-manual.html
  link-button.en.md   → /products/en/link-button-manual.html
```

Markdown は通常の CommonMark 記法が使えます。

---

## Launcher について

`docs/launcher/` は独立したLPです。`products.json` でメタデータ（カード表示用）を管理しますが、実際のページは `docs/launcher/index.html` をそのまま配信します。

```json
{
  "slug": "launcher",
  "type": "extension",
  "page_url": "/launcher/",
  ...
}
```

`page_url` が設定されているため、build.js は詳細ページを生成せず `/launcher/` への直リンクカードのみ生成します。

---

## デプロイ

`main` ブランチに push すると GitHub Actions が自動でビルド＆デプロイします。

```
push to main
  → .github/workflows/build.yml
  → npm run build
  → dist/ を GitHub Pages に配信
```

手動でデプロイしたい場合は GitHub Actions の **Build & Deploy Pages** から **Run workflow** を実行してください。

---

## サイト共通設定

`SUPPORT_MAIL` と `SITE_COPYRIGHT` は `scripts/build.js` の先頭で管理しています。  
変更する場合はここを編集してください。

```js
const SUPPORT_MAIL = 'support@plugbits.app';
const SITE_COPYRIGHT = '© 2025 PlugBits. All rights reserved.';
```
