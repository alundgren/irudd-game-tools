import { humanControls } from "./human-surface.js";

const byTopology = new WeakMap();

/* The skin around each eye, read from the head's own build rather than from a
   measured distance. Each socket is lined by its own island of the skin layout,
   joined to the face along the lid margins, and each eyeball is carried by a
   handful of fit anchors: the lining behind it and the lids over it.

   `lining` flags the skin an outside scan can never observe: the inside of a
   socket, without the lid margins it shares with the face.
   `anchors` flags the fit anchors that carry an eyeball or sit on the lining.
   `skin` flags the skin those anchors mostly move: the eye openings.
   Returns null for a surface that has no eyeballs. */
export function eyeOpenings(surface) {
  if (byTopology.has(surface.uvFaces)) return byTopology.get(surface.uvFaces);
  const groups = surface.eyeGroups ?? [],
    count = surface.bodyVertices,
    corners = surface.bodyTriangles * 3;
  let found = null;
  if (groups.length) {
    const { ids, refs, weights } = humanControls();
    // Islands of the skin layout, and the skin vertices each one uses.
    const parent = Int32Array.from({ length: surface.uv.length / 2 }, (_, i) => i);
    const find = (i) => {
      while (parent[i] !== i) i = parent[i] = parent[parent[i]];
      return i;
    };
    for (let t = 0; t < corners; t += 3) {
      const a = find(surface.uvFaces[t]);
      parent[find(surface.uvFaces[t + 1])] = a;
      parent[find(surface.uvFaces[t + 2])] = a;
    }
    const islands = new Map(),
      shared = new Uint8Array(count),
      first = new Int32Array(count).fill(-1);
    for (let i = 0; i < corners; i++) {
      const island = find(surface.uvFaces[i]),
        v = surface.indices[i];
      if (first[v] < 0) first[v] = island;
      else if (first[v] !== island) shared[v] = 1;
      if (!islands.has(island)) islands.set(island, new Set());
      islands.get(island).add(v);
    }
    const lining = new Uint8Array(count),
      anchors = new Uint8Array(ids.length),
      anchorOf = new Map(Array.from(ids, (v, i) => [v, i]));
    for (const group of groups) {
      // The eyeball's middle and reach.
      const c = [0, 0, 0];
      for (const v of group)
        for (let d = 0; d < 3; d++) c[d] += surface.positions[v * 3 + d] / group.length;
      const from = (v) =>
        Math.hypot(
          surface.positions[v * 3] - c[0],
          surface.positions[v * 3 + 1] - c[1],
          surface.positions[v * 3 + 2] - c[2],
        );
      let reach = 0;
      for (const v of group) reach = Math.max(reach, from(v));
      // Its socket is the island of skin that wraps it: wholly within reach of the ball
      // and around its middle, which the face, the mouth and the body are not.
      for (const members of islands.values()) {
        const mid = [0, 0, 0];
        let wraps = true;
        for (const v of members) {
          if (from(v) > 1.5 * reach) {
            wraps = false;
            break;
          }
          for (let d = 0; d < 3; d++) mid[d] += surface.positions[v * 3 + d] / members.size;
        }
        if (!wraps || Math.hypot(mid[0] - c[0], mid[1] - c[1], mid[2] - c[2]) > 0.5 * reach) continue;
        for (const v of members) {
          if (!shared[v]) lining[v] = 1;
          // A lid margin is observed skin, but its anchor still shapes the opening.
          if (anchorOf.has(v)) anchors[anchorOf.get(v)] = 1;
        }
      }
      for (const v of group)
        for (let j = v * 4; j < v * 4 + 4; j++) if (weights[j]) anchors[refs[j]] = 1;
    }
    const skin = new Uint8Array(count);
    for (let v = 0; v < count; v++) {
      let all = 0,
        kept = 0;
      for (let j = v * 4; j < v * 4 + 4; j++) {
        all += weights[j];
        if (anchors[refs[j]]) kept += weights[j];
      }
      if (lining[v] || kept > 0.5 * all) skin[v] = 1;
    }
    found = { lining, anchors, skin };
  }
  byTopology.set(surface.uvFaces, found);
  return found;
}
