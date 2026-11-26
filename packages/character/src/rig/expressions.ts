// Facial expressions: Blink, Smile and BrowLift morph targets on face
// surfaces, and eyelids that close over the painted eyes. Ported from
// character-view/expressions.js and eyelids.js at 2761eb1, arithmetic in the
// same order so the targets match.

import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { HeadSpace } from "../surfaces/face.js";

export const expressions = ["Blink", "Smile", "BrowLift"] as const;

const bell = (v: number, r: number) => Math.exp(-((v / r) ** 2));

interface Probe {
  readonly z: number;
  readonly u: number;
  readonly v: number;
}

interface Triangle {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly ax: number;
  readonly ay: number;
  readonly dx: number;
  readonly dy: number;
  readonly ex: number;
  readonly ey: number;
  readonly det: number;
}

/**
 * The frontmost surface point and its painted UV at (x, y). Spatial buckets
 * keep sampling the moving eyelids independent of the face's tessellation.
 */
export function faceProjector(g: T.BufferGeometry): (x: number, y: number) => Probe | undefined {
  const pos = g.getAttribute("position");
  const uv = g.getAttribute("uv");
  const idx = g.index;
  const box = g.boundingBox ?? new T.Box3();
  const min = box.min;
  const span = box.getSize(new T.Vector3());
  const n = 36;
  const buckets = Array.from({ length: n * n }, (): Triangle[] => []);
  const cell = (v: number, low: number, width: number) =>
    Math.max(0, Math.min(n - 1, Math.floor(((v - low) / width) * n)));
  for (let k = 0; k < (idx?.count ?? pos.count); k += 3) {
    const a = idx ? idx.getX(k) : k;
    const b = idx ? idx.getX(k + 1) : k + 1;
    const c = idx ? idx.getX(k + 2) : k + 2;
    const ax = pos.getX(a);
    const ay = pos.getY(a);
    const bx = pos.getX(b);
    const by = pos.getY(b);
    const cx = pos.getX(c);
    const cy = pos.getY(c);
    const det = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
    if (det < 1e-10) continue;
    const tri = { a, b, c, ax, ay, dx: bx - ax, dy: by - ay, ex: cx - ax, ey: cy - ay, det };
    const x0 = cell(Math.min(ax, bx, cx), min.x, span.x);
    const x1 = cell(Math.max(ax, bx, cx), min.x, span.x);
    const y0 = cell(Math.min(ay, by, cy), min.y, span.y);
    const y1 = cell(Math.max(ay, by, cy), min.y, span.y);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) buckets[x + n * y]?.push(tri);
  }
  return (x, y) => {
    let best: Probe | undefined;
    const list = buckets[cell(x, min.x, span.x) + n * cell(y, min.y, span.y)] ?? [];
    for (const { a, b, c, ax, ay, dx, dy, ex, ey, det } of list) {
      const s = ((x - ax) * ey - (y - ay) * ex) / det;
      const t = (dx * (y - ay) - dy * (x - ax)) / det;
      if (s < -0.00001 || t < -0.00001 || s + t > 1.00001) continue;
      const u = 1 - s - t;
      const z = u * pos.getZ(a) + s * pos.getZ(b) + t * pos.getZ(c);
      if (!best || z > best.z)
        best = {
          z,
          u: u * uv.getX(a) + s * uv.getX(b) + t * uv.getX(c),
          v: u * uv.getY(a) + s * uv.getY(b) + t * uv.getY(c),
        };
    }
    return best;
  };
}

/**
 * Add a strip of lid over each eye, textured from the skin just below it,
 * and the offsets that close it. Undefined when the face cannot carry them.
 */
function addEyelids(
  mesh: T.Mesh,
  paint: HeadSpace | undefined,
): { readonly start: number; readonly delta: number[] } | undefined {
  const g = mesh.geometry;
  g.computeBoundingBox();
  const b = g.boundingBox ?? new T.Box3();
  const dim = b.getSize(new T.Vector3());
  const c = b.getCenter(new T.Vector3());
  const face = paint?.portrait;
  const h = face && paint ? paint.height : dim.y;
  const half = face ? face.width * h : dim.x * 0.5;
  const cx = face && paint ? face.center * h - paint.offset[0] : c.x;
  const y = face && paint ? face.eyes * h - paint.offset[1] : b.min.y + 0.566 * h;
  const probe = faceProjector(g);
  const p: number[] = [];
  const uv: number[] = [];
  const delta: number[] = [];
  const indices: number[] = [];
  const columns = 26;
  const rows = 7;
  const span = 0.249 * half;
  const along = 0.425 * half;
  for (const sign of [-1, 1]) {
    const start = p.length / 3;
    for (let j = 0; j <= rows; j++)
      for (let i = 0; i <= columns; i++) {
        const t = j / rows;
        const u = (i / columns) * 2 - 1;
        const arc = Math.sqrt(Math.max(0.001, 1 - u * u));
        const x = cx + sign * along + span * u;
        const eyeLine = y + h * (0.005 * sign * u);
        const upper = eyeLine + h * 0.03 * arc;
        const lower = eyeLine - h * 0.032 * arc;
        const restY = upper + h * (0.006 - 0.004 * t) * arc;
        const closedY = upper + (lower - upper) * t;
        const a = probe(x, restY);
        const closed = probe(x, closedY);
        const skin = probe(x, eyeLine - h * (0.055 + 0.019 * t) * arc - 0.012 * h);
        if (!a || !closed || !skin) return undefined;
        const restZ = a.z - h * 0.004;
        const closedZ = closed.z + h * (0.01 + 0.012 * Math.sin(Math.PI * t) * arc);
        p.push(x, restY, restZ);
        delta.push(0, closedY - restY, closedZ - restZ);
        uv.push(skin.u, skin.v);
        if (j < rows && i < columns) {
          const k = start + j * (columns + 1) + i;
          const next = k + columns + 1;
          indices.push(k, next, k + 1, k + 1, next, next + 1);
        }
      }
  }
  const lids = new T.BufferGeometry();
  lids.setAttribute("position", new T.Float32BufferAttribute(p, 3));
  lids.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
  lids.setIndex(indices);
  lids.computeVertexNormals();
  const merged = mergeGeometries([g, lids]);
  lids.dispose();
  if (!merged) return undefined;
  mesh.geometry = merged;
  g.dispose();
  merged.computeBoundingBox();
  return { start: g.getAttribute("position").count, delta };
}

function buildTargets(mesh: T.Mesh, paint: HeadSpace | undefined): void {
  if (mesh.geometry.morphAttributes["position"]?.length) {
    if (!mesh.morphTargetDictionary) mesh.updateMorphTargets();
    return;
  }
  // Fitted eyes carry their own lids, so the face itself does not blink.
  const fitted = Boolean(mesh.userData["fittedEyes"]);
  const lids = fitted ? undefined : addEyelids(mesh, paint);
  const geometry = mesh.geometry;
  geometry.computeBoundingBox();
  const pos = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const box = geometry.boundingBox ?? new T.Box3();
  const size = box.getSize(new T.Vector3());
  const centre = box.getCenter(new T.Vector3());
  const face = paint?.portrait;
  const h = face && paint ? paint.height : size.y;
  const eyeY = face?.eyes ?? 0.566;
  const mouthY = face?.mouth ?? 0.25;
  const changes = expressions.map(() => new Float32Array(pos.count * 3));
  const [blink, smile, brow] = changes;
  if (!blink || !smile || !brow) return;
  for (let i = 0; i < pos.count; i++) {
    const px = pos.getX(i);
    const py = pos.getY(i);
    const pz = pos.getZ(i);
    const x =
      face && paint
        ? ((px + paint.offset[0]) / h - face.center) / face.width
        : (px - centre.x) / (size.x * 0.5 || 1);
    const y = face && paint ? (py + paint.offset[1]) / h : (py - box.min.y) / (h || 1);
    const front = T.MathUtils.smoothstep((pz - centre.z) / (size.z * 0.5 || 1), 0.02, 0.66);
    if (!front) continue;
    const ex = (Math.abs(x) - 0.425) / 0.26;
    const ey = y - eyeY - 0.008 * ex;
    const side = Math.sign(x);
    const aperture = (1 - T.MathUtils.smoothstep(Math.abs(ex), 0.72, 1.18)) * front;
    const lid = aperture * (1 - T.MathUtils.smoothstep(Math.abs(ey), 0.033, 0.082));
    blink[3 * i + 1] = h * (-0.006 - ey * (lids ? 0.14 : 0.88)) * lid;
    blink[3 * i + 2] = h * 0.004 * lid;
    if (fitted) {
      blink[3 * i + 1] = 0;
      blink[3 * i + 2] = 0;
    }
    const mouth = front * bell(y - mouthY, 0.07);
    const corners = bell(Math.abs(x) - 0.33, 0.19) * mouth;
    smile[3 * i] = h * 0.017 * side * corners;
    smile[3 * i + 1] =
      h *
      (0.021 * corners +
        0.009 * front * bell(Math.abs(x) - 0.53, 0.22) * bell(y - (mouthY + 0.11), 0.13));
    smile[3 * i + 2] = -h * 0.01 * corners;
    const lift = front * bell(Math.abs(x) - 0.425, 0.32) * bell(y - (eyeY + 0.066), 0.05);
    brow[3 * i + 1] = h * 0.046 * lift;
    brow[3 * i + 2] = h * 0.007 * lift;
  }
  if (lids) blink.set(lids.delta, lids.start * 3);
  const normalTargets: T.BufferAttribute[] = [];
  const positionTargets = changes.map((array, j) => {
    const attr = new T.Float32BufferAttribute(array, 3);
    attr.name = expressions[j] ?? "";
    const sample = geometry.clone();
    const changed = sample.getAttribute("position");
    for (let i = 0; i < changed.count; i++)
      changed.setXYZ(
        i,
        pos.getX(i) + (array[3 * i] ?? 0),
        pos.getY(i) + (array[3 * i + 1] ?? 0),
        pos.getZ(i) + (array[3 * i + 2] ?? 0),
      );
    sample.computeVertexNormals();
    const target = sample.getAttribute("normal");
    const delta = new Float32Array(normal.count * 3);
    for (let i = 0; i < normal.count; i++) {
      delta[3 * i] = target.getX(i) - normal.getX(i);
      delta[3 * i + 1] = target.getY(i) - normal.getY(i);
      delta[3 * i + 2] = target.getZ(i) - normal.getZ(i);
    }
    const norm = new T.Float32BufferAttribute(delta, 3);
    norm.name = expressions[j] ?? "";
    normalTargets.push(norm);
    sample.dispose();
    return attr;
  });
  geometry.morphTargetsRelative = true;
  geometry.morphAttributes["position"] = positionTargets;
  geometry.morphAttributes["normal"] = normalTargets;
  mesh.updateMorphTargets();
}

/** Give every face surface its expressions, once. */
export function prepareExpressions(faces: ReadonlyMap<T.Mesh, HeadSpace | undefined>): void {
  for (const [mesh, paint] of faces) buildTargets(mesh, paint);
}

/**
 * The skin is exported in world coordinates. Transform pose displacements
 * as vectors and rebuild each normal delta against the transformed rest normal.
 */
export function worldMorphs(geometry: T.BufferGeometry, source: T.Mesh): void {
  const positions = geometry.morphAttributes["position"];
  if (!positions?.length) return;
  const linear = new T.Matrix3().setFromMatrix4(source.matrixWorld);
  const normalMatrix = new T.Matrix3().getNormalMatrix(source.matrixWorld);
  const v = new T.Vector3();
  const rest = new T.Vector3();
  const localRest = source.geometry.getAttribute("normal");
  for (const p of positions)
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix3(linear);
      p.setXYZ(i, v.x, v.y, v.z);
    }
  for (const p of geometry.morphAttributes["normal"] ?? [])
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i)
        .add(rest.fromBufferAttribute(localRest, i))
        .applyNormalMatrix(normalMatrix);
      v.sub(rest.fromBufferAttribute(geometry.getAttribute("normal"), i));
      p.setXYZ(i, v.x, v.y, v.z);
    }
}
