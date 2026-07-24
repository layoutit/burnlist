declare module "pngjs/browser.js" {
  interface DecodedPng {
    width: number;
    height: number;
    data: Uint8Array;
  }
  const pngjs: {
    PNG: {
      sync: {
        read(bytes: Uint8Array): DecodedPng;
      };
    };
  };
  export default pngjs;
}
