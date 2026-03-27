export type RenderLogTier = 'always' | 'debug' | 'verbose';

const LOG_LEVEL_RANK: Record<RenderLogTier, number> = {
  always: 0,
  debug: 1,
  verbose: 2,
};

const normalizeRenderLogTier = (value?: string | null): RenderLogTier => {
  if (value === 'debug' || value === 'verbose') return value;
  return 'always';
};

export const getRenderLogTier = (env: { RENDER_LOG_LEVEL?: string | null }): RenderLogTier =>
  normalizeRenderLogTier(env.RENDER_LOG_LEVEL);

export const shouldLogRenderTier = (
  env: { RENDER_LOG_LEVEL?: string | null },
  tier: RenderLogTier,
): boolean => LOG_LEVEL_RANK[getRenderLogTier(env)] >= LOG_LEVEL_RANK[tier];

export const logRenderInfo = (
  env: { RENDER_LOG_LEVEL?: string | null },
  tier: RenderLogTier,
  tag: string,
  payload: Record<string, unknown>,
) => {
  if (!shouldLogRenderTier(env, tier)) return;
  console.info(tag, payload);
};

export const logRenderError = (
  env: { RENDER_LOG_LEVEL?: string | null },
  tier: RenderLogTier,
  tag: string,
  payload: Record<string, unknown>,
) => {
  if (!shouldLogRenderTier(env, tier)) return;
  console.error(tag, payload);
};
