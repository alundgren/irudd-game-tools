import { Euler, Quaternion, Vector3 } from "three";
import { need } from "./need.js";
import type { Form, FormPart } from "./types.js";

const rad = Math.PI / 180;
function orientation(rotation: number[]) {
  const [x = 0, y = 0, z = 0] = rotation.map((n) => n * rad);
  return new Quaternion().setFromEuler(new Euler(x, y, z));
}
const vector = ([x = 0, y = 0, z = 0]: number[]) => new Vector3(x, y, z);
export function bindParts(
  form: Form,
  links: Record<string, string>,
  { metric = false } = {},
): Form {
  const parts: FormPart[] = metric
    ? form.parts.map((p) => ({ ...p, frameSize: [...p.size] }))
    : form.parts;
  const byId = new Map(parts.map((p) => [p.id, p]));
  return {
    ...form,
    parts: parts.map((p) => {
      const link = links[p.id];
      const parent = link === undefined ? undefined : byId.get(link);
      if (!parent) return p;
      const scale = parent.size.map((v, i) => v / (parent.frameSize?.[i] ?? 1));
      const inverse = orientation(parent.rotation).invert();
      const pos = vector(p.position)
        .sub(vector(parent.position))
        .applyQuaternion(inverse)
        .divide(vector(scale))
        .toArray();
      const rotation = new Euler().setFromQuaternion(inverse.multiply(orientation(p.rotation)));
      return {
        ...p,
        parent: parent.id,
        position: pos,
        size: p.size.map((x, i) => x / need(scale[i])),
        rotation: [rotation.x, rotation.y, rotation.z].map((value) => value / rad || 0),
      };
    }),
  };
}
