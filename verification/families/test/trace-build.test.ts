import assert from "node:assert/strict";
import { test } from "node:test";
import { exportCharacter } from "@irudd/character";
import type { Panel } from "@irudd/character/art-fit";
import {
  buildAnchorRefusal,
  traceBuildOperations,
  type SheetPanels,
  type TraceBuildRegion,
} from "@irudd/character/trace-build";
import {
  affinePoint,
  figureHull,
  figurePaint,
  figurePortraitDepth,
  figureSweep,
  motionRole,
  outfitWear,
  partPlacements,
  type CharacterDocument,
  type Part,
  type Vec3,
} from "@irudd/document";
import { applyChecked } from "../src/apply.js";
import { accessorValues, parseGlb, records } from "../src/glb.js";
import { installNodeExporter } from "../src/node-exporter.js";
import { g0BuildTraceMap, g0World as g0WorldOf, record } from "../src/g0-trace.js";
import { familyRegistry } from "../src/prepare.js";
import { readFixture } from "../src/run.js";

installNodeExporter();
const g0Build = (panels: SheetPanels, map: unknown, height: number) =>
  g0BuildTraceMap(panels, map, height);

const size = 640;
const mid = 320;
const feet = 600;
const span = 560;
const at = (u: number, h: number): [number, number] => [
  (mid + u * span) / size,
  (feet - h * span) / size,
];

function panel(inside: (u: number, h: number) => boolean): Panel {
  const mask = new Uint8Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++)
      if (inside((x - mid) / span, (feet - y) / span)) mask[y * size + x] = 1;
  return { size, pixels: new Uint8ClampedArray(0), mask, mid, feet, span };
}
const box = (u: number, h: number, u0: number, u1: number, h0: number, h1: number) =>
  u >= u0 && u <= u1 && h >= h0 && h <= h1;
const tailFront = (u: number, h: number) =>
  Math.abs(u - (0.12 + (0.5 - h) * 0.8)) < 0.03 && h > 0.2 && h < 0.5;
const tailSide = (u: number, h: number) =>
  Math.abs(u - (0.09 + (0.5 - h) * 1.1)) < 0.03 && h > 0.2 && h < 0.5;
const front = panel(
  (u, h) =>
    box(u, h, -0.12, 0.12, 0.3, 0.8) ||
    u * u + (h - 0.9) * (h - 0.9) < 0.0064 ||
    box(u, h, 0.12, 0.4, 0.56, 0.74) ||
    tailFront(u, h),
);
const side = panel(
  (u, h) =>
    box(u, h, -0.09, 0.09, 0.3, 0.8) ||
    u * u + (h - 0.9) * (h - 0.9) < 0.0064 ||
    box(u, h, -0.02, 0.03, 0.56, 0.74) ||
    tailSide(u, h),
);
const panels: SheetPanels = [front, side, front, side];

const rect = (u0: number, u1: number, h0: number, h1: number) => [
  at(u0, h1),
  at(u1, h1),
  at(u1, h0),
  at(u0, h0),
];
const spine = [0.48, 0.42, 0.36, 0.3, 0.24].map(
  (h): [number, number, number, number, number, number] => {
    const [fx, fy] = at(0.12 + (0.5 - h) * 0.8, h);
    const [sx, sy] = at(-(0.09 + (0.5 - h) * 1.1), h);
    return [fx, fy, sx, sy, 0.025, 0.02];
  },
);

const regions: ReadonlyArray<TraceBuildRegion> = [
  {
    id: "body",
    method: "loft",
    front: rect(-0.13, 0.13, 0.3, 0.8),
    side: rect(-0.1, 0.1, 0.3, 0.8),
  },
  {
    id: "hood",
    parent: "body",
    method: "loft",
    front: rect(-0.09, 0.09, 0.82, 0.98),
    side: rect(-0.09, 0.09, 0.82, 0.98),
    outfitRole: "head",
    depthPairs: [
      [at(0, 0.9)[0], at(0, 0.9)[1], at(-0.07, 0.9)[0], at(-0.07, 0.9)[1], 0.1],
      [at(0, 0.9)[0], at(0, 0.9)[1], at(-0.07, 0.7)[0], at(-0.07, 0.7)[1], 0.1],
    ],
  },
  {
    id: "satchel",
    parent: "body",
    method: "volume",
    front: rect(0.02, 0.11, 0.4, 0.52),
    side: rect(0, 0.09, 0.4, 0.52),
    motionRole: "rigid",
  },
  {
    id: "left wing",
    parent: "body",
    method: "membrane",
    correspondence: "same",
    thickness: 0.012,
    front: rect(0.12, 0.42, 0.55, 0.75),
    side: rect(-0.03, 0.04, 0.55, 0.75),
  },
  { id: "tail", parent: "body", method: "path", spine },
  {
    id: "ghost fin",
    parent: "body",
    method: "volume",
    front: rect(-0.45, -0.35, 0.05, 0.15),
    side: rect(-0.45, -0.35, 0.05, 0.15),
  },
  {
    id: "fin tip",
    parent: "ghost fin",
    method: "loft",
    front: rect(-0.05, 0.05, 0.6, 0.7),
    side: rect(-0.05, 0.05, 0.6, 0.7),
    motionRole: "wiggle",
  },
];
const map = { format: "irudd.trace-map.v1", height: 1.6, regions };

const fixture = readFixture("coastal-biologist");
const bodyOf = (doc: CharacterDocument): Part => {
  const p = doc.parts.find((q) => q.id === "p-body");
  assert.ok(p);
  return p;
};
const height = figurePaint.read(bodyOf(fixture).features)?.height ?? 0;
const g0 = g0Build(
  panels,
  {
    ...map,
    regions: regions.map(({ motionRole: role, ...r }) =>
      role === "wiggle" ? r : { ...r, motionRole: role },
    ),
  },
  height,
);
const g0Parts = new Map(g0.parts.map((p) => [String(p["id"]), p]));
const vec = (v: unknown): Vec3 => {
  assert.ok(Array.isArray(v) && v.length === 3);
  return [Number(v[0]), Number(v[1]), Number(v[2])];
};
const g0World = (id: string): Vec3 => g0WorldOf(g0.parts, id);
function stored(v: unknown): unknown {
  if (v === undefined) return undefined;
  const parsed: unknown = JSON.parse(JSON.stringify(v));
  return parsed;
}
const close = (a: ReadonlyArray<number>, b: ReadonlyArray<number>, tol = 1e-9) =>
  a.length === b.length && a.every((v, i) => Math.abs(v - (b[i] ?? NaN)) <= tol);

async function positions(doc: CharacterDocument): Promise<Map<string, Float64Array>> {
  const result = await exportCharacter(doc, { preset: "clay", revision: 1, build: "trace-build" });
  const glb = parseGlb(result.bytes);
  const meshes = records(glb.json["meshes"]);
  const out = new Map<string, Float64Array>();
  for (const node of records(glb.json["nodes"])) {
    const mesh = typeof node["mesh"] === "number" ? meshes[node["mesh"]] : undefined;
    if (!mesh) continue;
    const values = records(mesh["primitives"]).flatMap((p) => {
      const attributes = p["attributes"];
      const a =
        typeof attributes === "object" && attributes !== null && "POSITION" in attributes
          ? attributes.POSITION
          : undefined;
      return typeof a === "number" ? [...accessorValues(glb, a)] : [];
    });
    out.set(String(node["name"]), Float64Array.from(values));
  }
  return out;
}

test("each method builds the part G0's buildTraceMap builds from the same panels", () => {
  assert.deepEqual(g0.missed, ["ghost fin"], "G0 also misses the empty region");
  const build = traceBuildOperations(fixture, "p-body", regions, panels, map.height);
  assert.deepEqual(
    build.built.map((b) => [b.region, b.method]),
    [
      ["hood", "loft"],
      ["satchel", "volume"],
      ["left wing", "membrane"],
      ["tail", "path"],
      ["fin tip", "loft"],
    ],
  );
  for (const { region, part } of build.built) {
    const legacy = g0Parts.get(region);
    assert.ok(legacy, region);
    const hull = figureHull.read(part.features);
    if (hull) {
      const { atlas: _atlas, ...traced } = record(legacy, "hull");
      assert.deepEqual(stored(hull), traced, `${region}'s hull`);
      assert.equal(part.shape, "box");
    } else {
      const { atlas: _atlas, depthPins, ...binding } = record(legacy, "paint");
      assert.deepEqual(stored(figurePaint.read(part.features)), binding, `${region}'s binding`);
      assert.deepEqual(
        stored(figureSweep.read(part.features)?.knots),
        legacy["knots"],
        `${region}'s knots`,
      );
      assert.deepEqual(
        stored(figurePortraitDepth.read(part.features)?.pins),
        depthPins,
        `${region}'s depth pins`,
      );
      assert.equal(part.shape, "capsule");
    }
    assert.equal(
      part.paint?.atlas,
      bodyOf(fixture).paint?.atlas,
      `${region} paints from the anchor's sheet`,
    );
  }
  const hood = build.built.find((b) => b.region === "hood")?.part;
  assert.equal(figurePortraitDepth.read(hood?.features ?? {})?.pins?.length, 1);
  assert.equal(outfitWear.read(hood?.features ?? {})?.role, "head");
  assert.equal(
    motionRole.read(hood?.features ?? {})?.role,
    "head",
    "a head outfit moves as a head",
  );
  const tail = build.built.find((b) => b.region === "tail")?.part;
  assert.equal(motionRole.read(tail?.features ?? {})?.role, "tail");
  assert.equal(figurePaint.read(tail?.features ?? {})?.frame, "path");
  const wing = build.built.find((b) => b.region === "left wing")?.part;
  assert.deepEqual(figureHull.read(wing?.features ?? {})?.membrane, {
    slope: -1,
    thickness: 0.012,
  });
  assert.equal(motionRole.read(wing?.features ?? {})?.role, "wing");
  assert.deepEqual(build.kept, [{ region: "body", part: "p-body" }]);
  assert.deepEqual(
    build.missed.map((m) => m.region),
    ["ghost fin"],
  );
  assert.deepEqual(build.notes, [
    "The map's height 1.6 m was replaced by the sheet's 1.77 m, so the new parts register with p-body.",
    "1 of hood's depthPairs did not match at the same height in both views and were left out.",
    "fin tip's motionRole wiggle is not a movement role and was left out.",
    "Kept as they are: body (p-body).",
    "Not built: ghost fin (Select a larger overlapping region).",
  ]);
});

test("built parts attach to their parent regions and register with the anchor", async () => {
  const shift: Vec3 = [0.25, 0.05, -0.1];
  const moved: CharacterDocument = {
    ...fixture,
    parts: fixture.parts.map((p) =>
      p.id === "p-body"
        ? {
            ...p,
            position: [
              p.position[0] + shift[0],
              p.position[1] + shift[1],
              p.position[2] + shift[2],
            ],
          }
        : p,
    ),
  };
  const build = traceBuildOperations(moved, "p-body", regions, panels, map.height);
  const doc = applyChecked(moved, build.operations);
  const placements = partPlacements(doc, familyRegistry);
  const origin = figurePaint.read(bodyOf(doc).features)?.offset ?? [0, 0, 0];
  const anchor = placements.get("p-body")?.frame;
  assert.ok(anchor);
  const delta = affinePoint(anchor, [0, 0, 0]).map((v, i) => v - (origin[i] ?? 0));
  for (const { region, part } of build.built) {
    const world = placements.get(part.id)?.frame;
    assert.ok(world);
    const g0Point = g0World(region);
    assert.ok(
      close(
        affinePoint(world, [0, 0, 0]),
        g0Point.map((v, i) => v + (delta[i] ?? 0)),
        1e-9,
      ),
      `${region} lands where G0 placed it, moved with the anchor`,
    );
  }
  const parent = (region: string) => build.built.find((b) => b.region === region)?.part.parent;
  assert.equal(parent("hood"), "p-body");
  assert.equal(parent("tail"), "p-body");
  assert.equal(parent("fin tip"), "p-body", "a missed parent passes its child to the body");
  assert.deepEqual(
    doc.parts.filter((p) => moved.parts.some((q) => q.id === p.id)),
    moved.parts,
    "every existing part stays as it was",
  );
  assert.equal(doc.parts.length, moved.parts.length + build.built.length);

  const vertices = (meshes: Map<string, Float64Array>) => {
    const counts = new Map<string, number>();
    for (const values of meshes.values())
      for (let i = 0; i < values.length; i += 3) {
        const key = `${values[i]},${values[i + 1]},${values[i + 2]}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    return counts;
  };
  const before = vertices(await positions(moved));
  const after = vertices(await positions(doc));
  let kept = 0;
  let total = 0;
  for (const [key, n] of before) {
    total += n;
    kept += Math.min(n, after.get(key) ?? 0);
  }
  assert.equal(kept, total, "every existing exported vertex stays where it was");
  const added = [...after.values()].reduce((a, b) => a + b, 0) - total;
  assert.ok(added > 100_000, `the built parts add ${added} vertices`);
});

test("a chained new parent places its child in its own frame", () => {
  const chain: ReadonlyArray<TraceBuildRegion> = [
    {
      id: "satchel",
      method: "volume",
      front: rect(0.02, 0.11, 0.4, 0.52),
      side: rect(0, 0.09, 0.4, 0.52),
    },
    { id: "tail", parent: "satchel", method: "path", spine },
  ];
  const build = traceBuildOperations(fixture, "p-body", chain, panels);
  const [satchel, tail] = build.built.map((b) => b.part);
  assert.ok(satchel && tail);
  assert.equal(satchel.parent, null, "a root region stays at the document root");
  assert.equal(tail.parent, satchel.id);
  const ours = g0Build(panels, { format: "irudd.trace-map.v1", height, regions: chain }, height);
  const legacyTail = ours.parts.find((p) => p["id"] === "tail");
  assert.ok(close(tail.position, vec(legacyTail?.["position"]), 1e-12), "G0's bound position");
  const doc = applyChecked(fixture, build.operations);
  assert.equal(doc.parts.length, fixture.parts.length + 2);
});

test("a map with nothing to build is refused with every reason", () => {
  assert.throws(
    () =>
      traceBuildOperations(
        fixture,
        "p-body",
        [
          {
            id: "body",
            method: "loft",
            front: rect(-0.13, 0.13, 0.3, 0.8),
            side: rect(-0.1, 0.1, 0.3, 0.8),
          },
          {
            id: "ghost",
            parent: "body",
            method: "volume",
            front: rect(-0.45, -0.35, 0.05, 0.15),
            side: rect(-0.45, -0.35, 0.05, 0.15),
          },
          {
            id: "flap",
            parent: "body",
            method: "membrane",
            front: rect(0.12, 0.42, 0.55, 0.75),
            side: rect(-0.03, 0.04, 0.55, 0.75),
          },
        ],
        panels,
      ),
    (error: Error) =>
      /No region of the map could be built on p-body's sheet/.test(error.message) &&
      /ghost: Select a larger overlapping region/.test(error.message) &&
      /flap: Choose same or opposite edge correspondence/.test(error.message) &&
      /body name existing parts/.test(error.message),
  );
  const collar = fixture.parts.find((p) => p.id === "p-vest-folded-collar");
  assert.ok(collar && figureHull.read(collar.features));
  assert.equal(buildAnchorRefusal(collar), undefined, "a traced volume anchors a build too");
  const unpainted: CharacterDocument = {
    ...fixture,
    parts: fixture.parts.map((p) => {
      if (p.id !== "p-body") return p;
      const { paint: _paint, ...rest } = p;
      return { ...rest, features: {} };
    }),
  };
  assert.throws(
    () => traceBuildOperations(unpainted, "p-body", regions, panels),
    /not painted from a turnaround sheet/,
  );
});
