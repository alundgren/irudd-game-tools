import { TessellateModifier } from "three/addons/modifiers/TessellateModifier.js";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import {
  Color,
  Float32BufferAttribute,
  MathUtils,
  Matrix3,
  Vector3,
} from "three";

export const markingKinds = ["Bands", "Spots", "Rosettes", "Countershade"];
export const acceptsMarkings = (p) =>
  p &&
  [
    "sweep",
    "ellipsoid",
    "box",
    "scute",
    "cone",
    "cylinder",
    "hand",
    "volume",
  ].includes(p.shape);
export function validMarkings(m) {
  return (
    m &&
    markingKinds.includes(m.kind) &&
    /^#[0-9a-f]{6}$/i.test(m.color) &&
    Number.isFinite(m.spacing) &&
    m.spacing >= 0.06 &&
    m.spacing <= 0.8 &&
    Number.isFinite(m.coverage) &&
    m.coverage >= 0.1 &&
    m.coverage <= 0.9 &&
    Number.isFinite(m.angle) &&
    Math.abs(m.angle) <= 180 &&
    Number.isInteger(m.seed) &&
    m.seed >= 0 &&
    m.seed <= 0xffffffff
  );
}
function hash(x, y, z, seed) {
  let h =
    Math.imul(x, 73856093) ^
    Math.imul(y, 19349663) ^
    Math.imul(z, 83492791) ^
    seed;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function markingField(m) {
  const phase = hash(1, 2, 3, m.seed) * 6.283,
    angle = (m.angle * Math.PI) / 180,
    sin = Math.sin(angle),
    cos = Math.cos(angle);
  const ease = MathUtils.smoothstep;
  return (p, n) => {
    const x = p.x / m.spacing,
      y = (p.y * cos - p.z * sin) / m.spacing,
      z = (p.z * cos + p.y * sin) / m.spacing;
    if (m.kind === "Countershade") {
      const underside =
        -(n.y * cos - n.z * sin) + 0.07 * Math.sin(phase + 2 * z + 0.3 * x);
      return ease(underside, 0.66 - 1.6 * m.coverage, 1.2 - 1.6 * m.coverage);
    }
    if (m.kind === "Bands") {
      const wave = Math.cos(
        Math.PI *
          2 *
          (z +
            0.16 * Math.sin(phase + 0.9 * x + 1.2 * y) +
            0.08 * Math.sin(0.74 * z - 0.8 * x + phase)),
      );
      const cutoff = Math.cos(Math.PI * m.coverage);
      return ease(wave, cutoff - 0.17, cutoff + 0.17);
    }
    // Jittered 3D cells give neighbouring limbs the same field on their seam.
    const ix = Math.floor(x),
      iy = Math.floor(y),
      iz = Math.floor(z);
    let distance = Infinity;
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const a = ix + dx,
            b = iy + dy,
            c = iz + dz;
          const cx = a + 0.18 + 0.64 * hash(a, b, c, m.seed) - x,
            cy = b + 0.18 + 0.64 * hash(a, b, c, m.seed ^ 1543) - y,
            cz = c + 0.18 + 0.64 * hash(a, b, c, m.seed ^ 9377) - z;
          distance = Math.min(distance, cx * cx + cy * cy + cz * cz);
        }
    const r = Math.sqrt(distance),
      outer = 0.26 + 0.48 * m.coverage;
    const spot = 1 - ease(r, outer - 0.07, outer + 0.05);
    return m.kind === "Spots"
      ? spot
      : spot * ease(r, outer * 0.52 - 0.04, outer * 0.63);
  };
}

export function paintMarkings(mesh, m) {
  mesh.updateWorldMatrix(true, false);
  let geo = mesh.geometry;
  const triangles = (geo.index?.count ?? geo.attributes.position.count) / 3;
  const iterations = Math.min(5, Math.floor(Math.log2(16000 / triangles)));
  if (
    iterations > 0 &&
    !mesh.material.userData.fibreLOD &&
    !mesh.blendOwners &&
    !mesh.handRig &&
    !mesh.userData.faceSurface &&
    !geo.morphAttributes.position
  ) {
    // Bisect large triangles on their existing planes. Physical coordinates
    // keep narrow markings sharp even when the local axes have unequal scales.
    const world = geo.clone().applyMatrix4(mesh.matrixWorld);
    const split = new TessellateModifier(m.spacing * 0.19, iterations).modify(
      world,
    );
    const refined = mergeVertices(split, 1e-6);
    refined.applyMatrix4(mesh.matrixWorld.clone().invert());
    refined.normalizeNormals();
    world.dispose();
    split.dispose();
    geo.dispose();
    mesh.geometry = geo = refined;
  }
  const mat = mesh.material.clone(),
    pos = geo.attributes.position,
    normals = geo.attributes.normal;
  const rgb = new Float32Array(pos.count * 3),
    base = new Color(),
    previous = mat.vertexColors ? geo.attributes.color : null,
    accent = new Color(m.color);
  const p = new Vector3(),
    n = new Vector3(),
    normalMatrix = new Matrix3().getNormalMatrix(mesh.matrixWorld),
    sample = markingField(m);
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    n.fromBufferAttribute(normals, i).applyNormalMatrix(normalMatrix);
    if (previous) base.fromBufferAttribute(previous, i).multiply(mat.color);
    else base.copy(mat.color);
    const t = sample(p, n);
    rgb[i * 3] = MathUtils.lerp(base.r, accent.r, t);
    rgb[i * 3 + 1] = MathUtils.lerp(base.g, accent.g, t);
    rgb[i * 3 + 2] = MathUtils.lerp(base.b, accent.b, t);
  }
  geo.setAttribute("color", new Float32BufferAttribute(rgb, 3));
  mat.color.set(0xffffff);
  mat.vertexColors = true;
  mesh.material = mat;
}
export function whiteVertexColors(geometry) {
  if (!geometry.attributes.color)
    geometry.setAttribute(
      "color",
      new Float32BufferAttribute(
        new Float32Array(geometry.attributes.position.count * 3).fill(1),
        3,
      ),
    );
}
