import { readFileSync } from "node:fs";

export function readGlb(file) {
  const data = readFileSync(file),
    jsonLength = data.readUInt32LE(12),
    json = JSON.parse(data.subarray(20, 20 + jsonLength).toString("utf8")),
    bin = data.subarray(28 + jsonLength);
  const view = (index, Type, width) => {
    const a = json.accessors[index],
      v = json.bufferViews[a.bufferView],
      start = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
    return new Type(bin.buffer.slice(bin.byteOffset + start, bin.byteOffset + start + a.count * width * Type.BYTES_PER_ELEMENT));
  };
  const parts = [];
  for (const mesh of json.meshes)
    for (const p of mesh.primitives) {
      const component = json.accessors[p.indices].componentType;
      parts.push({
        material: json.materials[p.material].name,
        positions: view(p.attributes.POSITION, Float32Array, 3),
        uvs: view(p.attributes.TEXCOORD_0, Float32Array, 2),
        normals: view(p.attributes.NORMAL, Float32Array, 3),
        indices: view(p.indices, component === 5125 ? Uint32Array : Uint16Array, 1),
      });
    }
  const count = parts.reduce((n, p) => n + p.positions.length, 0),
    positions = new Float32Array(count),
    indices = [];
  let at = 0;
  for (const p of parts) {
    positions.set(p.positions, at);
    for (const i of p.indices) indices.push(i + at / 3);
    at += p.positions.length;
  }
  return { json, parts, positions, indices: Uint32Array.from(indices) };
}
