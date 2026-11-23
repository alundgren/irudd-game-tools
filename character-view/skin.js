import { bindMantleArms } from "./mantle-rig.js";
import { whiteVertexColors } from "./markings.js";
import { bindFingers, weightFingers } from "./finger-rig.js";
import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { prepareExpressions, worldMorphs } from "./expressions.js";
import { alignGroundContacts } from "./ground-contact.js";
import { buildClips } from "./motion.js";

export function inferRole(p) {
  if (p.motionRole === "axial spine" && !p.knots?.length) return "rigid";
  if (p.motionRole) return p.motionRole;
  const id = p.id.toLowerCase();
  if (
    /wing/.test(id) &&
    (!/(rib|spar|plate|fin)/.test(id) || /leading.spar/.test(id))
  )
    return "wing";
  if (p.outfitRole) return p.outfitRole;
  if (/skirt fold|velvet dress/.test(id)) return "skirt";
  if (
    p.shape === "head" ||
    p.anatomy === "face" ||
    /(?:^|[- ])head(?:$|[- ])/.test(id)
  )
    return "head";
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
export function movementRoles(parts) {
  const roles = new Map(parts.map((p) => [p.id, inferRole(p)]));
  for (const part of parts) {
    if (
      !part.motionRole &&
      roles.get(part.id) === "rigid" &&
      roles.get(part.parent) === "hand" &&
      /finger|thumb|claw|talon|digit/i.test(part.id)
    )
      roles.set(part.id, "hand");
  }
  for (const base of parts) {
    if (base.motionRole || !["upper arm", "rigid"].includes(roles.get(base.id)))
      continue;
    const wingParts = parts.filter(
      (p) => p.parent === base.id && /wing/i.test(p.id),
    );
    if (wingParts.length < 2 || !wingParts.some((p) => /spar|rib/i.test(p.id)))
      continue;
    roles.set(base.id, "wing");
    for (const child of wingParts)
      if (!child.motionRole) roles.set(child.id, "rigid");
  }
  return roles;
}
const activeRoles = new Set([
  "upper arm",
  "forearm",
  "thigh",
  "shin",
  "tail",
  "wing",
  "fin",
  "axial spine",
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
  const roles = movementRoles(form.parts);
  const segments = new Map(),
    parts = new Map(form.parts.map((p) => [p.id, p]));
  model.updateWorldMatrix(true, true);
  function visit(object, owner) {
    if (!object.visible) return;
    if (object.userData.partId) {
      const p = parts.get(object.userData.partId);
      owner = {
        part: p,
        role: roles.get(p.id),
        object,
        meshes: [],
        bounds: new T.Box3().makeEmpty(),
      };
      segments.set(p.id, owner);
    }
    if (owner && object.isMesh && object.geometry.attributes.position.count) {
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
function centres(s, regions) {
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
  if ((role === "axial spine" || role === "tail") && rows?.length > 1) {
    const curve = new T.CatmullRomCurve3(rows);
    return curve.getSpacedPoints(T.MathUtils.clamp(rows.length, 4, 9) - 1);
  }
  if (role === "wing" || role === "fin") {
    const parent = regions.get(part.parent),
      body =
        parent && !parent.bounds.isEmpty()
          ? parent.bounds.getCenter(new T.Vector3())
          : new T.Vector3();
    if (rows?.length > 1) {
      const ordered =
        rows[0].distanceToSquared(body) <= rows.at(-1).distanceToSquared(body)
          ? rows
          : [...rows].reverse();
      return new T.CatmullRomCurve3(ordered).getSpacedPoints(3);
    }
    const axis = extent.x >= extent.z ? "x" : "z",
      sign = c[axis] >= body[axis] ? 1 : -1;
    const start = sign > 0 ? bounds.min[axis] : bounds.max[axis],
      end = sign > 0 ? bounds.max[axis] : bounds.min[axis];
    return [0.055, 0.34, 0.65, 0.95].map((t) => {
      const v = T.MathUtils.lerp(start, end, t),
        fallback = c.clone();
      fallback[axis] = v;
      return centroidAt(
        meshes,
        axis,
        Math.max(0.002, extent[axis] * 0.085),
        v,
        fallback,
      );
    });
  }
  if (role === "tail") {
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
  if (points.length > 3) {
    const a = Math.min(points.length - 2, Math.floor(where)),
      t = where - a;
    return [a, a + 1, 1 - t, t];
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
  prepareExpressions(model);
  const regions = collect(form, model),
    actor = new T.Group();
  actor.name = "Character";
  const root = new T.Bone();
  root.name = "Root";
  actor.add(root);
  const bones = [root],
    index = new Map([[root, 0]]);
  for (const s of regions.values()) {
    s.points = centres(s, regions);
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
  for (const s of regions.values()) s.fingers = bindFingers(s, bones, index);
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
        const owners = source.blendOwners;
        const primary = owners ? regions.get(owners.ids[owners.first[i]]) : s;
        const secondary = owners
          ? regions.get(owners.ids[owners.second[i]])
          : null;
        const mix = secondary ? owners.weight[i] : 1;
        const [a, b, f, g] = weights(point, primary.points);
        ids[i * 4] = f > 0 ? index.get(primary.bones[a]) : 0;
        ids[i * 4 + 1] = g > 0 ? index.get(primary.bones[b]) : 0;
        blend[i * 4] = f * mix;
        blend[i * 4 + 1] = g * mix;
        if (secondary && mix < 1) {
          const [c, d, h, j] = weights(point, secondary.points);
          ids[i * 4 + 2] = h > 0 ? index.get(secondary.bones[c]) : 0;
          ids[i * 4 + 3] = j > 0 ? index.get(secondary.bones[d]) : 0;
          blend[i * 4 + 2] = h * (1 - mix);
          blend[i * 4 + 3] = j * (1 - mix);
        }
      }
      if (source === s.object)
        bindMantleArms(s, regions, geometry, ids, blend, index, weights);
      if (s.fingers.has(source))
        weightFingers(s.fingers.get(source), ids, blend, index, s.bones[0]);
      geometry.setAttribute("skinIndex", new T.BufferAttribute(ids, 4));
      geometry.setAttribute("skinWeight", new T.BufferAttribute(blend, 4));
      if (!geometry.index)
        geometry.setIndex(Array.from({ length: pos.count }, (_, i) => i));
      if (
        geometry.morphAttributes.position?.length ||
        source.userData.eyePiece
      ) {
        if (geometry.morphAttributes.position?.length)
          worldMorphs(geometry, source);
        const face = new T.SkinnedMesh(geometry, source.material);
        face.name =
          (source.userData.eyePiece
            ? source.userData.eyePiece + "_"
            : "Face_") +
          s.part.id.replace(/[^a-zA-Z0-9_-]/g, "_") +
          "_" +
          actor.children.length;
        if (source.userData.eyePiece)
          face.userData.eyePiece = source.userData.eyePiece;
        else {
          face.userData.faceSurface = true;
          if (source.userData.fittedEyes) face.userData.fittedEyes = true;
        }
        face.bind(skeleton, new T.Matrix4());
        face.frustumCulled = false;
        face.castShadow = true;
        actor.add(face);
        continue;
      }
      if (!byMaterial.has(source.material)) byMaterial.set(source.material, []);
      byMaterial.get(source.material).push(geometry);
    }
  const materials = [...byMaterial.keys()],
    geometries = [...byMaterial.values()].flat();
  if (geometries.length) {
    if (geometries.some((g) => g.attributes.color))
      for (const g of geometries) whiteVertexColors(g);
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
  const idle = clips.find((c) => c.name === "Idle");
  if (idle)
    for (const mesh of actor.children) {
      if (mesh.morphTargetDictionary?.Blink === undefined) continue;
      const d = idle.duration;
      idle.tracks.push(
        new T.NumberKeyframeTrack(
          mesh.name + ".morphTargetInfluences[Blink]",
          [0, 0.59 * d, 0.64 * d, 0.69 * d, d],
          [0, 0, 1, 0, 0],
        ),
      );
    }
  const skinned =
    actor.children.find(
      (o) => o.isSkinnedMesh && !o.userData.faceSurface && !o.userData.eyePiece,
    ) ?? actor.children.find((o) => o.isSkinnedMesh);
  if (skinned) {
    const supported = [...regions.values()].some((r) =>
      ["thigh", "foot", "skirt", "axial spine"].includes(r.role),
    );
    alignGroundContacts(
      actor,
      skinned,
      root,
      supported ? clips : clips.filter((c) => ["Fly", "Swim"].includes(c.name)),
    );
  }
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
