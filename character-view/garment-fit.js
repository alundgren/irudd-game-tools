import { Matrix4, Vector3, MathUtils } from "three";

const bins = 32,
  angles = 24;
const directions = Array.from({ length: angles }, (_, i) => [
  Math.cos((i * 2 * Math.PI) / angles),
  Math.sin((i * 2 * Math.PI) / angles),
]);
// A garment can contain many overlapping panels. Sample the covered body region in
// its local frame, then ease any penetrating surface vertices outside the body.
export function fitGarment(host, garment) {
  host.updateWorldMatrix(true, true);
  const hostInverse = host.matrixWorld.clone().invert(),
    point = new Vector3();
  const cloud = [];
  function collect(node) {
    if (node !== host && node.userData.partId) return;
    if (node.isMesh) {
      const p = node.geometry.attributes.position,
        m = new Matrix4().multiplyMatrices(hostInverse, node.matrixWorld);
      const stride = Math.max(1, Math.floor(p.count / 14000));
      for (let i = 0; i < p.count; i += stride)
        cloud.push(new Vector3().fromBufferAttribute(p, i).applyMatrix4(m));
    }
    node.children.forEach(collect);
  }
  collect(host);
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
    // Neighboring bands bound sparse tessellation and keep shoulders continuous.
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
  garment.traverse((mesh) => {
    if (!mesh.isMesh) return;
    // Source geometry may also be used by another copy of this component.
    const geometry = mesh.geometry.clone();
    mesh.geometry = geometry;
    const positions = geometry.attributes.position;
    const toHost = new Matrix4().multiplyMatrices(
        hostInverse,
        mesh.matrixWorld,
      ),
      fromHost = toHost.clone().invert();
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i).applyMatrix4(toHost);
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
      point.applyMatrix4(fromHost);
      positions.setXYZ(i, point.x, point.y, point.z);
    }
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
  });
}
