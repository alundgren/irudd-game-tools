import { readFileSync, statSync } from "node:fs";
import { isBuiltin } from "node:module";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { bundledStyles, bundleProbes, packagedBundleProbes } from "./policy.ts";
import { checkDesktopContract } from "./desktop-contract.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item: unknown) => typeof item === "string");
}

type BundleProbe = (typeof bundleProbes)[number] | (typeof packagedBundleProbes)[number];

function check(probe: BundleProbe): void {
  const output = resolve(root, probe.output);
  const file = statSync(output);
  if (!file.isFile() || file.size === 0) throw new Error(`empty artifact ${basename(output)}`);
  const inventory: unknown = JSON.parse(
    readFileSync(resolve(dirname(output), `${probe.name}.inputs.json`), "utf8"),
  );
  if (
    typeof inventory !== "object" ||
    inventory === null ||
    !("bundle" in inventory) ||
    inventory.bundle !== probe.name ||
    !("inputs" in inventory) ||
    !strings(inventory.inputs) ||
    !("externals" in inventory) ||
    !strings(inventory.externals)
  )
    throw new Error("missing or invalid bundle inventory");
  if (!inventory.inputs.includes(probe.entry))
    throw new Error(`missing source entry ${probe.entry}`);
  for (const [style, bundles] of bundledStyles) {
    if (bundles.includes(probe.name) && !inventory.inputs.includes(style))
      throw new Error(`missing shared stylesheet ${style}`);
  }
  for (const input of inventory.inputs) {
    if (
      input.includes("\\") ||
      input.split("/").includes("..") ||
      input.startsWith("/") ||
      /^[A-Za-z]:/.test(input)
    )
      throw new Error(`expected repository-relative module ID, got ${input}`);
    if (input.includes("browser-external"))
      throw new Error(`browser stub for a platform module: ${input}`);
    if (/(^|\/)node_modules\/(electron|@irudd\/[^/]+)(\/|$)/.test(input))
      throw new Error(`expected a resolved workspace source or external Electron import: ${input}`);
    if (probe.allowedSource.test(input)) continue;
    if (probe.name !== "preload" && input.startsWith("node_modules/")) continue;
    if (input.startsWith("\0") || input.startsWith("virtual:")) continue;
    throw new Error(`unexpected input ${input}`);
  }
  for (const external of inventory.externals) {
    if ((probe.name === "main" || probe.name === "preload") && external === "electron") continue;
    if (isBuiltin(external)) {
      if (
        ["irudd", "irudd-mcp"].includes(probe.name) &&
        external.replace(/^node:/, "") === "sqlite"
      )
        throw new Error("a CLI or MCP client cannot open project storage");
      if (!["renderer", "player", "preload"].includes(probe.name)) continue;
    }
    throw new Error(`unexpected external ${external}`);
  }
  if (probe.name === "preload" && !inventory.externals.includes("electron"))
    throw new Error("missing Electron bridge external");
  if (probe.name === "main" || probe.name === "preload")
    checkDesktopContract(root, probe.name, inventory.inputs);
  console.log(
    `${probe.name}: ${inventory.inputs.length} inputs, ${inventory.externals.length} externals`,
  );
}

const { values } = parseArgs({ options: { packaged: { type: "boolean" } } });
const probes = values.packaged ? [...bundleProbes, ...packagedBundleProbes] : bundleProbes;
for (const probe of probes) {
  try {
    check(probe);
  } catch (error) {
    console.error(`${probe.name}: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
