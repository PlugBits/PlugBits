# samples/ — placeholder (v1)

これはプレースホルダーです。`samples.json` は 3 件のダミーデータ、`thumbs/*.jpg` は
1x1 ピクセルの最小 JPEG です。デモページ「デモ用のサンプル図面で試す」セクションが
ローカルで動作確認できるように、形だけ用意しています。

本番用に差し替える際は、以下をそのまま置き換えてください:

- `samples.json` — 250件、スキーマは同じ (`generated`, `model`, `dimension`,
  `rotations: [0]`, `items[]` に `id`, `title`, `sheet`, `views`, `scan`, `thumb`,
  `vector` を持つ形)。`vector` は L2 正規化済みの実際の埋め込みベクトル。
- `thumbs/*.jpg` — 各アイテムのサムネイル画像(`samples.json` の `thumb` が指す
  相対パス、例 `thumbs/S001.jpg`)。

`samples.json` が存在しない、または `items` が空の場合、ページはこのセクションを
非表示にします(壊れません)。
