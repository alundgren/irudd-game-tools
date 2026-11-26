import { build } from "esbuild";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
if (!existsSync("examples/mhr-reference.glb")) {
  console.error("examples/mhr-reference.glb is not installed. See docs/local-references.md.");
  process.exit(1);
}
const bundle = await build({
  entryPoints: ["scripts/fit-rig-surface.js"],
  platform: "node",
  format: "esm",
  bundle: true,
  loader: { ".webp": "empty" },
  write: false,
});
const { fitRig } = await import(
  "data:text/javascript;base64," +
    Buffer.from(bundle.outputFiles[0].contents).toString("base64")
);
const source = await readFile("examples/mhr-reference.glb");
const { fit, report } = await fitRig(
  source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength),
);
await writeFile("examples/mhr-fit.json", JSON.stringify(fit, null, 2) + "\n");
await writeFile(
  "docs/media/mhr-surface-errors.json",
  JSON.stringify(report, null, 2) + "\n",
);
console.log(report);
