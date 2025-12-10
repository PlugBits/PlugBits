// worker/src/index.ts
import type {
  TemplateDefinition,
  TemplateDataRecord,
} from "../../shared/template.js";

import { renderTemplateToPdf } from "./pdf/renderTemplate.js";
import { getDefaultFontBytes } from "./fonts/fontLoader.js";
import { SAMPLE_TEMPLATE } from "../../shared/template.js";


// Wrangler の env 定義（あってもなくても動くよう optional にする）
export interface Env {
  FONT_SOURCE_URL?: string;
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
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
};

// フォント読み込み（今はデフォルト埋め込みフォントだけ）
async function loadFontBytes(env: Env): Promise<Uint8Array> {
  // 将来 FONT_SOURCE_URL から外部フォントを読む場合はここに処理を追加
  return getDefaultFontBytes(env);
}


 // templateId から TemplateDefinition を引く関数
 
async function getTemplateById(
  id: string,
  env: Env,
): Promise<TemplateDefinition<TemplateDataRecord>> {
  const candidates = [
    id,
    `template:${id}`,
    `tpl_${id}`,
    `template_${id}`,
  ];

  for (const key of candidates) {
    const value = await env.TEMPLATE_KV.get(key);
    if (value) {
      console.log('Loaded template from KV key:', key);
      return JSON.parse(value) as TemplateDefinition<TemplateDataRecord>;
    }
  }

  // ここまで来たら本当に無い
  throw new Error(`Unknown templateId: ${id}`);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
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

    // PDF レンダリング API
    if (url.pathname === "/render" && request.method === "POST") {
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

      // template / templateId のどちらかから TemplateDefinition を決定
      let template: TemplateDefinition<TemplateDataRecord>;

      if (body.template) {
        // 既存の UI などから template 本体を送ってくるパターン
        template = body.template;
      } else if (body.templateId) {
        // kintone プラグインから templateId だけ送ってくるパターン
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
        // どちらもない場合はエラー
        return new Response(
          "Missing 'template' or 'templateId' in request body",
          {
            status: 400,
            headers: CORS_HEADERS,
          },
        );
      }

      // フォント読み込み
      let fontBytes: Uint8Array;
      try {
        fontBytes = await loadFontBytes(env);
        console.log("fontBytes length:", fontBytes.length);
      } catch (err) {
        console.error("Failed to load font:", err);
        return new Response("Failed to load font", {
          status: 500,
          headers: CORS_HEADERS,
        });
      }

      // PDF 生成
      try {
        const rawPdfBytes = await renderTemplateToPdf(
          template,
          body.data as TemplateDataRecord | undefined,
          fontBytes,
        );

        const pdfBytes = new Uint8Array(rawPdfBytes);

        return new Response(pdfBytes, {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            "Content-Type": "application/pdf",
          },
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
  },
};
