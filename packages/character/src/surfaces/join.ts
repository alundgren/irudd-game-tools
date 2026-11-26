// Surface joins: seat a part's root patch inside its parent's surface and give
// it the parent's joint ownership. Ported from character-view/surface-join.js
// at 2761eb1, in the same arithmetic and iteration order so the vertices and
// ownership tables match.

import * as T from "three";
import type { FigureJoin } from "@irudd/document";
import type { BlendOwners } from "./blend.js";
import type { BuildPart } from "../view.js";
import { hasPlatedAxis } from "./plate-growth.js";
import { isMesh } from "../mesh.js";

export interface Face {
  readonly tri: T.Triangle;
  readonly indices: readonly [number, number, number];
  readonly mesh: T.Mesh;
  readonly center: T.Vector3;
}

export interface Hit {
  readonly point: T.Vector3;
  readonly normal: T.Vector3;
  readonly face: Face;
}

interface Node {
  readonly box: T.Box3;
  readonly list?: Face[];
  readonly children?: readonly [Node, Node];
}

export interface SurfaceIndex {
  /** The closest surface point. */
  nearest(point: T.Vector3): Hit;
  /** The outermost surface crossed looking back along `outward`, else the closest point. */
  exterior(point: T.Vector3, outward: T.Vector3): Hit;
}

interface Table {
  readonly ids: string[];
  readonly first: Uint8Array;
  readonly second: Uint8Array;
  readonly weight: Float32Array;
}

type Ranks = Map<string, number>;

/** Joined ownership and the cage faces each triangle came from, by mesh and by geometry. */
export interface JoinState {
  readonly owners: Map<T.Mesh, BlendOwners>;
  /**
   * Control faces per triangle of each cage geometry. A build warp gives a
   * mesh a fresh geometry without them, as G0 does, so its faces no longer join.
   */
  readonly cageFaces: WeakMap<T.BufferGeometry, ReadonlyArray<number>>;
}

const partIdOf = (node: T.Object3D): string | undefined => {
  const id: unknown = node.userData["partId"];
  return typeof id === "string" ? id : undefined;
};

function ownMeshes(root: T.Object3D): T.Mesh[] {
  const result: T.Mesh[] = [];
  const walk = (node: T.Object3D): void => {
    if (!node.visible || (node !== root && partIdOf(node) !== undefined)) return;
    if (isMesh(node) && node.geometry.getAttribute("position")) result.push(node);
    for (const c of node.children) walk(c);
  };
  walk(root);
  return result;
}

/**
 * A bounding volume tree over the carrier's own triangles in world metres, so
 * fitting a small root only visits triangles that could be nearer.
 */
export function surfaceIndex(root: T.Object3D): SurfaceIndex | null {
  const faces: Face[] = [];
  for (const mesh of ownMeshes(root)) {
    const g = mesh.geometry;
    const pos = g.getAttribute("position");
    const idx = g.index;
    for (let i = 0, n = idx?.count ?? pos.count; i < n; i += 3) {
      const corner = (k: number) => (idx ? idx.getX(i + k) : i + k);
      const indices = [corner(0), corner(1), corner(2)] as const;
      const world = (v: number) =>
        new T.Vector3().fromBufferAttribute(pos, v).applyMatrix4(mesh.matrixWorld);
      const tri = new T.Triangle(world(indices[0]), world(indices[1]), world(indices[2]));
      if (tri.getArea() > 1e-11)
        faces.push({ tri, indices, mesh, center: tri.getMidpoint(new T.Vector3()) });
    }
  }
  if (!faces.length) return null;
  const node = (list: Face[]): Node => {
    const box = new T.Box3();
    for (const { tri } of list) {
      box.expandByPoint(tri.a);
      box.expandByPoint(tri.b);
      box.expandByPoint(tri.c);
    }
    if (list.length <= 18) return { box, list };
    const s = box.getSize(new T.Vector3());
    const axis = s.x > s.y && s.x > s.z ? "x" : s.y > s.z ? "y" : "z";
    list.sort((a, b) => a.center[axis] - b.center[axis]);
    const mid = list.length >> 1;
    return { box, children: [node(list.slice(0, mid)), node(list.slice(mid))] };
  };
  const tree = node(faces);
  const tmp = new T.Vector3();
  const nearest = (point: T.Vector3): Hit => {
    let best = Infinity;
    let face: Face | undefined;
    const closest = new T.Vector3();
    const visit = (n: Node): void => {
      if (n.box.distanceToPoint(point) ** 2 > best) return;
      if (n.list) {
        for (const entry of n.list) {
          entry.tri.closestPointToPoint(point, tmp);
          const d = point.distanceToSquared(tmp);
          if (d < best) {
            best = d;
            closest.copy(tmp);
            face = entry;
          }
        }
      } else if (n.children) {
        const [a, b] = n.children;
        if (a.box.distanceToPoint(point) < b.box.distanceToPoint(point)) {
          visit(a);
          visit(b);
        } else {
          visit(b);
          visit(a);
        }
      }
    };
    visit(tree);
    if (!face) throw new Error("A surface index has no nearest face.");
    return { point: closest, normal: face.tri.getNormal(new T.Vector3()), face };
  };
  const exterior = (point: T.Vector3, outward: T.Vector3): Hit => {
    const reach =
      tree.box.getSize(new T.Vector3()).length() + tree.box.distanceToPoint(point) + 0.01;
    const ray = new T.Ray(point.clone().addScaledVector(outward, reach), outward.clone().negate());
    let best = Infinity;
    let hit: Hit | null = null;
    const visit = (branch: Node): void => {
      if (!ray.intersectsBox(branch.box)) return;
      if (!branch.list) {
        for (const child of branch.children ?? []) visit(child);
        return;
      }
      for (const face of branch.list) {
        const tri = face.tri;
        if (!ray.intersectTriangle(tri.a, tri.b, tri.c, false, tmp)) continue;
        const distance = ray.origin.distanceToSquared(tmp);
        if (distance >= best) continue;
        best = distance;
        const normal = tri.getNormal(new T.Vector3());
        if (normal.dot(outward) < 0) normal.negate();
        hit = { point: tmp.clone(), normal, face };
      }
    };
    visit(tree);
    return hit ?? nearest(point);
  };
  return { nearest, exterior };
}

/** Keep a vertex through game mesh reduction. */
function pinVertex(mesh: T.Mesh, index: number): void {
  let pins = mesh.geometry.getAttribute("lodAnchor");
  if (!pins) {
    pins = new T.BufferAttribute(new Uint8Array(mesh.geometry.getAttribute("position").count), 1);
    mesh.geometry.setAttribute("lodAnchor", pins);
  }
  pins.setX(index, 1);
}

function rootIndices(
  geometry: T.BufferGeometry,
  join: FigureJoin,
  cageFaces: JoinState["cageFaces"],
): Set<number> {
  const ids = new Set<number>();
  if (join.faces) {
    const faceSet = new Set(join.faces);
    const index = geometry.index;
    if (index)
      cageFaces.get(geometry)?.forEach((face, k) => {
        if (faceSet.has(face)) for (let j = 0; j < 3; j++) ids.add(index.getX(k * 3 + j));
      });
    return ids;
  }
  const uv = geometry.getAttribute("uv");
  if (!uv) return ids;
  if (join.end === "base") {
    for (let i = 0; i < uv.count; i++) {
      const u = uv.getX(i);
      const v = uv.getY(i);
      if (v >= 0.72 && v <= 0.84 && u >= 0.36 && u <= 0.64) ids.add(i);
    }
    return ids;
  }
  for (let i = 0; i < uv.count; i++) {
    const t = uv.getY(i);
    if (
      (join.end !== "last" && Math.abs(t) < 1e-6) ||
      (join.end !== "first" && Math.abs(1 - t) < 1e-6)
    )
      ids.add(i);
  }
  return ids;
}

function tableFor(count: number, source: BlendOwners | undefined, owner: string): Table {
  return source
    ? {
        ids: [...source.ids],
        first: source.first.slice(),
        second: source.second.slice(),
        weight: source.weight.slice(),
      }
    : {
        ids: [owner],
        first: new Uint8Array(count),
        second: new Uint8Array(count),
        weight: new Float32Array(count).fill(1),
      };
}

function addRank(ranks: Ranks, id: string | undefined, weight: number): void {
  if (id !== undefined && weight > 0) ranks.set(id, (ranks.get(id) ?? 0) + weight);
}

function readRanks(ranks: Ranks, table: BlendOwners, i: number, factor: number): void {
  const weight = table.weight[i] ?? 1;
  addRank(ranks, table.ids[table.first[i] ?? 0], factor * weight);
  addRank(ranks, table.ids[table.second[i] ?? 0], factor * (1 - weight));
}

function writeRanks(table: Table, i: number, ranks: Ranks): void {
  const strongest = [...ranks].sort((a, b) => b[1] - a[1]).slice(0, 2);
  const [first, second = first] = strongest;
  if (!first || !second) return;
  const index = (id: string): number => {
    let j = table.ids.indexOf(id);
    if (j < 0) {
      j = table.ids.length;
      table.ids.push(id);
    }
    return j;
  };
  table.first[i] = index(first[0]);
  table.second[i] = index(second[0]);
  table.weight[i] = strongest.length === 1 ? 1 : first[1] / (first[1] + second[1]);
}

function atCarrier(hit: Hit, carrier: string, owners: JoinState["owners"]): Ranks {
  const table = owners.get(hit.face.mesh);
  const ranks: Ranks = new Map();
  if (!table) ranks.set(carrier, 1);
  else {
    const bary = hit.face.tri.getBarycoord(hit.point, new T.Vector3());
    hit.face.indices.forEach((i, k) =>
      readRanks(ranks, table, i, Math.max(0, bary?.getComponent(k) ?? 0)),
    );
  }
  return ranks;
}

/**
 * Textile piping, a fin ray or a raised stripe follows the carrier along its
 * whole path. Each cross section moves as one to keep its thickness.
 */
function seatStrip(
  mesh: T.Mesh,
  carrier: string,
  join: FigureJoin,
  index: SurfaceIndex,
  state: JoinState,
): void {
  const g = mesh.geometry;
  const pos = g.getAttribute("position");
  const uv = g.getAttribute("uv");
  if (!uv) return;
  const rows = new Map<number, number[]>();
  const world: T.Vector3[] = [];
  const inverse = mesh.matrixWorld.clone().invert();
  for (let i = 0; i < pos.count; i++) {
    const t = uv.getY(i);
    const row = rows.get(t) ?? [];
    if (!rows.has(t)) rows.set(t, row);
    row.push(i);
    world.push(new T.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld));
  }
  const table = tableFor(pos.count, undefined, carrier);
  const worldOf = (i: number): T.Vector3 => {
    const p = world[i];
    if (!p) throw new Error("A strip vertex is out of range.");
    return p;
  };
  for (const indices of rows.values()) {
    const mid = new T.Vector3();
    let count = 0;
    for (const i of indices)
      if (uv.getX(i) < 0.99999) {
        mid.add(worldOf(i));
        count++;
      }
    if (!count) continue;
    mid.divideScalar(count);
    const hit = index.nearest(mid);
    let radius = 0;
    for (const i of indices)
      radius = Math.max(radius, Math.abs(hit.normal.dot(worldOf(i).clone().sub(mid))));
    const offset = hit.point
      .clone()
      .addScaledVector(hit.normal, Math.max(0, radius - join.depth))
      .sub(mid);
    const ranks = atCarrier(hit, carrier, state.owners);
    for (const i of indices) {
      const p = worldOf(i).add(offset).applyMatrix4(inverse);
      pos.setXYZ(i, p.x, p.y, p.z);
      writeRanks(table, i, ranks);
    }
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  state.owners.set(mesh, table);
}

interface Anchor {
  readonly at: T.Vector3;
  readonly delta: T.Vector3;
  readonly ranks: Ranks;
}

/**
 * Move the root patch onto the carrier and blend the rest of the part, with
 * everything attached to it, smoothly toward that offset and ownership.
 */
function seatBranch(
  mesh: T.Mesh,
  id: string,
  carrier: string,
  join: FigureJoin,
  index: SurfaceIndex,
  state: JoinState,
  retainMount: boolean,
): void {
  const geometry = mesh.geometry;
  const pos = geometry.getAttribute("position");
  if (!pos) return;
  const indices = rootIndices(geometry, join, state.cageFaces);
  if (!indices.size) return;
  const anchors: Anchor[] = [];
  const unique = new Set<string>();
  let gap = 0;
  for (const i of indices) {
    const at = new T.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    const key = at
      .toArray()
      .map((x) => Math.round(x * 1e6))
      .join(",");
    if (unique.has(key)) continue;
    unique.add(key);
    const hit = index.nearest(at);
    const delta = hit.point.clone().addScaledVector(hit.normal, -join.depth).sub(at);
    if (retainMount) {
      // Keep the seated patch and its carrier triangles during mesh reduction.
      pinVertex(mesh, i);
      for (const vertex of hit.face.indices) pinVertex(hit.face.mesh, vertex);
    }
    gap = Math.max(gap, delta.length());
    anchors.push({ at, delta, ranks: atCarrier(hit, carrier, state.owners) });
  }
  geometry.computeBoundingBox();
  const extent = (geometry.boundingBox ?? new T.Box3())
    .clone()
    .applyMatrix4(mesh.matrixWorld)
    .getSize(new T.Vector3())
    .length();
  const radius = Math.max(0.012, 0.34 * extent, Math.min(gap * 1.25, 0.7 * extent));
  const distances = new Float64Array(anchors.length);
  const point = new T.Vector3();
  const delta = new T.Vector3();
  const inv = new T.Matrix4();
  const deform = (node: T.Object3D, parentOwner: string): void => {
    const owner = partIdOf(node) ?? parentOwner;
    const p = isMesh(node) ? node.geometry.getAttribute("position") : undefined;
    if (isMesh(node) && p) {
      const g = node.geometry;
      const table = tableFor(p.count, state.owners.get(node), owner);
      inv.copy(node.matrixWorld).invert();
      let touched = false;
      for (let i = 0; i < p.count; i++) {
        point.fromBufferAttribute(p, i).applyMatrix4(node.matrixWorld);
        let closest = 0;
        let min = Infinity;
        for (let j = 0; j < anchors.length; j++) {
          const d = point.distanceToSquared(anchors[j]?.at ?? point);
          distances[j] = d;
          if (d < min) {
            min = d;
            closest = j;
          }
        }
        const reach = 1 - T.MathUtils.smoothstep(Math.sqrt(min), 0, radius);
        if (reach <= 0) continue;
        const nearestAnchor = anchors[closest];
        if (!nearestAnchor) continue;
        if (min < 1e-10) delta.copy(nearestAnchor.delta);
        else {
          delta.set(0, 0, 0);
          let sum = 0;
          const scale = Math.max(min * 3, (radius * 0.08) ** 2);
          anchors.forEach((a, j) => {
            const rel = ((distances[j] ?? 0) - min) / scale;
            if (rel > 8) return;
            const w = Math.exp(-rel);
            delta.addScaledVector(a.delta, w);
            sum += w;
          });
          delta.divideScalar(sum);
        }
        point.addScaledVector(delta, reach).applyMatrix4(inv);
        p.setXYZ(i, point.x, point.y, point.z);
        const ranks: Ranks = new Map();
        readRanks(ranks, table, i, 1 - reach);
        for (const [rankId, w] of nearestAnchor.ranks) addRank(ranks, rankId, reach * w);
        writeRanks(table, i, ranks);
        touched = true;
      }
      if (touched) {
        p.needsUpdate = true;
        g.computeVertexNormals();
        g.computeBoundingBox();
        g.computeBoundingSphere();
        state.owners.set(node, table);
      }
    }
    for (const c of node.children) deform(c, owner);
  };
  deform(mesh, id);
}

/**
 * Turn a scute so its outer face follows the carrier, sink its base pin to the
 * join depth, then seat its base patch.
 */
function seatPlate(
  mesh: T.Mesh,
  id: string,
  carrier: string,
  join: FigureJoin,
  index: SurfaceIndex,
  state: JoinState,
  retainMount: boolean,
): void {
  const parent = mesh.parent;
  if (!parent) return;
  const pin = new T.Vector3(0, 0.27, -0.11);
  const worldPin = mesh.localToWorld(pin.clone());
  const outward = new T.Vector3(0, 0, 1).transformDirection(mesh.matrixWorld);
  const hit = index.exterior(worldPin, outward);
  const rotation = new T.Quaternion().setFromUnitVectors(outward, hit.normal);
  const worldRotation = rotation.multiply(mesh.getWorldQuaternion(new T.Quaternion()));
  mesh.quaternion
    .copy(parent.getWorldQuaternion(new T.Quaternion()).invert())
    .multiply(worldRotation);
  mesh.updateWorldMatrix(true, false);
  const target = hit.point.clone().addScaledVector(hit.normal, -join.depth);
  const delta = parent.worldToLocal(target).sub(parent.worldToLocal(mesh.localToWorld(pin)));
  mesh.position.add(delta);
  mesh.updateWorldMatrix(true, true);
  seatBranch(mesh, id, carrier, join, index, state, retainMount);
}

/**
 * Seat every joined part on its parent, shallowest first, so a root seated on
 * a part that was itself joined meets its final surface.
 *
 * With `retainMount` (game detail) a scute's seated base, or a grown plate's
 * socket on an animated plated axis, and the carrier triangles under it are
 * pinned through mesh reduction. Parts on rigid face
 * hardware or fibre guides, and their children, seat after the face fits
 * (`afterFaceFits`), the rest before.
 */
export function fitSurfaceJoins(
  parts: ReadonlyArray<BuildPart>,
  objects: ReadonlyMap<string, T.Object3D>,
  state: JoinState,
  retainMount: boolean,
  afterFaceFits = false,
): void {
  const byId = new Map(parts.map((p) => [p.id, p]));
  const late = (part: BuildPart): boolean => {
    for (
      let p: BuildPart | undefined = part;
      p;
      p = p.parent === null ? undefined : byId.get(p.parent)
    )
      if (p.faceAnchor || p.fibres) return true;
    return false;
  };
  const depth = (part: BuildPart): number => {
    let n = 0;
    for (let p: BuildPart | undefined = part; p && p.parent !== null; p = byId.get(p.parent)) n++;
    return n;
  };
  const chosen = parts
    .filter((p) => p.join && late(p) === afterFaceFits)
    .sort((a, b) => depth(a) - depth(b));
  const indices = new Map<T.Object3D, SurfaceIndex | null>();
  for (const part of chosen) {
    const join = part.join;
    const mesh = objects.get(part.id);
    const carrier = part.parent === null ? undefined : objects.get(part.parent);
    if (!join || part.parent === null || !mesh || !isMesh(mesh) || !mesh.visible) continue;
    if (!carrier?.visible) continue;
    mesh.updateWorldMatrix(true, true);
    carrier.updateWorldMatrix(true, true);
    if (!indices.has(carrier)) indices.set(carrier, surfaceIndex(carrier));
    const index = indices.get(carrier);
    if (!index) continue;
    if (join.end === "base") seatPlate(mesh, part.id, part.parent, join, index, state, retainMount);
    else if (join.end === "along") seatStrip(mesh, part.parent, join, index, state);
    // A plate on an animated plated axis keeps its socket through mesh reduction.
    else
      seatBranch(
        mesh,
        part.id,
        part.parent,
        join,
        index,
        state,
        retainMount && Boolean(part.plateSite) && hasPlatedAxis(byId.get(part.parent)),
      );
  }
}
