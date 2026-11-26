import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  drawAdult,
  evaluateHuman,
  regionName,
  surfaceRegions,
  type HumanDraw,
  type Region,
} from "@irudd/character/human";
import { isRecord } from "../src/glb.js";
import { loadHumanBody } from "../src/human-assets.js";
import { repository } from "../src/paths.js";

interface SeededRow {
  readonly kind: string;
  readonly seed: number;
  readonly sha256: string;
}
function seededRows(): SeededRow[] {
  const raw: unknown = JSON.parse(
    readFileSync(join(repository, "verification", "baseline", "baseline.json"), "utf8"),
  );
  const frozen = isRecord(raw) && raw["frozen"];
  const seeded = isRecord(frozen) && frozen["seeded"];
  const list = isRecord(seeded) && seeded["rows"];
  if (!Array.isArray(list)) throw new Error("Missing frozen seeded rows.");
  return list.flatMap((r: unknown) =>
    isRecord(r) &&
    typeof r["kind"] === "string" &&
    typeof r["seed"] === "number" &&
    typeof r["sha256"] === "string"
      ? [{ kind: r["kind"], seed: r["seed"], sha256: r["sha256"] }]
      : [],
  );
}
const rows = seededRows().filter((r) => r.kind === "adult");

const role = (bone: string) =>
  ({
    upperarm: "upper arm",
    lowerarm: "forearm",
    hand: "hand",
    thigh: "thigh",
    calf: "shin",
    foot: "foot",
    head: "head",
    spine_03: "torso",
  })[bone.replace(/_[lr]$/, "")] ?? "rigid";

function g0Form(draw: HumanDraw, regions: ReadonlyArray<Region>): unknown {
  return {
    human: draw.human,
    origin: { kind: "human surface", seed: draw.seed },
    outfit: "Anatomy",
    appearance: { palette: "Clay", skin: draw.skin, face: 0, hairColor: "#45352e", hair: "Crop" },
    parts: regions.map((r) => ({
      id: regionName(r.bone),
      shape: "human region",
      humanBone: r.bone,
      motionRole: role(r.bone),
      humanBounds: r.bounds,
      ...(r.parent ? { parent: regionName(r.parent) } : {}),
      position: r.position,
      size: [1, 1, 1],
      rotation: [0, 0, 0],
      color: draw.skin,
    })),
    posture: draw.posture,
    humanStyle: draw.style,
    ...(draw.complexion ? { complexion: draw.complexion } : {}),
    ...(draw.eyeColor ? { eyeColor: draw.eyeColor } : {}),
    ...(draw.faceMarks ? { faceMarks: draw.faceMarks } : {}),
  };
}

const canonical = (v: unknown) =>
  JSON.stringify(v, (_, x: unknown) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1)))
      : x,
  );

test("every frozen adult seed draws G0's form exactly", async () => {
  assert.equal(rows.length, 11);
  const body = await loadHumanBody();
  for (const row of rows) {
    const draw = drawAdult(body, row.seed);
    const regions = surfaceRegions(evaluateHuman(body, draw.human));
    const digest = createHash("sha256")
      .update(canonical(g0Form(draw, regions)))
      .digest("hex");
    assert.equal(digest, row.sha256, `seed ${row.seed}`);
  }
});
