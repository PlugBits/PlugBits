// worker/src/index.ts
import type {
  TemplateDefinition,
  TemplateDataRecord,
} from "../../shared/template.js";

import { renderTemplateToPdf } from "./pdf/renderTemplate.js";
import { getDefaultFontBytes } from "./fonts/fontLoader.js";

// Wrangler の env 定義（あってもなくても動くよう optional にする）
export interface Env {
  FONT_SOURCE_URL?: string;
}

type RenderRequestBody = {
  template: TemplateDefinition;
  data?: TemplateDataRecord;
};

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
};

// フォント読み込み：
// 1. env.FONT_SOURCE_URL があればそこから fetch
// 2. なければ getDefaultFontBytes()（= ローカルの NotoSansJP）を使う
async function loadFontBytes(env: Env): Promise<Uint8Array> {
  /* if (env.FONT_SOURCE_URL) {
    const res = await fetch(env.FONT_SOURCE_URL);
    if (!res.ok) {
      throw new Error(
        `Failed to fetch font from FONT_SOURCE_URL: ${env.FONT_SOURCE_URL} (status ${res.status})`,
      );
    }
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  } */

  // デフォルトはローカル組み込みフォント
  return getDefaultFontBytes();
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

    // PDF レンダリング API
    if (url.pathname === "/render" && request.method === "POST") {
      let body: RenderRequestBody;

      try {
        body = (await request.json()) as RenderRequestBody;
      } catch (err) {
        return new Response("Invalid JSON body", {
          status: 400,
          headers: CORS_HEADERS,
        });
      }

      if (!body.template) {
        return new Response("Missing 'template' in request body", {
          status: 400,
          headers: CORS_HEADERS,
        });
      }

      let fontBytes: Uint8Array;
      try {
        fontBytes = await loadFontBytes(env);
        // デバッグ用にサイズを確認
        console.log("fontBytes length:", fontBytes.length);
      } catch (err) {
        console.error("Failed to load font:", err);
        return new Response("Failed to load font", {
          status: 500,
          headers: CORS_HEADERS,
        });
      }

      try {
        const rawPdfBytes = await renderTemplateToPdf(
          body.template,
          body.data as TemplateDataRecord | undefined,
          fontBytes,
        );

        // ★ ここで「普通の Uint8Array」に変換して型をリセットする
        const pdfBytes = new Uint8Array(rawPdfBytes);

        // その buffer は「ちゃんと ArrayBuffer」になります
        const pdfBuffer = pdfBytes.buffer;

        const blob = new Blob([pdfBuffer], { type: "application/pdf" });

        return new Response(blob, {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            "Content-Type": "application/pdf",
          },
        });

      } catch (err) {
        console.error("Failed to render PDF:", err);
        return new Response("Failed to render PDF", {
          status: 500,
          headers: CORS_HEADERS,
        });
      }
    }

    // ヘルスチェック
    if (url.pathname === "/" && request.method === "GET") {
      return new Response("PlugBits report worker is running.", {
        status: 200,
        headers: CORS_HEADERS,
      });
    }

    // その他のパス
    return new Response("Not Found", { status: 404, headers: CORS_HEADERS });
  },
};
