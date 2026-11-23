import { Box3, MathUtils, Matrix4, Triangle, Vector3 } from "three";

export function validSurfaceJoin(part) {
  const join = part.surfaceJoin;
  return (
    !!part.parent &&
    join &&
    Number.isFinite(join.depth) &&
    join.depth >= 0.001 &&
    join.depth <= 0.08 &&
    ((part.shape === "cage" &&
      join.end === undefined &&
      Array.isArray(join.faces) &&
      join.faces.length > 0 &&
      join.faces.length <= 32 &&
      new Set(join.faces).size === join.faces.length &&
      join.faces.every(
        (i) =>
          Number.isInteger(i) && i >= 0 && i < (part.cage?.faces?.length ?? 0),
      )) ||
      (part.shape === "sweep" &&
        join.faces === undefined &&
        ["first", "last", "both", "along"].includes(join.end)))
  );
}
function ownMeshes(root) {
  const result = [];
  function walk(node) {
    if (!node.visible || (node !== root && node.userData.partId)) return;
    if (node.isMesh && node.geometry.attributes.position) result.push(node);
    for (const c of node.children) walk(c);
  }
  walk(root);
  return result;
}
// Bounds are in world metres. Partition long carriers so fitting a small root
// only visits triangles that could improve the nearest surface point.
export function surfaceIndex(root) {
  const faces = [];
  for (const mesh of ownMeshes(root)) {
    const g = mesh.geometry,
      pos = g.attributes.position,
      idx = g.index;
    for (let i = 0, n = idx?.count ?? pos.count; i < n; i += 3) {
      const indices = [0, 1, 2].map((k) => (idx ? idx.getX(i + k) : i + k));
      const tri = new Triangle(
        ...indices.map((v) =>
          new Vector3()
            .fromBufferAttribute(pos, v)
            .applyMatrix4(mesh.matrixWorld),
        ),
      );
      if (tri.getArea() > 1e-11)
        faces.push({
          tri,
          indices,
          mesh,
          center: tri.getMidpoint(new Vector3()),
        });
    }
  }
  if (!faces.length) return null;
  function node(list) {
    const box = new Box3();
    for (const { tri } of list) {
      box.expandByPoint(tri.a);
      box.expandByPoint(tri.b);
      box.expandByPoint(tri.c);
    }
    if (list.length <= 18) return { box, list };
    const s = box.getSize(new Vector3()),
      axis = s.x > s.y && s.x > s.z ? "x" : s.y > s.z ? "y" : "z";
    list.sort((a, b) => a.center[axis] - b.center[axis]);
    const mid = list.length >> 1;
    return { box, children: [node(list.slice(0, mid)), node(list.slice(mid))] };
  }
  const tree = node(faces),
    tmp = new Vector3();
  return (point) => {
    let best = Infinity,
      face;
    const closest = new Vector3();
    function visit(n) {
      if (n.box.distanceToPoint(point) ** 2 > best) return;
      if (n.list) {
        for (const entry of n.list) {
          entry.tri.closestPointToPoint(point, tmp);
          const d = point.distanceToSquared(tmp);
          if (d < best) {
            best = d;
            closest.copy(tmp);
            face = entry;
          }
        }
      } else {
        const [a, b] = n.children;
        if (a.box.distanceToPoint(point) < b.box.distanceToPoint(point)) {
          visit(a);
          visit(b);
        } else {
          visit(b);
          visit(a);
        }
      }
    }
    visit(tree);
    return { point: closest, normal: face.tri.getNormal(new Vector3()), face };
  };
}
function rootIndices(geometry, join) {
  const ids = new Set();
  if (join.faces) {
    const faceSet = new Set(join.faces);
    geometry.cageFaces?.forEach((face, k) => {
      if (faceSet.has(face))
        for (let j = 0; j < 3; j++) ids.add(geometry.index.getX(k * 3 + j));
    });
  } else {
    const uv = geometry.attributes.uv;
    if (!uv) return ids;
    for (let i = 0; i < uv.count; i++) {
      const t = uv.getY(i);
      if (
        (join.end !== "last" && Math.abs(t) < 1e-6) ||
        (join.end !== "first" && Math.abs(1 - t) < 1e-6)
      )
        ids.add(i);
    }
  }
  return ids;
}
function bindingsFor(count, source, owner) {
  return source
    ? {
        ids: [...source.ids],
        first: source.first.slice(),
        second: source.second.slice(),
        weight: source.weight.slice(),
      }
    : {
        ids: [owner],
        first: new Uint8Array(count),
        second: new Uint8Array(count),
        weight: new Float32Array(count).fill(1),
      };
}
function addBinding(ranks, id, weight) {
  if (weight > 0) ranks.set(id, (ranks.get(id) ?? 0) + weight);
}
function readBinding(ranks, table, i, factor) {
  addBinding(ranks, table.ids[table.first[i]], factor * table.weight[i]);
  addBinding(ranks, table.ids[table.second[i]], factor * (1 - table.weight[i]));
}
function writeBinding(table, i, ranks) {
  const strongest = [...ranks].sort((a, b) => b[1] - a[1]).slice(0, 2);
  const [first, second = first] = strongest;
  const index = (id) => {
    let j = table.ids.indexOf(id);
    if (j < 0) {
      j = table.ids.length;
      table.ids.push(id);
    }
    return j;
  };
  table.first[i] = index(first[0]);
  table.second[i] = index(second[0]);
  table.weight[i] =
    strongest.length === 1 ? 1 : first[1] / (first[1] + second[1]);
}
function atCarrier(hit, carrier) {
  const table = hit.face.mesh.blendOwners,
    ranks = new Map();
  if (!table) ranks.set(carrier.userData.partId, 1);
  else {
    const bary = hit.face.tri.getBarycoord(hit.point, new Vector3());
    hit.face.indices.forEach((i, k) =>
      readBinding(ranks, table, i, Math.max(0, bary.getComponent(k))),
    );
  }
  return ranks;
}
// Textile piping, a fin ray or a raised stripe should follow the carrier along
// its full path. Translate each cross-section together to retain its thickness.
function seatStrip(mesh, carrier, join, nearest) {
  const g = mesh.geometry,
    pos = g.attributes.position,
    uv = g.attributes.uv;
  if (!uv) return;
  const rows = new Map(),
    world = [],
    inverse = mesh.matrixWorld.clone().invert();
  for (let i = 0; i < pos.count; i++) {
    const t = uv.getY(i);
    if (!rows.has(t)) rows.set(t, []);
    rows.get(t).push(i);
    world.push(
      new Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld),
    );
  }
  const table = bindingsFor(pos.count, null, carrier.userData.partId);
  for (const indices of rows.values()) {
    const mid = new Vector3();
    let count = 0;
    for (const i of indices)
      if (uv.getX(i) < 0.99999) {
        mid.add(world[i]);
        count++;
      }
    if (!count) continue;
    mid.divideScalar(count);
    const hit = nearest(mid);
    let radius = 0;
    for (const i of indices)
      radius = Math.max(
        radius,
        Math.abs(hit.normal.dot(world[i].clone().sub(mid))),
      );
    const offset = hit.point
      .clone()
      .addScaledVector(hit.normal, Math.max(0, radius - join.depth))
      .sub(mid);
    const ranks = atCarrier(hit, carrier);
    for (const i of indices) {
      const p = world[i].add(offset).applyMatrix4(inverse);
      pos.setXYZ(i, p.x, p.y, p.z);
      writeBinding(table, i, ranks);
    }
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  g.computeBoundingBox();
  g.computeBoundingSphere();
  mesh.blendOwners = table;
}
function seatBranch(mesh, carrier, part, nearest) {
  const geometry = mesh.geometry,
    pos = geometry?.attributes.position;
  if (!pos) return;
  const indices = rootIndices(geometry, part.surfaceJoin);
  if (!indices.size) return;
  const anchors = [],
    unique = new Set();
  let gap = 0;
  for (const i of indices) {
    const at = new Vector3()
      .fromBufferAttribute(pos, i)
      .applyMatrix4(mesh.matrixWorld);
    const key = at
      .toArray()
      .map((x) => Math.round(x * 1e6))
      .join(",");
    if (unique.has(key)) continue;
    unique.add(key);
    const hit = nearest(at),
      delta = hit.point
        .clone()
        .addScaledVector(hit.normal, -part.surfaceJoin.depth)
        .sub(at);
    gap = Math.max(gap, delta.length());
    anchors.push({ at, delta, binding: atCarrier(hit, carrier) });
  }
  geometry.computeBoundingBox();
  const extent = geometry.boundingBox
    .clone()
    .applyMatrix4(mesh.matrixWorld)
    .getSize(new Vector3())
    .length();
  const radius = Math.max(
    0.012,
    0.34 * extent,
    Math.min(gap * 1.25, 0.7 * extent),
  );
  const distances = new Float64Array(anchors.length),
    point = new Vector3(),
    delta = new Vector3(),
    inv = new Matrix4();
  function deform(node, owner) {
    owner = node.userData.partId ?? owner;
    if (node.isMesh && node.geometry.attributes.position) {
      const g = node.geometry,
        p = g.attributes.position,
        table = bindingsFor(p.count, node.blendOwners, owner);
      inv.copy(node.matrixWorld).invert();
      let touched = false;
      for (let i = 0; i < p.count; i++) {
        point.fromBufferAttribute(p, i).applyMatrix4(node.matrixWorld);
        let closest = 0,
          min = Infinity;
        for (let j = 0; j < anchors.length; j++) {
          const d = point.distanceToSquared(anchors[j].at);
          distances[j] = d;
          if (d < min) {
            min = d;
            closest = j;
          }
        }
        const reach = 1 - MathUtils.smoothstep(Math.sqrt(min), 0, radius);
        if (reach <= 0) continue;
        if (min < 1e-10) delta.copy(anchors[closest].delta);
        else {
          delta.set(0, 0, 0);
          let sum = 0;
          const scale = Math.max(min * 3, (radius * 0.08) ** 2);
          anchors.forEach((a, j) => {
            const rel = (distances[j] - min) / scale;
            if (rel > 8) return;
            const w = Math.exp(-rel);
            delta.addScaledVector(a.delta, w);
            sum += w;
          });
          delta.divideScalar(sum);
        }
        point.addScaledVector(delta, reach).applyMatrix4(inv);
        p.setXYZ(i, point.x, point.y, point.z);
        const ranks = new Map();
        readBinding(ranks, table, i, 1 - reach);
        for (const [id, w] of anchors[closest].binding)
          addBinding(ranks, id, reach * w);
        writeBinding(table, i, ranks);
        touched = true;
      }
      if (touched) {
        p.needsUpdate = true;
        g.computeVertexNormals();
        g.computeBoundingBox();
        g.computeBoundingSphere();
        node.blendOwners = table;
      }
    }
    for (const c of node.children) deform(c, owner);
  }
  deform(mesh, part.id);
}
export function fitSurfaceJoins(form, objects, afterFaceFits = false) {
  const byId = new Map(form.parts.map((p) => [p.id, p]));
  const late = (part) => {
    for (let node = part; node; node = byId.get(node.parent))
      if (node.rigidFaceAnchor || node.fibres) return true;
    return false;
  };
  const chosen = form.parts.filter(
    (p) => p.surfaceJoin && late(p) === afterFaceFits,
  );
  if (!chosen.length) return;
  function depth(p) {
    let n = 0;
    while (p?.parent) {
      n++;
      p = byId.get(p.parent);
    }
    return n;
  }
  chosen.sort((a, b) => depth(a) - depth(b));
  const indices = new Map();
  for (const part of chosen) {
    const mesh = objects.get(part.id),
      carrier = objects.get(part.parent);
    if (!mesh?.visible || !carrier?.visible) continue;
    mesh.updateWorldMatrix(true, true);
    carrier.updateWorldMatrix(true, true);
    if (!indices.has(carrier)) indices.set(carrier, surfaceIndex(carrier));
    const nearest = indices.get(carrier);
    if (!nearest) continue;
    if (part.surfaceJoin.end === "along")
      seatStrip(mesh, carrier, part.surfaceJoin, nearest);
    else seatBranch(mesh, carrier, part, nearest);
  }
}
