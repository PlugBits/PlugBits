# Cloud Run Renderer Phase 1

## 追加ディレクトリ

- `renderer/`
- `renderer/assets/fonts/`
- `renderer/src/`

## 追加 env

### Worker

- `RENDER_MODE=local|remote`
- `RENDERER_BASE_URL`
- `RENDERER_INTERNAL_TOKEN`
- `RENDERER_REQUEST_TIMEOUT_MS=120000`
- `RENDERER_VERSION`

### Cloud Run renderer

- `PORT`
- `RENDERER_INTERNAL_TOKEN`
- `RENDERER_VERSION`
- `WORKER_INTERNAL_BASE_URL`
- `WORKER_INTERNAL_TOKEN`
- `WORKER_INTERNAL_TIMEOUT_MS=120000`

## errorCode

- `INVALID_PAYLOAD`
- `UNAUTHORIZED_RENDERER_CALL`
- `TEMPLATE_LOAD_FAILED`
- `BACKGROUND_FETCH_FAILED`
- `FONT_LOAD_FAILED`
- `RENDER_FAILED`
- `UPLOAD_FAILED`
- `RENDERER_HTTP_FAILED`
- `RENDERER_TIMEOUT`
- `FILE_NOT_READY`
- `JOB_NOT_FOUND`

## Worker 側の新しい責務

- `/render-jobs`
  `queued -> running -> done|failed` の job state を KV に保持
- `/render-jobs/:id`
  status, `pdfKey`, `pdfBytes`, `renderMs`, `errorCode` を返却
- `/render-jobs/:id/file`
  完成 PDF を返却
- `/internal/render-assets`
  renderer 用 background fetch
- `/internal/render-jobs/:id/file`
  renderer 用 PDF upload

## Cloud Run renderer エンドポイント

- `POST /internal/render`

入力:

- `jobId`
- `template`
- `data`
- `assets.backgroundKey`
- `assets.tenantLogo`
- `assets.pdfKey`
- `meta.tenantId`
- `meta.templateId`
- `meta.templateRevision`
- `meta.rendererVersion`
- `options.useJpFont`

出力:

- `ok`
- `jobId`
- `pdfKey`
- `pdfBytes`
- `renderMs`
- `rendererVersion`

## 初期デプロイ手順

1. Worker に `RENDER_MODE=remote` と renderer 用 env を設定する
2. renderer を Cloud Run にデプロイする
3. renderer 側に `WORKER_INTERNAL_BASE_URL` と `WORKER_INTERNAL_TOKEN` を設定する
4. Worker と renderer の `RENDERER_INTERNAL_TOKEN` / `WORKER_INTERNAL_TOKEN` を同じ secret にそろえる
5. `estimate_v1` の background PDF が既に R2 にあることを確認する

## Cloud Run 例

```bash
cd renderer
npm install
npm run build
gcloud run deploy plugbits-reports-renderer \
  --source . \
  --region asia-northeast1 \
  --allow-unauthenticated=false \
  --set-env-vars RENDERER_VERSION=v1
```

## ローカル検証

1. Worker は `wrangler dev` で起動する
2. renderer は `cd renderer && npm install && npm run build && npm start`
3. Worker を `RENDER_MODE=remote` にして `POST /render-jobs`
4. `GET /render-jobs/:id`
5. `GET /render-jobs/:id/file`
6. 確認対象は `estimate_v1`

## 確認項目

- 日本語タイトル
- 見積番号
- 発行日
- 明細テーブル
- 合計
- background PDF 合成
- R2 保存
- file API 取得

## 未対応

- `/render` `/render-preview` 全体を remote engine に統一する段階までは未着手
- renderer から R2 直書きする実装は未着手
- `bizud` フォントは未同梱のため初期実装では `noto` にフォールバック
- D1 への切り替えは未着手
- 全テンプレートの互換テストは未着手
