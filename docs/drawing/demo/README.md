# docs/drawing/demo/ — 実装メモ

## 「kintone の中ではこう見えます」ブロック (`#kintone-look`)

結果モーダル(サンプル図面クリック・自分の図面アップロードどちらでも共通)の
候補リスト下に出る、実際のkintone画面を見せるブロック。

現在は暫定として `/drawing/assets/howto-3.webp`(LPの「使い方」セクションで
使っている実画面スクリーンショット)をそのまま参照している。専用の撮影
画像(デモページの見た目に合わせたキャプチャ)が届いたら:

1. 画像を `docs/drawing/assets/demo-in-kintone.webp` に置く
2. `docs/drawing/demo/demo.js` 冒頭の以下の定数だけ書き換える(この4つだけで
   画像パス・alt・実寸が決まる。マークアップ側の変更は不要):
   ```js
   const KINTONE_LOOK_IMAGE_SRC = '/drawing/assets/demo-in-kintone.webp';
   const KINTONE_LOOK_IMAGE_WIDTH = <実際の画像幅>;
   const KINTONE_LOOK_IMAGE_HEIGHT = <実際の画像高さ>;
   const KINTONE_LOOK_IMAGE_ALT = '<新しい画像に合わせたalt文言(必要なら)>';
   ```
3. `node scripts/build.js` を再実行

見出し・キャプション2行・下の注記テキストは `buildKintoneLookBlock()`
(`demo.js`)にハードコードしてあるので、文言を変える場合はそこを直接編集する。

## 結果モーダル

`docs/drawing/demo/demo.js` の `createResultsModal()` / `openSampleResultsModal()` /
`openUploadResultsModal()` が、kintoneプラグイン本番
(`drawing-similarity` リポジトリの `plugins/kintone-drawing-similarity/app/plugin.js`
の `createModalShell` / `openSimilarModal` 相当、L310-360, L2796-3065, L5260-5330)
の見た目を移植した共通コンポーネント。サンプル図面クリックと自分の図面
アップロード結果の両方がこれ1つを共有する。スタイルは `docs/drawing/demo/demo.css`
の `.demo-modal-*` / `--dmx-*` にまとめてあり、ページ本体の `dw-*` トークンとは
名前空間を分けている。
