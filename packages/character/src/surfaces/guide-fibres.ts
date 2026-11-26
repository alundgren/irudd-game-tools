// Rooted fibres grown along guide sweeps. Ported from readGuide,
// gameFibreDetail, fibreStations, fibreGeometry and growGuideFibres in
// character-view/guide-fibres.js at 2761eb1, arithmetic and draws in the same
// order so the strands match. Pelt locks (rooted guides on a fur coat) spend
// their game triangles on clumps and undercoat tufts, as in creature-pelt.js.

import * as T from "three";
import type { FigureFibres } from "@irudd/document";
import { isMesh } from "../mesh.js";
import { randomStream } from "../random.js";
import type { BuildPart, BuildView } from "../view.js";
import type { BlendOwners } from "./blend.js";
import { surfaceIndex, type SurfaceIndex } from "./join.js";
import {
  appendTufts,
  clumpTriangles,
  peltGameDetail,
  undercoatTufts,
  type FibreDetail,
  type PeltLock,
} from "./pelt.js";

const tau = 2 * Math.PI;

const item = <V>(list: ArrayLike<V>, i: number): V => {
  const v = list[i];
  if (v === undefined) throw new Error("Fibre index out of range.");
  return v;
};

interface GuideRow {
  readonly center: T.Vector3;
  readonly offset: number;
  readonly length: number;
}

interface Guide {
  readonly rows: ReadonlyArray<GuideRow>;
  readonly p: T.BufferAttribute | T.InterleavedBufferAttribute;
  readonly stride: number;
  readonly length: number;
}

/**
 * The rings of a fitted sweep: each section's centre, first vertex and
 * distance along the path. A moved guide, resized body or bent spine changes
 * the fibres without a second editable mesh.
 */
function readGuide(g: T.BufferGeometry): Guide {
  const p = g.getAttribute("position");
  const uv = g.getAttribute("uv");
  let stride = 1;
  while (stride < uv.count && uv.getY(stride) === uv.getY(0)) stride++;
  if (stride < 4 || uv.count % stride !== 0)
    throw new Error("A fibre guide needs regular sweep sections.");
  const rows: GuideRow[] = [];
  const sample = new T.Vector3();
  let length = 0;
  for (let offset = 0; offset < p.count; offset += stride) {
    const center = new T.Vector3();
    for (let i = 0; i < stride - 1; i++) center.add(sample.fromBufferAttribute(p, offset + i));
    center.divideScalar(stride - 1);
    const last = rows.at(-1);
    if (last) length += center.distanceTo(last.center);
    rows.push({ center, offset, length });
  }
  return { rows, p, stride, length };
}

interface GuidePart {
  readonly part: BuildPart;
  readonly fibres: FigureFibres;
}

/**
 * Spend a bounded part of the game mesh on continuous strands. If the whole
 * coat exceeds the budget, keep an evenly spaced selection on every guide.
 * Ties go by the part's name, as G0's ids.
 */
function gameFibreDetail(
  guides: ReadonlyArray<GuidePart>,
  budget: number,
): Map<string, FibreDetail> {
  const total = guides.reduce((n, g) => n + g.fibres.count, 0);
  const max = Math.min(total, Math.max(guides.length, Math.floor(budget / 32)));
  const extra = Math.max(1, total - guides.length);
  const shares = guides.map((g) => {
    const wish = ((g.fibres.count - 1) * (max - guides.length)) / extra;
    return { id: g.part.id, name: g.part.label, count: 1 + Math.floor(wish), remainder: wish % 1 };
  });
  const spare = max - shares.reduce((n, g) => n + g.count, 0);
  shares.sort((a, b) => b.remainder - a.remainder || (a.name < b.name ? -1 : 1));
  for (let i = 0; i < spare; i++) {
    const share = shares[i];
    if (share) share.count++;
  }
  const spans = T.MathUtils.clamp(Math.floor((budget / Math.max(1, max) - 2) / 6), 5, 12);
  return new Map(shares.map((g) => [g.id, { count: g.count, spans }]));
}

/** The stations a strand keeps: all, or `spans` chosen greedily where dropping them errs most. */
function fibreStations(
  line: ReadonlyArray<T.Vector3>,
  radii: ReadonlyArray<number>,
  spans: number | undefined,
): number[] {
  if (!spans || line.length <= spans + 1) return line.map((_, i) => i);
  const chosen = [0, line.length - 1];
  const at = new T.Vector3();
  while (chosen.length <= spans) {
    let best = -1;
    let station = 0;
    let insert = 1;
    for (let k = 1; k < chosen.length; k++) {
      const a = item(chosen, k - 1);
      const b = item(chosen, k);
      for (let j = a + 1; j < b; j++) {
        const t = (j - a) / (b - a);
        at.lerpVectors(item(line, a), item(line, b), t);
        const error =
          at.distanceToSquared(item(line, j)) +
          (item(radii, j) - T.MathUtils.lerp(item(radii, a), item(radii, b), t)) ** 2;
        if (error > best) {
          best = error;
          station = j;
          insert = k;
        }
      }
    }
    chosen.splice(insert, 0, station);
  }
  return chosen;
}

/** The strands of one guide, and the joint ownership they take from its vertices. */
function fibreGeometry(
  mesh: T.Mesh,
  settings: FigureFibres,
  color: T.ColorRepresentation,
  rootAt: SurfaceIndex | undefined,
  lod: FibreDetail | undefined,
  old: BlendOwners | undefined,
): { geometry: T.BufferGeometry; owners: BlendOwners | undefined } {
  const { rows, p, stride, length } = readGuide(mesh.geometry);
  const random = randomStream(settings.seed);
  const pos: number[] = [];
  const colors: number[] = [];
  const uv: number[] = [];
  const indices: number[] = [];
  const sources: number[] = [];
  const dark = new T.Color(color);
  const grey = new T.Color("#c4bfb0");
  const edgeAt = (row: GuideRow, angle: number) => {
    const sector = ((((angle / tau) % 1) + 1) % 1) * (stride - 1);
    const i = Math.floor(sector);
    return new T.Vector3()
      .fromBufferAttribute(p, row.offset + i)
      .lerp(new T.Vector3().fromBufferAttribute(p, row.offset + i + 1), sector - i);
  };
  const down = new T.Vector3(0, -1, 0).transformDirection(mesh.matrixWorld.clone().invert());
  const localFromWorld = mesh.matrixWorld.clone().invert();
  const steps = Math.max(15, Math.min(48, rows.length));
  const sides = lod ? 3 : 5;
  for (let strand = 0; strand < settings.count; strand++) {
    const angle = strand * 2.39996323 + (random() - 0.5) * 0.31;
    const phase = random() * tau;
    const radial = Math.sqrt((strand + random()) / settings.count);
    const start = random() * 0.32;
    const finish = 0.77 + 0.23 * random();
    const fall = length * settings.fall * (0.28 + 0.75 * random());
    const lights =
      (random() < settings.grey ? 0.13 + 0.53 * random() : 0.012 * random()) *
      (lod?.clump ? 0.35 : 1);
    const shade = dark
      .clone()
      .lerp(grey, lights)
      .multiplyScalar(0.7 + 0.3 * random());
    const thickness = 0.6 + 0.5 * random();
    const base = pos.length / 3;
    if (
      lod &&
      Math.floor(((strand + 1) * lod.count) / settings.count) ===
        Math.floor((strand * lod.count) / settings.count)
    )
      continue;
    const line: T.Vector3[] = [];
    const radii: number[] = [];
    const bindings: number[] = [];
    const dirs: T.Vector3[] = [];
    const ramp: number[] = [];
    const clump = lod?.clump;
    for (let j = 0; j <= steps; j++) {
      const t = j / steps;
      const walk = fall > 0 ? Math.min(1, t / 0.84) : t;
      const free = fall > 0 ? Math.max(0, (t - 0.84) / 0.16) : 0;
      const d = length * T.MathUtils.lerp(start, finish, walk);
      let b = 1;
      while (b < rows.length - 1 && item(rows, b).length < d) b++;
      const lo = item(rows, b - 1);
      const hi = item(rows, b);
      const f = (d - lo.length) / Math.max(1e-9, hi.length - lo.length);
      const a =
        angle +
        settings.wave *
          (0.44 * Math.sin(phase + t * tau * 1.3) + 0.22 * Math.sin(phase * 0.72 + t * tau * 2.7));
      const mid = lo.center.clone().lerp(hi.center, f);
      const edge = edgeAt(lo, a).lerp(edgeAt(hi, a), f).sub(mid);
      const radius = edge.length();
      const v = mid.addScaledVector(
        edge,
        radial * (1 + 0.16 * settings.wave * Math.sin(t * 9 + phase)),
      );
      if (free > 0) {
        const tangent = hi.center.clone().sub(lo.center).normalize();
        v.addScaledVector(tangent, fall * free * (1 - 0.55 * free)).addScaledVector(
          down,
          fall * free * free * 0.74,
        );
        v.addScaledVector(edge, free * (0.22 + 0.31 * settings.wave) * Math.sin(phase));
      }
      line.push(v);
      if (clump) {
        dirs.push(edge.clone().normalize());
        ramp.push(T.MathUtils.smoothstep(t, 0, 0.55));
      }
      const root = clump ? 0.78 + 0.22 * Math.min(1, t / 0.12) : 0.44 + 0.56 * Math.min(1, t / 0.1);
      const tip = clump ? Math.max(0.02, (1 - t) ** 0.8) : 0.055 + 0.945 * (1 - t ** 2) ** 0.76;
      radii.push(
        Math.max(length * 0.00045, ((radius * thickness) / Math.sqrt(settings.count)) * 0.69) *
          (clump ?? 1) *
          root *
          tip,
      );
      const row = f < 0.5 ? lo : hi;
      const sector = Math.round(((((a / tau) % 1) + 1) % 1) * (stride - 1));
      bindings.push(row.offset + sector);
    }
    const first = item(line, 0);
    if (rootAt) {
      const hit = rootAt.nearest(first.clone().applyMatrix4(mesh.matrixWorld));
      const bound = hit.point
        .clone()
        .addScaledVector(hit.normal, -0.0006)
        .applyMatrix4(localFromWorld);
      const delta = bound.sub(first);
      for (let j = 0; j <= steps; j++)
        item(line, j).addScaledVector(delta, 1 - T.MathUtils.smoothstep(j / steps, 0, 0.38));
    }
    const stations = fibreStations(line, radii, lod?.spans);
    const u = new T.Vector3(1, 0, 0);
    for (const [ring, j] of stations.entries()) {
      const along = item(line, Math.min(j + 1, steps))
        .clone()
        .sub(item(line, Math.max(0, j - 1)))
        .normalize();
      if (Math.abs(along.dot(u)) > 0.94)
        u.set(0, Math.abs(along.y) < 0.8 ? 1 : 0, Math.abs(along.y) < 0.8 ? 0 : 1);
      u.addScaledVector(along, -u.dot(along)).normalize();
      // A clump lies flat on the lock: wide across it, thin along its radius.
      if (clump) {
        const across = new T.Vector3().crossVectors(along, item(dirs, j));
        if (across.lengthSq() > 1e-10) u.copy(across.normalize());
      }
      const v = new T.Vector3().crossVectors(along, u).normalize();
      const [wide, thin] = clump ? [1.05, 0.62] : [1, 0.69];
      const tone = clump
        ? shade.clone().multiplyScalar(T.MathUtils.lerp(0.6, 1.08, item(ramp, j)))
        : shade;
      for (let k = 0; k <= sides; k++) {
        const a = (tau * k) / sides;
        const point = item(line, j)
          .clone()
          .addScaledVector(u, wide * item(radii, j) * Math.cos(a))
          .addScaledVector(v, thin * item(radii, j) * Math.sin(a));
        pos.push(point.x, point.y, point.z);
        colors.push(tone.r, tone.g, tone.b);
        uv.push(k / sides, j / steps);
        sources.push(item(bindings, j));
        if (ring < stations.length - 1 && k < sides) {
          const i = base + ring * (sides + 1) + k;
          indices.push(i, i + 1, i + sides + 1, i + 1, i + sides + 2, i + sides + 1);
        }
      }
    }
    // Closed ends stay visible in a game that culls back faces.
    for (let k = 1; k < sides - 1; k++) {
      indices.push(base, base + k + 1, base + k);
      const end = base + (stations.length - 1) * (sides + 1);
      indices.push(end, end + k, end + k + 1);
    }
  }
  const g = new T.BufferGeometry();
  g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
  g.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
  g.setIndex(indices);
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  const owners = old
    ? {
        ids: old.ids,
        first: Uint8Array.from(sources, (i) => item(old.first, i)),
        second: Uint8Array.from(sources, (i) => item(old.second, i)),
        weight: Float32Array.from(sources, (i) => item(old.weight, i)),
      }
    : undefined;
  return { geometry: g, owners };
}

/**
 * Replace each visible guide sweep with its fibres. A finished build colours
 * them by vertex in `material`; a game build spends at most `gameBudget`
 * triangles on them, keeping their geometry through simplification.
 */
export function growGuideFibres(
  view: BuildView,
  objects: ReadonlyMap<string, T.Object3D>,
  owners: Map<T.Mesh, BlendOwners>,
  options: {
    readonly finish: boolean;
    readonly gameBudget: number;
    readonly material: () => T.Material;
  },
): void {
  const guides: GuidePart[] = [];
  for (const part of view.parts) {
    const object = objects.get(part.id);
    if (part.fibres && object && isMesh(object) && object.visible)
      guides.push({ part, fibres: part.fibres });
  }
  if (!guides.length) return;
  const details = options.gameBudget ? gameFibreDetail(guides, options.gameBudget) : null;
  // Pelt locks spend the triangles their strands were given on clumps and undercoat tufts instead.
  const pelt = details
    ? guides.filter(
        (g) =>
          g.fibres.rooted &&
          g.part.parent !== null &&
          view.byId.get(g.part.parent)?.finish === "fur",
      )
    : [];
  let tuftCount = 0;
  if (details && pelt.length) {
    const detailOf = (id: string): FibreDetail => {
      const d = details.get(id);
      if (!d) throw new Error(`Guide ${id} has no game detail.`);
      return d;
    };
    const triangles = pelt.reduce(
      (n, g) => n + detailOf(g.part.id).count * clumpTriangles(detailOf(g.part.id).spans),
      0,
    );
    const plan = peltGameDetail(
      pelt.map((g) => ({ id: g.part.id, fibres: g.fibres })),
      triangles,
    );
    for (const [id, d] of plan.detail) details.set(id, d);
    tuftCount = plan.tufts;
  }
  const peltIds = new Set(pelt.map((g) => g.part.id));
  const peltLocks = new Map<string, PeltLock[]>();
  // Freeze the carrier surfaces before replacing any parent that is also a guide.
  const surfaces = new Map<T.Object3D, SurfaceIndex | undefined>();
  for (const { part, fibres } of guides) {
    const parent = part.parent === null ? undefined : objects.get(part.parent);
    if (!fibres.rooted || !parent || surfaces.has(parent)) continue;
    parent.updateWorldMatrix(true, true);
    surfaces.set(parent, surfaceIndex(parent) ?? undefined);
  }
  for (const { part, fibres } of guides) {
    const mesh = objects.get(part.id);
    if (!mesh || !isMesh(mesh)) continue;
    mesh.updateWorldMatrix(true, false);
    const parent = part.parent === null ? undefined : objects.get(part.parent);
    const rootAt = fibres.rooted && parent ? surfaces.get(parent) : undefined;
    const current: T.Material | T.Material[] = mesh.material;
    const color =
      options.finish && current instanceof T.MeshStandardMaterial ? current.color : part.color;
    if (peltIds.has(part.id) && part.parent !== null) {
      const { rows } = readGuide(mesh.geometry);
      const root = item(rows, 0).center.clone().applyMatrix4(mesh.matrixWorld);
      const end = item(rows, rows.length - 1)
        .center.clone()
        .applyMatrix4(mesh.matrixWorld);
      const list = peltLocks.get(part.parent) ?? [];
      list.push({
        mesh,
        root,
        flow: end.clone().sub(root).normalize(),
        length: root.distanceTo(end),
        colour: new T.Color(color),
      });
      peltLocks.set(part.parent, list);
    }
    const { geometry, owners: next } = fibreGeometry(
      mesh,
      fibres,
      color,
      rootAt,
      details?.get(part.id),
      owners.get(mesh),
    );
    mesh.geometry.dispose();
    mesh.geometry = geometry;
    if (next) owners.set(mesh, next);
    else owners.delete(mesh);
    mesh.material = options.material();
  }
  const coats = [...peltLocks.keys()];
  coats.forEach((coatId, c) => {
    const undercoat = objects.get(coatId);
    const locks = peltLocks.get(coatId);
    const coat = view.byId.get(coatId);
    if (!undercoat || !isMesh(undercoat) || !locks || !coat) return;
    const share = Math.floor(tuftCount / coats.length);
    const current: T.Material | T.Material[] = undercoat.material;
    const coatColour =
      options.finish && current instanceof T.MeshStandardMaterial ? current.color : coat.color;
    const tufts = undercoatTufts(
      undercoat,
      locks,
      share,
      (coat.fibres?.seed ?? 0x5eed) + c,
      coatColour,
    );
    for (const lock of locks) {
      const { geometry, owners: next } = appendTufts(
        lock.mesh.geometry,
        owners.get(lock.mesh),
        tufts.get(lock.mesh),
      );
      lock.mesh.geometry = geometry;
      if (next) owners.set(lock.mesh, next);
      else owners.delete(lock.mesh);
    }
  });
}
