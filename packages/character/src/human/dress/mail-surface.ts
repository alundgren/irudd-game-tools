import * as T from "three";
import { at, mix, type Landmarks } from "./kit.js";
import { clothChart } from "./cloth-finish.js";
import { context2d, type Raster } from "../../raster.js";
const mailPitch = 0.011,
  mailCourse = 0.0055;
function ringCell(u: number, v: number) {
  const x = u * 2,
    y = v * 4;
  let high = 0;
  for (let j = -1; j <= 5; j++) {
    const odd = (j & 1) === 1,
      sx = x - (odd ? 0.5 : 0),
      dx = sx - Math.round(sx),
      dy = ((y - j) * mailCourse) / mailPitch;
    const d = (Math.hypot(dx / 0.56, dy / 0.5) - 1) / 0.2;
    if (Math.abs(d) >= 1) continue;
    high = Math.max(high, Math.sqrt(1 - d * d) * (odd ? 0.74 : 1));
  }
  return high;
}

function link(x: number, y: number) {
  const pitch = 0.0144,
    step = 0.0066;
  const course = Math.round(y / step);
  let highest = -1,
    shade = 0,
    ridge = 0;
  for (let j = course - 1; j <= course + 1; j++) {
    const odd = (j & 1) === 1;
    const u = x / pitch - (odd ? 0.5 : 0),
      dx = (u - Math.round(u)) * pitch;
    const dy = y - j * step,
      tilt = odd ? -0.24 : 0.24;
    const ex = (dx + tilt * dy) / 0.0072,
      ey = dy / 0.0053;
    const d = (Math.hypot(ex, ey) - 1) / 0.24;
    if (Math.abs(d) >= 1) continue;
    const rounded = Math.sqrt(1 - d * d);
    const z = rounded * 0.43 + (odd ? -1 : 1) * ey * 0.47;
    if (z < highest) continue;
    highest = z;
    shade = 0.48 + 0.3 * rounded + 0.22 * z;
    ridge = 0.32 + 0.44 * rounded + 0.2 * z;
  }
  return { shade, ridge };
}

function finishStandard(mesh: T.Mesh, coordinates: number[], raster: Raster) {
  if (!(mesh.material instanceof T.MeshStandardMaterial)) return;
  const mat = mesh.material.clone(),
    lining = mat.color.clone(),
    wire = new T.Color("#a3a3a0").lerp(lining, 0.14);
  mat.name = "Mail standard";
  mat.userData["foldedCloth"] = true;
  mat.roughness = 0.8;
  mat.metalness = 0.85;
  mesh.geometry.setAttribute("uv", new T.Float32BufferAttribute(coordinates, 2));
  mesh.geometry.setAttribute(
    "lodAnchor",
    new T.Uint8BufferAttribute(
      new Uint8Array(mesh.geometry.getAttribute("position").count).fill(1),
      1,
    ),
  );
  {
    const size = 256,
      texture = (surface: boolean) => {
        const canvas = raster.canvas(size, size);
        const ctx = context2d(canvas),
          image = ctx.createImageData(size, size);
        const dye = lining.clone().convertLinearToSRGB().toArray(),
          steel = wire.clone().convertLinearToSRGB().toArray(),
          brass = [0.76, 0.6, 0.36];
        for (let y = 0, p = 0; y < size; y++)
          for (let x = 0; x < size; x++, p += 4) {
            const half = size / 2,
              golden = x >= half,
              u = ((x % half) + 0.5) / half,
              v = 1 - (y + 0.5) / size;
            let high = 0,
              cover = 0;
            for (const [ox, oy] of [
              [-0.25, -0.25],
              [0.25, -0.25],
              [-0.25, 0.25],
              [0.25, 0.25],
            ] as const) {
              const h = ringCell(u + ox / half, v + oy / size);
              high += h / 4;
              cover += Number(h > 0) / 4;
            }
            const metal = golden ? brass : steel;
            if (surface) {
              image.data[p] = 30 + 215 * high;
              image.data[p + 1] = mix(250, 150 - 50 * high, cover);
              image.data[p + 2] = mix(8, 232, cover);
            } else
              for (let c = 0; c < 3; c++)
                image.data[p + c] =
                  255 * mix(at(dye, c) * 0.42, at(metal, c) * (0.5 + 0.5 * high), cover);
            image.data[p + 3] = 255;
          }
        ctx.putImageData(image, 0, 0);
        const tex = new T.CanvasTexture(canvas);
        if (!surface) tex.colorSpace = T.SRGBColorSpace;
        tex.anisotropy = 8;
        return tex;
      };
    const paint = texture(false),
      relief = texture(true);
    mat.color.set(0xffffff);
    mat.map = paint;
    mat.bumpMap = mat.roughnessMap = mat.metalnessMap = relief;
    mat.bumpScale = 0.0012;
    mat.addEventListener("dispose", () => {
      paint.dispose();
      relief.dispose();
    });
  }
  mesh.material = mat;
}

export function finishMail(
  mesh: T.Mesh,
  landmarks: Landmarks,
  coordinates: number[] | undefined,
  raster: Raster,
) {
  if (!(mesh.material instanceof T.MeshStandardMaterial)) return;
  if (coordinates) return finishStandard(mesh, coordinates, raster);
  const mat = mesh.material.clone();
  const lining = mat.color.clone(),
    wire = new T.Color("#9c9c99").lerp(lining, 0.18);
  mat.name = "Riveted mail";
  mat.roughness = 0.8;
  mat.metalness = 0.85;
  const position = mesh.geometry.getAttribute("position");

  {
    const chart = clothChart(position, landmarks);
    mesh.geometry.setAttribute("uv", chart.uv);
    const texture = (surface: boolean) => {
      const scale = 1100,
        canvas = raster.canvas(
          Math.min(1024, Math.max(128, Math.ceil(chart.du * scale))),
          Math.min(1024, Math.max(128, Math.ceil(chart.dv * scale))),
        );
      const ctx = context2d(canvas),
        image = ctx.createImageData(canvas.width, canvas.height);
      const dye = lining.clone().convertLinearToSRGB().toArray(),
        steel = wire.clone().convertLinearToSRGB().toArray();

      for (let y = 0, p = 0; y < canvas.height; y++) {
        const v = chart.v0 + chart.dv * (1 - (y + 0.5) / canvas.height);
        for (let x = 0; x < canvas.width; x++, p += 4) {
          const u = chart.u0 + (chart.du * (x + 0.5)) / canvas.width;
          const { shade, ridge } = link(u, v);
          if (surface) {
            image.data[p] = 28 + 211 * ridge;
            image.data[p + 1] = shade ? 178 - 61 * ridge : 250;
            image.data[p + 2] = shade ? 230 : 8;
          } else {
            for (let c = 0; c < 3; c++)
              image.data[p + c] = 255 * (shade ? at(steel, c) * shade : at(dye, c) * 0.53);
          }
          image.data[p + 3] = 255;
        }
      }
      ctx.putImageData(image, 0, 0);
      const tex = new T.CanvasTexture(canvas);
      if (!surface) tex.colorSpace = T.SRGBColorSpace;
      tex.anisotropy = 8;
      return tex;
    };
    const paint = texture(false),
      relief = texture(true);
    mat.color.set(0xffffff);
    mat.map = paint;
    mat.bumpMap = mat.roughnessMap = mat.metalnessMap = relief;
    mat.bumpScale = 0.0019;
    mat.addEventListener("dispose", () => {
      paint.dispose();
      relief.dispose();
    });
  }
  mesh.material = mat;
}
