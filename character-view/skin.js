import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { alignGroundContacts } from "./ground-contact.js";
import { buildClips } from "./motion.js";

function inferRole(p) {
  if (p.motionRole) return p.motionRole;
  const id = p.id.toLowerCase();
  if (/wing/.test(id) && !/(rib|spar|plate|fin)/.test(id)) return "wing";
  if (p.outfitRole) return p.outfitRole;
  if (/skirt fold|velvet dress/.test(id)) return "skirt";
  if (p.shape === "head" || p.anatomy === "face") return "head";
  if (p.shape === "torso" || id === "spine" || id === "torso") return "torso";
  if (
    p.shape.endsWith(" leg") ||
    /^(left|right)[- ](foreleg|hindleg|leg)$/.test(id) ||
    /walking leg|load bearing leg/.test(id)
  )
    return "thigh";
  if (p.shape.endsWith(" arm") || /bent arm|power arm/.test(id))
    return "upper arm";
  if (/tail/.test(id)) return "tail";
  if (/foot|feet/.test(id)) return "foot";
  return "rigid";
}
const activeRoles = new Set([
  "upper arm",
  "forearm",
  "thigh",
  "shin",
  "tail",
  "wing",
]);
function centroidAt(meshes, axis, tolerance, value, fallback) {
  const result = new T.Vector3(),
    tmp = new T.Vector3();
  let n = 0;
  for (const m of meshes) {
    const pos = m.geometry.attributes.position,
      step = Math.max(1, Math.floor(pos.count / 1400));
    for (let i = 0; i < pos.count; i += step) {
      tmp.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      if (Math.abs(tmp[axis] - value) <= tolerance) {
        result.add(tmp);
        n++;
      }
    }
  }
  return n ? result.multiplyScalar(1 / n) : fallback;
}
function collect(form, model) {
  const segments = new Map(),
    parts = new Map(form.parts.map((p) => [p.id, p]));
  model.updateWorldMatrix(true, true);
  function visit(object, owner) {
    if (!object.visible) return;
    if (object.userData.partId) {
      const p = parts.get(object.userData.partId);
      owner = {
        part: p,
        role: inferRole(p),
        object,
        meshes: [],
        bounds: new T.Box3().makeEmpty(),
      };
      segments.set(p.id, owner);
    }
    if (owner && object.isMesh) {
      owner.meshes.push(object);
      if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
      owner.bounds.union(
        object.geometry.boundingBox.clone().applyMatrix4(object.matrixWorld),
      );
    }
    for (const child of object.children) visit(child, owner);
  }
  for (const c of model.children) visit(c, null);
  return segments;
}
function centres(s) {
  const { object, part, role, bounds, meshes } = s,
    origin = object.getWorldPosition(new T.Vector3());
  const extent = bounds.getSize(new T.Vector3()),
    c = bounds.getCenter(new T.Vector3());
  if (role === "skirt" && !bounds.isEmpty())
    return [
      bounds.max.y,
      (bounds.min.y + bounds.max.y) * 0.5,
      bounds.min.y,
    ].map((y) => new T.Vector3(c.x, y, c.z));
  if (!activeRoles.has(role))
    return [
      role === "torso"
        ? new T.Vector3(c.x, bounds.min.y + extent.y * 0.18, c.z)
        : origin,
    ];
  if (bounds.isEmpty()) return [origin];
  const rows = part.knots?.map((p) =>
    object.localToWorld(new T.Vector3(...p.slice(0, 3))),
  );
  if (role === "tail" || role === "wing") {
    if (rows)
      return [rows[0], rows[Math.floor((rows.length - 1) * 0.5)], rows.at(-1)];
    return [origin, c, new T.Vector3(bounds.max.x, c.y, bounds.min.z)];
  }
  const at = (p) => {
    const y = T.MathUtils.lerp(bounds.max.y, bounds.min.y, p);
    return centroidAt(
      meshes,
      "y",
      Math.max(0.002, extent.y * 0.075),
      y,
      new T.Vector3(c.x, y, c.z),
    );
  };
  if (rows && rows.length > 1) {
    const ordered = rows[0].y >= rows.at(-1).y ? rows : rows.slice().reverse();
    const high = ordered[0],
      end = ordered.at(-1);
    const mid = at(0.49);
    return [high, mid, end];
  }
  const high =
    part.shape.endsWith(" leg") || part.shape.endsWith(" arm")
      ? origin
      : at(0.08);
  return [high, at(0.52), at(role === "thigh" ? 0.9 : 0.92)];
}
function weights(point, points) {
  if (points.length === 1) return [0, 0, 1, 0];
  // Find the closest point on the joint polyline, then blend on either side
  // of each bend. This also works for a spine lying along the ground plane.
  let where = 0,
    best = Infinity;
  for (let j = 0; j < points.length - 1; j++) {
    const a = points[j],
      b = points[j + 1],
      dx = b.x - a.x,
      dy = b.y - a.y,
      dz = b.z - a.z;
    const f = T.MathUtils.clamp(
      ((point.x - a.x) * dx + (point.y - a.y) * dy + (point.z - a.z) * dz) /
        (dx * dx + dy * dy + dz * dz || 1),
      0,
      1,
    );
    const dist =
      (point.x - a.x - f * dx) ** 2 +
      (point.y - a.y - f * dy) ** 2 +
      (point.z - a.z - f * dz) ** 2;
    if (dist < best) {
      best = dist;
      where = j + f;
    }
  }
  if (where < 0.76) return [0, 0, 1, 0];
  if (where < 1.24) {
    const t = T.MathUtils.smoothstep(where, 0.76, 1.24);
    return [0, 1, 1 - t, t];
  }
  if (where < 1.81) return [1, 1, 1, 0];
  const t = T.MathUtils.smoothstep(where, 1.81, 2);
  return [1, 2, 1 - t, t];
}
export function skinCharacter(form, model) {
  const regions = collect(form, model),
    actor = new T.Group();
  actor.name = "Character";
  const root = new T.Bone();
  root.name = "Root";
  actor.add(root);
  const bones = [root],
    index = new Map([[root, 0]]);
  for (const s of regions.values()) {
    s.points = centres(s);
    if (
      s.points.length > 1 &&
      (s.points[0].distanceTo(s.points[1]) < 0.003 ||
        s.points[1].distanceTo(s.points[2]) < 0.003)
    )
      s.points = [s.points[0]];
    s.bones = s.points.map((p, i) => {
      const bone = new T.Bone();
      bone.name =
        "J" +
        bones.length +
        "_" +
        s.part.id.replace(/[^a-zA-Z0-9_-]/g, "_") +
        (i ? "_" + i : "");
      bone.userData.region = s.part.id;
      index.set(bone, bones.length);
      bones.push(bone);
      return bone;
    });
  }
  for (const s of regions.values()) {
    const parent = regions.get(s.part.parent);
    let attachment = root,
      anchor = new T.Vector3();
    if (parent) {
      let nearest = 0;
      for (let i = 1; i < parent.points.length; i++)
        if (
          parent.points[i].distanceToSquared(s.points[0]) <
          parent.points[nearest].distanceToSquared(s.points[0])
        )
          nearest = i;
      attachment = parent.bones[nearest];
      anchor = parent.points[nearest];
    }
    for (let i = 0; i < s.bones.length; i++) {
      attachment.add(s.bones[i]);
      s.bones[i].position.copy(s.points[i]).sub(anchor);
      attachment = s.bones[i];
      anchor = s.points[i];
    }
  }
  actor.updateMatrixWorld(true);
  const skeleton = new T.Skeleton(bones),
    point = new T.Vector3();
  const byMaterial = new Map();
  for (const s of regions.values())
    for (const source of s.meshes) {
      const geometry = source.geometry.clone().applyMatrix4(source.matrixWorld),
        pos = geometry.attributes.position;
      const ids = new Uint16Array(pos.count * 4),
        blend = new Float32Array(pos.count * 4);
      for (let i = 0; i < pos.count; i++) {
        point.fromBufferAttribute(pos, i);
        const [a, b, f, g] = weights(point, s.points);
        ids[i * 4] = f > 0 ? index.get(s.bones[a]) : 0;
        ids[i * 4 + 1] = g > 0 ? index.get(s.bones[b]) : 0;
        blend[i * 4] = f;
        blend[i * 4 + 1] = g;
      }
      geometry.setAttribute("skinIndex", new T.BufferAttribute(ids, 4));
      geometry.setAttribute("skinWeight", new T.BufferAttribute(blend, 4));
      if (!geometry.index)
        geometry.setIndex(Array.from({ length: pos.count }, (_, i) => i));
      if (!byMaterial.has(source.material)) byMaterial.set(source.material, []);
      byMaterial.get(source.material).push(geometry);
    }
  const materials = [...byMaterial.keys()],
    geometries = [...byMaterial.values()].flat();
  if (geometries.length) {
    const combined = mergeGeometries(geometries);
    let start = 0;
    for (const [mi, mat] of materials.entries()) {
      const count = byMaterial.get(mat).reduce((n, g) => n + g.index.count, 0);
      combined.addGroup(start, count, mi);
      start += count;
    }
    for (const g of geometries) g.dispose();
    const mesh = new T.SkinnedMesh(combined, materials);
    mesh.name = "Character surface";
    mesh.bind(skeleton, new T.Matrix4());
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    actor.add(mesh);
  }
  const clips = buildClips(root, regions);
  const skinned = actor.children.find((o) => o.isSkinnedMesh);
  if (
    skinned &&
    [...regions.values()].some((r) =>
      ["thigh", "foot", "skirt"].includes(r.role),
    )
  )
    alignGroundContacts(actor, skinned, root, clips);
  return {
    actor,
    clips,
    skeleton,
    regions,
    dispose() {
      for (const o of actor.children) if (o.isMesh) o.geometry.dispose();
      skeleton.dispose();
    },
  };
}
