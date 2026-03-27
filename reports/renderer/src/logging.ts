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

export const getRendererLogTier = (): RenderLogTier =>
  normalizeRenderLogTier(process.env.RENDERER_LOG_LEVEL);

export const shouldLogRendererTier = (tier: RenderLogTier): boolean =>
  LOG_LEVEL_RANK[getRendererLogTier()] >= LOG_LEVEL_RANK[tier];

const normalizeTag = (tag: string) => tag.replace(/^\[/, '').replace(/\]$/, '');

const toJsonValue = (value: unknown): unknown => {
  if (value == null) return value;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }
  if (Array.isArray(value)) {
    return value.map((entry) => toJsonValue(entry));
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, toJsonValue(entry)]),
    );
  }
  if (typeof value === 'bigint') return String(value);
  return value;
};

const emitRendererJsonLog = (
  severity: 'INFO' | 'ERROR',
  tag: string,
  payload: Record<string, unknown>,
) => {
  const normalizedPayload = toJsonValue(payload) as Record<string, unknown>;
  const entry = {
    timestamp: new Date().toISOString(),
    severity,
    tag: normalizeTag(tag),
    ...normalizedPayload,
  };
  console.log(JSON.stringify(entry));
};

export const logRendererInfo = (
  tier: RenderLogTier,
  tag: string,
  payload: Record<string, unknown>,
) => {
  if (!shouldLogRendererTier(tier)) return;
  emitRendererJsonLog('INFO', tag, payload);
};

export const logRendererError = (
  tier: RenderLogTier,
  tag: string,
  payload: Record<string, unknown>,
) => {
  if (!shouldLogRendererTier(tier)) return;
  emitRendererJsonLog('ERROR', tag, payload);
};
