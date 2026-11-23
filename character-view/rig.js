import {Euler,Quaternion,Vector3} from "three";
const rad=Math.PI/180;
function orientation(rotation){
  return new Quaternion().setFromEuler(new Euler(...rotation.map(n=>n*rad)));
}
// Author fit data in standing world space, then bind to the parent. Calling
// this on neutral transforms preserves the visible geometry. A stored child
// subsequently follows its parent when the user edits the attachment.
export function bindParts(form,links){
  const byId=new Map(form.parts.map(p=>[p.id,p]));
  return {...form,parts:form.parts.map(p=>{
    const parent=byId.get(links[p.id]);
    if(!parent)return p;
    const inverse=orientation(parent.rotation).invert();
    const pos=new Vector3(...p.position).sub(new Vector3(...parent.position)).applyQuaternion(inverse)
      .divide(new Vector3(...parent.size)).toArray();
    const rotation=new Euler().setFromQuaternion(inverse.multiply(orientation(p.rotation)));
    return {...p,parent:parent.id,position:pos,size:p.size.map((x,i)=>x/parent.size[i]),
      rotation:[rotation.x,rotation.y,rotation.z].map(value=>value/rad || 0)};
  })};
}
export function bindHumanoid(form){
  return bindParts(form,Object.fromEntries(form.parts.filter(p=>["head","left arm","right arm"].includes(p.shape)).map(p=>[p.id,"torso"])));
}
