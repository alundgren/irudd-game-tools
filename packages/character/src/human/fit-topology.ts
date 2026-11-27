import { BufferAttribute, BufferGeometry } from "three";
import { mouthLining } from "./mouth.js";
import type { HumanSurface } from "./surface.js";
import type { HumanBody } from "./body.js";
export function fitControls(body: HumanBody) {
  return {
    ids: body.arrays.u16("controlIds"),
    refs: body.arrays.u16("controlRefs"),
    weights: body.arrays.u16("controlWeights"),
  };
}
export type Controls = ReturnType<typeof fitControls>;

const byTopology = new WeakMap<
  Uint16Array,
  { lining: Uint8Array; anchors: Uint8Array; skin: Uint8Array } | null
>();

export function eyeOpenings(surface: HumanSurface, controls: Controls) {
  if (byTopology.has(surface.uvFaces)) return byTopology.get(surface.uvFaces);
  const groups = surface.eyeGroups ?? [],
    count = surface.bodyVertices,
    corners = surface.bodyTriangles * 3;
  let found = null;
  if (groups.length) {
    const { ids, refs, weights } = controls;
    const parent = Int32Array.from({ length: surface.uv.length / 2 }, (_, i) => i);
    const find = (i: number) => {
      while ((parent[i] ?? 0) !== i) i = parent[i] = parent[parent[i] ?? 0] ?? 0;
      return i;
    };
    for (let t = 0; t < corners; t += 3) {
      const a = find(surface.uvFaces[t] ?? 0);
      parent[find(surface.uvFaces[t + 1] ?? 0)] = a;
      parent[find(surface.uvFaces[t + 2] ?? 0)] = a;
    }
    const islands = new Map<number, Set<number>>(),
      shared = new Uint8Array(count),
      first = new Int32Array(count).fill(-1);
    for (let i = 0; i < corners; i++) {
      const island = find(surface.uvFaces[i] ?? 0),
        v = surface.indices[i] ?? 0;
      if ((first[v] ?? -1) < 0) first[v] = island;
      else if (first[v] !== island) shared[v] = 1;
      if (!islands.has(island)) islands.set(island, new Set<number>());
      islands.get(island)?.add(v);
    }
    const lining = new Uint8Array(count),
      anchors = new Uint8Array(ids.length),
      anchorOf = new Map(Array.from(ids, (v, i) => [v, i]));
    for (const group of groups) {
      const c = [0, 0, 0];
      for (const v of group)
        for (let d = 0; d < 3; d++)
          c[d] = (c[d] ?? 0) + (surface.positions[v * 3 + d] ?? 0) / group.length;
      const from = (v: number) =>
        Math.hypot(
          (surface.positions[v * 3] ?? 0) - (c[0] ?? 0),
          (surface.positions[v * 3 + 1] ?? 0) - (c[1] ?? 0),
          (surface.positions[v * 3 + 2] ?? 0) - (c[2] ?? 0),
        );
      let reach = 0;
      for (const v of group) reach = Math.max(reach, from(v));
      for (const members of islands.values()) {
        const mid = [0, 0, 0];
        let wraps = true;
        for (const v of members) {
          if (from(v) > 1.5 * reach) {
            wraps = false;
            break;
          }
          for (let d = 0; d < 3; d++)
            mid[d] = (mid[d] ?? 0) + (surface.positions[v * 3 + d] ?? 0) / members.size;
        }
        if (
          !wraps ||
          Math.hypot(
            (mid[0] ?? 0) - (c[0] ?? 0),
            (mid[1] ?? 0) - (c[1] ?? 0),
            (mid[2] ?? 0) - (c[2] ?? 0),
          ) >
            0.5 * reach
        )
          continue;
        for (const v of members) {
          if (!(shared[v] ?? 0)) lining[v] = 1;
          if (anchorOf.has(v)) anchors[anchorOf.get(v) ?? 0] = 1;
        }
      }
      for (const v of group)
        for (let j = v * 4; j < v * 4 + 4; j++) if (weights[j] ?? 0) anchors[refs[j] ?? 0] = 1;
    }
    const skin = new Uint8Array(count);
    for (let v = 0; v < count; v++) {
      let all = 0,
        kept = 0;
      for (let j = v * 4; j < v * 4 + 4; j++) {
        all += weights[j] ?? 0;
        if (anchors[refs[j] ?? 0]) kept += weights[j] ?? 0;
      }
      if ((lining[v] ?? 0) || kept > 0.5 * all) skin[v] = 1;
    }
    found = { lining, anchors, skin };
  }
  byTopology.set(surface.uvFaces, found);
  return found;
}

const exteriorCache = new WeakMap<Uint16Array, Uint8Array>();

export function exteriorSkin(surface: HumanSurface, controls: Controls) {
  const prior = exteriorCache.get(surface.uvFaces);
  if (prior) return prior;
  const chart = new BufferGeometry();
  chart.setAttribute("uv", new BufferAttribute(surface.uv, 2, true));
  const corners = surface.bodyTriangles * 3;
  chart.setIndex(new BufferAttribute(surface.uvFaces.subarray(0, corners), 1));
  const lining = mouthLining(chart);
  const exterior = new Uint8Array(surface.bodyVertices);
  for (let i = 0; i < corners; i++) {
    if (!lining[surface.uvFaces[i] ?? 0]) exterior[surface.indices[i] ?? 0] = 1;
  }
  chart.dispose();
  const sockets = eyeOpenings(surface, controls)?.lining;
  if (sockets) for (let v = 0; v < exterior.length; v++) if (sockets[v] ?? 0) exterior[v] = 0;
  exteriorCache.set(surface.uvFaces, exterior);
  return exterior;
}
