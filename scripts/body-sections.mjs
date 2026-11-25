// JSON-lines helper for body-fidelity.py. Bundle the same clay geometry as
// the workshop. Bitmap assets are unnecessary for silhouette measurement.
import { build } from "esbuild";
import { createInterface } from "node:readline";
const bundle = await build({
  entryPoints: ["scripts/body-sections.js"],
  bundle: true,
  platform: "node",
  format: "esm",
  loader: { ".webp": "empty" },
  write: false,
});
const { sections } = await import(
  "data:text/javascript;base64," +
    Buffer.from(bundle.outputFiles[0].contents).toString("base64")
);
for await (const line of createInterface({ input: process.stdin })) {
  try {
    const { figure, rows = 96, angles = [0, 90] } = JSON.parse(line);
    if (
      !Number.isInteger(rows) ||
      rows < 8 ||
      rows > 512 ||
      !Array.isArray(angles) ||
      !angles.length ||
      angles.length > 8 ||
      !angles.every(Number.isFinite)
    )
      throw Error("Invalid sampling grid");
    console.log(JSON.stringify(sections(figure, rows, angles)));
  } catch (error) {
    console.log(JSON.stringify({ error: error.message }));
  }
}
