import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const [input, output] = process.argv.slice(2);
const lib = new URL("../../node_modules/three/examples/jsm/libs/draco/", import.meta.url);
const wrapper = await readFile(fileURLToPath(new URL("draco_wasm_wrapper.js", lib)), "utf8");
const factory = new Function("require", "__dirname", wrapper + "\nreturn DracoDecoderModule;")(
  createRequire(import.meta.url), fileURLToPath(lib));
const draco = await factory({ wasmBinary: await readFile(fileURLToPath(new URL("draco_decoder.wasm", lib))) });

const raw = await readFile(input);
const jsonLength = raw.readUInt32LE(12);
const doc = JSON.parse(raw.subarray(20, 20 + jsonLength).toString("utf8"));
const binary = raw.subarray(20 + jsonLength + 8);
const primitive = doc.meshes[0].primitives[0];
const extension = primitive.extensions?.KHR_draco_mesh_compression;
if (!extension) throw new Error("The first primitive is not Draco compressed.");
const view = doc.bufferViews[extension.bufferView];
const bytes = binary.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);

const decoder = new draco.Decoder(), mesh = new draco.Mesh();
const status = decoder.DecodeArrayToMesh(new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), bytes.byteLength, mesh);
if (!status.ok()) throw new Error("Draco decoding failed: " + status.error_msg());
const vertices = mesh.num_points(), faces = mesh.num_faces();
const attribute = decoder.GetAttributeByUniqueId(mesh, extension.attributes.POSITION);
const positionBytes = vertices * 3 * 4, indexBytes = faces * 3 * 4;
const positionPointer = draco._malloc(positionBytes), indexPointer = draco._malloc(indexBytes);
decoder.GetAttributeDataArrayForAllPoints(mesh, attribute, draco.DT_FLOAT32, positionBytes, positionPointer);
decoder.GetTrianglesUInt32Array(mesh, indexBytes, indexPointer);
await writeFile(output + ".positions.f32", Buffer.from(draco.HEAPU8.buffer, positionPointer, positionBytes));
await writeFile(output + ".indices.u32", Buffer.from(draco.HEAPU8.buffer, indexPointer, indexBytes));
console.log(JSON.stringify({ vertices, faces }));
