import { logRendererError } from './logging.js';
import { runRenderJob } from './lib/runRenderJob.js';

const jobIdArg = process.argv.find((value) => value.startsWith('--job-id='));
const jobId = jobIdArg ? jobIdArg.slice('--job-id='.length).trim() : '';

console.error('[JOB_RUNNER_BOOT]', JSON.stringify({
  argv: process.argv,
  jobId,
  execution: process.env.CLOUD_RUN_EXECUTION || null,
  job: process.env.CLOUD_RUN_JOB || null,
}));

if (!jobId) {
  console.error('[JOB_RUNNER_ERROR]', JSON.stringify({ error: 'missing --job-id' }));
  process.exit(2);
}

try {
  console.error('[JOB_RUNNER_BEFORE_RUN]', JSON.stringify({ jobId }));
  await runRenderJob({ jobId });
  console.error('[JOB_RUNNER_SUCCESS]', JSON.stringify({ jobId }));
  process.exit(0);
} catch (error) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  console.error('[JOB_RUNNER_ERROR]', JSON.stringify({ jobId, errorMessage, stack }));
  logRendererError('always', '[DBG_RENDERER_JOB_RUNNER_EXIT]', {
    jobId,
    errorMessage,
  });
  process.exit(1);
}
