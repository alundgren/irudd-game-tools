import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { BuiltCharacter } from "../build.js";
import type { BuildPart } from "../view.js";
import { alignGroundContacts } from "./ground.js";
import { buildClips } from "./motion.js";
import { authoredClips, bindPoseJoints, offerClip } from "./poses.js";
import type { Region, RigRole } from "./region.js";
import { isMesh } from "../mesh.js";
import { bindFingers, weightFingers } from "./fingers.js";
import { prepareExpressions, worldMorphs } from "./expressions.js";
import { humanBinding, humanCentres } from "../human/rig.js";
import { applyHumanPosture } from "../human/stance.js";
import { addDrapeJoints, animateDrapes } from "../human/drape.js";
import { bindMantleArms } from "./mantle.js";
import { addSkirtCage, animateSkirts, weightSkirt, type SkirtCage } from "./skirt.js";

export type { Region, RigRole } from "./region.js";

export interface Rig {
  readonly actor: T.Group;
  readonly skeleton: T.Skeleton;
  readonly bindings: ReturnType<typeof bindPoseJoints>;
  readonly clips: T.AnimationClip[];
  readonly regions: ReadonlyMap<string, Region>;
  dispose(): void;
}

const activeRoles = new Set<RigRole>([
  "upper arm",
  "forearm",
  "thigh",
  "shin",
  "tail",
  "wing",
  "fin",
  "axial spine",
]);

type Axis = "x" | "y" | "z";

function centroidAt(
  meshes: ReadonlyArray<T.Mesh>,
  axis: Axis,
  tolerance: number,
  value: number,
  fallback: T.Vector3,
): T.Vector3 {
  const result = new T.Vector3();
  const tmp = new T.Vector3();
  let n = 0;
  for (const m of meshes) {
    const pos = m.geometry.getAttribute("position");
    const step = Math.max(1, Math.floor(pos.count / 1400));
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

export function regionRole(part: BuildPart): RigRole {
  if (part.motion === "axial spine" && !part.sweep?.knots.length) return "rigid";
  return part.motion ?? part.wear.role ?? "rigid";
}

function collect(character: BuiltCharacter): Map<string, Region> {
  const segments = new Map<string, Region>();
  const parts = new Map<T.Object3D, BuildPart>();
  for (const { part, object } of character.parts.values()) parts.set(object, part);
  character.group.updateWorldMatrix(true, true);
  function visit(object: T.Object3D, owner: Region | null): void {
    if (!object.visible) return;
    const part = parts.get(object);
    let current = owner;
    if (part) {
      current = {
        part,
        role: regionRole(part),
        object,
        meshes: [],
        bounds: new T.Box3().makeEmpty(),
        points: [],
        bones: [],
        fingers: new Map(),
      };
      segments.set(part.id, current);
    }
    if (current && isMesh(object)) {
      const geometry: T.BufferGeometry = object.geometry;
      if (geometry.getAttribute("position").count) {
        current.meshes.push(object);
        if (!geometry.boundingBox) geometry.computeBoundingBox();
        const box = geometry.boundingBox;
        if (box) current.bounds.union(box.clone().applyMatrix4(object.matrixWorld));
      }
    }
    for (const child of object.children) visit(child, current);
  }
  for (const c of character.group.children) visit(c, null);
  return segments;
}

const knotRows = (s: Region): T.Vector3[] | undefined =>
  s.part.sweep?.knots.map((k) => s.object.localToWorld(new T.Vector3(k[0], k[1], k[2])));

function centres(s: Region, regions: ReadonlyMap<string, Region>): T.Vector3[] {
  const { object, part, role, bounds, meshes } = s;
  const origin = object.getWorldPosition(new T.Vector3());
  const extent = bounds.getSize(new T.Vector3());
  const c = bounds.getCenter(new T.Vector3());
  if (role === "skirt" && !bounds.isEmpty())
    return [bounds.max.y, (bounds.min.y + bounds.max.y) * 0.5, bounds.min.y].map(
      (y) => new T.Vector3(c.x, y, c.z),
    );
  if (!activeRoles.has(role))
    return [role === "torso" ? new T.Vector3(c.x, bounds.min.y + extent.y * 0.18, c.z) : origin];
  if (bounds.isEmpty()) return [origin];
  const rows = knotRows(s);
  const children = [...regions.values()];
  const figure = part.seam === "figure";
  const distalRole =
    role === "upper arm"
      ? "forearm"
      : role === "forearm"
        ? "hand"
        : figure && role === "thigh"
          ? "shin"
          : figure && role === "shin"
            ? "foot"
            : null;
  if (distalRole) {
    const distal = children.find(
      (child) => child.part.parent === part.id && child.role === distalRole,
    );
    if (distal) {
      const tip = distal.object.getWorldPosition(new T.Vector3());
      return [origin, origin.clone().lerp(tip, 0.5), tip];
    }
  }
  const first = rows?.[0];
  const last = rows?.at(-1);
  if ((role === "thigh" || role === "shin") && rows && first && last && rows.length > 1) {
    if (first.y < last.y) {
      const next = role === "thigh" ? "shin" : "foot";
      const distal = children.find((child) => child.part.parent === part.id && child.role === next);
      const joint = distal?.object.getWorldPosition(new T.Vector3());
      if (joint && joint.distanceToSquared(last) < joint.distanceToSquared(first))
        return [first, new T.CatmullRomCurve3(rows).getPointAt(0.5), last];
    }
  }
  if ((role === "axial spine" || role === "tail") && rows && rows.length > 1) {
    const curve = new T.CatmullRomCurve3(rows);
    return curve.getSpacedPoints(T.MathUtils.clamp(rows.length, 4, 9) - 1);
  }
  if (role === "wing" || role === "fin") {
    const parent = part.parent === null ? undefined : regions.get(part.parent);
    const body =
      parent && !parent.bounds.isEmpty()
        ? parent.bounds.getCenter(new T.Vector3())
        : new T.Vector3();
    if (rows && first && last && rows.length > 1) {
      const ordered =
        first.distanceToSquared(body) <= last.distanceToSquared(body) ? rows : [...rows].reverse();
      return new T.CatmullRomCurve3(ordered).getSpacedPoints(3);
    }
    const axis: Axis = extent.x >= extent.z ? "x" : "z";
    const sign = c[axis] >= body[axis] ? 1 : -1;
    const start = sign > 0 ? bounds.min[axis] : bounds.max[axis];
    const end = sign > 0 ? bounds.max[axis] : bounds.min[axis];
    return [0.055, 0.34, 0.65, 0.95].map((t) => {
      const v = T.MathUtils.lerp(start, end, t);
      const fallback = c.clone();
      fallback[axis] = v;
      return centroidAt(meshes, axis, Math.max(0.002, extent[axis] * 0.085), v, fallback);
    });
  }
  if (role === "tail") {
    const middle = rows?.[Math.floor((rows.length - 1) * 0.5)];
    if (first && middle && last) return [first, middle, last];
    return [origin, c, new T.Vector3(bounds.max.x, c.y, bounds.min.z)];
  }
  const at = (p: number): T.Vector3 => {
    const y = T.MathUtils.lerp(bounds.max.y, bounds.min.y, p);
    return centroidAt(
      meshes,
      "y",
      Math.max(0.002, extent.y * 0.075),
      y,
      new T.Vector3(c.x, y, c.z),
    );
  };
  if (rows && first && last && rows.length > 1) {
    const ordered = first.y >= last.y ? rows : rows.slice().reverse();
    const high = ordered[0] ?? first;
    const end = ordered.at(-1) ?? last;
    const mid = at(0.49);
    return [high, mid, end];
  }
  const limb = part.piece?.piece.endsWith(" leg") || part.piece?.piece.endsWith(" arm");
  return [limb ? origin : at(0.08), at(0.52), at(role === "thigh" ? 0.9 : 0.92)];
}

export function weights(
  point: T.Vector3,
  points: ReadonlyArray<T.Vector3>,
): readonly [number, number, number, number] {
  if (points.length === 1) return [0, 0, 1, 0];
  let where = 0;
  let best = Infinity;
  for (let j = 0; j < points.length - 1; j++) {
    const a = points[j];
    const b = points[j + 1];
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const f = T.MathUtils.clamp(
      ((point.x - a.x) * dx + (point.y - a.y) * dy + (point.z - a.z) * dz) /
        (dx * dx + dy * dy + dz * dz || 1),
      0,
      1,
    );
    const dist =
      (point.x - a.x - f * dx) ** 2 + (point.y - a.y - f * dy) ** 2 + (point.z - a.z - f * dz) ** 2;
    if (dist < best) {
      best = dist;
      where = j + f;
    }
  }
  if (points.length > 3) {
    const a = Math.min(points.length - 2, Math.floor(where));
    const t = where - a;
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

type HipBinding = (
  point: T.Vector3,
  ids: Uint16Array,
  weights: Float32Array,
  at: number,
) => boolean;

function hipBindings(
  regions: ReadonlyMap<string, Region>,
  index: ReadonlyMap<T.Bone, number>,
): Map<string, HipBinding> {
  const bindings = new Map<string, HipBinding>();
  for (const torso of regions.values()) {
    if (torso.role !== "torso" || torso.part.seam !== "figure") continue;
    const legs = [...regions.values()].filter(
      (r) => r.role === "thigh" && r.part.seam === "figure" && r.part.parent === torso.part.id,
    );
    const [left, right] = legs;
    if (legs.length !== 2 || !left || !right) continue;
    const inverse = torso.object.matrixWorld.clone().invert();
    const hips = legs.map((r) => (r.points[0] ?? new T.Vector3()).clone().applyMatrix4(inverse));
    const [h0 = new T.Vector3(), h1 = new T.Vector3()] = hips;
    const axis = h1.clone().sub(h0);
    const span = axis.length() / 2;
    if (span < 0.005) continue;
    axis.normalize();
    const centre = h0.clone().lerp(h1, 0.5);
    const local = new T.Vector3();
    const bones = [torso, left, right].map((r) => {
      const bone = r.bones[0];
      return (bone && index.get(bone)) ?? 0;
    });
    const bind: HipBinding = (point, ids, weights, at) => {
      local.copy(point).applyMatrix4(inverse).sub(centre);
      const height = local.y / span;
      if (height <= -1.5 || height >= 0.9) return false;
      const across = local.dot(axis) / span;
      const leg = 1 - T.MathUtils.smoothstep(height, -1.5, 0.9);
      const centreWidth = 0.52 * T.MathUtils.smoothstep(height, -1.5, -0.65) + 0.008;
      const side = T.MathUtils.smoothstep(across, -centreWidth, centreWidth);
      const w = [1 - leg, leg * (1 - side), leg * side];
      w.forEach((value, i) => {
        weights[at + i] = value;
        ids[at + i] = value > 0 ? (bones[i] ?? 0) : 0;
      });
      return true;
    };
    for (const r of [torso, left, right]) bindings.set(r.part.id, bind);
    for (const r of regions.values())
      if (
        r.part.seam === "bottom" &&
        r.part.parent !== null &&
        bindings.get(r.part.parent) === bind
      )
        bindings.set(r.part.id, bind);
  }
  return bindings;
}

function whiteVertexColors(geometry: T.BufferGeometry): void {
  if (!geometry.getAttribute("color"))
    geometry.setAttribute(
      "color",
      new T.Float32BufferAttribute(
        new Float32Array(geometry.getAttribute("position").count * 3).fill(1),
        3,
      ),
    );
}

const boneSafe = (label: string): string => label.replace(/[^a-zA-Z0-9_-]/g, "_");

export function skinCharacter(character: BuiltCharacter, standingOnly = false): Rig {
  prepareExpressions(character.faces);
  const regions = collect(character);
  const actor = new T.Group();
  actor.name = "Character";
  const root = new T.Bone();
  root.name = "Root";
  actor.add(root);
  const bones: T.Bone[] = [root];
  const index = new Map<T.Bone, number>([[root, 0]]);
  const boneIndex = (bone: T.Bone | undefined): number => (bone && index.get(bone)) ?? 0;
  const human = character.regionRig ?? character.human;
  for (const s of regions.values()) {
    s.points = (human && humanCentres(s, regions, human)) ?? centres(s, regions);
    const [p0, p1, p2] = s.points;
    if (
      p0 &&
      p1 &&
      s.points.length > 1 &&
      (p0.distanceTo(p1) < 0.003 || (p2 !== undefined && p1.distanceTo(p2) < 0.003))
    )
      s.points = [p0];
    s.bones = s.points.map((_, i) => {
      const bone = new T.Bone();
      bone.name = "J" + bones.length + "_" + boneSafe(s.part.label) + (i ? "_" + i : "");
      bone.userData["region"] = s.part.id;
      bone.userData["station"] = i;
      index.set(bone, bones.length);
      bones.push(bone);
      return bone;
    });
  }
  for (const s of regions.values()) {
    const parent = s.part.parent === null ? undefined : regions.get(s.part.parent);
    let attachment: T.Bone = root;
    let anchor = new T.Vector3();
    const start = s.points[0];
    if (parent && start) {
      let nearest = 0;
      parent.points.forEach((p, i) => {
        const best = parent.points[nearest];
        if (best && p.distanceToSquared(start) < best.distanceToSquared(start)) nearest = i;
      });
      attachment = parent.bones[nearest] ?? root;
      anchor = parent.points[nearest] ?? anchor;
    }
    s.bones.forEach((bone, i) => {
      const point = s.points[i] ?? anchor;
      attachment.add(bone);
      bone.position.copy(point).sub(anchor);
      attachment = bone;
      anchor = point;
    });
  }
  const skirtCages = new Map<Region, SkirtCage>();
  for (const s of regions.values()) {
    s.fingers = bindFingers(s, (mesh) => character.hands.get(mesh), bones, index);
    const cage = addSkirtCage(s, bones, index);
    if (cage) skirtCages.set(s, cage);
  }
  const drapes =
    human &&
    addDrapeJoints(regions, bones, index, human, (mesh) => human.weights(mesh)?.clothJoints);
  actor.updateMatrixWorld(true);
  const skeleton = new T.Skeleton(bones);
  const point = new T.Vector3();
  const regionNames = [...character.parts.values()].map((p) => p.part.label);
  const regionIndices = new Map([...character.parts.keys()].map((id, i) => [id, i]));
  const hips = hipBindings(regions, index);
  const byMaterial = new Map<T.Material, T.BufferGeometry[]>();
  for (const s of regions.values())
    for (const source of s.meshes) {
      const geometry = source.geometry.clone().applyMatrix4(source.matrixWorld);
      const pos = geometry.getAttribute("position");
      const ids = new Uint16Array(pos.count * 4);
      const blend = new Float32Array(pos.count * 4);
      const owners = character.blendOwners.get(source);
      const bindHip = owners && hips.get(s.part.id);
      const arm = s.part.wing && s.part.parent !== null ? regions.get(s.part.parent) : undefined;
      const carried = arm?.role === "wing" && arm.points.length > 1 ? arm : s;
      const authored = human?.weights(source);
      const authoredBones =
        human && authored && humanBinding(s, regions, index, authored.names, human);
      for (let i = 0; authored && authoredBones && i < pos.count * 4; i++) {
        ids[i] = authoredBones[authored.boneIndices[i] ?? 0] ?? 0;
        blend[i] = authored.weights[i] ?? 0;
      }
      const hung = authored?.clothJoints && drapes?.weigh(authored.clothJoints);
      for (let i = 0; hung && i < pos.count; i++)
        hung(point.fromBufferAttribute(pos, i), ids, blend, i * 4);
      for (let i = 0; !authored && i < pos.count; i++) {
        point.fromBufferAttribute(pos, i);
        if (bindHip && bindHip(point, ids, blend, i * 4)) continue;
        const firstId = owners?.ids[owners.first[i] ?? 0];
        const secondId = owners?.ids[owners.second[i] ?? 0];
        const primary = owners
          ? ((firstId === undefined ? undefined : regions.get(firstId)) ?? s)
          : carried;
        const secondary = secondId === undefined ? undefined : regions.get(secondId);
        const mix = owners && secondary ? (owners.weight[i] ?? 1) : 1;
        const [a, b, f, g] = weights(point, primary.points);
        ids[i * 4] = f * mix > 0 ? boneIndex(primary.bones[a]) : 0;
        ids[i * 4 + 1] = g * mix > 0 ? boneIndex(primary.bones[b]) : 0;
        blend[i * 4] = f * mix;
        blend[i * 4 + 1] = g * mix;
        if (secondary && mix < 1) {
          const [c, d, h, j] = weights(point, secondary.points);
          ids[i * 4 + 2] = h > 0 ? boneIndex(secondary.bones[c]) : 0;
          ids[i * 4 + 3] = j > 0 ? boneIndex(secondary.bones[d]) : 0;
          blend[i * 4 + 2] = h * (1 - mix);
          blend[i * 4 + 3] = j * (1 - mix);
        }
      }
      if (source === s.object) bindMantleArms(s, regions, geometry, ids, blend, index, weights);
      const cage = source === s.object ? skirtCages.get(s) : undefined;
      if (cage) weightSkirt(cage, geometry, ids, blend, index);
      const fingers = s.fingers.get(source);
      if (fingers) weightFingers(fingers, ids, blend, index, s.bones[0]);
      geometry.setAttribute(
        "_region",
        new T.Uint8BufferAttribute(
          new Uint8Array(pos.count).fill(regionIndices.get(s.part.id) ?? 0),
          1,
        ),
      );
      geometry.setAttribute("skinIndex", new T.BufferAttribute(ids, 4));
      geometry.setAttribute("skinWeight", new T.BufferAttribute(blend, 4));
      if (!geometry.index) geometry.setIndex(Array.from({ length: pos.count }, (_, i) => i));
      const material: T.Material | T.Material[] = source.material;
      if (Array.isArray(material)) throw new Error("A part mesh carries one material.");
      const eyePiece: unknown = source.userData["eyePiece"];
      if (geometry.morphAttributes["position"]?.length || typeof eyePiece === "string") {
        worldMorphs(geometry, source);
        const face = new T.SkinnedMesh(geometry, material);
        face.name =
          (typeof eyePiece === "string" ? eyePiece + "_" : "Face_") +
          s.part.label.replace(/[^a-zA-Z0-9_-]/g, "_") +
          "_" +
          actor.children.length;
        if (typeof eyePiece === "string") face.userData["eyePiece"] = eyePiece;
        else {
          face.userData["faceSurface"] = true;
          if (source.userData["fittedEyes"]) face.userData["fittedEyes"] = true;
        }
        face.bind(skeleton, new T.Matrix4());
        face.userData["regionNames"] = regionNames;
        face.frustumCulled = false;
        face.castShadow = true;
        face.receiveShadow = true;
        actor.add(face);
        continue;
      }
      const list = byMaterial.get(material) ?? [];
      list.push(geometry);
      byMaterial.set(material, list);
    }
  const materials = [...byMaterial.keys()];
  const geometries = [...byMaterial.values()].flat();
  let skinned: T.SkinnedMesh | undefined;
  if (geometries.length) {
    if (geometries.some((g) => g.getAttribute("color")))
      for (const g of geometries) whiteVertexColors(g);
    if (geometries.some((g) => g.getAttribute("lodAnchor")))
      for (const g of geometries)
        if (!g.getAttribute("lodAnchor"))
          g.setAttribute(
            "lodAnchor",
            new T.Uint8BufferAttribute(new Uint8Array(g.getAttribute("position").count), 1),
          );
    if (geometries.some((g) => g.getAttribute("uv")))
      for (const g of geometries)
        if (!g.getAttribute("uv"))
          g.setAttribute(
            "uv",
            new T.Float32BufferAttribute(new Float32Array(g.getAttribute("position").count * 2), 2),
          );
    const combined = mergeGeometries(geometries);
    let start = 0;
    materials.forEach((mat, mi) => {
      const count = (byMaterial.get(mat) ?? []).reduce((n, g) => n + (g.index?.count ?? 0), 0);
      combined.addGroup(start, count, mi);
      start += count;
    });
    for (const g of geometries) g.dispose();
    const mesh = new T.SkinnedMesh(combined, materials);
    mesh.name = "Character surface";
    mesh.receiveShadow = true;
    mesh.userData["regionNames"] = regionNames;
    mesh.bind(skeleton, new T.Matrix4());
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    actor.add(mesh);
    skinned = mesh;
  }
  const bindings = bindPoseJoints(skeleton);
  const clips = standingOnly ? [] : buildClips(root, regions);
  const idle = clips.find((c) => c.name === "Idle");
  if (idle)
    for (const mesh of actor.children) {
      if (!isMesh(mesh) || mesh.morphTargetDictionary?.["Blink"] === undefined) continue;
      const d = idle.duration;
      idle.tracks.push(
        new T.NumberKeyframeTrack(
          mesh.name + ".morphTargetInfluences[Blink]",
          [0, 0.59 * d, 0.64 * d, 0.69 * d, d],
          [0, 0, 1, 0, 0],
        ),
      );
    }
  const poses = standingOnly ? [] : authoredClips(bindings, character.view.poses);
  const offer =
    !standingOnly && character.view.offer && offerClip(bindings, character.view.offer.pose);
  if (offer) clips.push(offer);
  const posture = character.human?.params.posture;
  if (human && posture && skinned)
    applyHumanPosture({
      regions,
      root,
      skeleton,
      actor,
      skinned,
      boneOf: (r) => human.bones.get(r.part.id),
      fan:
        character.human?.params.style.handProp === "Painted folding fan" &&
        character.view.outfit !== "Anatomy" &&
        character.view.outfit !== "Pressure suit" &&
        character.human.params.style.outfit !== "Pressure suit",
      posture,
      clips,
      poses,
      bindings,
      drapes: drapes || undefined,
    });
  if (skinned && skirtCages.size)
    animateSkirts(
      actor,
      skinned,
      regions,
      [...skirtCages.values()],
      [...clips, ...poses],
      [...character.parts.keys()],
    );
  if (skinned && drapes) animateDrapes(actor, drapes, [...clips, ...poses]);
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
  clips.push(...poses);
  return {
    actor,
    skeleton,
    bindings,
    clips,
    regions,
    dispose() {
      for (const o of actor.children) if (isMesh(o)) o.geometry.dispose();
      skeleton.dispose();
    },
  };
}
