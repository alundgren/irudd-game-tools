import { Ray, Vector3 } from "three";

// Locate a scapula against the rear surface of the current skin. The spar
// starts a little inside the back and leaves along its swept shoulder.
export function scapulaSocket(surface, side) {
  const joint = name => {
    const i = surface.names.indexOf(name) * 3;
    return new Vector3().fromArray(surface.joints, i);
  };
  const chest = joint("spine_03");
  const shoulder = joint(side > 0 ? "upperarm_l" : "upperarm_r");
  const k = surface.height / 1.72;
  const ray = new Ray(
    new Vector3(chest.x + (shoulder.x - chest.x) * .49, shoulder.y - .061 * k, -3),
    new Vector3(0, 0, 1),
  );
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), hit = new Vector3();
  let rear = Infinity;
  for (let i = 0; i < surface.bodyTriangles * 3; i += 3) {
    a.fromArray(surface.positions, surface.indices[i] * 3);
    b.fromArray(surface.positions, surface.indices[i + 1] * 3);
    c.fromArray(surface.positions, surface.indices[i + 2] * 3);
    if (ray.intersectTriangle(a, b, c, false, hit)) rear = Math.min(rear, hit.z);
  }
  if (!Number.isFinite(rear)) throw new Error("Could not find the adult's shoulder-blade surface.");
  return ray.origin.setZ(rear + .012 * k).sub(chest).toArray();
}
