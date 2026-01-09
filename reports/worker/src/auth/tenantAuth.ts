import { buildTenantKey } from "../template/userTemplates.ts";

export type TenantRecord = {
  tenantId: string;
  tenantSecret: string;
  kintoneBaseUrl: string;
  appId: string;
  kintoneApiToken?: string;
  createdAt: string;
  updatedAt?: string;
};

const TENANT_PREFIX = "tenant:";
const DEFAULT_TOKEN_TTL_MS = 5 * 60 * 1000;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const buildTenantRecordKey = (tenantId: string) => `${TENANT_PREFIX}${tenantId}`;

const base64UrlEncode = (data: Uint8Array) => {
  let binary = "";
  data.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const base64UrlDecode = (input: string): Uint8Array => {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(input.length / 4) * 4, "=");
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
};

const timingSafeEqual = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
};

const signHmac = async (secret: string, data: string): Promise<string> => {
  const key = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, textEncoder.encode(data));
  return base64UrlEncode(new Uint8Array(signature));
};

const parseJsonPayload = <T>(base64Payload: string): T | null => {
  try {
    const bytes = base64UrlDecode(base64Payload);
    const text = textDecoder.decode(bytes);
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
};

export const normalizeKintoneBaseUrl = (value: string): string => {
  const url = new URL(value);
  return url.origin;
};

export const getTenantRecord = async (
  kv: KVNamespace,
  tenantId: string,
): Promise<TenantRecord | null> => {
  const raw = await kv.get(buildTenantRecordKey(tenantId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TenantRecord;
  } catch {
    return null;
  }
};

export const registerTenant = async (
  kv: KVNamespace,
  payload: {
    kintoneBaseUrl: string;
    appId: string;
    kintoneApiToken?: string;
  },
): Promise<TenantRecord> => {
  const normalizedBaseUrl = normalizeKintoneBaseUrl(payload.kintoneBaseUrl);
  const tenantId = buildTenantKey(normalizedBaseUrl, payload.appId);
  const existing = await getTenantRecord(kv, tenantId);

  if (existing) {
    if (payload.kintoneApiToken && payload.kintoneApiToken !== existing.kintoneApiToken) {
      const updated: TenantRecord = {
        ...existing,
        kintoneApiToken: payload.kintoneApiToken,
        updatedAt: new Date().toISOString(),
      };
      await kv.put(buildTenantRecordKey(tenantId), JSON.stringify(updated));
      return updated;
    }
    return existing;
  }

  const secretBytes = new Uint8Array(32);
  crypto.getRandomValues(secretBytes);
  const tenantSecret = base64UrlEncode(secretBytes);
  const now = new Date().toISOString();
  const record: TenantRecord = {
    tenantId,
    tenantSecret,
    kintoneBaseUrl: normalizedBaseUrl,
    appId: String(payload.appId),
    kintoneApiToken: payload.kintoneApiToken,
    createdAt: now,
  };

  await kv.put(buildTenantRecordKey(tenantId), JSON.stringify(record));
  return record;
};

export const upsertTenantApiToken = async (
  kv: KVNamespace,
  tenantId: string,
  kintoneApiToken?: string,
): Promise<TenantRecord | null> => {
  if (!kintoneApiToken) return null;
  const existing = await getTenantRecord(kv, tenantId);
  if (!existing || existing.kintoneApiToken) return existing;

  const updated: TenantRecord = {
    ...existing,
    kintoneApiToken,
    updatedAt: new Date().toISOString(),
  };
  await kv.put(buildTenantRecordKey(tenantId), JSON.stringify(updated));
  return updated;
};

export const issueEditorToken = async (
  tenantId: string,
  tenantSecret: string,
  ttlMs: number = DEFAULT_TOKEN_TTL_MS,
): Promise<{ token: string; expiresAt: string }> => {
  const exp = Date.now() + ttlMs;
  const payload = { tenantId, exp };
  const payloadB64 = base64UrlEncode(textEncoder.encode(JSON.stringify(payload)));
  const signature = await signHmac(tenantSecret, payloadB64);
  const token = `${payloadB64}.${signature}`;
  return { token, expiresAt: new Date(exp).toISOString() };
};

export const verifyEditorToken = async (
  kv: KVNamespace,
  token: string,
): Promise<{ tenantId: string; record: TenantRecord } | null> => {
  const [payloadB64, signature] = token.split(".");
  if (!payloadB64 || !signature) return null;
  const payload = parseJsonPayload<{ tenantId?: string; exp?: number }>(payloadB64);
  if (!payload?.tenantId || !payload.exp) return null;
  if (Date.now() > payload.exp) return null;

  const record = await getTenantRecord(kv, payload.tenantId);
  if (!record) return null;

  const expected = await signHmac(record.tenantSecret, payloadB64);
  if (!timingSafeEqual(expected, signature)) return null;

  return { tenantId: payload.tenantId, record };
};
