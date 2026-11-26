import {Vector3} from "three";
import {humanControls,humanRestPositions} from "./human-surface.js";

let anchorFaces;
function findAnchorFaces(surface) {
  const anchors=humanControls().ids, cells=new Map(Array.from(anchors,(v,i)=>[v,i])),
    areas=new Float64Array(anchors.length),faces=new Int32Array(anchors.length*2);
  faces.fill(-1);
  const a=new Vector3(),b=new Vector3(),c=new Vector3(),idx=surface.indices;
  for(let t=0;t<surface.bodyTriangles*3;t+=3){
    a.fromArray(surface.positions,idx[t]*3);
    b.fromArray(surface.positions,idx[t+1]*3).sub(a);
    c.fromArray(surface.positions,idx[t+2]*3).sub(a);
    const area=b.cross(c).lengthSq();
    for(let j=0;j<3;j++){
      const k=cells.get(idx[t+j]);
      if(k===undefined || area<=areas[k])continue;
      areas[k]=area;
      faces[k*2]=idx[t+(j+1)%3];faces[k*2+1]=idx[t+(j+2)%3];
    }
  }
  return faces;
}
function basis(surface,v,i,j){
  const o=new Vector3().fromArray(surface.positions,3*v);
  const x=new Vector3().fromArray(surface.positions,3*i).sub(o).normalize();
  const z=new Vector3().fromArray(surface.positions,3*j).sub(o).cross(x).normalize();
  return [x,new Vector3().crossVectors(z,x),z];
}
export function transportHumanFit(fit,oldSurface,newSurface){
  if(!fit?.controls.length)return fit;
  anchorFaces??=findAnchorFaces({...oldSurface,positions:humanRestPositions()});
  const ids=humanControls().ids;
  const rows=fit.controls.map(row=>{
    const [k,x,y,z]=row, i=anchorFaces[k*2],j=anchorFaces[k*2+1];
    if(i<0)return row;
    const prior=basis(oldSurface,ids[k],i,j),next=basis(newSurface,ids[k],i,j);
    if(prior[2].lengthSq()<.9 || next[2].lengthSq()<.9)return row;
    const old=new Vector3(x,y,z),newOffset=new Vector3();
    for(let d=0;d<3;d++)newOffset.addScaledVector(next[d],old.dot(prior[d]));
    return [k,...newOffset.clampLength(0,649).toArray().map(Math.round)];
  });
  return {...fit,controls:rows};
}
