import {
  Ray,
  Box3,
  BufferAttribute,
  BufferGeometry,
  Triangle,
  Vector3,
} from "three";
import { fitMeasurements } from "./human-measure-fit.js";
import { refineFaceSurface } from "./human-fit-detail.js";
import { fitOffsetLimit, headFitSupport, smoothHeadFit, headFitDistortion } from "./human-fit-head.js";
import {
  evaluateHuman,
  humanControls,
  applyHumanControls,
  applyHumanDetail,
  controlVectors,
} from "./human-surface.js";

import { scanBoundary } from "./scan-boundary.js";
import { exteriorSkin } from "./human-fit-exterior.js";
import { eyeOpenings } from "./human-fit-eyes.js";

const axisNames = ["x", "y", "z"];
function targetTree(geometry, partial = false) {
  const positions = geometry?.attributes?.position,
    indices = geometry?.index?.array;
  const n = Math.floor((indices?.length ?? positions?.count ?? 0) / 3);
  if (!n || n > 750000)
    throw new Error("Use a reference with 1 to 750,000 triangles.");
  const triangles = [], areaNormal = new Vector3();
  let totalArea = 0;
  for (let f = 0; f < n; f++) {
    const points = [0, 1, 2].map((k) =>
      new Vector3().fromBufferAttribute(
        positions,
        indices ? indices[f * 3 + k] : f * 3 + k,
      ),
    );
    if (!points.every((v) => Number.isFinite(v.x + v.y + v.z)))
      throw new Error("Reference contains nonfinite positions.");
    const tri = new Triangle(...points),
      normal = tri.getNormal(new Vector3());
    if (normal.lengthSq() > 0.5) {
      const area = tri.getArea();
      triangles.push({ tri, normal, area, center: tri.getMidpoint(new Vector3()) });
      totalArea += area;
      areaNormal.addScaledVector(normal, area);
    }
  }
  if (!triangles.length)
    throw new Error("The reference has no usable surface.");
  function build(items) {
    const box = new Box3();
    for (const { tri } of items)
      box.expandByPoint(tri.a).expandByPoint(tri.b).expandByPoint(tri.c);
    if (items.length <= 10) return { box, items };
    const sizes = box.getSize(new Vector3()).toArray(),
      axis = axisNames[sizes.indexOf(Math.max(...sizes))];
    items.sort((a, b) => a.center[axis] - b.center[axis]);
    const mid = items.length >> 1;
    return {
      box,
      left: build(items.slice(0, mid)),
      right: build(items.slice(mid)),
    };
  }
  const onBoundary = partial ? scanBoundary(triangles) : null;
  const tree = build(triangles),
    candidate = new Vector3(),
    near = new Vector3();
  function query(point, normal, max = Infinity, rejectRim = Boolean(normal), matchedNormal = null) {
    if (normal && onBoundary && !query(point, null, max, true)) return null;
    let best = max * max,
      nearestFace = null;
    function visit(node) {
      if (node.box.clampPoint(point, candidate).distanceToSquared(point) > best)
        return;
      if (node.items) {
        for (const face of node.items) {
          if (normal && face.normal.dot(normal) < 0.15) continue;
          face.tri.closestPointToPoint(point, candidate);
          const d = candidate.distanceToSquared(point);
          if (d < best) {
            best = d;
            near.copy(candidate);
            nearestFace = face;
          }
        }
      } else {
        const dl = node.left.box
          .clampPoint(point, candidate)
          .distanceToSquared(point);
        const dr = node.right.box
          .clampPoint(point, candidate)
          .distanceToSquared(point);
        if (dl < dr) {
          visit(node.left);
          visit(node.right);
        } else {
          visit(node.right);
          visit(node.left);
        }
      }
    }
    visit(tree);
    if (!nearestFace || (rejectRim && onBoundary?.(nearestFace, near))) return null;
    matchedNormal?.copy(nearestFace.normal);
    return near;
  }
  let observedDirection = null;
  if (areaNormal.length() > 0.35 * totalArea) {
    const direction = areaNormal.normalize();
    const opposingArea = triangles.reduce((sum, t) => sum + (t.normal.dot(direction) < -0.08 ? t.area : 0), 0);
    if (opposingArea < 0.025 * totalArea) observedDirection = direction;
  }
  const ray = new Ray(), hit = new Vector3(), bestPoint = new Vector3();
  function fromView(p, view, reach) {
    ray.origin.copy(p).addScaledVector(view,reach);
    ray.direction.copy(view).negate();
    let best = reach * 2, bestFace;
    function walk(node) {
      if (!ray.intersectsBox(node.box) || node.box.distanceToPoint(ray.origin) > best) return;
      if (!node.items) { walk(node.left); walk(node.right); return; }
      for (const face of node.items) {
        if (face.normal.dot(view) <= 0) continue;
        if (ray.intersectTriangle(face.tri.a,face.tri.b,face.tri.c,false,hit)) {
          const d = hit.distanceTo(ray.origin);
          if (d < best) { best = d; bestFace = face; bestPoint.copy(hit); }
        }
      }
    }
    walk(tree);
    return bestFace ? {point:bestPoint,normal:bestFace.normal} : null;
  }
  return { query, observedDirection, fromView };
}

function vertexNormals(surface) {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(surface.positions, 3));
  geometry.setIndex(
    new BufferAttribute(
      surface.indices.subarray(0, surface.bodyTriangles * 3),
      1,
    ),
  );
  geometry.computeVertexNormals();
  return geometry.attributes.normal.array;
}
function partRegion(name) {
  if (name === "head" || name.startsWith("neck")) return "head";
  if (/thigh|calf|foot|ball/.test(name)) return "legs";
  if (/arm|hand|thumb|index|middle|ring|pinky/.test(name)) return "arms";
  return "trunk";
}
function neighbourControls(s, controls) {
  const graph = Array.from(controls.ids, () => new Set());
  const owner = new Uint16Array(s.bodyVertices);
  for (let i = 0; i < s.bodyVertices; i++) {
    let closest = i * 4;
    for (let j = closest + 1; j < i * 4 + 4; j++)
      if (controls.weights[j] > controls.weights[closest]) closest = j;
    owner[i] = controls.refs[closest];
  }
  for (let i = 0; i < s.bodyTriangles * 3; i += 3) {
    for (let k = 0; k < 3; k++) {
      const a = owner[s.indices[i + k]],
        b = owner[s.indices[i + ((k + 1) % 3)]];
      if (a !== b) {
        graph[a].add(b);
        graph[b].add(a);
      }
    }
  }
  return graph;
}
function summary(surface, tree, vertices) {
  const p = new Vector3(),
    d = [];
  for (const v of vertices) {
    p.fromArray(surface.positions, v * 3);
    const nearest = tree.query(p, null);
    if (nearest) d.push(1000 * p.distanceTo(nearest));
  }
  d.sort((a, b) => a - b);
  if (!d.length) throw new Error("No surface samples for this region.");
  return {
    meanMm: d.reduce((a, b) => a + b, 0) / d.length,
    p95Mm: d[Math.min(d.length - 1, Math.floor(0.95 * d.length))],
    samples: d.length,
  };
}
export function optimizeHumanMeasurements(
  form,
  targetGeometry,
  { region = "whole", isolatedHead = false, hold = null, keepEyeOpenings = false } = {},
) {
  return fitMeasurements(form, targetGeometry, region, {
    targetTree,
    vertexNormals,
    partRegion,
    isolatedHead,
    summary,
    hold,
    keepEyeOpenings,
  });
}
export function fitHumanReference(
  form,
  targetGeometry,
  { region = "whole", isolatedHead = false, hold = null, keepEyeOpenings = false, denseHead = false } = {},
) {
  if (!form?.human) throw new Error("Open an adult human before fitting.");
  if (!["whole", "head", "trunk", "arms", "legs"].includes(region))
    throw new Error("Unknown fit region.");
  const tree = targetTree(targetGeometry, isolatedHead),
    source = evaluateHuman(form.human),
    controls = humanControls();
  const detail = form.humanDetail,
    layered = (surface) => (detail ? applyHumanDetail(surface, detail) : surface);
  const vectors = controlVectors(form.humanFit),
    coarse = applyHumanControls(source, vectors),
    initial = layered(coarse);
  const normals = vertexNormals(initial),
    graph = neighbourControls(source, controls);
  const direction = tree.observedDirection;
  const facing = (v) => direction
    ? direction.x * normals[v * 3] + direction.y * normals[v * 3 + 1] + direction.z * normals[v * 3 + 2]
    : 1;
  const exterior = exteriorSkin(source);
  const eyes = keepEyeOpenings ? eyeOpenings(source) : null;
  const matches = (v) => exterior[v] &&
    (region === "whole" || partRegion(source.names[source.boneIndices[v * 4]]) === region) &&
    (!isolatedHead || source.names[source.boneIndices[v * 4]] === "head") && facing(v) > 0.08;
  const anchors = Array.from(controls.ids, (v, i) =>
    matches(v) ? i : -1,
  ).filter((i) => i >= 0);
  const p = new Vector3(),
    n = new Vector3(),
    delta = new Vector3(),
    newOffset = new Vector3(),
    adj = new Vector3();
  const scale = source.height / 1.72;
  const headSupport = headFitSupport(source, controls, anchors);
  const observed = isolatedHead || hold || eyes ? new Set(anchors.filter(i => {
    const k = controls.ids[i] * 3;
    p.fromArray(initial.positions, k);
    if (eyes?.anchors[i] || hold?.(p)) return false;
    return !isolatedHead || tree.query(p, n.fromArray(normals, k), 0.1 * scale);
  })) : null;
  const held = observed ? anchors.length - observed.size : 0;
  const originalVectors = vectors.slice();
  let accepted = 0,
    current = initial;
  for (let step = 0; step < 5; step++) {
    const prev = vectors.slice();
    accepted = 0;
    for (const i of anchors) {
      if (observed && !observed.has(i)) continue;
      const v = controls.ids[i];
      p.fromArray(current.positions, v * 3);
      n.fromArray(normals, v * 3);
      const match = tree.query(p, n, 0.1 * scale);
      if (!match) continue;
      delta.copy(match).sub(p);
      const along = delta.dot(n);
      delta
        .multiplyScalar(0.14)
        .addScaledVector(n, 0.86 * along)
        .multiplyScalar((0.66 / scale) * Math.min(1, (facing(v) - 0.08) / 0.45))
        .clampLength(0, 0.023);
      newOffset.fromArray(prev, i * 3).add(delta);
      if (graph[i].size) {
        adj.set(0, 0, 0);
        for (const j of graph[i]) adj.add(new Vector3().fromArray(prev, j * 3));
        newOffset.lerp(adj.multiplyScalar(1 / graph[i].size), 0.2);
      }
      newOffset.clampLength(0, fitOffsetLimit);
      newOffset.toArray(vectors, i * 3);
      accepted++;
    }
    smoothHeadFit(vectors, originalVectors, headSupport, observed);
    current = layered(applyHumanControls(source, vectors));
  }
  if (accepted < Math.min(20, anchors.length * 0.08))
    throw new Error(
      "Too little overlap. Align the height, orientation and pose first.",
    );
  if (denseHead && headSupport.length) {
    const allowed = headSupport.map(({i}) => i).filter(i => !observed || observed.has(i));
    const visible = v => v % 9 !== 5 && matches(v) && !eyes?.skin[v] && !hold?.(p.fromArray(initial.positions,3*v));
    for (let pass = 0; pass < 2; pass++) {
      refineFaceSurface(current,vertexNormals(current),controls,vectors,allowed,headSupport,visible,tree.query,scale);
      current = layered(applyHumanControls(source,vectors));
    }
  }
  if (headSupport.length) {
    const priorFolds = new Set();
    if (form.humanFit) {
      headFitDistortion(source, coarse, (a, b, c, face) => priorFolds.add(face));
    }
    for (let pass = 0; pass < 12; pass++) {
      const saved = Float32Array.from(vectors, x => Math.round(x*10000)/10000);
      const candidate = applyHumanControls(source, saved);
      const affected = new Set();
      function relaxTriangle(a, b, c) {
        for (const v of [a, b, c])
          for (let j=v*4; j<v*4+4; j++)
            if (controls.weights[j]) affected.add(controls.refs[j]);
      }
      headFitDistortion(source, candidate, (a, b, c, face) => {
        if (!priorFolds.has(face)) relaxTriangle(a, b, c);
      });
      if (form.humanFit || detail) headFitDistortion(initial, layered(candidate), relaxTriangle);
      if (!affected.size) break;
      if (pass === 11) {
        for (const { i } of headSupport)
          vectors.set(originalVectors.subarray(i * 3, i * 3 + 3), i * 3);
        break;
      }
      for (const i of affected)
        for (let d=0; d<3; d++) {
          const k=i*3+d;
          vectors[k] = originalVectors[k] + (pass < 8 ? .62 : 0) * (vectors[k]-originalVectors[k]);
        }
    }
  }
  const rows = [];
  for (let i = 0; i < controls.ids.length; i++) {
    const q = [0, 1, 2].map((d) => Math.round(vectors[i * 3 + d] * 10000));
    if (q.some(Boolean)) rows.push([i, ...q]);
  }
  const fit = { version: 1, strength: 1, controls: rows },
    final = evaluateHuman(form.human, fit, detail);
  const controlIds = new Set(controls.ids),
    probes = [];
  for (let i = 5; i < source.bodyVertices; i += 9)
    if (!controlIds.has(i) && matches(i) && !eyes?.skin[i] && !hold?.(p.fromArray(initial.positions, i * 3))) probes.push(i);
  return {
    fit,
    metrics: {
      before: summary(initial, tree, probes),
      after: summary(final, tree, probes),
      fittedAnchors: accepted,
      ...(denseHead && headSupport.length ? { refinedFacialContours: true } : {}),
      ...(headSupport.length ? {headDistortion: headFitDistortion(source, detail ? evaluateHuman(form.human, fit) : final)} : {}),
      eligibleAnchors: anchors.length,
      ...(hold ? { heldAnchors: held } : {}),
      ...(eyes ? { eyeOpeningsKept: true } : {}),
      ...(direction ? { observedSurfaceOnly: true } : {}),
      region,
    },
  };
}
