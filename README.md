# Kintone向けミニプラグイン販売サイト

Kintone標準機能に「あと一歩」の便利機能を追加するミニプラグイン販売サイトです。GitHub Pagesでホスティング可能な静的サイト構成になっています。

## 📁 プロジェクト構成

```
├── index.html              # メインページ（トップ）
├── products.json           # 商品データ（JSON）
├── products/              # 個別商品ページ
│   ├── subtable-sort.html  # サブテーブル並び替え詳細
│   └── copy-field.html     # フィールドコピー詳細
├── style.css              # 統一デザインシステム
├── app.js                 # メインスクリプト
├── assets/                # 画像・素材
│   └── placeholder.svg     # プレースホルダー画像
├── sitemap.xml            # サイトマップ
├── robots.txt             # クローラー設定
└── README.md              # このファイル
```

## 🚀 GitHub Pagesでのデプロイ手順

### 1. リポジトリの作成・プッシュ

```bash
# 新しいリポジトリを作成（GitHubで事前に作成済みの場合）
git init
git add .
git commit -m "Initial commit: Kintone plugin store site"
git branch -M main
git remote add origin https://github.com/yourusername/your-repo-name.git
git push -u origin main
```

### 2. GitHub Pagesの有効化

1. GitHubのリポジトリページに移動
2. `Settings` タブをクリック
3. 左メニューから `Pages` を選択
4. `Source` で `Deploy from a branch` を選択
5. `Branch` で `main` と `/ (root)` を選択
6. `Save` をクリック

### 3. 公開URL

デプロイ後、以下のURLでアクセス可能になります：
```
https://yourusername.github.io/your-repo-name/
```

## 🛠 商品追加方法

### 新商品の追加手順

1. **商品データの追加**
   - `products.json` に新商品のデータを追加

```json
{
  "slug": "new-plugin",
  "title": "新しいプラグイン名",
  "price": 500,
  "summary": "一行でプラグインの機能説明",
  "tags": ["タグ1", "タグ2", "タグ3"],
  "image": "assets/placeholder.svg",
  "storesUrl": "https://stores.jp/example/new-plugin",
  "screens": "PC / 対応画面",
  "features": ["機能1", "機能2", "機能3"],
  "limitations": ["制限事項1"],
  "faq": [
    {"q": "質問", "a": "回答"}
  ]
}
```

2. **個別ページの作成**
   - `products/new-plugin.html` を作成
   - 既存ページ（`subtable-sort.html` など）をコピーしてslugを変更

3. **サイトマップの更新**
   - `sitemap.xml` に新商品ページのURLを追加

### 商品画像の変更方法

1. 新しい画像を `assets/` フォルダに配置
2. `products.json` の `image` フィールドを更新
3. 推奨サイズ：300x200px、形式：SVG、PNG、JPG

## 🎨 デザインカスタマイズ

### テーマ色の変更

`style.css` の CSS変数を編集：

```css
.kb-root {
  --kb-primary: #3498db;    /* メインカラー */
  --kb-surface: #fff;       /* カード背景 */
  --kb-text: #23272a;       /* テキスト色 */
  /* その他の色設定... */
}
```

### ダークテーマの使用

HTMLの `data-kb-theme` 属性を変更：

```html
<div class="kb-root" data-kb-theme="soft-dark">
```

## 📊 分析・トラッキング

### Cloudflare Web Analytics

1. Cloudflareでアカウント作成
2. Web Analyticsのトラッキングコードを取得
3. `index.html` のコメント部分に貼り付け：

```html
<!-- Cloudflare Web Analytics script tag here -->
<script defer src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{"token": "your-token"}'></script>
```

### Google Analytics（オプション）

`app.js` のトラッキング関数が Google Analytics に対応済み。
`gtag` が読み込まれていれば自動で購入・詳細クリックが追跡されます。

## 🔧 開発・テスト

### ローカル開発サーバー

```bash
# Python 3の場合
python -m http.server 8000

# Node.jsの場合
npx serve .

# PHPの場合
php -S localhost:8000
```

### ファイル構造のチェック

```bash
# 必要なファイルが揃っているか確認
ls -la
ls -la products/
ls -la assets/
```

## 🔒 セキュリティ・パフォーマンス

- 外部ライブラリ不使用で軽量
- XSS対策済み（innerHTML使用箇所でサニタイズ）
- CSPヘッダー推奨（GitHub Pagesで設定可能）
- 画像最適化済み（SVG使用）

## 🐛 トラブルシューティング

### よくある問題

1. **商品が表示されない**
   - `products.json` の構文エラーチェック
   - ブラウザのコンソールでエラー確認

2. **スタイルが適用されない**
   - `style.css` のパス確認
   - `.kb-root` クラスが設定されているか確認

3. **個別ページでデータが表示されない**
   - 商品の `slug` とファイル名が一致しているか確認
   - `../products.json` のパス確認

### ログの確認

ブラウザの開発者ツール（F12）のコンソールでエラーメッセージを確認してください。

## 📝 ライセンス

このプロジェクトは商用利用可能です。ただし：

- Kintone は サイボウズ株式会社の商標です
- 実際の商品販売時は適切な利用規約・プライバシーポリシーを設定してください
- STORESのURLは実際の販売ページに変更してください

## 📞 サポート

このサイトテンプレートに関する質問は、GitHubのIssuesでお願いします。