import * as T from "three";
import type { BrowName, HumanBody, StrandCard } from "./body.js";
import { browPigment } from "./complexion.js";
import { expressionDisplacements, type HumanSurface } from "./surface.js";

const expressionNames = ["Blink", "Smile", "BrowLift"] as const;

type Rgb = readonly [number, number, number];
interface StrandLook {
  readonly density: number;
  readonly length: number;
  readonly width: number;
  readonly lift?: readonly [number, number];
  readonly aim?: readonly [number, number];
  readonly colour: Rgb;
  readonly tip: Rgb;
  readonly facing?: Rgb;
  readonly bothSides?: boolean;
}

interface Sink {
  readonly position: number[];
  readonly normal: number[];
  readonly colour: number[];
  readonly index: number[];
  readonly shifts: number[][];
}

export interface StrandHead {
  readonly body: HumanBody;
  readonly cage: HumanSurface;
  readonly positions: Float32Array;
  readonly idMap: ReadonlyMap<number, number>;
  readonly origin: readonly [number, number, number];
  readonly height: number;
}

function fitted(card: StrandCard, head: StrandHead) {
  const { refs, weights, offsets } = card,
    { cage, positions, idMap, origin, height } = head;
  const base = new Float32Array(refs.length),
    raise = new Float32Array(refs.length);
  const shifts = expressionNames.map(() => new Float32Array(refs.length));
  const moves = expressionNames.map((n) => expressionDisplacements(head.body, n, false, cage));
  for (let i = 0; i < base.length / 3; i++)
    for (let axis = 0; axis < 3; axis++) {
      let value = (raise[i * 3 + axis] = ((offsets[i * 3 + axis] ?? 0) * height) / 1.72);
      for (let k = i * 3; k < i * 3 + 3; k++) {
        const at = (idMap.get(refs[k] ?? 0) ?? 0) * 3 + axis,
          w = weights[k] ?? 0;
        value += w * (positions[at] ?? 0);
        moves.forEach((move, e) => {
          const shift = shifts[e];
          if (shift)
            shift[i * 3 + axis] =
              (shift[i * 3 + axis] ?? 0) + (w * (move[at] ?? 0) * cage.height) / 1.72;
        });
      }
      base[i * 3 + axis] = value - (origin[axis] ?? 0);
    }
  return { base, shifts, raise };
}

function strands(
  card: StrandCard,
  head: StrandHead,
  look: (lower: boolean) => StrandLook,
  sink: Sink,
  inside: T.Vector3,
  parted: Uint8Array | null = null,
): void {
  const fit = fitted(card, head);
  const { triRefs: parents, triWeights: blend, triIndices: index, along, root, lower } = card;
  const count = parents.length / 3,
    start = sink.position.length / 3;
  const spread = (source: Float32Array, shift?: Float32Array) => {
    const out = new Float32Array(count * 3);
    for (let i = 0; i < count; i++)
      for (let k = i * 3; k < i * 3 + 3; k++) {
        const p = (parents[k] ?? 0) * 3,
          b = blend[k] ?? 0;
        for (let d = 0; d < 3; d++)
          out[i * 3 + d] =
            (out[i * 3 + d] ?? 0) + b * ((source[p + d] ?? 0) + (shift ? (shift[p + d] ?? 0) : 0));
      }
    return out;
  };
  const settings = (i: number) => look(lower?.[i] === 1);
  const stand = spread(fit.raise);
  const placed = (shift?: Float32Array) => {
    const out = spread(fit.base, shift);
    for (let i = 0; i < count; i++) {
      const lift = settings(i).lift;
      if (!lift) continue;
      const keep = lift[0] + ((lift[1] - lift[0]) * (along[i] ?? 0)) / 255;
      for (let d = 0; d < 3; d++)
        out[i * 3 + d] = (out[i * 3 + d] ?? 0) - (stand[i * 3 + d] ?? 0) * (1 - keep);
    }
    return out;
  };
  const pairs = 2 * (card.points - 1);
  const shaped = (values: Float32Array) => {
    const out = new Float32Array(values.length),
      centre = [0, 0, 0],
      from = [0, 0, 0];
    for (let i = 0; i < count; i++) {
      const r = root[i] ?? 0,
        f = settings(i),
        j = i - r,
        mate = j < pairs ? r + (j ^ 1) : i;
      for (let d = 0; d < 3; d++) {
        from[d] = ((values[r * 3 + d] ?? 0) + (values[(r + 1) * 3 + d] ?? 0)) / 2;
        centre[d] = ((values[i * 3 + d] ?? 0) + (values[mate * 3 + d] ?? 0)) / 2 - (from[d] ?? 0);
      }
      if (f.aim) {
        const reach = Math.hypot(centre[1] ?? 0, centre[2] ?? 0),
          t = (along[i] ?? 0) / 255,
          angle = f.aim[0] + (f.aim[1] - f.aim[0]) * t;
        centre[1] = reach * Math.sin(angle);
        centre[2] = reach * Math.cos(angle);
      }
      for (let d = 0; d < 3; d++)
        out[i * 3 + d] =
          (from[d] ?? 0) +
          (centre[d] ?? 0) * f.length +
          (((values[i * 3 + d] ?? 0) - (values[mate * 3 + d] ?? 0)) / 2) * f.width;
    }
    return out;
  };
  const rest = shaped(placed());
  const moved = fit.shifts.map((shift) => {
    const posed = shaped(placed(shift));
    for (let i = 0; i < posed.length; i++) posed[i] = (posed[i] ?? 0) - (rest[i] ?? 0);
    return posed;
  });
  let strand: Int32Array | null = null;
  if (parted) {
    strand = new Int32Array(count).fill(-1);
    const per = 2 * card.points - 1;
    for (let i = 0, k = 0; i < count; i++)
      if (root[i] === i && i + per <= count && root[i + per - 1] === i) strand[i] = k++;
  }
  const keep = (i: number) => {
    const r = root[i] ?? 0,
      s = strand?.[r] ?? -1;
    if (parted && s >= 0 && parted[s]) return false;
    return (Math.imul(r + 1, 2654435761) >>> 0) / 4294967296 < settings(i).density;
  };
  const colours = new Float32Array(count * 3),
    normals = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const { colour, tip, facing } = settings(i),
      shade = 0.86 + (0.28 * ((Math.imul((root[i] ?? 0) + 7, 40503) >>> 0) % 997)) / 997;
    const t = (along[i] ?? 0) / 255;
    for (let d = 0; d < 3; d++)
      colours[i * 3 + d] = Math.min(
        1,
        ((colour[d] ?? 0) + ((tip[d] ?? 0) - (colour[d] ?? 0)) * t) * shade,
      );
    const n = facing ?? [
      (rest[i * 3] ?? 0) - inside.x,
      (rest[i * 3 + 1] ?? 0) - inside.y,
      (rest[i * 3 + 2] ?? 0) - inside.z,
    ];
    const size = Math.hypot(...n) || 1;
    for (let d = 0; d < 3; d++) normals[i * 3 + d] = (n[d] ?? 0) / size;
  }
  for (const v of rest) sink.position.push(v);
  for (const v of normals) sink.normal.push(v);
  for (const v of colours) sink.colour.push(v);
  moved.forEach((values, e) => {
    const target = sink.shifts[e];
    if (target) for (const v of values) target.push(v);
  });
  const at = (k: number, d: number) => rest[k * 3 + d] ?? 0;
  for (let i = 0; i < index.length; i += 3) {
    const a = index[i] ?? 0;
    if (!keep(a)) continue;
    let b = index[i + 1] ?? 0,
      c = index[i + 2] ?? 0;
    const e0 = at(b, 0) - at(a, 0),
      e1 = at(b, 1) - at(a, 1),
      e2 = at(b, 2) - at(a, 2),
      o0 = at(c, 0) - at(a, 0),
      o1 = at(c, 1) - at(a, 1),
      o2 = at(c, 2) - at(a, 2);
    const facing =
      (e1 * o2 - e2 * o1) * (normals[a * 3] ?? 0) +
      (e2 * o0 - e0 * o2) * (normals[a * 3 + 1] ?? 0) +
      (e0 * o1 - e1 * o0) * (normals[a * 3 + 2] ?? 0);
    if (facing < 0) [b, c] = [c, b];
    sink.index.push(start + a, start + b, start + c);
    if (settings(a).bothSides) sink.index.push(start + a, start + c, start + b);
  }
}

export interface BrowLook {
  readonly brow: BrowName;
  readonly frame: number;
  readonly age: number;
  readonly plain: boolean;
  readonly brows: boolean;
  readonly parted: Uint8Array | null;
  readonly colours: {
    readonly brow: Rgb;
    readonly browTip: Rgb;
    readonly lash: Rgb;
    readonly lashTip: Rgb;
    readonly underLash: Rgb;
  } | null;
}

const none: Rgb = [1, 1, 1];

const artwork: Readonly<Record<string, BrowName>> = {
  "Soft taper": "eyebrow001",
  "Lifted arch": "eyebrow003",
  Straight: "eyebrow005",
  "Fine arch": "eyebrow006",
  "Full and brushed": "eyebrow009",
  Feathered: "eyebrow011",
  Untrimmed: "eyebrow012",
};

export function strandColours(
  hair: T.Color,
  skin: T.Color,
  age: number,
): NonNullable<BrowLook["colours"]> {
  const rgb = (c: T.Color): Rgb => [c.r, c.g, c.b];
  const light = (c: T.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b,
    most = Math.min(0.05, 0.3 * light(skin));
  const brow = browPigment(hair, skin, age);
  const browTip = brow.clone().lerp(hair, 0.14 + 0.14 * age);
  const tipLimit = Math.min(0.82 * light(skin), 1.75 * light(brow) + 0.013);
  if (light(browTip) > tipLimit) browTip.multiplyScalar(tipLimit / light(browTip));
  const lash = hair.clone().lerp(new T.Color("#120d0b"), 0.72);
  if (light(lash) > most) lash.multiplyScalar(most / light(lash));
  const lashTip = lash.clone().lerp(skin, 0.22);
  return {
    brow: rgb(brow),
    browTip: rgb(browTip),
    lash: rgb(lash),
    lashTip: rgb(lashTip),
    underLash: rgb(lash.clone().lerp(skin, 0.2)),
  };
}

export function fittedBrow(browStyle: string | undefined, browHeight: number): BrowName {
  return (browStyle && artwork[browStyle]) || (browHeight > 0.18 ? "eyebrow003" : "eyebrow001");
}

export function browsAndLashes(
  head: StrandHead,
  look: BrowLook,
  material: (color: string) => T.Material,
): T.Mesh {
  const { cage, positions, origin } = head;
  const inside = new T.Vector3(),
    box = new T.Box3(),
    v = new T.Vector3();
  for (const ids of cage.eyeGroups)
    for (const id of ids) box.expandByPoint(v.fromArray(positions, id * 3));
  box.getCenter(inside).sub(v.fromArray(origin));
  inside.z -= box.getSize(v).y * 2.4;
  const sink: Sink = {
    position: [],
    normal: [],
    colour: [],
    index: [],
    shifts: expressionNames.map(() => []),
  };
  const frame = T.MathUtils.clamp(look.frame, -1, 1),
    age = look.age,
    plain = look.plain,
    c = look.colours;
  const brow: StrandLook = {
    density: (plain ? 1 : 0.42) * (1 - 0.12 * Math.max(0, -frame) - 0.1 * age),
    length: 1,
    width: plain ? 0.82 : 0.62,
    lift: [0.1, 0.39],
    colour: c?.brow ?? none,
    tip: c?.browTip ?? none,
  };
  if (look.brows)
    strands(head.body.strands(look.brow), head, () => brow, sink, inside, look.parted);
  const upper: StrandLook = {
    density: 0.96 - 0.22 * age,
    length: 2.55 - 0.35 * frame - 0.35 * age,
    width: 1.06,
    lift: [0.35, 1],
    aim: [-0.4, 0.34],
    colour: c?.lash ?? none,
    tip: c?.lashTip ?? none,
    facing: [0, 0.5, 0.87],
    bothSides: true,
  };
  const under: StrandLook = {
    density: 0.5 - 0.14 * frame - 0.1 * age,
    length: 1.7 - 0.2 * frame,
    width: 0.7,
    aim: [0.15, -0.45],
    colour: c?.underLash ?? none,
    tip: c?.lashTip ?? none,
    facing: [0, -0.3, 0.95],
  };
  const browVertices = sink.position.length / 3;
  strands(head.body.strands("eyelashes01"), head, (low) => (low ? under : upper), sink, inside);
  const geometry = new T.BufferGeometry();
  geometry.setAttribute("position", new T.Float32BufferAttribute(sink.position, 3));
  geometry.setAttribute("normal", new T.Float32BufferAttribute(sink.normal, 3));
  geometry.setAttribute(
    "uv",
    new T.BufferAttribute(new Float32Array((sink.position.length / 3) * 2).fill(0.5), 2),
  );
  if (!plain) geometry.setAttribute("color", new T.Float32BufferAttribute(sink.colour, 3));
  geometry.setIndex(sink.index);
  geometry.userData["browVertices"] = browVertices;
  geometry.morphTargetsRelative = true;
  geometry.morphAttributes["position"] = sink.shifts.map((values, e) => {
    const attr = new T.Float32BufferAttribute(values, 3);
    attr.name = expressionNames[e] ?? "";
    return attr;
  });
  const m = material("#ffffff").clone();
  if (!plain && m instanceof T.MeshStandardMaterial) {
    m.vertexColors = true;
    m.roughness = 0.62;
  }
  m.userData = { ...m.userData, fibreLOD: true };
  const mesh = new T.Mesh(geometry, m);
  mesh.name = "brows-and-lashes";
  mesh.updateMorphTargets();
  return mesh;
}
