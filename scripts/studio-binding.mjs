import { studioBinding } from "../character-view/human-studio-head.js";

const { vertices, shares, rest } = studioBinding();
const entries = { bindingVertices: Uint16Array.from(vertices), bindingShares: shares, bindingRest: rest };
process.stdout.write(JSON.stringify(Object.fromEntries(Object.entries(entries).map(([name, data]) =>
  [name, Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("base64")]))));
