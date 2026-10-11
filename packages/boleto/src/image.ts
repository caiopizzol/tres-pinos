// Barcodes in an image: boleto ITF and Pix QR, decoded by ZXing-C++ compiled to WebAssembly.
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";

// The package fetches its WebAssembly from a CDN unless given the bytes; reading them from
// disk keeps every run offline.
const wasm = createRequire(import.meta.url).resolve("zxing-wasm/reader/zxing_reader.wasm");
prepareZXingModule({
  overrides: { wasmBinary: (await readFile(wasm)).buffer },
});

export type Symbol = { format: "ITF" | "QRCode"; text: string };

export async function decode(image: Uint8Array): Promise<Symbol[]> {
  const results = await readBarcodes(image, {
    formats: ["ITF", "QRCode"],
    tryHarder: true,
    tryRotate: true,
  });
  return results.flatMap((result) =>
    result.isValid && (result.format === "ITF" || result.format === "QRCode")
      ? [{ format: result.format, text: result.text }]
      : [],
  );
}
