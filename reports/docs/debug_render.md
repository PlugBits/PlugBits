# /render Debug Replay

Use this to reproduce PDF preview failures locally or via `wrangler tail`.

## 1) Capture the failing request

In the browser DevTools Network panel:

1. Find the failing `POST /render?debug=1` request.
2. Right-click → "Copy" → "Copy as cURL".
3. Paste it into a terminal.

## 2) Replay the request

Run the copied cURL as-is. Example (replace with your captured request):

```bash
curl 'https://<worker-host>/render?debug=1' \
  -H 'Content-Type: application/json' \
  -d '{"templateId":"list_v1","data":{}}'
```

## 3) Check logs

Run:

```bash
wrangler tail
```

Look for:

- `[render] request` with `requestId`
- `[ERR_RENDER] requestId=...` (if failure)
- JSON error response (debug=1 includes `stack` and `hint`)

## 4) Share the requestId

Include the `requestId` from logs when reporting failures.
