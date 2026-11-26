import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite-plus";

export const repository = resolve(fileURLToPath(new URL("../../", import.meta.url)));

export const reportFormat = "irudd.bundle-inputs";
export const reportVersion = 1;

export interface BundleReport {
  readonly format: typeof reportFormat;
  readonly version: typeof reportVersion;
  readonly bundle: string;
  readonly inputs: ReadonlyArray<string>;
  readonly outputs: ReadonlyArray<string>;
  readonly firstParty: ReadonlyArray<string>;
  readonly packages: ReadonlyArray<string>;
  readonly virtual: ReadonlyArray<string>;
  readonly externals: ReadonlyArray<string>;
}

function clean(id: string): string {
  return id.replace(/[?#].*$/, "").replaceAll("\\", "/");
}

export function moduleId(id: string): string {
  const file = clean(id);
  if (!isAbsolute(file)) return file;
  return relative(repository, file).split(sep).join("/").replaceAll("\\", "/");
}

export function bundleReport(
  name: string,
  reportDir: string,
  renames: Readonly<Record<string, string>> = {},
): Plugin {
  let report: BundleReport | undefined;
  return {
    name: "irudd-bundle-report",
    generateBundle(_options, bundle) {
      const loaded = new Set<string>();
      const externals = new Set<string>();
      for (const output of Object.values(bundle)) {
        if (output.type !== "chunk") continue;
        for (const id of Object.keys(output.modules)) loaded.add(id);
        for (const id of [...output.imports, ...output.dynamicImports])
          if (!bundle[id]) externals.add(id);
      }
      const firstParty: string[] = [];
      const packages: string[] = [];
      const virtual: string[] = [];
      for (const id of loaded) {
        const file = clean(id);
        if (id.startsWith("\0") || !isAbsolute(file)) virtual.push(id.replace(/^\0/, ""));
        else if (file.split("/").includes("node_modules")) packages.push(moduleId(file));
        else firstParty.push(moduleId(file));
      }
      report = {
        format: reportFormat,
        version: reportVersion,
        bundle: name,
        inputs: [...firstParty, ...packages, ...virtual.map((id) => "virtual:" + id)].sort(),
        outputs: [],
        firstParty: firstParty.sort(),
        packages: packages.sort(),
        virtual: virtual.sort(),
        externals: [...externals].sort(),
      };
    },
    writeBundle(options, bundle) {
      if (!report) return;
      const dir = options.dir ?? (options.file ? dirname(options.file) : reportDir);
      report = {
        ...report,
        outputs: Object.keys(bundle)
          .map((file) => moduleId(join(dir, renames[file] ?? file)))
          .sort(),
      };
      mkdirSync(reportDir, { recursive: true });
      writeFileSync(join(reportDir, `${name}.inputs.json`), JSON.stringify(report, null, 2) + "\n");
    },
  };
}
