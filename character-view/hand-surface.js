import {
  BufferGeometry,
  Float32BufferAttribute,
  MeshBasicMaterial,
  Vector3,
} from "three";
import { MarchingCubes } from "three/addons/objects/MarchingCubes.js";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
const material = new MeshBasicMaterial();
const mix = (a, b, t) => a + (b - a) * t;
const clamp = (t) => Math.max(0, Math.min(1, t));
function segments(rows) {
  return rows.slice(1).map((b, i) => {
    const a = rows[i],
      ratio = (a[3] + b[3]) / (a[4] + b[4]);
    const dx = b[0] - a[0],
      dy = b[1] - a[1],
      dz = (b[2] - a[2]) * ratio;
    return {
      a,
      b,
      ratio,
      dx,
      dy,
      dz,
      inv: 1 / (dx * dx + dy * dy + dz * dz || 1),
    };
  });
}
function palmDistance(palm, x, y, z) {
  let i = 0;
  while (i < palm.length - 2 && y < palm[i + 1][1]) i++;
  const a = palm[i],
    b = palm[i + 1],
    t = clamp((y - a[1]) / (b[1] - a[1]));
  const rx = mix(a[3], b[3], t),
    rz = mix(a[4], b[4], t);
  const dx = (x - mix(a[0], b[0], t)) / rx,
    dz = (z - mix(a[2], b[2], t)) / rz,
    dy = (y - mix(a[1], b[1], t)) / 0.009;
  return (1 - Math.hypot(dx, dy, dz)) * Math.min(rx, rz);
}
// A rounded palm and tapered phalanges share one surface at the webbing.
// Sample in metres so long, slim or curled fingers keep their cross sections.
export function handSurface(palm, digits, dimensions) {
  const n = 50,
    chains = digits.map((d) => segments(d.rows));
  const lo = [Infinity, Infinity, Infinity],
    hi = [-Infinity, -Infinity, -Infinity];
  for (const [i, rows] of [palm, ...digits.map((d) => d.rows)].entries())
    for (const a of rows) {
      const extent = [
        a[3] + 0.005,
        (i ? Math.max(a[3], a[4]) : 0.01) + 0.004,
        a[4] + 0.005,
      ];
      for (let k = 0; k < 3; k++) {
        lo[k] = Math.min(lo[k], a[k] - extent[k]);
        hi[k] = Math.max(hi[k], a[k] + extent[k]);
      }
    }
  const span = hi.map((v, i) => v - lo[i]),
    step = span.map((v) => v / n);
  let owner = -1,
    along = 0;
  function field(x, y, z) {
    const palmField = palmDistance(palm, x, y, z);
    let best = -1,
      which = -1,
      tAlong = 0;
    for (let j = 0; j < chains.length; j++) {
      for (let k = 0; k < chains[j].length; k++) {
        const { a, b, ratio, dx, dy, dz, inv } = chains[j][k];
        const px = x - a[0],
          py = y - a[1],
          pz = (z - a[2]) * ratio;
        const t = clamp((px * dx + py * dy + pz * dz) * inv);
        const distance =
          mix(a[3], b[3], t) -
          Math.sqrt(
            (px - t * dx) ** 2 + (py - t * dy) ** 2 + (pz - t * dz) ** 2,
          );
        if (distance > best) {
          best = distance;
          which = j;
          tAlong = k + t;
        }
      }
    }
    owner = best >= palmField - 0.0014 ? which : -1;
    along = tAlong;
    const blend =
      0.0036 * Math.max(0, 1 - Math.abs(palmField - best) / 0.0036) ** 2 * 0.25;
    return Math.max(palmField, best) + blend;
  }
  const mc = new MarchingCubes(n, material, false, false, 24 * n * n);
  mc.isolation = 0;
  mc.field.fill(-0.02);
  for (let k = 1; k < n - 1; k++)
    for (let j = 1; j < n - 1; j++)
      for (let i = 1; i < n - 1; i++)
        mc.field[i + n * (j + n * k)] = field(
          lo[0] + i * step[0],
          lo[1] + j * step[1],
          lo[2] + k * step[2],
        );
  mc.update();
  const pos = new Float32Array(mc.count * 3),
    normal = new Float32Array(mc.count * 3),
    uv = new Float32Array(mc.count * 2),
    v = new Vector3();
  for (let i = 0; i < mc.count; i++) {
    for (let a = 0; a < 3; a++)
      pos[3 * i + a] =
        lo[a] + (1 + mc.positionArray[3 * i + a]) * 0.5 * span[a];
    v.fromArray(mc.normalArray, 3 * i)
      .set(v.x / span[0], v.y / span[1], v.z / span[2])
      .normalize()
      .toArray(normal, 3 * i);
    uv[2 * i] = (pos[3 * i] - lo[0]) / span[0];
    uv[2 * i + 1] = (pos[3 * i + 1] - lo[1]) / span[1];
  }
  mc.geometry.dispose();
  const raw = new BufferGeometry();
  raw.setAttribute("position", new Float32BufferAttribute(pos, 3));
  raw.setAttribute("normal", new Float32BufferAttribute(normal, 3));
  raw.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  const g = mergeVertices(raw, 0.000001);
  raw.dispose();
  const rig = digits.map((d) => ({
    name: d.name,
    anchors: d.rows
      .slice(0, 3)
      .map((row) => row.slice(0, 3).map((v, i) => v / dimensions[i])),
    vertices: [],
    parameters: [],
  }));
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    field(p.getX(i), p.getY(i), p.getZ(i));
    if (owner >= 0) {
      rig[owner].vertices.push(i);
      rig[owner].parameters.push(along);
    }
  }
  g.scale(...dimensions.map((n) => 1 / n));
  g.handRig = rig;
  return g;
}
