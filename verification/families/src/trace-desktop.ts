// The desktop's trace build on a real sheet, against G0: the panels, trace
// map and built parts apps/desktop/scripts/qa-art.ts saves after the built
// app's page measured the body's shipped sheet (Electron's Chromium canvas on
// the hardware GPU), built again with G0's buildTraceMap from character-view
// at 2761eb14 (src/g0-trace.ts) on the same panels and height. Every built
// part's traced hull, or its paint binding and knots, must equal G0's, its
// standing position must be G0's shifted by the anchor's move from its sheet
// point, and both builds must leave out the same regions.
//
//   node --import ../../packages/document/test/support/register.ts src/trace-desktop.ts [DIR]
//
// DIR defaults to .reference-cache/g4a/trace-desktop. A missing build fails.

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { g0BuildTraceMap, g0World, isRecord, record } from "./g0-trace.js";
import { outDir } from "./paths.js";

const dir = resolve(process.argv[2] ?? join(outDir, "trace-desktop"));
const file = join(dir, "trace-build.json");
if (!existsSync(file)) throw new Error(`No desktop trace build at ${file}; run the art QA.`);

const saved: unknown = JSON.parse(readFileSync(file, "utf8"));
const field = (v: unknown, key: string): unknown => (isRecord(v) ? v[key] : undefined);
function list(v: unknown, what: string): unknown[] {
  if (!Array.isArray(v)) throw new Error(`The saved build has no ${what}.`);
  return v;
}
function num(v: unknown, what: string): number {
  if (typeof v !== "number") throw new Error(`The saved build's ${what} is not a number.`);
  return v;
}
const sheet = String(field(saved, "sheet"));
const height = num(field(saved, "height"), "height");
const shift = list(field(saved, "anchorShift"), "anchor shift").map((v) => num(v, "anchor shift"));
const panels = list(field(saved, "panels"), "panels").map((p) => ({
  size: num(field(p, "size"), "panel size"),
  mid: num(field(p, "mid"), "panel mid"),
  feet: num(field(p, "feet"), "panel feet"),
  span: num(field(p, "span"), "panel span"),
  mask: Buffer.from(String(field(p, "mask")), "base64"),
}));
const built = list(field(saved, "built"), "built parts");
const missed = list(field(saved, "missed"), "missed regions").map((m) =>
  String(field(m, "region")),
);
assert.equal(panels.length, 4, "the build measured four views");
assert.ok(built.length > 0, "the desktop built parts");

const started = performance.now();
const g0 = g0BuildTraceMap(panels, field(saved, "map"), height);
const ms = Math.round(performance.now() - started);
assert.deepEqual([...g0.missed].sort(), [...missed].sort(), "G0 leaves out the same regions");

const report: Record<string, unknown> = {};
for (const b of built) {
  const region = String(field(b, "region"));
  const legacy = g0.parts.find((p) => p["id"] === region);
  assert.ok(legacy, `G0 built ${region}`);
  const hull = field(b, "hull");
  if (hull !== undefined) {
    const { atlas: _atlas, ...traced } = record(legacy, "hull");
    assert.deepEqual(hull, traced, `${region}'s hull is G0's`);
  } else {
    const { atlas: _atlas, depthPins, ...binding } = record(legacy, "paint");
    assert.equal(depthPins, undefined, `G0 pins nothing on ${region}`);
    assert.deepEqual(field(b, "paint"), binding, `${region}'s binding is G0's`);
    assert.deepEqual(field(b, "knots"), legacy["knots"], `${region}'s knots are G0's`);
  }
  const ours = list(field(b, "world"), `${region}'s position`).map((v) => num(v, "position"));
  const theirs = g0World(g0.parts, region).map((v, i) => v + (shift[i] ?? 0));
  assert.equal(ours.length, 3);
  const error = Math.max(...ours.map((v, i) => Math.abs(v - (theirs[i] ?? Number.NaN))));
  assert.ok(error < 1e-9, `${region} stands where G0 placed it (${error} m off)`);
  const parent = legacy["parent"];
  report[region] = {
    method: field(b, "method"),
    part: field(b, "part"),
    parent: field(b, "parent"),
    g0Parent: typeof parent === "string" ? parent : null,
    placementError: error,
  };
}

const out = { sheet, height, g0Ms: ms, missed: g0.missed, built: report };
writeFileSync(join(dir, "report.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
console.log(`G0 matches the desktop's trace build of ${built.length} parts on ${sheet}.`);
