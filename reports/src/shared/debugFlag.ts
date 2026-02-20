const DEBUG_PATTERN = /(^|[?#&])debug=(1|true)($|[&#])/i;
let didLogDebugFlags = false;

const parseDebugEnabled = (value: string): boolean => DEBUG_PATTERN.test(value);

export const parseDebugEnabledFromHref = (href: string): boolean =>
  parseDebugEnabled(href);

export const parseDebugEnabledFromLocation = (
  search: string,
  hash: string,
): boolean => parseDebugEnabled(search) || parseDebugEnabled(hash);

export const isDebugEnabled = (): boolean => {
  if (typeof window === 'undefined') return false;
  const search = window.location.search ?? '';
  const hash = window.location.hash ?? '';
  const isDebug = parseDebugEnabledFromLocation(search, hash);
  if (isDebug && !didLogDebugFlags) {
    console.log('[DBG_DEBUG_FLAGS]', { search, hash, isDebug });
    didLogDebugFlags = true;
  }
  return isDebug;
};
