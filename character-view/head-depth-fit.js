import { Vector3 } from "three";

const directions = [[0,0,1],[1,0,0],[-1,0,0]].map(d => new Vector3(...d));

// One visible head vertex per small square, from the front and both profiles.
// Choosing the outermost vertex before checking the normal excludes most
// interior eyelid, nostril and mouth vertices from the projected constraints.
export function headDepthSamples(surface, direction) {
  const head = surface.names.indexOf("head"), p = surface.positions;
  const spacing = 0.009 * surface.height / 1.72;
  const rows = [];
  for (const view of directions) {
    if (direction && direction.dot(view) < 0.55) continue;
    const horizontal = view.z ? 0 : 2;
    const cells = new Map();
    for (let i=0; i<surface.bodyVertices; i++) {
      if (surface.boneIndices[i*4] !== head) continue;
      const j=i*3, u=Math.round(p[j+horizontal]/spacing), v=Math.round(p[j+1]/spacing);
      const key = u + "," + v, depth = view.x*p[j] + view.z*p[j+2];
      const old = cells.get(key);
      if (!old || depth > old.depth) cells.set(key,{index:i,depth});
    }
    for (const {index} of cells.values()) rows.push({index,view});
  }
  return rows;
}

export function matchHeadDepth(samples, surface, normals, tree) {
  const hits = [], p = new Vector3(), normal = new Vector3(), delta = new Vector3();
  for (const {index,view} of samples) {
    normal.fromArray(normals,index*3);
    if (normal.dot(view) < 0.38) continue;
    p.fromArray(surface.positions,index*3);
    const hit = tree.fromView(p,view,0.05*surface.height/1.72);
    if (!hit || hit.normal.dot(view) < 0.32 || hit.normal.dot(normal) < 0.45) continue;
    const error = delta.subVectors(hit.point,p).dot(hit.normal);
    hits.push({index,normal:hit.normal,error,weight:Math.min(1,.018/Math.max(.0001,Math.abs(error)))});

  }
  return hits;
}
