import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { deflateSync } from "node:zlib";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url)),
  requireDesktop = createRequire(join(root, "apps/desktop/package.json"));
import { build } from "vite-plus";
const { chromium } = requireDesktop("@playwright/test");
const dir = mkdtempSync(join(tmpdir(), "irudd-headwear-"));
try {
  await build({
    configFile: false,
    logLevel: "error",
    build: {
      target: "esnext",
      lib: {
        entry: join(root, "scripts/fit-desktop-headwear.mjs"),
        formats: ["iife"],
        name: "headwear",
        fileName: () => "heads.js",
      },
      outDir: dir,
      assetsInlineLimit: Infinity,
    },
  });
  writeFileSync(join(dir, "index.html"), '<script src="./heads.js"></script>');
  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: ["--use-angle=default"],
  });
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(join(dir, "index.html")).href);
    await page.evaluate(() => headwear.ready());
    const cuts = await page.evaluate(() => headwear.cuts),
      records = {},
      entries = [],
      blobs = new Map();
    function entry(kind, base64) {
      if (!base64) return "";
      const raw = Buffer.from(base64, "base64"),
        sha = createHash("sha256").update(raw).digest("hex");
      const key = kind + ":" + sha;
      if (blobs.has(key)) return blobs.get(key);
      const id = "m" + entries.length;
      entries.push({
        id,
        kind,
        count: raw.length / { u8: 1, i16: 2, u32: 4 }[kind],
        blob: deflateSync(raw, { level: 9 }),
      });
      blobs.set(key, id);
      return id;
    }
    function packMesh(m) {
        const record = {
          ...m,
          morphs: m.morphs.map((t) => ({ name: t.name, data: entry("i16", t.data) })),
        };
        for (const [key, kind] of Object.entries({
          points: "i16",
          normals: "i16",
          uv: "i16",
          colors: "u8",
          indices: "u32",
          bones: "u8",
          weights: "u8",
        }))
          record[key] = entry(kind, record[key]);
        for (const key of ["map", "normalMap", "bumpMap", "roughMap", "metalMap", "occlusion"])
          if (record[key]) record[key] = { ...record[key], data: entry("u8", record[key].data) };
        return record;

    }
    for (const [field, cut] of cuts) {
      const meshes = await page.evaluate(([f,c]) => headwear.fit(f,c), [field,cut]);
      if (!meshes.length) throw new Error(cut + " has no drawable mesh");
      records[cut] = meshes.map(packMesh);
      if (field === "hair") {
        for (const fringe of ["Parted","Swept left","Swept right","Off the face"]) {
          const variant = await page.evaluate(([f,c,b]) => headwear.fit(f,c,b), [field,cut,fringe]);
          const parts = variant.map(packMesh);
          if (JSON.stringify(parts) !== JSON.stringify(records[cut])) records[cut + "/" + fringe] = parts;
        }
      }
      console.log(cut, meshes.length);
    }
    const header = Buffer.alloc(12);
    header.write("IRHP");
    header.writeUInt32LE(1, 4);
    header.writeUInt32LE(entries.length, 8);
    const headers = entries.map(({ id, kind, count, blob }) => {
      const b = Buffer.alloc(id.length + 10);
      b[0] = id.length;
      b.write(id, 1);
      b[1 + id.length] = { u8: 1, i16: 4, u32: 3 }[kind];
      b.writeUInt32LE(count, id.length + 2);
      b.writeUInt32LE(blob.length, id.length + 6);
      return b;
    });
    const packed = Buffer.concat([header, ...headers, ...entries.map((v) => v.blob)]);
    writeFileSync(join(root, "packages/character/assets/human/human-headwear.bin"), packed);
    const digest = "sha256:" + createHash("sha256").update(packed).digest("hex");
    const library =
      'import type { HeadwearMesh } from "./headwear-types.js";\nexport const headwear: Readonly<Record<string, readonly HeadwearMesh[]>> = ' +
      JSON.stringify(records, null, 2) +
      ";\nexport const headwearPack = {byteLength:" +
      packed.length +
      ',digest:"' +
      digest +
      '"} as const;\n';
    writeFileSync(join(root, "packages/character/src/human/headwear-library.ts"), library);
    console.log(packed.length, digest);
  } finally {
    await browser.close();
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
