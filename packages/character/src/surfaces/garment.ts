import * as T from "three";
import { isMesh } from "../mesh.js";

const bins = 32;
const angles = 24;
const directions = Array.from(
  { length: angles },
  (_, i) => [Math.cos((i * 2 * Math.PI) / angles), Math.sin((i * 2 * Math.PI) / angles)] as const,
);

export interface GarmentFit {
  readonly inner?: ReadonlyArray<T.Object3D>;
  readonly limbs?: ReadonlyArray<T.Object3D>;
  readonly pairedPanel?: boolean;
  readonly relief?: Float32Array;
  readonly waistClearance?: number;
}

interface Section {
  readonly x: number;
  readonly z: number;
  readonly support: number[];
}

interface WaistRow {
  readonly y: number;
  readonly ring: T.Vector3[];
  center?: T.Vector3;
  support?: number[];
}

const supportAt = (s: ReadonlyArray<number> | undefined, n: number) => s?.[n] ?? 0;

export function fitGarment(host: T.Object3D, garment: T.Mesh, options: GarmentFit = {}): void {
  const { inner = [], limbs = [], pairedPanel = false, relief, waistClearance } = options;
  host.updateWorldMatrix(true, true);
  const hostInverse = host.matrixWorld.clone().invert();
  const point = new T.Vector3();
  const cloud: T.Vector3[] = [];
  const garmentToHost = new T.Matrix4().multiplyMatrices(hostInverse, garment.matrixWorld);
  const radialWorld = new T.Vector3();
  const waistY = new T.Vector3().applyMatrix4(garmentToHost).y;
  const waistDepth = relief
    ? Math.max(
        0.001,
        Math.abs(
          waistY -
            new T.Vector3(0, (garment.geometry.boundingBox?.min.y ?? 0) * 0.2, 0).applyMatrix4(
              garmentToHost,
            ).y,
        ),
      )
    : 0;
  const waistSections: WaistRow[] = Array.from({ length: relief ? 17 : 0 }, (_, i) => ({
    y: waistY - (waistDepth * i) / 16,
    ring: [],
  }));
  const collect = (
    node: T.Object3D,
    includeParts: boolean,
    source: T.Object3D,
    fitWaist: boolean,
  ): void => {
    if (!node.visible || (!includeParts && node !== source && node.userData["partId"])) return;
    if (isMesh(node)) {
      const p = node.geometry.getAttribute("position");
      const m = new T.Matrix4().multiplyMatrices(hostInverse, node.matrixWorld);
      if (relief && fitWaist) {
        const index = node.geometry.index;
        const count = index?.count ?? p.count;
        const vertices = Array.from({ length: p.count }, (_, i) =>
          new T.Vector3().fromBufferAttribute(p, i).applyMatrix4(m),
        );
        for (let k = 0; k < count; k += 3)
          for (let j = 0; j < 3; j++) {
            const a = k + j;
            const b = k + ((j + 1) % 3);
            const pa = vertices[index ? index.getX(a) : a];
            const pb = vertices[index ? index.getX(b) : b];
            if (!pa || !pb) continue;
            const lo = Math.max(0, Math.ceil(((waistY - Math.max(pa.y, pb.y)) / waistDepth) * 16));
            const hi = Math.min(
              16,
              Math.floor(((waistY - Math.min(pa.y, pb.y)) / waistDepth) * 16),
            );
            for (let row = lo; row <= hi; row++) {
              const section = waistSections[row];
              if (!section) continue;
              const { y, ring } = section;
              if (pa.y > y !== pb.y > y) ring.push(pa.clone().lerp(pb, (y - pa.y) / (pb.y - pa.y)));
            }
          }
      }
      const stride = Math.max(1, Math.floor(p.count / 14000));
      for (let i = 0; i < p.count; i += stride)
        cloud.push(new T.Vector3().fromBufferAttribute(p, i).applyMatrix4(m));
    }
    for (const child of node.children) collect(child, includeParts, source, fitWaist);
  };
  collect(host, false, host, true);
  for (const limb of limbs) collect(limb, false, limb, false);
  for (const layer of inner) collect(layer, true, layer, true);
  if (!cloud.length) return;
  let low = Infinity;
  let high = -Infinity;
  for (const p of cloud) {
    low = Math.min(low, p.y);
    high = Math.max(high, p.y);
  }
  if (high - low < 0.001) return;
  const rows = Array.from({ length: bins }, (): T.Vector3[] => []);
  for (const p of cloud)
    rows[
      T.MathUtils.clamp(Math.round(((p.y - low) / (high - low)) * (bins - 1)), 0, bins - 1)
    ]?.push(p);
  const sections: Section[] = rows.map((_, i) => {
    let samples = rows.slice(Math.max(0, i - 1), Math.min(bins, i + 2)).flat();
    if (!samples.length) {
      let distance = 2;
      while (!samples.length && distance < bins) {
        samples = [...(rows[i - distance] ?? []), ...(rows[i + distance] ?? [])];
        distance++;
      }
    }
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (const p of samples) {
      x0 = Math.min(x0, p.x);
      x1 = Math.max(x1, p.x);
      z0 = Math.min(z0, p.z);
      z1 = Math.max(z1, p.z);
    }
    const x = (x1 + x0) / 2;
    const z = (z1 + z0) / 2;
    const support = directions.map(([dx, dz]) =>
      samples.reduce((v, p) => Math.max(v, (p.x - x) * dx + (p.z - z) * dz), 0),
    );
    return { x, z, support };
  });
  for (const row of waistSections) {
    if (!row.ring.length) continue;
    const center = new T.Vector3();
    for (const p of row.ring) center.add(p);
    row.center = center.divideScalar(row.ring.length);
    row.support = directions.map(([x, z]) =>
      row.ring.reduce((max, p) => Math.max(max, (p.x - center.x) * x + (p.z - center.z) * z), 0),
    );
  }
  garment.traverse((mesh) => {
    if (!isMesh(mesh)) return;
    const fabricRelief = mesh === garment ? relief : undefined;
    const sourcePositions = mesh.geometry.getAttribute("position");
    const geometry = mesh.geometry.clone();
    mesh.geometry = geometry;
    const positions = geometry.getAttribute("position");
    const toHost = new T.Matrix4().multiplyMatrices(hostInverse, mesh.matrixWorld);
    const fromHost = toHost.clone().invert();
    const count = pairedPanel && mesh === garment ? positions.count / 2 : positions.count;
    for (let i = 0; i < count; i++) {
      point.fromBufferAttribute(positions, i);
      if (fabricRelief) {
        point.x -= fabricRelief[2 * i] ?? 0;
        point.z -= fabricRelief[2 * i + 1] ?? 0;
      }
      point.applyMatrix4(toHost);
      if (point.y < low || point.y > high) continue;
      const f = ((point.y - low) / (high - low)) * (bins - 1);
      const j = Math.min(bins - 2, Math.floor(f));
      const a = sections[j];
      const b = sections[j + 1];
      if (!a || !b) continue;
      const t = f - j;
      const x = T.MathUtils.lerp(a.x, b.x, t);
      const z = T.MathUtils.lerp(a.z, b.z, t);
      const dx = point.x - x;
      const dz = point.z - z;
      const r = Math.hypot(dx, dz);
      if (r < 0.0001) continue;
      const ux = dx / r;
      const uz = dz / r;
      let limit = Infinity;
      for (let n = 0; n < angles; n++) {
        const [cx, cz] = directions[n] ?? [0, 0];
        const dot = ux * cx + uz * cz;
        if (dot > 0.1)
          limit = Math.min(
            limit,
            T.MathUtils.lerp(supportAt(a.support, n), supportAt(b.support, n), t) / dot,
          );
      }
      const gap = (high - low) * 0.014;
      const clear = limit + gap;
      const delta = clear - r;
      const radius = r + (delta + Math.hypot(delta, gap * 0.4)) / 2;
      point.x = x + ux * radius;
      point.z = z + uz * radius;
      if (fabricRelief) sewWaist(i);
      point.applyMatrix4(fromHost);
      if (fabricRelief) {
        point.x += fabricRelief[2 * i] ?? 0;
        point.z += fabricRelief[2 * i + 1] ?? 0;
      }
      if (count < positions.count) {
        const k = i + count;
        positions.setXYZ(
          k,
          positions.getX(k) + point.x - positions.getX(i),
          positions.getY(k) + point.y - positions.getY(i),
          positions.getZ(k) + point.z - positions.getZ(i),
        );
      }
      positions.setXYZ(i, point.x, point.y, point.z);
    }
    if (fabricRelief) preserveSkirtOutline(geometry, sourcePositions);
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    function sewWaist(i: number): void {
      const rowCount = waistSections.length - 1;
      const f = T.MathUtils.clamp((waistY - point.y) / waistDepth, 0, 1) * rowCount;
      const j = Math.min(rowCount - 1, Math.floor(f));
      const a = waistSections[j];
      const b = waistSections[j + 1];
      const between = f - j;
      const snug = 1 - T.MathUtils.smoothstep(1 - geometry.getAttribute("uv").getY(i), 0, 0.18);
      if (!snug || !a?.center || !b?.center) return;
      const waistCenter = a.center.clone().lerp(b.center, between);
      const dx = point.x - waistCenter.x;
      const dz = point.z - waistCenter.z;
      const r = Math.hypot(dx, dz);
      if (r <= 1e-6) return;
      let target = Infinity;
      for (let n = 0; n < angles; n++) {
        const [cx, cz] = directions[n] ?? [0, 0];
        const dot = (dx * cx + dz * cz) / r;
        if (dot > 0.1)
          target = Math.min(
            target,
            T.MathUtils.lerp(supportAt(a.support, n), supportAt(b.support, n), between) / dot,
          );
      }
      let clearance = 0.007;
      if (waistClearance !== undefined) {
        const m = host.matrixWorld.elements;
        radialWorld.set(
          (m[0] ?? 0) * dx + (m[8] ?? 0) * dz,
          (m[1] ?? 0) * dx + (m[9] ?? 0) * dz,
          (m[2] ?? 0) * dx + (m[10] ?? 0) * dz,
        );
        clearance = (waistClearance * r) / Math.max(1e-9, radialWorld.length());
      }
      const sewn = target + clearance;
      const scale = Math.max(sewn / r, T.MathUtils.lerp(1, sewn / r, snug));
      point.x = waistCenter.x + dx * scale;
      point.z = waistCenter.z + dz * scale;
    }
  });
}

interface Ring {
  low: number;
  high: number;
  originalLow: number;
  originalHigh: number;
  width: number;
  original: number;
}

function preserveSkirtOutline(
  geometry: T.BufferGeometry,
  pattern: T.BufferAttribute | T.InterleavedBufferAttribute,
): void {
  const position = geometry.getAttribute("position");
  const uv = geometry.getAttribute("uv");
  const half = position.count / 2;
  const rings = new Map<number, Ring>();
  for (let i = 0; i < half; i++) {
    const v = uv.getY(i);
    const ring = rings.get(v) ?? {
      low: Infinity,
      high: -Infinity,
      originalLow: Infinity,
      originalHigh: -Infinity,
      width: 0,
      original: 0,
    };
    ring.low = Math.min(ring.low, position.getX(i));
    ring.high = Math.max(ring.high, position.getX(i));
    ring.originalLow = Math.min(ring.originalLow, pattern.getX(i));
    ring.originalHigh = Math.max(ring.originalHigh, pattern.getX(i));
    rings.set(v, ring);
  }
  let ease = 1;
  for (const [v, ring] of rings) {
    ring.width = ring.high - ring.low;
    ring.original = ring.originalHigh - ring.originalLow;
    if (v > 0.16 && v < 0.78 && ring.original > 0.001)
      ease = Math.max(ease, ring.width / ring.original);
  }
  for (let i = 0; i < half; i++) {
    const v = uv.getY(i);
    const ring = rings.get(v);
    if (!ring) continue;
    const center = (ring.high + ring.low) * 0.5;
    if (ring.width < 0.001) continue;
    const stretch =
      Math.max(0, (Math.min(ease, 1.5) * ring.original) / ring.width - 1) *
      T.MathUtils.smoothstep(1 - v, 0.08, 0.24);
    const offset = (position.getX(i) - center) * stretch;
    position.setX(i, position.getX(i) + offset);
    position.setX(i + half, position.getX(i + half) + offset);
  }
}
