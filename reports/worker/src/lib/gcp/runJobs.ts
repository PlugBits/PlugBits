const GOOGLE_TOKEN_URI = "https://oauth2.googleapis.com/token";
const GOOGLE_CLOUD_PLATFORM_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const DEFAULT_GCP_RUN_JOB_TIMEOUT_MS = 30_000;

export type CloudRunJobDispatchConfig = {
  projectId: string;
  region: string;
  jobName: string;
  serviceAccountClientEmail: string;
  serviceAccountPrivateKey: string;
  tokenUri?: string | null;
  requestTimeoutMs?: number | null;
  taskTimeout?: string | null;
};

const toBase64Url = (input: string | ArrayBuffer | Uint8Array) => {
  const bytes = typeof input === "string"
    ? new TextEncoder().encode(input)
    : input instanceof Uint8Array
      ? input
      : new Uint8Array(input);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

const pemToArrayBuffer = (pem: string): ArrayBuffer => {
  const normalized = pem.replace(/\\n/g, "\n");
  const body = normalized
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
};

const importPrivateKey = async (privateKeyPem: string) =>
  crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(privateKeyPem),
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
    },
    false,
    ["sign"],
  );

const signJwt = async (header: Record<string, unknown>, claims: Record<string, unknown>, privateKeyPem: string) => {
  const encodedHeader = toBase64Url(JSON.stringify(header));
  const encodedClaims = toBase64Url(JSON.stringify(claims));
  const signingInput = `${encodedHeader}.${encodedClaims}`;
  const key = await importPrivateKey(privateKeyPem);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${toBase64Url(signature)}`;
};

const fetchWithTimeout = async (input: string, init: RequestInit, timeoutMs: number) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("gcp-timeout"), timeoutMs);
  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
};

const getGoogleAccessToken = async (config: CloudRunJobDispatchConfig): Promise<string> => {
  const issuedAt = Math.floor(Date.now() / 1000);
  const tokenUri = config.tokenUri?.trim() || GOOGLE_TOKEN_URI;
  const assertion = await signJwt(
    { alg: "RS256", typ: "JWT" },
    {
      iss: config.serviceAccountClientEmail,
      scope: GOOGLE_CLOUD_PLATFORM_SCOPE,
      aud: tokenUri,
      iat: issuedAt,
      exp: issuedAt + 3600,
    },
    config.serviceAccountPrivateKey,
  );
  const response = await fetchWithTimeout(
    tokenUri,
    {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }).toString(),
    },
    config.requestTimeoutMs ?? DEFAULT_GCP_RUN_JOB_TIMEOUT_MS,
  );
  const payload = await response.json().catch(() => null) as { access_token?: string; error?: string; error_description?: string } | null;
  if (!response.ok || !payload?.access_token) {
    const detail = payload?.error_description ?? payload?.error ?? `oauth ${response.status}`;
    throw new Error(`RENDERER_HTTP_FAILED: google access token failed: ${detail}`);
  }
  return payload.access_token;
};

const findStringDeep = (value: unknown, matcher: (entry: string) => boolean): string | null => {
  if (typeof value === "string") {
    return matcher(value) ? value : null;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findStringDeep(entry, matcher);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  for (const entry of Object.values(value as Record<string, unknown>)) {
    const found = findStringDeep(entry, matcher);
    if (found) return found;
  }
  return null;
};

export const runCloudRunJob = async (
  config: CloudRunJobDispatchConfig,
  args: {
    jobId: string;
    requestId: string;
    containerName?: string | null;
  },
) => {
  const accessToken = await getGoogleAccessToken(config);
  const timeoutMs = config.requestTimeoutMs ?? DEFAULT_GCP_RUN_JOB_TIMEOUT_MS;
  const jobResourceName =
    `projects/${config.projectId}/locations/${config.region}/jobs/${config.jobName}`;
  const url = `https://run.googleapis.com/v2/${jobResourceName}:run`;
  const response = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${accessToken}`,
        "x-goog-request-params": `name=${jobResourceName}`,
      },
      body: JSON.stringify({
        overrides: {
          containerOverrides: [
            {
              ...(args.containerName ? { name: args.containerName } : {}),
              args: ["dist/src/jobRunner.js", `--job-id=${args.jobId}`],
            },
          ],
          taskCount: 1,
          ...(config.taskTimeout ? { timeout: config.taskTimeout } : {}),
        },
      }),
    },
    timeoutMs,
  );
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) {
    const message = typeof payload?.message === "string"
      ? payload.message
      : typeof payload?.error === "object" && payload?.error && "message" in payload.error
        ? String((payload.error as { message?: unknown }).message ?? "")
        : `cloud run jobs.run ${response.status}`;
    throw new Error(`RENDERER_HTTP_FAILED: ${message}`);
  }

  const executionName = findStringDeep(
    payload,
    (entry) => entry.includes(`/jobs/${config.jobName}/executions/`),
  );
  const operationName = typeof payload?.name === "string" ? payload.name : null;

  return {
    executionName: executionName ?? operationName,
    operationName,
    dispatchedAt: new Date().toISOString(),
    raw: payload,
  };
};
