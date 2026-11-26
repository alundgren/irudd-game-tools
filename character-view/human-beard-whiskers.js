import { Vector3 } from "three";
import { randomStream } from "./random.js";

export function addBeardWhiskers({ pos, norm, tex, index, moved }, chart, scale, full) {
  const originalPoints = pos.length / 3;
  const triangles = index.length / 3;
  const cumulative = new Float64Array(triangles);
  const a = new Vector3(), b = new Vector3(), c = new Vector3();
  let area = 0;
  for (let t = 0; t < triangles; t++) {
    a.fromArray(pos, 3 * index[3*t]);
    b.fromArray(pos, 3 * index[3*t+1]).sub(a);
    c.fromArray(pos, 3 * index[3*t+2]).sub(a);
    area += b.cross(c).length();
    cumulative[t] = area;
  }
  const random = randomStream(269311);
  const root = new Vector3(), normal = new Vector3(), down = new Vector3(), side = new Vector3();
  const count = full ? 245 : 175;
  for (let n = 0; n < count; n++) {
    const at = (n + random()) * area / count;
    let lo = 0, hi = triangles - 1;
    while (lo < hi) {
      const mid = (lo+hi) >>> 1;
      if (cumulative[mid] < at) lo = mid+1;
      else hi = mid;
    }
    const ids = index.slice(3*lo, 3*lo+3);
    const r = Math.sqrt(random()), s = random(), weights = [1-r, r*(1-s), r*s];
    root.set(0,0,0); normal.set(0,0,0);
    let u = 0, v = 0;
    ids.forEach((id,j) => {
      root.addScaledVector(a.fromArray(pos,3*id),weights[j]);
      normal.addScaledVector(a.fromArray(norm,3*id),weights[j]);
      u += tex[2*id]*weights[j]; v += tex[2*id+1]*weights[j];
    });
    const cell = t => Math.min(31,Math.max(0,Math.floor(32*t)));
    if (chart.coverage[32*cell(1-v)+cell(u)] < 85) continue;
    normal.normalize();
    down.set((random()-.5)*.32,-1,.21* Math.abs(normal.x));
    down.addScaledVector(normal,-down.dot(normal)).normalize();
    side.crossVectors(normal,down).normalize();
    const length = scale*(full ? .011 : .0055)*(.7+.8*random());
    const width = length*(.48+.3*random()), lift = length*(.24+.22*random());
    const [x,y,w,h] = chart.fans[Math.floor(random()*chart.fans.length)];
    const offset = pos.length/3;
    const shifts = moved.map(values => ids.reduce((sum,id,j) =>
      sum.addScaledVector(a.fromArray(values,3*id),weights[j]), new Vector3()));
    for (const run of [0,.50,1]) {
      for (const sign of [-1,1]) {
        a.copy(root).addScaledVector(down,length*run)
          .addScaledVector(side,sign*.5*width*(1-.20*run))
          .addScaledVector(normal,scale*.00055+lift*Math.sin(run*1.65));
        pos.push(a.x,a.y,a.z);
        norm.push(normal.x,normal.y,normal.z);
        tex.push(x+(sign<0 ? 0 : w), y-h*run);
        shifts.forEach((d,j) => moved[j].push(d.x,d.y,d.z));
      }
    }
    index.push(offset,offset+2,offset+1,offset+1,offset+2,offset+3,
      offset+2,offset+4,offset+3,offset+3,offset+4,offset+5);
  }
  for (let i = 0; i < originalPoints; i++) tex[2*i] *= chart.mainWidth;
}
