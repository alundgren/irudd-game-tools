import { Vector3 } from "three";

// Each row goes counterclockwise around the aperture, viewed from outside.
// Closed rows form a skin rim. The other shapes are capped on the back.
function surface(rows, closed = false) {
  const n = rows[0].length;
  const vertices = rows.flat().map(p => p.toArray());
  const faces = [];
  for (let i = 0; i < (closed ? rows.length : rows.length - 1); i++) {
    const next = (i + 1) % rows.length;
    for (let j = 0; j < n; j++) {
      const k = (j + 1) % n;
      faces.push([i*n+j, i*n+k, next*n+k, next*n+j]);
    }
  }
  if (!closed) {
    for (const i of [0, rows.length-1]) {
      const centre = rows[i].reduce((a,p) => a.add(p), new Vector3()).divideScalar(n);
      const v = vertices.push(centre.toArray())-1;
      for (let j=0; j<n; j++) {
        const a=i*n+j, b=i*n+(j+1)%n;
        faces.push(i === 0 ? [v,b,a] : [v,a,b]);
      }
    }
  }
  return { vertices, faces };
}

function ring(sample) {
  return Array.from({ length: 16 }, (_, i) => {
    const angle = i * Math.PI / 8;
    return sample(Math.cos(angle), Math.sin(angle));
  });
}

// Model the visible lens and the fold of skin around it in the same frame.
// The foot of the fold follows the actual skull, including the cheek and temple.
export function creatureOrbit({head, gaze, up, side, seatOnSkull}) {
  const horizontal = new Vector3().crossVectors(up,gaze).normalize();
  const vertical = new Vector3().crossVectors(gaze,horizontal).normalize();
  const insect = head.snout === "mandibles";
  const bird = head.snout === "beak" || head.snout === "bill";
  const grazer = head.eyePlace === "side" && head.snout === "muzzle" && head.teeth < 4;
  const tall = insect ? 1 : bird ? .86 : grazer ? .63 : .76;
  const wide = insect ? .9 : bird ? .96 : 1.08;
  const slope = insect ? .22 : bird ? .07 : .1 - head.brow * .21;
  const bulge = insect ? .68 : .44;
  const frame = (x,y,z) => horizontal.clone().multiplyScalar(x*wide)
    .addScaledVector(vertical,y*tall + side*x*slope).addScaledVector(gaze,z);
  const almond = x => 1-(insect || bird ? .08 : .31)*x*x;
  const lens = (x,y) => .13 + bulge*(1-x*x-y*y);
  const eyeRow = (r,z) => ring((x,y)=>frame(r*x,r*y*almond(x),z ?? lens(r*x,r*y)));
  const eye = surface([eyeRow(.82,-.64),eyeRow(1,-.06),eyeRow(1,.15),
    eyeRow(.82,lens(.82,0)),eyeRow(.52,lens(.52,0)),eyeRow(.18,lens(.18,0))]);
  const pupilWidth = grazer ? .45 : bird ? .28 : .24;
  const pupilHeight = grazer ? .19 : bird ? .31 : .40;
  // Coloured lens and pupil lie on nested curved surfaces. A back row
  // overlaps the lens so neither piece detaches when the export is reduced.
  function disc(w,h,z) {
    const row=(r,dz)=>ring((a,b)=>{
      const x = r*a*w-.07*side, y = r*b*h;
      return frame(x,y,lens(x,y)+dz);
    });
    return surface([row(.97,z-.095),row(1,z),row(.78,z+.012),row(.27,z+.016)]);
  }
  const rim = ring((x,y)=>frame(1.28*x,1.29*y*almond(x),-.50));
  const outer = rim.map(p=>seatOnSkull ? seatOnSkull(p) : p);
  const lip = (scale,offset) => ring((x,y)=>{
    const upper = Math.max(0,y), lid = head.lids*upper*.48;
    return frame(scale*x,scale*y*almond(x)-lid,offset + upper*(.055+.12*head.brow));
  });
  return {
    eye,
    iris: insect ? null : disc(bird ? .72 : .66, bird ? .81 : .85, .042),
    pupil: insect ? null : disc(pupilWidth,pupilHeight,.098),
    rim: surface([outer,lip(1.18,.04),lip(.96,.24),lip(.91,.19),
      lip(.94,-.18),outer.map(p=>p.clone().addScaledVector(gaze,-.10))],true)
  };
}
