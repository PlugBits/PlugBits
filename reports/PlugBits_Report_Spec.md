# PlugBits 帳票SaaS（MVP）仕様書

この文書は、AI コーディングアシスタント（Codex 等）に渡して  
**帳票生成サービスの MVP 実装を開始するための仕様書** です。

---

## 1. プロジェクト概要

### 1.1 目的

- kintone のレコードデータから **PDF 帳票（見積書・請求書など）** を生成する Web サービスを作成する。
- 帳票レイアウトは Web 上の **帳票デザイナー UI**（ドラッグ＆ドロップ）で編集できる。
- PDF 生成エンジンは **pdf-lib** を使用し、Cloudflare Workers 上で動作させる。
- kintone との連携は **kintone プラグイン（PlugBits製）** を通じて行う。

### 1.2 MVP スコープ

1. **Web アプリ（フロントエンド）**
   - テンプレート一覧
   - テンプレートの新規作成／編集（ドラッグ＆ドロップ UI）
   - サンプルデータによる PDF プレビュー

2. **Cloudflare Workers（バックエンド API）**
   - テンプレ JSON ＋ レコードデータ → PDF を生成
   - `/render` と `/render-preview` の2 APIを提供

3. **kintone プラグイン**
   - レコード詳細画面に「PDF出力」ボタンを追加
   - API 呼び出し → PDF を取得 → 添付ファイルとして保存

---

## 2. 全体アーキテクチャ

### 2.1 技術構成

- Frontend：React + TypeScript（Vite または Next.js）
- Backend：Cloudflare Workers（TypeScript）
- PDF Engine：pdf-lib（日本語フォント埋込）
- Storage：Cloudflare KV（テンプレ保存）
- kintone：REST API（APIトークン）

### 2.2 データフロー

1. kintone レコードに追加された「PDF出力」ボタンを押す  
2. プラグイン JS が `/render` API を呼ぶ  
3. API が:
   - テンプレートを取得
   - kintone REST API で対象レコード取得
   - pdf-lib で PDF 生成
4. PDF バイナリを返す  
5. プラグインが添付ファイルフィールドに保存する

---

## 3. Web アプリ機能（帳票デザイナー）

### 3.1 画面一覧

- テンプレート一覧画面
- テンプレート編集画面（帳票デザイナー）
- プレビュー画面

### 3.2 テンプレート編集画面の仕様

#### 🖼 キャンバス（A4紙）
- 表示サイズ：A4縦（595 x 842 pt 相当）
- グリッドスナップ（5〜10px）
- 背景は白紙

#### 🧩 要素（ドラッグ配置可能）

| 要素種類 | 説明 |
|---------|------|
| テキスト | 固定文字 or kintone フィールド参照 |
| テーブル | サブテーブルの明細を描画 |
| 画像 | ロゴなど（MVPでは固定画像） |

#### 🛠 要素のプロパティ編集
- X / Y 座標
- 幅 / 高さ
- フォントサイズ
- 太字
- データソース指定（static / kintone / subtable）

---

## 4. テンプレート JSON 仕様

```json
{
  "id": "template_001",
  "name": "標準見積書",
  "pageSize": "A4",
  "orientation": "portrait",
  "elements": [
    {
      "id": "title",
      "type": "text",
      "x": 50,
      "y": 780,
      "fontSize": 16,
      "fontWeight": "bold",
      "dataSource": {
        "type": "static",
        "value": "御見積書"
      }
    },
    {
      "id": "customer",
      "type": "text",
      "x": 50,
      "y": 740,
      "fontSize": 12,
      "dataSource": {
        "type": "kintone",
        "fieldCode": "CustomerName"
      }
    },
    {
      "id": "items",
      "type": "table",
      "x": 40,
      "y": 600,
      "rowHeight": 18,
      "dataSource": {
        "type": "kintoneSubtable",
        "fieldCode": "Items"
      },
      "columns": [
        { "title": "品名", "width": 250, "fieldCode": "ItemName" },
        { "title": "数量", "width": 60, "fieldCode": "Qty" },
        { "title": "単価", "width": 80, "fieldCode": "UnitPrice" },
        { "title": "金額", "width": 100, "fieldCode": "Amount" }
      ],
      "maxRows": 20
    }
  ]
}
```

---

## 5. Cloudflare Workers API 仕様

### 5.1 認証
- ヘッダ：`x-api-key`

---

### 5.2 `POST /render`（本番 PDF 生成）

**リクエスト**

```json
{
  "templateId": "template_001",
  "kintone": {
    "baseUrl": "https://example.cybozu.com",
    "appId": "123",
    "recordId": "456",
    "apiToken": "xxxxx"
  }
}
```

**レスポンス**

- Content-Type: application/pdf  
- Body: PDF バイナリ

---

### 5.3 `POST /render-preview`

```json
{
  "templateId": "template_001",
  "data": {
    "CustomerName": "サンプル顧客",
    "Items": [
      { "ItemName": "部品A", "Qty": 10, "UnitPrice": 100, "Amount": 1000 }
    ]
  }
}
```

---

## 6. PDF 生成ロジック（pdf-lib）

### 6.1 ベースコード

```ts
import { PDFDocument, rgb } from "pdf-lib";
import jpFont from "./fonts/SourceHanSans-Regular.otf";

export async function renderPdf(template, data) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const font = await pdf.embedFont(jpFont);

  for (const el of template.elements) {
    if (el.type === "text") {
      const text = resolveValue(el.dataSource, data);
      page.drawText(text, {
        x: el.x,
        y: el.y,
        size: el.fontSize || 12,
        font
      });
    }

    if (el.type === "table") {
      renderTable(page, el, data, font);
    }
  }

  return await pdf.save();
}
```

---

## 7. kintone プラグイン仕様

### 7.1 設定画面

- API ベースURL
- APIキー
- テンプレートID
- 添付ファイルフィールドコード

### 7.2 動作フロー（レコード詳細）

1. 「PDF出力」ボタン追加  
2. ボタン押下 → `/render` に POST  
3. PDF を `kintone.api` のファイルアップロードで保存  
4. レコードを更新して添付フィールドに反映

---

## 8. 開発ステップ（Codex 推奨）

### フェーズ1  
- Workers に `/render` を実装（固定テンプレ）
- kintone からPDF生成ができる状態まで

### フェーズ2  
- テンプレート CRUD API 実装  
- React の帳票デザイナー UI  

### フェーズ3  
- 画像サポート  
- 改ページロジック（必要なら）  

---

## 9. 補足

- 日本語フォントは1種類でOK（ファイルサイズ抑制）
- MVPでは1ページ帳票に限定
- Workers＋pdf-lib は超軽量で運用可能

---

以上。
