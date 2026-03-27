#!/usr/bin/env bash
set -euo pipefail

# Manual verification:
# 1. Build image: cd renderer && npm run build
# 2. Deploy/refresh service image, then run this script for the Job.
# 3. Execute a known jobId:
#    gcloud run jobs execute "${JOB_NAME}" --region "${REGION}" --args dist/src/jobRunner.js,--job-id=<existing_job_id>
# 4. If the task fails, inspect:
#    gcloud run jobs executions tasks describe <task> --region "${REGION}" --execution <execution>
#    gcloud logging read 'resource.type="cloud_run_job"' --limit=100 --format=json
#    Worker logs for /internal/render-jobs/:id/payload and /internal/render-jobs/:id/transition
# 5. Use the last stderr marker to decide whether it failed in payload fetch, transition, background fetch, or font load.

: "${IMAGE_URI:?IMAGE_URI is required}"
: "${REGION:?REGION is required}"
: "${JOB_NAME:=plugbits-reports-renderer-job}"
: "${SERVICE_ACCOUNT:=}"

cmd=(
  gcloud run jobs deploy "${JOB_NAME}"
  --image "${IMAGE_URI}"
  --region "${REGION}"
  --tasks 1
  --parallelism 1
  --max-retries 0
  --task-timeout 900s
  --cpu 1
  --memory 2Gi
  --command node
  --args dist/src/jobRunner.js
)

if [[ -n "${SERVICE_ACCOUNT}" ]]; then
  cmd+=(--service-account "${SERVICE_ACCOUNT}")
fi

if [[ -n "${WORKER_INTERNAL_BASE_URL:-}" ]]; then
  cmd+=(--set-env-vars "WORKER_INTERNAL_BASE_URL=${WORKER_INTERNAL_BASE_URL}")
fi

if [[ -n "${RENDERER_INTERNAL_TOKEN:-}" ]]; then
  cmd+=(--set-env-vars "RENDERER_INTERNAL_TOKEN=${RENDERER_INTERNAL_TOKEN}")
fi

if [[ -n "${RENDERER_VERSION:-}" ]]; then
  cmd+=(--set-env-vars "RENDERER_VERSION=${RENDERER_VERSION}")
fi

if [[ -n "${WORKER_INTERNAL_TIMEOUT_MS:-}" ]]; then
  cmd+=(--set-env-vars "WORKER_INTERNAL_TIMEOUT_MS=${WORKER_INTERNAL_TIMEOUT_MS}")
fi

"${cmd[@]}"
