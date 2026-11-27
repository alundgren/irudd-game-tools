import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSync } from "@swc/core";

const bridgeMethods = [
  "app",
  "call",
  "createProject",
  "bundledImage",
  "referenceModel",
  "referenceModels",
  "humanPack",
  "library",
  "onCommit",
  "onSteer",
  "onUpdate",
  "openCharacter",
  "openGlb",
  "openProject",
  "copyDirection",
  "projectState",
  "readLibrary",
  "saveCharacter",
  "saveExport",
  "saveInspection",
  "update",
].sort();
const windowPreferences = {
  sandbox: true,
  contextIsolation: true,
  nodeIntegration: false,
  webSecurity: true,
};

type Fields = Record<string, unknown>;
function isRecord(value: unknown): value is Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function fields(value: unknown): Fields {
  return isRecord(value) ? value : {};
}

function* nodes(value: unknown): Generator<Fields> {
  if (Array.isArray(value)) {
    for (const entry of value) yield* nodes(entry);
  } else if (typeof value === "object" && value !== null) {
    const node = fields(value);
    if (typeof node["type"] === "string") yield node;
    for (const child of Object.values(node)) yield* nodes(child);
  }
}

function items(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function literalObject(value: unknown): Map<string, Fields> {
  const object = fields(value);
  if (object["type"] !== "ObjectExpression") throw new Error("expected explicit object literal");
  const entries = new Map<string, Fields>();
  for (const item of items(object["properties"])) {
    const property = fields(item);
    const key = property["type"] === "Identifier" ? property : fields(property["key"]);
    const name = key["value"];
    if (typeof name !== "string" || entries.has(name))
      throw new Error("spread, computed or duplicate object key");
    entries.set(
      name,
      property["type"] === "KeyValueProperty" ? fields(property["value"]) : property,
    );
  }
  return entries;
}

function argument(node: Fields, index: number): Fields {
  return fields(fields(items(node["arguments"])[index])["expression"]);
}

function checkWindow(node: Fields): void {
  const options = literalObject(argument(node, 0));
  const preferences = literalObject(options.get("webPreferences"));
  for (const [name, value] of Object.entries(windowPreferences)) {
    const preference = preferences.get(name);
    if (preference?.["type"] !== "BooleanLiteral" || preference["value"] !== value)
      throw new Error(`BrowserWindow must set webPreferences.${name} to ${value}`);
  }
}

function checkBridge(call: Fields, source: readonly Fields[]): void {
  if (argument(call, 0)["value"] !== "workshop")
    throw new Error("preload must expose window.workshop");
  const api = argument(call, 1);
  const definitions = source.filter(
    (node) => node["type"] === "VariableDeclarator" && fields(node["id"])["value"] === api["value"],
  );
  const methods = literalObject(
    api["type"] === "Identifier" && definitions.length === 1 ? definitions[0]?.["init"] : api,
  );
  if (JSON.stringify([...methods.keys()].sort()) !== JSON.stringify(bridgeMethods))
    throw new Error(
      `preload API differs from the reviewed methods: ${[...methods.keys()].join(", ")}`,
    );
  for (const [key, value] of methods) {
    if (
      !["ArrowFunctionExpression", "FunctionExpression", "MethodProperty"].includes(
        String(value["type"]),
      )
    )
      throw new Error(`window.workshop.${key} must expose a function`);
  }
}

export function checkDesktopContract(
  root: string,
  kind: "main" | "preload",
  inputs: readonly string[],
): void {
  let count = 0;
  for (const input of inputs.filter(
    (id) => id.startsWith("apps/desktop/src/") && id.endsWith(".ts"),
  )) {
    const source = [
      ...nodes(parseSync(readFileSync(join(root, input), "utf8"), { syntax: "typescript" })),
    ];
    const binding = kind === "main" ? "BrowserWindow" : "contextBridge";
    const imports = source.filter(
      (node) =>
        node["type"] === "ImportDeclaration" && fields(node["source"])["value"] === "electron",
    );
    const names = new Set<string>();
    for (const declaration of imports) {
      for (const specifier of items(declaration["specifiers"])) {
        const spec = fields(specifier);
        if (spec["type"] !== "ImportSpecifier")
          throw new Error("use named imports for the Electron API");
        const local = fields(spec["local"])["value"];
        if ((fields(spec["imported"])["value"] ?? local) === binding && typeof local === "string")
          names.add(local);
      }
    }
    for (const node of source) {
      const callee = fields(node["callee"]);
      if (
        kind === "main" &&
        node["type"] === "NewExpression" &&
        names.has(String(callee["value"]))
      ) {
        checkWindow(node);
        count++;
      }
      if (
        kind === "preload" &&
        node["type"] === "CallExpression" &&
        names.has(String(fields(callee["object"])["value"]))
      ) {
        if (fields(callee["property"])["value"] !== "exposeInMainWorld")
          throw new Error("unexpected contextBridge method");
        checkBridge(node, source);
        count++;
      }
    }
  }
  if (kind === "main" ? count === 0 : count !== 1)
    throw new Error(`unexpected ${kind} contract count ${count}`);
}
