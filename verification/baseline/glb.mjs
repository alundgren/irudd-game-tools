import { createHash } from "node:crypto";

const COMPONENT = { 5120: [Int8Array, 1], 5121: [Uint8Array, 1], 5122: [Int16Array, 2], 5123: [Uint16Array, 2], 5125: [Uint32Array, 4], 5126: [Float32Array, 4] };
const WIDTH = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

export function parseGlb(bytes) {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error("not a GLB");
  let offset = 12, json, bin;
  while (offset < buf.length) {
    const length = buf.readUInt32LE(offset), type = buf.readUInt32LE(offset + 4);
    const chunk = buf.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString("utf8"));
    else if (type === 0x004e4942) bin = chunk;
    offset += 8 + length;
  }
  return { json, bin, version: buf.readUInt32LE(4) };
}

export function readAccessor(gltf, bin, index) {
  const a = gltf.accessors[index];
  const [Type, size] = COMPONENT[a.componentType];
  const width = WIDTH[a.type];
  const out = new Type(a.count * width);
  if (a.bufferView === undefined) return { values: out, accessor: a };
  const view = gltf.bufferViews[a.bufferView];
  const base = (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const stride = view.byteStride ?? width * size;
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const read = { 5120: "getInt8", 5121: "getUint8", 5122: "getInt16", 5123: "getUint16", 5125: "getUint32", 5126: "getFloat32" }[a.componentType];
  for (let i = 0; i < a.count; i++)
    for (let k = 0; k < width; k++) out[i * width + k] = dv[read](base + i * stride + k * size, true);
  if (a.sparse) out.sparse = true;
  return { values: out, accessor: a };
}

const finite = (arr) => { for (const v of arr) if (!Number.isFinite(v)) return false; return true; };

export function glbSummary(bytes) {
  const { json: g, bin } = parseGlb(bytes);
  const problems = [];
  const digest = createHash("sha256");
  const accessorCache = new Map();
  const acc = (i) => { if (!accessorCache.has(i)) accessorCache.set(i, readAccessor(g, bin, i)); return accessorCache.get(i); };
  let triangles = 0, vertices = 0;
  const meshes = (g.meshes ?? []).map((m, mi) => {
    const targetNames = m.extras?.targetNames ?? [];
    const prims = m.primitives.map((p, pi) => {
      const pos = p.attributes.POSITION !== undefined ? acc(p.attributes.POSITION) : null;
      const count = pos?.accessor.count ?? 0;
      vertices += count;
      const idx = p.indices !== undefined ? g.accessors[p.indices].count : count;
      if ((p.mode ?? 4) === 4) triangles += idx / 3;
      for (const [name, i] of Object.entries(p.attributes)) {
        const a = acc(i);
        if (a.accessor.count !== count) problems.push(`mesh ${mi} prim ${pi} ${name} count ${a.accessor.count} != POSITION ${count}`);
        if (a.accessor.componentType === 5126 && !finite(a.values)) problems.push(`mesh ${mi} prim ${pi} ${name} has non-finite values`);
      }
      (p.targets ?? []).forEach((t, ti) => {
        for (const [name, i] of Object.entries(t)) {
          const a = acc(i);
          if (a.accessor.count !== count) problems.push(`mesh ${mi} prim ${pi} target ${ti} ${name} count mismatch`);
          if (!finite(a.values)) problems.push(`mesh ${mi} prim ${pi} target ${ti} ${name} non-finite`);
        }
      });
      if ((p.attributes.JOINTS_0 === undefined) !== (p.attributes.WEIGHTS_0 === undefined)) problems.push(`mesh ${mi} prim ${pi} has only one of JOINTS_0/WEIGHTS_0`);
      return { attributes: Object.keys(p.attributes).sort(), vertices: count, indices: idx, material: p.material ?? null, targets: (p.targets ?? []).length, mode: p.mode ?? 4 };
    });
    const nTargets = prims[0]?.targets ?? 0;
    if (prims.some((p) => p.targets !== nTargets)) problems.push(`mesh ${mi} primitives disagree on morph target count`);
    if (m.weights && m.weights.length !== nTargets) problems.push(`mesh ${mi} weights ${m.weights.length} != targets ${nTargets}`);
    if (targetNames.length && targetNames.length !== nTargets) problems.push(`mesh ${mi} targetNames ${targetNames.length} != targets ${nTargets}`);
    return { name: m.name ?? null, primitives: prims, targetNames };
  });
  const nodes = g.nodes ?? [];
  const skins = (g.skins ?? []).map((s, si) => {
    if (s.inverseBindMatrices !== undefined) {
      const ibm = acc(s.inverseBindMatrices);
      if (ibm.accessor.count !== s.joints.length) problems.push(`skin ${si} inverseBindMatrices ${ibm.accessor.count} != joints ${s.joints.length}`);
      if (!finite(ibm.values)) problems.push(`skin ${si} inverseBindMatrices non-finite`);
    }
    return { name: s.name ?? null, joints: s.joints.length, jointNames: s.joints.map((j) => nodes[j]?.name ?? null) };
  });
  nodes.forEach((n, ni) => {
    if (n.mesh === undefined || n.skin === undefined) return;
    const limit = g.skins[n.skin].joints.length;
    for (const p of g.meshes[n.mesh].primitives) {
      if (p.attributes.JOINTS_0 === undefined) continue;
      const j = acc(p.attributes.JOINTS_0).values;
      let max = 0; for (const v of j) if (v > max) max = v;
      if (max >= limit) problems.push(`node ${ni} joint index ${max} >= skin joints ${limit}`);
    }
  });
  const animations = (g.animations ?? []).map((a, ai) => {
    let duration = 0;
    for (const c of a.channels) if (nodes[c.target.node] === undefined) problems.push(`animation ${ai} targets missing node ${c.target.node}`);
    for (const s of a.samplers) {
      const t = acc(s.input).values;
      for (let i = 1; i < t.length; i++) if (!(t[i] > t[i - 1])) { problems.push(`animation ${ai} sampler times not increasing`); break; }
      duration = Math.max(duration, t[t.length - 1] ?? 0);
      if (!finite(acc(s.output).values)) problems.push(`animation ${ai} sampler output non-finite`);
    }
    return { name: a.name ?? null, channels: a.channels.length, paths: [...new Set(a.channels.map((c) => c.target.path))].sort(), duration: Math.round(duration * 1e4) / 1e4 };
  });
  const images = (g.images ?? []).map((im) => {
    const view = im.bufferView !== undefined ? g.bufferViews[im.bufferView] : null;
    const data = view ? bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength) : null;
    return { name: im.name ?? null, mimeType: im.mimeType ?? null, bytes: data?.length ?? 0, sha256: data ? createHash("sha256").update(data).digest("hex") : null, uri: im.uri ? im.uri.slice(0, 40) : null };
  });
  for (let i = 0; i < (g.accessors ?? []).length; i++) {
    const { values } = acc(i);
    digest.update(String(i) + ":" + values.constructor.name + ":");
    digest.update(Buffer.from(values.buffer, values.byteOffset, values.byteLength));
  }
  const strip = JSON.parse(JSON.stringify(g));
  delete strip.buffers; delete strip.bufferViews;
  if (strip.asset) delete strip.asset.generator;
  for (const im of strip.images ?? []) delete im.bufferView;
  for (const a of strip.accessors ?? []) { delete a.bufferView; delete a.byteOffset; }
  digest.update(JSON.stringify(strip));
  const scenes = (g.scenes ?? []).map((s) => ({ name: s.name ?? null, nodes: s.nodes?.length ?? 0, extras: s.extras ?? null }));
  return {
    bytes: bytes.length,
    asset: { version: g.asset?.version, generator: g.asset?.generator ?? null, copyright: g.asset?.copyright ?? null, extras: g.asset?.extras ?? null },
    extensionsUsed: g.extensionsUsed ?? [],
    extensionsRequired: g.extensionsRequired ?? [],
    counts: { scenes: scenes.length, nodes: nodes.length, meshes: meshes.length, primitives: meshes.reduce((n, m) => n + m.primitives.length, 0), materials: (g.materials ?? []).length, textures: (g.textures ?? []).length, images: images.length, skins: skins.length, joints: skins.reduce((n, s) => n + s.joints, 0), morphTargets: meshes.reduce((n, m) => n + (m.primitives[0]?.targets ?? 0), 0), animations: animations.length, triangles, vertices },
    scene: g.scene ?? 0,
    scenes,
    materials: (g.materials ?? []).map((m) => ({ name: m.name ?? null, alphaMode: m.alphaMode ?? "OPAQUE", doubleSided: m.doubleSided ?? false, maps: Object.keys(m).filter((k) => k.endsWith("Texture")).concat(Object.keys(m.pbrMetallicRoughness ?? {}).filter((k) => k.endsWith("Texture"))).sort(), extensions: Object.keys(m.extensions ?? {}) })),
    meshes: meshes.map((m) => ({ name: m.name, primitives: m.primitives.length, targetNames: m.targetNames })),
    skins,
    animations,
    images,
    integrity: problems.length ? problems : "ok",
    contentDigest: digest.digest("hex"),
  };
}

if (process.argv[1] && import.meta.url === `file:///${process.argv[1].replaceAll("\\", "/").replace(/^\//, "")}`) {
  const { readFile } = await import("node:fs/promises");
  for (const f of process.argv.slice(2)) console.log(JSON.stringify({ file: f, ...glbSummary(await readFile(f)) }));
}
