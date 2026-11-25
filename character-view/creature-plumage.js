import { CanvasTexture, Color, Float32BufferAttribute, MathUtils, Vector3 } from "three";
import { randomStream } from "./random.js";

const { clamp, lerp } = MathUtils;
const stations = [0, 0.12, 0.33, 0.56, 0.76, 0.92, 1];
const vanes = [0.14, 0.64, 0.93, 1, 0.72, 0.35, 0.035];
// A flattened, closed cross-section with the quill on the visible side.
const section = [[-1, 0], [-0.42, 0.46], [0, 1], [0.42, 0.4], [1, 0], [0, -0.4]];
const across = new Vector3(1, 0, 0);
const pigment = (skin, amount) => "#" + new Color(skin.base).lerp(new Color(skin.accent), amount).getHexString();

/** Coordinates follow each vane through subdivision and manual edits to its cage. */
export function featherChart(part) {
  if (!part.contourFeather || part.cage?.vertices?.length !== stations.length * section.length) return null;
  return stations.flatMap(t => section.map(([side]) => [(side + 1) / 2, t]));
}

function surface(spine, t, angle, lift) {
  const frame = spine.at(t);
  const width = frame.radius[0], depth = frame.radius[1];
  const normal = frame.dorsal.clone().multiplyScalar(Math.cos(angle) / depth)
    .addScaledVector(across, Math.sin(angle) / width).normalize();
  return frame.centre.clone().addScaledVector(across, width * Math.sin(angle))
    .addScaledVector(frame.dorsal, depth * Math.cos(angle)).addScaledVector(normal, lift);
}

/** Draw overlapping rows of covert feathers over the shoulder and flank. Each
 * vane tracks the curved trunk all the way to its free tip. */
export function plumageMantle(form, plan, spine, carrier, room) {
  const { back, scale, skin } = plan, draw = randomStream(back.seed);
  if (room < 3) return form;
  const columns = room >= 28 ? 9 : room >= 21 ? 7 : room >= 15 ? 5 : 3;
  const rows = Math.min(Math.max(1, back.count), Math.floor(room / columns), 6);
  const parts = [...form.parts], base = new Vector3(...carrier.position);
  const sweep = 0.82 + 0.82 * back.spread;
  const pitch = 0.63 / Math.max(2, rows - 1);
  const girth = scale * plan.spine.girth;
  const gain = clamp(back.height / plan.spine.girth, 0.15, 2);
  for (let row = 0; row < rows; row++) {
    const root = rows === 1 ? 0.79 : lerp(0.31, 0.94, row / (rows - 1));
    for (let col = 0; col < columns; col++) {
      const fraction = 2 * col / (columns - 1) - 1;
      const jitter = (row % 2 ? 0.35 : -0.35) * (1 - Math.abs(fraction)) / (columns - 1);
      const angle = sweep * (fraction + jitter);
      const length = pitch * (1.43 + 0.46 * draw()) + 0.071;
      const halfWidth = sweep / (columns - 1) * (1.15 + 0.13 * draw());
      const barb = 0.12 + 0.15 * draw();
      const vertices = [];
      for (let i = 0; i < stations.length; i++) {
        const t = stations[i];
        for (const [edge, ridge] of section) {
          const arc = angle + fraction * (0.34 + barb) * t
            + edge * vanes[i] * halfWidth * (1 - 0.11 * fraction * edge);
          const along = root - t * length + 0.035 * (1 - Math.abs(fraction));
          const lift = girth * (t < 0.12 ? lerp(-0.09, 0.035, t / 0.12) : 0.035
            + gain * (0.073 * Math.sin(Math.PI * t) + 0.083 * t))
            + girth * (ridge * 0.045 - edge * edge * 0.022) * vanes[i];
          const point = surface(spine, Math.max(0.035, along), arc, lift);
          if (along < 0.035) point.addScaledVector(spine.at(0.035).tangent, (along - 0.035) * plan.spine.length * scale);
          vertices.push(point);
        }
      }
      const sides = section.length;
      const faces = [Array.from({ length: sides }, (_, k) => k).reverse()];
      for (let i = 0; i < stations.length - 1; i++) {
        for (let k = 0; k < sides; k++) {
          const a = i * sides + k, b = i * sides + (k + 1) % sides;
          faces.push([a, b, b + sides, a + sides]);
        }
      }
      faces.push(Array.from({ length: sides }, (_, k) => (stations.length - 1) * sides + k));
      const pivot = surface(spine, root, angle, 0);
      const unit = Math.max(girth, 0.01);
      parts.push({
        id: `contour feather ${row + 1}.${col + 1}`, parent: carrier.id, shape: "cage",
        cage: { vertices: vertices.map(v => v.sub(pivot).multiplyScalar(1 / unit).toArray()), faces, levels: 1 },
        position: pivot.sub(base).toArray(), rotation: [0, 0, 0],
        size: [unit, unit, unit], frameSize: [unit, unit, unit],
        color: pigment(skin, 0.012 + 0.075 * Math.abs(fraction) + 0.06 * draw()),
        surface: "plain", motionRole: "rigid", contourFeather: true,
      });
    }
  }
  return { ...form, parts };
}

/** The shaft, subterminal band and pale outer vane belong to the plumage;
 * these colours are also available in the ordinary single-material GLB. */
export function finishContourFeather(mesh, part, material) {
  // One neutral feather tile serves the whole mantle. The natural growth direction, shaft
  // and barbs remain attached to the vane even if its control cage is bent or narrowed.
  if (!material.map && typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    const w = 128, h = 256;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (ctx?.createImageData) {
      const data = ctx.createImageData(w, h);
      for (let y = 0; y < h; y++) for (let i = 0; i < w; i++) {
        const t = 1 - (y + 0.5) / h, x = Math.abs(2 * (i + 0.5) / w - 1);
        const sweep = t - 0.30 * x + 0.07 * x * x;
        const barbs = 0.5 + 0.5 * Math.cos(2 * Math.PI * (21 * sweep + 0.15 * Math.sin(x * 14 + t * 9)));
        const band = Math.exp(-((sweep - 0.65) ** 2) / 0.0045);
        const root = MathUtils.smoothstep(t, 0.06, 0.45);
        const shaft = Math.exp(-((x / (0.019 + 0.024 * (1 - t))) ** 2));
        const ink = (0.89 + 0.105 * barbs - 0.30 * band) * (0.87 + 0.13 * root);
        const v = Math.round(255 * lerp(ink, 1, shaft));
        const offset = 4 * (y * w + i);
        data.data.set([v, v, v, 255], offset);
      }
      ctx.putImageData(data, 0, 0);
      material.map = new CanvasTexture(canvas);
      material.userData.contourPlumage = true;
      material.roughness = 0.94;
    }
  }
  const uv = mesh.geometry.attributes.uv;
  if (!uv) return;
  const base = new Color(part.color), shade = new Color(), pale = new Color("#efe2ca");
  const colors = new Float32Array(3 * uv.count);
  for (let i = 0; i < uv.count; i++) {
    const x = Math.abs(2 * uv.getX(i) - 1), t = uv.getY(i);
    const band = Math.exp(-((t - 0.76 + 0.14 * x) ** 2) / 0.005);
    const shaft = Math.exp(-60 * x * x) * (1 - t);
    const tip = MathUtils.smoothstep(t - 0.07 * x, 0.83, 1);
    shade.copy(base).multiplyScalar(0.92 - 0.54 * band)
      .lerp(pale, 0.18 * shaft + 0.48 * tip).toArray(colors, i * 3);
  }
  mesh.geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  mesh.material = material;
}
