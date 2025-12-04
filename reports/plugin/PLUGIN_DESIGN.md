# PlugBits for kintone プラグイン設計メモ

## 目的
- kintone レコード詳細画面に "PlugBits PDF 出力" ボタンを配置し、Cloudflare Workers 上の `/render` API を叩いて PDF 帳票を作成。
- 生成した PDF を添付ファイルフィールドへアップロードし、レコードに保存する。

## 構成
```
plugin/
├─ manifest/             # プラグインパッケージ用ルート
│  ├─ manifest.json      # API へ登録するマニフェスト
│  ├─ images/icon.png
│  └─ src/
│     ├─ html/config.html
│     ├─ css/kb-shell.css
│     └─ js/desktop.js & config.js （build でコピー）
├─ src/
│  ├─ desktop/index.ts   # レコード詳細画面のロジック
│  ├─ config/index.ts    # プラグイン設定画面ロジック
│  └─ types/global.d.ts  # window.kintone などの型宣言
├─ package.json          # build/pack スクリプト
├─ copy-dist.js          # dist -> manifest/src/js コピー
└─ dist/                 # esbuild 出力（.gitignore）
```

## 設定画面（config）
- 読み込みイベント: `kintone.events.on('app.plugin.settings.show', renderForm)`
- 項目:
  - API ベース URL (`apiBaseUrl`)
  - API キー (`apiKey`)
  - kintone APIトークン (`kintoneApiToken`)
  - テンプレートID (`templateId`)
  - 添付ファイルフィールドコード (`attachmentFieldCode`)
- `setConfig(payload)` で登録。
- バリデーション: 空欄がある場合は `alert('必須項目が未入力です')`。APIキー/トークンも必須。

## レコード詳細（desktop）
仮実装：ボタンをスペースまたはツールバーに追加し、クリックで設定値を alert するだけ。
本実装案:
1. レコード詳細イベント `app.record.detail.show` で発火。
2. 設定値を `kintone.plugin.app.getConfig($PLUGIN_ID)` から取得。未設定なら警告。
3. ボタン押下で以下を実行:
   - トースト用のスタイルを注入し、スピナー表示 or ボタン disable。
   - Worker `/render` へ `templateId` と kintone REST API 連携情報をPOST。`x-api-key` に Worker API キー、ボディに `kintone.apiToken` を渡す。
   - 返却された PDF バイナリを kintone REST API `file/upload.json` で添付アップロード。
   - レコード更新 API を呼び出し、`attachmentFieldCode` へファイルKeyを設定。
   - 成功時/失敗時ともトーストでユーザーに通知。
   - 設定未入力時はツールバーに警告バナーを表示する。

必要な API 情報:
- `file/upload.json` でファイルを添付（CSRFトークン or APIトークン）。
- `record` 更新 API で添付フィールドを差し替え。
- Worker `/render` は x-api-key のみ。

## ビルド / Pack 手順
1. `npm install`
2. `npm run build`
3. `npm run pack`
   - `copy-dist.js` により `dist/*.js` が manifest 直下へコピーされる
   - `signing/plugbits-reports.ppk` を使って `npx kintone-plugin-packer manifest --out dist/plugin.zip --ppk signing/plugbits-reports.ppk`
   - PPK はリポジトリ管理し、同じプラグインIDを継続利用する

## TODO
- 設定画面の詳細なヘルプテキストや入力例の追加
- Worker/kintone 認証エラー時の再試行/ログ手段の検討
- プラグイン README / 導入手順の追記
