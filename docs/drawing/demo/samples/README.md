# samples/ — 合成デモ図面 250件(実データ)

これはプレースホルダーではありません。`samples.json` は 250 件の合成図面
(実在しません)の実際の DINOv2 埋め込みベクトル、`thumbs/*.jpg` は各図面の
サムネイル画像(実サイズ、480px幅・quality 70の JPEG)です。

## データの出所

- 生成元: `drawing-similarity` リポジトリの
  `services/drawing-similarity-api/scripts/demo-samples/`
  (`generate.mjs` — 固定シード `20260916` の決定的ジェネレータ。
  40の部品ファミリー × 5〜7バリアント + 単発10件 = 250枚)
- 埋め込み元: `embed-samples.mjs --input png` を、ローカルで起動した
  drawing-similarity-api (DINOv2, `EMBED_ROTATIONS=0,90,270`,
  `EMBED_IMAGE_MODE=full`, `EMBED_EDGE_MODE=edges`, 768次元) に対して実行
  (Cloud Run 版は本機からデプロイ不可のため、ローカルサーバへ図面を
  PNG化してPOSTする方式で実施。`pdftoppm`未導入のためPDFではなくPNG入力)。
- `vector` は L2 正規化済み(ノルム ≈ 1.0)。`rotations: [0]` のとおり
  回転0°のベクトルのみを保存(90°/270°は破棄)。

## 再生成する場合

```bash
cd services/drawing-similarity-api/scripts/demo-samples   # drawing-similarity リポ
node generate.mjs               # out/pdf, out/thumbs, out/png, out/manifest.json
DEMO_API_BASE=https://your-demo-service.run.app node embed-samples.mjs
# または、ローカル開発サーバ(pdftoppm未導入)向け:
# DEMO_API_BASE=http://127.0.0.1:PORT node embed-samples.mjs --input png
```

そのあと、このディレクトリへ以下をそのままコピーする:

- `out/samples.json` → `samples.json`
- `out/thumbs/*.jpg` → `thumbs/`(既存ファイルは全削除してから)

詳しい手順・スキーマは生成元リポジトリの
`services/drawing-similarity-api/scripts/demo-samples/README.md` を参照。

## スキーマ

```jsonc
{
  "generated": "2026-09-16T14:12:25.229Z",
  "model": "facebook/dinov2-base",
  "dimension": 768,
  "rotations": [0],
  "items": [
    {
      "id": "S001",
      "title": "スペーサーリング PB-3117",
      "sheet": "A3",
      "views": "three-view",
      "scan": false,
      "thumb": "thumbs/S001.jpg",
      "vector": [0.0208, 0.0573, /* ... 768次元、小数4桁に丸め */]
    }
    // ... 250件
  ]
}
```

`samples.json` が存在しない、または `items` が空の場合、デモページの
「デモ用のサンプル図面で試す」セクションは非表示になります(壊れません)。
