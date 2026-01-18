#!/usr/bin/env bash
set -euo pipefail

# Diagnose tenant/template auth issues for PlugBits Reports Worker.
#
# Usage (env):
#   WORKER_BASE="https://plugbits-reports.example.workers.dev" \
#   KT_BASE="https://example.kintone.com" \
#   APP_ID="223" \
#   TPL_ID="tpl_xxx" \
#   ./scripts/diagnose-tenant.sh
#
# Usage (args):
#   ./scripts/diagnose-tenant.sh \
#     https://plugbits-reports.example.workers.dev \
#     https://example.kintone.com \
#     223 \
#     tpl_xxx

WORKER_BASE="${WORKER_BASE:-${1:-}}"
KT_BASE="${KT_BASE:-${2:-}}"
APP_ID="${APP_ID:-${3:-}}"
TPL_ID="${TPL_ID:-${4:-}}"

if [[ -z "$WORKER_BASE" || -z "$KT_BASE" || -z "$APP_ID" || -z "$TPL_ID" ]]; then
  echo "Missing required inputs."
  echo "Usage:"
  echo "  WORKER_BASE=... KT_BASE=... APP_ID=... TPL_ID=... ./scripts/diagnose-tenant.sh"
  echo "  or"
  echo "  ./scripts/diagnose-tenant.sh <WORKER_BASE> <KT_BASE> <APP_ID> <TPL_ID>"
  exit 1
fi

WORKER_BASE="${WORKER_BASE%/}"

declare -a TMP_FILES=()
make_tmp() {
  local f
  f="$(mktemp -t pbdiag.XXXXXX)"
  TMP_FILES+=("$f")
  echo "$f"
}

cleanup() {
  for f in "${TMP_FILES[@]:-}"; do
    rm -f "$f"
  done
}
trap cleanup EXIT

json_get() {
  local key="$1"
  local file="$2"
  local raw
  raw="$(tr -d '\n' <"$file")"
  local val
  val="$(printf '%s' "$raw" | sed -n "s/.*\"$key\"[[:space:]]*:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p" | head -n 1)"
  if [[ -n "$val" ]]; then
    echo "$val"
    return
  fi
  val="$(printf '%s' "$raw" | sed -n "s/.*\"$key\"[[:space:]]*:[[:space:]]*\\([0-9][0-9]*\\).*/\\1/p" | head -n 1)"
  echo "$val"
}

urlencode() {
  printf '%s' "$1" | sed \
    -e 's/%/%25/g' \
    -e 's/:/%3A/g' \
    -e 's/\//%2F/g' \
    -e 's/?/%3F/g' \
    -e 's/&/%26/g' \
    -e 's/=/%3D/g' \
    -e 's/+/%2B/g' \
    -e 's/ /%20/g'
}

print_step() {
  echo
  echo "==== STEP $1: $2 ===="
}

print_response() {
  local status="$1"
  local headers="$2"
  local body="$3"
  echo "HTTP Status: ${status}"
  echo "-- Headers --"
  cat "$headers"
  echo "-- Body --"
  cat "$body"
}

print_body_snippet() {
  local body="$1"
  local snippet
  snippet="$(tr -d '\n' <"$body" | cut -c1-2000)"
  echo "$snippet"
}

do_curl() {
  local method="$1"
  local url="$2"
  local data="${3:-}"
  shift 3 || true
  RESP_HEADERS="$(make_tmp)"
  RESP_BODY="$(make_tmp)"
  if [[ "$method" == "GET" ]]; then
    curl -sS -D "$RESP_HEADERS" -o "$RESP_BODY" "$@" "$url"
  else
    curl -sS -D "$RESP_HEADERS" -o "$RESP_BODY" -X "$method" -H "Content-Type: application/json" "$@" --data "$data" "$url"
  fi
  RESP_STATUS="$(head -n 1 "$RESP_HEADERS" | awk '{print $2}')"
}

SESSION_TOKEN=""
EDITOR_TOKEN=""
TENANT_ID=""
ACTIVE_CONTAINS="no"
DELETED_CONTAINS="no"
ARCHIVED_CONTAINS="no"
USER_TEMPLATE_STATUS=""
TEMPLATE_QUERY_STATUS=""

print_step 1 "GET ${WORKER_BASE}/"
do_curl "GET" "${WORKER_BASE}/"
echo "HTTP Status: ${RESP_STATUS}"
echo "-- Body --"
cat "$RESP_BODY"

print_step 2 "POST ${WORKER_BASE}/editor/session"
payload_step2="{\"kintoneBaseUrl\":\"${KT_BASE}\",\"appId\":\"${APP_ID}\"}"
do_curl "POST" "${WORKER_BASE}/editor/session" "$payload_step2"
if [[ "$RESP_STATUS" != "200" ]]; then
  print_response "$RESP_STATUS" "$RESP_HEADERS" "$RESP_BODY"
  exit 1
fi
SESSION_TOKEN="$(json_get "sessionToken" "$RESP_BODY")"
SESSION_EXPIRES="$(json_get "expiresAt" "$RESP_BODY")"
echo "HTTP Status: ${RESP_STATUS}"
echo "sessionToken: ${SESSION_TOKEN}"
echo "expiresAt: ${SESSION_EXPIRES}"
if [[ -z "$SESSION_TOKEN" ]]; then
  echo "Failed to extract sessionToken."
  exit 1
fi

print_step 3 "POST ${WORKER_BASE}/editor/session/exchange"
payload_step3="{\"token\":\"${SESSION_TOKEN}\"}"
do_curl "POST" "${WORKER_BASE}/editor/session/exchange" "$payload_step3"
if [[ "$RESP_STATUS" != "200" ]]; then
  print_response "$RESP_STATUS" "$RESP_HEADERS" "$RESP_BODY"
  exit 1
fi
EDITOR_TOKEN="$(json_get "editorToken" "$RESP_BODY")"
TENANT_ID="$(json_get "tenantId" "$RESP_BODY")"
EXCHANGE_BASE="$(json_get "kintoneBaseUrl" "$RESP_BODY")"
EXCHANGE_APP="$(json_get "appId" "$RESP_BODY")"
echo "HTTP Status: ${RESP_STATUS}"
echo "editorToken: ${EDITOR_TOKEN}"
echo "tenantId: ${TENANT_ID}"
echo "kintoneBaseUrl: ${EXCHANGE_BASE}"
echo "appId: ${EXCHANGE_APP}"
if [[ -z "$EDITOR_TOKEN" ]]; then
  echo "Failed to extract editorToken."
  exit 1
fi

print_step 4 "GET ${WORKER_BASE}/user-templates?status=active&limit=50"
do_curl "GET" "${WORKER_BASE}/user-templates?status=active&limit=50" "" -H "Authorization: Bearer ${EDITOR_TOKEN}"
echo "HTTP Status: ${RESP_STATUS}"
if [[ "$RESP_STATUS" != "200" ]]; then
  print_response "$RESP_STATUS" "$RESP_HEADERS" "$RESP_BODY"
  exit 1
fi
print_body_snippet "$RESP_BODY"
if grep -q "$TPL_ID" "$RESP_BODY"; then
  ACTIVE_CONTAINS="yes"
  echo "TPL_ID found in active list."
else
  echo "TPL_ID not found in active list."
fi

print_step 5 "GET ${WORKER_BASE}/user-templates/${TPL_ID}"
do_curl "GET" "${WORKER_BASE}/user-templates/${TPL_ID}" "" -H "Authorization: Bearer ${EDITOR_TOKEN}"
USER_TEMPLATE_STATUS="${RESP_STATUS}"
echo "HTTP Status: ${RESP_STATUS}"
if [[ "$RESP_STATUS" == "200" ]]; then
  echo "FOUND: active via /user-templates/:id"
elif [[ "$RESP_STATUS" == "404" ]]; then
  echo "NOT FOUND via /user-templates/:id（activeに存在しない）"
  print_response "$RESP_STATUS" "$RESP_HEADERS" "$RESP_BODY"
elif [[ "$RESP_STATUS" == "401" ]]; then
  echo "UNAUTHORIZED（editorTokenが無効 or tenant不一致）"
  print_response "$RESP_STATUS" "$RESP_HEADERS" "$RESP_BODY"
else
  print_response "$RESP_STATUS" "$RESP_HEADERS" "$RESP_BODY"
fi

print_step 6 "GET ${WORKER_BASE}/templates/${TPL_ID}?kintoneBaseUrl=...&appId=..."
enc_base="$(urlencode "$KT_BASE")"
enc_app="$(urlencode "$APP_ID")"
template_query_url="${WORKER_BASE}/templates/${TPL_ID}?kintoneBaseUrl=${enc_base}&appId=${enc_app}"
do_curl "GET" "$template_query_url"
TEMPLATE_QUERY_STATUS="${RESP_STATUS}"
echo "HTTP Status: ${RESP_STATUS}"
print_response "$RESP_STATUS" "$RESP_HEADERS" "$RESP_BODY"

print_step 7 "GET ${WORKER_BASE}/user-templates?status=deleted&limit=50"
do_curl "GET" "${WORKER_BASE}/user-templates?status=deleted&limit=50" "" -H "Authorization: Bearer ${EDITOR_TOKEN}"
echo "HTTP Status: ${RESP_STATUS}"
if [[ "$RESP_STATUS" == "200" ]]; then
  print_body_snippet "$RESP_BODY"
  if grep -q "$TPL_ID" "$RESP_BODY"; then
    DELETED_CONTAINS="yes"
    echo "TPL_ID found in deleted list."
  else
    echo "TPL_ID not found in deleted list."
  fi
else
  print_response "$RESP_STATUS" "$RESP_HEADERS" "$RESP_BODY"
fi

print_step 8 "GET ${WORKER_BASE}/user-templates?status=archived&limit=50"
do_curl "GET" "${WORKER_BASE}/user-templates?status=archived&limit=50" "" -H "Authorization: Bearer ${EDITOR_TOKEN}"
echo "HTTP Status: ${RESP_STATUS}"
if [[ "$RESP_STATUS" == "200" ]]; then
  print_body_snippet "$RESP_BODY"
  if grep -q "$TPL_ID" "$RESP_BODY"; then
    ARCHIVED_CONTAINS="yes"
    echo "TPL_ID found in archived list."
  else
    echo "TPL_ID not found in archived list."
  fi
else
  print_response "$RESP_STATUS" "$RESP_HEADERS" "$RESP_BODY"
fi

echo
echo "==== Conclusion ===="
if [[ -n "$EDITOR_TOKEN" ]]; then
  echo "- editorToken: OK"
else
  echo "- editorToken: FAILED"
fi
echo "- active list contains TPL_ID: ${ACTIVE_CONTAINS}"
echo "- deleted list contains TPL_ID: ${DELETED_CONTAINS}"
echo "- archived list contains TPL_ID: ${ARCHIVED_CONTAINS}"
echo "- /user-templates/:id status: ${USER_TEMPLATE_STATUS}"
echo "- /templates/:id query status: ${TEMPLATE_QUERY_STATUS}"
echo "- 可能性（/user-templates/:id が 404 の場合）:"
echo "  - active に存在しないため（削除/アーカイブ/未保存）"
echo "  - kintoneBaseUrl / appId が別で tenant が一致していない可能性"
echo "  - purge 済みで KV から削除済みの可能性"
echo "- 可能性（/user-templates/:id が 401 の場合）:"
echo "  - editorToken が無効 or tenant 不一致（Authorization が Bearer で送られていない/期限切れ）"
