import * as T from "three";
import type { HumanBody } from "./body.js";
import type { StudioFit } from "./studio-fit.js";

export function studioEyes(
  body: HumanBody,
  fit: StudioFit,
  g: T.BufferGeometry,
  origin: readonly [number, number, number],
) {
  const pack = body.studio,
    raw = pack.f32("eyes.position"),
    sides = pack.u8("eyes.left"),
    box = pack.f32("eyes.box");
  const p = g.getAttribute("position"),
    uv = g.getAttribute("uv"),
    rgb = new Float32Array(3 * p.count);
  const axis = new T.Vector3().fromArray(pack.f32("eyes.axis")).normalize(),
    v = new T.Vector3();
  const centres = [new T.Vector3(), new T.Vector3()];
  for (const [sign, label] of ["R", "L"].entries()) {
    const lids = pack.u16("lids." + label),
      was = new T.Vector3(),
      now = new T.Vector3();
    for (const c of lids) {
      was.add(v.fromArray(fit.carried, 3 * c));
      now.add(v.fromArray(fit.moved, 3 * c));
    }
    was.divideScalar(lids.length);
    now.divideScalar(lids.length);
    let before = 0,
      after = 0;
    for (const c of lids) {
      before += was.distanceTo(v.fromArray(fit.carried, 3 * c));
      after += now.distanceTo(v.fromArray(fit.moved, 3 * c));
    }
    const grow = T.MathUtils.clamp(after / before, 0.8, 1.25),
      from = new T.Vector3().fromArray(pack.f32("centre." + label)).applyMatrix4(fit.matrix);
    const to = from
      .clone()
      .add(now)
      .sub(was)
      .sub(new T.Vector3(...origin));
    centres[sign] = to;
    for (let i = 0; i < p.count; i++)
      if (sides[i] === sign) {
        v.fromArray(raw, 3 * i)
          .applyMatrix4(fit.matrix)
          .sub(from);
        const light =
          0.5 + 0.5 * T.MathUtils.smoothstep(axis.dot(v.clone().normalize()), 0.35, 0.93);
        rgb.set([light, light * (0.94 + 0.06 * light), light * (0.9 + 0.1 * light)], 3 * i);
        v.multiplyScalar(grow).add(to);
        p.setXYZ(i, v.x, v.y, v.z);
      }
  }
  for (let i = 0; i < uv.count; i++)
    uv.setXY(
      i,
      T.MathUtils.clamp((uv.getX(i) - (box[0] ?? 0)) / ((box[2] ?? 1) - (box[0] ?? 0)), 0, 1),
      1 -
        T.MathUtils.clamp((1 - uv.getY(i) - (box[1] ?? 0)) / ((box[3] ?? 1) - (box[1] ?? 0)), 0, 1),
    );
  g.computeVertexNormals();
  g.setAttribute("color", new T.BufferAttribute(rgb, 3));
  g.morphTargetsRelative = true;
  const normal = g.getAttribute("normal"),
    positions: T.BufferAttribute[] = [],
    normals: T.BufferAttribute[] = [];
  for (const [name, axis, angle] of [
    ["LookLeft", 1, 0.32],
    ["LookRight", 1, -0.32],
    ["LookUp", 0, -0.23],
    ["LookDown", 0, 0.23],
    ["Blink", 0, 0],
  ] as const) {
    const w = new T.Vector3(),
      about = new T.Vector3().setComponent(axis, 1),
      shift = new Float32Array(raw.length),
      lean = new Float32Array(raw.length);
    for (let i = 0; i < p.count; i++) {
      const centre = centres[sides[i] ?? 0] ?? toOrigin;
      v.fromBufferAttribute(p, i).sub(centre);
      if (name === "Blink") v.multiplyScalar(-0.09).toArray(shift, 3 * i);
      else {
        w.copy(v)
          .applyAxisAngle(about, angle)
          .sub(v)
          .toArray(shift, 3 * i);
        v.fromBufferAttribute(normal, i);
        w.copy(v)
          .applyAxisAngle(about, angle)
          .sub(v)
          .toArray(lean, 3 * i);
      }
    }
    const a = new T.BufferAttribute(shift, 3),
      b = new T.BufferAttribute(lean, 3);
    a.name = b.name = name;
    positions.push(a);
    normals.push(b);
  }
  g.morphAttributes["position"] = positions;
  g.morphAttributes["normal"] = normals;
}
const toOrigin = new T.Vector3();
