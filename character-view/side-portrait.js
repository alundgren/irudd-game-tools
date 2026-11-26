import { rasterTriangles, backdropOpacity } from "./portrait-plate.js";
import {
  Box3,
  CanvasTexture,
  Matrix4,
  MathUtils,
  SRGBColorSpace,
  Vector3,
} from "three";

const images = new WeakMap();
function pixelsOf(image) {
  if (images.has(image)) return images.get(image);
  const canvas = document.createElement("canvas"),
    w = image.width,
    h = image.height;
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);
  const rgba = ctx.getImageData(0, 0, w, h).data;
  const left = new Int32Array(h).fill(w),
    right = new Int32Array(h).fill(-1);
  for (let y = 0; y < h; y++) {
    const first = 4 * y * w,
      last = first + 4 * (w - 1);
    const differs = (i, b) =>
      Math.max(
        Math.abs(rgba[i] - rgba[b]),
        Math.abs(rgba[i + 1] - rgba[b + 1]),
        Math.abs(rgba[i + 2] - rgba[b + 2]),
      ) > 38;
    for (let x = 1; x < w - 1; x++) {
      const i = first + 4 * x;
      if (rgba[i + 3] > 100 && differs(i, first) && differs(i, last)) {
        left[y] = x;
        break;
      }
    }
    for (let x = w - 2; x >= left[y]; x--) {
      const i = first + 4 * x;
      if (rgba[i + 3] > 100 && differs(i, first) && differs(i, last)) {
        right[y] = x;
        break;
      }
    }
  }
  const source = { rgba, left, right, w, h };
  images.set(image, source);
  return source;
}

function bakeMesh(mesh, face, sample, ear = false) {
  const g = mesh.geometry,
    p = g.attributes.position,
    uv = g.attributes.uv;
  if (!uv) return;
  const material = mesh.material;
  const oldMap = material.map;
  const width = ear ? 256 : 896,
    height = ear ? 256 : 640;
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (oldMap?.image) ctx.drawImage(oldMap.image, 0, 0, width, height);
  else {
    ctx.fillStyle = "#" + material.color.getHexString();
    ctx.fillRect(0, 0, width, height);
  }
  const output = ctx.getImageData(0, 0, width, height),
    rgb = output.data;
  const toFace = new Matrix4().multiplyMatrices(
    face.matrixWorld.clone().invert(),
    mesh.matrixWorld,
  );
  const xy = new Float32Array(2 * p.count),
    xyz = new Float32Array(3 * p.count),
    v = new Vector3();
  for (let i = 0; i < p.count; i++) {
    xy[2 * i] = uv.getX(i) * width;
    xy[2 * i + 1] = (1 - uv.getY(i)) * height;
    v.fromBufferAttribute(p, i)
      .applyMatrix4(toFace)
      .toArray(xyz, 3 * i);
  }
  rasterTriangles(g, xy, width, height, (pixel, a, b, d, l, s, t) => {
    sample(
      l * xyz[3 * a] + s * xyz[3 * b] + t * xyz[3 * d],
      l * xyz[3 * a + 1] + s * xyz[3 * b + 1] + t * xyz[3 * d + 1],
      l * xyz[3 * a + 2] + s * xyz[3 * b + 2] + t * xyz[3 * d + 2],
      ear,
      rgb,
      pixel * 4,
    );
  });
  ctx.putImageData(output, 0, 0);
  usePortraitTexture(mesh, c, ear);
}

function usePortraitTexture(mesh, c, ear = false) {
  const material = mesh.material,
    oldMap = material.map;
  const texture = new CanvasTexture(c);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  texture.name = "Registered side portrait";
  const copy = material.clone();
  if (!oldMap) copy.color.set(0xffffff);
  if (oldMap && oldMap === material.emissiveMap) copy.emissiveMap = texture;
  if (mesh.userData.ownedPortraitTexture) {
    oldMap?.dispose();
    material.dispose();
  }
  copy.userData.portrait = true;
  copy.userData.portraitPlate = !ear;
  copy.map = texture;
  mesh.material = copy;
  mesh.userData.ownedPortraitTexture = true;
}

export function paintSidePortrait(face, owner, frame, paint, image) {
  if (!image) return;
  owner.updateWorldMatrix(true, true);
  const { rgba, left, right, w, h } = pixelsOf(image),
    { brow, chin, front } = frame;
  const box = face.geometry.boundingBox,
    minZ = box.min.z,
    mid = (box.min.x + box.max.x) / 2,
    half = (box.max.x - box.min.x) / 2;
  const ears = owner.children.filter((c) => c.userData.earSurface);
  const ear = new Vector3(
    mid,
    box.min.y + 0.48 * (box.max.y - box.min.y),
    minZ + 0.48 * (front - minZ),
  );
  if (ears.length) {
    const wx = new Box3().setFromObject(ears[0], true).getCenter(new Vector3());
    ear.copy(face.worldToLocal(wx));
  }
  const [bu, bv] = paint.brow,
    [eu, ev] = paint.ear,
    span = paint.chinY - bv;
  const earRow = MathUtils.clamp(Math.round(ev * (h - 1)), 0, h - 1);
  const far =
    (paint.facing === "right" ? left[earRow] + 3 : right[earRow] - 3) / (w - 1);
  const expectedEarV = bv + ((brow - ear.y) / (brow - chin)) * span;
  const mx = 0.5 * (front + minZ),
    size = Math.max(front - minZ, 1e-6);
  function sample(x, y, z, isEar, out, i) {
    const lateral = Math.abs((x - mid) / half),
      anterior = (z - minZ) / size;
    const weight = isEar
      ? 1
      : (1 - MathUtils.smoothstep(anterior, 0.67, 0.9)) *
        Math.max(
          MathUtils.smoothstep(lateral, 0.25, 0.72),
          1 - MathUtils.smoothstep(z, minZ, mx),
        );
    if (weight < 0.002) return;
    const earMix = 1 - MathUtils.smoothstep(z, ear.z, front);
    const v =
      bv + ((brow - y) / (brow - chin)) * span + earMix * (ev - expectedEarV);
    if (v <= 0 || v >= 1) return;
    const row = Math.round(v * (h - 1));
    if (right[row] - left[row] < 5) return;
    const u =
      z >= ear.z
        ? eu + ((bu - eu) * (z - ear.z)) / Math.max(1e-6, front - ear.z)
        : eu + ((far - eu) * (ear.z - z)) / Math.max(1e-6, ear.z - minZ);
    const col = Math.round(
        MathUtils.clamp(u * (w - 1), left[row] + 2, right[row] - 2),
      ),
      j = 4 * (row * w + col);
    const alpha =
      weight * backdropOpacity(rgba, j, 4 * row * w, 4 * (row * w + w - 1));
    for (let k = 0; k < 3; k++)
      out[i + k] = Math.round(MathUtils.lerp(out[i + k], rgba[j + k], alpha));
  }
  bakeMesh(face, face, sample);
  for (const node of ears) bakeMesh(node, face, sample, true);
}

export function applyPortraitPlates(mesh, images) {
  if (!images.length) return;
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 800;
  const ctx = canvas.getContext("2d"),
    source = mesh.material.map?.image;
  if (source) ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  else {
    ctx.fillStyle = "#" + mesh.material.color.getHexString();
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  for (const image of images)
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  usePortraitTexture(mesh, canvas);
}
