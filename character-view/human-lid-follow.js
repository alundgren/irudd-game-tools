import * as T from "three";
import {facialMorphNormals} from "./human-face-anatomy.js";

/* The lids follow the eye up and down. On the base head the gaze turns the eye under lids that
   stay where they rest, so looking up slides the iris under the upper lid and leaves white
   under it, and looking down bares the top of the iris. Here the two vertical gaze targets
   also carry the opening: both lids move with the eye by the same amount at each place across
   it, so the opening travels and a closed lid stays closed whatever the gaze. The corners stay
   put and the movement dies out into the fold above and the cheek below.
   Distances are millimetres on a 1.72 m adult. */
export const lidFollow={
  // How far the opening travels at a full look up and a full look down.
  up:1.5,down:2,
  // The corners hold still: the travel grows to full over this distance from each.
  corner:4.5,
  // Skin within `near` of a lid's edge moves in full, and none of it past `far`.
  near:.5,above:8,below:7,
};
const smooth=(v,a,b)=>{const t=Math.min(1,Math.max(0,(v-a)/(b-a)));return t*t*(3-2*t);};

// A point's share of the travel and the slope of the ball under the lid it belongs to.
function share(fit,x,y,z,mm,f=lidFollow){
  const {centre,side,ball,opening}=fit,a=side*(x-centre.x),h=y-centre.y;
  if(z-centre.z<-.3*ball||Math.abs(a)>1.5*ball||Math.abs(h)>1.6*ball)return null;
  const across=smooth(a,opening.inner,opening.inner+f.corner*mm)*(1-smooth(a,opening.outer-f.corner*mm,opening.outer));
  if(!across)return null;
  const [bottom,top]=opening.at(a);
  const weight=h>top?1-smooth(h-top,f.near*mm,f.above*mm):h<bottom?1-smooth(bottom-h,f.near*mm,f.below*mm):1;
  if(!weight)return null;
  // A lid slides over the ball: as it rises it follows the ball's slope at its own edge.
  const edge=h>top?top:h<bottom?bottom:h,flat=Math.max(.3*ball*ball,ball*ball-a*a-edge*edge);
  return [across*weight,-edge/Math.sqrt(flat)];
}
function targets(geometry,fits,mm){
  const p=geometry.attributes.position,up=new Float32Array(p.count*3),down=new Float32Array(p.count*3);
  let moved=0;
  for(let i=0;i<p.count;i++)for(const fit of fits){
    if(fit.side*p.getX(i)<0)continue;
    const s=share(fit,p.getX(i),p.getY(i),p.getZ(i),mm);
    if(!s)continue;
    moved++;
    up[i*3+1]=lidFollow.up*mm*s[0];up[i*3+2]=lidFollow.up*mm*s[0]*s[1];
    down[i*3+1]=-lidFollow.down*mm*s[0];down[i*3+2]=-lidFollow.down*mm*s[0]*s[1];
  }
  return {up,down,moved};
}
/** Adds the lids' share of LookUp and LookDown to a built native head: the skin, the lashes
    and the wet line on the lower lid. `group` is the head's group from `humanRegions`. */
export function followGaze(group,scale=1){
  const skin=group.children.find(mesh=>mesh.userData.faceSurface),eyes=group.children.find(mesh=>mesh.userData.eyePiece);
  if(!skin||!eyes?.eyeFits||!skin.humanSkin)return;
  const mm=.001*scale,fits=eyes.eyeFits;
  for(const mesh of [skin,group.children.find(m=>m.name==="brows-and-lashes")]){
    if(!mesh)continue;
    const g=mesh.geometry,{up,down}=targets(g,fits,mm);
    for(const [name,values] of [["LookUp",up],["LookDown",down]]){
      const target=new T.BufferAttribute(values,3);target.name=name;g.morphAttributes.position.push(target);
    }
    if(mesh===skin)facialMorphNormals(g,skin.humanSkin.vertices);
    mesh.morphTargetDictionary=undefined;mesh.updateMorphTargets();
  }
  // The tear line lies on the lower lid's edge and goes with it. It is the part of the eye
  // mesh drawn from the top band of the white's image.
  const g=eyes.geometry,p=g.attributes.position,uv=g.attributes.uv,{up,down}=targets(g,fits,mm);
  for(const [name,values] of [["LookUp",up],["LookDown",down]]){
    const target=g.morphAttributes.position.find(t=>t.name===name);
    for(let i=0;i<p.count;i++)if(Math.abs(uv.getY(i)-.94)<1e-4)for(let d=0;d<3;d++)target.array[i*3+d]+=values[i*3+d];
  }
}
