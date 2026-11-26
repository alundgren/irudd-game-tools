// The G0 oracle for trace builds: buildTraceMap from character-view at
// 2761eb14, run from the frozen source on given sheet panels.
//
// buildTraceMap reads its sheet's panels from turnaround.js's module state,
// so the driver assembles the functions it calls from the frozen files
// (traceOutline, traceHull, tracePath, traceRegion, silhouetteRuns,
// withDepthPairs and calibrateFace from turnaround.js, registerFace from
// portrait-frame.js, bindParts from rig.js and the role lists) and puts the
// panels in that state. startingForm and validateForm only frame the form
// around the parts and are left out; G0 has no hair regions here.

import { execFileSync } from "node:child_process";
import { repository } from "./paths.js";

const frozen = "2761eb14";

/** A sheet panel as G0 holds it: its subject mask and frame. */
export interface G0Panel {
  readonly size: number;
  readonly mask: ArrayLike<number>;
  readonly mid: number;
  readonly feet: number;
  readonly span: number;
}

export interface G0TraceBuild {
  /** The bound form's parts, as buildTraceMap returns them. */
  readonly parts: ReadonlyArray<Record<string, unknown>>;
  /** Regions its tolerant build left out. */
  readonly missed: ReadonlyArray<string>;
}

const show = (file: string) =>
  execFileSync("git", ["show", `${frozen}:character-view/${file}`], {
    cwd: repository,
    encoding: "utf8",
  });

function between(source: string, from: string, to: string): string {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  if (start < 0 || end <= start) throw new Error(`The frozen source has no ${from}.`);
  return source.slice(start, end);
}

function array(source: string, name: string): string {
  const at = source.indexOf(`export const ${name} = [`);
  if (at < 0) throw new Error(`The frozen source has no ${name}.`);
  return source.slice(at, source.indexOf("];", at) + 2);
}

/** A JSON object, as G0's parts and their features are. */
export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** A JSON object field's object value, which must be there. */
export function record(v: unknown, key: string): Record<string, unknown> {
  const value = isRecord(v) ? v[key] : undefined;
  if (!isRecord(value)) throw new Error(`G0's ${key} is not an object.`);
  return value;
}

let driver: string | undefined;
function source(): string {
  if (driver) return driver;
  const turnaround = show("turnaround.js");
  const traceMap = show("trace-map.js");
  driver = [
    `import * as T from "three";`,
    `import { Euler, Quaternion, Vector3 } from "three";`,
    `const atlases = new Map();`,
    `const sourceHairCap = () => undefined;`,
    `const startingForm = () => ({});`,
    `const validateForm = (form) => form;`,
    array(show("recipe.js"), "motionRoles"),
    array(show("wardrobe.js"), "outfitRoles"),
    between(show("portrait-frame.js"), "export function registerFace", "\n}\n") + "\n}\n",
    between(show("rig.js"), "const rad = Math.PI / 180;", "export function bindHumanoid"),
    between(turnaround, "export function pairDepth", "export function guideHeight"),
    between(turnaround, "export function guideHeight", "const sheetTextures"),
    between(turnaround, "export function traceOutline", "// Estimate visibility"),
    between(traceMap, "function polygon(points)", "\nexport function buildTraceMap"),
    between(traceMap, "export function buildTraceMap", "\n}\n") + "\n}\n",
  ]
    .join("\n")
    .replaceAll("export function", "function")
    .replaceAll("export const", "const");
  return driver;
}

/**
 * G0's tolerant buildTraceMap (the one its art flow falls back to, which
 * leaves out regions it cannot trace) on a sheet's four panels.
 */
export function g0BuildTraceMap(
  panels: ReadonlyArray<G0Panel>,
  map: unknown,
  height: number,
): G0TraceBuild {
  const script = `${source()}
let text = "";
for await (const chunk of process.stdin) text += chunk;
const input = JSON.parse(text);
atlases.set("art", input.panels.map((p) => ({ ...p, mask: Uint8Array.from(p.mask) })));
const missed = [];
const form = buildTraceMap(input.map, "art", input.height, { missed, uncalibrated: [] });
process.stdout.write(JSON.stringify({ parts: form.parts, missed }));`;
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: repository,
    input: JSON.stringify({
      panels: panels.map((p) => ({
        size: p.size,
        mid: p.mid,
        feet: p.feet,
        span: p.span,
        mask: Array.from(p.mask),
      })),
      map,
      height,
    }),
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  const parsed: unknown = JSON.parse(out);
  const parts = isRecord(parsed) ? parsed["parts"] : undefined;
  const missed = isRecord(parsed) ? parsed["missed"] : undefined;
  if (!Array.isArray(parts) || !Array.isArray(missed)) throw new Error("G0 built nothing.");
  return { parts: parts.filter(isRecord), missed: missed.map(String) };
}

/** A G0 part's standing position before binding: bindParts kept every rotation and size neutral. */
export function g0World(
  parts: ReadonlyArray<Record<string, unknown>>,
  id: string,
): readonly [number, number, number] {
  const part = parts.find((p) => p["id"] === id);
  const own = part?.["position"];
  if (!Array.isArray(own) || own.length !== 3) throw new Error(`G0 built no ${id}.`);
  const parent =
    typeof part?.["parent"] === "string" ? g0World(parts, part["parent"]) : ([0, 0, 0] as const);
  return [Number(own[0]) + parent[0], Number(own[1]) + parent[1], Number(own[2]) + parent[2]];
}
