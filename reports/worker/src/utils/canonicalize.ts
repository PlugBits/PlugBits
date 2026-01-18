export const canonicalizeKintoneBaseUrl = (input: string): string => {
  const url = new URL(input);
  const host = url.host.toLowerCase();
  return `${url.protocol}//${host}`;
};

export const canonicalizeAppId = (input: unknown): string => String(input ?? "").trim();
