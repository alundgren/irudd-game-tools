import { flankMarkings } from "./creature-flank-markings.js";
import { faceMarkings } from "./creature-face-coat.js";
import { creatureOrbit } from "./creature-orbit.js";
import {drawCreatureCoat, readCreatureCoat} from "./creature-coat.js";
import { MathUtils, Vector3 } from "three";
import { coxalShields, beakCage, caudalFinCage, chelaCage, earCage, footCage, mandibleCage, pectoralFinCage, nailKnots, mammalMuzzle, noseWing, skullCage, skullSurfaceRadius, trunkTipCage } from "./creature-anatomy.js";
import { mergeDispatchPoses } from "./dispatch-pose.js";
import { drawEquipment, equipCreature, fitDrawnEquipment, equipmentKinds, equipmentRegionCount, readEquipment } from "./creature-equipment.js";
import { placeDrawnAnatomy } from "./creature-proportions.js";
import { dressCreature, dressDevices, dressKinds, dressRegionCount, drawDress, readDress } from "./creature-dress.js";
import { creatureFamilies, drawFamily } from "./creature-families.js";
import { restingWrist } from "./resting-wrist.js";
import { bindParts } from "./rig.js";
import { randomStream } from "./random.js";
import { applyBackGrowth, drawBackGrowth, growthFamilies, refitPlanShingles } from "./creature-growth.js";
import {
  wingArmKnots,
  wingCounts,
  wingPatterns,
  wingStructures,
} from "./wing-surface.js";

const rad = Math.PI / 180;
const { clamp, lerp } = MathUtils;
const num = (v, a, b, fallback) =>
  Number.isFinite(v) ? clamp(v, a, b) : fallback;
const whole = (v, a, b, fallback) => Math.round(num(v, a, b, fallback));
const pick = (v, options, fallback = options[0]) =>
  options.includes(v) ? v : fallback;
const hex = (v, fallback) =>
  typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v)
    ? v.toLowerCase()
    : fallback;
const smooth = (t) => t * t * (3 - 2 * t);
const mix = (a, b, t) => {
  const pa = parseInt(a.slice(1), 16),
    pb = parseInt(b.slice(1), 16);
  const channel = (shift) =>
    Math.round(lerp((pa >> shift) & 255, (pb >> shift) & 255, t)) << shift;
  return (
    "#" +
    ((1 << 24) | channel(16) | channel(8) | channel(0)).toString(16).slice(1)
  );
};
const shade = (color, t) =>
  mix(color, t < 0 ? "#000000" : "#ffffff", Math.abs(t));

const outlines = {
  plain: [[0.16, 1, 1], [0.42, 1.12, 1.12], [0.82, 1, 1]],
  thigh: [[0.04, 1.3, 1.72], [0.26, 1.3, 1.74], [0.56, 0.94, 1.1], [0.82, 0.76, 0.82], [0.95, 1.04, 1.16]],
  shin: [[0.06, 1.04, 1.16], [0.24, 1.14, 1.58], [0.52, 0.72, 0.86], [0.8, 0.56, 0.62], [0.94, 0.88, 0.98]],
  drumstick: [[0.05, 1.3, 1.7], [0.28, 1.46, 1.92], [0.6, 0.86, 0.98], [0.85, 0.56, 0.58], [0.96, 0.84, 0.92]],
  shank: [[0.06, 1.1, 1.1], [0.3, 0.72, 0.76], [0.7, 0.7, 0.72], [0.93, 1.04, 1.04]],
  upper: [[0.06, 1.5, 1.42], [0.32, 1.3, 1.46], [0.66, 0.84, 0.92], [0.85, 0.78, 0.82], [0.96, 1.06, 1.14]],
  forearm: [[0.06, 1.04, 1.08], [0.25, 1.42, 1.28], [0.58, 0.86, 0.8], [0.84, 0.64, 0.56], [0.95, 0.9, 0.74]],
  femur: [[0.05, 0.72, 0.72], [0.15, 1.12, 1.12], [0.4, 1.9, 1.9], [0.7, 1.16, 1.16], [0.88, 0.68, 0.68], [0.96, 1.16, 1.16]],
  tibia: [[0.05, 1.16, 1.16], [0.17, 1.3, 1.3], [0.48, 0.76, 0.8], [0.84, 0.54, 0.56], [0.95, 0.84, 0.84]],
  column: [[0.08, 1.16, 1.24], [0.4, 0.98, 0.98], [0.62, 0.88, 0.88], [0.8, 1.12, 1.14], [0.92, 1, 1]],
};

const ornaments = ["none", "fins", "spikes", "plates", "sail"];

export const creatureOptions = {
  faceMarking: faceMarkings,
  flankMarking: flankMarkings,
  profile: ["barrel", "pear", "wedge", "tube", "wasp"],
  limbKind: ["leg", "arm", "wing", "fin", "tentacle"],
  side: ["both", "left", "right"],
  legStyle: ["mammal", "bird", "insect", "pillar"],
  legEnd: ["paw", "hoof", "talons", "point", "pad", "paddle"],
  armEnd: ["hand", "pincer", "spike", "none"],
  wingStructure: wingStructures,
  wingPattern: wingPatterns,
  headShape: ["round", "long", "wide", "flat"],
  snout: ["muzzle", "beak", "mandibles", "trunk", "bill", "none"],
  eyePlace: ["front", "side", "top"],
  billProfile: ["original", "spear", "spoon", "crusher", "shear", "scythe"],
  muzzleProfile: ["original", "feline", "canine", "grazing", "rooting"],
  ear: ["original", "lance", "swept", "tufted", "fan", "lop"],
  crest: ["none", "horns", "ears", "antennae", "crown", "antlers", "ram", "lyre", "spire", "nubs", "fan", "plume"],
  tail: ["none", "stub", "taper", "club", "fluke", "fan", "stinger"],
  back: [...ornaments, ...growthFamilies],
  equipment: equipmentKinds,
  dress: dressKinds,
  dressDevice: dressDevices,
  surface: ["scales", "plain"],
  detail: [
    "mane",
    "frill",
    "dewlap",
    "tusks",
    "spurs",
    "shoulder spikes",
    "belly plates",
    "tail tuft",
    "nose horn",
    "brow horns",
    "beard",
    "cheek frills",
  ],
  markings: ["none", "Bands", "Spots", "Rosettes", "Countershade", "Reticulated", "Marbled"],
};

function readLimb(raw = {}) {
  const kind = pick(raw.kind, creatureOptions.limbKind);
  const from = num(raw.from, 0, 1, kind === "leg" ? 0.15 : 0.8);
  const limb = {
    kind,
    pairs: whole(raw.pairs, 1, 6, 1),
    side: pick(raw.side, creatureOptions.side),
    from,
    to: num(raw.to, 0, 1, from),
    girth: num(raw.girth, 0.3, 3, 1),
    muscle: num(raw.muscle, 0, 1.6, 0.8),
  };
  if (kind === "leg")
    return {
      ...limb,
      style: pick(raw.style, creatureOptions.legStyle),
      ...(raw.sockets === true && raw.style === "insect" ? { sockets: true } : {}),
      splay: num(raw.splay, 0, 78, 10),
      fan: num(raw.fan, 0, 240, 0),
      end: pick(raw.end, creatureOptions.legEnd),
      digits: whole(raw.digits, 0, 5, 3),
    };
  if (kind === "arm")
    return {
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
      ...limb,
      length: num(raw.length, 0.1, 4, 0.9),
      rise: num(raw.rise, -30, 85, 22),
      sweep: num(raw.sweep, -40, 70, 18),
      chord: num(raw.chord, 0.03, 1.5, 0.3),
      structure: pick(raw.structure, wingStructures),
    };
    if (wing.structure === "plain") return wing;
    const [least, most] = wingCounts[wing.structure];
    return {
      ...wing,
      ribs: whole(raw.ribs, least, most, { bat: 4, feather: 9, insect: 5 }[wing.structure]),
      bend: num(raw.bend, 0, 1, 0.5),
      notch: num(raw.notch, 0, 1, 0.4),
      point: num(raw.point, 0, 1, 0.5),
      pattern: pick(raw.pattern, wingPatterns),
      seed: Number.isInteger(raw.seed) ? clamp(raw.seed, 0, 4294967295) : 1,
    };
  }
  if (kind === "fin")
    return {
      ...limb,
      length: num(raw.length, 0.05, 2, 0.3),
      sweep: num(raw.sweep, -40, 80, 35),
      chord: num(raw.chord, 0.03, 1, 0.16),
    };
  return {
    ...limb,
    length: num(raw.length, 0.1, 3, 0.6),
    droop: num(raw.droop, -60, 90, 40),
    forward: num(raw.forward, -80, 90, 20),
    fan: num(raw.fan, 0, 240, 0),
    curl: num(raw.curl, -1, 1, 0.3),
  };
}

export function readCreaturePlan(raw = {}) {
  const s = raw.spine ?? {},
    h = raw.head ?? {},
    t = raw.tail ?? {},
    b = raw.back ?? {},
    k = raw.skin ?? {};
  const base = hex(k.base, "#5f7a58");
  const marks = k.markings, styledCoat = readCreatureCoat(k.coat);
  return {
    ...(raw.anatomyRevision === 2 ? { anatomyRevision: 2 } : {}),
    ...(typeof raw.family === "string" && creatureFamilies.includes(raw.family) ? { family: raw.family } : {}),
    ...(raw.equipment ? {equipment: readEquipment(raw.equipment)} : {}),
    ...(raw.dress && dressKinds.includes(raw.dress.kind) && raw.dress.kind !== "none" ? { dress: readDress(raw.dress) } : {}),
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
      bulge: Array.from({ length: 5 }, (_, i) =>
        num(s.bulge?.[i], 0.4, 2.2, 1),
      ),
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
      ...(creatureOptions.billProfile.includes(h.billProfile) && h.billProfile !== "original"
        ? { billProfile: h.billProfile } : {}),
      ...(creatureOptions.muzzleProfile.includes(h.muzzleProfile) && h.muzzleProfile !== "original"
        ? { muzzleProfile: h.muzzleProfile } : {}),
      mouth: h.mouth !== false,
      eyes: whole(h.eyes, 0, 8, 2),
      eyeSize: num(h.eyeSize, 0.4, 3, 1),
      eyePlace: pick(h.eyePlace, creatureOptions.eyePlace),
      stalks: num(h.stalks, 0, 0.6, 0),
      lids: num(h.lids, 0, 1, 0.15),
      crest: pick(h.crest, creatureOptions.crest),
      crestSize: num(h.crestSize, 0.3, 3, 1),
      ...(creatureOptions.ear.includes(h.ear) && h.ear !== "original" ? { ear: h.ear } : {}),
      jaw: num(h.jaw, 0, 1, 0.12),
      teeth: whole(h.teeth, 0, 6, 0),
      brow: num(h.brow, 0, 1, 0.35),
      nostrils: h.nostrils !== false,
      whiskers: h.whiskers === true,
      ...(num(h.turn, -50, 50, 0) ? { turn: num(h.turn, -50, 50, 0) } : {}),
    },
    limbs: (Array.isArray(raw.limbs)
      ? raw.limbs
      : [
          { kind: "leg", pairs: 2, from: 0.14, to: 0.86 },
        ]
    )
      .slice(0, 8)
      .map(readLimb),
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
      ...(growthFamilies.includes(b.kind) ? {
        spread: num(b.spread, 0, 1, 0.72),
        seed: whole(b.seed, 0, 4294967295, 1),
      } : {}),
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
      ...(faceMarkings.includes(k.faceMarking) && k.faceMarking !== "None" ? { faceMarking: k.faceMarking } : {}),
      ...(flankMarkings.includes(k.flankMarking) && k.flankMarking !== "None" ? { flankMarking: k.flankMarking } : {}),
      ...(k.limbFade === true ? {limbFade:true} : {}),
      ...(styledCoat ? {coat:styledCoat} : {}),
      markings:
        marks && creatureOptions.markings.slice(1).includes(marks.kind)
          ? {
              kind: marks.kind,
              color: hex(marks.color, "#e4d9bd"),
              spacing: num(marks.spacing, 0.06, 0.8, 0.2),
              coverage: num(marks.coverage, 0.1, 0.9, 0.45),
              angle: num(marks.angle, -180, 180, 0),
              seed: Number.isInteger(marks.seed)
                ? clamp(marks.seed, 0, 4294967295)
                : 1,
            }
          : null,
    },
  };
}

const girthProfiles = {
  barrel: (t) => 0.5 + 0.5 * Math.sin(Math.PI * t) ** 0.7,
  pear: (t) => 0.42 + 0.58 * Math.sin(Math.PI * t ** 0.62) ** 0.9,
  wedge: (t) => 0.42 + 0.58 * Math.sin(Math.PI * t ** 1.7) ** 0.9,
  tube: () => 0.9,
  wasp: (t) =>
    0.34 +
    0.66 *
      Math.max(
        Math.exp(-(((t - 0.22) / 0.19) ** 2)),
        0.82 * Math.exp(-(((t - 0.76) / 0.16) ** 2)),
      ),
};
const endCap = (t) =>
  Math.sqrt(Math.max(0.06, 1 - (1 - Math.min(1, Math.min(t, 1 - t) / 0.13)) ** 2));

export function spineFrame(plan) {
  const s = plan.spine,
    k = plan.scale,
    steps = 64,
    points = [],
    pitches = [];
  let y = 0,
    z = 0;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const pitch =
      (s.rear + (s.front - s.rear) * smooth(t) + s.arch * Math.cos(Math.PI * t)) *
      rad;
    points.push(new Vector3(0, y, z));
    pitches.push(pitch);
    y += (Math.sin(pitch) * s.length * k) / steps;
    z += (Math.cos(pitch) * s.length * k) / steps;
  }
  const radius = (t) => {
    const u = clamp(t, 0, 1) * 4,
      i = Math.min(3, Math.floor(u));
    const g =
      girthProfiles[s.profile](t) *
      endCap(t) *
      s.girth *
      k *
      lerp(s.bulge[i], s.bulge[i + 1], smooth(u - i));
    return [g * Math.sqrt(s.flat), g / Math.sqrt(s.flat)];
  };
  const hasLegs = plan.limbs.some((l) => l.kind === "leg");
  let lowest = Infinity;
  for (let i = 0; i <= steps; i++)
    lowest = Math.min(lowest, points[i].y - radius(i / steps)[1] * Math.cos(pitches[i]));
  const floats =
    !hasLegs &&
    plan.limbs.some((l) => ["fin", "wing", "tentacle"].includes(l.kind));
  const lift =
    hasLegs || floats
      ? Math.max(s.stance * k, 0.02 - lowest)
      : 0.004 - lowest;
  const middle = points[steps].z * 0.5;
  for (const p of points) {
    p.y += lift;
    p.z -= middle;
  }
  function at(t) {
    const u = clamp(t, 0, 1) * steps,
      i = Math.min(steps - 1, Math.floor(u)),
      f = u - i;
    const pitch = lerp(pitches[i], pitches[i + 1], f);
    return {
      centre: points[i].clone().lerp(points[i + 1], f),
      tangent: new Vector3(0, Math.sin(pitch), Math.cos(pitch)),
      dorsal: new Vector3(0, Math.cos(pitch), -Math.sin(pitch)),
      pitch,
      radius: radius(clamp(t, 0, 1)),
    };
  }
  return { at, radius };
}

export function buildCreature(raw = {}) {
  return constructCreature(raw);
}
function constructCreature(raw = {}, unavailableHands) {
  const plan = readCreaturePlan(raw);
  const k = plan.scale,
    skin = plan.skin,
    spine = spineFrame(plan);
  const parts = [],
    links = {};
  const lean = clamp((plan.spine.rear + plan.spine.front) / 2, 0, 90);
  const coat = (zone) => {
    const marked = {...(skin.markings ? {markings:skin.markings} : {}), ...(skin.coat ? {coatZone:zone} : {})};
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
  const organic = (role, zone = "body") => ({
    surface: skin.surface,
    motionRole: role,
    ...(skin.blend ? { blendSkin: true } : {}),
    ...coat(zone),
  });
  const fleshy = (zone = "body") => ({
    surface: skin.surface,
    motionRole: "rigid",
    ...coat(zone),
  });
  function add(part, parent) {
    if (parts.some((p) => p.id === part.id))
      throw new Error("Duplicate creature part " + part.id + ".");
    parts.push(part);
    if (parent) links[part.id] = parent;
    return part.id;
  }
  function sweep(id, points, radii, color, extra, parent, pivot = points[0]) {
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
          Math.max(0.0012, radii[i][0]),
          Math.max(0.0012, radii[i][1]),
        ]),
        ...extra,
      },
      parent,
    );
  }
  function cage(id, centre, size, geometry, color, extra, parent, yaw = 0) {
    return add({ id, shape: "cage", cage: geometry, position: centre.toArray(),
      size, rotation: [0,yaw,0], color, ...extra }, parent);
  }
  function ball(id, centre, size, color, extra, parent, rotation = [0, 0, 0]) {
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
  function segment(id, a, b, ra, rb, color, extra, parent, outline = "plain", muscle = 1) {
    const axis = b.clone().sub(a),
      length = axis.length();
    axis.normalize();
    const swell = (v) => 1 + (v - 1) * muscle;
    const rooted = ["thigh", "drumstick", "upper", "column"].includes(outline)
      ? 0.74 + 0.3 * Math.min(1, muscle)
      : 0.74;
    const stations = [
      [-0.3 * ra, rooted * ra, rooted * ra * (rooted > 0.74 ? 1.18 : 1)],
      ...outlines[outline].map(([t, w, d]) => {
        const r = lerp(ra, rb, t);
        return [t * length, r * swell(w), r * swell(d)];
      }),
      [length + 0.3 * rb, 0.74 * rb, 0.74 * rb],
    ];
    return sweep(
      id,
      stations.map(([d]) => a.clone().addScaledVector(axis, d)),
      stations.map(([, w, d]) => [w, d]),
      color,
      extra,
      parent,
      a,
    );
  }
  function cuticle(id, a, b, rootRadius, tipRadius, role, parent, row) {
    const axis = b.clone().sub(a), length = axis.length();
    axis.normalize();
    const bow = new Vector3(0, .45, row < .5 ? -.75 : .75);
    bow.addScaledVector(axis,-bow.dot(axis)).normalize();
    const femur = role === "thigh";
    const section = femur ? [
      [-.035,.73,.83,0], [.035,1.15,1.32,0], [.15,.58,.66,.013],
      [.26,.98,1.42,.035], [.47,1.3,1.72,.060], [.72,.84,1.12,.052],
      [.85,.58,.64,.03], [.94,1.3,1.28,.006], [1.012,.76,.80,0],
    ] : [
      [-.025,.88,.87,0], [.045,1.22,1.27,.01], [.13,.90,.94,.025],
      [.26,.88,1.4,.04], [.54,.6,.84,.05], [.77,.48,.58,.039],
      [.90,.84,.94,.019], [.955,.62,.7,.007], [1.025,.68,.72,0],
    ];
    const points = [], radii = [];
    for (const [t,x,y,curve] of section) {
      points.push(a.clone().addScaledVector(axis,t*length).addScaledVector(bow,curve*length));
      const r = lerp(rootRadius,tipRadius,clamp(t,0,1));
      radii.push([x*r,y*r]);
    }
    sweep(id,points,radii,femur ? skin.base : mix(skin.base,skin.accent,.12),
      { ...organic(role, femur ? "body" : "end"), blendSkin:false },parent,a);
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
  const trunkDepth = (p, side) => {
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
  const sidesOf = (limb) =>
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
      detail > 0
        ? plan.details.filter((d) => d === "spurs" || d === "shoulder spikes").length
        : 0;
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
    if (detail && plan.limbs.some(limb => limb.sockets)) count += 2;
    return count;
  };
  while (detail > 0 && budget() > 126) detail--;
  if (budget() > 128)
    throw new Error("This body plan needs more than 128 parts. Remove a limb group.");
  const counters = {};
  const hard = { surface: "plain", motionRole: "rigid" };
  let yokes = 0,
    pelvises = 0;
  const anchors = [];
  const socketRows = [[], []];
  const label = (side, kind) => {
    const name = (side > 0 ? "left " : "right ") + kind;
    counters[name] = (counters[name] ?? 0) + 1;
    return name + " " + counters[name];
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
          let knee, hock;
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
          const [upperForm, lowerForm] = {
            mammal: ["thigh", "shin"],
            bird: ["drumstick", "shin"],
            insect: ["femur", "tibia"],
            pillar: ["column", "column"],
          }[limb.style];
          if (i === 0 && side === sidesOf(limb)[0] && Math.sin(frame.pitch) > 0.72 && limb.style !== "insect") {
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
              root.clone().add(new Vector3(side * w * 0.07, (rise - r0 * 0.4) / 2, kneeSign * r0 * 0.1)),
              [
                2 * r0 * (0.74 + 0.26 * limb.muscle),
                rise + r0 * 0.4,
                2 * r0 * (1.2 + 0.45 * limb.muscle),
              ],
              skin.base,
              organic("rigid"),
              "body",
              [(-frame.pitch / rad) || 0, 0, 0],
            );
          }
          if (limb.sockets && detail) {
            socketRows[side > 0 ? 0 : 1].push({root, knee, station, side, r0, frame});
          }
          if (limb.style === "insect" && plan.anatomyRevision === 2) {
            cuticle(id+" thigh",root,knee,r0,r1,"thigh","body",station);
            cuticle(id+" shin",knee,ankle,r1,r2,"shin",id+" thigh",station);
          } else {
            segment(id + " thigh", root, knee, r0, r1, skin.base, organic("thigh"), "body", upperForm, limb.muscle);
            segment(id + " shin", knee, hock ?? ankle, r1, r2, skin.base, organic("shin", "end"), id + " thigh", lowerForm, limb.muscle);
          }
          anchors.push({ id, kind: "leg", station, upper: id + " thigh", lower: id + " shin", root, mid: knee, end: hock ?? ankle, r0, r1, r2, side });
          const sole = new Vector3(ankle.x, 0, ankle.z);
          const toeDir = new Vector3(reachDir.x * 0.35, 0, 1).normalize();
          const footRole = { surface: skin.surface, motionRole: "foot", ...coat("end") };
          let foot = id + " foot",
            carrier = id + " shin",
            endRole = footRole;
          if (hock) {
            segment(foot, hock, ankle, r2 * 0.92, r2 * 0.86, skin.base, footRole, carrier, "shank", limb.muscle);
            carrier = foot;
            foot = id + " toes";
            endRole = { ...footRole, motionRole: "rigid" };
          }
          if (plan.anatomyRevision === 2) {
            const r = Math.max(.005, r2);
            const footColor = limb.end === "hoof" ? mix(skin.base, "#292522", .90)
              : limb.end === "paddle" ? skin.accent : shade(skin.base, -.18);
            const geometry = footCage(limb.end, limb.style, limb.digits, ankle.y / r);
            if (limb.end === "point" && limb.style === "mammal") {
              const towardShin=knee.clone().sub(ankle).normalize();
              const right=new Vector3(toeDir.z,0,-toeDir.x);
              for (const v of geometry.vertices) {
                const weight=MathUtils.smoothstep(v[1],-.50,.85);
                v[0]+=weight*1.45*towardShin.dot(right);
                v[1]+=weight*.55*towardShin.y;
                v[2]+=weight*(.68+1.45*towardShin.dot(toeDir));
              }
            }
            const verticalUnit = Math.max(r, ankle.y / 9);
            if (verticalUnit !== r)
              for (const vertex of geometry.vertices) vertex[1] *= r / verticalUnit;
            cage(foot, ankle, [r, verticalUnit, r], geometry, footColor,
              { ...endRole, ...(limb.end === "hoof" || limb.end === "point" ? {surface:"plain"} : {}) },
              carrier, Math.atan2(toeDir.x, toeDir.z) / rad);
            if (detail > 1 && ["paw", "talons"].includes(limb.end)) {
              const right = new Vector3(toeDir.z, 0, -toeDir.x);
              for (let digit = 0; digit < limb.digits; digit++) {
                const points = nailKnots(limb.end, limb.digits, digit).map(([x, y, z]) =>
                  sole.clone().addScaledVector(right, r*x).addScaledVector(toeDir, r*z).setY(r*y));
                sweep(id + " claw " + (digit + 1), points,
                  [[.27*r,.26*r], [.25*r,.25*r], [.17*r,.18*r], [.0013,.0013]],
                  mix(skin.pale,"#706353",.28), hard, foot);
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
                ankle.clone().lerp(sole, 0.5).addScaledVector(toeDir, r2 * 0.3),
                sole.clone().addScaledVector(toeDir, r2 * 0.3).setY(0.004),
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
                sole.clone().addScaledVector(toeDir, r2 * 1.2).setY(r2 * 0.56),
                sole.clone().addScaledVector(toeDir, r2 * 4.2).setY(r2 * 0.26),
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
                const spread =
                  limb.digits === 1 ? 0 : (c / (limb.digits - 1) - 0.5) * 1.3;
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
            wristScale = (g * 0.25) / 0.03 * 1.2,
            handScale = plan.anatomyRevision === 2
              ? Math.min(wristScale, lower * 1.06 / 0.182)
              : wristScale,
            handReach = limb.end === "hand" ? 0.182 * handScale * limb.hand
              : limb.end === "pincer" ? 0.182 * wristScale * limb.hand : g * 1.7;
          let upperDir, lowerDir, hinge, elbow, wrist;
          const gesture = limb.raise ?? 0,
            lifted = side > 0 === gesture > 0 ? Math.abs(gesture) : -0.35 * Math.abs(gesture),
            bend = (limb.elbow + Math.max(0, lifted) * 0.55) * rad;
          for (let drop = (limb.drop - lifted) * rad, tries = 0; tries < 40; tries++, drop -= 3 * rad) {
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
            lowerDir = upperDir.clone().applyAxisAngle(hinge, Math.min(150 * rad, bend)).normalize();
            elbow = root.clone().addScaledVector(upperDir, upper);
            wrist = elbow.clone().addScaledVector(lowerDir, lower);
            const lowest =
              Math.min(elbow.y, wrist.y, wrist.y + lowerDir.y * handReach) - g * 0.45;
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
              [(-frame.pitch / rad) || 0, 0, 0],
            );
          }
          segment(id + " upper", root, elbow, r0, r1, skin.base, organic("upper arm"), "body", "upper", limb.muscle);
          segment(id + " forearm", elbow, wrist, r1, r2, skin.base, organic("forearm", "end"), id + " upper", "forearm", limb.muscle);
          anchors.push({ id, kind: "arm", station, upper: id + " upper", lower: id + " forearm", root, mid: elbow, end: wrist, r0, r1, r2, side });
          if (limb.end === "pincer" && plan.anatomyRevision === 2) {
            const size = r2 * 3 * limb.hand;
            const scale = [size, size, size];
            const opening = hinge.clone().multiplyScalar(side);
            cage(id + " hand", wrist, scale, chelaCage("palm", lowerDir, opening),
              mix(skin.base, skin.accent, .63), {surface: skin.surface, motionRole: "hand"}, id + " forearm");
            for (const finger of ["lower", "upper"]) {
              cage(id + " pincer " + finger, wrist, scale, chelaCage(finger, lowerDir, opening),
                mix(skin.accent, "#583b2c", finger === "upper" ? .28 : .48),
                {...hard, hornSwatch: 2}, id + " hand");
            }
          } else if (limb.end === "pincer") {
            const size = r2 * 3 * limb.hand;
            const palmEnd = wrist.clone().addScaledVector(lowerDir, size * 0.9);
            sweep(
              id + " hand",
              [wrist.clone().addScaledVector(lowerDir, -0.4 * r2), wrist.clone().addScaledVector(lowerDir, size * 0.42), palmEnd],
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
              const from = palmEnd.clone().addScaledVector(hinge, jaw * size * 0.16).addScaledVector(lowerDir, -size * 0.2);
              sweep(
                id + " pincer " + (jaw > 0 ? "upper" : "lower"),
                [
                  from,
                  from.clone().addScaledVector(lowerDir, size * 0.62).addScaledVector(hinge, jaw * size * 0.3),
                  from.clone().addScaledVector(lowerDir, size * 1.3).addScaledVector(hinge, jaw * size * 0.03),
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
            const pad = ["beak","bill","mandibles"].includes(plan.head.snout) ? "talon" : "paw";
            const size = [0.082, 0.182, 0.04].map(v => v * handScale * limb.hand);
            add(
              {
                id: id + " hand",
                shape: "hand",
                position: wrist.clone().addScaledVector(lowerDir, -0.5 * r2).toArray(),
                size,
                frameSize: [...size],
                rotation: restingWrist(lowerDir, new Vector3(-side, 0, -0.25)),
                color: native ? mix(skin.base,skin.accent,.12) : mix(skin.base,skin.pale,.3),
                surface: "plain",
                motionRole: "hand",
                grip: {
                  side: -side,
                  fingers: limb.digits,
                  curl: .22,
                  spread: .3,
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
              [wrist.clone().addScaledVector(lowerDir, -0.4 * r2), wrist.clone().addScaledVector(lowerDir, r2 * 2.6), wrist.clone().addScaledVector(lowerDir, r2 * 6.5).addScaledVector(hinge, 0)],
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
            const film = { bat: skin.accent, feather: skin.accent, insect: mix(skin.accent, skin.pale, 0.55) }[limb.structure];
            const wing = {
              structure: limb.structure,
              side,
              span: dir.clone().multiplyScalar(span).toArray(),
              back: rearward.multiplyScalar(chord * 1.15).toArray(),
              bone,
              bend: limb.bend,
              count: limb.ribs,
              notch: limb.notch,
              point: limb.point,
              pattern: limb.pattern,
              seed: (limb.seed + i * 7919) >>> 0,
              dark: shade(limb.structure === "feather" ? mix(skin.accent, skin.base, 0.3) : skin.accent, -0.62),
              pale: skin.pale,
              limb: limb.structure === "insect" ? shade(skin.base, -0.35) : skin.base,
            };
            for (const key of ["span", "back"])
              wing[key] = wing[key].map((v) => Number(v.toFixed(5)));
            wing.bone = Number(wing.bone.toFixed(5));
            const knots = wingArmKnots(wing);
            sweep(
              id,
              knots.map(([x, y, z]) => root.clone().add(new Vector3(x, y, z))),
              knots.map(([, , , r]) => [r, r]),
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
            cage(id, root, [unit, unit, unit], pectoralFinCage(side, back, span, chord, g),
              skin.accent, { surface: skin.surface, motionRole: "fin" }, "body");
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
            yaw =
              limb.forward * rad +
              (limb.pairs === 1 ? 0 : lerp(0.5, -0.5, u)) * limb.fan * rad,
            span = limb.length * k;
          const upright = Math.abs(Math.sin(frame.pitch));
          const root = frame.centre
            .clone()
            .addScaledVector(out, w * 0.82 * Math.max(Math.cos(yaw), 0.18 - upright))
            .add(new Vector3(0, 0, d * 0.82 * Math.sin(yaw) * upright));
          const start = new Vector3(
            side * Math.cos(yaw),
            0.25,
            Math.sin(yaw),
          ).normalize();
          const fall = new Vector3(side * 0.25 * Math.cos(yaw), -1, 0.25 * Math.sin(yaw)).normalize();
          const hook = new Vector3(side * 0.7 * Math.cos(yaw), 0.75, 0.7 * Math.sin(yaw)).normalize();
          const around = new Vector3(-Math.sin(yaw), 0, side * Math.cos(yaw));
          const phase = i * 2.1 + (side > 0 ? 0 : 1.3);
          const points = [root.clone()];
          const steps = plan.anatomyRevision === 2 ? 14 : 6;
          for (let j = 1; j <= steps; j++) {
            const t = j / steps;
            if (plan.anatomyRevision === 2) {
              const curl = limb.curl;
              const reach = .43 + .08 * Math.sin(phase);
              const turn = Math.max(0, (t - reach) / (1 - reach));
              const angle = .15 - (droop + .24) * smooth(Math.min(1, t / .65))
                + (curl >= 0 ? 5.55 : 2.15) * curl * turn ** 1.2;
              const bearing = yaw + .27 * Math.sin(phase + 3.2*t) * t
                + .63 * curl * Math.sin(phase + .7) * turn;
              const dir = new Vector3(side * Math.cos(bearing)*Math.cos(angle),
                Math.sin(angle), Math.sin(bearing)*Math.cos(angle));
              const next = points.at(-1).clone().addScaledVector(dir, span / steps);
              if (next.y < .018*k) {
                const depth = .018*k - next.y;
                next.y += depth;
                next.x += side * Math.cos(bearing) * depth * .75;
                next.z += Math.sin(bearing) * depth * .75;
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
            points.push(points.at(-1).clone().addScaledVector(dir, span / 6));
          }
          for (const p of points) p.y = Math.max(p.y, 0.012 * k);
          const tr = g * 0.3;
          sweep(
            id,
            points,
            points.map((_, j) => {
              const t = j / steps;
              const r = Math.max(.004, tr * (1 - .86 * t ** 1.2));
              return plan.anatomyRevision === 2
                ? [r * (1.12 - .10*t), r * (.88 + .10*t)] : [r, r];
            }),
            skin.base,
            plan.anatomyRevision === 2
              ? { ...organic("tail"), blendSkin: false, suckerRows: tr > 0.032*k ? 2 : 1 }
              : organic("tail"),
            "body",
          );
        }
      }
    }
  }

  const has = (name) => detail > 0 && plan.details.includes(name);
  if (has("spurs"))
    for (const a of anchors) {
      const dir = a.mid.clone().sub(a.root.clone().lerp(a.end, 0.5));
      if (dir.lengthSq() < 1e-8) dir.set(0, 0, -1);
      dir.normalize();
      const from = a.mid.clone().addScaledVector(dir, a.r1 * 0.4);
      sweep(
        a.id + " spur",
        [from, from.clone().addScaledVector(dir, a.r1 * 0.9), from.clone().addScaledVector(dir, a.r1 * 2).add(new Vector3(0, a.r1 * 0.4, 0))],
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
        [from, from.clone().addScaledVector(dir, tall * 1.2), from.clone().addScaledVector(dir, tall * 2.4).add(new Vector3(0, 0, -tall * 0.6))],
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
        [(-f.pitch / rad) || 0, 0, 0],
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
      const turn = stinger
        ? (150 * rad) / count
        : (tail.lift * rad * (0.4 + 1.2 * t)) / count;
      heading = heading.clone().applyAxisAngle(axis, turn).normalize();
      if (tail.sway) heading.applyAxisAngle(swayAxis, (tail.sway * rad * (0.3 + 1.4 * t)) / count).normalize();
      points.push(points.at(-1).clone().addScaledVector(heading, length / count));
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
    const end = points.at(-1),
      before = points.at(-2),
      along = end.clone().sub(before).normalize();
    if (tail.kind === "club")
      ball("tail club", end.clone().addScaledVector(along, base * 0.4), [base * 1.9, base * 1.7, base * 2.3], skin.accent, { surface: skin.surface, motionRole: "rigid" }, "tail");
    if (tail.kind === "stinger")
      sweep(
        "tail barb",
        [end.clone().addScaledVector(along, -base * 0.1), end.clone().addScaledVector(along, base * 0.9).add(new Vector3(0, -base * 0.2, 0)), end.clone().addScaledVector(along, base * 1.6).add(new Vector3(0, -base * 1.1, 0))],
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
        cage("tail " + tail.kind, end, [unit, unit, unit], caudalFinCage(along, wide), skin.accent,
          { surface: skin.surface, motionRole: "rigid" }, "tail");
      } else sweep(
        "tail " + tail.kind,
        [end.clone().addScaledVector(along, -base * 0.5), end.clone().addScaledVector(along, base * 1.4), end.clone().addScaledVector(along, base * 3)],
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
        [end.clone().addScaledVector(along, -base * 0.6), end.clone().addScaledVector(along, base * 1.6), end.clone().addScaledVector(along, base * 4.4)],
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
      sweep("dorsal sail", pts, radii, skin.accent, { surface: skin.surface, motionRole: "rigid" }, "body");
    } else
      for (let j = 0; j < n; j++) {
        const t = n === 1 ? 0.5 : lerp(0.14, 0.86, j / (n - 1)),
          f = spine.at(t);
        const rise = tall * (0.55 + 0.45 * Math.sin((j / Math.max(1, n - 1)) * Math.PI));
        const foot = f.centre.clone().addScaledVector(f.dorsal, f.radius[1] * 0.78);
        const lean = f.dorsal.clone().addScaledVector(f.tangent, -0.28).normalize();
        const chord = back.kind === "spikes" ? 0.018 * k + rise * 0.1 : back.kind === "plates" ? rise * 0.52 : rise * 0.3;
        sweep(
          "dorsal " + back.kind.replace(/s$/, "") + " " + (j + 1),
          [foot, foot.clone().addScaledVector(lean, rise * 0.45), foot.clone().addScaledVector(lean, rise)],
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
    const yaw = (head.count === 1 ? 0 : lerp(-1, 1, n / (head.count - 1)) * 30 * rad) + (head.turn ?? 0) * rad;
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
      .addScaledVector(across, head.count === 1 ? 0 : lerp(-1, 1, n / (head.count - 1)) * fw * 0.42);
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
      const projectedWidth = axes[0] * Math.abs(Math.cos(yaw-turn)) + axes[2] * Math.abs(Math.sin(yaw-turn)) * .45;
      const minimum = branch * projectedWidth * 1.16;
      if (Math.abs(lateral) < Math.abs(minimum))
        neckEnd.addScaledVector(spanAxis, minimum - lateral);
    }
    const nr0 = Math.min(fw, fd) * 0.82 * head.neckGirth * (head.count > 1 ? 0.72 : 1),
      nr1 = Math.min(nr0, Math.min(axes[0], axes[1]) * 0.42 * head.neckGirth + 0.004);
    const neckId = "neck" + tag;
    sweep(
      neckId,
      [neckRoot, neckRoot.clone().lerp(neckEnd, 0.45).addScaledVector(facing, neckLength * 0.06), neckEnd],
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
      .addScaledVector(facing, axes[2] * 0.16)
      .addScaledVector(up, axes[1] * 0.12);
    const headId = "head" + tag;
    const yawDegrees = (yaw / rad) || 0;
    const skull = plan.anatomyRevision === 2 ? skullCage(head.shape, head.snout) : null;
    if (skull)
      cage(headId, centre, axes, skull, skin.base,
        { ...fleshy(), motionRole: "head" }, neckId, yawDegrees);
    else ball(headId, centre, axes, skin.base, organic("head"), neckId, [0, yawDegrees, 0]);
    const rigid = (surface = "plain") => ({ surface, motionRole: "rigid" });
    const onHead = (az, el, scale = 1) => {
      const radius = skull ? skullSurfaceRadius(skull, az, el) : .5;
      return centre
        .clone()
        .addScaledVector(across, Math.sin(az) * Math.cos(el) * axes[0] * radius * scale)
        .addScaledVector(up, Math.sin(el) * axes[1] * radius * scale)
        .addScaledVector(facing, Math.cos(az) * Math.cos(el) * axes[2] * radius * scale);
    };
    const outward = (az, el) =>
      across
        .clone()
        .multiplyScalar(Math.sin(az) * Math.cos(el))
        .addScaledVector(up, Math.sin(el))
        .addScaledVector(facing, Math.cos(az) * Math.cos(el))
        .normalize();
    headFrames.push({ headId, neckId, centre, axes, across, up, facing, onHead, outward, neckRoot, neckEnd, nr0, nr1, hs });
    const muzzleLength = hs * 0.52 * head.snoutLength;
    const mouthAt = onHead(0, -0.34, 0.9);
    let lipAt = mouthAt.clone().addScaledVector(facing, hs * 0.04),
      lipWidth = axes[0] * 0.5;
    let jawed = false;
    if (head.snout === "muzzle") {
      jawed = true;
      const reach = muzzleLength * 1.05 + axes[2] * 0.24;
      const start = onHead(0, -0.08, 0.5);
      const tip = start
        .clone()
        .addScaledVector(facing, reach)
        .addScaledVector(up, -hs * 0.1);
      const widths = [axes[0] * 0.4, axes[0] * 0.33, axes[0] * 0.26, axes[0] * 0.17],
        depths = [axes[1] * 0.34, axes[1] * 0.27, axes[1] * 0.2, axes[1] * 0.12];
      const along = [0, 0.4, 0.78, 1];
      const upperAt = (t) =>
        start
          .clone()
          .lerp(tip, t)
          .addScaledVector(up, hs * 0.05 * Math.sin(Math.PI * t));
      const profile = head.muzzleProfile;
      if (profile) {
        cage("muzzle"+tag, start, [hs,hs,hs],
          mammalMuzzle(profile,false,axes[0]/hs,axes[1]/hs,reach/hs,-.1),
          skin.base, fleshy(), headId, yawDegrees);
      } else sweep(
        "muzzle" + tag,
        along.map(upperAt),
        along.map((_, j) => [widths[j], depths[j]]),
        skin.base,
        organic("rigid"),
        headId,
      );
      const hinge = onHead(0, -0.62, 0.62).addScaledVector(facing, -axes[2] * 0.06);
      const gape = head.jaw * 38 * rad;
      const jawDir = facing
        .clone()
        .multiplyScalar(Math.cos(gape + 0.1))
        .addScaledVector(up, -Math.sin(gape + 0.1));
      const jawLength = tip.clone().sub(hinge).dot(facing) * 0.96;
      const jawAt = (t) => hinge.clone().addScaledVector(jawDir, jawLength * t);
      if (profile) {
        cage("jaw"+tag, hinge, [hs,hs,hs], mammalMuzzle(profile,true,axes[0]/hs,axes[1]/hs,
          jawLength*Math.cos(gape+.1)/hs,-jawLength*Math.sin(gape+.1)/hs),
          mix(skin.base,skin.pale,.25*skin.belly),fleshy(),headId,yawDegrees);
      } else sweep(
        "jaw" + tag,
        [0, 0.45, 0.82, 1].map(jawAt),
        [
          [axes[0] * 0.36, axes[1] * 0.2],
          [axes[0] * 0.31, axes[1] * 0.16],
          [axes[0] * 0.23, axes[1] * 0.12],
          [axes[0] * 0.14, axes[1] * 0.07],
        ],
        mix(skin.base, skin.pale, 0.25 * skin.belly),
        fleshy(),
        headId,
      );
      if (head.mouth)
        ball(
          "mouth" + tag,
          upperAt(0.55).lerp(jawAt(0.6), 0.5),
          [axes[0] * 0.5, Math.max(hs * 0.05, upperAt(0.55).distanceTo(jawAt(0.6)) * 0.9), jawLength * 0.86],
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
            const w = lerp(widths[1], widths[3], (t - 0.4) / 0.6) * 0.8,
              sink = lerp(depths[1], depths[3], (t - 0.4) / 0.6) * 0.5;
            const root = upperAt(t)
              .addScaledVector(across, side * w)
              .addScaledVector(up, -sink);
            const size = hs * 0.085 * fang;
            sweep(
              "upper " + name,
              [root, root.clone().addScaledVector(up, -size * 0.6).addScaledVector(facing, -size * 0.06), root.clone().addScaledVector(up, -size * 1.5).addScaledVector(facing, -size * 0.22)],
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
              .addScaledVector(up, axes[1] * 0.06);
            sweep(
              "lower " + name,
              [low, low.clone().addScaledVector(up, size * 0.5), low.clone().addScaledVector(up, size * 1.05).addScaledVector(facing, -size * 0.1)],
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
        const noseAt = tip.clone().addScaledVector(up, depths[3]*(profile === "rooting" ? .1 : .54));
        const breadth = axes[0]*(profile === "rooting" ? .23 : profile === "feline" ? .115 : .155);
        const colour = mix(skin.base,profile === "rooting" ? "#835c58" : "#212023",.73);
        for (const side of [1,-1]) {
          cage((side>0 ? "left" : "right")+" nostril"+tag,noseAt,[breadth,breadth,breadth],
            noseWing(profile,side),colour,{...rigid(),nasalWing:true},headId,yawDegrees);
        }
      } else if (head.nostrils && detail > 0)
        for (const side of [1, -1])
          ball(
            (side > 0 ? "left" : "right") + " nostril" + tag,
            upperAt(0.9)
              .addScaledVector(across, side * widths[3] * 0.62)
              .addScaledVector(up, depths[3] * 0.82),
            [hs * 0.06, hs * 0.035, hs * 0.07],
            "#2a1c1c",
            rigid(),
            headId,
            [0, yawDegrees, 0],
          );
      lipAt = jawAt(0.9).addScaledVector(up, axes[1] * 0.1);
      lipWidth = axes[0] * 0.4;
    } else if (head.snout === "beak" || head.snout === "bill") {
      const bill = head.snout === "bill";
      const start = onHead(0, -0.2, 0.7);
      if (plan.anatomyRevision === 2 || head.billProfile) {
        const length=muzzleLength*(bill?2.17:1.86), width=axes[0]*(bill?.46:.32), depth=axes[1]*(bill?.19:.35);
        const size=[hs,hs,hs], keratin=mix(skin.accent,skin.pale,.26);
        cage("beak"+tag,start,size,beakCage(bill,false,width/hs,depth/hs,length/hs,head.jaw,head.billProfile),keratin,rigid(),headId,yawDegrees);
        if(head.mouth)
          cage("lower beak"+tag,start,size,beakCage(bill,true,width/hs,depth/hs,length/hs,head.jaw,head.billProfile),mix(keratin,"#403a32",.38),rigid(),headId,yawDegrees);
      } else sweep(
        "beak" + tag,
        [start, start.clone().addScaledVector(facing, muzzleLength * 0.9).addScaledVector(up, -hs * 0.03), start.clone().addScaledVector(facing, muzzleLength * 1.9).addScaledVector(up, bill ? -hs * 0.04 : -hs * 0.2)],
        bill
          ? [
              [axes[0] * 0.3, axes[1] * 0.2],
              [axes[0] * 0.34, axes[1] * 0.1],
              [axes[0] * 0.3, axes[1] * 0.04],
            ]
          : [
              [axes[0] * 0.27, axes[1] * 0.27],
              [axes[0] * 0.17, axes[1] * 0.19],
              [0.003, 0.004],
            ],
        skin.accent,
        rigid(),
        headId,
      );
    } else if (head.snout === "mandibles") {
      for (const side of [1, -1]) {
        const start = plan.anatomyRevision === 2 ? onHead(side * 0.62, -0.32, 0.88) : onHead(side * 0.5, -0.4, 0.86);
        if (plan.anatomyRevision === 2) {
          const length=muzzleLength*1.65, size=[hs,hs,hs];
          cage((side>0?"left":"right")+" mandible"+tag,start,size,
            mandibleCage(side,length/hs,.20, .145,head.jaw),mix(skin.base,"#725839",.54),{...rigid("horn"),hornSwatch:2},headId,yawDegrees);
          continue;
        }
        sweep(
          (side > 0 ? "left" : "right") + " mandible" + tag,
          [
            start,
            start.clone().addScaledVector(facing, muzzleLength * 0.8).addScaledVector(across, side * hs * 0.14),
            start.clone().addScaledVector(facing, muzzleLength * 1.5).addScaledVector(across, -side * hs * 0.08),
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
        if(plan.anatomyRevision === 2) {
          points.push(start.clone().addScaledVector(facing,muzzleLength*(.72*Math.sin(t*Math.PI)+1.52*t*t))
            .addScaledVector(up,-muzzleLength*(2.14*Math.sin(Math.PI*t*.80)-head.jaw*.45*t*t)));
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
        const r = hs * (plan.anatomyRevision === 2 ? lerp(.28, .10, t) + .075 * t**6 : lerp(.2, .09, t));
        return [r, r];
      });
      if (plan.anatomyRevision === 2) {
        const profile = points.map(point => {
          const delta = point.clone().sub(start);
          return [delta.dot(facing), delta.y];
        });
        let pitch = 0;
        for (let j = 1; j < profile.length; j++) {
          const [forward, vertical] = profile[j];
          const thickness = head.nostrils && j === count ? Math.max(radii[j][0], hs * .185) : radii[j][0];
          const clearance = thickness + .012 * plan.scale - start.y;
          if (vertical >= clearance) continue;
          const length = Math.hypot(forward, vertical);
          const needed = Math.asin(clamp(clearance / length, -1, 1)) - Math.atan2(vertical, forward);
          pitch = Math.max(pitch, Math.min(needed, Math.PI / 2));
        }
        if (pitch > 0) {
          const c = Math.cos(pitch), s = Math.sin(pitch);
          profile.forEach(([forward, down], j) => {
            points[j].copy(start).addScaledVector(facing, c * forward - s * down)
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
        const end=points.at(-1), axis=end.clone().sub(points.at(-2)).normalize();
        const r=Math.max(.005, hs*.185);
        cage("trunk nostrils"+tag,end,[r,r,r],trunkTipCage(across,axis),mix(skin.base,"#3f3330",.26),rigid(skin.surface),"trunk"+tag);
      }
    }
    if (head.mouth && !jawed && head.snout === "none")
      ball("mouth" + tag, lipAt, [lipWidth, hs * 0.035, hs * 0.09], "#3a2422", rigid(), headId, [0, yawDegrees, 0]);

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
    eyeSpots.forEach(([az, el], j) => {
      const name = (az > 0.01 ? "left " : az < -0.01 ? "right " : "middle ") + "eye" + (eyeSpots.length > 3 ? " " + (Math.floor(j / 2) + 1) : "") + tag;
      const normal = outward(az, el);
      const seat = onHead(az, el, skull ? 1.005 : .94);
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
      const gaze = normal.clone().lerp(facing, head.eyePlace === "side" ? 0.3 : 0.62).normalize();
      const compound = head.snout === "mandibles";
      const eyeColor=compound ? (skull ? mix(skin.eye,"#142427",.48) : skin.eye)
        : skull ? mix("#efe9da",skin.base,.40) : "#efe9da";
      if (skull) {
        const direction = normal.clone().lerp(facing, head.eyePlace === "side" ? .12 : .33).normalize();
        const side = Math.sign(az);
        const radius = Math.max(.005,eyeRadius * (eyeSpots.length > 2 ? .80 : 1));
        const shape = [radius,radius,radius];
        const seatOnSkull = head.stalks > .005 ? null : point => {
          const offset = at.clone().addScaledVector(point,radius).sub(centre);
          const x = offset.dot(across)/axes[0], y = offset.dot(up)/axes[1], z = offset.dot(facing)/axes[2];
          const base = onHead(Math.atan2(x,z),Math.atan2(y,Math.hypot(x,z)),.91);
          return base.sub(at).multiplyScalar(1e7/radius).round().multiplyScalar(1e-7);
        };
        const orbit = creatureOrbit({head,gaze:direction,up,side,seatOnSkull});
        cage(name,at,shape,orbit.eye,compound ? eyeColor : mix(eyeColor,skin.base,.22),{...rigid(),eyeSurface:compound ? "compound" : "white"},headId);
        if (orbit.iris) {
          cage(name+" iris",at,shape,orbit.iris,mix(skin.eye,"#554534",.14),{...rigid(),eyeSurface:"iris"},headId);
          cage(name+" pupil",at,shape,orbit.pupil,"#101412",{...rigid(),eyeSurface:"pupil"},headId);
        }
        if (detail > 0 && (head.lids > .04 || (head.brow > .05 && j < 2 && side)))
          cage(name+" lid",at,shape,orbit.rim,mix(skin.base,"#352d29",.12),fleshy(),headId);
        return;
      }
      ball(name, at, [eyeRadius * 2, eyeRadius * 2, eyeRadius * 2],eyeColor,rigid(),headId);
      if (compound)
        ball(
          name + " glint",
          at.clone().addScaledVector(gaze, eyeRadius * 0.7).addScaledVector(up, eyeRadius * 0.35),
          [eyeRadius * 0.7, eyeRadius * 0.5, eyeRadius * 0.5],
          skull ? mix(skin.eye,"#e6dccb",.34) : shade(skin.eye, 0.55),
          rigid(),
          headId,
        );
      else ball(
        name + " iris",
        at.clone().addScaledVector(gaze, eyeRadius * 0.62),
        [eyeRadius * 1.16, eyeRadius * 1.16, eyeRadius * 0.9],
        skin.eye,
        rigid(),
        headId,
        [0, (Math.atan2(gaze.x, gaze.z) / rad) || 0, 0],
      );
      if (!compound) ball(
        name + " pupil",
        at.clone().addScaledVector(gaze, eyeRadius * 0.9),
        [eyeRadius * 0.56, eyeRadius * 0.7, eyeRadius * 0.4],
        "#141a19",
        rigid(),
        headId,
        [0, (Math.atan2(gaze.x, gaze.z) / rad) || 0, 0],
      );
      if (head.brow > 0.05 && detail > 0 && j < 2 && Math.abs(az) > 0.01) {
        const outer = across.clone().multiplyScalar(Math.sign(az));
        const lift = eyeRadius * (1.02 + 0.3 * head.brow),
          thick = eyeRadius * (0.22 + 0.4 * head.brow);
        sweep(
          name.replace("eye", "brow"),
          [
            at.clone().addScaledVector(up, lift * 0.82).addScaledVector(outer, -eyeRadius * 1.0).addScaledVector(gaze, eyeRadius * 0.55),
            at.clone().addScaledVector(up, lift * 1.08).addScaledVector(gaze, eyeRadius * 0.62),
            at.clone().addScaledVector(up, lift * 0.9).addScaledVector(outer, eyeRadius * 1.05).addScaledVector(gaze, eyeRadius * 0.2),
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
        const name = (side > 0 ? "left " : "right ") + head.crest.replace(/s$/, "").replace("antennae", "antenna") + tag;
        const az = side * (head.crest === "ears" ? 1.35 : 0.6),
          el = head.crest === "ears" ? 0.62 : 1.0;
        const seat = onHead(az, el, 0.9),
          normal = outward(az, el);
        if ((skull || head.ear) && head.crest === "ears") {
          cage(name,seat,[cs,cs,cs],earCage(normal,up,facing,head.shape==="round" || head.shape==="wide",head.ear),
            skin.base,{...rigid(skin.surface),pinna:true},headId);
        } else if (skull && head.crest === "horns") {
          const horn = [], radii = [];
          const swept = head.eyePlace==="side";
          for (let i=0;i<=12;i++) {
            const t=i/12, girth=cs*(.14*(1-t)**.88+.003);
            const point=seat.clone().addScaledVector(normal,cs*(.56*t-.16*t*t))
              .addScaledVector(up,cs*(.04*t+.40*t*t))
              .addScaledVector(facing,cs*(swept ? -.37*t*t : -.23*Math.sin(Math.PI*t)+.17*t*t));
            horn.push(point);
            const annulus=1+(i%2===0 ? .14 : -.06)*(1-t);
            radii.push([girth*annulus,girth*annulus*.83]);
          }
          sweep(name,horn,radii,mix(skin.pale,"#ae8e68",.34),{...rigid("horn"),hornSwatch:2},headId);
        } else if (head.crest === "horns")
          sweep(
            name,
            [seat, seat.clone().addScaledVector(normal, cs * 0.34).addScaledVector(facing, -cs * 0.1), seat.clone().addScaledVector(normal, cs * 0.62).addScaledVector(facing, cs * 0.08).addScaledVector(up, cs * 0.12)],
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
            [seat.clone().addScaledVector(normal, -cs * 0.05), seat.clone().addScaledVector(normal, cs * 0.26).addScaledVector(up, cs * 0.1), seat.clone().addScaledVector(normal, cs * 0.5).addScaledVector(up, cs * 0.3)],
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
          const tip = seat.clone().addScaledVector(normal, cs * 0.7).addScaledVector(facing, cs * 0.5).addScaledVector(up, cs * 0.2);
          sweep(
            name,
            [seat, seat.clone().addScaledVector(normal, cs * 0.5).addScaledVector(up, cs * 0.2), tip],
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
          [seat, seat.clone().addScaledVector(normal, cs * 0.26), seat.clone().addScaledVector(normal, cs * (0.5 + 0.16 * Math.cos(az * 1.4)))],
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
    const grown = (name, n, at, girthAt, color = keratin, extra = horny, parent = headId) => {
      const points = [],
        radii = [];
      for (let i = 0; i <= n; i++) {
        const t = i / n,
          g = girthAt(t, i);
        points.push(at(t));
        radii.push([g, g * 0.86]);
      }
      return sweep(name, points, radii, color, extra, parent);
    };
    const boss = (t) => 1 + 0.6 * Math.max(0, 1 - t / 0.18) ** 2;
    const ridged = (t, i) => 1 + (i % 2 === 0 ? 0.12 : -0.05) * (1 - t);
    const leaf = (id, rings, color, extra, parent = headId) => {
      const sides = rings[0].length,
        rows = rings.length,
        points = rings.flat();
      const low = points[0].clone(),
        high = points[0].clone();
      for (const q of points) {
        low.min(q);
        high.max(q);
      }
      const pivot = low.clone().add(high).multiplyScalar(0.5),
        unit = Math.max(0.004, ...high.clone().sub(low).toArray()) / 2;
      const mid = (row) => rings[row].reduce((a, q) => a.add(q), new Vector3()).multiplyScalar(1 / sides);
      const all = [...points, mid(0), mid(rows - 1)],
        faces = [];
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
          volume += all[f[0]].clone().sub(pivot).dot(new Vector3().crossVectors(all[f[i]].clone().sub(pivot), all[f[i + 1]].clone().sub(pivot)));
      if (volume < 0) for (const f of faces) f.reverse();
      const vertices = all.map((v) => v.clone().sub(pivot).multiplyScalar(1 / unit).toArray().map((x) => Number(x.toFixed(4))));
      return cage(id, pivot, [unit, unit, unit], { vertices, faces, levels: 1 }, color, extra, parent);
    };
    const vane = (id, points, widths, normal, thick, color, extra, parent = headId) =>
      leaf(
        id,
        points.map((q, i) => {
          const along = points[Math.min(points.length - 1, i + 1)].clone().sub(points[Math.max(0, i - 1)]).normalize();
          const wide = new Vector3().crossVectors(along, normal).normalize();
          const w = widths[i],
            t = thick * (0.4 + 0.6 * Math.min(1, w / Math.max(...widths)));
          return [q.clone().addScaledVector(wide, w), q.clone().addScaledVector(normal, t), q.clone().addScaledVector(wide, -w), q.clone().addScaledVector(normal, -t)];
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
                .addScaledVector(up, cs * 0.17 * Math.sin(Math.min(turn, 1.57)) - rho * 0.95 * (1 - Math.cos(turn)));
            },
            (t, i) => cs * (0.19 * (1 - t) ** 0.8 + 0.004) * ridged(t, i) * (1 + 0.25 * Math.max(0, 1 - t / 0.18)),
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
          const beam = (t) =>
            seat
              .clone()
              .addScaledVector(up, cs * (0.95 * t - 0.1 * t * t))
              .addScaledVector(out, cs * 0.55 * t ** 0.8)
              .addScaledVector(facing, cs * (-0.38 * t + 0.42 * t * t));
          const thick = (t) => cs * (0.062 * (1 - t) ** 0.7 + 0.004);
          const id = grown(sideName + "antler" + tag, 8, beam, (t) => thick(t) * boss(t));
          [
            [0.3, facing.clone().multiplyScalar(0.8).addScaledVector(up, 0.55).addScaledVector(out, 0.1), 0.4],
            [0.64, up.clone().multiplyScalar(0.9).addScaledVector(out, -0.15).addScaledVector(facing, 0.25), 0.42],
          ].forEach(([t, ray, long], j) => {
            ray.normalize();
            const from = beam(t),
              r = thick(t);
            sweep(
              sideName + "antler tine " + (j + 1) + tag,
              [from, from.clone().addScaledVector(ray, cs * long * 0.55), from.clone().addScaledVector(ray, cs * long).addScaledVector(up, cs * long * 0.22)],
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
            (t) => cs * [0.13, 0.075, 0.064, 0.084, 0.05][Math.round(t * 4)],
            skin.base,
            fleshy(),
          );
          ball(sideName + "nub tip" + tag, seat.clone().addScaledVector(normal, cs * 0.5), [cs * 0.17, cs * 0.13, cs * 0.17], shade(skin.accent, -0.2), rigid(), id);
        }
      }
    if (head.crest === "spire") {
      const seat = onHead(0, 1.0, 0.78),
        ray = up.clone().multiplyScalar(0.85).addScaledVector(facing, 0.5).normalize();
      grown(
        "horn" + tag,
        12,
        (t) => seat.clone().addScaledVector(ray, cs * 1.15 * t).addScaledVector(facing, cs * 0.14 * t * t),
        (t, i) => cs * (0.13 * (1 - t) ** 0.9 + 0.003) * ridged(t, i) * boss(t),
      );
    }
    if (head.crest === "fan") {
      const rows = 9,
        ray = (az, el) => outward(az, el).multiplyScalar(0.55).addScaledVector(up, 0.65).addScaledVector(facing, -0.3).normalize();
      const station = (t) => {
        const pitch = lerp(0.75, 2.5, t),
          az = pitch <= Math.PI / 2 ? 0 : Math.PI,
          el = Math.min(pitch, Math.PI - pitch);
        return [onHead(az, el, 0.86), ray(az, el)];
      };
      const tall = (t) => cs * 0.82 * Math.sin(Math.PI * (0.06 + 0.9 * t)) ** 0.6;
      leaf(
        "crest fan" + tag,
        Array.from({ length: rows }, (_, i) => {
          const t = i / (rows - 1),
            [seat, r] = station(t),
            tip = seat.clone().addScaledVector(r, tall(t) * (i % 2 ? 0.8 : 1)),
            w = hs * 0.05;
          return [seat.clone().addScaledVector(across, w), tip.clone().addScaledVector(across, w * 0.22), tip.clone().addScaledVector(across, -w * 0.22), seat.clone().addScaledVector(across, -w)];
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
          points.push(root.clone().addScaledVector(up, long * t * Math.cos(a)).addScaledVector(facing, -long * t * Math.sin(a)).addScaledVector(across, (j % 2 ? 1 : -1) * hs * 0.05 * t));
          widths.push(hs * (0.012 + 0.12 * Math.sin(Math.PI * t ** 0.8) ** 0.7));
        }
        vane("plume feather " + (j + 1) + tag, points, widths, across, hs * 0.02, j % 2 ? skin.pale : skin.accent, rigid());
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
          [seat, seat.clone().addScaledVector(nape, h * 0.6).addScaledVector(dir, -h * 0.12), seat.clone().addScaledVector(nape, h).addScaledVector(dir, -h * 0.5)],
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
        const seat = centre.clone().addScaledVector(facing, -axes[2] * 0.3).addScaledVector(ray, axes[1] * 0.3);
        const long = hs * (0.95 - 0.2 * Math.abs(a));
        sweep(
          "frill blade " + (j + 1) + tag,
          [seat, seat.clone().addScaledVector(ray, long * 0.55), seat.clone().addScaledVector(ray, long)],
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
        neckEnd.clone().lerp(neckRoot, 0.3).addScaledVector(nape, -nr1 * 1.15).addScaledVector(facing, hs * 0.12),
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
            from.clone().addScaledVector(facing, hs * 0.36).addScaledVector(across, side * hs * 0.16).addScaledVector(up, -hs * 0.06),
            from.clone()
              .addScaledVector(facing, hs * (skull && head.stalks > .005 ? .74 : .54))
              .addScaledVector(across, side * hs * (skull && head.stalks > .005 ? .35 : .24))
              .addScaledVector(up, hs * (skull && head.stalks > .005 ? .22 : .42)),
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
      const seat = onHead(0, 0.26, 0.9).addScaledVector(facing, snouty ? muzzleLength * 0.5 : 0).addScaledVector(up, snouty ? -hs * 0.12 : 0),
        ray = up.clone().multiplyScalar(0.84).addScaledVector(facing, 0.54).normalize();
      grown(
        "nose horn" + tag,
        8,
        (t) => seat.clone().addScaledVector(ray, hs * 0.9 * t).addScaledVector(facing, -hs * 0.14 * t * t),
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
          (t) => seat.clone().addScaledVector(normal, hs * 0.42 * t).addScaledVector(facing, hs * 0.16 * t * t),
          (t) => hs * (0.07 * (1 - t) ** 0.85 + 0.003) * boss(t),
        );
      }
    if (has("beard")) {
      const seat = onHead(0, -0.95, 0.86).addScaledVector(facing, hs * 0.12);
      sweep(
        "beard" + tag,
        [seat, seat.clone().addScaledVector(up, -hs * 0.3).addScaledVector(facing, hs * 0.06), seat.clone().addScaledVector(up, -hs * 0.5).addScaledVector(facing, -hs * 0.03), seat.clone().addScaledVector(up, -hs * 0.68).addScaledVector(facing, -hs * 0.12)],
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
            const ray = out.clone().multiplyScalar(0.72).addScaledVector(up, Math.sin(a) * 0.8).addScaledVector(facing, -0.3 - 0.25 * Math.cos(a)).normalize();
            const root = seat.clone().addScaledVector(up, Math.sin(a) * hs * 0.2),
              tip = root.clone().addScaledVector(ray, hs * (0.62 - 0.14 * Math.abs(a)) * (i % 2 ? 0.74 : 1)),
              w = hs * 0.045;
            return [root.clone().addScaledVector(flat, w), tip.clone().addScaledVector(flat, w * 0.2), tip.clone().addScaledVector(flat, -w * 0.2), root.clone().addScaledVector(flat, -w)];
          }),
          skin.accent,
          rigid(skin.surface),
        );
      }
    if (head.whiskers && detail > 0)
      for (const side of [1, -1])
        for (let j = 0; j < 2; j++) {
          const seat = lipAt.clone().addScaledVector(across, side * lipWidth * 0.46).addScaledVector(up, hs * (0.05 + 0.04 * j));
          sweep(
            (side > 0 ? "left" : "right") + " whisker " + (j + 1) + tag,
            [seat, seat.clone().addScaledVector(across, side * hs * 0.3).addScaledVector(up, hs * (0.02 + 0.07 * j)), seat.clone().addScaledVector(across, side * hs * 0.58).addScaledVector(up, hs * (-0.05 + 0.12 * j)).addScaledVector(facing, hs * 0.08)],
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
    cage((row[0].side > 0 ? "left" : "right")+" thoracic shields",plate.centre,
      [plate.unit,plate.unit,plate.unit],plate.cage,mix(skin.base,skin.accent,.20),
      {surface:skin.surface,motionRole:"rigid"}, "body");
  }
  if (plan.dress) {
    const dressCap = 128 - 12 - (growthFamilies.includes(plan.back.kind) ? 14 : 0);
    dressCreature({
      plan,
      spine,
      anchors,
      heads: headFrames,
      supports: parts.filter(part => part.shape === "ellipsoid" && /^(pelvis|shoulders|dewlap)| haunch$/.test(part.id)),
      room: () => parts.length < dressCap,
      emit(id, parent, shells, color, surface) {
        const points = shells.flatMap((shell) => shell.vertices);
        const low = points[0].clone(),
          high = points[0].clone();
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
          vertices.push(...shell.vertices.map((v) => v.clone().sub(pivot).multiplyScalar(1 / unit).toArray().map((x) => Number(x.toFixed(4)))));
          faces.push(...shell.faces.map((f) => f.map((i) => i + offset)));
        }
        cage(id, pivot, [unit, unit, unit], { vertices, faces, levels: 1 }, color, { surface, motionRole: "rigid" }, parent);
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
    const rank = (p) =>
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
      .map((p, i) => [rank(p), i, p])
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    for (const [, , p] of order.slice(46)) {
      delete p.blendSkin;
    }
  }
  for (const p of form.parts) {
    if (skin.coat && !p.coatZone && (p.shape === "hand" || /eye stalk$/.test(p.id))) p.coatZone = p.shape === "hand" ? "end" : "body";
    p.position = p.position.map((v) => Number(v.toFixed(5)));
    if (p.knots) p.knots = p.knots.map((r) => r.map((v) => Number(v.toFixed(5))));
    p.size = p.size.map((v) => Number(v.toFixed(5)));
  }
  return equipCreature(applyBackGrowth(form, plan, spine),plan,spine,unavailableHands);
}

const marks = (kind, color, spacing, coverage, seed, angle = 0) => ({
  kind,
  color,
  spacing,
  coverage,
  angle,
  seed,
});
export const creaturePresets = {
  "Four-legged grazer": {
    spine: { length: 1.05, girth: 0.22, front: 12, arch: 5, stance: 0.68, profile: "barrel", bulge: [1.12, 0.98, 1.08, 1.2, 1.02] },
    head: { neck: 0.42, neckPitch: 54, neckGirth: 0.82, size: 0.95, shape: "long", snout: "muzzle", snoutLength: 0.9, jaw: 0.05, eyePlace: "side", eyeSize: 1.15, lids: 0.3, brow: 0.2, crest: "ears", crestSize: 1.15 },
    limbs: [{ kind: "leg", pairs: 2, from: 0.14, to: 0.86, style: "bird", splay: 5, end: "hoof", muscle: 1.15 }],
    tail: { kind: "taper", length: 0.5, lift: -24, girth: 0.7 },
    back: { kind: "none" },
    details: ["mane", "tail tuft"],
    skin: { coat: { family: "pelt", graded: true, contrast: .80, density: .92, seed: 195 }, base: "#a67c4e", accent: "#3b2a1e", pale: "#f1e4c8", eye: "#5b3d22", belly: 0.85, socks: 0.4, markings: marks("Rosettes", "#6d4a2b", 0.2, 0.42, 3) },
  },
  "Two-legged runner": {
    spine: { length: 0.84, girth: 0.2, rear: 10, front: 34, arch: 4, stance: 0.84, profile: "pear", bulge: [1.1, 1.14, 1.04, 0.96, 0.86] },
    head: { neck: 0.3, neckPitch: 58, neckGirth: 0.9, size: 1.1, shape: "long", snout: "muzzle", snoutLength: 1.25, jaw: 0.32, teeth: 5, brow: 0.75, lids: 0.25, eyePlace: "side", crest: "crown", crestSize: 0.8 },
    limbs: [
      { kind: "leg", pairs: 1, from: 0.3, style: "bird", splay: 5, end: "talons", girth: 1.25, muscle: 1.35 },
      { kind: "arm", pairs: 1, from: 0.82, length: 0.3, drop: 50, forward: 50, elbow: 62, end: "hand", digits: 2, girth: 0.6, hand: 0.9 },
    ],
    tail: { kind: "taper", length: 0.95, lift: 8, girth: 1.25 },
    back: { kind: "spikes", count: 7, height: 0.08 },
    details: ["spurs"],
    skin: { coat: { family: "plumage", graded: true, contrast: .80, density: .92, seed: 194 }, base: "#4c7a72", accent: "#e2874d", pale: "#ecdcc0", eye: "#f2c14a", belly: 0.85, socks: 0.5, markings: marks("Bands", "#24403c", 0.2, 0.4, 11, 14) },
  },
  "Upright four-armed trader": {
    anatomyRevision: 2,
    dress: { kind: "sage", color: "#274958", trim: "#cf9659", size: .9, layers: 3, seed: 32 },
    spine: { length: 0.78, girth: 0.2, flat: 1.25, rear: 84, front: 86, arch: 3, stance: 0.8, profile: "tube", bulge: [1.02, 0.8, 0.96, 1.16, 1.02] },
    head: { neck: 0.13, neckPitch: 80, size: 1.18, shape: "wide", snout: "muzzle", snoutLength: 0.75, jaw: 0.2, teeth: 2, brow: 0.65, lids: 0.35, eyes: 4, eyeSize: 0.95, eyePlace: "front", crest: "horns", crestSize: 1.2 },
    limbs: [
      { kind: "leg", pairs: 1, from: 0.04, style: "mammal", splay: 5, end: "paw", digits: 3, girth: 1.4, muscle: 1.25 },
      { kind: "arm", pairs: 2, from: 0.50, to: 0.87, length: 0.66, drop: 53, forward: 31, elbow: 41, digits: 3, hand: 1.15, muscle: 1.25 },
    ],
    tail: { kind: "taper", length: 0.55, girth: 1.15, lift: -34 },
    back: { kind: "none" },
    details: ["tusks", "frill"],
    skin: { base: "#6f4f86", accent: "#e3b04f", pale: "#eadfc8", eye: "#f0c84a", belly: 0.75, socks: 0.55, markings: marks("Spots", "#48305c", 0.09, 0.3, 17) },
  },
  "Raised forebody hunter": {
    anatomyRevision: 2,
    spine: { length: 1.3, girth: 0.17, rear: 2, front: 78, arch: 0, stance: 0.5, profile: "tube", bulge: [1.15, 1.42, 0.86, 0.74, 0.94] },
    head: { neck: 0.1, neckPitch: 62, size: 1.1, shape: "wide", snout: "mandibles", eyes: 2, eyeSize: 2, eyePlace: "side", lids: 0, brow: 0, crest: "antennae", crestSize: 1.2 },
    limbs: [
      { kind: "leg", pairs: 2, from: 0.08, to: 0.5, style: "insect", splay: 46, fan: 50, end: "point", muscle: 1.2 },
      { kind: "arm", pairs: 1, from: 0.8, length: 0.8, drop: 34, forward: 62, elbow: 118, end: "spike", girth: 1.1, muscle: 1.35 },
    ],
    tail: { kind: "stub", length: 0.25 },
    back: { kind: "plates", count: 5, height: 0.08 },
    details: ["spurs"],
    skin: { base: "#5c8038", accent: "#d7df62", pale: "#f0e7bb", eye: "#e8d24a", belly: 0.8, socks: 0.4, markings: marks("Bands", "#35501f", 0.13, 0.26, 5) },
  },
  "Six-legged crawler": {
    anatomyRevision: 2,
    spine: { length: 1.2, girth: 0.17, flat: 1.35, front: 4, arch: 3, stance: 0.3, profile: "tube", bulge: [0.9, 1.3, 0.72, 1.12, 0.96] },
    head: { neck: 0.05, neckPitch: 8, shape: "wide", snout: "mandibles", eyes: 6, eyePlace: "front", lids: 0, brow: 0, crest: "antennae" },
    limbs: [
      { kind: "leg", pairs: 3, from: 0.34, to: 0.8, style: "insect", splay: 52, fan: 70, end: "point", muscle: 1.2 },
      { kind: "arm", pairs: 1, from: 0.9, length: 0.56, drop: 14, forward: 50, elbow: 58, end: "pincer", hand: 1.25, girth: 1.1, muscle: 1.3 },
    ],
    tail: { kind: "stinger", length: 0.85 },
    back: { kind: "plates", count: 6, height: 0.05 },
    details: [],
    skin: { base: "#6b3f33", accent: "#d98a3a", pale: "#ecd6a8", eye: "#d7c24a", belly: 0.7, socks: 0.6, markings: marks("Bands", "#3d231c", 0.11, 0.3, 4) },
  },
  "Radial many-legged walker": {
    anatomyRevision: 2,
    spine: { length: 0.62, girth: 0.17, rear: 86, front: 80, arch: 4, stance: 0.34, profile: "pear" },
    head: { neck: 0.1, neckPitch: 70, size: 1.25, shape: "round", snout: "muzzle", snoutLength: 0.8, jaw: 0.18, teeth: 2, eyePlace: "front", eyeSize: 1.5, lids: 0.5, brow: 0.4, crest: "ears", whiskers: true },
    limbs: [
      { kind: "leg", pairs: 5, from: 0.0, to: 0.14, style: "insect", splay: 38, fan: 170, end: "point", girth: 0.9 },
      { kind: "arm", pairs: 1, from: 0.84, length: 0.78, drop: 62, forward: 30, elbow: 34, digits: 3, hand: 1.3 },
    ],
    tail: { kind: "none" },
    back: { kind: "none" },
    skin: { base: "#c8961e", accent: "#5d7a2a", pale: "#ead9b6", eye: "#7a8c3a", belly: 0.8, socks: 0.3, markings: marks("Spots", "#8f6a12", 0.07, 0.3, 9) },
  },
  "Winged glider": {
    spine: { length: 0.9, girth: 0.15, front: 16, arch: 4, stance: 0.42, profile: "wedge", bulge: [0.9, 0.95, 1.05, 1.25, 1] },
    head: { neck: 0.24, neckPitch: 42, shape: "long", snout: "beak", eyePlace: "side", eyeSize: 1.2, brow: 0.5, crest: "crown" },
    limbs: [
      { kind: "leg", pairs: 1, from: 0.3, style: "bird", splay: 10, end: "talons", muscle: 1.2 },
      { kind: "wing", pairs: 1, from: 0.7, length: 1.15, rise: 16, sweep: 22, chord: 0.42, structure: "feather", ribs: 9, bend: 0.5, notch: 0.6, point: 0.3, pattern: "tips", seed: 8 },
    ],
    tail: { kind: "fluke", length: 0.5, lift: 5 },
    back: { kind: "none" },
    details: ["dewlap"],
    skin: { base: "#3f5f86", accent: "#e9b651", pale: "#e9e3d2", eye: "#f1cf52", belly: 0.9, socks: 0.4, markings: marks("Bands", "#22364f", 0.18, 0.3, 8, 20) },
  },
  "Finned swimmer": {
    anatomyRevision: 2,
    spine: { length: 1.5, girth: 0.2, flat: 0.78, front: 2, arch: 2, stance: 0.6, profile: "wedge" },
    head: { neck: 0.05, neckPitch: 4, shape: "long", snout: "muzzle", snoutLength: 1.5, jaw: 0.34, teeth: 6, eyePlace: "side", brow: 0.2, lids: 0, crest: "none" },
    limbs: [
      { kind: "fin", pairs: 1, from: 0.72, length: 0.42, sweep: 40, chord: 0.22 },
      { kind: "fin", pairs: 1, from: 0.3, length: 0.24, sweep: 50, chord: 0.14 },
    ],
    tail: { kind: "fan", length: 0.5, girth: 1.7 },
    back: { kind: "sail", count: 6, height: 0.26 },
    skin: { coat: { family: "wet skin", graded: true, contrast: .80, density: .92, seed: 191 }, base: "#2f6f7d", accent: "#f0a35a", pale: "#e6efe6", eye: "#d9e04f", belly: 1, markings: marks("Bands", "#1d4852", 0.24, 0.32, 2, 30) },
  },
  "Tentacled drifter": {
    anatomyRevision: 2,
    spine: { length: 0.55, girth: 0.24, rear: 88, front: 90, arch: 0, stance: 0.5, profile: "barrel" },
    head: { count: 1, neck: 0.03, neckPitch: 88, size: 0.9, shape: "round", snout: "none", mouth: false, eyes: 3, eyeSize: 1.3, eyePlace: "front", stalks: 0.22, lids: 0, brow: 0, crest: "none" },
    limbs: [
      { kind: "tentacle", pairs: 4, from: 0.08, to: 0.08, length: 0.95, droop: 62, fan: 135, curl: 0.55, girth: 1.15 },
      { kind: "tentacle", pairs: 2, from: 0.55, to: 0.55, length: 0.5, droop: 10, forward: 55, fan: 60, curl: 0.8, girth: 0.6 },
    ],
    tail: { kind: "none" },
    back: { kind: "none" },
    skin: { base: "#8b4f6e", accent: "#f0c15c", pale: "#f1dfd2", eye: "#5fc7c0", belly: 0.6, markings: marks("Rosettes", "#f0c15c", 0.16, 0.34, 21) },
  },
  "Armoured browser": {
    dress: { kind: "warden", color: "#47524c", trim: "#ad785b", size: .91, layers: 2, seed: 67 },
    spine: { length: 1.25, girth: 0.25, flat: 1.3, front: 6, arch: 8, stance: 0.64, profile: "barrel", bulge: [1.05, 1.15, 1.2, 1.1, 0.95] },
    head: { billProfile: "shear", neck: 0.12, neckPitch: 12, neckGirth: 1.05, size: 0.95, shape: "wide", snout: "beak", snoutLength: 0.8, eyePlace: "side", eyeSize: 0.8, lids: 0.4, brow: 0.8, crest: "horns", crestSize: 1.5 },
    limbs: [{ kind: "leg", pairs: 2, from: 0.16, to: 0.84, style: "pillar", splay: 8, end: "pad", girth: 1.2, muscle: 1 }],
    tail: { kind: "club", length: 0.7, girth: 1.1, lift: 6 },
    back: { kind: "plates", count: 9, height: 0.13 },
    details: ["frill", "shoulder spikes", "belly plates"],
    skin: { base: "#6f6a4a", accent: "#b5482f", pale: "#e9dfc0", eye: "#c9892f", belly: 0.6, socks: 0.5, markings: marks("Spots", "#4a4630", 0.12, 0.34, 31) },
  },
  "Long-necked wader": {
    spine: { length: 0.7, girth: 0.17, rear: 6, front: 26, arch: 6, stance: 0.95, profile: "pear", bulge: [1, 1.15, 1.1, 0.95, 0.8] },
    head: { billProfile: "spear", neck: 0.62, neckPitch: 66, neckGirth: 0.55, size: 0.8, shape: "long", snout: "bill", snoutLength: 1.7, eyePlace: "side", eyeSize: 1.1, lids: 0.2, brow: 0.3, crest: "crown", crestSize: 0.9 },
    limbs: [
      { kind: "leg", pairs: 1, from: 0.36, style: "bird", splay: 4, end: "paddle", girth: 0.62, muscle: 1.4 },
      { kind: "wing", pairs: 1, from: 0.7, length: 0.5, rise: -58, sweep: 50, chord: 0.22, structure: "feather", ribs: 7, bend: 0.85, notch: 0.2, point: 0.2, seed: 5 },
    ],
    tail: { kind: "fluke", length: 0.26, lift: 10 },
    back: { kind: "none" },
    details: ["dewlap"],
    skin: { coat: { family: "plumage", graded: true, contrast: .80, density: .92, seed: 194 }, base: "#c96f5a", accent: "#f4d06a", pale: "#f6ece0", eye: "#f4d06a", belly: 0.9, socks: 0.85, markings: null },
  },
  "Court envoy": {
    anatomyRevision: 2,
    family: "envoy",
    spine: { length: 0.7, girth: 0.22, flat: 1.25, rear: 84, front: 87, arch: 3, stance: 0.74, profile: "pear", bulge: [1.02, 0.84, 0.96, 1.16, 1.02] },
    head: { neck: 0.12, neckPitch: 80, size: 1.6, shape: "wide", snout: "muzzle", snoutLength: 0.7, jaw: 0.16, teeth: 1, brow: 0.45, lids: 0.38, eyes: 2, eyeSize: 1.55, eyePlace: "front", crest: "ears", crestSize: 1.3, turn: 18 },
    limbs: [
      { kind: "leg", pairs: 1, from: 0.04, style: "mammal", splay: 6, end: "paw", digits: 3, girth: 1.3, muscle: 1.2 },
      { kind: "arm", pairs: 1, from: 0.82, length: 0.62, drop: 62, forward: 24, elbow: 42, end: "hand", digits: 3, hand: 0.9, muscle: 1.1, raise: 52 },
    ],
    tail: { kind: "taper", length: 0.5, girth: 1.05, lift: -28, sway: 30 },
    back: { kind: "none" },
    details: ["frill"],
    skin: { faceMarking: "Facial disc", base: "#2f8f8a", accent: "#f08a5d", pale: "#eaf3df", eye: "#f6c453", belly: 0.85, socks: 0.4, limbFade: true, markings: marks("Spots", "#1d5f66", 0.1, 0.34, 12) },
    dress: { kind: "herald", cut: 2, device: "swallow", color: "#b3202e", trim: "#f0c24f", layers: 3, size: 1.05, seed: 7 },
  },
  "Harbour warden": {
    anatomyRevision: 2,
    family: "stalker",
    spine: { length: 0.86, girth: 0.24, rear: 12, front: 38, arch: 4, stance: 0.84, profile: "pear", bulge: [1.1, 1.14, 1.04, 0.96, 0.86] },
    head: { neck: 0.26, neckPitch: 50, neckGirth: 0.98, size: 1.5, shape: "long", snout: "muzzle", snoutLength: 1.3, jaw: 0.34, teeth: 5, brow: 0.8, lids: 0.28, eyes: 2, eyePlace: "side", eyeSize: 1.15, crest: "none", turn: -20 },
    limbs: [
      { kind: "leg", pairs: 1, from: 0.3, style: "bird", splay: 6, end: "talons", digits: 3, girth: 1.3, muscle: 1.35 },
      { kind: "arm", pairs: 1, from: 0.82, length: 0.36, drop: 48, forward: 44, elbow: 64, end: "hand", digits: 3, girth: 0.66, hand: 0.9, raise: -18 },
    ],
    tail: { kind: "taper", length: 0.9, girth: 1.25, lift: 8, sway: -32 },
    back: { kind: "none" },
    details: ["spurs"],
    skin: { base: "#c8622f", accent: "#3ec1c9", pale: "#f3e2c2", eye: "#f7d154", belly: 0.9, socks: 0.6, limbFade: true, markings: marks("Bands", "#5a2416", 0.2, 0.42, 21, 12) },
    dress: { kind: "warden", cut: 2, device: "tide", color: "#27408b", trim: "#e8ecf2", layers: 3, size: 1.05, seed: 3 },
  },
  "Dune nomad": {
    anatomyRevision: 2,
    family: "grazer",
    spine: { length: 0.98, girth: 0.25, flat: 1, rear: 2, front: 12, arch: 6, stance: 0.86, profile: "barrel", bulge: [1.1, 1, 1.05, 1.18, 1] },
    head: { neck: 0.72, neckPitch: 66, neckGirth: 0.8, size: 1.3, shape: "long", snout: "muzzle", snoutLength: 1.05, jaw: 0.05, eyes: 2, eyePlace: "side", eyeSize: 1.45, lids: 0.35, brow: 0.2, crest: "horns", crestSize: 1.5, turn: 24 },
    limbs: [{ kind: "leg", pairs: 2, from: 0.14, to: 0.86, style: "bird", splay: 5, end: "hoof", muscle: 1.15, girth: 0.9 }],
    tail: { kind: "taper", length: 0.5, lift: -22, girth: 0.7, sway: 34 },
    back: { kind: "none" },
    details: ["tail tuft", "dewlap"],
    skin: { faceMarking: "Forehead blaze", base: "#d9b36a", accent: "#c2452d", pale: "#fbf1d8", eye: "#3b2a1e", belly: 0.9, socks: 0.55, limbFade: true, markings: marks("Rosettes", "#9a6b2c", 0.2, 0.42, 5) },
    dress: { kind: "nomad", cut: 2, device: "sunburst", color: "#128a98", trim: "#f6ecd0", layers: 3, size: 1.1, seed: 11 },
  },
  "Moss sage": {
    anatomyRevision: 2,
    family: "hopper",
    spine: { length: 0.52, girth: 0.28, flat: 1.05, rear: 80, front: 86, arch: 3, stance: 0.46, profile: "pear", bulge: [1.05, 1.1, 1.05, 0.95, 0.9] },
    head: { billProfile: "crusher", neck: 0.06, neckPitch: 74, size: 1.65, shape: "round", snout: "beak", snoutLength: 0.6, eyes: 2, eyePlace: "front", eyeSize: 2.05, lids: 0.42, brow: 0.3, crest: "ears", crestSize: 1.4, whiskers: true, turn: -16 },
    limbs: [
      { kind: "leg", pairs: 1, from: 0.1, style: "bird", splay: 9, end: "talons", digits: 3, girth: 1.05, muscle: 1.2 },
      { kind: "arm", pairs: 1, from: 0.8, length: 0.3, drop: 56, forward: 36, elbow: 58, end: "hand", digits: 3, girth: 0.62, hand: 1.05, raise: 34 },
    ],
    tail: { kind: "stub", length: 0.3, lift: 10 },
    back: { kind: "none" },
    details: [],
    skin: { coat: { family: "pelt", graded: true, contrast: .80, density: .92, seed: 186 }, base: "#7d9a45", accent: "#e3572f", pale: "#f2efcf", eye: "#f7c531", belly: 0.9, socks: 0, markings: marks("Marbled", "#4f6a2a", 0.18, 0.4, 9) },
    dress: { kind: "sage", cut: 2, device: "oak", color: "#6a3aa2", trim: "#f3d36b", layers: 3, size: 1, seed: 5 },
  },
  "Signal ranger": {
    anatomyRevision: 2,
    family: "envoy",
    spine: { length: 0.78, girth: 0.21, flat: 1.2, rear: 84, front: 86, arch: 3, stance: 0.82, profile: "tube", bulge: [1.02, 0.8, 0.96, 1.16, 1.02] },
    head: { neck: 0.14, neckPitch: 80, size: 1.5, shape: "round", snout: "mandibles", eyes: 4, eyeSize: 1.35, eyePlace: "front", lids: 0.2, brow: 0.3, crest: "antennae", crestSize: 1.3, turn: 22 },
    limbs: [
      { kind: "leg", pairs: 1, from: 0.04, style: "bird", splay: 6, end: "talons", digits: 3, girth: 1.25, muscle: 1.25 },
      { kind: "arm", pairs: 2, from: 0.56, to: 0.9, length: 0.62, drop: 60, forward: 26, elbow: 46, end: "hand", digits: 3, hand: 0.88, muscle: 1.2, raise: -44 },
    ],
    tail: { kind: "taper", length: 0.5, girth: 1, lift: -30, sway: -26 },
    back: { kind: "none" },
    details: [],
    skin: { faceMarking: "Cheek flashes", base: "#2c3566", accent: "#ff8a2a", pale: "#dfe3f2", eye: "#7ef0c2", belly: 0.7, socks: 0.5, limbFade: true, markings: marks("Spots", "#ff8a2a", 0.09, 0.24, 17) },
    dress: { kind: "ranger", cut: 2, device: "compass", color: "#f0a020", trim: "#fff1c9", layers: 3, size: 1, seed: 2 },
  },
};

export function randomCreaturePlan(seed = 1) {
  const drawn = drawFamily(seed);
  let plan;
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
        pattern: wingPatterns[[0, 0, 0, 1, 1, 2, 2, 3][Math.floor(drawn.draw() * 8)]],
        seed: Math.floor(drawn.draw() * 4294967296),
      });
    });
  } else {
    plan = freeCreaturePlan(seed);
    delete plan.equipment;
    plan.skin = readCreaturePlan({ skin: drawn.skin }).skin;
    if (plan.head.count === 1 && drawn.draw() < 0.8) plan.head.turn = Math.round(lerp(-28, 28, drawn.draw()));
  }
  plan.family = drawn.family;
  plan.head.size = Math.max(plan.head.size, Math.min(1.7, (0.2 * plan.spine.length) / plan.spine.girth));
  plan.head.eyeSize = Math.max(plan.head.eyeSize, 1);
  for (const leg of plan.limbs) {
    if (leg.kind !== "leg" || leg.pairs < 2 || leg.fan > 100 || plan.spine.rear > 60) continue;
    const across = 2 * plan.spine.girth * (leg.style === "pillar" ? 0.62 : leg.style === "insect" ? 0.34 : 0.46);
    const room = () => (Math.abs(leg.to - leg.from) * plan.spine.length) / (leg.pairs - 1) / (2.2 * across);
    leg.girth = clamp(Math.min(leg.girth, room()), Math.min(0.7, leg.girth), 3);
    while (leg.pairs > 2 && room() < leg.girth) leg.pairs--;
  }
  if (plan.skin.socks > 0) plan.skin.limbFade = true;
  if (drawn.plan && randomStream(seed ^ 0x37c665ad)() < .76)
    plan.skin = drawCreatureCoat(plan, seed);
  const dress = drawDress(plan, seed, drawn.dressOdds);
  if (dress) plan.dress = dress;
  const flankDraw = randomStream(seed ^ 0xc7e41d29);
  if (!dress && plan.back.kind !== "spiral shell" && flankDraw() < .62) {
    const choices = plan.family === "swimmer" || plan.family === "drifter"
      ? ["Lateral stripe", "Flank ocelli"]
      : plan.family === "grazer" || plan.family === "tank"
        ? ["Saddle", "Lateral stripe"]
        : flankMarkings.slice(1);
    plan.skin.flankMarking = choices[Math.floor(flankDraw() * choices.length)];
  }
  const carried = drawCreatureEquipment(plan, seed);
  if (carried && drawn.draw() < (dress ? 0.35 : drawn.kitOdds) * (growthFamilies.includes(plan.back.kind) ? 0.4 : 1)) {
    plan.equipment = carried;
    if (dress) {
      const busyBack = plan.back.kind !== "none" && plan.limbs.some(limb =>
        limb.kind === "leg" && limb.style === "insect" && limb.pairs >= 3);
      plan.dress = { ...dress, layers: busyBack ? 1 : dress.layers, clear: carried.station };
    }
  }
  return readCreaturePlan(plan);
}

export function freeCreaturePlan(seed = 1) {
  const draw = randomStream(seed),
    between = (a, b) => a + (b - a) * draw(),
    integer = (a, b) => Math.floor(between(a, b + 1)),
    choose = (items) => items[Math.floor(draw() * items.length)],
    chance = (p) => draw() < p;
  const hue = (h, s, l) => {
    const f = (n) => {
      const q = (n + h / 30) % 12;
      return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(q - 3, 9 - q, 1));
    };
    return "#" + [0, 8, 4].map((n) => Math.round(f(n) * 255).toString(16).padStart(2, "0")).join("");
  };
  const posture = choose(["level", "level", "level", "lifted", "raised", "upright", "upright", "serpent"]);
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
        ? { kind: "leg", pairs: integer(3, 5), from: 0, to: 0.14, style: "insect", splay: between(30, 48), fan: between(120, 180), end: choose(["point", "pad"]) }
        : { kind: "leg", pairs: 1, from: 0.04, style: choose(["mammal", "bird", "pillar"]), splay: between(2, 10), end: legEnd(), girth: between(1, 1.4) },
    );
    if (radial) spine.stance = between(0.26, 0.45);
  } else if (posture === "raised") {
    spine.length = between(1, 1.5);
    limbs.push({ kind: "leg", pairs: integer(2, 3), from: 0.06, to: 0.48, style: choose(["insect", "mammal", "bird"]), splay: between(8, 44), fan: between(0, 50), end: legEnd() });
  } else if (posture === "lifted")
    limbs.push({ kind: "leg", pairs: 1, from: 0.3, style: choose(["bird", "mammal"]), splay: between(3, 10), end: choose(["talons", "paw", "hoof"]), girth: between(1, 1.3) });
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
    limbs.push({ kind: "wing", pairs: 1, from: between(0.55, 0.75), length: between(0.6, 1.3) * spine.length, rise: between(5, 40), sweep: between(5, 35), chord: between(0.2, 0.45) });
  const wingAt = limbs.findIndex((l) => l.kind === "wing");
  if (posture === "serpent" || chance(0.12))
    limbs.push({ kind: "fin", pairs: integer(1, 2), from: 0.3, to: 0.72, length: between(0.2, 0.42), sweep: between(20, 55), chord: between(0.1, 0.24) });
  if (chance(0.12))
    limbs.push({ kind: "tentacle", pairs: integer(1, 2), from: 0.6, to: 0.85, length: between(0.4, 0.8), droop: between(20, 70), forward: between(0, 50) });
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
      kind: posture === "serpent" ? choose(["taper", "fan", "fluke"]) : choose(creatureOptions.tail),
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
    span = (a, b) => a + (b - a) * own();
  const structure = suggestWingStructure(plan, own());
  const [least, most] = wingCounts[structure];
  plan.limbs[wingAt] = readLimb({
    ...plan.limbs[wingAt],
    structure,
    ribs: Math.floor(span(least, most + 1)),
    bend: span(0.25, 0.8),
    notch: span(0.15, 0.85),
    point: span(0, 1),
    pattern: wingPatterns[[0, 0, 0, 1, 1, 2, 2, 3][Math.floor(own() * 8)]],
    seed: Math.floor(own() * 4294967296),
  });
  return outfitDraw(plan, seed);
}

export function drawCreatureDress(plan, seed) {
  return drawDress(readCreaturePlan(plan), seed, 1);
}

export function drawCreatureEquipment(plan, seed) {
  const candidate = drawEquipment(plan, seed);
  if (!candidate) return null;
  const bare = {...plan};
  delete bare.equipment;
  const base = buildCreature(bare);
  if (base.parts.length + equipmentRegionCount(candidate) > 128) return null;
  return fitDrawnEquipment(plan,candidate,base,spineFrame(plan));
}

function outfitDraw(plan, seed) {
  if(plan.skin.socks>0)plan.skin.limbFade=true;
  const equipment=drawCreatureEquipment(plan,seed);
  if (equipment) plan.equipment=equipment;
  return plan;
}

export function suggestWingStructure(plan, draw = 0) {
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
  return draw < odds[0] ? "bat" : draw < odds[1] ? "feather" : "insect";
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const paint = ["color", "surface", "markings", "skinTint", "paint"];

export function rebuildCreature(form, raw) {
  if (!form?.origin?.plan) return buildCreature(raw);
  let base = buildCreature(form.origin.plan);
  const unavailableHands = new Set();
  if (raw?.equipment?.handling === "offer" || form.origin.plan.equipment?.handling === "offer") {
    for (const p of base.parts.filter(p=>p.shape==="hand")) {
      const kept=form.parts.find(q=>q.id===p.id);
      if (!kept || kept.shape!=="hand" || kept.grip?.fingers<2) unavailableHands.add(p.id);
    }
    if (unavailableHands.size && form.origin.plan.equipment?.handling === "offer")
      base = constructCreature(form.origin.plan,unavailableHands);
  }
  const next = constructCreature(raw,unavailableHands);
  const was = new Map(base.parts.map((p) => [p.id, p])),
    now = new Map(form.parts.map((p) => [p.id, p]));
  const parts = [];
  for (const part of next.parts) {
    const old = was.get(part.id),
      mine = now.get(part.id);
    if (old && !mine) continue;
    if (!old || !mine) parts.push(part);
    else if (same(old, part)) parts.push(mine);
    else {
      const kept = { ...part };
      for (const key of paint)
        if (!same(old[key], mine[key])) {
          if (mine[key] === undefined) delete kept[key];
          else kept[key] = mine[key];
        }
      parts.push(kept);
    }
  }
  const ids = new Set(parts.map((p) => p.id));
  for (let i = 0; i < parts.length; i++)
    if (parts[i].parent != null && !ids.has(parts[i].parent)) {
      ids.delete(parts[i].id);
      parts.splice(i, 1);
      i = -1;
    }
  let added = true;
  while (added) {
    added = false;
    for (const part of form.parts)
      if (
        !was.has(part.id) &&
        !ids.has(part.id) &&
        (part.parent == null || ids.has(part.parent))
      ) {
        parts.push(part);
        ids.add(part.id);
        added = true;
      }
  }
  if (parts.length > 128)
    throw new Error("This body plan needs more than 128 regions.");
  const result = { ...form };
  for (const key of new Set([...Object.keys(base), ...Object.keys(next)]))
    if (key !== "parts" && key !== "poses" && !same(base[key], next[key])) {
      if (next[key] === undefined) delete result[key];
      else result[key] = next[key];
    }
  result.parts = parts;
  result.origin = next.origin;
  const mergedPoses=mergeDispatchPoses(base,form,next);
  if (mergedPoses) result.poses=mergedPoses;
  else delete result.poses;
  if (result.poses) {
    const poses = result.poses
      .map((pose) => ({
        ...pose,
        joints: pose.joints.filter((j) => j.part === "" || ids.has(j.part)),
      }))
      .filter((pose) => pose.joints.length);
    if (poses.length) result.poses = poses;
    else delete result.poses;
  }
  return refitPlanShingles(base, form, next, result);
}

export function steerCreaturePlan(current, change = {}) {
  if (!change || typeof change !== "object" || Array.isArray(change))
    throw new Error("Describe the body plan change as an object.");
  const plan = structuredClone(readCreaturePlan(current));
  for (const key of ["spine", "head", "tail", "back"])
    if (change[key] && typeof change[key] === "object")
      Object.assign(plan[key], change[key]);
  if (change.skin && typeof change.skin === "object") {
    const { markings, coat, ...rest } = change.skin;
    if(coat===null) delete plan.skin.coat;
    else if(coat) plan.skin.coat={...plan.skin.coat,...coat};
    Object.assign(plan.skin, rest);
    if (markings === null) plan.skin.markings = null;
    else if (markings && typeof markings === "object")
      plan.skin.markings = { ...(plan.skin.markings ?? {}), ...markings };
  }
  if (change.dress === null) delete plan.dress;
  else if (change.dress && typeof change.dress === "object")
    plan.dress = readDress({ ...plan.dress, ...change.dress });
  if (typeof change.family === "string") plan.family = change.family;
  if (change.equipment === null) delete plan.equipment;
  else if (change.equipment && typeof change.equipment === "object")
    plan.equipment = readEquipment({...plan.equipment,...change.equipment});
  if (change.anatomyRevision === 2) plan.anatomyRevision = 2;
  if (change.scale !== undefined) plan.scale = change.scale;
  if (Array.isArray(change.details)) plan.details = change.details;
  if (Array.isArray(change.limbs)) plan.limbs = structuredClone(change.limbs);
  else {
    for (const { index, ...set } of change.setLimbs ?? []) {
      if (!plan.limbs[index])
        throw new Error("There is no limb group " + index + ".");
      const restructured =
        set.structure !== undefined &&
        set.structure !== plan.limbs[index].structure &&
        set.ribs === undefined;
      plan.limbs[index] =
        set.kind && set.kind !== plan.limbs[index].kind
          ? {
              pairs: plan.limbs[index].pairs,
              side: plan.limbs[index].side,
              from: plan.limbs[index].from,
              to: plan.limbs[index].to,
              ...set,
            }
          : { ...plan.limbs[index], ...set };
      if (restructured) delete plan.limbs[index].ribs;
    }
    const gone = new Set(change.removeLimbs ?? []);
    plan.limbs = plan.limbs.filter((_, i) => !gone.has(i));
    plan.limbs.push(...structuredClone(change.addLimbs ?? []));
  }
  if (plan.limbs.length > 8)
    throw new Error("A body plan holds at most 8 limb groups.");
  return readCreaturePlan(plan);
}

export const creaturePlanInstructions =
  'A creature is built from a body plan: one spine with a free posture and up to 8 limb groups along it. Every limb has real joints, so the result walks, swims or flies, can be posed and exports with its clips. Start a new creature with {op:"buildCreature",preset?,plan?}. A preset is a starting plan and plan changes it. Change the current plan creature with {op:"steerCreature",set}. Both take the same partial plan: spine, head, tail, back and skin merge field by field, scale and details replace their value, limbs replaces every limb group, and setLimbs:[{index,...fields}], removeLimbs:[index] and addLimbs:[group] edit groups in place (indices before the change). steerCreature keeps hand sculpting and added regions on everything the change leaves alone, so prefer it to setPart for anatomy. Stations run along the spine from 0 at the hips to 1 at the chest. Angles are degrees. spine: length and girth in metres before scale, flat (width to depth), rear and front (tilt of each end above horizontal: 0 and 8 is a level quadruped, 0 and 80 a raised forebody, 85 and 88 upright), arch, profile, stance (height of the hips; a legless body with fins, wings or tentacles floats there and any other legless body rests on the ground), bulge (five girth multipliers from hips to shoulders). A limb group: kind, pairs 1-6, side, from and to (stations of its first and last pair), girth, muscle. Legs add style (mammal: knee forward; bird: a third long foot bone; insect: knee above the hip, set splay 35-60; pillar: a column), splay (degrees out from vertical), fan (degrees the feet spread around the body, up to 240 for a radial stance), end and digits. Ordinary random draws use anatomyRevision:2. This uses the existing end and digit controls for a cloven hoof, spread toes, padded digits, webbed foot or tarsal hooks. Set anatomyRevision:2 to give an older plan these feet and the shaped cranium and mouth. Legs always reach the ground. Set sockets:true on insect legs to grow fitted shields at the trunk. Arms add length, drop (0 straight out, 90 hanging), forward, elbow, end, digits and hand. Wings add length, rise, sweep, chord and structure: plain is one smooth blade, bat is skin stretched between an arm and long fingers, feather is overlapping flight feathers and rows of coverts on a folded arm, and insect is a pleated film on branching veins. A bat, feather or insect wing also takes ribs (2-5 fingers, 4-12 primary feathers or 3-8 main veins), bend (0-1, how far the arm folds at the elbow and wrist), notch (0-1: the scallops between fingers, the slots between primary tips or the bays between veins), point (0 a broad round tip, 1 a narrow pointed one), pattern (none, tips, bars or eyespot) and seed (an unsigned integer that varies feathers and veins). Give a new wing the structure its animal would grow. Fins add length, sweep, chord. Tentacles add length, droop, forward, fan (degrees the pairs turn around the body; 180*(pairs-1)/pairs makes an even ring of arms at one station) and curl (-1 to 1, how far the tip hooks back up). head: count 0-3, neck, neckPitch, neckGirth, size, shape, snout, snoutLength, jaw (gape 0-1) and teeth (per side, muzzle only), nostrils, eyes 0-8, eyeSize, eyePlace, stalks, lids, brow, crest, crestSize, whiskers, ear (original, lance, swept, tufted, fan or lop on an ear crest), muzzleProfile (original, feline, canine, grazing or rooting on a muzzle), billProfile (original, spear, spoon, crusher, shear or scythe on a beak or bill), turn (degrees the resting head looks to its left, -50 to 50). tail: kind, length, girth, lift, sway (degrees the resting tail curls to one side). An arm group also takes raise (-80 to 80: the left hand lifts in a resting gesture while the right relaxes, or the reverse below zero). dress: optional {kind,color,trim,layers,size,seed,device} of worn layers fitted to the anatomy: herald (scalloped collar, pauldrons, sash and tabard), warden (metal gorget, cuirass, guards, greaves and helm), sage (cloak or stole, collar, medallion and circlet), nomad (saddle cloth or poncho, straps and leg wraps) or ranger (bandolier, belt, loincloth, bracers and plume). device embroiders a swallow, oak, tide, compass or sunburst on the cloth; color is the cloth and trim the metal or border; layers 1 keeps the signature pieces, 2 adds limb pieces and 3 adds headwear. Each piece is an ordinary region. Set dress to null to undress. back: kind, count, height. A spiral shell grows a coiled whorl, flared lip and growth ribs. Shingles grow overlapping keratin plates; gill fans grow paired feathered respiratory branches; drum sacs grow paired resonators with a recessed opening; a shag mantle grows rooted, trailing locks of insulating fibres. Contour plumage grows overlapping, quilled vanes along the back and flanks; count sets their rows and spread sets their wrap. For these families, spread (0-1) controls coverage around the trunk and seed varies the growth. Count sets shingle or pelt rows, or organ pairs. equipment: optional {kind,station,hang,size,side,mount,color,seed,handling}. Courier handling "offer" moves the original dispatch tube into an available hand with a thumb and two fingers, creates editable Present dispatch and animated Offer dispatch. Set "packed" to stow it. Creatures without a grasp carry the tube in their pack. A high pack can face the flank or back. Hang -1.42 to 0.85 wraps the load from high on the back down the flank. Choose none, courier satchel, trader panniers or survey kit. Station 0.14-0.85 runs from hips to shoulders; size 0.55-1.45 scales the load; side left or right carries its main bag. Adjust fields with steerCreature. Setting equipment to null removes it. details: any of the listed extras. skin.faceMarking applies Eye stripe, Facial disc, Cheek flashes or Forehead blaze around the skull in its own hide colours. Use None to remove it. skin.flankMarking places a Lateral stripe, Saddle or Flank ocelli on the torso in its accent and pale colours. Use None to remove it. skin.limbFade toggles continuous ankle and wrist colour on a dark-tipped limb. skin.coat takes family (plumage, pelt, scutes or wet skin), contrast 0-1, density .55-1.8, optional graded dorsal and throat colours, and unsigned seed. Set coat to null for plain hide. skin: base, accent, pale and eye colours, surface, belly (pale underside 0-1), socks (dark limb ends 0-1), blend, and markings or null. Give the animal a way of living and let each choice follow from it: what it eats decides the mouth, how it moves decides the legs and tail, and what hunts it decides armour, colour and eye position.';
