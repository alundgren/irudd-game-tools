import { Matrix4, Vector3, MathUtils } from "three";

const bins = 32,
  angles = 24;
const directions = Array.from({ length: angles }, (_, i) => [
  Math.cos((i * 2 * Math.PI) / angles),
  Math.sin((i * 2 * Math.PI) / angles),
]);
export function fitGarment(
  host,
  garment,
  innerLayers = [],
  limbs = [],
  pairedPanel = false,
  waistClearance,
) {
  host.updateWorldMatrix(true, true);
  const hostInverse = host.matrixWorld.clone().invert(),
    point = new Vector3();
  const cloud = [];
  const relief = garment.geometry?.skirtRelief;
  const garmentToHost = new Matrix4().multiplyMatrices(
    hostInverse,
    garment.matrixWorld,
  );
  const radialWorld = new Vector3();
  const waistY = new Vector3().applyMatrix4(garmentToHost).y;
  const waistDepth = relief
    ? Math.max(
        0.001,
        Math.abs(
          waistY -
            new Vector3(
              0,
              garment.geometry.boundingBox.min.y * 0.2,
              0,
            ).applyMatrix4(garmentToHost).y,
        ),
      )
    : 0;
  const waistSections = Array.from({ length: relief ? 17 : 0 }, (_, i) => ({
    y: waistY - (waistDepth * i) / 16,
    ring: [],
  }));
  function collect(node, includeParts = false, source = node, fitWaist = true) {
    if (
      !node.visible ||
      (!includeParts && node !== source && node.userData.partId)
    )
      return;
    if (node.isMesh) {
      const p = node.geometry.attributes.position,
        m = new Matrix4().multiplyMatrices(hostInverse, node.matrixWorld);
      if (relief && fitWaist) {
        const index = node.geometry.index,
          count = index?.count ?? p.count;
        const vertices = Array.from({ length: p.count }, (_, i) =>
          new Vector3().fromBufferAttribute(p, i).applyMatrix4(m),
        );
        for (let k = 0; k < count; k += 3)
          for (let j = 0; j < 3; j++) {
            const a = k + j,
              b = k + ((j + 1) % 3),
              pa = vertices[index ? index.getX(a) : a],
              pb = vertices[index ? index.getX(b) : b];
            const lo = Math.max(
              0,
              Math.ceil(((waistY - Math.max(pa.y, pb.y)) / waistDepth) * 16),
            );
            const hi = Math.min(
              16,
              Math.floor(((waistY - Math.min(pa.y, pb.y)) / waistDepth) * 16),
            );
            for (let row = lo; row <= hi; row++) {
              const { y, ring } = waistSections[row];
              if (pa.y > y !== pb.y > y)
                ring.push(pa.clone().lerp(pb, (y - pa.y) / (pb.y - pa.y)));
            }
          }
      }
      const stride = Math.max(1, Math.floor(p.count / 14000));
      for (let i = 0; i < p.count; i += stride)
        cloud.push(new Vector3().fromBufferAttribute(p, i).applyMatrix4(m));
    }
    for (const child of node.children)
      collect(child, includeParts, source, fitWaist);
  }
  collect(host);
  for (const limb of limbs) collect(limb, false, limb, false);
  for (const inner of innerLayers) collect(inner, true);
  if (!cloud.length) return;
  let low = Infinity,
    high = -Infinity;
  for (const p of cloud) {
    low = Math.min(low, p.y);
    high = Math.max(high, p.y);
  }
  if (high - low < 0.001) return;
  const rows = Array.from({ length: bins }, () => []);
  for (const p of cloud)
    rows[
      MathUtils.clamp(
        Math.round(((p.y - low) / (high - low)) * (bins - 1)),
        0,
        bins - 1,
      )
    ].push(p);
  const sections = rows.map((_, i) => {
    let samples = rows.slice(Math.max(0, i - 1), Math.min(bins, i + 2)).flat();
    if (!samples.length) {
      let distance = 2;
      while (!samples.length && distance < bins) {
        samples = [
          ...(rows[i - distance] ?? []),
          ...(rows[i + distance] ?? []),
        ];
        distance++;
      }
    }
    let x0 = Infinity,
      x1 = -Infinity,
      z0 = Infinity,
      z1 = -Infinity;
    for (const p of samples) {
      x0 = Math.min(x0, p.x);
      x1 = Math.max(x1, p.x);
      z0 = Math.min(z0, p.z);
      z1 = Math.max(z1, p.z);
    }
    const x = (x1 + x0) / 2,
      z = (z1 + z0) / 2;
    const support = directions.map(([dx, dz]) =>
      samples.reduce((v, p) => Math.max(v, (p.x - x) * dx + (p.z - z) * dz), 0),
    );
    return { x, z, support };
  });
  for (const row of waistSections) {
    if (!row.ring.length) continue;
    const center = new Vector3();
    for (const p of row.ring) center.add(p);
    row.center = center.divideScalar(row.ring.length);
    row.support = directions.map(([x, z]) =>
      row.ring.reduce(
        (max, p) => Math.max(max, (p.x - center.x) * x + (p.z - center.z) * z),
        0,
      ),
    );
  }
  garment.traverse((mesh) => {
    if (!mesh.isMesh) return;
    const fabricRelief = mesh === garment ? relief : null;
    const sourcePositions = mesh.geometry.attributes.position;
    const geometry = mesh.geometry.clone();
    mesh.geometry = geometry;
    const positions = geometry.attributes.position;
    const toHost = new Matrix4().multiplyMatrices(
        hostInverse,
        mesh.matrixWorld,
      ),
      fromHost = toHost.clone().invert();
    const count =
      pairedPanel && mesh === garment ? positions.count / 2 : positions.count;
    for (let i = 0; i < count; i++) {
      point.fromBufferAttribute(positions, i);
      if (fabricRelief) {
        point.x -= fabricRelief[2 * i];
        point.z -= fabricRelief[2 * i + 1];
      }
      point.applyMatrix4(toHost);
      if (point.y < low || point.y > high) continue;
      const f = ((point.y - low) / (high - low)) * (bins - 1),
        j = Math.min(bins - 2, Math.floor(f)),
        a = sections[j],
        b = sections[j + 1],
        t = f - j;
      const x = MathUtils.lerp(a.x, b.x, t),
        z = MathUtils.lerp(a.z, b.z, t);
      const dx = point.x - x,
        dz = point.z - z,
        r = Math.hypot(dx, dz);
      if (r < 0.0001) continue;
      const ux = dx / r,
        uz = dz / r;
      let limit = Infinity;
      for (let n = 0; n < angles; n++) {
        const dot = ux * directions[n][0] + uz * directions[n][1];
        if (dot > 0.1)
          limit = Math.min(
            limit,
            MathUtils.lerp(a.support[n], b.support[n], t) / dot,
          );
      }
      const gap = (high - low) * 0.014,
        clear = limit + gap,
        delta = clear - r;
      const radius = r + (delta + Math.hypot(delta, gap * 0.4)) / 2;
      point.x = x + ux * radius;
      point.z = z + uz * radius;
      if (fabricRelief) {
        const rows = waistSections.length - 1,
          f = MathUtils.clamp((waistY - point.y) / waistDepth, 0, 1) * rows,
          j = Math.min(rows - 1, Math.floor(f));
        const a = waistSections[j],
          b = waistSections[j + 1],
          between = f - j;
        const snug =
          1 - MathUtils.smoothstep(1 - geometry.attributes.uv.getY(i), 0, 0.18);
        if (snug && a.center && b.center) {
          const waistCenter = a.center.clone().lerp(b.center, between);
          const dx = point.x - waistCenter.x,
            dz = point.z - waistCenter.z,
            r = Math.hypot(dx, dz);
          if (r > 1e-6) {
            let target = Infinity;
            for (let n = 0; n < angles; n++) {
              const dot = (dx * directions[n][0] + dz * directions[n][1]) / r;
              if (dot > 0.1)
                target = Math.min(
                  target,
                  MathUtils.lerp(a.support[n], b.support[n], between) / dot,
                );
            }
            let clearance = 0.007;
            if (waistClearance !== undefined) {
              const m = host.matrixWorld.elements;
              radialWorld.set(
                m[0] * dx + m[8] * dz,
                m[1] * dx + m[9] * dz,
                m[2] * dx + m[10] * dz,
              );
              clearance =
                (waistClearance * r) / Math.max(1e-9, radialWorld.length());
            }
            const sewn = target + clearance;
            const scale = Math.max(sewn / r, MathUtils.lerp(1, sewn / r, snug));
            point.x = waistCenter.x + dx * scale;
            point.z = waistCenter.z + dz * scale;
          }
        }
      }
      point.applyMatrix4(fromHost);
      if (fabricRelief) {
        point.x += fabricRelief[2 * i];
        point.z += fabricRelief[2 * i + 1];
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
  });
}

function preserveSkirtOutline(geometry, pattern) {
  const { position, uv } = geometry.attributes,
    half = position.count / 2,
    rings = new Map();
  for (let i = 0; i < half; i++) {
    const v = uv.getY(i);
    const ring = rings.get(v) ?? {
      low: Infinity,
      high: -Infinity,
      originalLow: Infinity,
      originalHigh: -Infinity,
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
    const v = uv.getY(i),
      ring = rings.get(v),
      center = (ring.high + ring.low) * 0.5;
    if (ring.width < 0.001) continue;
    const stretch =
      Math.max(0, (Math.min(ease, 1.5) * ring.original) / ring.width - 1) *
      MathUtils.smoothstep(1 - v, 0.08, 0.24);
    const offset = (position.getX(i) - center) * stretch;
    position.setX(i, position.getX(i) + offset);
    position.setX(i + half, position.getX(i + half) + offset);
  }
}
