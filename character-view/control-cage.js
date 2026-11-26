import {
  BufferGeometry,
  Float32BufferAttribute,
  ShapeUtils,
  Vector2,
  Vector3,
} from "three";

const key = (a, b) => (a < b ? a + ":" + b : b + ":" + a);
const vector = (coords) => new Vector3(...coords);
function average(points) {
  const sum = new Vector3();
  for (const point of points) sum.add(point);
  return sum.divideScalar(points.length);
}
function normal(points) {
  const n = new Vector3(),
    origin = points[0];
  for (let i = 1; i < points.length - 1; i++)
    n.add(
      new Vector3().crossVectors(
        points[i].clone().sub(origin),
        points[i + 1].clone().sub(origin),
      ),
    );
  return n;
}
function net(vertices, faces) {
  const edges = new Map(),
    faceRings = vertices.map(() => []),
    edgeRings = vertices.map(() => []);
  faces.forEach((face, fi) => {
    face.forEach((a, i) => {
      faceRings[a].push(fi);
      const b = face[(i + 1) % face.length],
        id = key(a, b);
      let edge = edges.get(id);
      if (!edge) {
        edge = { a, b, faces: [] };
        edges.set(id, edge);
        edgeRings[a].push(edge);
        edgeRings[b].push(edge);
      } else if (edge.faces.length === 2 || edge.a === a)
        throw new Error("Faces must meet along oppositely wound edges.");
      edge.faces.push(fi);
    });
  });
  return { edges, faceRings, edgeRings };
}
export function checkCage(cage) {
  const vs = cage?.vertices,
    fs = cage?.faces;
  if (
    !Array.isArray(vs) ||
    vs.length < 3 ||
    vs.length > 192 ||
    !Array.isArray(fs) ||
    !fs.length ||
    fs.length > 256 ||
    ![0, 1, 2].includes(cage.levels ?? 1)
  )
    throw new Error(
      "A control cage needs 3–192 vertices, 1–256 faces and 0–2 smoothing steps.",
    );
  if (
    !vs.every(
      (v) =>
        Array.isArray(v) &&
        v.length === 3 &&
        v.every((x) => Number.isFinite(x) && Math.abs(x) <= 12),
    )
  )
    throw new Error(
      "Cage points must be finite local coordinates within 12 units.",
    );
  const points = vs.map(vector),
    known = new Set();
  for (const f of fs) {
    if (
      !Array.isArray(f) ||
      f.length < 3 ||
      f.length > 8 ||
      new Set(f).size !== f.length ||
      f.some((i) => !Number.isInteger(i) || i < 0 || i >= vs.length)
    )
      throw new Error("A cage face needs 3–8 distinct vertex indices.");
    const id = [...f].sort((a, b) => a - b).join(",");
    if (known.has(id) || normal(f.map((i) => points[i])).lengthSq() < 1e-16)
      throw new Error("A cage face is repeated or has zero area.");
    known.add(id);
  }
  const { edges, faceRings, edgeRings } = net(vs, fs);
  for (let i = 0; i < vs.length; i++) {
    if (!faceRings[i].length)
      throw new Error("Every cage point must belong to a face.");
    const adjacent = edgeRings[i],
      boundary = adjacent.filter((e) => e.faces.length === 1);
    if (![0, 2].includes(boundary.length))
      throw new Error("An open cage edge must form a continuous border.");
    const pending = [faceRings[i][0]],
      found = new Set(pending),
      links = new Map(faceRings[i].map((f) => [f, []]));
    for (const e of adjacent)
      if (e.faces.length === 2) {
        const [a, b] = e.faces;
        links.get(a).push(b);
        links.get(b).push(a);
      }
    while (pending.length)
      for (const f of links.get(pending.pop()))
        if (!found.has(f)) {
          found.add(f);
          pending.push(f);
        }
    if (found.size !== faceRings[i].length)
      throw new Error("Separate surfaces may not meet at only one vertex.");
  }
  const creases = cage.creases ?? [];
  if (
    !Array.isArray(creases) ||
    creases.length > edges.size ||
    creases.some(
      (e) =>
        !Array.isArray(e) ||
        e.length !== 2 ||
        !e.every(Number.isInteger) ||
        !edges.has(key(...e)),
    ) ||
    new Set(creases.map((e) => key(...e))).size !== creases.length
  )
    throw new Error("Choose existing, distinct cage edges for creases.");
  return cage;
}
export function cubeCage() {
  return {
    vertices: [
      [-0.5, -0.5, -0.5],
      [0.5, -0.5, -0.5],
      [0.5, 0.5, -0.5],
      [-0.5, 0.5, -0.5],
      [-0.5, -0.5, 0.5],
      [0.5, -0.5, 0.5],
      [0.5, 0.5, 0.5],
      [-0.5, 0.5, 0.5],
    ],
    faces: [
      [4, 5, 6, 7],
      [1, 0, 3, 2],
      [0, 4, 7, 3],
      [5, 1, 2, 6],
      [7, 6, 2, 3],
      [0, 1, 5, 4],
    ],
    levels: 1,
  };
}
function subdivide(vertices, faces, creases) {
  const { edges, faceRings, edgeRings } = net(vertices, faces);
  const centers = faces.map((face) => average(face.map((i) => vertices[i])));
  const sharp = new Set(creases.map((e) => key(...e)));
  const out = vertices.map((p, i) => {
    const ring = edgeRings[i],
      neighbors = ring
        .filter((e) => e.faces.length === 1 || sharp.has(key(e.a, e.b)))
        .map((e) => vertices[e.a === i ? e.b : e.a]);
    if (neighbors.length > 2) return p.clone();
    if (neighbors.length === 2)
      return p
        .clone()
        .multiplyScalar(0.75)
        .addScaledVector(neighbors[0], 0.125)
        .addScaledVector(neighbors[1], 0.125);
    const n = faceRings[i].length,
      F = average(faceRings[i].map((f) => centers[f])),
      R = average(
        ring.map((e) => vertices[e.a].clone().lerp(vertices[e.b], 0.5)),
      );
    return F.addScaledVector(R, 2)
      .addScaledVector(p, n - 3)
      .divideScalar(n);
  });
  const nextSharp = [];
  for (const [id, e] of edges) {
    const mid = average([vertices[e.a], vertices[e.b]]);
    if (e.faces.length === 2 && !sharp.has(id))
      mid.lerp(average(e.faces.map((f) => centers[f])), 0.5);
    e.index = out.push(mid) - 1;
    if (sharp.has(id)) nextSharp.push([e.a, e.index], [e.index, e.b]);
  }
  const start = out.length;
  out.push(...centers);
  const quads = [];
  faces.forEach((f, j) =>
    f.forEach((a, i) =>
      quads.push([
        a,
        edges.get(key(a, f[(i + 1) % f.length])).index,
        start + j,
        edges.get(key(f[(i + f.length - 1) % f.length], a)).index,
      ]),
    ),
  );
  return { vertices: out, faces: quads, creases: nextSharp };
}
function orientShells(vertices, faces) {
  const { edges } = net(vertices, faces);
  const links = faces.map(() => []),
    boundary = new Set();
  for (const e of edges.values()) {
    const [a, b] = e.faces;
    if (b === undefined) boundary.add(a);
    else {
      links[a].push(b);
      links[b].push(a);
    }
  }
  const result = [...faces],
    visited = new Set();
  for (let i = 0; i < faces.length; i++) {
    if (visited.has(i)) continue;
    const pending = [i],
      component = [];
    visited.add(i);
    let closed = true,
      volume = 0;
    while (pending.length) {
      const id = pending.pop(),
        f = faces[id];
      component.push(id);
      if (boundary.has(id)) closed = false;
      for (let j = 1; j < f.length - 1; j++)
        volume += vertices[f[0]].dot(
          new Vector3().crossVectors(vertices[f[j]], vertices[f[j + 1]]),
        );
      for (const neighbor of links[id])
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          pending.push(neighbor);
        }
    }
    if (closed && volume < 0)
      for (const id of component) result[id] = [...faces[id]].reverse();
  }
  return result;
}
function splitNormals(mesh, faceted) {
  if (!mesh.creases.length && !faceted) return mesh;
  const { faceRings, edgeRings } = net(mesh.vertices, mesh.faces);
  const sharp = new Set(mesh.creases.map((e) => key(...e)));
  const vertices = [],
    faces = mesh.faces.map((f) => new Array(f.length));
  for (let i = 0; i < mesh.vertices.length; i++) {
    const links = new Map(faceRings[i].map((f) => [f, []]));
    if (!faceted)
      for (const e of edgeRings[i])
        if (e.faces.length === 2 && !sharp.has(key(e.a, e.b))) {
          const [a, b] = e.faces;
          links.get(a).push(b);
          links.get(b).push(a);
        }
    const remaining = new Set(faceRings[i]);
    while (remaining.size) {
      const start = remaining.values().next().value,
        pending = [start],
        idx = vertices.push(mesh.vertices[i]) - 1;
      remaining.delete(start);
      while (pending.length) {
        const f = pending.pop();
        faces[f][mesh.faces[f].indexOf(i)] = idx;
        for (const n of links.get(f)) if (remaining.delete(n)) pending.push(n);
      }
    }
  }
  return { vertices, faces };
}
export function cageGeometry(cage, controlUV) {
  let mesh = {
    vertices: cage.vertices.map(vector),
    faces: cage.faces,
    creases: cage.creases ?? [],
  };
  mesh.faces = orientShells(mesh.vertices, mesh.faces);
  let uv = controlUV?.length === mesh.vertices.length
    ? { vertices: controlUV.map(([u,v]) => new Vector3(u,v,0)), faces: mesh.faces, creases: mesh.creases }
    : null;
  let source = mesh.faces.map((_, i) => i);
  for (let i = 0; i < (cage.levels ?? 1); i++) {
    source = mesh.faces.flatMap((f, j) => f.map(() => source[j]));
    if (uv) uv = subdivide(uv.vertices, uv.faces, uv.creases);
    mesh = subdivide(mesh.vertices, mesh.faces, mesh.creases);
  }
  if (uv) uv = splitNormals(uv, cage.levels === 0);
  mesh = splitNormals(mesh, cage.levels === 0);
  const index = [],
    owners = [];
  for (const [fi, f] of mesh.faces.entries()) {
    const points = f.map((i) => mesh.vertices[i]),
      n = normal(points);
    const abs = [Math.abs(n.x), Math.abs(n.y), Math.abs(n.z)],
      axis = abs.indexOf(Math.max(...abs));
    const projected = points.map((p) =>
      axis === 0
        ? new Vector2(p.y, p.z)
        : axis === 1
          ? new Vector2(p.z, p.x)
          : new Vector2(p.x, p.y),
    );
    for (const [a, b, c] of ShapeUtils.triangulateShape(projected, [])) {
      owners.push(source[fi]);
      if (n.getComponent(axis) < 0) index.push(f[c], f[b], f[a]);
      else index.push(f[a], f[b], f[c]);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new Float32BufferAttribute(
      mesh.vertices.flatMap((v) => v.toArray()),
      3,
    ),
  );
  geometry.setAttribute(
    "uv",
    new Float32BufferAttribute(
      uv ? uv.vertices.flatMap(v => [v.x,v.y]) : mesh.vertices.flatMap((v) => [v.x + 0.5, v.y + 0.5]),
      2,
    ),
  );
  geometry.cageFaces = owners;
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  return geometry;
}
function selected(cage, fi) {
  if (!Number.isInteger(fi) || !cage.faces[fi])
    throw new Error("Select an existing cage face.");
  return cage.faces[fi];
}
function collar(cage, fi, inset, distance) {
  const face = selected(cage, fi),
    points = face.map((i) => vector(cage.vertices[i])),
    centre = average(points);
  const travel = normal(points).normalize().multiplyScalar(distance);
  const next = points.map(
    (p) => cage.vertices.push(p.lerp(centre, inset).add(travel).toArray()) - 1,
  );
  face.forEach((a, i) => {
    const j = (i + 1) % face.length;
    cage.faces.push([a, face[j], next[j], next[i]]);
  });
  cage.faces[fi] = next;
}
export function editCage(cage, action) {
  const next = structuredClone(checkCage(cage));
  next.faces = orientShells(next.vertices.map(vector), next.faces);
  const fi = action.face,
    face = selected(next, fi);
  switch (action.kind) {
    case "inset":
    case "extrude": {
      const amount = action.amount ?? (action.kind === "inset" ? 0.3 : 0.25);
      if (
        !Number.isFinite(amount) ||
        (action.kind === "inset"
          ? amount <= 0 || amount >= 0.95
          : Math.abs(amount) < 0.001 || Math.abs(amount) > 4)
      )
        throw new Error(
          "Choose a nonzero extrusion or an inset between 0 and .95.",
        );
      collar(
        next,
        fi,
        action.kind === "inset" ? amount : 0,
        action.kind === "extrude" ? amount : 0,
      );
      break;
    }
    case "tunnel": {
      const second = selected(next, action.to);
      if (face.length !== second.length || face.some((i) => second.includes(i)))
        throw new Error(
          "Choose two separated faces with the same number of corners.",
        );
      const inset = action.inset ?? 0.36;
      if (!Number.isFinite(inset) || inset <= 0 || inset >= 0.95)
        throw new Error("The tunnel inset must be between 0 and .95.");
      collar(next, fi, inset, 0);
      collar(next, action.to, inset, 0);
      const a = next.faces[fi],
        b = [...next.faces[action.to]].reverse(),
        N = a.length;
      const costs = b.map((_, s) =>
        a.reduce(
          (total, v, i) =>
            total +
            vector(next.vertices[v]).distanceToSquared(
              vector(next.vertices[b[(i + s) % N]]),
            ),
          0,
        ),
      );
      const shift = costs.indexOf(Math.min(...costs));
      const walls = a.map((v, i) => [
        v,
        a[(i + 1) % N],
        b[(i + 1 + shift) % N],
        b[(i + shift) % N],
      ]);
      next.faces[fi] = walls[0];
      next.faces[action.to] = walls[1];
      next.faces.push(...walls.slice(2));
      break;
    }
    case "crease": {
      const list = new Map((next.creases ?? []).map((e) => [key(...e), e]));
      const edges = face.map((v, i) => [v, face[(i + 1) % face.length]]);
      const remove = edges.every((e) => list.has(key(...e)));
      for (const edge of edges) {
        if (remove) list.delete(key(...edge));
        else list.set(key(...edge), edge);
      }
      next.creases = [...list.values()];
      break;
    }
    default:
      throw new Error("Unknown control cage edit.");
  }
  return checkCage(next);
}
