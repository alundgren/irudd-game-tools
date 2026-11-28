import { Euler, MathUtils, Quaternion } from "three";
import { isJson, motionRoles, type BaseSlotInput, type Json } from "@irudd/document";
import { creatureOrgan } from "./names.js";
import type { Form, FormPart } from "./types.js";

type Shape = BaseSlotInput["shape"];
const shapes: Record<string, Shape> = {
  sweep: "capsule",
  cage: "box",
  hand: "box",
  wing: "box",
  scute: "box",
  volume: "box",
  mantle: "box",
};
const jointed = new Set(["upper arm", "forearm"]);
const isMotionRole = (role: string) => motionRoles.some((r) => r === role);
function json(value: unknown): Json {
  const copy: unknown = JSON.parse(JSON.stringify(value));
  if (!isJson(copy)) throw new Error("A creature part holds a value a document cannot store.");
  return copy;
}

function slotKey(id: string, used: Set<string>) {
  const slug =
    id
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 56) || "part";
  const base = /^[a-z]/.test(slug) ? slug : "p-" + slug;
  let key = base;
  for (let n = 2; used.has(key); n++) key = `${base}-${n}`;
  used.add(key);
  return key;
}

const triple = ([x = 0, y = 0, z = 0]: readonly number[]): [number, number, number] => [x, y, z];
const coreShape = (shape: string): Shape =>
  shapes[shape] ??
  (shape === "ellipsoid" || shape === "box" || shape === "cylinder" || shape === "cone"
    ? shape
    : "box");
function quaternion(rotation: readonly number[]): [number, number, number, number] {
  const [x = 0, y = 0, z = 0] = rotation.map((d) => d * MathUtils.DEG2RAD);
  const q = new Quaternion().setFromEuler(new Euler(x, y, z));
  return q.w < 0 ? [-q.x, -q.y, -q.z, -q.w] : [q.x, q.y, q.z, q.w];
}

function role(p: FormPart, parts: ReadonlyMap<string, FormPart>): string {
  const id = p.id.toLowerCase();
  if (p.motionRole === "axial spine" && !p.knots?.length) return "rigid";
  if (p.motionRole !== undefined) return p.motionRole;
  if (/wing/.test(id) && (!/(rib|spar|plate|fin)/.test(id) || /leading.spar/.test(id)))
    return "wing";
  if (/(?:^|[- ])head(?:$|[- ])/.test(id)) return "head";
  if (/tail/.test(id)) return "tail";
  if (/foot|feet/.test(id)) return "foot";
  const parent = p.parent === undefined ? undefined : parts.get(p.parent);
  if (parent?.motionRole === "hand" && /finger|thumb|claw|talon|digit/i.test(id)) return "hand";
  return "rigid";
}

function retained(
  p: FormPart,
  parts: ReadonlyMap<string, FormPart>,
  roles: ReadonlyMap<string, string>,
) {
  if (p.shape !== "sweep" || p.blendSkin) return undefined;
  const parent = p.parent === undefined ? undefined : parts.get(p.parent);
  const stored = (q: FormPart | undefined) => {
    const r = q && roles.get(q.id);
    return r !== undefined && isMotionRole(r) ? r : undefined;
  };
  const authored =
    jointed.has(p.motionRole ?? "") ||
    (p.motionRole === "rigid" && jointed.has(parent?.motionRole ?? ""));
  const kept =
    jointed.has(stored(p) ?? "") || (stored(p) === "rigid" && jointed.has(stored(parent) ?? ""));
  return authored === kept ? undefined : authored;
}

const lower = (marks: {
  kind: string;
  color: string;
  spacing: number;
  coverage: number;
  angle: number;
  seed: number;
}) => ({
  kind: marks.kind,
  color: marks.color.toLowerCase(),
  spacing: marks.spacing,
  coverage: marks.coverage,
  angle: marks.angle,
  seed: marks.seed,
});

export function formSlots(form: Form): BaseSlotInput[] {
  const parts = new Map(form.parts.map((p) => [p.id, p]));
  const roles = new Map(form.parts.map((p) => [p.id, role(p, parts)]));
  const used = new Set<string>();
  const keys = new Map(form.parts.map((p) => [p.id, slotKey(p.id, used)]));
  const key = (id: string) => keys.get(id) ?? id;
  return form.parts.map((p, order): BaseSlotInput => {
    const features: Record<string, Json> = {
      "figure.assembly": { order, ...(p.frameSize ? { frameSize: [...p.frameSize] } : {}) },
    };
    if (p.shape === "sweep") {
      const keep = retained(p, parts, roles);
      features["figure.sweep"] = {
        knots: json(p.knots ?? []),
        ...(p.suckerRows === undefined ? {} : { suckerRows: p.suckerRows }),
        ...(keep === undefined ? {} : { retainSections: keep }),
      };
    }
    if (p.fibres) features["figure.fibres"] = json(p.fibres);
    if (p.shape === "cage" && p.cage)
      features["figure.cage"] = json({ ...p.cage, ...(p.pinna ? { pinna: true } : {}) });
    if (p.surfaceJoin) features["figure.join"] = json(p.surfaceJoin);
    if (p.shape === "hand") features["figure.hand"] = json(p.grip ?? {});
    if (p.markings) features["figure.markings"] = lower(p.markings);
    if (p.surface !== undefined) features["figure.finish"] = { surface: p.surface };
    const motion = roles.get(p.id) ?? "rigid";
    if (isMotionRole(motion)) features["motion.role"] = { role: motion };
    if (p.blendSkin) features["creature.blend"] = { blend: true };
    if (p.plateGrowth)
      features["figure.plate-field"] = json({
        ...p.plateGrowth,
        color: p.plateGrowth.color.toLowerCase(),
        ...(p.plateGrowthRest ? { rest: p.plateGrowthRest } : {}),
      });
    if (p.plateSite) features["figure.plate-site"] = json(p.plateSite);
    if (p.hornSwatch !== undefined) features["figure.horn-swatch"] = { swatch: p.hornSwatch };
    if (p.undercoat) features["figure.undercoat"] = lower(p.undercoat);
    if (p.coatZone !== undefined) features["creature.coat-zone"] = { zone: p.coatZone };
    if (p.eyeSurface !== undefined) features["creature.eye-surface"] = { surface: p.eyeSurface };
    if (p.shape === "cage" && p.shellFinish)
      features["creature.cage-finish"] = {
        finish: "whorl",
        ribs: p.shellFinish.ribs,
        seed: p.shellFinish.seed,
      };
    else if (p.shape === "cage" && p.nasalWing)
      features["creature.cage-finish"] = { finish: "nostril" };
    else if (p.shape === "cage" && p.contourFeather)
      features["creature.cage-finish"] = { finish: "contour feather" };
    if (p.wing)
      features["figure.wing"] = json({
        ...p.wing,
        dark: p.wing.dark.toLowerCase(),
        pale: p.wing.pale.toLowerCase(),
        limb: p.wing.limb.toLowerCase(),
      });
    const organ = creatureOrgan(p.id);
    if (organ) features["creature.organ"] = organ;
    return {
      slot: key(p.id),
      parent: p.parent === undefined ? null : key(p.parent),
      label: p.id,
      shape: coreShape(p.shape),
      position: triple(p.position),
      rotation: quaternion(p.rotation),
      size: triple(p.size),
      color: p.color.toLowerCase(),
      features,
    };
  });
}
