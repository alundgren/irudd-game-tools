import { Triangle, Vector3 } from "three";

export function scanBoundary(faces) {
  const vertices = new Map();
  const ids = new Uint32Array(3 * faces.length);
  for (let i = 0; i < faces.length; i++) {
    const { a, b, c } = faces[i].tri;
    for (const [corner, p] of [a, b, c].entries()) {
      const key = [p.x, p.y, p.z].join(",");
      if (!vertices.has(key)) vertices.set(key, vertices.size);
      ids[i * 3 + corner] = vertices.get(key);
    }
  }
  const stride = vertices.size;
  const open = new Set(), shared = new Set();
  const edge = (a, b) => Math.min(a, b) * stride + Math.max(a, b);
  for (let i = 0; i < ids.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const key = edge(ids[i+k], ids[i+(k+1)%3]);
      if (open.delete(key)) shared.add(key);
      else if (!shared.has(key)) open.add(key);
    }
  }
  const rim = new Set();
  for (const key of open) {
    rim.add(Math.floor(key/stride));
    rim.add(key%stride);
  }
  const masks = new WeakMap();
  for (let i = 0; i < faces.length; i++) {
    let mask = 0;
    for (let k = 0; k < 3; k++) {
      if (rim.has(ids[3*i+k])) mask |= 1 << (3+k);
      if (open.has(edge(ids[3*i+(k+1)%3], ids[3*i+(k+2)%3]))) mask |= 1 << k;
    }
    if (mask) masks.set(faces[i], mask);
  }
  const bary = new Vector3();
  return (face, point) => {
    const mask = masks.get(face);
    if (!mask) return false;
    const {a, b, c} = face.tri;
    Triangle.getBarycoord(point, a, b, c, bary);
    for (let k = 0; k < 3; k++) {
      const weight = bary.getComponent(k);
      if ((mask & (1 << k)) && weight < 1e-5) return true;
      if ((mask & (1 << (3+k))) && weight > 1-1e-5) return true;
    }
    return false;
  };
}
