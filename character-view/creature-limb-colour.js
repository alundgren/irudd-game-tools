import { Color, Float32BufferAttribute, MathUtils, Vector3 } from "three";

// The plan limb that each built limb came from, by the name the plan gave it.
function limbsByName(plan) {
  const counters = {}, named = new Map();
  for (const limb of plan?.limbs ?? []) for (let i = 0; i < limb.pairs; i++)
    for (const side of limb.side === "both" ? ["left", "right"] : [limb.side]) {
      const name = side + " " + limb.kind;
      counters[name] = (counters[name] ?? 0) + 1;
      named.set(name + " " + counters[name], limb);
    }
  return named;
}

// Pigment follows the anatomy of a limb. Its length is measured along the
// linked thigh, shin and foot (or upper arm, forearm and hand), so the layers
// run on over each welded seam.
//   A fleshy limb is paler on its inner face, creased darker at the joint and
//   a little darker towards the foot, most on a hoofed leg.
//   A bird leg is bare below the joint: the shank and foot take a horn colour.
//   An arthropod leg has a pale membrane at each joint, a darker far segment
//   and a dark tip.
// `socks` with `limbFade` still fades the whole limb to its dark end. `socks`
// alone colours the far parts in the plan, so no darker end is added here.
export function limbPigments(form, objects) {
  const plan = form.origin?.plan, skin = plan?.skin;
  const result = new Map();
  if (!skin) return result;
  const origin = limbsByName(plan);
  for (const first of form.parts) {
    const match = first.id.match(
      /^((left|right) (leg|arm) \d+) (thigh|upper)$/,
    );
    if (!match) continue;
    const prefix = match[1],
      arm = match[3] === "arm",
      inward = match[2] === "left" ? -1 : 1,
      limb = origin.get(prefix);
    const names = [
      first.id,
      prefix + (arm ? " forearm" : " shin"),
      prefix + (arm ? " hand" : " foot"),
    ];
    const parts = names.map((n) => objects.get(n));
    if (!parts[0] || !parts[1]) continue;
    const points = parts.filter(Boolean).map((o) => o.getWorldPosition(new Vector3()));
    const segments = [];
    let length = 0;
    for (let i = 1; i < points.length; i++) {
      const dir = new Vector3().subVectors(points[i], points[i - 1]);
      const size = dir.length();
      if (size <= 1e-5) continue;
      segments.push({
        a: points[i - 1],
        dir: dir.divideScalar(size),
        size,
        offset: length,
      });
      length += size;
    }
    if (!length || !segments.length) continue;
    // A limb with no foot of its own ends a segment's length below its joint.
    if (segments.length === 1) length *= 2;
    const joint = segments[0].size / length;
    const hoofed = !arm && limb?.end === "hoof";
    const family = arm || !limb || hoofed ? "fleshy" : limb.style === "insect" ? "arthropod" : limb.style === "bird" ? "bird" : "fleshy";
    const fade = skin.limbFade && skin.socks ? skin.socks : 0;
    const base = new Color(skin.base);
    const delta = new Vector3(),
      shade = base.clone().multiplyScalar(0.26),
      white = new Color("#ffffff"),
      dark = new Color();
    const bell = (x, wide) => Math.exp(-((x / wide) ** 2));
    function tint(color, p) {
      let at = 0,
        grey = 0,
        inner = 0,
        closest = Infinity;
      for (const s of segments) {
        delta.subVectors(p, s.a);
        const t = MathUtils.clamp(delta.dot(s.dir), 0, s.size);
        const distance = delta.addScaledVector(s.dir, -t).lengthSq();
        if (distance < closest) {
          closest = distance;
          at = (s.offset + t) / length;
          inner = distance > 1e-10 ? (delta.x * inward) / Math.sqrt(distance) : 0;
        }
      }
      const crease = bell(at - joint, 0.03), far = MathUtils.smoothstep(at, joint - 0.05, joint + 0.07);
      if (family === "arthropod") {
        // The far segment is darker, the membrane of the joint pale, the tip nearly black.
        color.lerp(dark.copy(color).multiplyScalar(0.62), 0.75 * far);
        color.lerp(dark.copy(color).lerp(white, 0.5), 0.6 * bell(at - joint, 0.022));
        color.multiplyScalar(1 - 0.62 * MathUtils.smoothstep(at, 0.86, 0.98));
      } else if (family === "bird") {
        // Bare horn: darker and greyer than the feathered or furred thigh.
        grey = 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
        color.lerp(dark.setScalar(grey), 0.3 * far).multiplyScalar(1 - 0.36 * far);
        color.multiplyScalar(1 - 0.14 * bell(at - joint, 0.02));
      } else {
        color.lerp(dark.copy(color).lerp(white, 0.4), 0.55 * (skin.belly ?? 0.6) * MathUtils.smoothstep(inner, 0.15, 0.9) * (1 - 0.6 * MathUtils.smoothstep(at, 0.6, 1)));
        color.multiplyScalar(1 - 0.24 * crease);
        if (!skin.socks) color.lerp(dark.copy(color).multiplyScalar(0.5), (hoofed ? 0.62 : 0.36) * MathUtils.smoothstep(at, hoofed ? 0.56 : 0.5, 0.96));
      }
      // Keep the body's native palette above the joint, arrive at the lower
      // limb's darker colour before the foot, and keep the bottom readable.
      if (fade) color.lerp(shade, fade * 0.83 * MathUtils.smoothstep(at, 0.34, 0.97));
    }
    for (const part of form.parts) {
      if (
        part.id.startsWith(prefix + " ") &&
        !part.paint &&
        (["upper arm", "forearm", "hand", "thigh", "shin", "foot"].includes(
          part.motionRole,
        ) ||
          part.id === prefix + " toes")
      )
        result.set(part.id, tint);
    }
  }
  return result;
}
export function paintLimbPigment(mesh, tint) {
  if (!tint) return;
  mesh.updateWorldMatrix(true, false);
  const geometry = mesh.geometry,
    pos = geometry.attributes.position;
  const mat = mesh.material.clone(),
    old = mat.vertexColors && geometry.attributes.color;
  const p = new Vector3(),
    c = new Color(),
    prior = new Color(),
    rgb = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    c.copy(mat.color);
    if (old) c.multiply(prior.fromBufferAttribute(old, i));
    tint(c, p);
    c.toArray(rgb, i * 3);
  }
  geometry.setAttribute("color", new Float32BufferAttribute(rgb, 3));
  mat.color.set(0xffffff);
  mat.vertexColors = true;
  mesh.material = mat;
}
