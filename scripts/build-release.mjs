import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dist = join(root, "dist");
const release = join(root, "release");
const versionLabel = "v0.6";
const variants = ["full"];

await rm(release, { recursive: true, force: true });
await mkdir(release, { recursive: true });

for (const variant of variants) {
  const target = join(release, `paper-noter-${versionLabel}-${variant}`);
  await cp(dist, target, { recursive: true });

  const manifestPath = join(target, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.version_name = "0.6 Full";
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  await cp(join(root, "LICENSE"), join(target, "LICENSE"));
  await cp(join(root, "THIRD_PARTY_NOTICES.md"), join(target, "THIRD_PARTY_NOTICES.md"));
  await mkdir(join(target, "licenses"), { recursive: true });
  await cp(join(root, "node_modules", "pdfjs-dist", "LICENSE"), join(target, "licenses", "PDFJS-APACHE-2.0.txt"));
  await cp(join(root, "node_modules", "katex", "LICENSE"), join(target, "licenses", "KATEX-MIT.txt"));

  const installText = "Paper Noter v0.6 Full\r\n\r\nOpen chrome://extensions, enable Developer mode, click Load unpacked, and select this folder.\r\nFull includes complete CMap, standard-font fallback, WASM, and ICC resources.\r\n";
  await writeFile(join(target, "INSTALL.txt"), installText, "utf8");
}

console.log(`Prepared ${variants.length} release folders in ${release}`);
