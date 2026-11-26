import {
  CanvasTexture,
  Color,
  Float32BufferAttribute,
  SRGBColorSpace,
  MathUtils,
} from "three";
import { unzlibSync } from "three/addons/libs/fflate.module.js";
import strip from "./human-root-strip.json" with { type: "json" };
import { hairline } from "./human-fringe.js";

const degree = Math.PI / 180;
const { clamp, smoothstep } = MathUtils;
let strands;
const textures = new Map();

export function frontRoot(phi) {
  const a = Math.abs(phi);
  return (
    hairline(phi) +
    degree *
      (4.2 * Math.exp(-((a - 0.61) ** 2) / 0.044) -
        1.4 * Math.exp(-(a * a) / 0.027) +
        1.3 * Math.sin(5 * phi))
  );
}

function rootMap(skin, hair) {
  const key = skin + " " + hair;
  if (textures.has(key)) return textures.get(key);
  strands ??= unzlibSync(
    Uint8Array.from(atob(strip.pixels), (c) => c.charCodeAt(0)),
  );
  const canvas = document.createElement("canvas");
  canvas.width = strip.width;
  canvas.height = strip.height;
  const ctx = canvas.getContext("2d"),
    pic = ctx.createImageData(strip.width, strip.height);
  const skinColor = new Color(skin).convertLinearToSRGB().toArray();
  const hairColor = new Color(hair).convertLinearToSRGB().toArray();
  for (let i = 0; i < strip.width * strip.height; i++) {
    const density = strands[2 * i + 1] / 255;
    const light = (strands[2 * i] / 178) * (0.83 + 0.17 * density);
    for (let c = 0; c < 3; c++) {
      pic.data[4 * i + c] =
        255 * (skinColor[c] * (1 - density) + hairColor[c] * density * light);
    }
    pic.data[4 * i + 3] = 255 * smoothstep(density, 0, 0.11);
  }
  ctx.putImageData(pic, 0, 0);
  const map = new CanvasTexture(canvas);
  map.colorSpace = SRGBColorSpace;
  map.anisotropy = 8;
  if (textures.size >= 16) textures.delete(textures.keys().next().value);
  textures.set(key, map);
  return map;
}

export function paintWaveRoots(mesh, shell, frame, skin, hair) {
  if (typeof document === "undefined") return;
  const uv = new Float32Array(mesh.geometry.attributes.position.count * 2);
  for (let i = 0; i < shell.count; i++) {
    const { phi, eps } = frame.aim(shell.anchor(i));
    uv[2 * i] = 0.5 + 0.48 * Math.sin(phi * 0.83);
    uv[2 * i + 1] = clamp((eps - frontRoot(phi) + 0.095) / 0.46, 0, 0.99);
  }
  mesh.geometry.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  mesh.material = mesh.material.clone();
  mesh.material.color.setHex(0xffffff);
  mesh.material.map = rootMap(skin, hair);
  mesh.material.alphaTest = 0.28;
  mesh.material.roughness = 0.81;
}

export function softenWaveEdge(geometry, frame) {
  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const xyz = [positions.getX(i), positions.getY(i), positions.getZ(i)];
    let { phi, eps, h } = frame.over(xyz);
    const side = phi < 0 ? -1 : 1;
    const a = Math.abs(phi);
    if (a > 1.53 || eps > 0.99) continue;
    if (eps < -0.17) {
      const fall = smoothstep(eps, -0.92, -0.17);
      const limit = 1.02 + 0.25 * fall;
      if (a >= limit) continue;
      phi = side * limit;
    } else {
      for (let k = 0; k < 5; k++) {
        const deficit = frontRoot(phi) + 0.24 - eps;
        if (deficit <= 0 || Math.abs(phi) > 1.46) break;
        const slope = (frontRoot(phi + 0.013) - frontRoot(phi - 0.013)) / 0.026;
        const turn = clamp(-slope, -5, 5);
        const step = Math.min(0.12, deficit) / (1 + turn * turn);
        phi += turn * step;
        eps += step;
      }
    }
    const distance = eps - frontRoot(phi);
    const atSkin = smoothstep(Math.abs(phi), 1.12, 1.47);
    const volume = Math.max(atSkin, smoothstep(distance, 0.12, 0.49));
    const gap = MathUtils.lerp(0.0014 * frame.k, h, volume);
    if (xyz[1] < frame.centre[1] - 0.03 * frame.k) {
      const r = Math.hypot(xyz[0] - frame.centre[0], xyz[2] - frame.centre[2]);
      positions.setXYZ(
        i,
        frame.centre[0] + r * Math.sin(phi),
        xyz[1],
        frame.centre[2] + r * Math.cos(phi),
      );
    } else positions.setXYZ(i, ...frame.place(phi, eps, gap));
  }
}
