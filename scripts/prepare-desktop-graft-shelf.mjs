import { execFileSync } from "node:child_process";
import { build } from "esbuild";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "../apps/desktop/node_modules/@playwright/test/index.mjs";
import { prepareForm } from "../verification/families/src/prepare.ts";

const root = fileURLToPath(new URL("../", import.meta.url));
const harness = await build({
  stdin: {
    resolveDir: root,
    contents: `
      import { componentEntries } from "./character-view/components.js";
      import { paintedStudies } from "./examples/painted-studies.js";
      import { studies } from "./examples/studies.js";
      import { paintSources, retainPaintSources } from "./character-view/paint-sources.js";
      import { loadTurnarounds } from "./character-view/turnaround.js";
      window.shelfComponents = async () => {
        await loadTurnarounds();
        return componentEntries.map(([key, label, study, root, children]) => {
          const original = [...paintedStudies, ...studies].find(s => s.id === study).make();
          const keep = new Set([root]);
          function branch(id) {
            for (const p of original.parts) {
              if (p.parent !== id) continue;
              keep.add(p.id);
              branch(p.id);
            }
          }
          if (children) branch(root);
          let ancestor = original.parts.find(p => p.id === root);
          while (ancestor?.parent) {
            keep.add(ancestor.parent);
            ancestor = original.parts.find(p => p.id === ancestor.parent);
          }
          const parts = original.parts.filter(p => keep.has(p.id));
          const form = retainPaintSources({ ...original, parts }, paintSources(original));
          delete form.poses;
          delete form.layerStyles;
          delete form.outfitSets;
          return { key, label, children, root, form };
        });
      };
    `,
  },
  bundle: true,
  write: false,
  loader: { ".webp": "dataurl", ".glb": "dataurl" },
});
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage();
  await page.addScriptTag({ content: harness.outputFiles[0].text });
  const rows = await page.evaluate(() => window.shelfComponents());
  const shelf = rows.map(({ key, label, children, root, form }) => {
    const { document } = prepareForm(key, form);
    const part = document.parts.find(p => p.label === root);
    if (!part) throw new Error("Missing shelf part " + root);
    return { key, label, root: part.id, children, document };
  });
  const file = new URL("../apps/desktop/src/renderer/graft-shelf.json", import.meta.url);
  writeFileSync(file, JSON.stringify(shelf, null, 2) + "\n");
  const formatter = fileURLToPath(new URL("../node_modules/vite-plus/bin/vp", import.meta.url));
  execFileSync(process.execPath, [formatter, "fmt", fileURLToPath(file)], { cwd: root });
} finally {
  await browser.close();
}
