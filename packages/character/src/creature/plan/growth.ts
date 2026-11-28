import { Color, MathUtils, Vector3 } from "three";
import { plumageMantle } from "./plumage.js";
import { growPlates } from "./plates.js";
import { randomStream } from "../../random.js";
import { need } from "./need.js";
import type { Cage, Form, FormPart, Plan, Spine, SpineStation } from "./types.js";

export const growthFamilies: readonly string[] = [
  "shingles",
  "gill fans",
  "drum sacs",
  "shag mantle",
  "spiral shell",
  "contour plumage",
];
const { clamp, lerp } = MathUtils;
const tint = (a: string, b: string, mix: number) =>
  "#" + new Color(a).lerp(new Color(b), mix).getHexString();

export function drawBackGrowth(plan: Plan, seed: number): Plan["back"] {
  const draw = randomStream((seed ^ 0x37bd8113) >>> 0);
  const roll = draw();
  const legs = plan.limbs.filter((l) => l.kind === "leg");
  const swimmer = plan.limbs.some((l) => l.kind === "fin");
  const walker = legs.some((l) => l.kind === "leg" && l.pairs >= 2);
  const winged = plan.limbs.some((l) => l.kind === "wing");
  let kind: Plan["back"]["kind"] | undefined;
  if (swimmer && roll < (legs.length ? 0.58 : 0.92)) kind = "gill fans";
  else if (walker && roll < (winged ? 0.42 : 0.78)) kind = "shingles";
  else if (legs.length && !winged && roll > 0.44 && roll < 0.88) kind = "drum sacs";
  else if (
    !winged &&
    !swimmer &&
    legs.some((l) => l.kind === "leg" && l.style !== "insect") &&
    roll > 0.78
  )
    kind = "shag mantle";
  if (!kind) return plan.back;
  const range = (a: number, b: number) => lerp(a, b, draw());
  const count =
    kind === "shingles"
      ? 4 + Math.floor(draw() * 4)
      : kind === "gill fans"
        ? 2 + Math.floor(draw() * 3)
        : kind === "shag mantle"
          ? 3 + Math.floor(draw() * 3)
          : 1 + Math.floor(draw() * 2);
  return {
    kind,
    count,
    height: range(0.65, 1.18) * plan.spine.girth,
    spread: range(0.48, 0.96),
    seed: Math.floor(draw() * 4294967296),
  };
}

type Branch = (row: number, edge: number, corners: Vector3[]) => Vector3[][] | undefined;
function ringCage(rings: Vector3[][], growBranch?: Branch): Cage {
  const sides = need(rings[0]).length;
  const vertices = rings.flat();
  const face = (row: number, side: number) => row * sides + (side % sides);
  const cap = (ids: number[]): number[][] =>
    ids.length <= 8
      ? [ids]
      : [ids.slice(0, ids.length / 2 + 1), [need(ids[0]), ...ids.slice(ids.length / 2)]];
  const faces = cap(Array.from({ length: sides }, (_, i) => sides - i - 1));
  for (let row = 0; row < rings.length - 1; row++) {
    for (let i = 0; i < sides; i++) {
      let root = [face(row, i), face(row, i + 1), face(row + 1, i + 1), face(row + 1, i)];
      const extensions = growBranch?.(
        row,
        i,
        root.map((index) => need(vertices[index])),
      );
      for (const next of extensions ?? []) {
        const tip = next.map((point) => vertices.push(point) - 1);
        for (let j = 0; j < root.length; j++) {
          const k = (j + 1) % root.length;
          faces.push([need(root[j]), need(root[k]), need(tip[k]), need(tip[j])]);
        }
        root = tip;
      }
      faces.push(root);
    }
  }
  faces.push(...cap(Array.from({ length: sides }, (_, i) => face(rings.length - 1, i))));
  const cross = new Vector3();
  let volume = 0;
  for (const polygon of faces) {
    const a = need(vertices[need(polygon[0])]);
    for (let i = 1; i < polygon.length - 1; i++)
      volume += a.dot(
        cross.crossVectors(need(vertices[need(polygon[i])]), need(vertices[need(polygon[i + 1])])),
      );
  }
  if (volume < 0) for (const polygon of faces) polygon.reverse();
  return { vertices: vertices.map((v) => v.toArray()), faces, levels: 1 };
}

function gillCage(
  frame: SpineStation,
  outward: Vector3,
  side: number,
  length: number,
  width: number,
  lobes: number,
  sweep: number,
  phase: number,
): Cage {
  const branch = outward
    .clone()
    .multiplyScalar(0.82)
    .addScaledVector(frame.dorsal, 0.45)
    .normalize();
  const back = frame.tangent.clone().negate();
  const cross = new Vector3().crossVectors(branch, back).normalize();
  const vane = back
    .clone()
    .addScaledVector(cross, side * 0.67)
    .normalize();
  const thick = new Vector3().crossVectors(branch, vane).normalize();
  const count = 2 * lobes + 3;
  const rings = Array.from({ length: count }, (_, row) => {
    const t = row / (count - 1);
    const centre = branch
      .clone()
      .multiplyScalar(length * t)
      .addScaledVector(back, length * (sweep + 0.22) * t ** 1.8)
      .addScaledVector(cross, side * length * 0.095 * Math.sin(Math.PI * t + phase) * t);
    const radius = length * (0.006 + 0.044 * (1 - t));
    return [
      [1, 1],
      [1, -1],
      [-1, -1],
      [-1, 1],
    ].map(([a = 0, b = 0]) =>
      centre
        .clone()
        .addScaledVector(vane, a * radius)
        .addScaledVector(thick, b * radius * 0.72),
    );
  });
  return ringCage(rings, (row, edge, corners) => {
    const left = edge === 0 && row % 2 === 0;
    const right = edge === 2 && row % 2 === 1;
    if ((!left && !right) || row < 1 || row > count - 3) return;
    const t = (row + 0.5) / (count - 1);
    const axis = left ? 1 : -1;
    const spread = width * (0.32 + 0.68 * Math.sin(Math.PI * t) ** 0.75);
    const centre = new Vector3();
    for (const v of corners) centre.add(v);
    centre.multiplyScalar(0.25);
    const chord = vane
      .clone()
      .multiplyScalar(axis * spread)
      .addScaledVector(branch, length * (0.095 + 0.09 * t));
    const bend = thick.clone().multiplyScalar(side * axis * length * 0.05);
    return [
      [0.32, 0.94],
      [0.72, 0.58],
      [1, 0.18],
    ].map(([u = 0, r = 0]) => {
      const mid = centre
        .clone()
        .addScaledVector(chord, u)
        .addScaledVector(bend, Math.sin(u * Math.PI * 0.87))
        .addScaledVector(branch, length * 0.075 * u ** 2);
      return corners.map((v) => mid.clone().addScaledVector(v.clone().sub(centre), r));
    });
  });
}

function sacCage(
  frame: SpineStation,
  outward: Vector3,
  size: number,
  width: number,
  height: number,
  phase: number,
) {
  const vertical = new Vector3().crossVectors(outward, frame.tangent).normalize();
  const stations = [
    [0, 0.62],
    [0.08, 0.91],
    [0.23, 1],
    [0.57, 0.92],
    [0.84, 0.72],
    [0.95, 0.51],
    [0.86, 0.4],
    [0.58, 0.3],
    [0.49, 0.12],
  ];
  const offset = (d: number) =>
    outward
      .clone()
      .multiplyScalar(size * d)
      .addScaledVector(frame.tangent, -width * 0.36 * d);
  const ring = (d: number, r: number, angle: number) => {
    const fold = 1 + 0.085 * Math.cos(angle * 4 + phase);
    return offset(d)
      .addScaledVector(frame.tangent, width * r * Math.cos(angle) * fold)
      .addScaledVector(vertical, height * r * Math.sin(angle));
  };
  const cage = ringCage(
    stations.map(([d = 0, r = 0]) =>
      Array.from({ length: 12 }, (_, i) => ring(d, r, (i * Math.PI) / 6)),
    ),
  );
  const membrane = ringCage(
    [
      [0.56, 0.29],
      [0.62, 0.335],
      [0.65, 0.27],
      [0.58, 0.13],
    ].map(([d = 0, r = 0]) => Array.from({ length: 8 }, (_, i) => ring(d, r, (i * Math.PI) / 4))),
  );
  return { cage, membrane };
}

function shagMantle(
  form: Form,
  plan: Plan,
  spine: Spine,
  carrier: FormPart,
  available: number,
): Form {
  const { back, skin } = plan;
  const rows = Math.min(back.count, Math.floor((available - 1) / 3));
  if (rows < 1) throw new Error("An insulating mantle needs four free regions.");
  const spread = back.spread ?? 0;
  const across = spread > 0.54 && available > 5 * rows ? 5 : 3;
  const draw = randomStream(back.seed ?? 0);
  const base = new Vector3().fromArray(carrier.position);
  const stations = [0.09, 0.14, 0.23, 0.36, 0.5, 0.66, 0.81, 0.9, 0.96];
  const coat = stations.map((t, i) => {
    const frame = spine.at(t);
    const taper = Math.sin((i * Math.PI) / (stations.length - 1)) ** 0.41;
    const centre = frame.centre.clone().addScaledVector(frame.dorsal, frame.radius[1] * 0.46);
    const loft = Math.min(frame.radius[1] * 0.35, plan.back.height * plan.scale * 0.3);
    return {
      centre,
      radii: [
        frame.radius[0] * (0.61 + 0.44 * spread) * (0.28 + 0.72 * taper),
        (frame.radius[1] * 0.6 + loft) * (0.36 + 0.64 * taper),
      ],
    };
  });
  const pivot = need(coat[0]).centre;
  const undercoat: FormPart = {
    id: "ruff undercoat",
    parent: carrier.id,
    shape: "sweep",
    position: pivot.clone().sub(base).toArray(),
    rotation: [0, 0, 0],
    size: [1, 1, 1],
    frameSize: [1, 1, 1],
    knots: coat.map(({ centre, radii }) => [...centre.clone().sub(pivot).toArray(), ...radii]),
    color: tint(skin.base, skin.pale, 0.125),
    surface: "fur",
    motionRole: "rigid",
  };
  const parts = [...form.parts, undercoat];
  for (let row = 0; row < rows; row++) {
    const t = rows === 1 ? 0.75 : lerp(0.3, 0.89, row / (rows - 1));
    const span = 0.45 + spread * 1.07;
    for (let col = 0; col < across; col++) {
      const u = (col / (across - 1)) * 2 - 1;
      const angle = u * span;
      const frame = spine.at(clamp(t + Math.abs(u) * 0.04 + (draw() - 0.5) * 0.025, 0.1, 0.96));
      const side = new Vector3(1, 0, 0);
      const root = frame.centre
        .clone()
        .addScaledVector(side, frame.radius[0] * Math.sin(angle))
        .addScaledVector(frame.dorsal, frame.radius[1] * Math.cos(angle));
      const n = side
        .clone()
        .multiplyScalar(Math.sin(angle))
        .addScaledVector(frame.dorsal, Math.cos(angle));
      const length = back.height * plan.scale * (0.61 + 0.83 * t) * (1 - 0.16 * Math.abs(u));
      const width = Math.max(
        0.006,
        Math.min(
          (plan.spine.length * plan.scale * 0.44) / rows,
          ((frame.radius[0] * span) / (across - 1)) * 1.65,
        ),
      );
      const down = new Vector3(0, -1, 0);
      const knots = [
        [0, 0, 0, width * 0.8, width * 0.87],
        [0.24, 0.22, 0.07, width * 1.05, width * 0.78],
        [0.67, 0.32, 0.22, width * 0.93, width * 0.65],
        [1, 0.2, 0.6, width * 0.34, width * 0.36],
      ].map(([rear = 0, lift = 0, fall = 0, w = 0, d = 0]) => {
        const at = frame.tangent
          .clone()
          .multiplyScalar(-length * rear)
          .addScaledVector(n, length * lift)
          .addScaledVector(down, length * fall)
          .addScaledVector(side, length * u * rear * 0.26);
        return [...at.toArray(), Math.max(0.001, w), Math.max(0.001, d)];
      });
      parts.push({
        id: `ruff lock ${row + 1}.${col + 1}`,
        parent: undercoat.id,
        shape: "sweep",
        position: root.sub(pivot).toArray(),
        rotation: [0, 0, 0],
        frameSize: [1, 1, 1],
        size: [1, 1, 1],
        knots,
        color: tint(skin.base, skin.pale, 0.08 + 0.19 * t + 0.1 * draw()),
        surface: "plain",
        motionRole: "rigid",
        fibres: {
          count: 32 + Math.floor(12 * draw()),
          wave: 0.2 + 0.19 * draw(),
          fall: 0.09,
          grey: 0.08 + 0.14 * draw(),
          rooted: true,
          seed: Math.floor(draw() * 4294967296),
        },
      });
    }
  }
  return { ...form, parts };
}

function spiralShell(
  form: Form,
  plan: Plan,
  spine: Spine,
  carrier: FormPart,
  available: number,
): Form {
  if (available < 1) return form;
  const { back, skin, scale } = plan;
  const pelagic =
    plan.limbs.some((l) => l.kind === "tentacle") && !plan.limbs.some((l) => l.kind === "leg");
  const frame = spine.at(pelagic ? 0.55 : 0.44),
    across = new Vector3(1, 0, 0);
  const radius =
    Math.min(
      (pelagic ? 0.7 : 0.45) * plan.spine.length,
      0.89 * plan.spine.girth + 0.74 * back.height,
    ) * scale;
  const origin = frame.centre
    .clone()
    .addScaledVector(frame.dorsal, frame.radius[1] * 0.76 + radius * 0.43);
  const spread = back.spread ?? 0;
  const draw = randomStream(back.seed ?? 0),
    handed = draw() < 0.5 ? -1 : 1;
  const turns = 1.58 + 0.36 * spread + 0.2 * draw();
  const phase = (pelagic ? -1.79 : -0.99) + 0.22 * draw(),
    taper = Math.exp(-1.48 * turns);
  function point(t: number, a: number, flare = 1) {
    const s = taper ** (1 - t),
      theta = phase + 2 * Math.PI * turns * (t - 1);
    const rad = frame.tangent
      .clone()
      .multiplyScalar(Math.cos(theta))
      .addScaledVector(frame.dorsal, Math.sin(theta));
    const shoulder = 0.78 * Math.cos(a) + 0.045 * Math.cos(2 * a);
    return rad
      .multiplyScalar(s * (1 + flare * shoulder))
      .addScaledVector(
        across,
        handed * ((1 - s) * (0.64 + 0.31 * spread) + s * flare * 0.91 * Math.sin(a)),
      );
  }
  const ring = (t: number, flare = 1) =>
    Array.from({ length: 8 }, (_, i) => point(t, (i * Math.PI) / 4, flare));
  const rows = Array.from({ length: 20 }, (_, i) => ring(i / 19));
  rows.push(ring(1.009, 1.066), ring(1.017, 1.069), ring(1.017, 0.91), ring(0.961, 0.83));
  if (!pelagic) {
    const lowest = Math.min(...rows.flat().map((p) => p.dot(frame.dorsal)));
    const current = frame.radius[1] * 0.76 + radius * 0.43;
    origin.addScaledVector(
      frame.dorsal,
      Math.max(0, frame.radius[1] * 0.08 - radius * lowest - current),
    );
  }
  const shell = ringCage(rows);
  shell.levels = 2;
  return {
    ...form,
    parts: [
      ...form.parts,
      {
        id: "spiral shell",
        parent: carrier.id,
        shape: "cage",
        cage: shell,
        color: tint(skin.pale, "#e3b08b", 0.51),
        surface: "plain",
        motionRole: "rigid",
        shellFinish: { ribs: back.count, seed: back.seed ?? 0 },
        position: origin.clone().sub(new Vector3().fromArray(carrier.position)).toArray(),
        rotation: [0, 0, 0],
        size: [radius, radius, radius],
        frameSize: [radius, radius, radius],
      },
    ],
  };
}

export function applyBackGrowth(form: Form, plan: Plan, spine: Spine): Form {
  const back = plan.back;
  if (!growthFamilies.includes(back.kind)) return form;
  const carrier = need(form.parts.find((p) => p.id === "body"));
  const spread = back.spread ?? 0,
    seed = back.seed ?? 0;
  const available = 128 - form.parts.length;
  const spineLength = plan.spine.length * plan.scale;
  const reversed = carrier.motionRole === "axial spine";
  if (back.kind === "contour plumage") return plumageMantle(form, plan, spine, carrier, available);
  if (back.kind === "spiral shell") return spiralShell(form, plan, spine, carrier, available);
  if (back.kind === "shag mantle") return shagMantle(form, plan, spine, carrier, available);
  if (back.kind === "shingles") {
    const desiredRows = Math.max(2, back.count);
    const narrow = plan.scale * plan.spine.girth < 0.025;
    const columns =
      !narrow && spread > 0.76 && available >= desiredRows * 5
        ? 5
        : !narrow && available >= Math.max(2, Math.min(4, desiredRows)) * 3
          ? 3
          : 1;
    const rows = Math.min(desiredRows, Math.floor(available / columns));
    if (rows < 2) throw new Error("The back needs two free regions to grow shingles.");
    const axis = spine.at(0.5).dorsal;
    const height = back.height / plan.spine.girth;
    return growPlates(form, carrier, {
      seed,
      tipSeed: (seed ^ 0x6b85492f) >>> 0,
      rows,
      columns,
      face: axis.y > -axis.z ? "Top" : "Back",
      direction: reversed ? "last" : "first",
      start: 0.11,
      end: 0.89,
      wrap: 62 + 103 * spread,
      overlap: 0.62,
      crest: clamp(height * 0.79, 0, 1),
      rise: clamp(1.1 + height * 0.78, 0.5, 3),
      color: tint(plan.skin.base, plan.skin.pale, 0.34),
      mirrored: false,
    });
  }

  const gill = back.kind === "gill fans";
  const perPair = gill ? 2 : 4;
  const pairs = Math.min(back.count, Math.floor(available / perPair));
  if (!pairs) throw new Error(`The back needs ${perPair} free regions for paired organs.`);
  const base = new Vector3().fromArray(carrier.position);
  const parts = [...form.parts];
  const draw = randomStream(seed);
  for (let j = 0; j < pairs; j++) {
    const t = pairs === 1 ? 0.72 : lerp(gill ? 0.36 : 0.25, 0.82, j / (pairs - 1));
    const f = spine.at(t);
    const angle = gill ? lerp(0.68, 1.54, spread) : lerp(0.73, 1.48, spread);
    const span = 0.76 + 0.26 * Math.sin((Math.PI * (j + 1)) / (pairs + 1));
    const length =
      (gill
        ? back.height * plan.scale * 1.41
        : Math.min(back.height * plan.scale * 0.92, f.radius[0] * 0.98)) * span;
    const pitch = (spineLength * (gill ? 0.37 : 0.45)) / Math.max(1, pairs - 0.4);
    const width = Math.min(gill ? length * 0.6 : f.radius[0] * 1.14, pitch * (gill ? 0.66 : 0.9));
    const phase = draw() * 2 * Math.PI;
    const lobes = 4 + Math.floor(draw() * 2);
    const sweep = 0.15 + draw() * 0.35;
    for (const side of [-1, 1]) {
      const across = new Vector3(side, 0, 0);
      const root = f.centre
        .clone()
        .addScaledVector(across, f.radius[0] * Math.sin(angle) * 0.94)
        .addScaledVector(f.dorsal, f.radius[1] * Math.cos(angle) * 0.94);
      const normal = across
        .clone()
        .multiplyScalar(Math.sin(angle) / f.radius[0])
        .addScaledVector(f.dorsal, Math.cos(angle) / f.radius[1])
        .normalize();
      const tissue: { cage: Cage; membrane?: Cage } = gill
        ? {
            cage: gillCage(f, normal, side, length, width, lobes, sweep, phase),
          }
        : sacCage(
            f,
            normal,
            length * (0.83 + 0.15 * Math.cos(phase)),
            width,
            Math.min(f.radius[1] * 0.68, width * (0.62 + 0.13 * Math.sin(phase))),
            phase,
          );
      const id = (side > 0 ? "left " : "right ") + (gill ? "gill fan " : "drum sac ") + (j + 1);
      const pigment = gill
        ? tint(plan.skin.accent, "#bc655a", 0.48)
        : tint(plan.skin.base, plan.skin.accent, 0.19 + 0.16 * t);
      const scale = Math.max(0.01, length, width);
      const part = (
        id: string,
        cage: Cage,
        parent: string,
        position: number[],
        color: string,
      ): FormPart => ({
        id,
        parent,
        shape: "cage",
        cage: {
          ...cage,
          vertices: cage.vertices.map((v) => v.map((x) => x / scale)),
        },
        position,
        size: [scale, scale, scale],
        frameSize: [scale, scale, scale],
        rotation: [0, 0, 0],
        color,
        surface: "plain",
        motionRole: "rigid",
      });
      const organ = part(id, tissue.cage, carrier.id, root.sub(base).toArray(), pigment);
      organ.surfaceJoin = {
        faces: gill ? [0] : [0, 1],
        depth: clamp(length * 0.065, 0.001, 0.016),
      };
      parts.push(organ);
      if (tissue.membrane)
        parts.push(
          part(
            id + " membrane",
            tissue.membrane,
            id,
            [0, 0, 0],
            tint(tint(pigment, plan.skin.pale, 0.15), "#321e29", 0.72),
          ),
        );
    }
  }
  return { ...form, parts };
}
