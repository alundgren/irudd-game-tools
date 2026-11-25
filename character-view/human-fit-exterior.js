import { BufferAttribute, BufferGeometry } from "three";
import { mouthLining } from "./human-mouth.js";
import { eyeOpenings } from "./human-fit-eyes.js";

const byTopology = new WeakMap();

// An external scan can observe the lips, but cannot observe the bag of mouth
// lining behind them. A vertex shared by the lining and the outer lip belongs
// to the observed surface and must remain available to the artist.
// The same holds for the lining of each eye socket behind the lids. Fitted, it is
// drawn forward onto the scan's lids or eyeball and takes the eyeball with it.
export function exteriorSkin(surface) {
  if (byTopology.has(surface.uvFaces)) return byTopology.get(surface.uvFaces);
  const chart = new BufferGeometry();
  chart.setAttribute("uv", new BufferAttribute(surface.uv, 2, true));
  const corners = surface.bodyTriangles * 3;
  chart.setIndex(new BufferAttribute(surface.uvFaces.subarray(0, corners), 1));
  const lining = mouthLining(chart);
  const exterior = new Uint8Array(surface.bodyVertices);
  for (let i = 0; i < corners; i++) {
    if (!lining[surface.uvFaces[i]]) exterior[surface.indices[i]] = 1;
  }
  chart.dispose();
  const sockets = eyeOpenings(surface)?.lining;
  if (sockets) for (let v = 0; v < exterior.length; v++) if (sockets[v]) exterior[v] = 0;
  byTopology.set(surface.uvFaces, exterior);
  return exterior;
}
