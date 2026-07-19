import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(resolve(dist, "vendor"), { recursive: true });
await cp(resolve(root, "src"), dist, { recursive: true });
await cp(resolve(root, "manifest.json"), resolve(dist, "manifest.json"));
await cp(
  resolve(root, "node_modules/pdfjs-dist/build/pdf.mjs"),
  resolve(dist, "vendor/pdf.mjs"),
);
await cp(
  resolve(root, "node_modules/pdfjs-dist/build/pdf.worker.mjs"),
  resolve(dist, "vendor/pdf.worker.mjs"),
);
for (const directory of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
  await cp(resolve(root, `node_modules/pdfjs-dist/${directory}`), resolve(dist, `vendor/${directory}`), { recursive: true });
}

console.log(`Built unpacked extension at ${dist}`);
