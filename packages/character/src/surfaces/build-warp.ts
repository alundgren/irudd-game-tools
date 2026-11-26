// The whole-body build warp. Ported from sculptBuild in
// character-view/body-sculpt.js and bodyFrame in character-view/graft.js at
// 2761eb1. Section profiles are not ported.
//
// Each build axis widens or narrows the body around one height band of its
// frame. Part pivots move with the warp, and every mesh is warped in world
// space, so attachments stay on the surface they hung from.

import * as T from "three";
import { buildAxes, type FigureBuild } from "@irudd/document";
import type { BuildPart } from "../view.js";
import type { BlendOwners } from "./blend.js";
import { isMesh } from "../mesh.js";
import { sweepGeometry } from "./sweep.js";
import { mantleGeometry } from "./mantle.js";
import { skirtGeometry } from "./skirt.js";
import { volumeBounds } from "./volume.js";

/** A built part as the warp reads it: its typed view and its mesh. */
interface WarpPart {
  readonly part: BuildPart;
  readonly object: T.Object3D;
}

const bell = (y: number, c: number, r: number): number => Math.exp(-(((y - c) / r) ** 2));

type Corner = readonly [number, number, number];
/** The rest boxes of the built-in pieces, in part coordinates. From anatomyBoxes in graft.js. */
const pieceBoxes: Readonly<Record<string, readonly [Corner, Corner]>> = {
  head: [
    [-0.12, -0.05, -0.12],
    [0.12, 0.37, 0.14],
  ],
  torso: [
    [-0.21, -0.1, -0.16],
    [0.21, 0.59, 0.16],
  ],
  "left arm": [
    [-0.073, -0.55, -0.09],
    [0.15, 0.08, 0.13],
  ],
  "right arm": [
    [-0.15, -0.55, -0.09],
    [0.073, 0.08, 0.13],
  ],
  "left leg": [
    [-0.1, -0.85, -0.12],
    [0.106, 0.027, 0.18],
  ],
  "right leg": [
    [-0.106, -0.85, -0.12],
    [0.1, 0.027, 0.18],
  ],
};
const handBox: readonly [Corner, Corner] = [
  [-0.62, -1, -0.6],
  [0.55, 0, 0.8],
];
const unitBox: readonly [Corner, Corner] = [
  [-0.5, -0.5, -0.5],
  [0.5, 0.5, 0.5],
];

/**
 * The world bounds of a frame part that is not a sweep, as bounds in
 * graft.js measures it: a cage's points, a mantle's panel, a hull's box, a
 * built-in piece's or a hand's rest box, else the unit box.
 */
function restBounds(part: BuildPart, world: T.Matrix4): T.Box3 {
  if (part.cage) {
    const box = new T.Box3().makeEmpty();
    const point = new T.Vector3();
    for (const vertex of part.cage.vertices)
      box.expandByPoint(point.fromArray(vertex).applyMatrix4(world));
    return box;
  }
  if (part.mantle) {
    const geometry =
      part.mantle.kind === "Skirt"
        ? skirtGeometry(part.mantle).geometry
        : mantleGeometry(part.mantle);
    geometry.computeBoundingBox();
    const box = (geometry.boundingBox ?? new T.Box3()).clone().applyMatrix4(world);
    geometry.dispose();
    return box;
  }
  const [a, b] = part.volume
    ? volumeBounds(part.volume.hull)
    : ((part.piece && pieceBoxes[part.piece.piece]) ?? (part.hand ? handBox : unitBox));
  return new T.Box3(new T.Vector3(...a), new T.Vector3(...b)).applyMatrix4(world);
}

/** Rest bounds of the frame parts, as bodyFrame measures them. */
function bodyFrame(build: FigureBuild, parts: ReadonlyMap<string, WarpPart>): T.Box3 {
  const box = new T.Box3().makeEmpty();
  for (const id of build.frame) {
    const built = parts.get(id);
    if (!built) continue;
    const world = built.object.matrixWorld;
    if (built.part.sweep) {
      const paint = built.part.paint;
      const geometry = sweepGeometry(
        built.part.sweep.knots,
        Boolean(paint) && paint?.trace.frame !== "path",
        12,
      );
      geometry.applyMatrix4(world);
      geometry.computeBoundingBox();
      if (geometry.boundingBox) box.union(geometry.boundingBox);
      geometry.dispose();
    } else box.union(restBounds(built.part, world));
  }
  return box;
}

/**
 * The build warp as a map of rest world points, or undefined when every axis
 * is 1. `root` must still be at rest.
 */
export function buildWarp(
  root: T.Object3D,
  build: FigureBuild,
  parts: ReadonlyMap<string, WarpPart>,
): ((v: T.Vector3) => T.Vector3) | undefined {
  const amount = (key: (typeof buildAxes)[number]): number => build[key] ?? 1;
  if (!buildAxes.some((k) => amount(k) !== 1)) return undefined;
  root.updateMatrixWorld(true);
  const box = bodyFrame(build, parts);
  const center = box.getCenter(new T.Vector3());
  const extent = box.getSize(new T.Vector3());
  const delta = (key: (typeof buildAxes)[number]): number => amount(key) - 1;
  return (v: T.Vector3): T.Vector3 => {
    const y = (v.y - box.min.y) / Math.max(0.001, extent.y);
    const x = v.x - center.x;
    const z = v.z - center.z;
    const body = bell(y, 0.55, 0.35);
    const waist = bell(y, 0.6, 0.14);
    const hip = bell(y, 0.47, 0.13);
    const upper = bell(y, 0.76, 0.13);
    v.x =
      center.x +
      x *
        (1 +
          0.47 * delta("mass") * body +
          0.49 * delta("hips") * hip +
          0.59 * delta("shoulders") * upper +
          0.58 * delta("waist") * waist);
    v.z =
      center.z +
      z *
        (1 +
          0.5 * delta("mass") * body +
          0.35 * delta("hips") * hip +
          0.28 * delta("waist") * waist) +
      0.39 *
        extent.z *
        delta("belly") *
        waist *
        Math.max(0.1, Math.min(1, 0.5 + z / Math.max(0.001, extent.z)));
    return v;
  };
}

/**
 * Warp a built character in place: each part's pivot moves to the warped
 * point of its rest pivot, so its rotation and scale stay as placed, and every
 * mesh is warped in world space. Returns the warp, if any.
 */
export function warpBuild(
  root: T.Object3D,
  build: FigureBuild,
  parts: ReadonlyMap<string, WarpPart>,
  blendOwners: ReadonlyMap<T.Mesh, BlendOwners>,
): ((v: T.Vector3) => T.Vector3) | undefined {
  const warp = buildWarp(root, build, parts);
  if (!warp) return undefined;
  const meshes: Array<readonly [T.Mesh, T.Matrix4]> = [];
  const pivots: Array<readonly [T.Object3D, T.Vector3]> = [];
  root.traverse((o) => {
    if (isMesh(o)) meshes.push([o, o.matrixWorld.clone()]);
    if (o.userData["partId"] !== undefined) pivots.push([o, o.getWorldPosition(new T.Vector3())]);
  });
  for (const [object, original] of pivots) {
    if (!object.parent) continue;
    object.position.copy(object.parent.worldToLocal(warp(original.clone())));
    object.updateWorldMatrix(false, true);
  }
  const inverse = new T.Matrix4();
  const normal = new T.Vector3();
  const tangent = new T.Vector3();
  const bitangent = new T.Vector3();
  const before = new T.Vector3();
  const after = new T.Vector3();
  const up = new T.Vector3(0, 1, 0);
  const right = new T.Vector3(1, 0, 0);
  for (const [mesh, original] of meshes) {
    const rest = mesh.geometry;
    mesh.geometry = rest.clone();
    rest.dispose();
    const pos = mesh.geometry.getAttribute("position");
    const normals = mesh.geometry.getAttribute("normal");
    inverse.copy(mesh.matrixWorld).invert();
    const smooth = blendOwners.has(mesh);
    const deform = (v: T.Vector3): T.Vector3 =>
      warp(v.applyMatrix4(original)).applyMatrix4(inverse);
    for (let i = 0; i < pos.count; i++) {
      before.fromBufferAttribute(pos, i);
      after.copy(before);
      deform(after);
      if (smooth) {
        // Joined triangles are split between independently editable regions.
        // Carry the shared normal through the warp rather than shading each
        // triangle independently and leaving a faceted line at the joint.
        normal.fromBufferAttribute(normals, i).normalize();
        tangent.crossVectors(Math.abs(normal.y) < 0.8 ? up : right, normal).normalize();
        bitangent.crossVectors(normal, tangent);
        tangent.multiplyScalar(0.0001).add(before);
        bitangent.multiplyScalar(0.0001).add(before);
        deform(tangent).sub(after);
        deform(bitangent).sub(after);
        normal.crossVectors(tangent, bitangent).normalize();
        normals.setXYZ(i, normal.x, normal.y, normal.z);
      }
      pos.setXYZ(i, after.x, after.y, after.z);
    }
    pos.needsUpdate = true;
    if (smooth) normals.needsUpdate = true;
    else mesh.geometry.computeVertexNormals();
    mesh.geometry.computeBoundingBox();
    mesh.geometry.computeBoundingSphere();
  }
  return warp;
}
