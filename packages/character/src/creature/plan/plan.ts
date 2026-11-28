import { MathUtils, Vector3 } from "three";
import {
  armEnds,
  backKinds,
  backGrowths,
  billProfiles,
  creatureDetails,
  creatureFamilies,
  creatureProfiles,
  crests,
  dressKinds,
  earShapes,
  eyePlaces,
  faceMarkings as faceMarkingKinds,
  flankMarkings as flankMarkingKinds,
  headShapes,
  legEnds,
  legStyles,
  limbSides,
  markingKinds,
  muzzleProfiles,
  snouts,
  tailKinds,
  wingPatterns,
  wingRibCounts as wingCounts,
  wingStructures,
} from "@irudd/document";
import { wingArmKnots } from "../../surfaces/wing.js";
import { need } from "./need.js";
import { creatureOrbit } from "./orbit.js";
import { drawCreatureCoat, readCreatureCoat } from "./coat-draw.js";
import {
  coxalShields,
  beakCage,
  caudalFinCage,
  chelaCage,
  earCage,
  footCage,
  mandibleCage,
  pectoralFinCage,
  nailKnots,
  mammalMuzzle,
  noseWing,
  skullCage,
  skullSurfaceRadius,
  trunkTipCage,
} from "./anatomy.js";
import {
  drawEquipment,
  equipCreature,
  fitDrawnEquipment,
  equipmentRegionCount,
  readEquipment,
} from "./equipment.js";
import { placeDrawnAnatomy } from "./proportions.js";
import { dressCreature, drawDress, readDress } from "./dress.js";
import { drawFamily, type FamilyChoice } from "./families.js";
import { restingWrist } from "./resting-wrist.js";
import { bindParts } from "./bind.js";
import { randomStream } from "../../random.js";
import { applyBackGrowth, drawBackGrowth, growthFamilies } from "./growth.js";
import type { FigureWing } from "@irudd/document";
import type {
  Anchor,
  Cage,
  Form,
  FormPart,
  Limb,
  Plan,
  RawLimb,
  RawPlan,
  Spine,
  SpineStation,
} from "./types.js";

type Extra = Partial<FormPart>;
interface Socket {
  root: Vector3;
  knee: Vector3;
  station: number;
  side: number;
  r0: number;
  frame: SpineStation;
}

const rad = Math.PI / 180;
const { clamp, lerp } = MathUtils;
const num = (v: unknown, a: number, b: number, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? clamp(v, a, b) : fallback;
const whole = (v: unknown, a: number, b: number, fallback: number) =>
  Math.round(num(v, a, b, fallback));
function pick<T extends string>(
  v: unknown,
  options: readonly T[],
  fallback: T = need(options[0]),
): T {
  return options.find((o) => o === v) ?? fallback;
}
const hex = (v: unknown, fallback: string) =>
  typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : fallback;
const smooth = (t: number) => t * t * (3 - 2 * t);
const mix = (a: string, b: string, t: number) => {
  const pa = parseInt(a.slice(1), 16),
    pb = parseInt(b.slice(1), 16);
  const channel = (shift: number) =>
    Math.round(lerp((pa >> shift) & 255, (pb >> shift) & 255, t)) << shift;
  return "#" + ((1 << 24) | channel(16) | channel(8) | channel(0)).toString(16).slice(1);
};
const shade = (color: string, t: number) => mix(color, t < 0 ? "#000000" : "#ffffff", Math.abs(t));

const outlines = {
  plain: [
    [0.16, 1, 1],
    [0.42, 1.12, 1.12],
    [0.82, 1, 1],
  ],
  thigh: [
    [0.04, 1.3, 1.72],
    [0.26, 1.3, 1.74],
    [0.56, 0.94, 1.1],
    [0.82, 0.76, 0.82],
    [0.95, 1.04, 1.16],
  ],
  shin: [
    [0.06, 1.04, 1.16],
    [0.24, 1.14, 1.58],
    [0.52, 0.72, 0.86],
    [0.8, 0.56, 0.62],
    [0.94, 0.88, 0.98],
  ],
  drumstick: [
    [0.05, 1.3, 1.7],
    [0.28, 1.46, 1.92],
    [0.6, 0.86, 0.98],
    [0.85, 0.56, 0.58],
    [0.96, 0.84, 0.92],
  ],
  shank: [
    [0.06, 1.1, 1.1],
    [0.3, 0.72, 0.76],
    [0.7, 0.7, 0.72],
    [0.93, 1.04, 1.04],
  ],
  upper: [
    [0.06, 1.5, 1.42],
    [0.32, 1.3, 1.46],
    [0.66, 0.84, 0.92],
    [0.85, 0.78, 0.82],
    [0.96, 1.06, 1.14],
  ],
  forearm: [
    [0.06, 1.04, 1.08],
    [0.25, 1.42, 1.28],
    [0.58, 0.86, 0.8],
    [0.84, 0.64, 0.56],
    [0.95, 0.9, 0.74],
  ],
  femur: [
    [0.05, 0.72, 0.72],
    [0.15, 1.12, 1.12],
    [0.4, 1.9, 1.9],
    [0.7, 1.16, 1.16],
    [0.88, 0.68, 0.68],
    [0.96, 1.16, 1.16],
  ],
  tibia: [
    [0.05, 1.16, 1.16],
    [0.17, 1.3, 1.3],
    [0.48, 0.76, 0.8],
    [0.84, 0.54, 0.56],
    [0.95, 0.84, 0.84],
  ],
  column: [
    [0.08, 1.16, 1.24],
    [0.4, 0.98, 0.98],
    [0.62, 0.88, 0.88],
    [0.8, 1.12, 1.14],
    [0.92, 1, 1],
  ],
};
type Outline = keyof typeof outlines;

const ornaments = ["none", "fins", "spikes", "plates", "sail"] as const;

export const creatureOptions = {
  profile: creatureProfiles,
  limbKind: ["leg", "arm", "wing", "fin", "tentacle"] as const,
  side: limbSides,
  legStyle: legStyles,
  legEnd: legEnds,
  armEnd: armEnds,
  headShape: headShapes,
  snout: snouts,
  eyePlace: eyePlaces,
  crest: crests,
  tail: tailKinds,
  back: backKinds,
  surface: ["scales", "plain"] as const,
  detail: creatureDetails,
  markings: ["none", ...markingKinds] as const,
};

const isLimbList = (v: unknown): v is readonly RawLimb[] => Array.isArray(v);

export function readLimb(raw: RawLimb = { kind: "leg" }): Limb {
  const kind = pick(raw.kind, creatureOptions.limbKind);
  const from = num(raw.from, 0, 1, kind === "leg" ? 0.15 : 0.8);
  const limb = {
    pairs: whole(raw.pairs, 1, 6, 1),
    side: pick(raw.side, creatureOptions.side),
    from,
    to: num(raw.to, 0, 1, from),
    girth: num(raw.girth, 0.3, 3, 1),
    muscle: num(raw.muscle, 0, 1.6, 0.8),
  };
  if (kind === "leg")
    return {
      kind,
      ...limb,
      style: pick(raw.style, creatureOptions.legStyle),
      ...(raw.sockets === true && raw.style === "insect" ? { sockets: true as const } : {}),
      splay: num(raw.splay, 0, 78, 10),
      fan: num(raw.fan, 0, 240, 0),
      end: pick(raw.end, creatureOptions.legEnd),
      digits: whole(raw.digits, 0, 5, 3),
    };
  if (kind === "arm")
    return {
      kind,
      ...limb,
      length: num(raw.length, 0.08, 3, 0.5),
      drop: num(raw.drop, -80, 90, 68),
      forward: num(raw.forward, -80, 90, 22),
      elbow: num(raw.elbow, 0, 150, 38),
      end: pick(raw.end, creatureOptions.armEnd),
      digits: whole(raw.digits, 1, 6, 3),
      hand: num(raw.hand, 0.4, 3, 1),
      ...(num(raw.raise, -80, 80, 0) ? { raise: num(raw.raise, -80, 80, 0) } : {}),
    };
  if (kind === "wing") {
    const wing = {
      kind,
      ...limb,
      length: num(raw.length, 0.1, 4, 0.9),
      rise: num(raw.rise, -30, 85, 22),
      sweep: num(raw.sweep, -40, 70, 18),
      chord: num(raw.chord, 0.03, 1.5, 0.3),
    };
    const structure = pick(raw.structure, wingStructures);
    if (structure === "plain") return { ...wing, structure };
    const [least, most] = wingCounts[structure];
    return {
      ...wing,
      structure,
      ribs: whole(raw.ribs, least, most, { bat: 4, feather: 9, insect: 5 }[structure]),
      bend: num(raw.bend, 0, 1, 0.5),
      notch: num(raw.notch, 0, 1, 0.4),
      point: num(raw.point, 0, 1, 0.5),
      pattern: pick(raw.pattern, wingPatterns),
      seed:
        typeof raw.seed === "number" && Number.isInteger(raw.seed)
          ? clamp(raw.seed, 0, 4294967295)
          : 1,
    };
  }
  if (kind === "fin")
    return {
      kind,
      ...limb,
      length: num(raw.length, 0.05, 2, 0.3),
      sweep: num(raw.sweep, -40, 80, 35),
      chord: num(raw.chord, 0.03, 1, 0.16),
    };
  return {
    kind,
    ...limb,
    length: num(raw.length, 0.1, 3, 0.6),
    droop: num(raw.droop, -60, 90, 40),
    forward: num(raw.forward, -80, 90, 20),
    fan: num(raw.fan, 0, 240, 0),
    curl: num(raw.curl, -1, 1, 0.3),
  };
}

export function readCreaturePlan(raw: RawPlan = {}): Plan {
  const s = raw.spine ?? {},
    h = raw.head ?? {},
    t = raw.tail ?? {},
    b = raw.back ?? {},
    k = raw.skin ?? {};
  const base = hex(k.base, "#5f7a58");
  const marks = k.markings,
    styledCoat = readCreatureCoat(k.coat);
  const family = creatureFamilies.find((f) => f === raw.family);
  const dressKind = dressKinds.find((d) => d === raw.dress?.kind);
  const billProfile = billProfiles.find((v) => v === h.billProfile);
  const muzzleProfile = muzzleProfiles.find((v) => v === h.muzzleProfile);
  const ear = earShapes.find((v) => v === h.ear);
  const faceMarking = faceMarkingKinds.find((v) => v === k.faceMarking);
  const flankMarking = flankMarkingKinds.find((v) => v === k.flankMarking);
  const markKind = markingKinds.find((v) => v === marks?.kind);
  const growth = backGrowths.find((g) => g === b.kind);
  const bulge = (i: number) => num(s.bulge?.[i], 0.4, 2.2, 1);
  return {
    ...(raw.anatomyRevision === 2 ? { anatomyRevision: 2 as const } : {}),
    ...(family ? { family } : {}),
    ...(raw.equipment ? { equipment: readEquipment(raw.equipment) } : {}),
    ...(raw.dress && dressKind ? { dress: { ...readDress(raw.dress), kind: dressKind } } : {}),
    scale: num(raw.scale, 0.2, 4, 1),
    spine: {
      length: num(s.length, 0.2, 3, 0.9),
      girth: num(s.girth, 0.04, 0.8, 0.2),
      flat: num(s.flat, 0.5, 2.2, 1),
      rear: num(s.rear, -30, 90, 0),
      front: num(s.front, -45, 100, 8),
      arch: num(s.arch, -40, 40, 6),
      profile: pick(s.profile, creatureOptions.profile),
      stance: num(s.stance, 0.05, 3, 0.55),
      bulge: [bulge(0), bulge(1), bulge(2), bulge(3), bulge(4)],
    },
    head: {
      count: whole(h.count, 0, 3, 1),
      neck: num(h.neck, 0.02, 2, 0.28),
      neckPitch: num(h.neckPitch, -40, 100, 48),
      neckGirth: num(h.neckGirth, 0.3, 2, 1),
      size: num(h.size, 0.4, 3, 1),
      shape: pick(h.shape, creatureOptions.headShape),
      snout: pick(h.snout, creatureOptions.snout),
      snoutLength: num(h.snoutLength, 0.3, 4, 1),
      ...(billProfile ? { billProfile } : {}),
      ...(muzzleProfile ? { muzzleProfile } : {}),
      mouth: h.mouth !== false,
      eyes: whole(h.eyes, 0, 8, 2),
      eyeSize: num(h.eyeSize, 0.4, 3, 1),
      eyePlace: pick(h.eyePlace, creatureOptions.eyePlace),
      stalks: num(h.stalks, 0, 0.6, 0),
      lids: num(h.lids, 0, 1, 0.15),
      crest: pick(h.crest, creatureOptions.crest),
      crestSize: num(h.crestSize, 0.3, 3, 1),
      ...(ear ? { ear } : {}),
      jaw: num(h.jaw, 0, 1, 0.12),
      teeth: whole(h.teeth, 0, 6, 0),
      brow: num(h.brow, 0, 1, 0.35),
      nostrils: h.nostrils !== false,
      whiskers: h.whiskers === true,
      ...(num(h.turn, -50, 50, 0) ? { turn: num(h.turn, -50, 50, 0) } : {}),
    },
    limbs: (isLimbList(raw.limbs) ? raw.limbs : [{ kind: "leg", pairs: 2, from: 0.14, to: 0.86 }])
      .slice(0, 8)
      .map((l) => readLimb(l)),
    details: creatureOptions.detail.filter(
      (d) => Array.isArray(raw.details) && raw.details.includes(d),
    ),
    tail: {
      kind: pick(t.kind, creatureOptions.tail, "taper"),
      length: num(t.length, 0.05, 3, 0.5),
      girth: num(t.girth, 0.3, 2.5, 1),
      lift: num(t.lift, -60, 120, 0),
      ...(num(t.sway, -90, 90, 0) ? { sway: num(t.sway, -90, 90, 0) } : {}),
    },
    back: {
      kind: pick(b.kind, creatureOptions.back),
      count: whole(b.count, b.kind === "shingles" ? 2 : 1, 12, 5),
      height: num(b.height, 0.02, 1, 0.14),
      ...(growth
        ? {
            spread: num(b.spread, 0, 1, 0.72),
            seed: whole(b.seed, 0, 4294967295, 1),
          }
        : {}),
    },
    skin: {
      base,
      accent: hex(k.accent, "#d7a24c"),
      pale: hex(k.pale, "#e4d9bd"),
      eye: hex(k.eye, "#e9d75a"),
      surface: pick(k.surface, creatureOptions.surface),
      blend: k.blend !== false,
      belly: num(k.belly, 0, 1, 0.5),
      socks: num(k.socks, 0, 1, 0),
      ...(faceMarking ? { faceMarking } : {}),
      ...(flankMarking ? { flankMarking } : {}),
      ...(k.limbFade === true ? { limbFade: true as const } : {}),
      ...(styledCoat ? { coat: styledCoat } : {}),
      markings:
        marks && markKind
          ? {
              kind: markKind,
              color: hex(marks.color, "#e4d9bd"),
              spacing: num(marks.spacing, 0.06, 0.8, 0.2),
              coverage: num(marks.coverage, 0.1, 0.9, 0.45),
              angle: num(marks.angle, -180, 180, 0),
              seed:
                typeof marks.seed === "number" && Number.isInteger(marks.seed)
                  ? clamp(marks.seed, 0, 4294967295)
                  : 1,
            }
          : null,
    },
  };
}

const girthProfiles = {
  barrel: (t: number) => 0.5 + 0.5 * Math.sin(Math.PI * t) ** 0.7,
  pear: (t: number) => 0.42 + 0.58 * Math.sin(Math.PI * t ** 0.62) ** 0.9,
  wedge: (t: number) => 0.42 + 0.58 * Math.sin(Math.PI * t ** 1.7) ** 0.9,
  tube: () => 0.9,
  wasp: (t: number) =>
    0.34 +
    0.66 *
      Math.max(Math.exp(-(((t - 0.22) / 0.19) ** 2)), 0.82 * Math.exp(-(((t - 0.76) / 0.16) ** 2))),
};
const endCap = (t: number) =>
  Math.sqrt(Math.max(0.06, 1 - (1 - Math.min(1, Math.min(t, 1 - t) / 0.13)) ** 2));

export function spineFrame(plan: Plan): Spine {
  const s = plan.spine,
    k = plan.scale,
    steps = 64,
    points: Vector3[] = [],
    pitches: number[] = [];
  let y = 0,
    z = 0;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const pitch = (s.rear + (s.front - s.rear) * smooth(t) + s.arch * Math.cos(Math.PI * t)) * rad;
    points.push(new Vector3(0, y, z));
    pitches.push(pitch);
    y += (Math.sin(pitch) * s.length * k) / steps;
    z += (Math.cos(pitch) * s.length * k) / steps;
  }
  const radius = (t: number): [number, number] => {
    const u = clamp(t, 0, 1) * 4,
      i = Math.min(3, Math.floor(u));
    const g =
      girthProfiles[s.profile](t) *
      endCap(t) *
      s.girth *
      k *
      lerp(need(s.bulge[i]), need(s.bulge[i + 1]), smooth(u - i));
    return [g * Math.sqrt(s.flat), g / Math.sqrt(s.flat)];
  };
  const hasLegs = plan.limbs.some((l) => l.kind === "leg");
  let lowest = Infinity;
  for (let i = 0; i <= steps; i++)
    lowest = Math.min(
      lowest,
      need(points[i]).y - radius(i / steps)[1] * Math.cos(need(pitches[i])),
    );
  const floats = !hasLegs && plan.limbs.some((l) => ["fin", "wing", "tentacle"].includes(l.kind));
  const lift = hasLegs || floats ? Math.max(s.stance * k, 0.02 - lowest) : 0.004 - lowest;
  const middle = need(points[steps]).z * 0.5;
  for (const p of points) {
    p.y += lift;
    p.z -= middle;
  }
  function at(t: number): SpineStation {
    const u = clamp(t, 0, 1) * steps,
      i = Math.min(steps - 1, Math.floor(u)),
      f = u - i;
    const pitch = lerp(need(pitches[i]), need(pitches[i + 1]), f);
    return {
      centre: need(points[i])
        .clone()
        .lerp(need(points[i + 1]), f),
      tangent: new Vector3(0, Math.sin(pitch), Math.cos(pitch)),
      dorsal: new Vector3(0, Math.cos(pitch), -Math.sin(pitch)),
      pitch,
      radius: radius(clamp(t, 0, 1)),
    };
  }
  return { at, radius };
}
export function buildCreature(raw: RawPlan = {}): Form {
  return constructCreature(raw);
}
function constructCreature(raw: RawPlan = {}, unavailableHands?: Set<string>): Form {
  const plan = readCreaturePlan(raw);
  const k = plan.scale,
    skin = plan.skin,
    spine = spineFrame(plan);
  const parts: FormPart[] = [],
    links: Record<string, string> = {};
  const lean = clamp((plan.spine.rear + plan.spine.front) / 2, 0, 90);
  const coat = (zone: string): Extra => {
    const marked: Extra = {
      ...(skin.markings ? { markings: skin.markings } : {}),
      ...(skin.coat ? { coatZone: zone } : {}),
    };
    if (skin.coat && zone === "end" && !skin.limbFade) return marked;
    if (zone === "end" && !skin.limbFade && skin.socks > 0.04)
      return {
        ...marked,
        undercoat: {
          kind: "Countershade",
          color: mix(skin.base, shade(skin.base, -0.62), skin.socks),
          spacing: 0.2,
          coverage: 0.9,
          angle: 0,
          seed: 7,
        },
      };
    if (skin.belly > 0.04 && skin.markings?.kind !== "Countershade")
      return {
        ...marked,
        undercoat: {
          kind: "Countershade",
          color: mix(skin.base, skin.pale, 0.35 + 0.5 * skin.belly),
          spacing: 0.2,
          coverage: (lean > 40 ? 0.2 : 0.3) + (lean > 40 ? 0.22 : 0.3) * skin.belly,
          angle: Math.round(lean > 40 ? lean * 0.85 : 0),
          seed: 3,
        },
      };
    return marked;
  };
  const organic = (role: string, zone = "body"): Extra => ({
    surface: skin.surface,
    motionRole: role,
    ...(skin.blend ? { blendSkin: true } : {}),
    ...coat(zone),
  });
  const fleshy = (zone = "body"): Extra => ({
    surface: skin.surface,
    motionRole: "rigid",
    ...coat(zone),
  });
  function add(part: FormPart, parent?: string) {
    if (parts.some((p) => p.id === part.id))
      throw new Error("Duplicate creature part " + part.id + ".");
    parts.push(part);
    if (parent) links[part.id] = parent;
    return part.id;
  }
  function sweep(
    id: string,
    points: Vector3[],
    radii: number[][],
    color: string,
    extra: Extra,
    parent?: string,
    pivot: Vector3 = need(points[0]),
  ) {
    return add(
      {
        id,
        shape: "sweep",
        position: pivot.toArray(),
        size: [1, 1, 1],
        rotation: [0, 0, 0],
        color,
        knots: points.map((p, i) => [
          p.x - pivot.x,
          p.y - pivot.y,
          p.z - pivot.z,
          Math.max(0.0012, need(need(radii[i])[0])),
          Math.max(0.0012, need(need(radii[i])[1])),
        ]),
        ...extra,
      },
      parent,
    );
  }
  function cage(
    id: string,
    centre: Vector3,
    size: number[],
    geometry: Cage,
    color: string,
    extra: Extra,
    parent?: string,
    yaw = 0,
  ) {
    return add(
      {
        id,
        shape: "cage",
        cage: geometry,
        position: centre.toArray(),
        size,
        rotation: [0, yaw, 0],
        color,
        ...extra,
      },
      parent,
    );
  }
  function ball(
    id: string,
    centre: Vector3,
    size: number[],
    color: string,
    extra: Extra,
    parent?: string,
    rotation: number[] = [0, 0, 0],
  ) {
    const full = size.map((v) => Math.max(0.006, v));
    return add(
      {
        id,
        shape: "ellipsoid",
        position: centre.toArray(),
        size: full,
        rotation,
        color,
        ...extra,
      },
      parent,
    );
  }
  function segment(
    id: string,
    a: Vector3,
    b: Vector3,
    ra: number,
    rb: number,
    color: string,
    extra: Extra,
    parent: string | undefined,
    outline: Outline = "plain",
    muscle = 1,
  ) {
    const axis = b.clone().sub(a),
      length = axis.length();
    axis.normalize();
    const swell = (v: number) => 1 + (v - 1) * muscle;
    const rooted = ["thigh", "drumstick", "upper", "column"].includes(outline)
      ? 0.74 + 0.3 * Math.min(1, muscle)
      : 0.74;
    const stations = [
      [-0.3 * ra, rooted * ra, rooted * ra * (rooted > 0.74 ? 1.18 : 1)],
      ...outlines[outline].map(([t = 0, w = 0, d = 0]) => {
        const r = lerp(ra, rb, t);
        return [t * length, r * swell(w), r * swell(d)];
      }),
      [length + 0.3 * rb, 0.74 * rb, 0.74 * rb],
    ];
    return sweep(
      id,
      stations.map(([d = 0]) => a.clone().addScaledVector(axis, d)),
      stations.map(([, w = 0, d = 0]) => [w, d]),
      color,
      extra,
      parent,
      a,
    );
  }
  function cuticle(
    id: string,
    a: Vector3,
    b: Vector3,
    rootRadius: number,
    tipRadius: number,
    role: string,
    parent: string,
    row: number,
  ) {
    const axis = b.clone().sub(a),
      length = axis.length();
    axis.normalize();
    const bow = new Vector3(0, 0.45, row < 0.5 ? -0.75 : 0.75);
    bow.addScaledVector(axis, -bow.dot(axis)).normalize();
    const femur = role === "thigh";
    const section = femur
      ? [
          [-0.035, 0.73, 0.83, 0],
          [0.035, 1.15, 1.32, 0],
          [0.15, 0.58, 0.66, 0.013],
          [0.26, 0.98, 1.42, 0.035],
          [0.47, 1.3, 1.72, 0.06],
          [0.72, 0.84, 1.12, 0.052],
          [0.85, 0.58, 0.64, 0.03],
          [0.94, 1.3, 1.28, 0.006],
          [1.012, 0.76, 0.8, 0],
        ]
      : [
          [-0.025, 0.88, 0.87, 0],
          [0.045, 1.22, 1.27, 0.01],
          [0.13, 0.9, 0.94, 0.025],
          [0.26, 0.88, 1.4, 0.04],
          [0.54, 0.6, 0.84, 0.05],
          [0.77, 0.48, 0.58, 0.039],
          [0.9, 0.84, 0.94, 0.019],
          [0.955, 0.62, 0.7, 0.007],
          [1.025, 0.68, 0.72, 0],
        ];
    const points: Vector3[] = [],
      radii: number[][] = [];
    for (const [t = 0, x = 0, y = 0, curve = 0] of section) {
      points.push(
        a
          .clone()
          .addScaledVector(axis, t * length)
          .addScaledVector(bow, curve * length),
      );
      const r = lerp(rootRadius, tipRadius, clamp(t, 0, 1));
      radii.push([x * r, y * r]);
    }
    sweep(
      id,
      points,
      radii,
      femur ? skin.base : mix(skin.base, skin.accent, 0.12),
      { ...organic(role, femur ? "body" : "end"), blendSkin: false },
      parent,
      a,
    );
  }
  const stations = [0, 0.035, 0.1, 0.2, 0.33, 0.47, 0.6, 0.73, 0.85, 0.94, 0.985, 1];
  const serpent = !plan.limbs.some((l) => l.kind === "leg");
  const trunkStations = serpent ? [...stations].reverse() : stations;
  sweep(
    "body",
    trunkStations.map((t) => spine.at(t).centre),
    trunkStations.map((t) => spine.at(t).radius),
    skin.base,
    organic(serpent ? "axial spine" : "torso"),
  );
  const front = spine.at(1),
    rear = spine.at(0),
    girth = plan.spine.girth * k;
  const trunkDepth = (p: Vector3, side: number) => {
    let frame = rear,
      least = Infinity;
    for (let i = 0; i <= 48; i++) {
      const f = spine.at(i / 48),
        gap = (p.y - f.centre.y) ** 2 + (p.z - f.centre.z) ** 2;
      if (gap < least) {
        least = gap;
        frame = f;
      }
    }
    const rel = p.clone().sub(frame.centre),
      [w, d] = frame.radius;
    if (Math.abs(rel.dot(frame.tangent)) > plan.spine.length * k * 0.03) return 0;
    const high = rel.dot(frame.dorsal) / d;
    return Math.abs(high) < 1 ? Math.max(0, w * Math.sqrt(1 - high * high) - side * p.x) : 0;
  };

  let detail = 2;
  const sidesOf = (limb: Limb) =>
    limb.side === "left" ? [1] : limb.side === "right" ? [-1] : [1, -1];
  const budget = () => {
    const h = plan.head;
    let count =
      parts.length +
      8 +
      plan.back.count +
      (plan.details.includes("belly plates") ? 6 : 0) +
      (plan.details.includes("mane") ? 5 : 0) +
      (plan.details.includes("frill") ? 5 : 0) +
      (plan.details.includes("brow horns") ? 1 : 0) +
      (plan.details.includes("cheek frills") ? 1 : 0) +
      (h.crest === "antlers" ? h.count : 0) +
      plan.details.length +
      plan.limbs.filter((l) => l.kind === "arm").reduce((n, l) => n + l.pairs, 0) +
      h.count *
        (5 +
          h.eyes * (3 + (detail > 0 && h.lids > 0.04 ? 1 : 0) + (h.stalks > 0.005 ? 1 : 0)) +
          (detail > 0 ? 4 + (h.whiskers ? 4 : 0) : 0) +
          5 +
          (h.snout === "muzzle" && detail > 0
            ? 4 * (detail > 1 ? h.teeth : Math.min(2, h.teeth))
            : 0));
    const extras =
      detail > 0 ? plan.details.filter((d) => d === "spurs" || d === "shoulder spikes").length : 0;
    for (const limb of plan.limbs)
      count +=
        limb.pairs *
        sidesOf(limb).length *
        (limb.kind === "leg"
          ? 3 +
            extras +
            (limb.style === "insect" ? 0 : 1) +
            (limb.style === "bird" ? 1 : 0) +
            (detail > 1 && ["paw", "talons"].includes(limb.end) ? limb.digits : 0)
          : limb.kind === "arm"
            ? 3 + extras + (limb.end === "pincer" ? 2 : 0)
            : limb.kind === "wing"
              ? 2
              : 1);
    if (detail && plan.limbs.some((limb) => limb.kind === "leg" && limb.sockets)) count += 2;
    return count;
  };
  while (detail > 0 && budget() > 126) detail--;
  if (budget() > 128)
    throw new Error("This body plan needs more than 128 parts. Remove a limb group.");
  const counters: Record<string, number> = {};
  const hard = { surface: "plain", motionRole: "rigid" };
  let yokes = 0,
    pelvises = 0;
  const anchors: Anchor[] = [];
  const socketRows: [Socket[], Socket[]] = [[], []];
  const label = (side: number, kind: string) => {
    const name = (side > 0 ? "left " : "right ") + kind;
    const count = (counters[name] ?? 0) + 1;
    counters[name] = count;
    return name + " " + count;
  };
  for (const limb of plan.limbs) {
    for (let i = 0; i < limb.pairs; i++) {
      const u = limb.pairs === 1 ? 0.5 : i / (limb.pairs - 1);
      const station =
        limb.pairs === 1
          ? (limb.from + limb.to) / 2
          : lerp(Math.max(limb.from, limb.to), Math.min(limb.from, limb.to), u);
      const frame = spine.at(station),
        [w, d] = frame.radius;
      const g = girth * limb.girth;
      for (const side of sidesOf(limb)) {
        const out = new Vector3(side, 0, 0);
        if (limb.kind === "leg") {
          const id = label(side, "leg");
          const root = frame.centre
            .clone()
            .addScaledVector(out, w * 0.68)
            .add(new Vector3(0, -d * 0.3 * Math.abs(Math.cos(frame.pitch)), 0));
          const fan = (limb.pairs === 1 ? 0 : lerp(0.5, -0.5, u)) * limb.fan * rad;
          const reachDir = new Vector3(side * Math.cos(fan), 0, Math.sin(fan));
          const pointed = limb.end === "point";
          const thick = limb.style === "pillar" ? 0.62 : limb.style === "insect" ? 0.3 : 0.46;
          const r0 = g * thick,
            r1 = g * thick * (limb.style === "pillar" ? 0.86 : 0.7),
            r2 = g * thick * (limb.style === "pillar" ? 0.8 : pointed ? 0.4 : 0.46);
          const ankleHeight = pointed
            ? 0.02 * k + 0.5 * g
            : Math.max(
                (limb.end === "hoof" ? 0.07 : 0.05) * k * Math.min(1.6, limb.girth),
                r2 * 1.08,
              );
          const height = Math.max(0.03 * k, root.y - ankleHeight);
          const reach =
            height * Math.tan(limb.splay * rad) +
            (limb.style === "insect" ? Math.max(w * 0.9, g * 0.8) : w * 0.12);
          const ankle = new Vector3(
            root.x + reachDir.x * reach,
            ankleHeight,
            root.z + reachDir.z * reach,
          );
          const span = ankle.clone().sub(root),
            length = span.length();
          const kneeSign = station < 0.56 ? 1 : -1;
          const forward = new Vector3(0, 0, kneeSign);
          let knee: Vector3, hock: Vector3 | undefined;
          if (limb.style === "insect")
            knee = root
              .clone()
              .addScaledVector(reachDir, reach * 0.46)
              .add(new Vector3(0, height * 0.46 + g * 0.8, 0));
          else if (limb.style === "bird") {
            knee = root
              .clone()
              .addScaledVector(span, 0.34)
              .addScaledVector(forward, 0.2 * length);
            hock = root
              .clone()
              .addScaledVector(span, 0.7)
              .addScaledVector(forward, -0.17 * length);
          } else
            knee = root
              .clone()
              .addScaledVector(span, 0.5)
              .addScaledVector(forward, (limb.style === "pillar" ? 0.035 : 0.13) * length)
              .addScaledVector(reachDir, 0.03 * length);
          const forms: Record<typeof limb.style, [Outline, Outline]> = {
            mammal: ["thigh", "shin"],
            bird: ["drumstick", "shin"],
            insect: ["femur", "tibia"],
            pillar: ["column", "column"],
          };
          const [upperForm, lowerForm] = forms[limb.style];
          if (
            i === 0 &&
            side === sidesOf(limb)[0] &&
            Math.sin(frame.pitch) > 0.72 &&
            limb.style !== "insect"
          ) {
            pelvises++;
            ball(
              "pelvis" + (pelvises > 1 ? " " + pelvises : ""),
              frame.centre.clone().add(new Vector3(0, -d * 0.1, 0)),
              [2 * (w * 0.8 + r0 * 0.7), r0 * 2.6, 2 * d * 1.02],
              skin.base,
              organic("rigid"),
              "body",
            );
          }
          if (limb.style !== "insect" && Math.sin(frame.pitch) <= 0.72) {
            const rise = Math.min(d * 0.85, r0 * 3.2);
            ball(
              id + " haunch",
              root
                .clone()
                .add(new Vector3(side * w * 0.07, (rise - r0 * 0.4) / 2, kneeSign * r0 * 0.1)),
              [
                2 * r0 * (0.74 + 0.26 * limb.muscle),
                rise + r0 * 0.4,
                2 * r0 * (1.2 + 0.45 * limb.muscle),
              ],
              skin.base,
              organic("rigid"),
              "body",
              [-frame.pitch / rad || 0, 0, 0],
            );
          }
          if (limb.sockets && detail) {
            socketRows[side > 0 ? 0 : 1].push({ root, knee, station, side, r0, frame });
          }
          if (limb.style === "insect" && plan.anatomyRevision === 2) {
            cuticle(id + " thigh", root, knee, r0, r1, "thigh", "body", station);
            cuticle(id + " shin", knee, ankle, r1, r2, "shin", id + " thigh", station);
          } else {
            segment(
              id + " thigh",
              root,
              knee,
              r0,
              r1,
              skin.base,
              organic("thigh"),
              "body",
              upperForm,
              limb.muscle,
            );
            segment(
              id + " shin",
              knee,
              hock ?? ankle,
              r1,
              r2,
              skin.base,
              organic("shin", "end"),
              id + " thigh",
              lowerForm,
              limb.muscle,
            );
          }
          anchors.push({
            id,
            kind: "leg",
            station,
            upper: id + " thigh",
            lower: id + " shin",
            root,
            mid: knee,
            end: hock ?? ankle,
            r0,
            r1,
            r2,
            side,
          });
          const sole = new Vector3(ankle.x, 0, ankle.z);
          const toeDir = new Vector3(reachDir.x * 0.35, 0, 1).normalize();
          const footRole = { surface: skin.surface, motionRole: "foot", ...coat("end") };
          let foot = id + " foot",
            carrier = id + " shin",
            endRole = footRole;
          if (hock) {
            segment(
              foot,
              hock,
              ankle,
              r2 * 0.92,
              r2 * 0.86,
              skin.base,
              footRole,
              carrier,
              "shank",
              limb.muscle,
            );
            carrier = foot;
            foot = id + " toes";
            endRole = { ...footRole, motionRole: "rigid" };
          }
          if (plan.anatomyRevision === 2) {
            const r = Math.max(0.005, r2);
            const footColor =
              limb.end === "hoof"
                ? mix(skin.base, "#292522", 0.9)
                : limb.end === "paddle"
                  ? skin.accent
                  : shade(skin.base, -0.18);
            const geometry = footCage(limb.end, limb.style, limb.digits, ankle.y / r);
            if (limb.end === "point" && limb.style === "mammal") {
              const towardShin = knee.clone().sub(ankle).normalize();
              const right = new Vector3(toeDir.z, 0, -toeDir.x);
              for (const v of geometry.vertices) {
                const weight = MathUtils.smoothstep(need(v[1]), -0.5, 0.85);
                v[0] = need(v[0]) + weight * 1.45 * towardShin.dot(right);
                v[1] = need(v[1]) + weight * 0.55 * towardShin.y;
                v[2] = need(v[2]) + weight * (0.68 + 1.45 * towardShin.dot(toeDir));
              }
            }
            const verticalUnit = Math.max(r, ankle.y / 9);
            if (verticalUnit !== r)
              for (const vertex of geometry.vertices)
                vertex[1] = need(vertex[1]) * (r / verticalUnit);
            cage(
              foot,
              ankle,
              [r, verticalUnit, r],
              geometry,
              footColor,
              {
                ...endRole,
                ...(limb.end === "hoof" || limb.end === "point" ? { surface: "plain" } : {}),
              },
              carrier,
              Math.atan2(toeDir.x, toeDir.z) / rad,
            );
            if (detail > 1 && ["paw", "talons"].includes(limb.end)) {
              const right = new Vector3(toeDir.z, 0, -toeDir.x);
              for (let digit = 0; digit < limb.digits; digit++) {
                const points = nailKnots(limb.end, limb.digits, digit).map(
                  ([x = 0, y = 0, z = 0]) =>
                    sole
                      .clone()
                      .addScaledVector(right, r * x)
                      .addScaledVector(toeDir, r * z)
                      .setY(r * y),
                );
                sweep(
                  id + " claw " + (digit + 1),
                  points,
                  [
                    [0.27 * r, 0.26 * r],
                    [0.25 * r, 0.25 * r],
                    [0.17 * r, 0.18 * r],
                    [0.0013, 0.0013],
                  ],
                  mix(skin.pale, "#706353", 0.28),
                  hard,
                  foot,
                );
              }
            }
          } else if (limb.end === "point")
            sweep(
              foot,
              [
                ankle.clone().lerp(hock ?? knee, 0.1),
                ankle.clone().lerp(sole, 0.45),
                sole.clone().setY(0.003),
              ],
              [
                [r2 * 1.02, r2 * 1.02],
                [r2 * 0.72, r2 * 0.72],
                [0.004 * k, 0.004 * k],
              ],
              skin.pale,
              { ...endRole, surface: "plain" },
              carrier,
              ankle,
            );
          else if (limb.end === "hoof")
            sweep(
              foot,
              [
                ankle.clone().add(new Vector3(0, r2 * 0.3, 0)),
                ankle
                  .clone()
                  .lerp(sole, 0.5)
                  .addScaledVector(toeDir, r2 * 0.3),
                sole
                  .clone()
                  .addScaledVector(toeDir, r2 * 0.3)
                  .setY(0.004),
              ],
              [
                [r2 * 0.98, r2 * 0.98],
                [r2 * 1.22, r2 * 1.3],
                [r2 * 1.34, r2 * 1.5],
              ],
              "#2d2a27",
              { ...endRole, surface: "plain" },
              carrier,
              ankle,
            );
          else if (limb.end === "paddle")
            sweep(
              foot,
              [
                ankle,
                sole
                  .clone()
                  .addScaledVector(toeDir, r2 * 1.2)
                  .setY(r2 * 0.56),
                sole
                  .clone()
                  .addScaledVector(toeDir, r2 * 4.2)
                  .setY(r2 * 0.26),
              ],
              [
                [r2 * 0.8, r2 * 0.8],
                [r2 * 1.9, r2 * 0.42],
                [r2 * 2.6, r2 * 0.2],
              ],
              skin.accent,
              endRole,
              carrier,
            );
          else {
            const flat = limb.end === "pad",
              talon = limb.end === "talons";
            ball(
              foot,
              sole
                .clone()
                .addScaledVector(toeDir, r2 * (flat ? 0.1 : talon ? 0.35 : 0.7))
                .setY(flat ? r2 * 0.6 : r2 * 0.62),
              flat
                ? limb.style === "pillar"
                  ? [r2 * 2.5, r2 * 1.1, r2 * 2.6]
                  : [r2 * 3.4, r2 * 1.2, r2 * 3.4]
                : talon
                  ? [r2 * 2.3, r2 * 1.24, r2 * 2.6]
                  : [r2 * 2.5, r2 * 1.24, r2 * 3.5],
              flat ? shade(skin.base, -0.3) : skin.base,
              endRole,
              carrier,
            );
            if (!flat && detail > 1 && limb.digits)
              for (let c = 0; c < limb.digits; c++) {
                const spread = limb.digits === 1 ? 0 : (c / (limb.digits - 1) - 0.5) * 1.3;
                const dir = toeDir
                  .clone()
                  .applyAxisAngle(new Vector3(0, 1, 0), -spread * 0.9)
                  .normalize();
                const start = sole
                  .clone()
                  .addScaledVector(dir, r2 * (talon ? 1.1 : 2.1))
                  .setY(r2 * (talon ? 0.7 : 0.5));
                const reachToe = r2 * (talon ? 3.4 : 1.5);
                sweep(
                  id + " claw " + (c + 1),
                  [
                    start,
                    start
                      .clone()
                      .addScaledVector(dir, reachToe * 0.55)
                      .setY(r2 * (talon ? 0.95 : 0.45)),
                    start.clone().addScaledVector(dir, reachToe).setY(0.004),
                  ],
                  [
                    [r2 * (talon ? 0.42 : 0.3), r2 * (talon ? 0.42 : 0.3)],
                    [r2 * (talon ? 0.3 : 0.22), r2 * (talon ? 0.34 : 0.22)],
                    [0.0016, 0.0016],
                  ],
                  skin.pale,
                  { surface: "plain", motionRole: "rigid" },
                  foot,
                );
              }
          }
        } else if (limb.kind === "arm") {
          const id = label(side, "arm");
          const root = frame.centre.clone().addScaledVector(out, w * 0.86);
          const yaw = limb.forward * rad,
            total = limb.length * k,
            upper = total * 0.5,
            lower = total * 0.5,
            wristScale = ((g * 0.25) / 0.03) * 1.2,
            handScale =
              plan.anatomyRevision === 2
                ? Math.min(wristScale, (lower * 1.06) / 0.182)
                : wristScale,
            handReach =
              limb.end === "hand"
                ? 0.182 * handScale * limb.hand
                : limb.end === "pincer"
                  ? 0.182 * wristScale * limb.hand
                  : g * 1.7;
          let upperDir = new Vector3(),
            lowerDir = new Vector3(),
            hinge = new Vector3(),
            elbow = new Vector3(),
            wrist = new Vector3();
          const gesture = limb.raise ?? 0,
            lifted = side > 0 === gesture > 0 ? Math.abs(gesture) : -0.35 * Math.abs(gesture),
            bend = (limb.elbow + Math.max(0, lifted) * 0.55) * rad;
          for (
            let drop = (limb.drop - lifted) * rad, tries = 0;
            tries < 40;
            tries++, drop -= 3 * rad
          ) {
            upperDir = new Vector3(
              side * Math.cos(drop) * Math.cos(yaw),
              -Math.sin(drop),
              Math.cos(drop) * Math.sin(yaw),
            ).normalize();
            const ahead = Math.max(0, upperDir.z);
            hinge = new Vector3().crossVectors(
              upperDir,
              new Vector3(0, ahead, 1 - ahead).normalize(),
            );
            if (hinge.lengthSq() < 1e-4) hinge.set(-1, 0, 0);
            hinge.normalize();
            lowerDir = upperDir
              .clone()
              .applyAxisAngle(hinge, Math.min(150 * rad, bend))
              .normalize();
            elbow = root.clone().addScaledVector(upperDir, upper);
            wrist = elbow.clone().addScaledVector(lowerDir, lower);
            const lowest = Math.min(elbow.y, wrist.y, wrist.y + lowerDir.y * handReach) - g * 0.45;
            if (lowest > 0.015 * k || drop < -80 * rad) break;
          }
          const r0 = g * 0.4,
            r1 = g * 0.33,
            r2 = g * 0.25;
          if (side === sidesOf(limb)[0]) {
            yokes++;
            ball(
              "shoulders" + (yokes > 1 ? " " + yokes : ""),
              frame.centre.clone().addScaledVector(frame.dorsal, d * 0.08),
              [2 * (w * 0.9 + r0 * 0.75), 2 * d * 1.04, r0 * 3.2],
              skin.base,
              organic("rigid"),
              "body",
              [-frame.pitch / rad || 0, 0, 0],
            );
          }
          segment(
            id + " upper",
            root,
            elbow,
            r0,
            r1,
            skin.base,
            organic("upper arm"),
            "body",
            "upper",
            limb.muscle,
          );
          segment(
            id + " forearm",
            elbow,
            wrist,
            r1,
            r2,
            skin.base,
            organic("forearm", "end"),
            id + " upper",
            "forearm",
            limb.muscle,
          );
          anchors.push({
            id,
            kind: "arm",
            station,
            upper: id + " upper",
            lower: id + " forearm",
            root,
            mid: elbow,
            end: wrist,
            r0,
            r1,
            r2,
            side,
          });
          if (limb.end === "pincer" && plan.anatomyRevision === 2) {
            const size = r2 * 3 * limb.hand;
            const scale = [size, size, size];
            const opening = hinge.clone().multiplyScalar(side);
            cage(
              id + " hand",
              wrist,
              scale,
              chelaCage("palm", lowerDir, opening),
              mix(skin.base, skin.accent, 0.63),
              { surface: skin.surface, motionRole: "hand" },
              id + " forearm",
            );
            for (const finger of ["lower", "upper"]) {
              cage(
                id + " pincer " + finger,
                wrist,
                scale,
                chelaCage(finger, lowerDir, opening),
                mix(skin.accent, "#583b2c", finger === "upper" ? 0.28 : 0.48),
                { ...hard, hornSwatch: 2 },
                id + " hand",
              );
            }
          } else if (limb.end === "pincer") {
            const size = r2 * 3 * limb.hand;
            const palmEnd = wrist.clone().addScaledVector(lowerDir, size * 0.9);
            sweep(
              id + " hand",
              [
                wrist.clone().addScaledVector(lowerDir, -0.4 * r2),
                wrist.clone().addScaledVector(lowerDir, size * 0.42),
                palmEnd,
              ],
              [
                [r2 * 0.95, r2 * 0.95],
                [size * 0.5, size * 0.4],
                [size * 0.36, size * 0.28],
              ],
              skin.accent,
              { surface: skin.surface, motionRole: "hand" },
              id + " forearm",
              wrist,
            );
            for (const jaw of [1, -1]) {
              const from = palmEnd
                .clone()
                .addScaledVector(hinge, jaw * size * 0.16)
                .addScaledVector(lowerDir, -size * 0.2);
              sweep(
                id + " pincer " + (jaw > 0 ? "upper" : "lower"),
                [
                  from,
                  from
                    .clone()
                    .addScaledVector(lowerDir, size * 0.62)
                    .addScaledVector(hinge, jaw * size * 0.3),
                  from
                    .clone()
                    .addScaledVector(lowerDir, size * 1.3)
                    .addScaledVector(hinge, jaw * size * 0.03),
                ],
                [
                  [size * 0.24, size * 0.24],
                  [size * 0.17, size * 0.2],
                  [0.003, 0.003],
                ],
                jaw > 0 ? skin.accent : shade(skin.accent, -0.18),
                hard,
                id + " hand",
              );
            }
          } else if (limb.end === "hand") {
            const native = plan.anatomyRevision === 2;
            const pad = ["beak", "bill", "mandibles"].includes(plan.head.snout) ? "talon" : "paw";
            const size = [0.082, 0.182, 0.04].map((v) => v * handScale * limb.hand);
            add(
              {
                id: id + " hand",
                shape: "hand",
                position: wrist
                  .clone()
                  .addScaledVector(lowerDir, -0.5 * r2)
                  .toArray(),
                size,
                frameSize: [...size],
                rotation: restingWrist(lowerDir, new Vector3(-side, 0, -0.25)),
                color: native ? mix(skin.base, skin.accent, 0.12) : mix(skin.base, skin.pale, 0.3),
                surface: "plain",
                motionRole: "hand",
                grip: {
                  side: -side,
                  fingers: limb.digits,
                  curl: 0.22,
                  spread: 0.3,
                  ...(native ? { pad } : {}),
                },
              },
              id + " forearm",
            );
          } else if (limb.end === "none")
            ball(
              id + " hand",
              wrist,
              [r2 * 2.1, r2 * 2.1, r2 * 2.1],
              skin.base,
              { surface: skin.surface, motionRole: "hand" },
              id + " forearm",
            );
          else if (limb.end === "spike")
            sweep(
              id + " hand",
              [
                wrist.clone().addScaledVector(lowerDir, -0.4 * r2),
                wrist.clone().addScaledVector(lowerDir, r2 * 2.6),
                wrist
                  .clone()
                  .addScaledVector(lowerDir, r2 * 6.5)
                  .addScaledVector(hinge, 0),
              ],
              [
                [r2 * 0.95, r2 * 0.95],
                [r2 * 0.62, r2 * 0.75],
                [0.002, 0.002],
              ],
              skin.pale,
              { surface: "plain", motionRole: "hand" },
              id + " forearm",
              wrist,
            );
        } else if (limb.kind === "wing") {
          const id = label(side, "wing");
          const root = frame.centre
            .clone()
            .addScaledVector(out, w * 0.5)
            .addScaledVector(frame.dorsal, d * 0.62);
          const rise = limb.rise * rad,
            back = limb.sweep * rad,
            span = limb.length * k;
          const dir = new Vector3(
            side * Math.cos(rise) * Math.cos(back),
            Math.sin(rise),
            -Math.cos(rise) * Math.sin(back),
          ).normalize();
          const chord = limb.chord * k;
          if (limb.structure !== "plain") {
            const stout = { bat: 0.036, feather: 0.042, insect: 0.019 }[limb.structure];
            const bone = stout * (0.6 * span + 0.95 * chord);
            const axis = rear.centre.clone().sub(front.centre).normalize(),
              above = new Vector3(0, -axis.z, axis.y);
            const folded = smooth(clamp((Math.abs(dir.dot(axis)) - 0.55) / 0.4, 0, 1));
            const rearward = axis
              .clone()
              .add(new Vector3(0, -0.12, 0))
              .normalize()
              .lerp(above.clone().addScaledVector(out, -0.3).normalize(), folded)
              .normalize();
            root.addScaledVector(above, -folded * chord * 0.8);
            let sunk = 0;
            for (const along of [0.3, 0.5, 0.7, 0.9])
              for (const across of [0, 0.35, 0.7])
                sunk = Math.max(
                  sunk,
                  trunkDepth(
                    root
                      .clone()
                      .addScaledVector(dir, span * along)
                      .addScaledVector(rearward, chord * 1.15 * across),
                    side,
                  ),
                );
            if (sunk > 0) root.addScaledVector(out, sunk + bone);
            const film = {
              bat: skin.accent,
              feather: skin.accent,
              insect: mix(skin.accent, skin.pale, 0.55),
            }[limb.structure];
            const fixed = (v: Vector3): [number, number, number] => [
              Number(v.x.toFixed(5)),
              Number(v.y.toFixed(5)),
              Number(v.z.toFixed(5)),
            ];
            const wing: FigureWing = {
              structure: limb.structure,
              side: side > 0 ? 1 : -1,
              span: fixed(dir.clone().multiplyScalar(span)),
              back: fixed(rearward.multiplyScalar(chord * 1.15)),
              bone: Number(bone.toFixed(5)),
              bend: limb.bend,
              count: limb.ribs,
              notch: limb.notch,
              point: limb.point,
              pattern: limb.pattern,
              seed: (limb.seed + i * 7919) >>> 0,
              dark: shade(
                limb.structure === "feather" ? mix(skin.accent, skin.base, 0.3) : skin.accent,
                -0.62,
              ),
              pale: skin.pale,
              limb: limb.structure === "insect" ? shade(skin.base, -0.35) : skin.base,
            };
            const knots = wingArmKnots(wing);
            sweep(
              id,
              knots.map(([x = 0, y = 0, z = 0]) => root.clone().add(new Vector3(x, y, z))),
              knots.map(([, , , r = 0]) => [r, r]),
              limb.structure === "insect" ? wing.limb : skin.base,
              { surface: limb.structure === "insect" ? "plain" : skin.surface, motionRole: "wing" },
              "body",
            );
            add(
              {
                id: id + (limb.structure === "feather" ? " feathers" : " membrane"),
                shape: "wing",
                position: root.toArray(),
                size: [1, 1, 1],
                rotation: [0, 0, 0],
                color: film,
                surface: "plain",
                motionRole: "rigid",
                wing,
              },
              id,
            );
            continue;
          }
          const rearward = new Vector3(0, -0.12, -1).normalize();
          const spar = [0, 0.3, 0.62, 1].map((t) =>
            root
              .clone()
              .addScaledVector(dir, span * t)
              .add(new Vector3(0, Math.sin(t * Math.PI) * span * 0.06, 0)),
          );
          const sr = g * 0.2;
          sweep(
            id,
            spar,
            [
              [sr, sr],
              [sr * 0.86, sr * 0.86],
              [sr * 0.62, sr * 0.62],
              [sr * 0.2, sr * 0.2],
            ],
            skin.base,
            { surface: skin.surface, motionRole: "wing" },
            "body",
          );
          const fill = [0.02, 0.26, 0.55, 0.82, 1];
          sweep(
            id + " membrane",
            fill.map((t) => {
              const reachBack = chord * (0.56 - 0.2 * t) * (t > 0.92 ? 0.55 : 1);
              return root
                .clone()
                .addScaledVector(dir, span * t * 0.98)
                .add(new Vector3(0, Math.sin(t * Math.PI) * span * 0.06, 0))
                .addScaledVector(rearward, reachBack);
            }),
            fill.map((t) => [
              chord * (0.62 - 0.22 * t) * (t > 0.92 ? 0.45 : 1),
              Math.max(0.004, sr * 0.2),
            ]),
            skin.accent,
            { surface: "plain", motionRole: "wing" },
            "body",
          );
        } else if (limb.kind === "fin") {
          const id = label(side, "fin");
          const root = frame.centre.clone().addScaledVector(out, w * 0.9);
          const back = limb.sweep * rad,
            span = limb.length * k,
            chord = limb.chord * k;
          if (plan.anatomyRevision === 2) {
            const unit = Math.max(span, chord, g);
            cage(
              id,
              root,
              [unit, unit, unit],
              pectoralFinCage(side, back, span, chord, g),
              skin.accent,
              { surface: skin.surface, motionRole: "fin" },
              "body",
            );
            continue;
          }
          const dir = new Vector3(side * Math.cos(back), -0.18, -Math.sin(back)).normalize();
          sweep(
            id,
            [0, 0.35, 0.72, 1].map((t) => root.clone().addScaledVector(dir, span * t)),
            [
              [chord * 0.42, g * 0.14],
              [chord * 0.56, g * 0.1],
              [chord * 0.4, g * 0.06],
              [chord * 0.08, 0.004],
            ],
            skin.accent,
            { surface: skin.surface, motionRole: "fin" },
            "body",
          );
        } else {
          const id = label(side, "tentacle");
          const droop = limb.droop * rad,
            yaw = limb.forward * rad + (limb.pairs === 1 ? 0 : lerp(0.5, -0.5, u)) * limb.fan * rad,
            span = limb.length * k;
          const upright = Math.abs(Math.sin(frame.pitch));
          const root = frame.centre
            .clone()
            .addScaledVector(out, w * 0.82 * Math.max(Math.cos(yaw), 0.18 - upright))
            .add(new Vector3(0, 0, d * 0.82 * Math.sin(yaw) * upright));
          const start = new Vector3(side * Math.cos(yaw), 0.25, Math.sin(yaw)).normalize();
          const fall = new Vector3(
            side * 0.25 * Math.cos(yaw),
            -1,
            0.25 * Math.sin(yaw),
          ).normalize();
          const hook = new Vector3(
            side * 0.7 * Math.cos(yaw),
            0.75,
            0.7 * Math.sin(yaw),
          ).normalize();
          const around = new Vector3(-Math.sin(yaw), 0, side * Math.cos(yaw));
          const phase = i * 2.1 + (side > 0 ? 0 : 1.3);
          const points = [root.clone()];
          const steps = plan.anatomyRevision === 2 ? 14 : 6;
          for (let j = 1; j <= steps; j++) {
            const t = j / steps;
            if (plan.anatomyRevision === 2) {
              const curl = limb.curl;
              const reach = 0.43 + 0.08 * Math.sin(phase);
              const turn = Math.max(0, (t - reach) / (1 - reach));
              const angle =
                0.15 -
                (droop + 0.24) * smooth(Math.min(1, t / 0.65)) +
                (curl >= 0 ? 5.55 : 2.15) * curl * turn ** 1.2;
              const bearing =
                yaw +
                0.27 * Math.sin(phase + 3.2 * t) * t +
                0.63 * curl * Math.sin(phase + 0.7) * turn;
              const dir = new Vector3(
                side * Math.cos(bearing) * Math.cos(angle),
                Math.sin(angle),
                Math.sin(bearing) * Math.cos(angle),
              );
              const next = need(points.at(-1))
                .clone()
                .addScaledVector(dir, span / steps);
              if (next.y < 0.018 * k) {
                const depth = 0.018 * k - next.y;
                next.y += depth;
                next.x += side * Math.cos(bearing) * depth * 0.75;
                next.z += Math.sin(bearing) * depth * 0.75;
              }
              points.push(next);
              continue;
            }
            const dir = start
              .clone()
              .lerp(fall, smooth(t) * Math.min(1, droop / (70 * rad) + 0.25))
              .normalize();
            const tip = smooth(Math.max(0, (t - 0.45) / 0.55));
            if (limb.curl > 0) dir.lerp(hook, limb.curl * tip * 0.9);
            else dir.lerp(fall, -limb.curl * tip);
            dir
              .addScaledVector(around, 0.16 * Math.abs(limb.curl) * Math.sin(t * 4.2 + phase))
              .normalize();
            points.push(
              need(points.at(-1))
                .clone()
                .addScaledVector(dir, span / 6),
            );
          }
          for (const p of points) p.y = Math.max(p.y, 0.012 * k);
          const tr = g * 0.3;
          sweep(
            id,
            points,
            points.map((_, j) => {
              const t = j / steps;
              const r = Math.max(0.004, tr * (1 - 0.86 * t ** 1.2));
              return plan.anatomyRevision === 2
                ? [r * (1.12 - 0.1 * t), r * (0.88 + 0.1 * t)]
                : [r, r];
            }),
            skin.base,
            plan.anatomyRevision === 2
              ? { ...organic("tail"), blendSkin: false, suckerRows: tr > 0.032 * k ? 2 : 1 }
              : organic("tail"),
            "body",
          );
        }
      }
    }
  }

  const has = (name: string) => detail > 0 && plan.details.some((d) => d === name);
  if (has("spurs"))
    for (const a of anchors) {
      const dir = a.mid.clone().sub(a.root.clone().lerp(a.end, 0.5));
      if (dir.lengthSq() < 1e-8) dir.set(0, 0, -1);
      dir.normalize();
      const from = a.mid.clone().addScaledVector(dir, a.r1 * 0.4);
      sweep(
        a.id + " spur",
        [
          from,
          from.clone().addScaledVector(dir, a.r1 * 0.9),
          from
            .clone()
            .addScaledVector(dir, a.r1 * 2)
            .add(new Vector3(0, a.r1 * 0.4, 0)),
        ],
        [
          [a.r1 * 0.4, a.r1 * 0.4],
          [a.r1 * 0.26, a.r1 * 0.26],
          [0.002, 0.002],
        ],
        skin.pale,
        hard,
        a.upper,
      );
    }
  if (has("shoulder spikes"))
    for (const a of anchors) {
      const dir = new Vector3(a.side * 0.62, 0.78, -0.1).normalize();
      const from = a.root.clone().addScaledVector(dir, a.r0 * 0.7);
      const tall = Math.min(a.r0, girth * 0.45);
      sweep(
        a.id + " shoulder spike",
        [
          from,
          from.clone().addScaledVector(dir, tall * 1.2),
          from
            .clone()
            .addScaledVector(dir, tall * 2.4)
            .add(new Vector3(0, 0, -tall * 0.6)),
        ],
        [
          [tall * 0.42, tall * 0.42],
          [tall * 0.27, tall * 0.27],
          [0.002, 0.002],
        ],
        skin.pale,
        hard,
        a.upper,
      );
    }
  if (has("belly plates"))
    for (let j = 0; j < 6; j++) {
      const t = lerp(0.2, 0.84, j / 5),
        f = spine.at(t),
        [w, d] = f.radius;
      ball(
        "belly plate " + (j + 1),
        f.centre.clone().addScaledVector(f.dorsal, -d * 0.8),
        [w * 1.36, d * 0.5, plan.spine.length * k * 0.15],
        mix(skin.pale, skin.base, 0.18),
        hard,
        "body",
        [-f.pitch / rad || 0, 0, 0],
      );
    }

  const tail = plan.tail;
  if (tail.kind !== "none") {
    const [rw, rd] = spine.at(0.06).radius;
    const upright = Math.max(0, Math.sin(rear.pitch));
    const dir = rear.tangent
      .clone()
      .negate()
      .multiplyScalar(1 - upright)
      .add(new Vector3(0, -0.3, -1).multiplyScalar(upright))
      .normalize();
    const length = (tail.kind === "stub" ? 0.3 : 1) * tail.length * k;
    const stinger = tail.kind === "stinger";
    const root = spine.at(0.03).centre;
    const points = [root.clone()];
    const count = 6;
    let heading = dir.clone();
    const axis = new Vector3(1, 0, 0),
      swayAxis = new Vector3(0, 1, 0);
    for (let j = 1; j <= count; j++) {
      const t = j / count;
      const turn = stinger ? (150 * rad) / count : (tail.lift * rad * (0.4 + 1.2 * t)) / count;
      heading = heading.clone().applyAxisAngle(axis, turn).normalize();
      if (tail.sway)
        heading.applyAxisAngle(swayAxis, (tail.sway * rad * (0.3 + 1.4 * t)) / count).normalize();
      points.push(
        need(points.at(-1))
          .clone()
          .addScaledVector(heading, length / count),
      );
    }
    for (const p of points) p.y = Math.max(p.y, 0.01 * k);
    const base = Math.min(rw, rd) * 0.78 * tail.girth;
    const tip = tail.kind === "club" || tail.kind === "fluke" || tail.kind === "fan" ? 0.3 : 0.05;
    sweep(
      "tail",
      points,
      points.map((_, j) => {
        const t = j / count,
          r = Math.max(0.003, base * lerp(1, tip, t ** 0.85));
        return [r, r * 0.92];
      }),
      skin.base,
      organic("tail"),
      "body",
    );
    const end = need(points.at(-1)),
      before = need(points.at(-2)),
      along = end.clone().sub(before).normalize();
    if (tail.kind === "club")
      ball(
        "tail club",
        end.clone().addScaledVector(along, base * 0.4),
        [base * 1.9, base * 1.7, base * 2.3],
        skin.accent,
        { surface: skin.surface, motionRole: "rigid" },
        "tail",
      );
    if (tail.kind === "stinger")
      sweep(
        "tail barb",
        [
          end.clone().addScaledVector(along, -base * 0.1),
          end
            .clone()
            .addScaledVector(along, base * 0.9)
            .add(new Vector3(0, -base * 0.2, 0)),
          end
            .clone()
            .addScaledVector(along, base * 1.6)
            .add(new Vector3(0, -base * 1.1, 0)),
        ],
        [
          [base * 0.34, base * 0.34],
          [base * 0.4, base * 0.4],
          [0.002, 0.002],
        ],
        skin.accent,
        { surface: "plain", motionRole: "rigid" },
        "tail",
      );
    if (tail.kind === "fluke" || tail.kind === "fan") {
      const wide = tail.kind === "fluke";
      const blade = base * 3.4;
      if (plan.anatomyRevision === 2) {
        const unit = Math.max(0.005, base * 4);
        cage(
          "tail " + tail.kind,
          end,
          [unit, unit, unit],
          caudalFinCage(along, wide),
          skin.accent,
          { surface: skin.surface, motionRole: "rigid" },
          "tail",
        );
      } else
        sweep(
          "tail " + tail.kind,
          [
            end.clone().addScaledVector(along, -base * 0.5),
            end.clone().addScaledVector(along, base * 1.4),
            end.clone().addScaledVector(along, base * 3),
          ],
          wide
            ? [
                [base * 0.45, base * 0.3],
                [blade, base * 0.16],
                [blade * 0.82, 0.004],
              ]
            : [
                [base * 0.3, base * 0.45],
                [base * 0.16, blade],
                [0.004, blade * 0.82],
              ],
          skin.accent,
          { surface: skin.surface, motionRole: "rigid" },
          "tail",
        );
    }
    if (has("tail tuft") && ["taper", "stub"].includes(tail.kind))
      sweep(
        "tail tuft",
        [
          end.clone().addScaledVector(along, -base * 0.6),
          end.clone().addScaledVector(along, base * 1.6),
          end.clone().addScaledVector(along, base * 4.4),
        ],
        [
          [base * 0.4, base * 0.4],
          [base * 1.25, base * 1.5],
          [0.003, 0.003],
        ],
        skin.accent,
        hard,
        "tail",
      );
  }

  const back = plan.back;
  if (back.kind !== "none" && !growthFamilies.includes(back.kind)) {
    const n = back.kind === "sail" ? Math.max(3, back.count) : back.count;
    const tall = back.height * k;
    if (back.kind === "sail") {
      const pts = [],
        radii = [];
      for (let j = 0; j <= 8; j++) {
        const t = lerp(0.14, 0.86, j / 8),
          f = spine.at(t);
        const rise = tall * Math.sin((j / 8) * Math.PI) ** 0.7;
        pts.push(f.centre.clone().addScaledVector(f.dorsal, f.radius[1] * 0.82 + rise * 0.5));
        radii.push([0.012 * k, Math.max(0.01, rise * 0.56 + f.radius[1] * 0.12)]);
      }
      sweep(
        "dorsal sail",
        pts,
        radii,
        skin.accent,
        { surface: skin.surface, motionRole: "rigid" },
        "body",
      );
    } else
      for (let j = 0; j < n; j++) {
        const t = n === 1 ? 0.5 : lerp(0.14, 0.86, j / (n - 1)),
          f = spine.at(t);
        const rise = tall * (0.55 + 0.45 * Math.sin((j / Math.max(1, n - 1)) * Math.PI));
        const foot = f.centre.clone().addScaledVector(f.dorsal, f.radius[1] * 0.78);
        const lean = f.dorsal.clone().addScaledVector(f.tangent, -0.28).normalize();
        const chord =
          back.kind === "spikes"
            ? 0.018 * k + rise * 0.1
            : back.kind === "plates"
              ? rise * 0.52
              : rise * 0.3;
        sweep(
          "dorsal " + back.kind.replace(/s$/, "") + " " + (j + 1),
          [
            foot,
            foot.clone().addScaledVector(lean, rise * 0.45),
            foot.clone().addScaledVector(lean, rise),
          ],
          back.kind === "spikes"
            ? [
                [chord, chord],
                [chord * 0.62, chord * 0.62],
                [0.002, 0.002],
              ]
            : [
                [0.014 * k, chord],
                [0.011 * k, chord * (back.kind === "plates" ? 1.05 : 0.8)],
                [0.003 * k, chord * (back.kind === "plates" ? 0.34 : 0.12)],
              ],
          j % 2 ? skin.accent : skin.pale,
          { surface: skin.surface, motionRole: "rigid" },
          "body",
        );
      }
  }

  const head = plan.head,
    headFrames = [];
  for (let n = 0; n < head.count; n++) {
    const tag = head.count === 1 ? "" : " " + (n + 1);
    const yaw =
      (head.count === 1 ? 0 : lerp(-1, 1, n / (head.count - 1)) * 30 * rad) +
      (head.turn ?? 0) * rad;
    const pitch = head.neckPitch * rad;
    const dir = new Vector3(
      Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      Math.cos(yaw) * Math.cos(pitch),
    ).normalize();
    const facing = new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const across = new Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const up = new Vector3(0, 1, 0);
    const neckLength = head.neck * k;
    const [fw, fd] = spine.at(0.93).radius;
    const hs = girth * 1.18 * head.size;
    const axes = {
      round: [1, 0.96, 1.08],
      long: [0.84, 0.8, 1.5],
      wide: [1.3, 0.86, 1],
      flat: [1.12, 0.62, 1.3],
    }[head.shape].map((v) => v * hs);
    const neckRoot = spine
      .at(0.94)
      .centre.clone()
      .addScaledVector(
        across,
        head.count === 1 ? 0 : lerp(-1, 1, n / (head.count - 1)) * fw * 0.42,
      );
    const neckEnd = front.centre
      .clone()
      .add(neckRoot)
      .multiplyScalar(0.5)
      .addScaledVector(dir, neckLength + fd * 0.4);
    if (plan.anatomyRevision === 2 && head.count > 1) {
      const turn = (head.turn ?? 0) * rad;
      const spanAxis = new Vector3(Math.cos(turn), 0, -Math.sin(turn));
      const lateral = neckEnd.clone().sub(front.centre).dot(spanAxis);
      const branch = n - (head.count - 1) / 2;
      const projectedWidth =
        need(axes[0]) * Math.abs(Math.cos(yaw - turn)) +
        need(axes[2]) * Math.abs(Math.sin(yaw - turn)) * 0.45;
      const minimum = branch * projectedWidth * 1.16;
      if (Math.abs(lateral) < Math.abs(minimum))
        neckEnd.addScaledVector(spanAxis, minimum - lateral);
    }
    const nr0 = Math.min(fw, fd) * 0.82 * head.neckGirth * (head.count > 1 ? 0.72 : 1),
      nr1 = Math.min(nr0, Math.min(need(axes[0]), need(axes[1])) * 0.42 * head.neckGirth + 0.004);
    const neckId = "neck" + tag;
    sweep(
      neckId,
      [
        neckRoot,
        neckRoot
          .clone()
          .lerp(neckEnd, 0.45)
          .addScaledVector(facing, neckLength * 0.06),
        neckEnd,
      ],
      [
        [nr0, nr0],
        [lerp(nr0, nr1, 0.6), lerp(nr0, nr1, 0.6)],
        [nr1, nr1],
      ],
      skin.base,
      organic("head"),
      "body",
    );
    const centre = neckEnd
      .clone()
      .addScaledVector(facing, need(axes[2]) * 0.16)
      .addScaledVector(up, need(axes[1]) * 0.12);
    const headId = "head" + tag;
    const yawDegrees = yaw / rad || 0;
    const skull = plan.anatomyRevision === 2 ? skullCage(head.shape, head.snout) : null;
    if (skull)
      cage(
        headId,
        centre,
        axes,
        skull,
        skin.base,
        { ...fleshy(), motionRole: "head" },
        neckId,
        yawDegrees,
      );
    else ball(headId, centre, axes, skin.base, organic("head"), neckId, [0, yawDegrees, 0]);
    const rigid = (surface = "plain") => ({ surface, motionRole: "rigid" });
    const onHead = (az: number, el: number, scale = 1) => {
      const radius = skull ? skullSurfaceRadius(skull, az, el) : 0.5;
      return centre
        .clone()
        .addScaledVector(across, Math.sin(az) * Math.cos(el) * need(axes[0]) * radius * scale)
        .addScaledVector(up, Math.sin(el) * need(axes[1]) * radius * scale)
        .addScaledVector(facing, Math.cos(az) * Math.cos(el) * need(axes[2]) * radius * scale);
    };
    const outward = (az: number, el: number) =>
      across
        .clone()
        .multiplyScalar(Math.sin(az) * Math.cos(el))
        .addScaledVector(up, Math.sin(el))
        .addScaledVector(facing, Math.cos(az) * Math.cos(el))
        .normalize();
    headFrames.push({
      headId,
      neckId,
      centre,
      axes,
      across,
      up,
      facing,
      onHead,
      outward,
      neckRoot,
      neckEnd,
      nr0,
      nr1,
      hs,
    });
    const muzzleLength = hs * 0.52 * head.snoutLength;
    const mouthAt = onHead(0, -0.34, 0.9);
    let lipAt = mouthAt.clone().addScaledVector(facing, hs * 0.04),
      lipWidth = need(axes[0]) * 0.5;
    let jawed = false;
    if (head.snout === "muzzle") {
      jawed = true;
      const reach = muzzleLength * 1.05 + need(axes[2]) * 0.24;
      const start = onHead(0, -0.08, 0.5);
      const tip = start
        .clone()
        .addScaledVector(facing, reach)
        .addScaledVector(up, -hs * 0.1);
      const widths = [
          need(axes[0]) * 0.4,
          need(axes[0]) * 0.33,
          need(axes[0]) * 0.26,
          need(axes[0]) * 0.17,
        ],
        depths = [
          need(axes[1]) * 0.34,
          need(axes[1]) * 0.27,
          need(axes[1]) * 0.2,
          need(axes[1]) * 0.12,
        ];
      const along = [0, 0.4, 0.78, 1];
      const upperAt = (t: number) =>
        start
          .clone()
          .lerp(tip, t)
          .addScaledVector(up, hs * 0.05 * Math.sin(Math.PI * t));
      const profile = head.muzzleProfile;
      if (profile) {
        cage(
          "muzzle" + tag,
          start,
          [hs, hs, hs],
          mammalMuzzle(profile, false, need(axes[0]) / hs, need(axes[1]) / hs, reach / hs, -0.1),
          skin.base,
          fleshy(),
          headId,
          yawDegrees,
        );
      } else
        sweep(
          "muzzle" + tag,
          along.map(upperAt),
          along.map((_, j) => [need(widths[j]), need(depths[j])]),
          skin.base,
          organic("rigid"),
          headId,
        );
      const hinge = onHead(0, -0.62, 0.62).addScaledVector(facing, -need(axes[2]) * 0.06);
      const gape = head.jaw * 38 * rad;
      const jawDir = facing
        .clone()
        .multiplyScalar(Math.cos(gape + 0.1))
        .addScaledVector(up, -Math.sin(gape + 0.1));
      const jawLength = tip.clone().sub(hinge).dot(facing) * 0.96;
      const jawAt = (t: number) => hinge.clone().addScaledVector(jawDir, jawLength * t);
      if (profile) {
        cage(
          "jaw" + tag,
          hinge,
          [hs, hs, hs],
          mammalMuzzle(
            profile,
            true,
            need(axes[0]) / hs,
            need(axes[1]) / hs,
            (jawLength * Math.cos(gape + 0.1)) / hs,
            (-jawLength * Math.sin(gape + 0.1)) / hs,
          ),
          mix(skin.base, skin.pale, 0.25 * skin.belly),
          fleshy(),
          headId,
          yawDegrees,
        );
      } else
        sweep(
          "jaw" + tag,
          [0, 0.45, 0.82, 1].map(jawAt),
          [
            [need(axes[0]) * 0.36, need(axes[1]) * 0.2],
            [need(axes[0]) * 0.31, need(axes[1]) * 0.16],
            [need(axes[0]) * 0.23, need(axes[1]) * 0.12],
            [need(axes[0]) * 0.14, need(axes[1]) * 0.07],
          ],
          mix(skin.base, skin.pale, 0.25 * skin.belly),
          fleshy(),
          headId,
        );
      if (head.mouth)
        ball(
          "mouth" + tag,
          upperAt(0.55).lerp(jawAt(0.6), 0.5),
          [
            need(axes[0]) * 0.5,
            Math.max(hs * 0.05, upperAt(0.55).distanceTo(jawAt(0.6)) * 0.9),
            jawLength * 0.86,
          ],
          "#3a1f22",
          rigid(),
          headId,
          [0, yawDegrees, 0],
        );
      if (head.teeth && detail > 0) {
        const count = detail > 1 ? head.teeth : Math.min(2, head.teeth);
        for (const side of [1, -1])
          for (let j = 0; j < count; j++) {
            const t = count === 1 ? 0.86 : lerp(0.9, 0.42, j / (count - 1));
            const fang = j === 0 ? 1.7 : 1;
            const name = (side > 0 ? "left" : "right") + " tooth " + (j + 1) + tag;
            const w = lerp(need(widths[1]), need(widths[3]), (t - 0.4) / 0.6) * 0.8,
              sink = lerp(need(depths[1]), need(depths[3]), (t - 0.4) / 0.6) * 0.5;
            const root = upperAt(t)
              .addScaledVector(across, side * w)
              .addScaledVector(up, -sink);
            const size = hs * 0.085 * fang;
            sweep(
              "upper " + name,
              [
                root,
                root
                  .clone()
                  .addScaledVector(up, -size * 0.6)
                  .addScaledVector(facing, -size * 0.06),
                root
                  .clone()
                  .addScaledVector(up, -size * 1.5)
                  .addScaledVector(facing, -size * 0.22),
              ],
              [
                [size * 0.3, size * 0.3],
                [size * 0.2, size * 0.2],
                [0.0015, 0.0015],
              ],
              skin.pale,
              rigid(),
              headId,
            );
            if (j === 0 && count > 1) continue;
            const low = jawAt(t * 0.96)
              .addScaledVector(across, side * w * 0.86)
              .addScaledVector(up, need(axes[1]) * 0.06);
            sweep(
              "lower " + name,
              [
                low,
                low.clone().addScaledVector(up, size * 0.5),
                low
                  .clone()
                  .addScaledVector(up, size * 1.05)
                  .addScaledVector(facing, -size * 0.1),
              ],
              [
                [size * 0.26, size * 0.26],
                [size * 0.17, size * 0.17],
                [0.0015, 0.0015],
              ],
              skin.pale,
              rigid(),
              "jaw" + tag,
            );
          }
      }
      if (head.nostrils && profile && detail > 0) {
        const noseAt = tip
          .clone()
          .addScaledVector(up, need(depths[3]) * (profile === "rooting" ? 0.1 : 0.54));
        const breadth =
          need(axes[0]) * (profile === "rooting" ? 0.23 : profile === "feline" ? 0.115 : 0.155);
        const colour = mix(skin.base, profile === "rooting" ? "#835c58" : "#212023", 0.73);
        for (const side of [1, -1]) {
          cage(
            (side > 0 ? "left" : "right") + " nostril" + tag,
            noseAt,
            [breadth, breadth, breadth],
            noseWing(profile, side),
            colour,
            { ...rigid(), nasalWing: true },
            headId,
            yawDegrees,
          );
        }
      } else if (head.nostrils && detail > 0)
        for (const side of [1, -1])
          ball(
            (side > 0 ? "left" : "right") + " nostril" + tag,
            upperAt(0.9)
              .addScaledVector(across, side * need(widths[3]) * 0.62)
              .addScaledVector(up, need(depths[3]) * 0.82),
            [hs * 0.06, hs * 0.035, hs * 0.07],
            "#2a1c1c",
            rigid(),
            headId,
            [0, yawDegrees, 0],
          );
      lipAt = jawAt(0.9).addScaledVector(up, need(axes[1]) * 0.1);
      lipWidth = need(axes[0]) * 0.4;
    } else if (head.snout === "beak" || head.snout === "bill") {
      const bill = head.snout === "bill";
      const start = onHead(0, -0.2, 0.7);
      if (plan.anatomyRevision === 2 || head.billProfile) {
        const length = muzzleLength * (bill ? 2.17 : 1.86),
          width = need(axes[0]) * (bill ? 0.46 : 0.32),
          depth = need(axes[1]) * (bill ? 0.19 : 0.35);
        const size = [hs, hs, hs],
          keratin = mix(skin.accent, skin.pale, 0.26);
        cage(
          "beak" + tag,
          start,
          size,
          beakCage(bill, false, width / hs, depth / hs, length / hs, head.jaw, head.billProfile),
          keratin,
          rigid(),
          headId,
          yawDegrees,
        );
        if (head.mouth)
          cage(
            "lower beak" + tag,
            start,
            size,
            beakCage(bill, true, width / hs, depth / hs, length / hs, head.jaw, head.billProfile),
            mix(keratin, "#403a32", 0.38),
            rigid(),
            headId,
            yawDegrees,
          );
      } else
        sweep(
          "beak" + tag,
          [
            start,
            start
              .clone()
              .addScaledVector(facing, muzzleLength * 0.9)
              .addScaledVector(up, -hs * 0.03),
            start
              .clone()
              .addScaledVector(facing, muzzleLength * 1.9)
              .addScaledVector(up, bill ? -hs * 0.04 : -hs * 0.2),
          ],
          bill
            ? [
                [need(axes[0]) * 0.3, need(axes[1]) * 0.2],
                [need(axes[0]) * 0.34, need(axes[1]) * 0.1],
                [need(axes[0]) * 0.3, need(axes[1]) * 0.04],
              ]
            : [
                [need(axes[0]) * 0.27, need(axes[1]) * 0.27],
                [need(axes[0]) * 0.17, need(axes[1]) * 0.19],
                [0.003, 0.004],
              ],
          skin.accent,
          rigid(),
          headId,
        );
    } else if (head.snout === "mandibles") {
      for (const side of [1, -1]) {
        const start =
          plan.anatomyRevision === 2
            ? onHead(side * 0.62, -0.32, 0.88)
            : onHead(side * 0.5, -0.4, 0.86);
        if (plan.anatomyRevision === 2) {
          const length = muzzleLength * 1.65,
            size = [hs, hs, hs];
          cage(
            (side > 0 ? "left" : "right") + " mandible" + tag,
            start,
            size,
            mandibleCage(side, length / hs, 0.2, 0.145, head.jaw),
            mix(skin.base, "#725839", 0.54),
            { ...rigid("horn"), hornSwatch: 2 },
            headId,
            yawDegrees,
          );
          continue;
        }
        sweep(
          (side > 0 ? "left" : "right") + " mandible" + tag,
          [
            start,
            start
              .clone()
              .addScaledVector(facing, muzzleLength * 0.8)
              .addScaledVector(across, side * hs * 0.14),
            start
              .clone()
              .addScaledVector(facing, muzzleLength * 1.5)
              .addScaledVector(across, -side * hs * 0.08),
          ],
          [
            [hs * 0.085, hs * 0.085],
            [hs * 0.062, hs * 0.062],
            [0.002, 0.002],
          ],
          skin.pale,
          rigid(),
          headId,
        );
      }
    } else if (head.snout === "trunk") {
      const start = onHead(0, -0.22, 0.8);
      const points = [start];
      const count = plan.anatomyRevision === 2 ? 9 : 5;
      for (let j = 1; j <= count; j++) {
        const t = j / count;
        if (plan.anatomyRevision === 2) {
          points.push(
            start
              .clone()
              .addScaledVector(facing, muzzleLength * (0.72 * Math.sin(t * Math.PI) + 1.52 * t * t))
              .addScaledVector(
                up,
                -muzzleLength * (2.14 * Math.sin(Math.PI * t * 0.8) - head.jaw * 0.45 * t * t),
              ),
          );
          continue;
        }
        points.push(
          start
            .clone()
            .addScaledVector(facing, muzzleLength * 1.3 * Math.sin(t * 1.5))
            .addScaledVector(up, -muzzleLength * 2.4 * t ** 1.3),
        );
      }
      const radii = points.map((_, j) => {
        const t = j / count;
        const r =
          hs *
          (plan.anatomyRevision === 2 ? lerp(0.28, 0.1, t) + 0.075 * t ** 6 : lerp(0.2, 0.09, t));
        return [r, r];
      });
      if (plan.anatomyRevision === 2) {
        const profile = points.map((point) => {
          const delta = point.clone().sub(start);
          return [delta.dot(facing), delta.y];
        });
        let pitch = 0;
        for (let j = 1; j < profile.length; j++) {
          const [forward = 0, vertical = 0] = need(profile[j]);
          const thickness =
            head.nostrils && j === count
              ? Math.max(need(need(radii[j])[0]), hs * 0.185)
              : need(need(radii[j])[0]);
          const clearance = thickness + 0.012 * plan.scale - start.y;
          if (vertical >= clearance) continue;
          const length = Math.hypot(forward, vertical);
          const needed =
            Math.asin(clamp(clearance / length, -1, 1)) - Math.atan2(vertical, forward);
          pitch = Math.max(pitch, Math.min(needed, Math.PI / 2));
        }
        if (pitch > 0) {
          const c = Math.cos(pitch),
            s = Math.sin(pitch);
          profile.forEach(([forward = 0, down = 0], j) => {
            need(points[j])
              .copy(start)
              .addScaledVector(facing, c * forward - s * down)
              .addScaledVector(up, s * forward + c * down);
          });
        }
      }
      sweep(
        "trunk" + tag,
        points,
        radii,
        skin.base,
        { surface: skin.surface, motionRole: "tail" },
        headId,
      );
      if (plan.anatomyRevision === 2 && head.nostrils) {
        const end = need(points.at(-1)),
          axis = end
            .clone()
            .sub(need(points.at(-2)))
            .normalize();
        const r = Math.max(0.005, hs * 0.185);
        cage(
          "trunk nostrils" + tag,
          end,
          [r, r, r],
          trunkTipCage(across, axis),
          mix(skin.base, "#3f3330", 0.26),
          rigid(skin.surface),
          "trunk" + tag,
        );
      }
    }
    if (head.mouth && !jawed && head.snout === "none")
      ball("mouth" + tag, lipAt, [lipWidth, hs * 0.035, hs * 0.09], "#3a2422", rigid(), headId, [
        0,
        yawDegrees,
        0,
      ]);

    const eyeRadius = hs * 0.15 * head.eyeSize * (head.eyes > 4 ? 0.74 : 1);
    const placements = {
      front: { az: 0.5, el: 0.36 },
      side: { az: 1.25, el: 0.26 },
      top: { az: 0.42, el: 0.98 },
    }[head.eyePlace];
    const eyeSpots = [];
    const pairs = Math.floor(head.eyes / 2);
    if (head.eyes % 2) eyeSpots.push([0, placements.el + (pairs ? 0.42 : 0.05)]);
    for (let p = 0; p < pairs; p++) {
      const az = placements.az * (1 - 0.22 * p) + 0.02 * p,
        el = placements.el + (pairs > 1 ? (p - (pairs - 1) / 2) * 0.44 : 0);
      eyeSpots.push([az, el], [-az, el]);
    }
    eyeSpots.forEach(([az = 0, el = 0], j) => {
      const name =
        (az > 0.01 ? "left " : az < -0.01 ? "right " : "middle ") +
        "eye" +
        (eyeSpots.length > 3 ? " " + (Math.floor(j / 2) + 1) : "") +
        tag;
      const normal = outward(az, el);
      const seat = onHead(az, el, skull ? 1.005 : 0.94);
      let at = seat;
      if (head.stalks > 0.005) {
        at = seat.clone().addScaledVector(normal, head.stalks * hs * 2.2);
        sweep(
          name + " stalk",
          [seat.clone().addScaledVector(normal, -hs * 0.05), seat.clone().lerp(at, 0.55), at],
          [
            [eyeRadius * 0.5, eyeRadius * 0.5],
            [eyeRadius * 0.34, eyeRadius * 0.34],
            [eyeRadius * 0.42, eyeRadius * 0.42],
          ],
          skin.base,
          rigid(skin.surface),
          headId,
        );
      }
      const gaze = normal
        .clone()
        .lerp(facing, head.eyePlace === "side" ? 0.3 : 0.62)
        .normalize();
      const compound = head.snout === "mandibles";
      const eyeColor = compound
        ? skull
          ? mix(skin.eye, "#142427", 0.48)
          : skin.eye
        : skull
          ? mix("#efe9da", skin.base, 0.4)
          : "#efe9da";
      if (skull) {
        const direction = normal
          .clone()
          .lerp(facing, head.eyePlace === "side" ? 0.12 : 0.33)
          .normalize();
        const side = Math.sign(az);
        const radius = Math.max(0.005, eyeRadius * (eyeSpots.length > 2 ? 0.8 : 1));
        const shape = [radius, radius, radius];
        const seatOnSkull =
          head.stalks > 0.005
            ? undefined
            : (point: Vector3) => {
                const offset = at.clone().addScaledVector(point, radius).sub(centre);
                const x = offset.dot(across) / need(axes[0]),
                  y = offset.dot(up) / need(axes[1]),
                  z = offset.dot(facing) / need(axes[2]);
                const base = onHead(Math.atan2(x, z), Math.atan2(y, Math.hypot(x, z)), 0.91);
                return base
                  .sub(at)
                  .multiplyScalar(1e7 / radius)
                  .round()
                  .multiplyScalar(1e-7);
              };
        const orbit = creatureOrbit({ head, gaze: direction, up, side, seatOnSkull });
        cage(
          name,
          at,
          shape,
          orbit.eye,
          compound ? eyeColor : mix(eyeColor, skin.base, 0.22),
          { ...rigid(), eyeSurface: compound ? "compound" : "white" },
          headId,
        );
        if (orbit.iris && orbit.pupil) {
          cage(
            name + " iris",
            at,
            shape,
            orbit.iris,
            mix(skin.eye, "#554534", 0.14),
            { ...rigid(), eyeSurface: "iris" },
            headId,
          );
          cage(
            name + " pupil",
            at,
            shape,
            orbit.pupil,
            "#101412",
            { ...rigid(), eyeSurface: "pupil" },
            headId,
          );
        }
        if (orbit.rim && detail > 0 && (head.lids > 0.04 || (head.brow > 0.05 && j < 2 && side)))
          cage(
            name + " lid",
            at,
            shape,
            orbit.rim,
            mix(skin.base, "#352d29", 0.12),
            fleshy(),
            headId,
          );
        return;
      }
      ball(name, at, [eyeRadius * 2, eyeRadius * 2, eyeRadius * 2], eyeColor, rigid(), headId);
      if (compound)
        ball(
          name + " glint",
          at
            .clone()
            .addScaledVector(gaze, eyeRadius * 0.7)
            .addScaledVector(up, eyeRadius * 0.35),
          [eyeRadius * 0.7, eyeRadius * 0.5, eyeRadius * 0.5],
          skull ? mix(skin.eye, "#e6dccb", 0.34) : shade(skin.eye, 0.55),
          rigid(),
          headId,
        );
      else
        ball(
          name + " iris",
          at.clone().addScaledVector(gaze, eyeRadius * 0.62),
          [eyeRadius * 1.16, eyeRadius * 1.16, eyeRadius * 0.9],
          skin.eye,
          rigid(),
          headId,
          [0, Math.atan2(gaze.x, gaze.z) / rad || 0, 0],
        );
      if (!compound)
        ball(
          name + " pupil",
          at.clone().addScaledVector(gaze, eyeRadius * 0.9),
          [eyeRadius * 0.56, eyeRadius * 0.7, eyeRadius * 0.4],
          "#141a19",
          rigid(),
          headId,
          [0, Math.atan2(gaze.x, gaze.z) / rad || 0, 0],
        );
      if (head.brow > 0.05 && detail > 0 && j < 2 && Math.abs(az) > 0.01) {
        const outer = across.clone().multiplyScalar(Math.sign(az));
        const lift = eyeRadius * (1.02 + 0.3 * head.brow),
          thick = eyeRadius * (0.22 + 0.4 * head.brow);
        sweep(
          name.replace("eye", "brow"),
          [
            at
              .clone()
              .addScaledVector(up, lift * 0.82)
              .addScaledVector(outer, -eyeRadius * 1.0)
              .addScaledVector(gaze, eyeRadius * 0.55),
            at
              .clone()
              .addScaledVector(up, lift * 1.08)
              .addScaledVector(gaze, eyeRadius * 0.62),
            at
              .clone()
              .addScaledVector(up, lift * 0.9)
              .addScaledVector(outer, eyeRadius * 1.05)
              .addScaledVector(gaze, eyeRadius * 0.2),
          ],
          [
            [thick * 0.8, thick * 0.7],
            [thick, thick * 0.8],
            [thick * 0.6, thick * 0.5],
          ],
          shade(skin.base, -0.12),
          fleshy(),
          headId,
        );
      }
      if (head.lids > 0.04 && detail > 0)
        ball(
          name + " lid",
          at
            .clone()
            .addScaledVector(up, eyeRadius * (1.12 - 0.95 * head.lids))
            .addScaledVector(gaze, -eyeRadius * 0.2),
          [eyeRadius * 2.2, eyeRadius * 1.3, eyeRadius * 2.2],
          skin.base,
          fleshy(),
          headId,
        );
    });

    const cs = hs * head.crestSize;
    if (head.crest === "horns" || head.crest === "ears" || head.crest === "antennae")
      for (const side of [1, -1]) {
        const name =
          (side > 0 ? "left " : "right ") +
          head.crest.replace(/s$/, "").replace("antennae", "antenna") +
          tag;
        const az = side * (head.crest === "ears" ? 1.35 : 0.6),
          el = head.crest === "ears" ? 0.62 : 1.0;
        const seat = onHead(az, el, 0.9),
          normal = outward(az, el);
        if ((skull || head.ear) && head.crest === "ears") {
          cage(
            name,
            seat,
            [cs, cs, cs],
            earCage(normal, up, facing, head.shape === "round" || head.shape === "wide", head.ear),
            skin.base,
            { ...rigid(skin.surface), pinna: true },
            headId,
          );
        } else if (skull && head.crest === "horns") {
          const horn = [],
            radii = [];
          const swept = head.eyePlace === "side";
          for (let i = 0; i <= 12; i++) {
            const t = i / 12,
              girth = cs * (0.14 * (1 - t) ** 0.88 + 0.003);
            const point = seat
              .clone()
              .addScaledVector(normal, cs * (0.56 * t - 0.16 * t * t))
              .addScaledVector(up, cs * (0.04 * t + 0.4 * t * t))
              .addScaledVector(
                facing,
                cs * (swept ? -0.37 * t * t : -0.23 * Math.sin(Math.PI * t) + 0.17 * t * t),
              );
            horn.push(point);
            const annulus = 1 + (i % 2 === 0 ? 0.14 : -0.06) * (1 - t);
            radii.push([girth * annulus, girth * annulus * 0.83]);
          }
          sweep(
            name,
            horn,
            radii,
            mix(skin.pale, "#ae8e68", 0.34),
            { ...rigid("horn"), hornSwatch: 2 },
            headId,
          );
        } else if (head.crest === "horns")
          sweep(
            name,
            [
              seat,
              seat
                .clone()
                .addScaledVector(normal, cs * 0.34)
                .addScaledVector(facing, -cs * 0.1),
              seat
                .clone()
                .addScaledVector(normal, cs * 0.62)
                .addScaledVector(facing, cs * 0.08)
                .addScaledVector(up, cs * 0.12),
            ],
            [
              [cs * 0.1, cs * 0.1],
              [cs * 0.066, cs * 0.066],
              [0.002, 0.002],
            ],
            skin.pale,
            rigid(),
            headId,
          );
        else if (head.crest === "ears")
          sweep(
            name,
            [
              seat.clone().addScaledVector(normal, -cs * 0.05),
              seat
                .clone()
                .addScaledVector(normal, cs * 0.26)
                .addScaledVector(up, cs * 0.1),
              seat
                .clone()
                .addScaledVector(normal, cs * 0.5)
                .addScaledVector(up, cs * 0.3),
            ],
            [
              [cs * 0.05, cs * 0.16],
              [cs * 0.035, cs * 0.2],
              [cs * 0.01, cs * 0.03],
            ],
            skin.base,
            rigid(skin.surface),
            headId,
          );
        else {
          const tip = seat
            .clone()
            .addScaledVector(normal, cs * 0.7)
            .addScaledVector(facing, cs * 0.5)
            .addScaledVector(up, cs * 0.2);
          sweep(
            name,
            [
              seat,
              seat
                .clone()
                .addScaledVector(normal, cs * 0.5)
                .addScaledVector(up, cs * 0.2),
              tip,
            ],
            [
              [cs * 0.028, cs * 0.028],
              [cs * 0.02, cs * 0.02],
              [cs * 0.016, cs * 0.016],
            ],
            skin.base,
            { surface: skin.surface, motionRole: "rigid" },
            headId,
          );
          ball(name + " tip", tip, [cs * 0.09, cs * 0.09, cs * 0.09], skin.accent, rigid(), headId);
        }
      }
    if (head.crest === "crown")
      for (let j = 0; j < 5; j++) {
        const az = lerp(-1.1, 1.1, j / 4),
          seat = onHead(az, 1.05, 0.9),
          normal = outward(az, 1.2);
        sweep(
          "crown spine " + (j + 1) + tag,
          [
            seat,
            seat.clone().addScaledVector(normal, cs * 0.26),
            seat.clone().addScaledVector(normal, cs * (0.5 + 0.16 * Math.cos(az * 1.4))),
          ],
          [
            [cs * 0.05, cs * 0.06],
            [cs * 0.032, cs * 0.04],
            [0.002, 0.002],
          ],
          j % 2 ? skin.pale : skin.accent,
          rigid(),
          headId,
        );
      }
    const keratin = mix(skin.pale, "#ae8e68", 0.34),
      horny = { ...rigid("horn"), hornSwatch: 2 };
    const grown = (
      name: string,
      n: number,
      at: (t: number) => Vector3,
      girthAt: (t: number, i: number) => number,
      color = keratin,
      extra: Extra = horny,
      parent = headId,
    ) => {
      const points: Vector3[] = [],
        radii: number[][] = [];
      for (let i = 0; i <= n; i++) {
        const t = i / n,
          g = girthAt(t, i);
        points.push(at(t));
        radii.push([g, g * 0.86]);
      }
      return sweep(name, points, radii, color, extra, parent);
    };
    const boss = (t: number) => 1 + 0.6 * Math.max(0, 1 - t / 0.18) ** 2;
    const ridged = (t: number, i: number) => 1 + (i % 2 === 0 ? 0.12 : -0.05) * (1 - t);
    const leaf = (id: string, rings: Vector3[][], color: string, extra: Extra, parent = headId) => {
      const sides = need(rings[0]).length,
        rows = rings.length,
        points = rings.flat();
      const low = need(points[0]).clone(),
        high = need(points[0]).clone();
      for (const q of points) {
        low.min(q);
        high.max(q);
      }
      const pivot = low.clone().add(high).multiplyScalar(0.5),
        unit = Math.max(0.004, ...high.clone().sub(low).toArray()) / 2;
      const mid = (row: number) =>
        need(rings[row])
          .reduce((a, q) => a.add(q), new Vector3())
          .multiplyScalar(1 / sides);
      const all = [...points, mid(0), mid(rows - 1)],
        faces: number[][] = [];
      const a = points.length,
        b = a + 1;
      for (let i = 0; i < sides; i++) {
        const j = (i + 1) % sides;
        faces.push([a, j, i], [b, (rows - 1) * sides + i, (rows - 1) * sides + j]);
      }
      for (let r = 0; r < rows - 1; r++)
        for (let i = 0; i < sides; i++) {
          const j = (i + 1) % sides;
          faces.push([r * sides + i, r * sides + j, (r + 1) * sides + j, (r + 1) * sides + i]);
        }
      let volume = 0;
      for (const f of faces)
        for (let i = 1; i < f.length - 1; i++)
          volume += need(all[need(f[0])])
            .clone()
            .sub(pivot)
            .dot(
              new Vector3().crossVectors(
                need(all[need(f[i])]).clone().sub(pivot),
                need(all[need(f[i + 1])])
                  .clone()
                  .sub(pivot),
              ),
            );
      if (volume < 0) for (const f of faces) f.reverse();
      const vertices = all.map((v) =>
        v
          .clone()
          .sub(pivot)
          .multiplyScalar(1 / unit)
          .toArray()
          .map((x) => Number(x.toFixed(4))),
      );
      return cage(
        id,
        pivot,
        [unit, unit, unit],
        { vertices, faces, levels: 1 },
        color,
        extra,
        parent,
      );
    };
    const vane = (
      id: string,
      points: Vector3[],
      widths: number[],
      normal: Vector3,
      thick: number,
      color: string,
      extra: Extra,
      parent = headId,
    ) =>
      leaf(
        id,
        points.map((q, i) => {
          const along = need(points[Math.min(points.length - 1, i + 1)])
            .clone()
            .sub(need(points[Math.max(0, i - 1)]))
            .normalize();
          const wide = new Vector3().crossVectors(along, normal).normalize();
          const w = need(widths[i]),
            t = thick * (0.4 + 0.6 * Math.min(1, w / Math.max(...widths)));
          return [
            q.clone().addScaledVector(wide, w),
            q.clone().addScaledVector(normal, t),
            q.clone().addScaledVector(wide, -w),
            q.clone().addScaledVector(normal, -t),
          ];
        }),
        color,
        extra,
        parent,
      );
    if (["ram", "lyre", "antlers", "nubs"].includes(head.crest))
      for (const side of [1, -1]) {
        const sideName = side > 0 ? "left " : "right ",
          out = across.clone().multiplyScalar(side);
        if (head.crest === "ram") {
          const seat = onHead(side * 0.85, 0.8, 0.8);
          grown(
            sideName + "horn" + tag,
            14,
            (t) => {
              const turn = t * 4.7,
                rho = cs * 0.36 * (1 - 0.4 * t);
              return seat
                .clone()
                .addScaledVector(out, cs * (0.05 + 0.36 * t))
                .addScaledVector(facing, -rho * Math.sin(turn))
                .addScaledVector(
                  up,
                  cs * 0.17 * Math.sin(Math.min(turn, 1.57)) - rho * 0.95 * (1 - Math.cos(turn)),
                );
            },
            (t, i) =>
              cs *
              (0.19 * (1 - t) ** 0.8 + 0.004) *
              ridged(t, i) *
              (1 + 0.25 * Math.max(0, 1 - t / 0.18)),
          );
        } else if (head.crest === "lyre") {
          const seat = onHead(side * 0.5, 1.05, 0.8);
          grown(
            sideName + "horn" + tag,
            12,
            (t) =>
              seat
                .clone()
                .addScaledVector(up, cs * 1.2 * t)
                .addScaledVector(out, cs * (0.36 * Math.sin(Math.PI * t) + 0.16 * t ** 4))
                .addScaledVector(facing, cs * (-0.3 * Math.sin(Math.PI * 0.9 * t) + 0.12 * t * t)),
            (t, i) => cs * (0.085 * (1 - t) ** 0.9 + 0.003) * ridged(t, i) * boss(t),
          );
        } else if (head.crest === "antlers") {
          const seat = onHead(side * 0.55, 1.0, 0.8);
          const beam = (t: number) =>
            seat
              .clone()
              .addScaledVector(up, cs * (0.95 * t - 0.1 * t * t))
              .addScaledVector(out, cs * 0.55 * t ** 0.8)
              .addScaledVector(facing, cs * (-0.38 * t + 0.42 * t * t));
          const thick = (t: number) => cs * (0.062 * (1 - t) ** 0.7 + 0.004);
          const id = grown(sideName + "antler" + tag, 8, beam, (t) => thick(t) * boss(t));
          const tines: [number, Vector3, number][] = [
            [
              0.3,
              facing
                .clone()
                .multiplyScalar(0.8)
                .addScaledVector(up, 0.55)
                .addScaledVector(out, 0.1),
              0.4,
            ],
            [
              0.64,
              up
                .clone()
                .multiplyScalar(0.9)
                .addScaledVector(out, -0.15)
                .addScaledVector(facing, 0.25),
              0.42,
            ],
          ];
          tines.forEach(([t, ray, long], j) => {
            ray.normalize();
            const from = beam(t),
              r = thick(t);
            sweep(
              sideName + "antler tine " + (j + 1) + tag,
              [
                from,
                from.clone().addScaledVector(ray, cs * long * 0.55),
                from
                  .clone()
                  .addScaledVector(ray, cs * long)
                  .addScaledVector(up, cs * long * 0.22),
              ],
              [
                [r * 0.9, r * 0.8],
                [r * 0.66, r * 0.6],
                [0.002, 0.002],
              ],
              keratin,
              horny,
              id,
            );
          });
        } else {
          const seat = onHead(side * 0.45, 1.08, 0.8),
            normal = outward(side * 0.4, 1.15);
          const id = grown(
            sideName + "nub" + tag,
            4,
            (t) => seat.clone().addScaledVector(normal, cs * 0.5 * t),
            (t) => cs * need([0.13, 0.075, 0.064, 0.084, 0.05][Math.round(t * 4)]),
            skin.base,
            fleshy(),
          );
          ball(
            sideName + "nub tip" + tag,
            seat.clone().addScaledVector(normal, cs * 0.5),
            [cs * 0.17, cs * 0.13, cs * 0.17],
            shade(skin.accent, -0.2),
            rigid(),
            id,
          );
        }
      }
    if (head.crest === "spire") {
      const seat = onHead(0, 1.0, 0.78),
        ray = up.clone().multiplyScalar(0.85).addScaledVector(facing, 0.5).normalize();
      grown(
        "horn" + tag,
        12,
        (t) =>
          seat
            .clone()
            .addScaledVector(ray, cs * 1.15 * t)
            .addScaledVector(facing, cs * 0.14 * t * t),
        (t, i) => cs * (0.13 * (1 - t) ** 0.9 + 0.003) * ridged(t, i) * boss(t),
      );
    }
    if (head.crest === "fan") {
      const rows = 9,
        ray = (az: number, el: number) =>
          outward(az, el)
            .multiplyScalar(0.55)
            .addScaledVector(up, 0.65)
            .addScaledVector(facing, -0.3)
            .normalize();
      const station = (t: number): [Vector3, Vector3] => {
        const pitch = lerp(0.75, 2.5, t),
          az = pitch <= Math.PI / 2 ? 0 : Math.PI,
          el = Math.min(pitch, Math.PI - pitch);
        return [onHead(az, el, 0.86), ray(az, el)];
      };
      const tall = (t: number) => cs * 0.82 * Math.sin(Math.PI * (0.06 + 0.9 * t)) ** 0.6;
      leaf(
        "crest fan" + tag,
        Array.from({ length: rows }, (_, i) => {
          const t = i / (rows - 1),
            [seat, r] = station(t),
            tip = seat.clone().addScaledVector(r, tall(t) * (i % 2 ? 0.8 : 1)),
            w = hs * 0.05;
          return [
            seat.clone().addScaledVector(across, w),
            tip.clone().addScaledVector(across, w * 0.22),
            tip.clone().addScaledVector(across, -w * 0.22),
            seat.clone().addScaledVector(across, -w),
          ];
        }),
        skin.accent,
        rigid(skin.surface),
      );
      [0.25, 0.5, 0.75].forEach((t, j) => {
        const [seat, r] = station(t),
          h = tall(t) * 1.06;
        sweep(
          "crest ray " + (j + 1) + tag,
          [seat, seat.clone().addScaledVector(r, h * 0.5), seat.clone().addScaledVector(r, h)],
          [
            [hs * 0.045, hs * 0.045],
            [hs * 0.028, hs * 0.028],
            [0.002, 0.002],
          ],
          skin.pale,
          rigid(),
          headId,
        );
      });
    }
    if (head.crest === "plume")
      for (let j = 0; j < 4; j++) {
        const root = onHead((j % 2 ? 0.16 : -0.16) * (j > 1 ? 1.6 : 1), 1.25 - 0.05 * j, 0.86),
          lean = 0.25 + 0.34 * j,
          long = cs * (1.05 - 0.13 * j);
        const points = [],
          widths = [];
        for (let i = 0; i <= 6; i++) {
          const t = i / 6,
            a = lean + 0.75 * t * t;
          points.push(
            root
              .clone()
              .addScaledVector(up, long * t * Math.cos(a))
              .addScaledVector(facing, -long * t * Math.sin(a))
              .addScaledVector(across, (j % 2 ? 1 : -1) * hs * 0.05 * t),
          );
          widths.push(hs * (0.012 + 0.12 * Math.sin(Math.PI * t ** 0.8) ** 0.7));
        }
        vane(
          "plume feather " + (j + 1) + tag,
          points,
          widths,
          across,
          hs * 0.02,
          j % 2 ? skin.pale : skin.accent,
          rigid(),
        );
      }
    const nape = up.clone().addScaledVector(dir, -up.dot(dir));
    if (nape.lengthSq() < 0.02) nape.copy(facing).negate();
    nape.normalize();
    if (has("mane"))
      for (let j = 0; j < 5; j++) {
        const t = j / 4,
          h = hs * (0.5 + 0.3 * Math.sin(Math.PI * (0.25 + 0.6 * t)));
        const seat = neckRoot
          .clone()
          .lerp(neckEnd, 0.1 + 0.95 * t)
          .addScaledVector(nape, lerp(nr0, nr1, t) * 0.7);
        sweep(
          "mane tuft " + (j + 1) + tag,
          [
            seat,
            seat
              .clone()
              .addScaledVector(nape, h * 0.6)
              .addScaledVector(dir, -h * 0.12),
            seat
              .clone()
              .addScaledVector(nape, h)
              .addScaledVector(dir, -h * 0.5),
          ],
          [
            [0.014 * k, h * 0.3],
            [0.011 * k, h * 0.26],
            [0.003 * k, h * 0.05],
          ],
          j % 2 ? skin.accent : shade(skin.accent, -0.25),
          hard,
          neckId,
        );
      }
    if (has("frill"))
      for (let j = 0; j < 5; j++) {
        const a = lerp(-1.25, 1.25, j / 4);
        const ray = up
          .clone()
          .multiplyScalar(Math.cos(a))
          .addScaledVector(across, Math.sin(a))
          .addScaledVector(facing, -0.42)
          .normalize();
        const seat = centre
          .clone()
          .addScaledVector(facing, -need(axes[2]) * 0.3)
          .addScaledVector(ray, need(axes[1]) * 0.3);
        const long = hs * (0.95 - 0.2 * Math.abs(a));
        sweep(
          "frill blade " + (j + 1) + tag,
          [
            seat,
            seat.clone().addScaledVector(ray, long * 0.55),
            seat.clone().addScaledVector(ray, long),
          ],
          [
            [hs * 0.07, hs * 0.14],
            [hs * 0.05, hs * 0.2],
            [0.003, hs * 0.03],
          ],
          j % 2 ? skin.pale : skin.accent,
          hard,
          headId,
        );
      }
    if (has("dewlap"))
      ball(
        "dewlap" + tag,
        neckEnd
          .clone()
          .lerp(neckRoot, 0.3)
          .addScaledVector(nape, -nr1 * 1.15)
          .addScaledVector(facing, hs * 0.12),
        [nr1 * 1.5, hs * 0.62, hs * 0.56],
        skin.accent,
        fleshy(),
        neckId,
      );
    if (has("tusks"))
      for (const side of [1, -1]) {
        const from = onHead(side * 0.62, -0.52, 0.86).addScaledVector(facing, hs * 0.1);
        sweep(
          (side > 0 ? "left" : "right") + " tusk" + tag,
          [
            from,
            from
              .clone()
              .addScaledVector(facing, hs * 0.36)
              .addScaledVector(across, side * hs * 0.16)
              .addScaledVector(up, -hs * 0.06),
            from
              .clone()
              .addScaledVector(facing, hs * (skull && head.stalks > 0.005 ? 0.74 : 0.54))
              .addScaledVector(across, side * hs * (skull && head.stalks > 0.005 ? 0.35 : 0.24))
              .addScaledVector(up, hs * (skull && head.stalks > 0.005 ? 0.22 : 0.42)),
          ],
          [
            [hs * 0.085, hs * 0.085],
            [hs * 0.064, hs * 0.064],
            [0.002, 0.002],
          ],
          skin.pale,
          hard,
          headId,
        );
      }
    if (has("nose horn")) {
      const snouty = ["muzzle", "beak", "bill"].includes(head.snout);
      const seat = onHead(0, 0.26, 0.9)
          .addScaledVector(facing, snouty ? muzzleLength * 0.5 : 0)
          .addScaledVector(up, snouty ? -hs * 0.12 : 0),
        ray = up.clone().multiplyScalar(0.84).addScaledVector(facing, 0.54).normalize();
      grown(
        "nose horn" + tag,
        8,
        (t) =>
          seat
            .clone()
            .addScaledVector(ray, hs * 0.9 * t)
            .addScaledVector(facing, -hs * 0.14 * t * t),
        (t) => hs * (0.16 * (1 - t) ** 0.85 + 0.003) * boss(t),
      );
    }
    if (has("brow horns"))
      for (const side of [1, -1]) {
        const az = side * Math.max(0.55, placements.az * 0.85),
          seat = onHead(az, placements.el + 0.52, 0.84),
          normal = outward(az, placements.el + 0.75);
        grown(
          (side > 0 ? "left" : "right") + " brow horn" + tag,
          6,
          (t) =>
            seat
              .clone()
              .addScaledVector(normal, hs * 0.42 * t)
              .addScaledVector(facing, hs * 0.16 * t * t),
          (t) => hs * (0.07 * (1 - t) ** 0.85 + 0.003) * boss(t),
        );
      }
    if (has("beard")) {
      const seat = onHead(0, -0.95, 0.86).addScaledVector(facing, hs * 0.12);
      sweep(
        "beard" + tag,
        [
          seat,
          seat
            .clone()
            .addScaledVector(up, -hs * 0.3)
            .addScaledVector(facing, hs * 0.06),
          seat
            .clone()
            .addScaledVector(up, -hs * 0.5)
            .addScaledVector(facing, -hs * 0.03),
          seat
            .clone()
            .addScaledVector(up, -hs * 0.68)
            .addScaledVector(facing, -hs * 0.12),
        ],
        [
          [hs * 0.17, hs * 0.13],
          [hs * 0.22, hs * 0.17],
          [hs * 0.15, hs * 0.12],
          [0.004, 0.004],
        ],
        shade(skin.accent, -0.15),
        rigid(),
        jawed ? "jaw" + tag : headId,
      );
    }
    if (has("cheek frills"))
      for (const side of [1, -1]) {
        const out = across.clone().multiplyScalar(side),
          seat = onHead(side * 1.5, -0.12, 0.84),
          flat = facing.clone().multiplyScalar(0.85).addScaledVector(out, 0.35).normalize();
        leaf(
          (side > 0 ? "left" : "right") + " cheek frill" + tag,
          Array.from({ length: 7 }, (_, i) => {
            const a = lerp(-1.05, 1.05, i / 6);
            const ray = out
              .clone()
              .multiplyScalar(0.72)
              .addScaledVector(up, Math.sin(a) * 0.8)
              .addScaledVector(facing, -0.3 - 0.25 * Math.cos(a))
              .normalize();
            const root = seat.clone().addScaledVector(up, Math.sin(a) * hs * 0.2),
              tip = root
                .clone()
                .addScaledVector(ray, hs * (0.62 - 0.14 * Math.abs(a)) * (i % 2 ? 0.74 : 1)),
              w = hs * 0.045;
            return [
              root.clone().addScaledVector(flat, w),
              tip.clone().addScaledVector(flat, w * 0.2),
              tip.clone().addScaledVector(flat, -w * 0.2),
              root.clone().addScaledVector(flat, -w),
            ];
          }),
          skin.accent,
          rigid(skin.surface),
        );
      }
    if (head.whiskers && detail > 0)
      for (const side of [1, -1])
        for (let j = 0; j < 2; j++) {
          const seat = lipAt
            .clone()
            .addScaledVector(across, side * lipWidth * 0.46)
            .addScaledVector(up, hs * (0.05 + 0.04 * j));
          sweep(
            (side > 0 ? "left" : "right") + " whisker " + (j + 1) + tag,
            [
              seat,
              seat
                .clone()
                .addScaledVector(across, side * hs * 0.3)
                .addScaledVector(up, hs * (0.02 + 0.07 * j)),
              seat
                .clone()
                .addScaledVector(across, side * hs * 0.58)
                .addScaledVector(up, hs * (-0.05 + 0.12 * j))
                .addScaledVector(facing, hs * 0.08),
            ],
            [
              [hs * 0.012, hs * 0.012],
              [hs * 0.009, hs * 0.009],
              [0.0016, 0.0016],
            ],
            skin.pale,
            rigid(),
            headId,
          );
        }
  }

  for (const row of socketRows) {
    if (!row.length) continue;
    const plate = coxalShields(row);
    cage(
      (need(row[0]).side > 0 ? "left" : "right") + " thoracic shields",
      plate.centre,
      [plate.unit, plate.unit, plate.unit],
      plate.cage,
      mix(skin.base, skin.accent, 0.2),
      { surface: skin.surface, motionRole: "rigid" },
      "body",
    );
  }
  if (plan.dress) {
    const dressCap = 128 - 12 - (growthFamilies.includes(plan.back.kind) ? 14 : 0);
    dressCreature({
      plan,
      spine,
      anchors,
      heads: headFrames,
      supports: parts.filter(
        (part) => part.shape === "ellipsoid" && /^(pelvis|shoulders|dewlap)| haunch$/.test(part.id),
      ),
      room: () => parts.length < dressCap,
      emit(id, parent, shells, color, surface) {
        const points = shells.flatMap((shell) => shell.vertices);
        const low = need(points[0]).clone(),
          high = need(points[0]).clone();
        for (const p of points) {
          low.min(p);
          high.max(p);
        }
        const pivot = low.clone().add(high).multiplyScalar(0.5),
          unit = Math.max(0.004, ...high.clone().sub(low).toArray()) / 2;
        const vertices = [],
          faces = [];
        for (const shell of shells) {
          const offset = vertices.length;
          vertices.push(
            ...shell.vertices.map((v) =>
              v
                .clone()
                .sub(pivot)
                .multiplyScalar(1 / unit)
                .toArray()
                .map((x) => Number(x.toFixed(4))),
            ),
          );
          faces.push(...shell.faces.map((f) => f.map((i) => i + offset)));
        }
        cage(
          id,
          pivot,
          [unit, unit, unit],
          { vertices, faces, levels: 1 },
          color,
          { surface, motionRole: "rigid" },
          parent,
        );
      },
    });
  }

  const form = bindParts(
    {
      outfit: "Work clothes",
      appearance: {
        palette: "Tide",
        face: 0,
        skin: skin.base,
        hairColor: "#372e2a",
        hair: "Bald",
      },
      parts,
      skinTint: skin.base,
      ...(skin.surface === "scales" ? { skinSurface: "scales" } : {}),
      origin: { generator: 8, kind: "creature plan", plan },
    },
    links,
    { metric: true },
  );
  const joined = form.parts.filter((p) => p.blendSkin);
  if (joined.length > 46) {
    const rank = (p: FormPart) =>
      p.id === "body"
        ? 0
        : /^(neck|head|muzzle)/.test(p.id)
          ? 1
          : /thigh|upper$/.test(p.id)
            ? 2
            : /^(shoulders|pelvis)|haunch$/.test(p.id)
              ? 3
              : /shin|forearm/.test(p.id)
                ? 4
                : p.id === "tail"
                  ? 5
                  : 6;
    const order = joined
      .map((p, i): [number, number, FormPart] => [rank(p), i, p])
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    for (const [, , p] of order.slice(46)) {
      delete p.blendSkin;
    }
  }
  for (const p of form.parts) {
    if (skin.coat && !p.coatZone && (p.shape === "hand" || p.id.endsWith("eye stalk")))
      p.coatZone = p.shape === "hand" ? "end" : "body";
    p.position = p.position.map((v) => Number(v.toFixed(5)));
    if (p.knots) p.knots = p.knots.map((r) => r.map((v) => Number(v.toFixed(5))));
    p.size = p.size.map((v) => Number(v.toFixed(5)));
  }
  return equipCreature(applyBackGrowth(form, plan, spine), plan, spine, unavailableHands);
}

export function randomCreaturePlan(seed = 1, choice: FamilyChoice = {}): Plan {
  const drawn = drawFamily(seed, choice);
  let plan: Plan;
  if (drawn.plan) {
    plan = readCreaturePlan(drawn.plan);
    plan.anatomyRevision = 2;
    plan.limbs = plan.limbs.map((limb) => {
      if (limb.kind !== "wing" || limb.structure !== "plain") return limb;
      const structure = suggestWingStructure(plan, drawn.draw());
      const [least, most] = wingCounts[structure];
      return readLimb({
        ...limb,
        structure,
        ribs: Math.floor(lerp(least, most + 1, drawn.draw())),
        bend: lerp(0.25, 0.8, drawn.draw()),
        notch: lerp(0.15, 0.85, drawn.draw()),
        point: drawn.draw(),
        pattern: need(wingPatterns[need([0, 0, 0, 1, 1, 2, 2, 3][Math.floor(drawn.draw() * 8)])]),
        seed: Math.floor(drawn.draw() * 4294967296),
      });
    });
  } else {
    plan = freeCreaturePlan(seed);
    delete plan.equipment;
    plan.skin = readCreaturePlan(drawn.skin ? { skin: drawn.skin } : {}).skin;
    if (plan.head.count === 1 && drawn.draw() < 0.8)
      plan.head.turn = Math.round(lerp(-28, 28, drawn.draw()));
  }
  plan.family = drawn.family;
  plan.head.size = Math.max(
    plan.head.size,
    Math.min(1.7, (0.2 * plan.spine.length) / plan.spine.girth),
  );
  plan.head.eyeSize = Math.max(plan.head.eyeSize, 1);
  for (const leg of plan.limbs) {
    if (leg.kind !== "leg" || leg.pairs < 2 || leg.fan > 100 || plan.spine.rear > 60) continue;
    const across =
      2 * plan.spine.girth * (leg.style === "pillar" ? 0.62 : leg.style === "insect" ? 0.34 : 0.46);
    const room = () =>
      (Math.abs(leg.to - leg.from) * plan.spine.length) / (leg.pairs - 1) / (2.2 * across);
    leg.girth = clamp(Math.min(leg.girth, room()), Math.min(0.7, leg.girth), 3);
    while (leg.pairs > 2 && room() < leg.girth) leg.pairs--;
  }
  if (plan.skin.socks > 0) plan.skin.limbFade = true;
  if (drawn.plan && randomStream(seed ^ 0x37c665ad)() < 0.76)
    plan.skin = drawCreatureCoat(plan, seed);
  const dress = drawDress(plan, seed, drawn.dressOdds);
  if (dress) plan.dress = dress;
  const flankDraw = randomStream(seed ^ 0xc7e41d29);
  if (!dress && plan.back.kind !== "spiral shell" && flankDraw() < 0.62) {
    const choices: (typeof flankMarkingKinds)[number][] =
      plan.family === "swimmer" || plan.family === "drifter"
        ? ["Lateral stripe", "Flank ocelli"]
        : plan.family === "grazer" || plan.family === "tank"
          ? ["Saddle", "Lateral stripe"]
          : [...flankMarkingKinds];
    plan.skin.flankMarking = need(choices[Math.floor(flankDraw() * choices.length)]);
  }
  const carried = drawCreatureEquipment(plan, seed);
  if (
    carried &&
    drawn.draw() <
      (dress ? 0.35 : drawn.kitOdds) * (growthFamilies.includes(plan.back.kind) ? 0.4 : 1)
  ) {
    plan.equipment = carried;
    if (dress) {
      const busyBack =
        plan.back.kind !== "none" &&
        plan.limbs.some(
          (limb) => limb.kind === "leg" && limb.style === "insect" && limb.pairs >= 3,
        );
      plan.dress = { ...dress, layers: busyBack ? 1 : dress.layers, clear: carried.station };
    }
  }
  return readCreaturePlan(plan);
}

export function freeCreaturePlan(seed = 1): Plan {
  const draw = randomStream(seed),
    between = (a: number, b: number) => a + (b - a) * draw(),
    integer = (a: number, b: number) => Math.floor(between(a, b + 1)),
    choose = <T>(items: readonly T[]): T => need(items[Math.floor(draw() * items.length)]),
    chance = (p: number) => draw() < p;
  const hue = (h: number, s: number, l: number) => {
    const f = (n: number) => {
      const q = (n + h / 30) % 12;
      return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(q - 3, 9 - q, 1));
    };
    return (
      "#" +
      [0, 8, 4]
        .map((n) =>
          Math.round(f(n) * 255)
            .toString(16)
            .padStart(2, "0"),
        )
        .join("")
    );
  };
  const posture = choose([
    "level",
    "level",
    "level",
    "lifted",
    "raised",
    "upright",
    "upright",
    "serpent",
  ]);
  const tone = between(0, 360);
  const spine = {
    length: between(0.6, 1.5),
    girth: between(0.13, 0.27),
    flat: between(0.8, 1.35),
    profile: choose(creatureOptions.profile),
    arch: between(-4, 12),
    stance: between(0.3, 0.9),
    bulge: Array.from({ length: 5 }, () => between(0.82, 1.22)),
    ...{
      level: { rear: between(-4, 6), front: between(0, 16) },
      lifted: { rear: between(8, 20), front: between(30, 50) },
      raised: { rear: between(-2, 8), front: between(70, 88) },
      upright: { rear: between(74, 88), front: between(78, 92) },
      serpent: { rear: 0, front: between(0, 30) },
    }[posture],
  };
  const limbs = [];
  const legEnd = () => choose(creatureOptions.legEnd);
  if (posture === "upright") {
    const radial = chance(0.3);
    spine.length = between(0.5, 0.9);
    limbs.push(
      radial
        ? {
            kind: "leg",
            pairs: integer(3, 5),
            from: 0,
            to: 0.14,
            style: "insect",
            splay: between(30, 48),
            fan: between(120, 180),
            end: choose(["point", "pad"]),
          }
        : {
            kind: "leg",
            pairs: 1,
            from: 0.04,
            style: choose(["mammal", "bird", "pillar"]),
            splay: between(2, 10),
            end: legEnd(),
            girth: between(1, 1.4),
          },
    );
    if (radial) spine.stance = between(0.26, 0.45);
  } else if (posture === "raised") {
    spine.length = between(1, 1.5);
    limbs.push({
      kind: "leg",
      pairs: integer(2, 3),
      from: 0.06,
      to: 0.48,
      style: choose(["insect", "mammal", "bird"]),
      splay: between(8, 44),
      fan: between(0, 50),
      end: legEnd(),
    });
  } else if (posture === "lifted")
    limbs.push({
      kind: "leg",
      pairs: 1,
      from: 0.3,
      style: choose(["bird", "mammal"]),
      splay: between(3, 10),
      end: choose(["talons", "paw", "hoof"]),
      girth: between(1, 1.3),
    });
  else if (posture === "level") {
    const pairs = choose([2, 2, 2, 3, 3, 4]);
    const sprawl = chance(0.4);
    if (sprawl) spine.stance = between(0.2, 0.42);
    limbs.push({
      kind: "leg",
      pairs,
      from: between(0.1, 0.2),
      to: between(0.78, 0.9),
      style: sprawl ? "insect" : choose(["mammal", "bird", "pillar"]),
      splay: sprawl ? between(40, 58) : between(3, 14),
      fan: sprawl ? between(40, 90) : 0,
      end: legEnd(),
    });
  }
  const upper = posture === "level" ? 0.86 : 0.84;
  if (posture !== "serpent" && chance(posture === "level" ? 0.25 : 0.85))
    limbs.push({
      kind: "arm",
      pairs: chance(0.3) ? 2 : 1,
      from: upper - 0.24,
      to: upper,
      length: between(0.35, 0.8) * spine.length,
      drop: between(20, 75),
      forward: between(10, 60),
      elbow: between(20, 110),
      end: choose(["hand", "hand", "pincer", "spike"]),
      digits: integer(2, 4),
      girth: between(0.7, 1.1),
    });
  if (chance(posture === "serpent" ? 0.2 : 0.3))
    limbs.push({
      kind: "wing",
      pairs: 1,
      from: between(0.55, 0.75),
      length: between(0.6, 1.3) * spine.length,
      rise: between(5, 40),
      sweep: between(5, 35),
      chord: between(0.2, 0.45),
    });
  const wingAt = limbs.findIndex((l) => l.kind === "wing");
  if (posture === "serpent" || chance(0.12))
    limbs.push({
      kind: "fin",
      pairs: integer(1, 2),
      from: 0.3,
      to: 0.72,
      length: between(0.2, 0.42),
      sweep: between(20, 55),
      chord: between(0.1, 0.24),
    });
  if (chance(0.12))
    limbs.push({
      kind: "tentacle",
      pairs: integer(1, 2),
      from: 0.6,
      to: 0.85,
      length: between(0.4, 0.8),
      droop: between(20, 70),
      forward: between(0, 50),
    });
  const plan = readCreaturePlan({
    scale: between(0.7, 1.3),
    spine,
    head: {
      count: chance(0.1) ? 2 : 1,
      neck: between(0.05, 0.5),
      neckPitch: posture === "upright" || posture === "raised" ? between(60, 88) : between(10, 62),
      neckGirth: between(0.8, 1.1),
      size: between(0.85, 1.4),
      shape: choose(creatureOptions.headShape),
      snout: choose(creatureOptions.snout),
      snoutLength: between(0.7, 1.6),
      eyes: choose([1, 2, 2, 2, 2, 3, 4, 6]),
      eyeSize: between(0.8, 1.6),
      eyePlace: choose(creatureOptions.eyePlace),
      stalks: chance(0.18) ? between(0.1, 0.3) : 0,
      lids: between(0, 0.6),
      crest: choose(creatureOptions.crest.slice(0, 5)),
      crestSize: between(0.7, 1.5),
      jaw: chance(0.5) ? between(0.1, 0.7) : 0.08,
      teeth: chance(0.5) ? integer(2, 5) : 0,
      brow: between(0, 0.8),
      whiskers: chance(0.2),
    },
    limbs,
    tail: {
      kind:
        posture === "serpent" ? choose(["taper", "fan", "fluke"]) : choose(creatureOptions.tail),
      length: between(0.25, 0.9) * spine.length,
      lift: between(-20, 40),
      girth: between(0.8, 1.2),
    },
    back: { kind: choose(ornaments), count: integer(3, 8), height: between(0.06, 0.22) },
    details: creatureOptions.detail.slice(0, 8).filter(() => chance(0.22)),
    skin: {
      base: hue(tone, between(0.2, 0.42), between(0.32, 0.5)),
      accent: hue((tone + between(120, 200)) % 360, 0.55, 0.58),
      pale: hue((tone + 30) % 360, 0.32, 0.84),
      eye: hue((tone + between(40, 320)) % 360, 0.7, 0.6),
      surface: choose(creatureOptions.surface),
      belly: between(0.2, 0.9),
      socks: chance(0.4) ? between(0.3, 0.9) : 0,
      markings: chance(0.7)
        ? {
            kind: choose(creatureOptions.markings.slice(1)),
            color: hue((tone + choose([0, 24, 180])) % 360, 0.3, choose([0.22, 0.74])),
            spacing: between(0.08, 0.3),
            coverage: between(0.28, 0.6),
            angle: Math.round(between(-40, 40)),
            seed: Math.floor(draw() * 4294967296),
          }
        : null,
    },
  });
  plan.anatomyRevision = 2;
  plan.back = drawBackGrowth(plan, seed);
  placeDrawnAnatomy(plan);
  if (wingAt < 0) return outfitDraw(plan, seed);
  const own = randomStream((seed ^ 0x9e3779b9) >>> 0),
    span = (a: number, b: number) => a + (b - a) * own();
  const structure = suggestWingStructure(plan, own());
  const [least, most] = wingCounts[structure];
  plan.limbs[wingAt] = readLimb({
    ...need(plan.limbs[wingAt]),
    structure,
    ribs: Math.floor(span(least, most + 1)),
    bend: span(0.25, 0.8),
    notch: span(0.15, 0.85),
    point: span(0, 1),
    pattern: need(wingPatterns[need([0, 0, 0, 1, 1, 2, 2, 3][Math.floor(own() * 8)])]),
    seed: Math.floor(own() * 4294967296),
  });
  return outfitDraw(plan, seed);
}

export function drawCreatureDress(plan: Plan, seed: number) {
  return drawDress(readCreaturePlan(plan), seed, 1);
}

export function drawCreatureEquipment(plan: Plan, seed: number) {
  const candidate = drawEquipment(plan, seed);
  if (!candidate) return null;
  const bare = { ...plan };
  delete bare.equipment;
  const base = buildCreature(bare);
  if (base.parts.length + equipmentRegionCount(candidate) > 128) return null;
  return fitDrawnEquipment(plan, candidate, base, spineFrame(plan));
}

function outfitDraw(plan: Plan, seed: number): Plan {
  if (plan.skin.socks > 0) plan.skin.limbFade = true;
  const equipment = drawCreatureEquipment(plan, seed);
  if (equipment) plan.equipment = equipment;
  return plan;
}

export function suggestWingStructure(plan: Plan, draw = 0): keyof typeof wingCounts {
  const head = plan.head ?? {},
    legs = (plan.limbs ?? []).filter((l) => l.kind === "leg");
  const insect =
    head.snout === "mandibles" ||
    head.crest === "antennae" ||
    legs.some((l) => l.style === "insect");
  const bird =
    head.snout === "beak" ||
    head.snout === "bill" ||
    legs.some((l) => l.style === "bird" && l.end === "talons");
  const odds = insect ? [0.12, 0.2] : bird ? [0.18, 0.88] : [0.5, 0.82];
  return draw < need(odds[0]) ? "bat" : draw < need(odds[1]) ? "feather" : "insect";
}
