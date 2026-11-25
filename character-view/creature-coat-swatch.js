import { CanvasTexture, SRGBColorSpace } from "three";
import { randomStream } from "./random.js";
const cache = new Map();
const grey = (n) => `rgb(${n},${n},${n})`;
export function coatSwatch(family) {
  if (typeof document === "undefined") return null;
  if (cache.has(family)) return cache.get(family);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 384;
  const c = canvas.getContext("2d");
  const draw = randomStream(554923);
  c.fillStyle = "#f2f2f2";
  c.fillRect(0, 0, 384, 384);
  if (family === "plumage" || family === "scutes") {
    const feather = family === "plumage",
      w = feather ? 24 : 24,
      h = feather ? 55 : 25;
    const step = feather ? 32 : 18;
    for (let j = Math.ceil(384 / step); j >= -1; j--)
      for (let i = -2; i < Math.ceil(384 / w) + 2; i++) {
        const x = (i + 0.5 * (Math.abs(j) % 2)) * w,
          y = j * step;
        const drift = 0.85 * Math.sin((Math.abs(i + j) % 9) * 1.37);
        const v =
          239 +
          Math.round(
            7 * Math.sin((Math.abs(i) % 8) * 1.8 + (Math.abs(j) % 12) * 2.1),
          );
        c.fillStyle = grey(v);
        c.beginPath();
        c.moveTo(x - w * 0.57, y);
        c.quadraticCurveTo(x - w * 0.4, y + h * 0.7, x + drift, y + h);
        c.quadraticCurveTo(x + w * 0.46, y + h * 0.63, x + w * 0.56, y);
        c.closePath();
        c.fill();
        // Only the trailing lap catches light; closed dark borders look like cracks.
        c.strokeStyle = grey(feather ? v - 16 : v - 23);
        c.lineWidth = feather ? 0.8 : 1.35;
        c.beginPath();
        c.moveTo(x - w * 0.34, y + h * 0.51);
        c.quadraticCurveTo(x - w * 0.18, y + h * 0.84, x + drift, y + h);
        c.quadraticCurveTo(
          x + w * 0.18,
          y + h * 0.83,
          x + w * 0.34,
          y + h * 0.53,
        );
        c.stroke();
        c.strokeStyle = grey(Math.min(254, v + 12));
        c.lineWidth = 1.15;
        c.beginPath();
        c.moveTo(x - w * 0.27, y + h * 0.6);
        c.lineTo(x + drift, y + h * 0.93);
        c.stroke();
        if (feather) {
          c.strokeStyle = grey(v - 17);
          c.lineWidth = 0.9;
          c.beginPath();
          c.moveTo(x, y + 3);
          c.quadraticCurveTo(
            x + drift * 2,
            y + h * 0.57,
            x + drift,
            y + h * 0.85,
          );
          c.stroke();
          for (let k = 1; k < 5; k++)
            for (const sign of [-1, 1]) {
              c.strokeStyle = grey(v - 9);
              c.beginPath();
              c.moveTo(x + drift, y + h * (0.32 + k * 0.115));
              c.lineTo(
                x + sign * w * (0.42 - 0.04 * k),
                y + h * (0.11 + k * 0.1),
              );
              c.stroke();
            }
        }
      }
  } else if (family === "pelt") {
    for (let i = 0; i < 7900; i++) {
      const x = draw() * 384,
        y = draw() * 384,
        dx = 2.8 * Math.sin((x / 384) * 6.283) + (draw() - 0.5) * 5,
        dy = 5 + 9 * draw();
      c.strokeStyle = grey(189 + Math.floor(64 * draw()));
      c.lineWidth = 0.35 + 1.6 * draw();
      for (const oy of [0, ...(y + dy > 383 ? [-384] : [])]) {
        c.beginPath();
        c.moveTo(x, y + oy);
        c.quadraticCurveTo(
          x + dx * 0.2,
          y + oy + dy * 0.6,
          x + dx,
          y + oy + dy,
        );
        c.stroke();
      }
    }
  } else {
    const image = c.createImageData(384, 384);
    for (let j = 0; j < 384; j++)
      for (let i = 0; i < 384; i++) {
        const x = (i / 384) * 6.283,
          y = (j / 384) * 6.283;
        const ripples =
          Math.sin(23 * x + 2 * Math.sin(y * 7)) * 0.28 +
          Math.sin(y * 19 + 1.8 * Math.sin(5 * x)) * 0.26 +
          Math.sin(15 * x + 17 * y) * 0.18;
        const value = Math.round(
          226 + 13 * ripples - 16 * Math.max(0, 0.48 - ripples),
        );
        const at = 4 * (i + j * 384);
        image.data[at] = image.data[at + 1] = image.data[at + 2] = value;
        image.data[at + 3] = 255;
      }
    c.putImageData(image, 0, 0);
  }
  const map = new CanvasTexture(canvas);
  map.colorSpace = SRGBColorSpace;
  map.anisotropy = 4;
  cache.set(family, map);
  return map;
}
