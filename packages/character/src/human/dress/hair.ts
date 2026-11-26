import * as T from "three";
import { context2d, type Raster } from "../../raster.js";
import { boneNames } from "../catalogue.js";
import type { GroomMaps } from "../complexion.js";
import { randomStream } from "../identity.js";
import type { Groom, GroomName, HumanGrooms } from "../groom.js";
import { fittedHairGrooms } from "./styles.js";
import type { HumanSurface } from "../surface.js";
import {
  combFringe,
  hairline,
  headFrame,
  settleFringe,
  surfaceBody,
  surfaceFrame,
} from "./fringe.js";
import type { HeadFrame } from "./fringe.js";
import {
  Piece,
  add,
  at,
  bodyShell,
  connected,
  cut,
  length,
  noise3,
  smooth,
  sub,
  subdivide,
  type DressBody,
  type DressMesh,
  type Shell,
} from "./kit.js";

const DEG = Math.PI / 180;

export interface HairStyle {
  readonly hair?: string | undefined;
  readonly fringe?: string | undefined;
  readonly hairColor?: string | undefined;
}

const combed = new Set(["Side-swept pixie", "Fringed bob", "Long centre part", "Loose waves"]);
const defaultHairColor = "#51433b";

function settleAuthored(
  p: Float32Array,
  anchor: Float32Array,
  anchorRest: Float32Array,
  offsets: Float32Array,
  onSkull: Uint8Array,
): void {
  const count = p.length / 3,
    gain = [1, 1, 1],
    shift = [0, 0, 0];
  for (let d = 0; d < 3; d++) {
    let n = 0,
      sx = 0,
      sy = 0,
      sxx = 0,
      sxy = 0;
    for (let i = 0; i < count; i++)
      if (onSkull[i]) {
        const x = at(anchorRest, i * 3 + d),
          y = at(anchor, i * 3 + d);
        n++;
        sx += x;
        sy += y;
        sxx += x * x;
        sxy += x * y;
      }
    const spread = n * sxx - sx * sx;
    if (n < 8 || spread < 1e-9) {
      shift[d] = n ? (sy - sx) / n : 0;
      continue;
    }
    gain[d] = Math.min(1.3, Math.max(0.77, (n * sxy - sx * sy) / spread));
    shift[d] = (sy - at(gain, d) * sx) / n;
  }
  for (let i = 0; i < count; i++) {
    const j = i * 3,
      off = Math.hypot(at(offsets, j), at(offsets, j + 1), at(offsets, j + 2));
    let t = Math.min(1, Math.max(0, (off - 0.006) / 0.022));
    t = onSkull[i] ? t * t * (3 - 2 * t) : 1;
    if (!t) continue;
    for (let d = 0; d < 3; d++)
      p[j + d] =
        at(p, j + d) +
        ((at(anchorRest, j + d) + at(offsets, j + d)) * at(gain, d) + at(shift, d) - at(p, j + d)) *
          t;
  }
}

function fittedCards(
  s: HumanSurface,
  groom: Groom,
  idMap: ReadonlyMap<number, number>,
  rest: Float32Array,
): Float32Array {
  const { refs, weights, offsets } = groom;
  const p = new Float32Array(refs.length);
  const anchor = new Float32Array(refs.length),
    anchorRest = new Float32Array(refs.length),
    onSkull = new Uint8Array(refs.length / 3);
  const a = new T.Vector3(),
    b = new T.Vector3(),
    n = new T.Vector3(),
    orig = new T.Vector3(),
    delta = new T.Vector3();
  function frame(arr: ArrayLike<number>, idx: readonly [number, number, number]): boolean {
    orig.set(at(arr, idx[0] * 3), at(arr, idx[0] * 3 + 1), at(arr, idx[0] * 3 + 2));
    a.set(at(arr, idx[1] * 3), at(arr, idx[1] * 3 + 1), at(arr, idx[1] * 3 + 2))
      .sub(orig)
      .normalize();
    b.set(at(arr, idx[2] * 3), at(arr, idx[2] * 3 + 1), at(arr, idx[2] * 3 + 2)).sub(orig);
    n.crossVectors(a, b).normalize();
    b.crossVectors(n, a);
    return n.lengthSq() > 0.5;
  }
  for (let i = 0; i < p.length / 3; i++) {
    const base = i * 3;
    const source = (k: number) => {
      const v = idMap.get(at(refs, base + k));
      if (v === undefined) throw new Error("Missing source vertex in " + groom.name);
      return v;
    };
    const ix = [source(0), source(1), source(2)] as const;
    let skull = 0,
      all = 0;
    for (let j = 0; j < 3; j++) {
      const w = at(weights, base + j),
        v = ix[j] ?? 0;
      for (let d = 0; d < 3; d++) {
        p[base + d] = at(p, base + d) + at(s.positions, v * 3 + d) * w;
        anchorRest[base + d] = at(anchorRest, base + d) + at(rest, v * 3 + d) * w;
      }
      for (let k = v * 4; k < v * 4 + 4; k++) {
        const sw = at(s.weights, k);
        if (!sw) continue;
        const share = Math.max(0, w) * sw;
        all += share;
        if ((boneNames[at(s.boneIndices, k)] ?? "").startsWith("head")) skull += share;
      }
    }
    anchor.set(p.subarray(base, base + 3), base);
    onSkull[i] = skull > 0.5 * all ? 1 : 0;
    delta.set(at(offsets, base), at(offsets, base + 1), at(offsets, base + 2));
    if (delta.lengthSq() > 0.000000001 && frame(rest, ix)) {
      const x = delta.dot(a),
        y = delta.dot(b),
        z = delta.dot(n);
      if (frame(s.positions, ix))
        delta.copy(a).multiplyScalar(x).addScaledVector(b, y).addScaledVector(n, z);
    }
    delta.multiplyScalar(s.height / 1.72);
    p[base] = at(p, base) + delta.x;
    p[base + 1] = at(p, base + 1) + delta.y;
    p[base + 2] = at(p, base + 2) + delta.z;
  }
  settleAuthored(p, anchor, anchorRest, offsets, onSkull);
  return p;
}

function trimmedCards(
  groom: Groom,
  p: Float32Array,
  frame: HeadFrame,
  fringe: string | undefined,
): T.BufferGeometry {
  const { faceRefs: refs, faceWeights: blend } = groom,
    p2 = new Float32Array(refs.length);
  for (let i = 0; i < p2.length / 3; i++)
    for (let k = 0; k < 3; k++) {
      const id = at(refs, i * 3 + k),
        f = at(blend, i * 3 + k) / 65535;
      for (let d = 0; d < 3; d++) p2[i * 3 + d] = at(p2, i * 3 + d) + at(p, id * 3 + d) * f;
    }
  if (fringe) settleFringe(p2, frame, fringe);
  const cards = new T.BufferGeometry();
  cards.setAttribute("position", new T.BufferAttribute(p, 3));
  cards.setIndex(new T.BufferAttribute(groom.corners, 1));
  cards.computeVertexNormals();
  const baseNormals = cards.getAttribute("normal"),
    normals = new Float32Array(p2.length);
  const v = new T.Vector3(),
    sum = new T.Vector3();
  for (let i = 0; i < p2.length / 3; i++) {
    sum.set(0, 0, 0);
    for (let k = 0; k < 3; k++)
      sum.addScaledVector(
        v.fromBufferAttribute(baseNormals, at(refs, i * 3 + k)),
        at(blend, i * 3 + k) / 65535,
      );
    sum.normalize().toArray(normals, i * 3);
  }
  cards.dispose();
  const g = new T.BufferGeometry();
  g.setAttribute("position", new T.BufferAttribute(p2, 3));
  g.setAttribute("normal", new T.BufferAttribute(normals, 3));
  g.setAttribute(
    "uv",
    new T.Float32BufferAttribute(
      Float32Array.from(groom.faceUV, (u) => u / 65535),
      2,
    ),
  );
  g.setIndex(new T.BufferAttribute(groom.faceIndices, 1));
  return g;
}

function gameCards(
  groom: Groom,
  p: Float32Array,
  frame: HeadFrame,
  fringe: string | undefined,
  cover: number,
): T.BufferGeometry {
  const { corners, uvCorners: texCorners, uv, faceRefs: refs, faceWeights: blend } = groom,
    faces = groom.faceIndices;
  const triple = (a: number, b: number, c: number) => (a * 65536 + b) * 65536 + c,
    covered = new Map<number, number>();
  for (let f = 0; f < faces.length; f += 3) {
    const i = at(faces, f) * 3,
      j = at(faces, f + 1) * 3,
      k = at(faces, f + 2) * 3,
      key = triple(at(refs, i), at(refs, i + 1), at(refs, i + 2));
    const share =
      Math.abs(
        (at(blend, j) - at(blend, i)) * (at(blend, k + 1) - at(blend, i + 1)) -
          (at(blend, k) - at(blend, i)) * (at(blend, j + 1) - at(blend, i + 1)),
      ) /
      65535 ** 2;
    covered.set(key, (covered.get(key) ?? 0) + share);
  }
  const drawn = new Set<number>();
  for (const [key, share] of covered) if (share >= cover) drawn.add(key);
  const cards = new T.BufferGeometry();
  cards.setAttribute("position", new T.BufferAttribute(p, 3));
  cards.setIndex(new T.BufferAttribute(corners, 1));
  cards.computeVertexNormals();
  const smooth = cards.getAttribute("normal"),
    settled = p.slice();
  cards.dispose();
  if (fringe) settleFringe(settled, frame, fringe);
  const pos: number[] = [],
    norm: number[] = [],
    tex: number[] = [],
    indices: number[] = [],
    seen = new Map<number, number>();
  for (let c = 0; c < corners.length; c += 3) {
    if (!drawn.has(triple(at(corners, c), at(corners, c + 1), at(corners, c + 2)))) continue;
    for (let d = c; d < c + 3; d++) {
      const v = at(corners, d),
        t = at(texCorners, d),
        key = v * 65536 + t;
      let to = seen.get(key);
      if (to === undefined) {
        seen.set(key, (to = pos.length / 3));
        pos.push(at(settled, v * 3), at(settled, v * 3 + 1), at(settled, v * 3 + 2));
        norm.push(smooth.getX(v), smooth.getY(v), smooth.getZ(v));
        tex.push(at(uv, t * 2) / 65535, at(uv, t * 2 + 1) / 65535);
      }
      indices.push(to);
    }
  }
  const g = new T.BufferGeometry();
  g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new T.Float32BufferAttribute(norm, 3));
  g.setAttribute("uv", new T.Float32BufferAttribute(tex, 2));
  g.setIndex(indices);
  return g;
}

function joinTrimmed(g: T.BufferGeometry): T.BufferGeometry {
  const position = g.getAttribute("position"),
    normal = g.getAttribute("normal"),
    uv = g.getAttribute("uv"),
    seen = new Map<string, number>(),
    keep: number[] = [];
  const index = Array.from(g.getIndex()?.array ?? [], (i) => {
    const key =
      Math.round(position.getX(i) * 20000) +
      "," +
      Math.round(position.getY(i) * 20000) +
      "," +
      Math.round(position.getZ(i) * 20000) +
      "," +
      Math.round(uv.getX(i) * 2000) +
      "," +
      Math.round(uv.getY(i) * 2000);
    let to = seen.get(key);
    if (to === undefined) {
      seen.set(key, (to = keep.length));
      keep.push(i);
    }
    return to;
  });
  const out = new T.BufferGeometry();
  for (const [name, a] of [
    ["position", position],
    ["normal", normal],
    ["uv", uv],
  ] as const) {
    const width = a.itemSize,
      data = new Float32Array(keep.length * width);
    keep.forEach((i, k) => {
      for (let d = 0; d < width; d++) data[k * width + d] = a.getComponent(i, d);
    });
    out.setAttribute(name, new T.BufferAttribute(data, width));
  }
  out.setIndex(
    index.filter((_, k) => {
      const t = k - (k % 3);
      return (
        index[t] !== index[t + 1] && index[t + 1] !== index[t + 2] && index[t] !== index[t + 2]
      );
    }),
  );
  g.dispose();
  return out;
}

interface CapOptions {
  readonly thick: () => number;
  readonly lip: number;
  readonly edge: number;
  readonly levels: number;
  readonly within: ((i: number) => number) | null;
  readonly ragged: number;
}

function cap(body: DressBody, f: HeadFrame, options: CapOptions) {
  const { thick, lip, edge, levels, within, ragged } = options;
  const k = f.k,
    head = body.weight(/^head/);
  let s = bodyShell(body, { head });
  const line: number[] = Array.from({ length: s.count }, () => 0);
  s.f["line"] = line;
  for (let i = 0; i < s.count; i++) {
    const { phi, eps, q } = f.aim(s.anchor(i));
    line[i] =
      s.value("head", i) > 0.5
        ? eps - hairline(phi) + ragged * DEG * (noise3(q[0] * 13 + 3, q[1] * 13, q[2] * 13) - 0.5)
        : -1;
    const value = at(line, i);
    if (within && value > -1) line[i] = Math.min(value + 7 * DEG, within(i));
  }
  s = cut(s, (i) => at(line, i));
  s = connected(s, [0, f.top, f.centre[2]]);
  for (let level = 0; level < levels; level++) s = subdivide(s);
  for (let i = 0; i < s.count; i++) {
    const a = s.anchor(i),
      out = sub(a, f.centre),
      r = length(out),
      u = [out[0] / r, out[1] / r, out[2] / r] as const,
      dir = f.aim(a);
    const near =
      s.value("line", i) /
      Math.hypot(
        1,
        (hairline(dir.phi + DEG) - hairline(dir.phi - DEG)) /
          (2 * DEG * Math.max(0.3, Math.cos(dir.eps))),
      );
    const t = thick() * k * smooth(0, edge, near) ** 1 + lip * k * smooth(0, 0.1, near);
    s.set(i, add(f.centre, u, r + Math.max(0.0012 * k, t)));
  }
  return s;
}

function hairRoots(body: DressBody, within: ((i: number) => number) | null): Piece {
  const f = headFrame(body);
  const s = cap(body, f, {
    thick: () => 0.0016,
    lip: 0.0008,
    edge: 0.12,
    levels: 1,
    within,
    ragged: within ? 0 : 2.4,
  });
  return new Piece().shell(s, { thickness: 0.0012 });
}

export interface HairFinish {
  readonly raster: Raster;
  readonly maps: ReadonlyMap<GroomName, GroomMaps>;
}

const between = (x: number, a: number, b: number) => Math.min(1, Math.max(0, (x - a) / (b - a)));

function tintedStrands(raster: Raster, maps: GroomMaps, hex: string): T.CanvasTexture {
  const image = maps.picture;
  const canvas = raster.canvas(image.width, image.height);
  const context = context2d(canvas, { willReadFrequently: true });
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height),
    data = pixels.data;
  const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4),
    srgb = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
  const colour = [1, 3, 5].map((k) => lin(parseInt(hex.slice(k, k + 2), 16) / 255)),
    middle = lin(188 / 255);
  const luma = 0.2126 * (colour[0] ?? 0) + 0.7152 * (colour[1] ?? 0) + 0.0722 * (colour[2] ?? 0),
    sheen = 0.012 + 0.05 * (1 - Math.min(1, luma * 3)) ** 2;
  const table = colour.map((c) =>
    Uint8ClampedArray.from({ length: 256 }, (_, v) => {
      const t = lin(v / 255) / middle,
        glint = between(t, 0.95, 1.7),
        level = 0.72 * (t <= 1 ? t : 1 + (t - 1) * 0.5);
      return Math.round(255 * srgb(Math.min(1, c * level + sheen * glint * glint)));
    }),
  );
  for (let i = 0; i < data.length; i += 4)
    for (let k = 0; k < 3; k++) data[i + k] = table[k]?.[data[i + k] ?? 0] ?? 0;
  context.putImageData(pixels, 0, 0);
  const map = new T.CanvasTexture(canvas);
  map.colorSpace = T.SRGBColorSpace;
  map.anisotropy = 4;
  map.flipY = maps.texture.flipY;
  return map;
}

const rootMaps = new WeakMap<Raster, T.CanvasTexture>();
function hairlineTexture(raster: Raster): T.CanvasTexture {
  const known = rootMaps.get(raster);
  if (known) return known;
  const canvas = raster.canvas(512, 128);
  const pen = context2d(canvas),
    random = randomStream(73191);
  pen.fillStyle = "#cec7c1";
  pen.fillRect(0, 0, 512, 84);
  for (let i = 0; i < 1400; i++) {
    const x = random() * 536 - 12,
      sway = 3.5 * Math.sin(x / 29) + 2 * Math.cos(x / 11);
    const start = random() * 74,
      tip = 87 + 33 * random() + 5 * Math.sin(x / 17);
    const width = 0.4 + 2.3 * random(),
      bend = sway + (random() - 0.5) * 6;
    const grey = Math.round(174 + 78 * random());
    pen.fillStyle = "rgb(" + grey + "," + grey + "," + grey + ")";
    pen.beginPath();
    pen.moveTo(x - width, start);
    pen.quadraticCurveTo(x + 0.4 * bend - width, tip - 11, x + bend, tip);
    pen.quadraticCurveTo(x + 0.4 * bend + width, tip - 17, x + width, start);
    pen.fill();
  }
  const map = new T.CanvasTexture(canvas);
  map.colorSpace = T.SRGBColorSpace;
  map.anisotropy = 8;
  rootMaps.set(raster, map);
  return map;
}

function textureHairRoots(raster: Raster, mesh: T.Mesh, shell: Shell, frame: HeadFrame): void {
  const uv = new Float32Array(mesh.geometry.getAttribute("position").count * 2);
  for (let i = 0; i < shell.count; i++) {
    const { q } = frame.aim(shell.anchor(i));
    uv[2 * i] = 0.5 + 0.42 * q[0] + 0.06 * q[2];
    uv[2 * i + 1] = Math.max(0, Math.min(1, shell.value("line", i) / 0.24));
  }
  mesh.geometry.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
  const source = mesh.material;
  if (!(source instanceof T.MeshStandardMaterial)) return;
  const material = source.clone();
  material.map = hairlineTexture(raster);
  material.alphaTest = 0.32;
  material.roughness = 0.83;
  mesh.material = material;
}

export interface FittedHair {
  readonly cards: T.Mesh;
  readonly roots: DressMesh;
  readonly hide: ReadonlyArray<number>;
}

export function fittedHair(
  surface: HumanSurface,
  style: HairStyle,
  grooms: HumanGrooms,
  rest: Float32Array,
  material: (colour: string, type: string) => T.Material,
  plain: boolean,
  game: boolean,
  finish?: HairFinish,
): FittedHair | null {
  const table: Readonly<Record<string, GroomName>> = fittedHairGrooms;
  const name =
    style.hair !== undefined && Object.hasOwn(table, style.hair) ? table[style.hair] : undefined;
  if (!name) return null;
  const groom = grooms(name);
  const ids = new Map(Array.from(surface.ids, (v, i) => [v, i] as const));
  const p = fittedCards(surface, groom, ids, rest);
  const fringe = style.hair !== undefined && combed.has(style.hair) ? style.fringe : undefined;
  if (fringe) combFringe(p, surfaceFrame(surface), fringe);
  const colour = style.hairColor ?? defaultHairColor;
  const m = material(colour, "plain").clone();
  const maps = plain ? undefined : finish?.maps.get(name);
  if (finish && maps && m instanceof T.MeshStandardMaterial) {
    m.color.set("#ffffff");
    m.map = tintedStrands(finish.raster, maps, colour);
    m.normalMap = maps.normal;
    m.normalScale.setScalar(0.82);
  }
  m.side = T.DoubleSide;
  m.userData["hairCards"] = true;
  if (!plain && m instanceof T.MeshStandardMaterial) {
    m.alphaTest = 0.2;
    m.alphaToCoverage = true;
    m.roughness = 0.78;
  }
  const fine = groom.faceIndices.length > 8 * groom.corners.length;
  const frame = surfaceFrame(surface);
  const geometry =
    game && (!plain || fine)
      ? gameCards(groom, p, frame, fringe, plain ? 0.5 : 0)
      : game
        ? joinTrimmed(trimmedCards(groom, p, frame, fringe))
        : trimmedCards(groom, p, frame, fringe);
  const cards = new T.Mesh(geometry, m);
  cards.name = style.hair ?? "";
  cards.userData["styleRegion"] = "head";
  cards.userData["libraryHair"] = name;
  cards.castShadow = true;
  const tone = "#" + new T.Color(colour).multiplyScalar(plain ? 0.5 : 0.86).getHexString();
  const scalp = groom.scalp;
  let within: ((i: number) => number) | null = null;
  if (scalp) {
    const field = new Float32Array(surface.positions.length / 3).fill(-1);
    scalp.ids.forEach((id, k) => {
      const v = ids.get(id);
      if (v !== undefined) field[v] = at(scalp.field, k) / 100;
    });
    const allowance =
      !plain && ["short_layered", "short_receding", "bun_tied"].includes(name) ? 0.38 : 0;
    within = (i) => (at(field, i) + allowance) * 0.3;
  }
  const bed = hairRoots(surfaceBody(surface), within);
  const roots = bed.mesh(material(tone, "hair"), "head", "Hair roots");
  const shell = bed.shells[0];
  if (!plain && finish && scalp && shell)
    textureHairRoots(finish.raster, roots.mesh, shell, surfaceFrame(surface));
  roots.mesh.userData["hairRoots"] = true;
  return { cards, roots, hide: Array.from(groom.hide) };
}
