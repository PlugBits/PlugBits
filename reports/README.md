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

取得:

```sh
curl -i "$BASE/templates/list_v1"
```
