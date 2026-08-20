import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dist = join(root, "dist");
const release = join(root, "release");
const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const displayVersion = String(packageJson.version).replace(/\.0$/, "");
const versionLabel = `v${displayVersion}`;
const variants = ["full"];

await rm(release, { recursive: true, force: true });
await mkdir(release, { recursive: true });

for (const variant of variants) {
  const target = join(release, `paper-noter-${versionLabel}-${variant}`);
  await cp(dist, target, { recursive: true });

  const manifestPath = join(target, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  // Keep the fixed development ID in source/dist, but omit it from packages
  // uploaded to the Chrome Web Store, which rejects manifests with `key`.
  delete manifest.key;
  manifest.version_name = `${displayVersion} Full`;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  await cp(join(root, "LICENSE"), join(target, "LICENSE"));
  await cp(join(root, "THIRD_PARTY_NOTICES.md"), join(target, "THIRD_PARTY_NOTICES.md"));
  await mkdir(join(target, "licenses"), { recursive: true });
  await cp(join(root, "node_modules", "pdfjs-dist", "LICENSE"), join(target, "licenses", "PDFJS-APACHE-2.0.txt"));
  await cp(join(root, "node_modules", "katex", "LICENSE"), join(target, "licenses", "KATEX-MIT.txt"));

  const installText = `Paper Noter ${versionLabel} Full\r\n\r\nOpen chrome://extensions, enable Developer mode, click Load unpacked, and select this folder.\r\nFull includes complete CMap, standard-font fallback, WASM, and ICC resources.\r\n`;
  await writeFile(join(target, "INSTALL.txt"), installText, "utf8");
}

console.log(`Prepared ${variants.length} release folders in ${release}`);
