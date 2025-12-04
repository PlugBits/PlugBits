// worker/src/fonts/fontLoader.ts
import { NOTO_SANS_JP_BASE64 } from "./notoSansJpBase64.js";

export function getDefaultFontBytes(): Uint8Array {
  const binary = globalThis.atob(NOTO_SANS_JP_BASE64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  console.log("NotoSansJP font byteLength:", bytes.length);
  return bytes;
}
