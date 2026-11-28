import { Color, MathUtils, Vector3 } from "three";
import { randomStream } from "../../random.js";
import { need } from "./need.js";
import type { Form, FormPart, Plan, Skin, Spine } from "./types.js";

const { clamp, lerp } = MathUtils;
const stations = [0, 0.12, 0.33, 0.56, 0.76, 0.92, 1];
const vanes = [0.14, 0.64, 0.93, 1, 0.72, 0.35, 0.035];
const section = [
  [-1, 0],
  [-0.42, 0.46],
  [0, 1],
  [0.42, 0.4],
  [1, 0],
  [0, -0.4],
];
const across = new Vector3(1, 0, 0);
const pigment = (skin: Skin, amount: number) =>
  "#" + new Color(skin.base).lerp(new Color(skin.accent), amount).getHexString();

export function featherChart(part: FormPart): number[][] | null {
  if (!part.contourFeather || part.cage?.vertices?.length !== stations.length * section.length)
    return null;
  return stations.flatMap((t) => section.map(([side = 0]) => [(side + 1) / 2, t]));
}

function surface(spine: Spine, t: number, angle: number, lift: number): Vector3 {
  const frame = spine.at(t);
  const width = frame.radius[0],
    depth = frame.radius[1];
  const normal = frame.dorsal
    .clone()
    .multiplyScalar(Math.cos(angle) / depth)
    .addScaledVector(across, Math.sin(angle) / width)
    .normalize();
  return frame.centre
    .clone()
    .addScaledVector(across, width * Math.sin(angle))
    .addScaledVector(frame.dorsal, depth * Math.cos(angle))
    .addScaledVector(normal, lift);
}

export function plumageMantle(
  form: Form,
  plan: Plan,
  spine: Spine,
  carrier: FormPart,
  room: number,
): Form {
  const { back, scale, skin } = plan,
    draw = randomStream(back.seed ?? 0);
  if (room < 3) return form;
  const columns = room >= 28 ? 9 : room >= 21 ? 7 : room >= 15 ? 5 : 3;
  const rows = Math.min(Math.max(1, back.count), Math.floor(room / columns), 6);
  const parts = [...form.parts],
    base = new Vector3().fromArray(carrier.position);
  const sweep = 0.82 + 0.82 * (back.spread ?? 0);
  const pitch = 0.63 / Math.max(2, rows - 1);
  const girth = scale * plan.spine.girth;
  const gain = clamp(back.height / plan.spine.girth, 0.15, 2);
  for (let row = 0; row < rows; row++) {
    const root = rows === 1 ? 0.79 : lerp(0.31, 0.94, row / (rows - 1));
    for (let col = 0; col < columns; col++) {
      const fraction = (2 * col) / (columns - 1) - 1;
      const jitter = ((row % 2 ? 0.35 : -0.35) * (1 - Math.abs(fraction))) / (columns - 1);
      const angle = sweep * (fraction + jitter);
      const length = pitch * (1.43 + 0.46 * draw()) + 0.071;
      const halfWidth = (sweep / (columns - 1)) * (1.15 + 0.13 * draw());
      const barb = 0.12 + 0.15 * draw();
      const vertices: Vector3[] = [];
      for (let i = 0; i < stations.length; i++) {
        const t = need(stations[i]);
        const vane = need(vanes[i]);
        for (const [edge = 0, ridge = 0] of section) {
          const arc =
            angle +
            fraction * (0.34 + barb) * t +
            edge * vane * halfWidth * (1 - 0.11 * fraction * edge);
          const along = root - t * length + 0.035 * (1 - Math.abs(fraction));
          const lift =
            girth *
              (t < 0.12
                ? lerp(-0.09, 0.035, t / 0.12)
                : 0.035 + gain * (0.073 * Math.sin(Math.PI * t) + 0.083 * t)) +
            girth * (ridge * 0.045 - edge * edge * 0.022) * vane;
          const point = surface(spine, Math.max(0.035, along), arc, lift);
          if (along < 0.035)
            point.addScaledVector(
              spine.at(0.035).tangent,
              (along - 0.035) * plan.spine.length * scale,
            );
          vertices.push(point);
        }
      }
      const sides = section.length;
      const faces: number[][] = [Array.from({ length: sides }, (_, k) => k).reverse()];
      for (let i = 0; i < stations.length - 1; i++) {
        for (let k = 0; k < sides; k++) {
          const a = i * sides + k,
            b = i * sides + ((k + 1) % sides);
          faces.push([a, b, b + sides, a + sides]);
        }
      }
      faces.push(Array.from({ length: sides }, (_, k) => (stations.length - 1) * sides + k));
      const pivot = surface(spine, root, angle, 0);
      const unit = Math.max(girth, 0.01);
      parts.push({
        id: `contour feather ${row + 1}.${col + 1}`,
        parent: carrier.id,
        shape: "cage",
        cage: {
          vertices: vertices.map((v) =>
            v
              .sub(pivot)
              .multiplyScalar(1 / unit)
              .toArray(),
          ),
          faces,
          levels: 1,
        },
        position: pivot.sub(base).toArray(),
        rotation: [0, 0, 0],
        size: [unit, unit, unit],
        frameSize: [unit, unit, unit],
        color: pigment(skin, 0.012 + 0.075 * Math.abs(fraction) + 0.06 * draw()),
        surface: "plain",
        motionRole: "rigid",
        contourFeather: true,
      });
    }
  }
  return { ...form, parts };
}
