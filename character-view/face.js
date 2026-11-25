import * as T from "three";
import { deformFace } from "./facial-sculpt.js";
import { landmarkRelief } from "./portrait-relief.js";
import atlasUrl from "./faces.atlas.webp";

// The four original diffuse studies share one atlas. UVs sample each portrait
// from the front and carry its temple colour around the back of the skull.
const paint = [];
export async function loadFacePaint() {
  const image = await new T.ImageLoader().loadAsync(atlasUrl);
  const source = document.createElement("canvas");
  source.width = image.width;
  source.height = image.height;
  const ctx = source.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, source.width, source.height).data;
  for (let cell = 0; cell < 4; cell++) {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 384;
    const target = canvas.getContext("2d");
    const result = target.createImageData(canvas.width, canvas.height);
    const ox = ((cell % 2) * source.width) / 2,
      oy = (Math.floor(cell / 2) * source.height) / 2;
    function sample(u, v, k) {
      const x = Math.min(
        source.width - 1,
        Math.max(0, Math.floor(ox + (u * source.width) / 2)),
      );
      const y = Math.min(
        source.height - 1,
        Math.max(0, Math.floor(oy + (v * source.height) / 2)),
      );
      return pixels[(y * source.width + x) * 4 + k];
    }
    for (let y = 0; y < canvas.height; y++) {
      const t = 1 - y / (canvas.height - 1);
      let r = 1;
      while (r < contour.length - 1 && contour[r][0] < t) r++;
      const p = contour[r - 1],
        q = contour[r],
        width = T.MathUtils.lerp(p[1], q[1], (t - p[0]) / (q[0] - p[0]));
      for (let x = 0; x < canvas.width; x++) {
        const angle = (x / (canvas.width - 1)) * Math.PI * 2 - Math.PI;
        const front = T.MathUtils.smoothstep(Math.cos(angle), -0.05, 0.58);
        const u = 0.5 + ((width * Math.sin(angle)) / 0.195) * 0.64;
        const v = 0.958 - t * 0.949;
        const off = (y * canvas.width + x) * 4;
        for (let k = 0; k < 3; k++) {
          // A small forehead patch supplies skin grain around the unpainted rear.
          const rear = sample(
            0.48 + 0.052 * Math.sin(angle * 6),
            0.156 + 0.028 * Math.sin(t * 12),
            k,
          );
          result.data[off + k] = T.MathUtils.lerp(rear, sample(u, v, k), front);
        }
        result.data[off + 3] = 255;
      }
    }
    target.putImageData(result, 0, 0);
    const texture = new T.CanvasTexture(canvas);
    texture.colorSpace = T.SRGBColorSpace;
    texture.anisotropy = 4;
    paint[cell] = texture;
  }
}
export const faces = [
  { skin: "#ac785a", jaw: 1.03, nose: 1.08, brow: 1.1, cheek: 1 },
  { skin: "#ae7f5d", jaw: 1.14, nose: 1.09, brow: 0.91, cheek: 1.12 },
  { skin: "#956449", jaw: 0.98, nose: 0.92, brow: 0.91, cheek: 1.16 },
  { skin: "#c9997c", jaw: 0.91, nose: 0.86, brow: 0.94, cheek: 1.03 },
];
const contour = [
  // chin -> crown: half width, depth in front of and behind the ear.
  [0, 0.006, 0.066, -0.057],
  [0.025, 0.038, 0.084, -0.019],
  [0.085, 0.056, 0.093, 0.034],
  [0.16, 0.073, 0.092, 0.066],
  [0.24, 0.081, 0.091, 0.081],
  [0.34, 0.084, 0.09, 0.093],
  [0.47, 0.094, 0.089, 0.103],
  [0.58, 0.092, 0.088, 0.106],
  [0.68, 0.093, 0.093, 0.106],
  [0.75, 0.094, 0.094, 0.102],
  [0.84, 0.088, 0.09, 0.095],
  [0.92, 0.073, 0.076, 0.082],
  [0.97, 0.048, 0.052, 0.054],
  [1, 0, 0, 0],
];

// Interpolate in latitude so the dome rounds into its pole. Shared tangents
// at the measured sections prevent a stripe in the normals at every row.
const latitude = (height) => Math.acos(1 - 2 * height);
// Posterior silhouette of the adult construction at the same latitudes.
// Low rings stay inside the nape until the occiput rounds out above the ear.
const adultRear = [
  0.058, 0.019, -0.038, -0.075, -0.088, -0.098, -0.11, -0.119, -0.118, -0.112,
  -0.1, -0.081, -0.06, -0.021,
];
const profile = contour.map(([t, ...rest], i) => [
  latitude(t),
  ...rest,
  adultRear[i],
]);
function section(i, angle, axis) {
  const a = profile[i],
    b = profile[i + 1];
  const previous = profile[Math.max(0, i - 1)];
  const next = profile[Math.min(profile.length - 1, i + 2)];
  const span = b[0] - a[0];
  const t = (angle - a[0]) / span;
  const m0 = (span * (b[axis] - previous[axis])) / (b[0] - previous[0]);
  const m1 = (span * (next[axis] - a[axis])) / (next[0] - a[0]);
  return (
    T.MathUtils.lerp(a[axis], b[axis], t * t * (3 - 2 * t)) +
    t * (1 - t) * ((1 - t) * m0 - t * m1)
  );
}
const bump = (x, y, cx, cy, rx, ry) =>
  Math.exp(-(((x - cx) / rx) ** 2) - ((y - cy) / ry) ** 2);
const tinted = new Map();
function skinTexture(cell, skin) {
  if (skin.toLowerCase() === faces[cell].skin) return paint[cell];
  const key = cell + skin;
  if (tinted.has(key)) return tinted.get(key);
  const source = paint[cell].image,
    canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(source, 0, 0);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const ref = new T.Color(faces[cell].skin),
    target = new T.Color(skin),
    ratio = [target.r / ref.r, target.g / ref.g, target.b / ref.b];
  const lut = ratio.map((f) =>
    Array.from({ length: 256 }, (_, v) => {
      const srgb = v / 255,
        linear =
          srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
      const val = Math.min(1, linear * f);
      return Math.round(
        255 *
          (val <= 0.0031308 ? 12.92 * val : 1.055 * val ** (1 / 2.4) - 0.055),
      );
    }),
  );
  for (let i = 0; i < pixels.data.length; i += 4)
    for (let k = 0; k < 3; k++) pixels.data[i + k] = lut[k][pixels.data[i + k]];
  ctx.putImageData(pixels, 0, 0);
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  texture.anisotropy = 4;
  if (tinted.size >= 48) {
    const first = tinted.keys().next().value;
    tinted.get(first).dispose();
    tinted.delete(first);
  }
  tinted.set(key, texture);
  return texture;
}
// Sculpt the projecting helix around a recessed concha. Tilt the top of
// the pinna toward the back of the skull; mirror the relief on the two ears.
// The paired neck tendons descend from below the ear toward the sternum.
// Work on the shared neck so profile and rotation show the same landmarks.
export function shapeNeck(geometry) {
  const pos = geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i),
      y = pos.getY(i),
      z = pos.getZ(i);
    const t = T.MathUtils.clamp((y - 1.364) / 0.2, 0, 1);
    const front = T.MathUtils.smoothstep(z, -0.04, 0.03);
    const muscle =
      0.006 *
      Math.exp(-(((Math.abs(x) - (0.014 + 0.039 * t)) / 0.01) ** 2)) *
      Math.sin(Math.PI * t) *
      front;
    const throat =
      0.004 * Math.exp(-((x / 0.018) ** 2) - ((t - 0.54) / 0.14) ** 2) * front;
    const lean = 0.044 * (t - 0.65);
    pos.setXYZ(
      i,
      x + Math.sign(x) * muscle * 0.6,
      y + 0.013 * (1 - front) * Math.sin(Math.PI * t),
      z + lean + muscle + throat,
    );
  }
  geometry.computeVertexNormals();
  return geometry;
}

export function earGeometry(side) {
  const g = new T.SphereGeometry(1, 48, 36);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i),
      y = pos.getY(i),
      z = pos.getZ(i);
    const radius = Math.hypot(y, z);
    // The helix turns inward above the canal and fades into the soft lobe.
    const outer = T.MathUtils.smoothstep(y, -0.76, -0.23);
    const folded =
      T.MathUtils.smoothstep(z, 0.36, 0.85) *
      (1 - T.MathUtils.smoothstep(y, 0.12, 0.65));
    const rim =
      0.0065 *
      outer *
      (1 - 0.83 * folded) *
      Math.exp(-(((radius - 0.78) / 0.16) ** 2));
    const inner = 0.005 * bump(z, y, -0.26 + 0.22 * y, 0.12, 0.22, 0.55);
    const tragus = 0.006 * bump(z, y, 0.49, -0.13, 0.21, 0.25);
    const bowl = 0.005 * bump(z, y, 0.09, -0.04, 0.36, 0.4);
    const relief =
      T.MathUtils.smoothstep(side * x, 0, 0.42) * (rim + inner + tragus - bowl);
    pos.setXYZ(
      i,
      x * 0.015 + side * (relief + 0.0035 * y - 0.004 * z),
      y * 0.035,
      z * (0.021 + 0.005 * y) - 0.008 * y,
    );
  }
  g.computeVertexNormals();
  return g;
}

// The editable head and neck overlap below the ears. Give both surfaces
// the same local tangent through the nape so light crosses the joint smoothly.
export function shadeNape(face, neck) {
  face.updateWorldMatrix(true, false);
  neck.updateWorldMatrix(true, false);
  const toFace = face.matrixWorld.clone().invert(),
    point = new T.Vector3(),
    normal = new T.Vector3(),
    tangent = new T.Vector3();
  for (const mesh of [neck, face]) {
    const transform = new T.Matrix4().multiplyMatrices(
      toFace,
      mesh.matrixWorld,
    );
    const toMesh = new T.Matrix3().getNormalMatrix(transform).invert();
    const { position, normal: normals } = mesh.geometry.attributes;
    for (let i = 0; i < position.count; i++) {
      point.fromBufferAttribute(position, i).applyMatrix4(transform);
      const t = (point.y - 1.466) / 0.294;
      const influence =
        T.MathUtils.smoothstep(t, -0.16, 0.05) *
        (1 - T.MathUtils.smoothstep(t, 0.33, 0.54)) *
        (1 - T.MathUtils.smoothstep(point.z, -0.014, 0.045));
      if (influence <= 0) continue;
      tangent
        .set(point.x, -0.01, 0.92 * (point.z + 0.009))
        .normalize()
        .applyNormalMatrix(toMesh);
      normal
        .fromBufferAttribute(normals, i)
        .lerp(tangent, 0.92 * influence)
        .normalize();
      normals.setXYZ(i, normal.x, normal.y, normal.z);
    }
    normals.needsUpdate = true;
  }
}

export function createFace(
  appearance,
  silhouette,
  material,
  adultProfile = false,
) {
  const cell = appearance.face ?? 0;
  const traits = { ...faces[cell] };
  for (const k of ["jaw", "nose", "brow", "cheek"])
    traits[k] *= appearance.sculpt?.[k] ?? 1;
  const vertices = [],
    uv = [],
    indices = [];
  const columns = 128,
    rows = 112;
  const landmarks = { eyes: 0.566, mouth: 0.245, nose: 0.403 };
  for (let i = 0; i <= rows; i++) {
    const latitudeAngle = (Math.PI * i) / rows;
    const t = (1 - Math.cos(latitudeAngle)) / 2;
    let k = 1;
    while (k < contour.length - 1 && contour[k][0] < t) k++;
    const interp = (j) => section(k - 1, latitudeAngle, j);
    const posterior = adultProfile ? interp(4) : 0;
    const width =
      interp(1) *
      (1 + (traits.jaw - 1) * Math.exp(-(((t - 0.18) / 0.22) ** 2)));
    for (let j = 0; j <= columns; j++) {
      const angle = (j * Math.PI * 2) / columns - Math.PI;
      const sin = Math.sin(angle),
        cos = Math.cos(angle);
      const x = width * sin;
      // A flatter facial plane ends at the cheekbones. The braincase
      // continues behind the ears, while the back of the jaw rises to them.
      const mask = Math.exp(-(((t - 0.46) / 0.32) ** 4));
      let z =
        cos > 0
          ? interp(2) * T.MathUtils.lerp(cos, cos ** 0.67, mask)
          : interp(3) *
            cos *
            (1 + 0.18 * T.MathUtils.smoothstep(t, 0.24, 0.55));
      const chinOffset = 0.061 * (1 - T.MathUtils.smoothstep(t, 0, 0.15));
      z += chinOffset * (1 - Math.abs(cos));
      let jawLift =
        0.037 *
        ((1 - cos) / 2) *
        T.MathUtils.smoothstep(t, 0, 0.12) *
        (1 - T.MathUtils.smoothstep(t, 0.02, 0.35));
      if (cos > 0) {
        const eye = Math.abs(x);
        const nose =
          0.022 * bump(x, t, 0, 0.419, 0.017, 0.058) +
          0.011 * bump(eye, t, 0.017, 0.395, 0.01, 0.034) +
          0.02 * bump(x, t, 0, 0.51, 0.013, 0.139);
        const cheek =
          0.018 * bump(eye, t, 0.059, 0.464, 0.029, 0.089) -
          0.005 * bump(eye, t, 0.065, 0.32, 0.023, 0.092);
        const ridge =
          0.013 *
          bump(eye, t, 0.038, 0.623 + (0.022 * eye) / 0.06, 0.033, 0.045);
        const socket = -0.01 * bump(eye, t, 0.037, 0.58, 0.03, 0.055);
        const globe = 0.009 * bump(eye, t, 0.04, 0.566, 0.018, 0.031);
        const muzzle = 0.008 * bump(x, t, 0, 0.258, 0.043, 0.09);
        const chin = 0.01 * bump(x, t, 0, 0.094, 0.037, 0.063);
        const underLip = -0.004 * bump(x, t, 0, 0.178, 0.028, 0.026);
        const lipCurve = 0.013 * Math.min(1, (x / 0.03) ** 2);
        const features =
          0.205 *
          landmarkRelief(x / 0.077, t - lipCurve, landmarks) *
          (1 - T.MathUtils.smoothstep(t, 0.47, 0.51));
        const philtrum = 0.0035 * bump(eye, t, 0.006, 0.317, 0.004, 0.041);
        const nostril = -0.005 * bump(eye, t, 0.013, 0.384, 0.005, 0.012);
        z +=
          (traits.nose * nose +
            traits.cheek * cheek +
            traits.brow * ridge +
            socket +
            globe +
            muzzle +
            chin +
            underLip +
            features +
            philtrum +
            nostril) *
          cos;
      }
      if (adultProfile) {
        // Bring the chin and brow ahead of the ear, then carry the crown
        // back over the nape. Changes stay continuous around the skull.
        const front = T.MathUtils.smoothstep(cos, -0.48, 0.84);
        const dome = T.MathUtils.smoothstep(t, 0.66, 0.99);
        const chin = 1 - T.MathUtils.smoothstep(t, 0.04, 0.27);
        z += front * (0.012 * (1 - dome) + 0.014 * chin) - 0.021 * dome;
        if (cos < 0) {
          const sideDepth =
            chinOffset +
            0.012 * front * (1 - dome) +
            0.014 * front * chin -
            0.021 * dome;
          z = T.MathUtils.lerp(sideDepth, posterior, -cos);
        }
        const rear = (1 - cos) / 2;
        jawLift =
          0.024 *
          T.MathUtils.smoothstep(rear, 0.23, 0.96) *
          T.MathUtils.smoothstep(t, 0, 0.11) *
          (1 - T.MathUtils.smoothstep(t, 0.13, 0.38));
      }
      vertices.push(x, 1.466 + t * 0.294 + jawLift, z);
      uv.push(j / columns, t);
      if (i < rows && j < columns) {
        const v = i * (columns + 1) + j;
        indices.push(
          v,
          v + 1,
          v + columns + 1,
          v + 1,
          v + columns + 2,
          v + columns + 1,
        );
      }
    }
  }
  for (let j = 1; j < columns - 1; j++) indices.push(0, j + 1, j);
  const geo = new T.BufferGeometry();
  geo.setAttribute("position", new T.Float32BufferAttribute(vertices, 3));
  geo.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  deformFace(geo, appearance.sculpt, 0, false);
  const surface =
    silhouette || !paint[cell]
      ? material(appearance.skin)
      : new T.MeshStandardMaterial({
          map: skinTexture(cell, appearance.skin),
          roughness: 0.9,
        });
  const face = new T.Mesh(geo, surface);
  face.castShadow = true;
  face.userData.faceSurface = true;
  return face;
}
