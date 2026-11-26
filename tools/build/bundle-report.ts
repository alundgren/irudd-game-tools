// A Vite plugin that records what went into a bundle: every loaded module and
// every external, as `<name>.inputs.json` next to the output. The static
// bundle checks read these files; nothing at runtime does.
//
// Module IDs are repository-relative POSIX paths. Package modules keep their
// real pnpm store path under node_modules/.pnpm, so the version is visible.

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
  /** Every loaded module: first-party and package paths, and `virtual:` helper IDs. */
  readonly inputs: ReadonlyArray<string>;
  /** Emitted files, relative to the repository. */
  readonly outputs: ReadonlyArray<string>;
  /** First-party modules, repository-relative. */
  readonly firstParty: ReadonlyArray<string>;
  /** Package modules, repository-relative under node_modules/.pnpm. */
  readonly packages: ReadonlyArray<string>;
  /** Modules with no file (Vite helpers, `\0` virtual modules). */
  readonly virtual: ReadonlyArray<string>;
  /** Imports left to the runtime (Electron, Node built-ins). */
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

/**
 * Record the bundle's inputs. `name` names the report; it is written to
 * `reportDir/<name>.inputs.json` once the bundle is written.
 */
export function bundleReport(
  name: string,
  reportDir: string,
  /** Output files the build renames after Vite writes them. */
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
