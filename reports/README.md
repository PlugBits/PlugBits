# PlugBits Reports

## Templates (KV registration)

`/templates/:id` でテンプレを保存できます。管理者キーを使う場合は `x-api-key` を付与してください。

Example:

```sh
curl -i -X PUT "$BASE/templates/list_v1" \
  -H 'Content-Type: application/json' \
  -H "x-api-key: $ADMIN_API_KEY" \
  --data @worker/dev-templates/list_v1.json
```

All base templates:

```sh
BASE="https://your-worker.example" ADMIN_API_KEY="..." ./scripts/publish-templates.sh
```

取得:

```sh
curl -i "$BASE/templates/list_v1"
```

## Plugin Config Recovery Note

- Reason: UI URL (Pages/localhost) must never be stored as the Worker API URL; settings now ignore saved `uiBaseUrl` and always open the fixed UI URL.
- Quick test: open plugin settings with `apiBaseUrl` set to a Pages URL, confirm an error banner blocks save and picker/edit until a Workers URL is set.

## Session Refresh Test

1) `worker/src/index.ts` の `SESSION_TTL_SECONDS` を一時的に `60` に変更する
2) Editor を開き、Network で `/session/refresh` が 5分ごとに 200 を返すことを確認する
3) Refresh を無効化した場合と比べて、編集中にセッション切れが起きないことを確認する
