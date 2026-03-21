# PlugBits Reports 非同期PDFジョブ化 まとめ.md

## 1. 現在地

### できたこと
- `/render` の重い処理を **Queue ベースの非同期ジョブ化** する土台はできている。
- Worker 側に以下のAPIが入っている。
  - `POST /render-jobs`
  - `GET /render-jobs/:jobId`
  - `GET /render-jobs/:jobId/pdf`
- Plugin UI 側も、基本導線としては
  - `POST /render-jobs`
  - `GET /render-jobs/:jobId` を polling
  - `GET /render-jobs/:jobId/pdf`
  に切り替わっている。
- `sessionToken` 経由で `kintoneApiToken` を解決する流れも概ね動作するようになった。
- 同一 jobId の多重 polling / 多重 download を減らす修正も入っている。
- ログで `queued -> processing -> done` まで正常に進む job は確認済み。
- `jobs/output/...pdf` に成果物が保存されるところまで確認済み。

### 確認できたログ
- `[DBG_RENDER_JOB_CREATE]`
- `[DBG_RENDER_JOB_CONSUME]`
- `[DBG_RENDER_JOB_DONE]`
- `[DBG_RENDER_JOB_DOWNLOAD]`
- `[DBG_RENDER_JOB_SESSION_RESOLVE]`
- `[DBG_RENDER_JOB_KINTONE_AUTH] tokenSource: "session"`

つまり、**非同期ジョブ化の方向性自体は正しい**。

---

## 2. まだ未完成な本質問題

### 結論
今の未解決ポイントは **フロントではなく Queue consumer 側**。

問題の本体はこれ。

- 一部 job は正常完了する
- 一部 job は `Queue render-jobs ... Exceeded CPU Limit`
- 同じ `jobId` が再度 consume される
- poll 側では `queued` / `processing` が長く続く
- 結果として「ずっと待ち」に見える

要するに、

**consumer が CPU Limit で途中死 → Queue retry → 同じ job を再実行**
という状態になっている。

これは「polling の見た目が悪い」ではなく、
**ジョブ実行基盤の完走性と retry-safe 設計がまだ不足している** ということ。

---

## 3. ログから読み取れたこと

### 3-1. フロントの多重 polling は副次的問題
以前は同じ jobId に対して polling / download が多重化していたが、
そこはかなり是正されている。

現時点の本丸は UI ではない。

---

### 3-2. Queue consumer が CPU Limit で落ちる
代表的な症状:
- `Queue render-jobs (1 message) - Exceeded CPU Limit`
- 同じ `jobId` が再度 `CONSUME`
- `status: processing` にした後でまた落ちる
- poll では `queued` や `processing` が長時間続く

---

### 3-3. 重いのは「表行数」だけではない
たとえば以下のような軽いレコードでも落ちている。

- `rowCount: 0`
- `textOpsCount` も少ない
- それでも CPU Limit

つまり、単純な「明細が多いから重い」だけではない。

根本は、
- 背景 PDF 約 1.07MB
- JP フォント約 1.25MB
- これらを consumer が毎回扱う
- `/internal/render` の既存処理がまだ重い

ということ。

---

### 3-4. status の見え方が不安定
consumer では `processing` や `done` に書いているのに、
poll 側では `queued` が見える場面がある。

これはおそらく、
- read/write の整合が甘い
- retry 時の状態遷移が整理されていない
- stale processing 判定がない
あたりが原因。

---

## 4. 今の評価

### 良い点
- 非同期化の舵切りは正しい
- セッション経由認証もかなり前進した
- UI から `/render-jobs` を使う本番導線に近づいた
- 一部ジョブは end-to-end で成功している

### 悪い点
- consumer の render 本体がまだ重い
- CPU Limit 時の retry 制御が弱い
- status 管理が retry-safe になっていない
- 本番耐性はまだ不十分

### 一言でいうと
**設計は当たり。実装はまだ本番完成ではない。**

---

## 5. ここまでで確定した判断

### やめてよいこと
- 「まだ /render 直叩きで粘る」
- 「UIだけ直せば完成と考える」
- 「polling間隔だけいじって誤魔化す」

このあたりはもう違う。

### 続けるべき方針
- **/render-jobs 正式導線**
- **Queue consumer の完走性改善**
- **retry-safe job state 管理**
- **軽量化の高速パス追加**

---

## 6. 復帰時に最初にやること

復帰したら、まずは CODEX に以下の方向で修正させる。

### 最優先 1: retry-safe 化
必要なもの:
- `retryCount`
- `lastError`
- `startedAt`
- `finishedAt`
- stale processing 判定
- retry 上限超過で `failed`
- `done` / `failed` 済み job の再実行防止

#### 受け入れ基準
- 同じ job が CPU Limit で無限再試行しない
- 規定回数で `failed`
- `done` 済み job は再 consume しない

---

### 最優先 2: 軽量化
特に必要なのは以下。

- `rowCount === 0` の専用高速パス
- `filteredTexts` が少ない時の minimal path
- background / font の二重ロード防止
- final MISS 時の最小 overlay 経路の明確化
- timing log の追加で、どこが重いか確定させる

#### 受け入れ基準
- `rowCount: 0` の job が完走する
- 軽い record で CPU Limit が出ない

---

### 最優先 3: status 整合
必要なこと:
- read/write の一貫性見直し
- `queued -> processing -> done/failed` が巻き戻らない
- poll と consumer で同じ状態が見えるようにする

#### 受け入れ基準
- poll が `queued` / `processing` / `done` を安定表示
- consumer で `done` にした job が poll でも即 `done`

---

## 7. 復帰時の確認ログ

復帰後はこのログを重点確認する。

### 成功系
- `[DBG_RENDER_JOB_CREATE]`
- `[DBG_RENDER_JOB_CONSUME]`
- `[DBG_RENDER_JOB_STATUS] status: processing`
- `[DBG_RENDER_JOB_DONE]`
- `[DBG_RENDER_JOB_DOWNLOAD]`

### 失敗解析系
- `Queue render-jobs ... Exceeded CPU Limit`
- 同じ `jobId` の再 consume 有無
- `status` が queued に巻き戻っていないか
- `rowCount: 0` でも落ちていないか

### 今後追加させるべきログ
- `[DBG_RENDER_JOB_RETRY]`
- `[DBG_RENDER_JOB_SKIP_DONE]`
- `[DBG_RENDER_JOB_SKIP_FAILED]`
- `[DBG_RENDER_JOB_STALE_PROCESSING]`
- `[DBG_RENDER_JOB_FAST_PATH]`
- `[DBG_RENDER_JOB_EMPTY_TABLE_SHORTCUT]`
- `[DBG_RENDER_JOB_TIMING_SUMMARY]`

---

## 8. CODEX に戻るときの指示方針

復帰時は「何となく直して」ではなく、下記のテーマで依頼する。

### テーマ
1. Queue consumer の retry-safe 化
2. rowCount=0 / 軽量レコードの高速パス
3. status ストア整合
4. CPU Limit 時の failed 確定制御
5. poll 表示の安定化

### 注意
「UIの雰囲気修正」や「poll間隔変更」には逃げないこと。
今の問題はそこではない。

---

## 9. いま安心してよいこと

少なくとも以下は無駄ではなかった。

- 非同期ジョブ化の方針
- Queue 導入
- session 経由トークン解決
- /render-jobs 正式導線への切り替え
- front の多重 polling 抑制

つまり、ここまでの作業はちゃんと積み上がっている。
ただし最後の壁が **consumer の完走性** というだけ。

---

## 10. 復帰時の最短アクション

再開したらこの順で進める。

1. この md を読む
2. CODEX に retry-safe + 軽量化 + status整合 の修正を依頼
3. `rowCount: 0` の record でまず通す
4. 次に 4件連続実行で通す
5. 最後に 8件連続実行で通す

この順番にしないと、また人類特有の「思いつきで横に広げて収拾不能」になります。

---

## 11. 最終メモ

今の状態は「失敗」ではなく、**本番で詰まる場所が正確に見えた段階**。
むしろここで拡張機能に一旦集中する判断はかなり合理的。

戻ってきたらやることは明確。

- 非同期化は継続
- consumer を軽くする
- retry-safe にする
- poll 表示を状態整合させる

これで次に再開した時、迷子にならずに再突入できる。
