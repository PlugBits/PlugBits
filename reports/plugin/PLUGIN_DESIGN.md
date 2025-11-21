# PlugBits for kintone プラグイン設計メモ

## 目的
- kintone レコード詳細画面に "PlugBits PDF 出力" ボタンを配置し、Cloudflare Workers 上の `/render` API を叩いて PDF 帳票を作成。
- 生成した PDF を添付ファイルフィールドへアップロードし、レコードに保存する。

## 構成
```
plugin/
├─ manifest/             # プラグインパッケージ用ルート
│  ├─ manifest.json      # icon / dist 参照込みのマニフェスト
│  ├─ dist/desktop.js    # レコード詳細スクリプト
│  ├─ dist/config.js     # 設定画面スクリプト
│  ├─ config.html        # 設定画面HTML
│  └─ images/icon.png
├─ src/
│  ├─ desktop/index.ts   # レコード詳細画面のロジック
│  ├─ config/index.ts    # プラグイン設定画面ロジック
│  └─ types/global.d.ts  # window.kintone などの型宣言
├─ package.json          # build/pack スクリプト
├─ copy-dist.js          # dist -> manifest/dist コピー
└─ dist/                 # esbuild 出力
```

## 設定画面（config）
- 読み込みイベント: `kintone.events.on('app.plugin.settings.show', renderForm)`
- 項目:
  - API ベース URL (`apiBaseUrl`)
  - API キー (`apiKey`)
  - テンプレートID (`templateId`)
  - 添付ファイルフィールドコード (`attachmentFieldCode`)
- `setConfig(payload)` で登録。
- バリデーション: 空欄がある場合は `alert('必須項目が未入力です')`。

## レコード詳細（desktop）
仮実装：ボタンをスペースまたはツールバーに追加し、クリックで設定値を alert するだけ。
本実装案:
1. レコード詳細イベント `app.record.detail.show` で発火。
2. 設定値を `kintone.plugin.app.getConfig($PLUGIN_ID)` から取得。未設定なら警告。
3. ボタン押下で以下を実行:
   - スピナー表示 or ボタン disable。
   - Worker `/render` へ `templateId` と kintone REST API 連携情報をPOST。
   - 返却された PDF バイナリを kintone REST API `file/upload.json` で添付アップロード。
   - レコード更新 API を呼び出し、`attachmentFieldCode` へファイルKeyを設定。
   - 成功時は通知（alert / toastなど）。
   - 失敗時はエラーメッセージ表示。

必要な API 情報:
- `file/upload.json` でファイルを添付（CSRFトークン or APIトークン）。
- `record` 更新 API で添付フィールドを差し替え。
- Worker `/render` は x-api-key のみ。

## ビルド / Pack 手順
1. `npm install`
2. `npm run build`
3. `npm run pack`
   - `copy-dist.js` により `dist/*.js` が manifest 直下へコピーされる
   - `npx kintone-plugin-packer manifest --out dist/plugin.zip`

## TODO
- `/render` 呼び出し & 添付処理実装
- ボタンUI/メッセージ整備
- 設定画面の詳細なバリデーション/ヘルプ
- pack 時の署名用PPK 対応（必要なら）
