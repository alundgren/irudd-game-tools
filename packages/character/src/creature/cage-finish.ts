import * as T from "three";
import type { CageFinish, FigureCage } from "@irudd/document";

const featherStations = 7;
const featherSection = [-1, -0.42, 0, 0.42, 1, 0];
const stationAt = [0, 0.12, 0.33, 0.56, 0.76, 0.92, 1];

export function featherChart(
  finish: CageFinish | undefined,
  cage: FigureCage | undefined,
): ReadonlyArray<readonly [number, number]> | undefined {
  if (finish?.finish !== "contour feather") return undefined;
  if (cage?.vertices.length !== featherStations * featherSection.length) return undefined;
  return stationAt.flatMap((t) =>
    featherSection.map((side): readonly [number, number] => [(side + 1) / 2, t]),
  );
}

function featherTexture() {
  const w = 128,
    h = 256,
    data = new Uint8Array(4 * w * h);
  for (let row = 0; row < h; row++)
    for (let i = 0; i < w; i++) {
      const t = (row + 0.5) / h,
        x = Math.abs((2 * (i + 0.5)) / w - 1);
      const sweep = t - 0.3 * x + 0.07 * x * x;
      const barbs =
        0.5 + 0.5 * Math.cos(2 * Math.PI * (21 * sweep + 0.15 * Math.sin(x * 14 + t * 9)));
      const band = Math.exp(-((sweep - 0.65) ** 2) / 0.0045);
      const root = T.MathUtils.smoothstep(t, 0.06, 0.45);
      const shaft = Math.exp(-((x / (0.019 + 0.024 * (1 - t))) ** 2));
      const ink = (0.89 + 0.105 * barbs - 0.3 * band) * (0.87 + 0.13 * root);
      const v = Math.round(255 * T.MathUtils.lerp(ink, 1, shaft));
      data.set([v, v, v, 255], 4 * (row * w + i));
    }
  const texture = new T.DataTexture(data, w, h, T.RGBAFormat);
  texture.magFilter = T.LinearFilter;
  texture.minFilter = T.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

export function contourPlumage(material: T.Material): T.Material {
  const plumage = material.clone();
  if (plumage instanceof T.MeshStandardMaterial) {
    plumage.map = featherTexture();
    plumage.roughness = 0.94;
  }
  plumage.vertexColors = true;
  plumage.userData["contourPlumage"] = true;
  return plumage;
}

export function finishContourFeather(mesh: T.Mesh, color: string, material: T.Material) {
  const uv = mesh.geometry.getAttribute("uv");
  if (!uv) return;
  const base = new T.Color(color),
    shade = new T.Color(),
    pale = new T.Color("#efe2ca");
  const colors = new Float32Array(3 * uv.count);
  for (let i = 0; i < uv.count; i++) {
    const x = Math.abs(2 * uv.getX(i) - 1),
      t = uv.getY(i);
    const band = Math.exp(-((t - 0.76 + 0.14 * x) ** 2) / 0.005);
    const shaft = Math.exp(-60 * x * x) * (1 - t);
    const tip = T.MathUtils.smoothstep(t - 0.07 * x, 0.83, 1);
    shade
      .copy(base)
      .multiplyScalar(0.92 - 0.54 * band)
      .lerp(pale, 0.18 * shaft + 0.48 * tip)
      .toArray(colors, i * 3);
  }
  mesh.geometry.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
  mesh.material = material;
}

interface WhorlFrame {
  readonly row: number;
  readonly origin?: T.Vector3;
  readonly along?: T.Vector3;
}

export function finishWhorl(
  mesh: T.Mesh,
  cage: FigureCage,
  faces: readonly number[] | undefined,
  finish: { readonly ribs: number; readonly seed: number },
  color: string,
  plain: boolean,
) {
  const g = mesh.geometry,
    index = g.index,
    positions = g.getAttribute("position"),
    normal = g.getAttribute("normal");
  if (!faces || !index || !normal) return;
  const controls = cage.vertices.map(([x, y, z]) => new T.Vector3(x, y, z));
  const distance = new Float32Array(positions.count),
    samples = new Uint16Array(positions.count);
  const p = new T.Vector3();
  const frames = cage.faces.map((face): WhorlFrame => {
    const row = Math.min(...face.map((k) => Math.floor(k / 8)));
    const lo = face.filter((k) => Math.floor(k / 8) === row),
      hi = face.filter((k) => Math.floor(k / 8) === row + 1);
    const [l0, l1] = lo.map((k) => controls[k]),
      [h0, h1] = hi.map((k) => controls[k]);
    if (lo.length !== 2 || hi.length !== 2 || !l0 || !l1 || !h0 || !h1) return { row };
    const origin = l0.clone().lerp(l1, 0.5);
    const along = h0.clone().lerp(h1, 0.5).sub(origin);
    return { row, origin, along: along.divideScalar(Math.max(1e-10, along.lengthSq())) };
  });
  for (const [triangle, which] of faces.entries()) {
    const frame = frames[which];
    if (!frame) continue;
    for (let j = 3 * triangle; j < 3 * triangle + 3; j++) {
      const v = index.getX(j);
      const t =
        frame.origin && frame.along
          ? p.fromBufferAttribute(positions, v).sub(frame.origin).dot(frame.along)
          : 0;
      distance[v] = (distance[v] ?? 0) + frame.row + Math.max(0, Math.min(1, t));
      samples[v] = (samples[v] ?? 0) + 1;
    }
  }
  const phase = (finish.seed % 37) / 37,
    ribs = finish.ribs;
  const base = new T.Color(color),
    rust = base.clone().multiply(new T.Color("#ab593e"));
  const ink = rust.clone().multiplyScalar(0.51),
    shade = new T.Color();
  const pigment = new Float32Array(positions.count * 3);
  for (let v = 0; v < positions.count; v++) {
    const row = (distance[v] ?? 0) / Math.max(1, samples[v] ?? 0),
      t = Math.min(1, row / 19);
    const x = positions.getX(v);
    const winding =
      (5.4 + ribs * 1.16) * (t + 0.16 * t * t) +
      0.33 * x +
      0.085 * Math.sin(17 * t + 3 * x) +
      phase;
    const wave = 0.5 + 0.5 * Math.cos(winding * 2 * Math.PI);
    const stripe = Math.max(0, Math.min(1, (wave - 0.48) * 2.35));
    const split = 0.5 + 0.5 * Math.cos(winding * 4 * Math.PI + 0.8 * Math.sin(7 * x));
    const lip = Math.max(0, Math.min(1, (row - 18.9) * 1.2));
    shade
      .copy(base)
      .lerp(rust, (1 - lip) * (0.14 + 0.72 * stripe))
      .lerp(ink, (1 - lip) * stripe * split * 0.46);
    if (row > 21) shade.multiplyScalar(Math.max(0.26, 1 - (row - 21) * 0.37));
    pigment.set([shade.r, shade.g, shade.b], v * 3);
    const ridge = 0.016 * t * wave ** 3 * (1 - lip);
    positions.setXYZ(
      v,
      positions.getX(v) + normal.getX(v) * ridge,
      positions.getY(v) + normal.getY(v) * ridge,
      positions.getZ(v) + normal.getZ(v) * ridge,
    );
  }
  positions.needsUpdate = true;
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  if (plain) return;
  g.setAttribute("color", new T.Float32BufferAttribute(pigment, 3));
  if (!(mesh.material instanceof T.MeshStandardMaterial)) return;
  const material = mesh.material.clone();
  material.color.set(0xffffff);
  material.vertexColors = true;
  material.roughness = 0.39;
  mesh.material = material;
}
