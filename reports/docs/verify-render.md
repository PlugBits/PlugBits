---
title: Render Preview Verification
---

# Render preview verification (Saved / Draft / Record)

目的: Saved/Draft/Record の template 解決結果が一致していることを 5 分で確認する。

## 手順
1. Editor: Preview source = Current draft にして PDF プレビュー (debug=1)
2. Editor: Preview source = Saved template (KV) にして PDF プレビュー (debug=1)
3. Kintone record: PDF 出力 (debug=1)
4. worker log の `DBG_RENDER_RESOLVED` を比較する

## 期待
- `resolvedSource` が意図した値になる
  - Current draft: `body.template`
  - Saved template: `userTemplate`
  - Record output: `userTemplate`
- `resolvedTemplateHash` / `resolvedElementsCount` が一致する

## 失敗時の確認ポイント
- Saved preview が 400 になる場合:
  - `missing` に `kintone.baseUrl` / `kintone.appId` が入っているか
  - payload に `kintone` が含まれているか (DevTools で確認)
