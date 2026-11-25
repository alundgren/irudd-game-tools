import { Vector3 } from "three";

// Ordered pairs on the upper and lower inner lip rims of the editor's fixed MPFB cage.
// The target can have arbitrary topology. Its lip crease is located from its surface.
const rims = [
  [425,426],[416,438],[469,475],[470,481],[472,487],[474,523],
  [7228,7242],[7226,7236],[7225,7230],[7176,7198],[7185,7186],
];
const front = new Vector3(0,0,1), up = new Vector3(0,1,0);

export function lipCreaseSamples(surface,tree) {
  if (tree.observedDirection && tree.observedDirection.dot(front) < .7) return [];
  const scale = surface.height/1.72, step = .00065*scale;
  const top = new Vector3(), bottom = new Vector3(), point = new Vector3();
  // Locate the forward tip of the reference nose when it has a clear
  // profile. This prevents the fold under the lower lip from attracting the
  // entire mouth when the starting face is longer than the reference.
  point.fromArray(surface.positions,3*297);
  const noseY = point.y, nose = [];
  for (let k=-33; k<=33; k++) {
    point.y = noseY + k*.0015*scale;
    const hit = tree.fromView(point,front,.064*scale);
    if (hit) nose.push({y:point.y,z:hit.point.z});
  }
  // A flush upper lip can be closer to the starting nose than the real tip.
  // Require the nose to project above both the philtrum and upper bridge,
  // with observed skin on each side. An open cut at the search limit is
  // not a tip, and a small mouth groove alone cannot establish one.
  const peaks = nose.filter(({y,z}, i) => {
    const below = nose.filter(p=>p.y < y-.005*scale && p.y > y-.020*scale);
    const above = nose.filter(p=>p.y > y+.005*scale && p.y < y+.020*scale);
    return i>0 && i+1<nose.length && z>=nose[i-1].z && z>=nose[i+1].z &&
      below.length >= 4 && above.length >= 4 &&
      z - Math.min(...below.map(p=>p.z)) > .007*scale &&
      z - Math.min(...above.map(p=>p.z)) > .002*scale;
  });
  const peak = peaks.reduce((best,p) => !best || p.z>best.z ? p : best, null);
  const tip = peak?.y ?? null;
  const results = [];
  for (const [upper,lower] of rims) {
    top.fromArray(surface.positions,3*upper);
    bottom.fromArray(surface.positions,3*lower);
    point.addVectors(top,bottom).multiplyScalar(.5);
    const mid = tip === null ? point.y : Math.max(tip-.038*scale,Math.min(tip-.026*scale,point.y));
    const samples = [];
    for (let i=-23; i<=23; i++) {
      point.y = mid+i*step;
      const hit = tree.fromView(point,front,.045*scale);
      samples.push(hit ? hit.point.z : NaN);
    }
    let strongest = .0009*scale, row = -1, open = false;
    for (let i=7; i<samples.length-7; i++) {
      const lowerLip = Math.max(...samples.slice(i-7,i-1));
      const upperLip = Math.max(...samples.slice(i+2,i+8));
      const relief = Math.min(lowerLip,upperLip)-samples[i];
      if (relief > .009*scale || (!Number.isFinite(samples[i]) &&
          Number.isFinite(lowerLip) && Number.isFinite(upperLip))) open = true;
      // A deep cavity, a hole, or an indistinct contour is insufficient
      // evidence for a closed mouth.
      const y = mid+(i-23)*step;
      if (tip !== null && (tip-y < .017*scale || tip-y > .042*scale)) continue;
      if (relief < .008*scale && relief > strongest) {
        strongest = relief;
        row = i;
      }
    }
    if (open || row < 0) continue;
    const y = mid+(row-23)*step;
    results.push({upper,lower,y});
  }
  // Require a continuous identifiable crease before steering the lip rims.
  if (results.length < 7) return [];
  const hits = [];
  for (let i=0;i<results.length;i++) {
    const {upper,lower,y} = results[i];
    const neighbors=results.slice(Math.max(0,i-1),i+2);
    if (neighbors.some(r=>Math.abs(r.y-y)>.005*scale)) continue;
    for (const [index,clearance] of [[upper,.00018],[lower,-.00018]]) {
      const error=y+clearance*scale-surface.positions[3*index+1];
      hits.push({index,normal:up,error,weight:15});
    }
  }
  return hits;
}

// Depth along the broad skin surface scarcely changes when a thin mouth opens.
// Use the measured crease positions directly for a final bounded adjustment.
export function fitLipContact(params, surface, tree, evaluate) {
  const samples = lipCreaseSamples(surface,tree).map(({index,error}) =>
    ({index, y:surface.positions[index*3+1]+error}));
  if (samples.length < 14) return surface;
  const keys = ["mouthLevel","mouthCorners","lipParting"];
  const start = Object.fromEntries(keys.map(k=>[k,params[k]??0]));
  function cost(trial, next) {
    let sum = 0;
    for (const {index,y} of samples) sum += (next.positions[index*3+1]-y)**2;
    const prior = keys.reduce((s,k)=>s+((trial[k]??0)-start[k])**2,0);
    return sum/samples.length + prior*(.0004*surface.height/1.72)**2;
  }
  let best = cost(params,surface);
  for (const step of [.4,.2,.1]) {
    for (const key of keys) {
      const center = params[key]??0;
      for (const value of [Math.max(-1,center-step),Math.min(1,center+step)]) {
        if (value===center) continue;
        const trial = {...params,[key]:value}, next = evaluate(trial);
        const score = cost(trial,next);
        if (score < best) { best = score; params[key] = value; surface = next; }
      }
    }
  }
  return surface;
}
