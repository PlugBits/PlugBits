はい。
**Cloud Run で PDF 生成を担う方向**で、PlugBits Reports 前提の構想を一度きれいにまとめます。

今の土台はすでに、

* Cloudflare Workers が `/render` 系 API を持っている 
* テンプレートは KV 保存、kintone プラグインから呼ぶ構成になっている 
* 背景 PDF は `/backgrounds/build` で事前生成して R2 に保存する流れがある 
* 日本語フォントは `subset:true` で文字化けし、`subset:false` が必要という制約が判明している 

ので、**全面作り直しではなく「レンダリング部分だけ Cloud Run に分離」**が一番自然です。

---

## 結論

おすすめは **ハイブリッド構成** です。

* **Cloudflare Pages / Workers**
  UI、認証、テンプレ管理、ジョブ受付、進捗確認、R2 返却
* **Cloud Run Render Service**
  重い PDF 生成本体
* **R2**
  生成済み PDF、背景 PDF、フォント、将来的な中間成果物
* **KV / D1**
  ジョブ状態、テンプレメタ、レンダラバージョン、失敗理由

この形なら、今の資産を活かしつつ、**CPU が重い日本語 PDF 生成だけを Cloud Run 側へ逃がせます**。

Cloud Run はコンテナ実行なので、CPU・メモリ・タイムアウト・同時実行数を明示的に調整できます。既定の同時実行数は 80 で、最大 1000 まで設定可能ですが、CPU ヘビーな帳票生成ではむしろ **低 concurrency に抑える**のが定石です。CPU は既定 1 vCPU、メモリも設定可能で、リクエスト timeout も設定できます。 ([Google Cloud Documentation][1])

---

## 目指す全体像

### 1. ユーザー体験

ユーザーは今まで通り、

* kintone で「PDF 出力」
* すぐレスポンス
* 数秒後に完了
* 完成 PDF をダウンロード or 添付保存

という流れです。

ただし裏側は、**その場で Workers が PDF を作るのではなく**、

* Workers がジョブ受付
* Cloud Run がレンダ
* 完成物を R2 へ保存
* Workers が結果を返す

に変わります。

---

## 推奨アーキテクチャ

```text
kintone Plugin / Web UI
        ↓
Cloudflare Workers
  - auth
  - template fetch
  - job create
  - status API
  - signed download URL
        ↓
   Render Queue / Job Record
        ↓
Cloud Run Render Service
  - template normalize
  - font load
  - background merge
  - pdf-lib render
  - result upload to R2
        ↓
R2 / D1 / KV
```

---

## 役割分担

### Cloudflare Workers 側に残すもの

これは軽くて相性が良いです。

* `POST /render-jobs`
* `GET /render-jobs/:id`
* `GET /render-jobs/:id/file`
* テンプレ取得
* kintone セッション情報との紐付け
* API Key / tenant 判定
* R2 署名 URL 発行
* エラー整形

### Cloud Run 側に移すもの

ここが本丸です。

* `pdf-lib` 実行
* `fontkit` 実行
* 日本語フォント埋め込み
* 背景 PDF 合成
* テーブル描画
* 複数ページ処理
* 将来の別レンダラ実験

---

## API 設計の最小構成

### Workers 公開 API

#### `POST /render-jobs`

ジョブ作成

入力例

```json
{
  "templateId": "tpl_xxx",
  "data": { "...": "..." },
  "output": {
    "filename": "estimate_123.pdf"
  },
  "kintone": {
    "baseUrl": "https://xxx.kintone.com",
    "appId": 125,
    "recordId": 456
  }
}
```

返却例

```json
{
  "jobId": "job_xxx",
  "status": "queued"
}
```

#### `GET /render-jobs/:id`

状態確認

返却例

```json
{
  "jobId": "job_xxx",
  "status": "running",
  "progress": 60
}
```

完了時

```json
{
  "jobId": "job_xxx",
  "status": "done",
  "fileUrl": "..."
}
```

#### `GET /render-jobs/:id/file`

完成 PDF 取得

---

### Cloud Run 内部 API

#### `POST /internal/render`

Workers からのみ呼ぶ内部エンドポイント

入力例

```json
{
  "jobId": "job_xxx",
  "template": { "...": "..." },
  "data": { "...": "..." },
  "assets": {
    "backgroundKey": "backgrounds/tpl_xxx.pdf",
    "fontPolicy": {
      "jp": "noto-jp-main",
      "latin": "roboto-main"
    }
  },
  "meta": {
    "tenantId": "tenant_xxx",
    "templateRevision": 12,
    "rendererVersion": "v1"
  }
}
```

Cloud Run はこの payload を受けて PDF を生成し、R2 に保存して、ジョブ状態を更新します。

---

## ジョブ状態

状態はこれで十分です。

* `queued`
* `running`
* `done`
* `failed`

追加で持つべき項目はこのくらいです。

* `attempt`
* `errorCode`
* `errorMessage`
* `renderMs`
* `pdfBytes`
* `rendererVersion`
* `startedAt`
* `finishedAt`

ここは D1 でも KV でもよいですが、**一覧・再実行・失敗分析**を考えると D1 寄りです。

---

## Cloud Run サービス設計

### サービス名

`plugbits-renderer`

### ランタイム

最初は **Node.js コンテナ** でよいです。
理由は、今の `pdf-lib` ロジックをかなり移植しやすいからです。

### 初期設定のおすすめ

重い PDF は並列にしすぎない方が良いので、最初はかなり保守的でいいです。

* CPU: 1〜2 vCPU
* Memory: 1〜2 GiB
* Concurrency: **1**
* Min instances: 0 か 1
* Max instances: 小さく開始
* Timeout: 帳票レンダ時間に合わせて設定

Cloud Run は concurrency を設定できますが、PDF 生成のような CPU ヘビー処理では **concurrency=1 から始める**のが安全です。 ([Google Cloud Documentation][1])

---

## なぜ concurrency=1 から始めるか

帳票生成は、Web API の一般論みたいに「1 インスタンスでたくさん捌けば得」ではないです。

今の PlugBits Reports は、

* 日本語フォント埋め込み
* 背景 PDF
* テーブル描画
* 複数ページ

が重いので、1 インスタンスで同時に複数件走らせると、**速くなるより不安定化しやすい**です。

なので最初は、

* 1 インスタンス = 1 ジョブ
* 足りなければインスタンス数を増やす

の方が読みやすいです。

---

## フォント戦略

今の知見をそのまま持ち込みます。

* 日本語フォント: `subset:false` が必要 
* Latin: `subset:true` 維持でよい 
* フォント本体は **Cloud Run イメージに同梱** するか、起動時に Cloud Storage / R2 から取得してメモリキャッシュ

私なら最初は **同梱** にします。
理由は、レンダ時に外部 fetch を挟むと遅延要因と障害点が増えるからです。

ただしサイズが大きい場合は、

* よく使う本命フォントだけ同梱
* 実験用や将来フォントは外部ストレージ

の二段構えが良いです。

---

## 背景 PDF 戦略

これは今の仕組みを活かします。

* テンプレ保存時に背景 PDF を事前生成
* 背景は R2 に置く
* Cloud Run は背景を読み込んで本文だけ重ねる

この構成は筋が良いです。
すでに背景 build と R2 保存の流れがあるので、Cloud Run に合わせて壊す必要はありません。 

むしろ Cloud Run 化でやるべきことは、

* 背景 key を明示管理
* テンプレ revision ごとに背景を versioning
* render 時に `templateRevision` と背景 hash を記録

です。

---

## 失敗時の扱い

ここは最初から設計に入れた方がいいです。

### 想定失敗

* フォント読み込み失敗
* 背景 PDF 不整合
* data 不正
* 特定テンプレで描画例外
* Cloud Run timeout
* R2 保存失敗

### ルール

* `failed` に落とす
* `errorCode` を固定化
* 生エラー文字列は内部ログ用
* ユーザー表示は短く整形

例:

* `FONT_LOAD_FAILED`
* `BACKGROUND_NOT_FOUND`
* `INVALID_TEMPLATE`
* `RENDER_TIMEOUT`
* `UPLOAD_FAILED`

---

## セキュリティ

Cloud Run 側は **公開 API にしない** 方がいいです。

理想は、

* Workers だけが Cloud Run を叩ける
* Cloud Run は内部トークン or 署名ヘッダを要求
* payload に `tenantId`, `jobId`, `requestId` を必ず入れる

です。

Cloud Run は IAM や認証付き呼び出しの形も取れます。
少なくとも「誰でも直接 PDF を作れる public endpoint」にはしない方がいいです。Cloud Run は HTTP / イベント経由のサービスとして動かせます。 ([Google Cloud Documentation][2])

---

## コスト感の考え方

Cloud Run は billing モードがあり、

* **request-based billing**
* **instance-based billing**

を選べます。request-based ではリクエスト処理中だけ CPU が割り当てられ、instance-based ではインスタンスのライフタイム中 CPU が確保されます。 ([Google Cloud Documentation][3])

PlugBits Reports なら、最初は **request-based billing** が自然です。
常時高負荷ではないはずなので、アイドル時にコストを抑えやすいからです。

後で、

* 常時利用が増えた
* ウォーム維持が重要
* 起動遅延が気になる

となったら、min instances や billing の見直しをすればよいです。

---

## 実装ロードマップ

### Phase 1

**インターフェース分離**

* 現行 Worker の render 本体を `RenderEngine` として切り出す
* `renderLocal()` と `renderRemote()` を分離
* 今は remote を stub にしてもよい

### Phase 2

**Cloud Run renderer 作成**

* Node コンテナ
* `/internal/render`
* フォント同梱
* R2 保存
* 単体 PDF 生成

### Phase 3

**Workers から委譲**

* `POST /render-jobs`
* Worker がテンプレ取得
* Cloud Run に内部リクエスト
* done/failed 更新

### Phase 4

**運用性追加**

* renderMs 記録
* failure code 記録
* 再実行 API
* rendererVersion
* テンプレ revision 固定

### Phase 5

**最適化**

* 背景キャッシュ
* フォント preload
* 一部テンプレのプリコンパイル
* 軽い帳票だけ local fallback

---

## この構成のメリット

一番大きいのは、**「アプリ本体」と「レンダリング基盤」を分離できること**です。

これにより、

* UI 側は今の Cloudflare 資産を維持
* 重い PDF は Cloud Run 側で吸収
* 将来 Puppeteer や別レンダラに差し替え可能
* 日本語フォント問題を renderer の責務に閉じ込められる

という形になります。

---

## 私の推奨判断

今の PlugBits Reports に対しては、
**全面 Cloud Run 移行ではなく、Cloud Run を “専用レンダラ” として挿す** のが最善です。

つまり、

* **Cloudflare = プロダクト本体**
* **Cloud Run = PDF エンジン**

です。

この分け方が一番きれいです。

必要なら次に、
**この構想をそのまま CODEX に渡せる実装指示書形式**で、
API 仕様、job schema、Cloud Run コンテナ責務、移行ステップまで一気に書きます。

[1]: https://docs.cloud.google.com/run/docs/about-concurrency?utm_source=chatgpt.com "Maximum concurrent requests for services | Cloud Run"
[2]: https://docs.cloud.google.com/run/docs?utm_source=chatgpt.com "Cloud Run documentation"
[3]: https://docs.cloud.google.com/run/docs/tips/services-cost-optimization?utm_source=chatgpt.com "Best practices for cost-optimized Cloud Run services"
