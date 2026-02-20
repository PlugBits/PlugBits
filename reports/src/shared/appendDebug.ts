export const appendDebugParam = (url: string, enabled: boolean): string => {
  if (!enabled) return url;
  const base =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'http://localhost';
  let parsed: URL;
  try {
    parsed = new URL(url, base);
  } catch {
    return url;
  }
  if (parsed.searchParams.has('debug')) return parsed.toString();
  parsed.searchParams.append('debug', '1');
  return parsed.toString();
};
