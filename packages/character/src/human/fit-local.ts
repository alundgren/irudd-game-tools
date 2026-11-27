import { required } from "./required.js";
import { Vector3 } from "three";
import type { SkinCorrections } from "@irudd/document";
import type { HumanBody } from "./body.js";
import { evaluateHuman, type HumanSurface } from "./surface.js";
import { boneNames } from "./catalogue.js";
import { applyHeadLayer } from "./fine-head.js";
import { controlVectors, correctedSurface, surfaceFromVectors } from "./brush.js";
import { vertexNormals } from "./family-registration.js";
import { fitControls, eyeOpenings, exteriorSkin, type Controls } from "./fit-topology.js";
import { fitOffsetLimit, headFitSupport, smoothHeadFit, headFitDistortion } from "./fit-head.js";
import { refineFaceSurface } from "./fit-detail.js";
import type { FitTargetTree } from "./fit-target.js";
import { regionAt, type FittedAdult, type FitRegion } from "./fit-types.js";
function neighbourControls(s: HumanSurface, controls: Controls) {
  const graph = Array.from(controls.ids, () => new Set<number>());
  const owner = new Uint16Array(s.bodyVertices);
  for (let i = 0; i < s.bodyVertices; i++) {
    let closest = i * 4;
    for (let j = closest + 1; j < i * 4 + 4; j++)
      if ((controls.weights[j] ?? 0) > (controls.weights[closest] ?? 0)) closest = j;
    owner[i] = controls.refs[closest] ?? 0;
  }
  for (let i = 0; i < s.bodyTriangles * 3; i += 3) {
    for (let k = 0; k < 3; k++) {
      const a = owner[s.indices[i + k] ?? 0] ?? 0,
        b = owner[s.indices[i + ((k + 1) % 3)] ?? 0] ?? 0;
      if (a !== b) {
        required(graph[a]).add(b);
        required(graph[b]).add(a);
      }
    }
  }
  return graph;
}
export function fitSummary(surface: HumanSurface, tree: FitTargetTree, vertices: number[]) {
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
    p95Mm: d[Math.min(d.length - 1, Math.floor(0.95 * d.length))] ?? 0,
    samples: d.length,
  };
}
export function localReferenceFit(
  body: HumanBody,
  form: FittedAdult,
  tree: FitTargetTree,
  region: FitRegion,
  isolatedHead: boolean,
  keepEyeOpenings: boolean,
  denseHead: boolean,
  hold?: (p: Vector3) => boolean,
) {
  if (!form?.human) throw new Error("Open an adult human before fitting.");
  if (!["whole", "head", "trunk", "arms", "legs"].includes(region))
    throw new Error("Unknown fit region.");
  const source = evaluateHuman(body, form.human),
    controls = fitControls(body);
  const detail = form.fineHead,
    layered = (surface: HumanSurface) => applyHeadLayer(body, surface, detail);
  const vectors = controlVectors(body, form.corrections),
    coarse = surfaceFromVectors(body, source, vectors),
    initial = layered(coarse);
  const normals = vertexNormals(initial.positions, initial.indices, initial.bodyTriangles),
    graph = neighbourControls(source, controls);
  const direction = tree.observedDirection;
  const facing = (v: number) =>
    direction
      ? direction.x * (normals[v * 3] ?? 0) +
        direction.y * (normals[v * 3 + 1] ?? 0) +
        direction.z * (normals[v * 3 + 2] ?? 0)
      : 1;
  const exterior = exteriorSkin(source, controls);
  const eyes = keepEyeOpenings ? eyeOpenings(source, controls) : null;
  const matches = (v: number) =>
    Boolean(exterior[v]) &&
    (region === "whole" || regionAt(source, v) === region) &&
    (!isolatedHead || boneNames[source.boneIndices[v * 4] ?? 0] === "head") &&
    facing(v) > 0.08;
  const anchors = Array.from(controls.ids, (v, i) => (matches(v) ? i : -1)).filter((i) => i >= 0);
  const p = new Vector3(),
    n = new Vector3(),
    delta = new Vector3(),
    newOffset = new Vector3(),
    adj = new Vector3();
  const scale = source.height / 1.72;
  const headSupport = headFitSupport(source, controls, anchors);
  const observed =
    isolatedHead || hold || eyes
      ? new Set(
          anchors.filter((i) => {
            const k = (controls.ids[i] ?? 0) * 3;
            p.fromArray(initial.positions, k);
            if ((eyes?.anchors[i] ?? 0) || hold?.(p)) return false;
            return !isolatedHead || tree.query(p, n.fromArray(normals, k), 0.1 * scale);
          }),
        )
      : null;
  const held = observed ? anchors.length - observed.size : 0;
  const originalVectors = vectors.slice();
  let accepted = 0,
    current = initial;
  for (let step = 0; step < 5; step++) {
    const prev = vectors.slice();
    accepted = 0;
    for (const i of anchors) {
      if (observed && !observed.has(i)) continue;
      const v = controls.ids[i] ?? 0;
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
      if (required(graph[i]).size) {
        adj.set(0, 0, 0);
        for (const j of required(graph[i])) adj.add(new Vector3().fromArray(prev, j * 3));
        newOffset.lerp(adj.multiplyScalar(1 / required(graph[i]).size), 0.2);
      }
      newOffset.clampLength(0, fitOffsetLimit);
      newOffset.toArray(vectors, i * 3);
      accepted++;
    }
    smoothHeadFit(vectors, originalVectors, headSupport, observed);
    current = layered(surfaceFromVectors(body, source, vectors));
  }
  if (accepted < Math.min(20, anchors.length * 0.08))
    throw new Error("Too little overlap. Align the height, orientation and pose first.");
  if (denseHead && headSupport.length) {
    const allowed = headSupport.map(({ i }) => i).filter((i) => !observed || observed.has(i));
    const visible = (v: number) =>
      v % 9 !== 5 &&
      matches(v) &&
      !(eyes?.skin[v] ?? 0) &&
      !hold?.(p.fromArray(initial.positions, 3 * v));
    for (let pass = 0; pass < 2; pass++) {
      refineFaceSurface(
        current,
        vertexNormals(current.positions, current.indices, current.bodyTriangles),
        controls,
        vectors,
        allowed,
        headSupport,
        visible,
        tree.query,
        scale,
      );
      current = layered(surfaceFromVectors(body, source, vectors));
    }
  }
  if (headSupport.length) {
    const priorFolds = new Set<number>();
    if (form.corrections) {
      headFitDistortion(source, coarse, (_a, _b, _c, face) => priorFolds.add(face));
    }
    for (let pass = 0; pass < 12; pass++) {
      const saved = Float32Array.from(vectors, (x) => Math.round(x * 10000) / 10000);
      const candidate = surfaceFromVectors(body, source, saved);
      const affected = new Set<number>();
      function relaxTriangle(a: number, b: number, c: number) {
        for (const v of [a, b, c])
          for (let j = v * 4; j < v * 4 + 4; j++)
            if (controls.weights[j] ?? 0) affected.add(controls.refs[j] ?? 0);
      }
      headFitDistortion(source, candidate, (a, b, c, face) => {
        if (!priorFolds.has(face)) relaxTriangle(a, b, c);
      });
      if (form.corrections || detail) headFitDistortion(initial, layered(candidate), relaxTriangle);
      if (!affected.size) break;
      if (pass === 11) {
        for (const { i } of headSupport)
          vectors.set(originalVectors.subarray(i * 3, i * 3 + 3), i * 3);
        break;
      }
      for (const i of affected)
        for (let d = 0; d < 3; d++) {
          const k = i * 3 + d;
          vectors[k] =
            (originalVectors[k] ?? 0) +
            (pass < 8 ? 0.62 : 0) * ((vectors[k] ?? 0) - (originalVectors[k] ?? 0));
        }
    }
  }
  const rows: SkinCorrections["controls"][number][] = [];
  for (let i = 0; i < controls.ids.length; i++) {
    const q = [0, 1, 2].map((d) => Math.round((vectors[i * 3 + d] ?? 0) * 10000));
    if (q.some(Boolean)) rows.push([i, q[0] ?? 0, q[1] ?? 0, q[2] ?? 0]);
  }
  const fit = { controls: rows },
    final = layered(correctedSurface(body, source, fit));
  const controlIds = new Set(controls.ids),
    probes = [];
  for (let i = 5; i < source.bodyVertices; i += 9)
    if (
      !controlIds.has(i) &&
      matches(i) &&
      !(eyes?.skin[i] ?? 0) &&
      !hold?.(p.fromArray(initial.positions, i * 3))
    )
      probes.push(i);
  return {
    fit,
    metrics: {
      before: fitSummary(initial, tree, probes),
      after: fitSummary(final, tree, probes),
      fittedAnchors: accepted,
      ...(denseHead && headSupport.length ? { refinedFacialContours: true } : {}),
      ...(headSupport.length
        ? {
            headDistortion: headFitDistortion(
              source,
              detail ? correctedSurface(body, source, fit) : final,
            ),
          }
        : {}),
      eligibleAnchors: anchors.length,
      ...(hold ? { heldAnchors: held } : {}),
      ...(eyes ? { eyeOpeningsKept: true } : {}),
      ...(direction ? { observedSurfaceOnly: true } : {}),
      region,
    },
  };
}
