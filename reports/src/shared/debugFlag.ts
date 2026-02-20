const DEBUG_PATTERN = /(^|[?#&])debug=(1|true)($|[&#])/i;

export const parseDebugEnabledFromHref = (href: string): boolean =>
  DEBUG_PATTERN.test(href);

export const isDebugEnabled = (): boolean => {
  if (typeof window === 'undefined') return false;
  return parseDebugEnabledFromHref(window.location.href ?? '');
};

if (typeof window !== 'undefined') {
  const href = window.location.href ?? '';
  const enabled = parseDebugEnabledFromHref(href);
  if (enabled) {
    console.log('[DBG_FLAG_BOOT]', { href, enabled });
  }
}
