#!/usr/bin/env bash
set -euo pipefail

# Usage:
#   BASE="https://your-worker.example" ADMIN_API_KEY="..." ./scripts/publish-templates.sh

if [[ -z "${BASE:-}" ]]; then
  echo "BASE is required (e.g., https://plugbits-reports.example.workers.dev)" >&2
  exit 1
fi

if [[ -z "${ADMIN_API_KEY:-}" ]]; then
  echo "ADMIN_API_KEY is required" >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATES=(list_v1 cards_v1 cards_v2)

for template_id in "${TEMPLATES[@]}"; do
  template_path="${ROOT_DIR}/worker/dev-templates/${template_id}.json"
  if [[ ! -f "${template_path}" ]]; then
    echo "Missing template file: ${template_path}" >&2
    exit 1
  fi

  echo "Publishing ${template_id}..."
  curl -sS -i -X PUT "${BASE}/templates/${template_id}" \
    -H "Content-Type: application/json" \
    -H "x-api-key: ${ADMIN_API_KEY}" \
    --data @"${template_path}"
  echo
done
