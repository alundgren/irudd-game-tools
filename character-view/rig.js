import { Euler, Quaternion, Vector3 } from "three";
const rad = Math.PI / 180;
function orientation(rotation) {
  return new Quaternion().setFromEuler(
    new Euler(...rotation.map((n) => n * rad)),
  );
}
export function bindParts(form, links, { metric = false } = {}) {
  const parts = metric
    ? form.parts.map((p) => ({ ...p, frameSize: [...p.size] }))
    : form.parts;
  const byId = new Map(parts.map((p) => [p.id, p]));
  return {
    ...form,
    parts: parts.map((p) => {
      const parent = byId.get(links[p.id]);
      if (!parent) return p;
      const scale = parent.size.map((v, i) => v / (parent.frameSize?.[i] ?? 1));
      const inverse = orientation(parent.rotation).invert();
      const pos = new Vector3(...p.position)
        .sub(new Vector3(...parent.position))
        .applyQuaternion(inverse)
        .divide(new Vector3(...scale))
        .toArray();
      const rotation = new Euler().setFromQuaternion(
        inverse.multiply(orientation(p.rotation)),
      );
      return {
        ...p,
        parent: parent.id,
        position: pos,
        size: p.size.map((x, i) => x / scale[i]),
        rotation: [rotation.x, rotation.y, rotation.z].map(
          (value) => value / rad || 0,
        ),
      };
    }),
  };
}
export function bindHumanoid(form) {
  return bindParts(
    form,
    Object.fromEntries(
      form.parts
        .filter((p) => ["head", "left arm", "right arm"].includes(p.shape))
        .map((p) => [p.id, "torso"]),
    ),
  );
}
