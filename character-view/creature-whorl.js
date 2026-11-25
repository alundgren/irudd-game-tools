import { Color, Float32BufferAttribute, Vector3 } from "three";

// Read the growth direction from the eight-sided sections of the artist's
// cage. A subdivided vertex can belong to more than one control face.
export function finishWhorl(mesh,part,plain) {
  const g=mesh.geometry, positions=g.attributes.position, normal=g.attributes.normal;
  const controls=part.cage.vertices.map(p=>new Vector3(...p)), idx=g.index.array;
  const distance=new Float32Array(positions.count), samples=new Uint16Array(positions.count);
  const p=new Vector3(), left=new Vector3(), right=new Vector3();
  const frames=part.cage.faces.map(face=>{
    const row=Math.min(...face.map(k=>Math.floor(k/8)));
    const lo=face.filter(k=>Math.floor(k/8)===row), hi=face.filter(k=>Math.floor(k/8)===row+1);
    if (lo.length!==2 || hi.length!==2) return {row};
    left.copy(controls[lo[0]]).lerp(controls[lo[1]],.5);
    right.copy(controls[hi[0]]).lerp(controls[hi[1]],.5).sub(left);
    const length=right.lengthSq();
    return {row,origin:left.clone(),along:right.clone().divideScalar(Math.max(1e-10,length))};
  });
  if (!g.cageFaces) return;
  for (let i=0; i<idx.length; i+=3) {
    const frame=frames[g.cageFaces[i/3]];
    for (let j=i; j<i+3; j++) {
      const v=idx[j];
      const t=frame.origin ? p.fromBufferAttribute(positions,v).sub(frame.origin).dot(frame.along) : 0;
      distance[v]+=frame.row+Math.max(0,Math.min(1,t)); samples[v]++;
    }
  }
  const phase=part.shellFinish.seed%37/37, ribs=part.shellFinish.ribs;
  const base=new Color(part.color), rust=base.clone().multiply(new Color("#ab593e"));
  const ink=rust.clone().multiplyScalar(.51), shade=new Color();
  const pigment=new Float32Array(positions.count*3);
  for (let v=0; v<positions.count; v++) {
    const row=distance[v]/Math.max(1,samples[v]), t=Math.min(1,row/19);
    const x=positions.getX(v);
    const winding=(5.4+ribs*1.16)*(t+.16*t*t)+.33*x+.085*Math.sin(17*t+3*x)+phase;
    const wave=.5+.5*Math.cos(winding*2*Math.PI);
    const stripe=Math.max(0,Math.min(1,(wave-.48)*2.35));
    const split=.5+.5*Math.cos(winding*4*Math.PI+.8*Math.sin(7*x));
    const lip=Math.max(0,Math.min(1,(row-18.9)*1.2));
    shade.copy(base).lerp(rust,(1-lip)*(.14+.72*stripe)).lerp(ink,(1-lip)*stripe*split*.46);
    if (row>21) shade.multiplyScalar(Math.max(.26,1-(row-21)*.37));
    pigment.set([shade.r,shade.g,shade.b],v*3);
    const ridge=.016*t*wave**3*(1-lip);
    positions.setXYZ(v,positions.getX(v)+normal.getX(v)*ridge,positions.getY(v)+normal.getY(v)*ridge,
      positions.getZ(v)+normal.getZ(v)*ridge);
  }
  g.computeVertexNormals();
  if (!plain) {
    g.setAttribute("color",new Float32BufferAttribute(pigment,3));
    mesh.material=mesh.material.clone();mesh.material.color.set(0xffffff);
    mesh.material.vertexColors=true;mesh.material.roughness=.39;
  }
}

// Colour follows the cup and rim as the ear cage is sculpted. Use the
// subdivision provenance to keep the satin cartilage on the inner face.
export function finishCartilage(mesh, part) {
  const g=mesh.geometry;
  if (!g.cageFaces) return;
  const count=g.attributes.position.count, weights=new Float32Array(count), visits=new Uint16Array(count);
  const shades = part.nasalWing ? [0,.04,.26,.89,1] : [0,0,.04,.17,.37,.68,.77,.87,.90];
  const sides = part.nasalWing ? 12 : 16;
  const base=new Color(part.color);
  const lining = part.nasalWing ? base.clone().multiplyScalar(.12) :
    base.clone().lerp(new Color("#b97c76"),.38).multiplyScalar(.75);
  const tint=new Color(), colors=new Float32Array(count*3);
  for (let face=0;face<g.cageFaces.length;face++) {
    const control=part.cage.faces[g.cageFaces[face]];
    const ring=Math.min(shades.length-1, Math.floor(Math.min(...control)/sides));
    for (let j=0;j<3;j++) {
      const vertex=g.index.getX(3*face+j);
      weights[vertex]+=shades[ring];
      visits[vertex]++;
    }
  }
  for (let v=0;v<count;v++)
    tint.copy(base).lerp(lining,weights[v]/Math.max(1,visits[v])).toArray(colors,3*v);
  g.setAttribute("color",new Float32BufferAttribute(colors,3));
  mesh.material=mesh.material.clone();
  mesh.material.color.set(0xffffff);
  mesh.material.vertexColors=true;
}
