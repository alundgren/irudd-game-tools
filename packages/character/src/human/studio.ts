import * as T from "three";
import type { SmoothSurface } from "./smooth.js";
import type { HumanBody } from "./body.js";
import type { HumanSurface } from "./surface.js";
import { studioExpressions, studioPieces } from "./studio-data.js";

function nativeRim(s: SmoothSurface, corners: readonly number[]) {
  const edges = new Set<number>(),
    count = s.positions.length / 3;
  for (let i = 0; i < corners.length; i += 3)
    for (let j = 0; j < 3; j++) {
      const a = s.indices[corners[i + j] ?? 0] ?? 0,
        b = s.indices[corners[i + ((j + 1) % 3)] ?? 0] ?? 0;
      edges.add(a * count + b);
    }
  const next = new Map<number, number>();
  for (const key of edges) {
    const a = Math.floor(key / count),
      b = key % count;
    if (!edges.has(b * count + a)) next.set(a, b);
  }
  let lowest = Infinity,
    best: number[] = [];
  while (next.size) {
    const start = next.keys().next().value;
    if (start === undefined) break;
    const ring: number[] = [];
    let v: number | undefined = start;
    while (v !== undefined && next.has(v)) {
      ring.push(v);
      const n: number | undefined = next.get(v);
      next.delete(v);
      v = n;
    }
    if (v !== start || ring.length < 12) continue;
    const mean = ring.reduce((sum, n) => sum + (s.positions[n * 3 + 1] ?? 0), 0) / ring.length;
    if (mean < lowest) {
      lowest = mean;
      best = ring;
    }
  }
  return best;
}
export function studioCollar(
  body: HumanBody,
  s: SmoothSurface,
  corners: readonly number[],
  origin: readonly [number, number, number],
  head: T.Mesh,
  headBone: number,
  skin: string,
  plain: boolean,
) {
  const native = nativeRim(s, corners),
    rim = body.studio.u16("neck");
  if (!native.length) return;
  const coords = head.geometry.getAttribute("position"),
    color = head.geometry.getAttribute("color"),
    tone = new T.Color(skin);
  const points: T.Vector3[] = [],
    colours: number[] = [],
    indices: number[] = [],
    weights: number[] = [],
    bones: number[] = [];
  for (const v of rim) {
    points.push(new T.Vector3().fromBufferAttribute(coords, v));
    colours.push(color.getX(v), color.getY(v), color.getZ(v));
    weights.push(1, 0, 0, 0);
    bones.push(headBone, 0, 0, 0);
  }
  for (const v of native) {
    points.push(new T.Vector3().fromArray(s.positions, v * 3).sub(new T.Vector3(...origin)));
    colours.push(tone.r, tone.g, tone.b);
    for (let j = 0; j < 4; j++) {
      weights.push(s.weights[4 * v + j] ?? 0);
      bones.push(s.boneIndices[4 * v + j] ?? 0);
    }
  }
  function ordered(start: number, length: number) {
    const ring = points.slice(start, start + length),
      centre = ring.reduce((c, p) => c.add(p), new T.Vector3()).multiplyScalar(1 / length);
    return ring
      .map((p, i) => ({ i: i + start, a: Math.atan2(p.x - centre.x, p.z - centre.z) }))
      .sort((a, b) => a.a - b.a);
  }
  const upper = ordered(0, rim.length),
    lower = ordered(rim.length, native.length);
  for (let i = 0, j = 0; i < upper.length || j < lower.length;) {
    const a = upper[i % upper.length],
      b = lower[j % lower.length],
      c = upper[(i + 1) % upper.length],
      d = lower[(j + 1) % lower.length];
    if (!a || !b || !c || !d) break;
    if (
      j === lower.length ||
      (i < upper.length &&
        c.a + (i + 1 >= upper.length ? 2 * Math.PI : 0) <=
          d.a + (j + 1 >= lower.length ? 2 * Math.PI : 0))
    ) {
      indices.push(a.i, b.i, c.i);
      i++;
    } else {
      indices.push(a.i, b.i, d.i);
      j++;
    }
  }
  const g = new T.BufferGeometry();
  g.setAttribute(
    "position",
    new T.Float32BufferAttribute(
      points.flatMap((p) => p.toArray()),
      3,
    ),
  );
  g.setAttribute("uv", new T.BufferAttribute(new Float32Array(points.length * 2), 2));
  g.setAttribute("color", new T.Float32BufferAttribute(colours, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  const mesh = new T.Mesh(
    g,
    new T.MeshStandardMaterial({
      color: plain ? 0xcac5be : 0xffffff,
      vertexColors: !plain,
      side: T.DoubleSide,
    }),
  );
  mesh.name = "Studio Rain neck";
  return { mesh, bones, weights };
}
export function studioMeshes(
  body: HumanBody,
  s: HumanSurface,
  origin: readonly [number, number, number],
  skin: string,
  hair: string,
  familyHair: boolean,
  plain: boolean,
) {
  const pack = body.studio;
  const eyes = s.eyeGroups.map((group) => {
    const centre = new T.Vector3();
    for (const v of group) centre.add(new T.Vector3().fromArray(s.positions, 3 * v));
    return centre.multiplyScalar(1 / group.length);
  });
  const centre = new T.Vector3()
    .addVectors(eyes[0] ?? new T.Vector3(), eyes[1] ?? new T.Vector3())
    .multiplyScalar(0.5);
  const scale = s.height / 1.72;
  const offset = centre
    .sub(new T.Vector3(0, 1.60812, 0.10012).multiplyScalar(scale))
    .sub(new T.Vector3(...origin));
  return studioPieces
    .filter((name) => familyHair || !name.startsWith("hair"))
    .map((name) => {
      const geo = new T.BufferGeometry();
      geo.setAttribute("position", new T.BufferAttribute(pack.f32(name + ".position").slice(), 3));
      geo.scale(scale, scale, scale).translate(offset.x, offset.y, offset.z);
      geo.setAttribute("uv", new T.BufferAttribute(pack.f32(name + ".uv"), 2));
      geo.setIndex(new T.BufferAttribute(pack.u16(name + ".index"), 1));
      geo.computeVertexNormals();
      const source = pack.u8(name + ".color"),
        tint = new T.Color(),
        values = new Float32Array(source.length);
      const gain =
        name === "skin"
          ? new T.Color(skin).multiply(new T.Color(1 / 0.2384, 1 / 0.1274, 1 / 0.0545))
          : name.startsWith("hair_")
            ? new T.Color(hair).multiply(new T.Color(1 / 0.0185, 1 / 0.01033, 1 / 0.00605))
            : new T.Color(0xffffff);
      for (let i = 0; i < values.length; i += 3)
        tint
          .setRGB(
            (source[i] ?? 0) / 255,
            (source[i + 1] ?? 0) / 255,
            (source[i + 2] ?? 0) / 255,
            T.SRGBColorSpace,
          )
          .multiply(gain)
          .toArray(values, i);
      geo.setAttribute("color", new T.BufferAttribute(values, 3));
      if (pack.has(name + ".Blink")) {
        geo.morphTargetsRelative = true;
        geo.morphAttributes["position"] = studioExpressions.map((e) => {
          const attr = new T.BufferAttribute(
            pack.f32(name + "." + e).map((n) => n * scale),
            3,
          );
          attr.name = e;
          return attr;
        });
      }
      const mesh = new T.Mesh(
        geo,
        new T.MeshStandardMaterial({
          color: plain ? 0xcac5be : 0xffffff,
          vertexColors: !plain,
          roughness: name === "eyes" ? 0.24 : 0.74,
          side: T.DoubleSide,
        }),
      );
      mesh.name = "Studio Rain " + name;
      mesh.userData["faceSurface"] = name === "skin";
      mesh.castShadow = true;
      return mesh;
    });
}
