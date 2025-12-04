// worker/src/fonts.d.ts
declare module '*.ttf' {
  const data: ArrayBuffer;
  export default data;
}

declare module '*.otf' {
  const data: ArrayBuffer;
  export default data;
}
// worker/src/fonts.d.ts など
declare module "*.ttf.base64" {
  const value: string;
  export default value;
}
