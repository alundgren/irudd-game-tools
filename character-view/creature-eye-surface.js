import { CanvasTexture, Float32BufferAttribute, SRGBColorSpace, Vector3 } from "three";

const textures = new Map();
const clamp = (v, lo, hi) => Math.max(lo,Math.min(hi,v));

// The staggered lattice follows the dome. Each lens has a separate curvature
// and a quiet edge. View-dependent highlights come from the scene lights.
function facet(x,y) {
  const spacing = .186, rowHeight = spacing*Math.sqrt(3)/2;
  const row = Math.round(y/rowHeight);
  let closest = Infinity, second = Infinity, dx = 0, dy = 0, variation = 0;
  for (let j=row-1; j<=row+1; j++) {
    const shift = (j & 1)*.5;
    const i = Math.round(x/spacing-shift);
    for (let k=i-1; k<=i+1; k++) {
      const u = x-(k+shift)*spacing, v = y-j*rowHeight, d = u*u+v*v;
      if (d >= closest) { second = Math.min(second,d); continue; }
      second = closest; closest = d; dx = u; dy = v;
      variation = Math.sin(k*27.7+j*13.5)*.5+.5;
    }
  }
  const edge = clamp((second-closest)/(.23*spacing*spacing),0,1);
  const body = .72+.19*edge+.12*variation;
  const spot = 1-.68*Math.exp(-((x-.08)**2+(y+.03)**2)/.095);
  const nx = dx/spacing*.69, ny = dy/spacing*.69;
  return [body*spot*.93, body*spot, body*spot*(.89+.11*variation), nx,ny];
}

function iris(x,y) {
  const r=Math.hypot(x,y), a=Math.atan2(y,x);
  const w=a+.026*Math.sin(7*a+3*r)+.033*Math.sin(4*a-4*r);
  const fibre=.5+.5*Math.sin(59*w+3*Math.sin(19*a)+r*2);
  const crypt=.5+.5*Math.sin(16*w+Math.sin(7*w)-r*7);
  const frill=Math.exp(-(((r-.50-.035*Math.sin(11*a))/.069)**2));
  const limbus=1-.61*clamp((r-.77)/.22,0,1);
  const value=limbus*(.73+.23*fibre+.14*crypt-.18*frill);
  return [value*(1+.12*(1-r)),value,value*(.96-.18*frill),0,0];
}

function artwork(kind) {
  if (textures.has(kind)) return textures.get(kind);
  if (typeof document === "undefined") return null;
  const size=128, canvas=document.createElement("canvas"), normals=document.createElement("canvas");
  for (const c of [canvas,normals]) { c.width=size; c.height=size; }
  const colour=canvas.getContext("2d"), relief=normals.getContext("2d");
  if (!colour?.createImageData || !relief?.putImageData) return null;
  const rgb=colour.createImageData(size,size), nrm=relief.createImageData(size,size);
  const compound=kind==="compound";
  for (let i=0; i<size*size; i++) {
    const x=((i%size+.5)/size-.5)*2, y=(.5-(Math.floor(i/size)+.5)/size)*2;
    const [r,g,b,nx,ny]=compound ? facet(x,y) : iris(x,y);
    rgb.data.set([255*r,255*g,255*b,255],i*4);
    nrm.data.set([127.5*(1+nx),127.5*(1+ny),127.5*(1+Math.sqrt(1-nx*nx-ny*ny)),255],i*4);
  }
  colour.putImageData(rgb,0,0); relief.putImageData(nrm,0,0);
  const map=new CanvasTexture(canvas); map.colorSpace=SRGBColorSpace; map.anisotropy=4;
  const normalMap=compound ? new CanvasTexture(normals) : null;
  const result={map,normalMap};
  textures.set(kind,result);
  return result;
}

export function finishCreatureEye(mesh, part, materials) {
  const kind=part.eyeSurface;
  const key=kind + "/" + part.color;
  if (!materials.has(key)) {
    const m=mesh.material.clone();
    m.roughness=kind==="compound" ? .32 : kind==="pupil" ? .16 : .24;
    if (kind==="iris" || kind==="compound") Object.assign(m,artwork(kind));
    materials.set(key,m);
  }
  mesh.material=materials.get(key);
  if (!mesh.material.map) return;
  // The equator is the first sixteen cage points, in anatomical order.
  // Its two diameters carry the texture through turning and hand sculpture.
  const ring=part.cage.vertices, vec=i=>new Vector3(...ring[i]);
  const u=vec(0).sub(vec(8)), v=vec(4).sub(vec(12));
  const centre=vec(0).lerp(vec(8),.5);
  const extentU=Math.max(u.length()/2,.001), extentV=Math.max(v.length()/2,.001);
  u.normalize(); v.addScaledVector(u,-v.dot(u)).normalize();
  const pos=mesh.geometry.attributes.position, uv=new Float32Array(pos.count*2);
  const p=new Vector3();
  for (let i=0; i<pos.count; i++) {
    p.fromBufferAttribute(pos,i).sub(centre);
    uv[i*2]=clamp(.5+.48*p.dot(u)/extentU,.005,.995);
    uv[i*2+1]=clamp(.5+.48*p.dot(v)/extentV,.005,.995);
  }
  mesh.geometry.setAttribute("uv",new Float32BufferAttribute(uv,2));
}
