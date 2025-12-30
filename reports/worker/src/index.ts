// worker/src/index.ts
import type {
  TemplateDefinition,
  TemplateDataRecord,
} from "../../shared/template.js";
import { TEMPLATE_SCHEMA_VERSION } from "../../shared/template.js";

import { renderTemplateToPdf } from "./pdf/renderTemplate.ts";
import { getFonts } from "./fonts/fontLoader.js";
import { getFixtureData } from "./fixtures/templateData.js";
import { migrateTemplate, validateTemplate } from "./template/migrate.js";


// Wrangler の env 定義（あってもなくても動くよう optional にする）
export interface Env {
  FONT_SOURCE_URL?: string;
  LATIN_FONT_URL?: string; 
  ADMIN_API_KEY?: string;
  TEMPLATE_KV: KVNamespace;
}

// /render が受け取る JSON ボディ
type RenderRequestBody = {
  // 既存フロントエンド向け: テンプレート本体をそのまま送るパターン
  template?: TemplateDefinition;

  // kintone プラグイン向け: templateId だけ送るパターン
  templateId?: string;

  // テンプレートに流し込むデータ（TemplateDataRecord は shared/template.ts 側の型）
  data?: TemplateDataRecord;

  // 将来用: kintone に関するメタ情報など（今の実装では未使用）
  kintone?: unknown;
};

// CORS 設定
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, x-api-key",
  "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
};

const truncateHeaderValue = (value: string, maxLength = 200) =>
  value.length > maxLength ? value.slice(0, maxLength) : value;

// フォント読み込み（今はデフォルト埋め込みフォントだけ）
async function loadFonts(env: Env): Promise<{ jp: Uint8Array; latin: Uint8Array }> {
  // 将来 FONT_SOURCE_URL から外部フォントを読む場合はここに処理を追加
  return getFonts(env);
}


 // templateId から TemplateDefinition を引く関数
 
const TEMPLATE_IDS = new Set(["list_v1", "card_v1", "multiTable_v1"]);

async function getTemplateById(
  id: string,
  env: Env,
): Promise<TemplateDefinition<TemplateDataRecord>> {
  const key = `tpl:${id}`;
  const value = await env.TEMPLATE_KV.get(key);
  if (value) {
    console.log('Loaded template from KV key:', key);
    return JSON.parse(value) as TemplateDefinition<TemplateDataRecord>;
  }

  throw new Error(`Unknown templateId: ${id}`);
}

const buildTemplateHeaders = (
  migrated: TemplateDefinition,
  didMigrate: boolean,
  warnCount: number,
): Record<string, string> => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Template-Schema-Version": String(
      migrated.schemaVersion ?? TEMPLATE_SCHEMA_VERSION,
    ),
    "X-Warn-Count": String(warnCount),
  };
  if (didMigrate) headers["X-Template-Migrated"] = "1";
  return headers;
};

const normalizeTemplatePayload = (
  input: unknown,
): { ok: true; template: TemplateDefinition } | { ok: false; message: string } => {
  if (!input || typeof input !== "object") {
    return {
      ok: false,
      message: "Invalid template payload. Expected TemplateDefinition or { template: TemplateDefinition }",
    };
  }

  const obj = input as Record<string, unknown>;
  const candidate =
    typeof obj.template === "object" && obj.template !== null
      ? (obj.template as Record<string, unknown>)
      : obj;

  if (!("pageSize" in candidate) || !("elements" in candidate)) {
    return {
      ok: false,
      message: "Invalid template payload. Expected TemplateDefinition or { template: TemplateDefinition }",
    };
  }

  return { ok: true, template: candidate as TemplateDefinition };
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);

      // CORS preflight
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: CORS_HEADERS,
        });
      }

      // ヘルスチェック
      if (url.pathname === "/" && request.method === "GET") {
        return new Response("PlugBits report worker is running.", {
          status: 200,
          headers: CORS_HEADERS,
        });
      }

      const templateMatch = url.pathname.match(/^\/templates\/([^/]+)$/);
      if (templateMatch) {
        const templateId = templateMatch[1];
        if (!TEMPLATE_IDS.has(templateId)) {
          return new Response("Unknown templateId", {
            status: 400,
            headers: CORS_HEADERS,
          });
        }

        if (request.method === "GET") {
          try {
            const rawTemplate = await getTemplateById(templateId, env);
            const schemaVersionBefore = rawTemplate.schemaVersion ?? 0;
            const migratedTemplate = migrateTemplate(rawTemplate);
            const didMigrate = schemaVersionBefore < TEMPLATE_SCHEMA_VERSION;
            const { ok, issues } = validateTemplate(migratedTemplate);
            const warnCount = issues.filter((issue) => issue.level === "warn").length;

            const headers: Record<string, string> = {
              ...CORS_HEADERS,
              ...buildTemplateHeaders(migratedTemplate, didMigrate, warnCount),
            };

            if (!ok) {
              return new Response(JSON.stringify({ ok: false, issues }), {
                status: 400,
                headers,
              });
            }

            return new Response(JSON.stringify(migratedTemplate), {
              status: 200,
              headers,
            });
          } catch {
            return new Response("Template not found", {
              status: 404,
              headers: CORS_HEADERS,
            });
          }
        }

        if (request.method === "PUT") {
          if (env.ADMIN_API_KEY) {
            const apiKey = request.headers.get("x-api-key");
            if (apiKey !== env.ADMIN_API_KEY) {
              return new Response("Unauthorized", {
                status: 401,
                headers: CORS_HEADERS,
              });
            }
          }

          let templateBody: TemplateDefinition;
          try {
            const rawPayload = await request.json();
            const normalized = normalizeTemplatePayload(rawPayload);
            if (!normalized.ok) {
              return new Response(normalized.message, {
                status: 400,
                headers: CORS_HEADERS,
              });
            }
            templateBody = normalized.template;
          } catch {
            return new Response("Invalid JSON body", {
              status: 400,
              headers: CORS_HEADERS,
            });
          }

          const schemaVersionBefore = templateBody.schemaVersion ?? 0;
          const migratedTemplate = migrateTemplate(templateBody);
          const didMigrate = schemaVersionBefore < TEMPLATE_SCHEMA_VERSION;
          const { ok, issues } = validateTemplate(migratedTemplate);
          const warnCount = issues.filter((issue) => issue.level === "warn").length;
          const headers: Record<string, string> = {
            ...CORS_HEADERS,
            ...buildTemplateHeaders(migratedTemplate, didMigrate, warnCount),
          };

          if (!ok) {
            return new Response(JSON.stringify({ ok: false, issues }), {
              status: 400,
              headers,
            });
          }

          await env.TEMPLATE_KV.put(
            `tpl:${templateId}`,
            JSON.stringify(migratedTemplate),
          );

          return new Response(JSON.stringify(migratedTemplate), {
            status: 200,
            headers,
          });
        }

        return new Response("Method Not Allowed", {
          status: 405,
          headers: CORS_HEADERS,
        });
      }

      // PDF レンダリング API
      if (
        (url.pathname === "/render" || url.pathname === "/render-preview") &&
        request.method === "POST"
      ) {
        let body: RenderRequestBody;

        // JSON パース
        try {
          body = (await request.json()) as RenderRequestBody;
        } catch {
          return new Response("Invalid JSON body", {
            status: 400,
            headers: CORS_HEADERS,
          });
        }

        const debug = url.searchParams.get("debug") === "1";

        // template / templateId のどちらかから TemplateDefinition を決定
        let template: TemplateDefinition<TemplateDataRecord>;

        if (body.template) {
          template = body.template;
        } else if (body.templateId) {
          if (!TEMPLATE_IDS.has(body.templateId)) {
            return new Response("Unknown templateId", {
              status: 400,
              headers: CORS_HEADERS,
            });
          }
          if (body.templateId !== "list_v1") {
            return new Response(
              JSON.stringify({
                ok: false,
                code: "UNSUPPORTED_TEMPLATE",
                message: `templateId ${body.templateId} is not supported yet`,
              }),
              {
                status: 400,
                headers: {
                  ...CORS_HEADERS,
                  "Content-Type": "application/json",
                },
              },
            );
          }
          try {
            template = await getTemplateById(body.templateId, env);
          } catch (err) {
            const msg =
              err instanceof Error ? err.message : "Unknown templateId";
            return new Response(msg, {
              status: 400,
              headers: CORS_HEADERS,
            });
          }
        } else {
          return new Response(
            "Missing 'template' or 'templateId' in request body",
            {
              status: 400,
              headers: CORS_HEADERS,
            },
          );
        }

        const fixtureName = url.searchParams.get("fixture");
        console.log("fixture=", fixtureName);
        const fixtureData = fixtureName ? getFixtureData(fixtureName) : undefined;
        if (fixtureName && !fixtureData) {
          return new Response(`Unknown fixture: ${fixtureName}`, {
            status: 400,
            headers: CORS_HEADERS,
          });
        }
        const schemaVersionBefore = template.schemaVersion ?? 0;
        const migratedTemplate = migrateTemplate(template);
        const didMigrate = schemaVersionBefore < TEMPLATE_SCHEMA_VERSION;
        const { ok, issues } = validateTemplate(migratedTemplate);
        const issueWarnings = issues.map((issue) => {
          const category = issue.level === "error" ? "layout" : "data";
          const pathSuffix = issue.path ? ` (${issue.path})` : "";
          return `[${category}] template ${issue.code}: ${issue.message}${pathSuffix}`;
        });
        const schemaHeaderValue = String(
          migratedTemplate.schemaVersion ?? TEMPLATE_SCHEMA_VERSION,
        );

        if (!ok) {
          const headers: Record<string, string> = {
            ...CORS_HEADERS,
            "Content-Type": "application/json",
            "X-Template-Schema-Version": schemaHeaderValue,
            "X-Warn-Count": String(issueWarnings.length),
          };
          if (didMigrate) headers["X-Template-Migrated"] = "1";
          if (debug && issueWarnings.length > 0) {
            headers["X-Debug-Warn-Sample"] = truncateHeaderValue(issueWarnings[0]);
          }

          return new Response(
            JSON.stringify({ ok: false, issues }),
            {
              status: 400,
              headers,
            },
          );
        }

        const rowHeightParam = url.searchParams.get("rowHeight");
        const rowHeightOverride = rowHeightParam ? Number(rowHeightParam) : undefined;
        const hasRowHeightOverride =
          typeof rowHeightOverride === "number" &&
          Number.isFinite(rowHeightOverride) &&
          rowHeightOverride > 0;

        const templateForRender = hasRowHeightOverride
          ? {
              ...migratedTemplate,
              elements: migratedTemplate.elements.map((el) =>
                el.type === "table" && el.id === "items"
                  ? { ...el, rowHeight: rowHeightOverride }
                  : el,
              ),
            }
          : migratedTemplate;
        const dataForRender = (fixtureData ?? body.data) as unknown;

        const rowsCount = (() => {
          if (dataForRender && typeof dataForRender === "object") {
            const maybeItems = (dataForRender as any).Items;
            if (Array.isArray(maybeItems)) return maybeItems.length;
          }
          return "(unknown)";
        })();

        // フォント読み込み
        let fonts: { jp: Uint8Array; latin: Uint8Array };  // ← これが大事！！
        try {
          fonts = await loadFonts(env);
          console.log(
            "jpFont length:", fonts.jp.length,
            "latinFont length:", fonts.latin.length,
          );
        } catch (err) {
          console.error("Failed to load font:", err);
          return new Response("Failed to load font", {
            status: 500,
            headers: CORS_HEADERS,
          });
        }

        // PDF 生成
        try {
          const { bytes: rawPdfBytes, warnings } = await renderTemplateToPdf(
            templateForRender,
            dataForRender as TemplateDataRecord | undefined,
            fonts,
            { debug },
          );

          const pdfBytes = new Uint8Array(rawPdfBytes);
          const combinedWarnings = [...issueWarnings, ...warnings];
          const warnCount = combinedWarnings.length;
          const headers: Record<string, string> = {
            ...CORS_HEADERS,
            "Content-Type": "application/pdf",
            "X-Debug-Fixture": fixtureName ?? "(none)",
            "X-Debug-Rows": String(rowsCount),
            "X-Warn-Count": String(warnCount),
            "X-Template-Schema-Version": schemaHeaderValue,
          };
          if (didMigrate) headers["X-Template-Migrated"] = "1";

          if (debug && warnCount > 0) {
            headers["X-Debug-Warn-Sample"] = truncateHeaderValue(combinedWarnings[0]);
          }

          return new Response(pdfBytes, {
            status: 200,
            headers,
          });
        } catch (err) {
          console.error("Failed to render template:", err);
          return new Response("Failed to render template", {
            status: 500,
            headers: CORS_HEADERS,
          });
        }
      }

      // その他のパス
      return new Response("Not Found", { status: 404, headers: CORS_HEADERS });
    } catch (err) {
      // ここに来るのは「本当に想定外」の例外
      console.error("Unhandled error in worker:", err);
      return new Response("Internal error", {
        status: 500,
        headers: CORS_HEADERS,
      });
    }
  },
};
