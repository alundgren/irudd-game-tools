import { CanvasTexture, Color, MathUtils, SRGBColorSpace, Vector3 } from "three";
import { backdropOpacity, photoRegistration, rasterTriangles } from "./portrait-plate.js";
import { mouthLining } from "./human-mouth.js";

export const nativeHead = form => form.parts.find(p => p.humanBone === "head" && !p.humanSource);

export function setNativePortrait(form, artwork) {
  const head = nativeHead(form), prior = head?.nativePortrait;
  if (!head) throw new Error("Choose an editable native human head.");
  const next = { ...head };
  delete next.nativePortrait;
  if (artwork) next.nativePortrait = artwork.id;
  const parts = form.parts.map(p => p === head ? next : p);
  const images = { ...form.artwork };
  if (prior && !parts.some(p => p.nativePortrait === prior)) delete images[prior];
  if (artwork) images[artwork.id] = artwork.url;
  return { ...form, parts, artwork: images };
}

export const portraitLandmarks = {
  front: ["Left eye in picture", "Right eye in picture", "Nose tip", "Lip seam at centre", "Bottom of chin"],
  side: ["Eye", "Nose tip", "Lip seam at front", "Bottom of chin", "Ear opening"],
};

const smooth = MathUtils.smoothstep;
const clampByte = value => Math.max(0, Math.min(255, value));

export function portraitTargets(geometry, surface, origin) {
  const point = id => new Vector3().fromArray(surface.positions, id * 3).sub(origin);
  const eyes = surface.eyeGroups.map(ids => {
    const eye = new Vector3();
    for (const id of ids) eye.add(point(id));
    return eye.multiplyScalar(1 / ids.length);
  }).sort((a, b) => a.x - b.x);
  const nose = point(297), mouth = point(474).lerp(point(523), .5);
  const k = surface.height / 1.72, chin = point(732);
  const ear = eyes[1].clone().add(new Vector3(.03 * k, -.022 * k, -.082 * k));
  const positions = geometry.attributes.position, sample = new Vector3();
  let lateral = -Infinity;
  for (let i = 0; i < positions.count; i++) {
    sample.fromBufferAttribute(positions, i);
    if (Math.abs(sample.y - ear.y) < .006 * k && sample.x > lateral) {
      lateral = sample.x;
      ear.z = sample.z + .005 * k;
    }
  }
  return { eyes, nose, mouth, chin, ear, k };
}

function pixels(canvas, marks, points) {
  const { width, height } = canvas;
  const data = canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, width, height).data;
  const map = photoRegistration(points.map((at, i) => ({ at, uv: marks[i] })), height / width);
  const pixel = (x, y) => 4 * (Math.max(0, Math.min(width - 1, x)) + width * Math.max(0, Math.min(height - 1, y)));
  const at = (u, v) => pixel(Math.round(u * (width - 1)), Math.round(v * (height - 1)));
  return { width, height, data, map, at };
}

// Check visibility in the planar camera before the landmark warp. The profile
// photo is mirrored onto the opposite cheek, so evaluate each side separately.
function cameraVisibility(geometry, horizontal, depth, sign, scale) {
  const positions = geometry.attributes.position;
  const size = 384, density = 900 / scale;
  const px = x => size / 2 + x * density;
  const py = y => size / 2 - y * density;
  const coords = new Float32Array(positions.count * 2);
  for (let i = 0; i < positions.count; i++) {
    coords[2 * i] = px(horizontal(i));
    coords[2 * i + 1] = py(positions.getY(i));
  }
  const closest = new Float32Array(size * size).fill(-Infinity);
  rasterTriangles(geometry, coords, size, size, (pixel, a, b, c, t, u, v) => {
    const d = sign * (depth(a) * t + depth(b) * u + depth(c) * v);
    closest[pixel] = Math.max(closest[pixel], d);
  });
  return (x, y, d) => {
    const sx = Math.floor(px(x)), sy = Math.floor(py(y));
    if (sx < 0 || sy < 0 || sx >= size || sy >= size) return 0;
    const gap = closest[sy * size + sx] - sign * d;
    return 1 - smooth(gap, .0015 * scale, .0055 * scale);
  };
}

function skinSample(image, uv) {
  const colours = [[], [], []];
  for (let y = -.021; y <= .021; y += .004)
    for (let x = -.021; x <= .021; x += .004) {
      const p = image.at(uv[0] + x, uv[1] + y);
      for (let k = 0; k < 3; k++) colours[k].push(image.data[p + k]);
    }
  return colours.map(values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)]);
}

function broadColour(image) {
  const { width, height, data, skin } = image;
  const clean = document.createElement("canvas"), blur = document.createElement("canvas");
  clean.width = width;
  clean.height = height;
  const ctx = clean.getContext("2d", { willReadFrequently: true });
  const rgba = ctx.createImageData(width, height);
  rgba.data.set(data);
  for (let y = 0; y < height; y++) {
    const start = y * width * 4, end = start + (width - 1) * 4;
    for (let x = 0; x < width; x++) {
      const p = start + x * 4;
      const opacity = (data[p + 1] > Math.max(data[p], data[p + 2]) + 18 ? 0
        : backdropOpacity(data, p, start, end)) * data[p + 3] / 255;
      for (let k = 0; k < 3; k++) rgba.data[p + k] = MathUtils.lerp(skin[k], data[p + k], opacity);
      rgba.data[p + 3] = 255;
    }
  }
  ctx.putImageData(rgba, 0, 0);
  blur.width = 54;
  blur.height = Math.max(1, Math.round(blur.width * height / width));
  blur.getContext("2d").drawImage(clean, 0, 0, blur.width, blur.height);
  ctx.drawImage(blur, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height).data;
}

// The layer stores colour variation relative to the source's skin. At render
// time its neutral value becomes the current adult's skin tone.
export function bakeNativePortrait(mesh, surface, origin, front, side, marks) {
  if (!mesh?.material.userData.faceLayout) throw new Error("The native face paint is still loading.");
  const f = marks?.front, s = marks?.side;
  const complete = list => list?.length === 5 && list.every(point =>
    point.length === 2 && point.every(value => Number.isFinite(value) && value >= 0 && value <= 1));
  if (!complete(f) || !complete(s) || f[1][0] - f[0][0] < .05 ||
      s[1][0] - s[0][0] < .02 || f[4][1] - f[3][1] < .02 || s[3][1] - s[2][1] < .02)
    throw new Error("Mark the five points on each view in order. The profile's nose points right.");
  const { geometry } = mesh, pos = geometry.attributes.position, norm = geometry.attributes.normal,
    uv = geometry.attributes.uv, lining = mouthLining(geometry);
  const { eyes, nose, mouth, chin, ear, k } = portraitTargets(geometry, surface, origin);
  const a = pixels(front, marks.front, [...eyes, nose, mouth, chin].map(v => [v.x, v.y]));
  const b = pixels(side, marks.side, [eyes[0], nose, mouth, chin, ear].map(v => [v.z, v.y]));
  const positionX = i => pos.getX(i), positionZ = i => pos.getZ(i);
  const frontVisible = cameraVisibility(geometry, positionX, positionZ, 1, k);
  const leftVisible = cameraVisibility(geometry, positionZ, positionX, -1, k);
  const rightVisible = cameraVisibility(geometry, positionZ, positionX, 1, k);
  // Cheek swatches well away from eyes and lips align the two source exposures.
  a.skin = skinSample(a, [MathUtils.lerp(marks.front[0][0], marks.front[2][0], .23),
    MathUtils.lerp(marks.front[2][1], marks.front[3][1], .28)]);
  b.skin = skinSample(b, [MathUtils.lerp(marks.side[4][0], marks.side[1][0], .6),
    MathUtils.lerp(marks.side[1][1], marks.side[3][1], .29)]);
  a.broad = broadColour(a);
  b.broad = broadColour(b);
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 1120;
  const ctx = canvas.getContext("2d"), target = ctx.createImageData(canvas.width, canvas.height);
  const xy = new Float32Array(uv.count * 2), out = [0, 0];
  for (let i = 0; i < uv.count; i++) xy.set([uv.getX(i) * canvas.width, (1 - uv.getY(i)) * canvas.height], i * 2);
  function from(image, x, y) {
    image.map(x, y, out);
    if (out.some(v => v <= 0 || v >= 1)) return [0, 0];
    const p = image.at(...out), row = Math.floor(p / 4 / image.width);
    const start = row * image.width * 4, end = start + (image.width - 1) * 4;
    if (image.data[p + 1] > Math.max(image.data[p], image.data[p + 2]) + 18) return [p, 0];
    const skinLevel = image.skin[0] + image.skin[1] + image.skin[2];
    const localLevel = image.broad[p] + image.broad[p + 1] + image.broad[p + 2];
    const matte = smooth(localLevel / Math.max(1, skinLevel), .54, .79);
    return [p, matte * backdropOpacity(image.data, p, start, end) * image.data[p + 3] / 255];
  }
  const colour = (im, p, channel) => {
    const q = p + channel;
    const texture = MathUtils.clamp(im.data[q] - im.broad[q], -31, 31);
    const colour = MathUtils.clamp(im.broad[q] - im.skin[channel], -35, 35);
    return 1.26 * texture + .28 * colour;
  };
  rasterTriangles(geometry, xy, canvas.width, canvas.height, (pixel, i, j, h, t, u, v) => {
    if (lining[i] || lining[j] || lining[h]) return;
    const x = pos.getX(i) * t + pos.getX(j) * u + pos.getX(h) * v;
    const y = pos.getY(i) * t + pos.getY(j) * u + pos.getY(h) * v;
    const z = pos.getZ(i) * t + pos.getZ(j) * u + pos.getZ(h) * v;
    const nx = norm.getX(i) * t + norm.getX(j) * u + norm.getX(h) * v;
    const nz = norm.getZ(i) * t + norm.getZ(j) * u + norm.getZ(h) * v;
    const eyelids = Math.min(...eyes.map(eye =>
      smooth(Math.hypot((x - eye.x) / (.024 * k), (y - eye.y - .005 * k) / (.016 * k)), .84, 1.68)));
    const lips = smooth(Math.hypot((x - mouth.x) / (.031 * k), (y - mouth.y) / (.010 * k)), .69, 1.30);
    const ears = smooth(Math.hypot(
      (Math.abs(x) - ear.x) / (.019 * k), (y - ear.y) / (.029 * k), (z - ear.z) / (.027 * k),
    ), .85, 1.73);
    const height = smooth(y, chin.y - .023 * k, chin.y + .010 * k)
      * (1 - smooth(y, eyes[0].y + .061 * k, eyes[0].y + .083 * k));
    const frontness = smooth(nz, .08, .83);
    // At the temple the source contains a different hairline. Fade the profile
    // above the cheekbone and before the nose so those edges cannot repeat.
    const profile = smooth(Math.abs(nx), .32, .88)
      * smooth(z, ear.z + .011 * k, ear.z + .043 * k)
      * (1 - smooth(y, eyes[0].y - .018 * k, eyes[0].y + .004 * k))
      * (1 - smooth(z, nose.z - .019 * k, nose.z - .006 * k));
    const [pa, ma] = from(a, x, y), [pb, mb] = from(b, z, y);
    const sideVisible = x < 0 ? leftVisible : rightVisible;
    const fa = ma * frontness * frontVisible(x, y, z);
    const fb = mb * profile * (1 - frontness * .87) * sideVisible(z, y, x);
    const weight = fa + fb;
    if (weight < .001) return;
    const i4 = pixel * 4;
    for (let channel = 0; channel < 3; channel++) {
      const tone = (fa * colour(a, pa, channel) + fb * colour(b, pb, channel)) / weight;
      target.data[i4 + channel] = clampByte(128 + tone);
    }
    target.data[i4 + 3] = 255 * Math.min(1, weight * 1.6) * height * eyelids * ears * (.14 + .86 * lips);
  });
  ctx.putImageData(target, 0, 0);
  return canvas;
}

export function applyNativePortrait(mesh, image) {
  const material = mesh?.material;
  if (!image || !material?.userData.faceLayout) return;
  const source = material.map.image, canvas = document.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(source, 0, 0);
  const paint = ctx.getImageData(0, 0, canvas.width, canvas.height);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  const overlay = ctx.getImageData(0, 0, canvas.width, canvas.height);
  // Three multiplies the material tint in linear light. Preserve that colour
  // everywhere, then add only the portrait's relative detail inside its mask.
  const tint = new Float32Array(256 * 3), grey = new Color(), rgb = {};
  for (let value = 0; value < 256; value++) {
    const s = value / 255;
    grey.setRGB(s, s, s, SRGBColorSpace).multiply(material.color).getRGB(rgb, SRGBColorSpace);
    tint.set([255 * rgb.r, 255 * rgb.g, 255 * rgb.b], value * 3);
  }
  const exposure = .56 + .36 * Math.sqrt(tint[255 * 3 + 1] / 255);
  for (let p = 0; p < paint.data.length; p += 4) {
    const alpha = overlay.data[p + 3] / 255;
    for (let c = 0; c < 3; c++) {
      const original = tint[paint.data[p + c] * 3 + c];
      paint.data[p + c] = original + alpha * (overlay.data[p + c] - 128) * exposure;
    }
  }
  ctx.putImageData(paint, 0, 0);
  material.map = new CanvasTexture(canvas);
  material.map.colorSpace = SRGBColorSpace;
  material.map.anisotropy = 8;
  material.color.set(0xffffff);
  material.userData.portraitPlate = true;
  mesh.userData.ownedPortraitTexture = true;
}
