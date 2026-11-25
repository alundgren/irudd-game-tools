import { capturedSkin } from "./human-captured-portraits.js";
import { fittedBrow } from "./human-brow-styles.js";
import * as T from "three";
import {unzlibSync} from "three/addons/libs/fflate.module.js";
import browLayout from "./human-brow-paint.json" with {type:"json"};
import data from "./human-face-data.json" with {type:"json"};
import {expressionDisplacements} from "./human-surface.js";
import {fitFaceLayout} from "./human-complexion.js";
import {browPigment} from "./human-makeup.js";
import {browParting} from "./human-face-marks.js";
import {facialHair} from "./human-face-hair.js";
import {mouthInterior,mouthLining} from "./human-mouth.js";
import {eyeBalls,humanEyes} from "./human-eyes.js";

export {defaultEyeColor,eyeColorNames,irisPixels} from "./human-eyes.js";

const expressionNames=["Blink","Smile","BrowLift"];
const cache=new Map();
function read(key,encoded,Type){
  if(!cache.has(key)){
    const bytes=unzlibSync(Uint8Array.from(atob(encoded),c=>c.charCodeAt(0)));
    cache.set(key,new Type(bytes.buffer,bytes.byteOffset,bytes.byteLength/Type.BYTES_PER_ELEMENT));
  }
  return cache.get(key);
}

// Proxy vertices in the head's frame, with their offset under each expression.
function fitted(name,s,idMap,origin,height){
  const part=data[name] ?? browLayout[name].fibres,field=(key,Type)=>read(name+"/"+key,part[key],Type);
  const refs=field("refs",Uint16Array),weights=field("weights",Float32Array),offsets=field("offsets",Float32Array);
  const base=new Float32Array(refs.length),raise=new Float32Array(refs.length);
  const shifts=expressionNames.map(()=>new Float32Array(refs.length));
  const moves=expressionNames.map(n=>expressionDisplacements(n,false,s));
  for(let i=0;i<base.length/3;i++)for(let axis=0;axis<3;axis++){
    let value=raise[i*3+axis]=offsets[i*3+axis]*height/1.72;
    for(let k=i*3;k<i*3+3;k++){
      const at=idMap.get(refs[k])*3+axis;
      value+=weights[k]*s.positions[at];
      for(let e=0;e<moves.length;e++)shifts[e][i*3+axis]+=weights[k]*moves[e][at]*s.height/1.72;
    }
    base[i*3+axis]=value-origin[axis];
  }
  return {part,field,base,shifts,raise};
}

// Brows and lashes are tapered strands that lie on the fitted source cards.
const strandSink=()=>({position:[],normal:[],colour:[],index:[],shifts:expressionNames.map(()=>[])});
function strands(name,s,idMap,origin,height,look,sink,inside,parted){
  const card=fitted(name,s,idMap,origin,height),{part,field}=card;
  const parents=field("triRefs",Uint16Array),blend=field("triWeights",Float32Array),index=field("triIndices",Uint32Array);
  const along=field("along",Uint8Array),root=field("root",Uint16Array),lower=part.lower?field("lower",Uint8Array):null;
  const count=parents.length/3,start=sink.position.length/3;
  function spread(source,shift){
    const out=new Float32Array(count*3);
    for(let i=0;i<count;i++)for(let k=i*3;k<i*3+3;k++)
      for(let d=0;d<3;d++)out[i*3+d]+=blend[k]*(source[parents[k]*3+d]+(shift?shift[parents[k]*3+d]:0));
    return out;
  }
  const settings=i=>look(lower?.[i]===1);
  // The cards stand a little off the skin. A strand can start on the skin and rise to
  // part of that height at its tip.
  const stand=spread(card.raise);
  function placed(shift){
    const out=spread(card.base,shift);
    for(let i=0;i<count;i++){
      const lift=settings(i).lift;
      if(!lift)continue;
      const keep=lift[0]+(lift[1]-lift[0])*along[i]/255;
      for(let d=0;d<3;d++)out[i*3+d]-=stand[i*3+d]*(1-keep);
    }
    return out;
  }
  // Each strand stores its ribbon as left and right pairs from root to tip. Resize the
  // centre line about the root so the strand keeps its place on the skin, and scale the
  // width on its own. A lash also leaves the lid pointing forward and curls away from
  // the eye, which carries it clear of a heavy or folded lid.
  const pairs=2*(part.points-1);
  function shaped(values){
    const out=new Float32Array(values.length),centre=[0,0,0],from=[0,0,0];
    for(let i=0;i<count;i++){
      const r=root[i],f=settings(i),j=i-r,mate=j<pairs?r+(j^1):i;
      for(let d=0;d<3;d++){
        from[d]=(values[r*3+d]+values[(r+1)*3+d])/2;
        centre[d]=(values[i*3+d]+values[mate*3+d])/2-from[d];
      }
      if(f.aim){
        const reach=Math.hypot(centre[1],centre[2]),t=along[i]/255,angle=f.aim[0]+(f.aim[1]-f.aim[0])*t;
        centre[1]=reach*Math.sin(angle);centre[2]=reach*Math.cos(angle);
      }
      for(let d=0;d<3;d++)
        out[i*3+d]=from[d]+centre[d]*f.length+(values[i*3+d]-values[mate*3+d])/2*f.width;
    }
    return out;
  }
  const rest=shaped(placed());
  const moved=card.shifts.map(shift=>{
    const posed=shaped(placed(shift));
    for(let i=0;i<posed.length;i++)posed[i]-=rest[i];
    return posed;
  });
  // A scar parts the brow: `parted` marks strands by their order in the stored brow strokes,
  // which lists every complete strand once.
  let strand=null;
  if(parted){
    strand=new Int32Array(count).fill(-1);
    const per=2*part.points-1;
    for(let i=0,k=0;i<count;i++)if(root[i]===i&&i+per<=count&&root[i+per-1]===i)strand[i]=k++;
  }
  const keep=i=>!(strand&&strand[root[i]]>=0&&parted[strand[root[i]]])
    &&((Math.imul(root[i]+1,2654435761)>>>0)/4294967296)<settings(i).density;
  const colours=new Float32Array(count*3),normals=new Float32Array(count*3);
  for(let i=0;i<count;i++){
    const {colour,tip,facing}=settings(i),shade=.86+.28*((Math.imul(root[i]+7,40503)>>>0)%997)/997;
    const t=along[i]/255;
    for(let d=0;d<3;d++)colours[i*3+d]=Math.min(1,(colour[d]+(tip[d]-colour[d])*t)*shade);
    // Strands are lit as part of the surface they grow from, not as separate flat chips:
    // a fixed direction for lashes, and away from the middle of the head for brows.
    const n=facing??[rest[i*3]-inside.x,rest[i*3+1]-inside.y,rest[i*3+2]-inside.z],size=Math.hypot(...n)||1;
    for(let d=0;d<3;d++)normals[i*3+d]=n[d]/size;
  }
  const add=(target,values)=>{for(const v of values)target.push(v);};
  add(sink.position,rest);add(sink.normal,normals);add(sink.colour,colours);moved.forEach((values,e)=>add(sink.shifts[e],values));
  const edge=[0,0,0],other=[0,0,0];
  for(let i=0;i<index.length;i+=3){
    if(!keep(index[i]))continue;
    let [a,b,c]=[index[i],index[i+1],index[i+2]];
    // Wind each triangle to face the way it is lit. A game export draws one side only.
    for(let d=0;d<3;d++){edge[d]=rest[b*3+d]-rest[a*3+d];other[d]=rest[c*3+d]-rest[a*3+d];}
    const facing=(edge[1]*other[2]-edge[2]*other[1])*normals[a*3]+(edge[2]*other[0]-edge[0]*other[2])*normals[a*3+1]
      +(edge[0]*other[1]-edge[1]*other[0])*normals[a*3+2];
    if(facing<0)[b,c]=[c,b];
    sink.index.push(start+a,start+b,start+c);
    // Lashes are seen from above and below, and turn over in a blink.
    if(settings(a).bothSides)sink.index.push(start+a,start+c,start+b);
  }
}
function hairColours(form){
  const style=form.humanStyle??{};
  return {hair:new T.Color(style.hairColor??form.appearance.hairColor),skin:new T.Color(form.appearance.skin)};
}
function browsAndLashes(sink,s,idMap,origin,form,inside,plain){
  const {hair,skin}=hairColours(form),human=form.human,height=human.height??1.72;
  const frame=T.MathUtils.clamp(human.frame??0,-1,1),age=human.age??0;
  const rgb=c=>[c.r,c.g,c.b];
  const light=c=>.2126*c.r+.7152*c.g+.0722*c.b,most=Math.min(.05,.3*light(skin));
  // Brows that have not greyed are darker than the skin they grow on, whatever the scalp hair is dyed.
  const brow=browPigment(hair,skin,age,form.humanStyle?.makeup);
  const browTip=brow.clone().lerp(hair,.14+.14*age);
  const tipLimit=Math.min(.82*light(skin),1.75*light(brow)+.013);
  if (light(browTip)>tipLimit) browTip.multiplyScalar(tipLimit/light(browTip));
  // Lashes are darker than scalp hair, and fair hair still has brown lashes.
  const lash=hair.clone().lerp(new T.Color("#120d0b"),.72);
  // Lashes stay well darker than the lid they grow from, whatever the hair.
  if(light(lash)>most)lash.multiplyScalar(most/light(lash));
  const lashTip=lash.clone().lerp(skin,.22);
  const browName=fittedBrow(form);
  const photoBrow = capturedSkin(form.complexion)?.brows && (form.humanStyle?.browStyle ?? "As drawn") === "As drawn";
  if (plain || !photoBrow) strands(browName,s,idMap,origin,height,
    ()=>({density:(plain ? 1 : .42)*(1-.12*Math.max(0,-frame)-.1*age),length:1,width:plain ? .82 : .62,lift:[.10,.39],colour:rgb(brow),tip:rgb(browTip)}),sink,inside,
    browParting(form,browName));
  // The source cards are a few millimetres deep. Real upper lashes are about 8 mm long.
  // Seat upper lash roots snugly along the thickened upper lid margin so they ground the lash shadow.
  const upper={density:.96-.22*age,length:2.55-.35*frame-.35*age,width:1.06,lift:[.35,1],aim:[-.40,.34],colour:rgb(lash),tip:rgb(lashTip),facing:[0,.5,.87],bothSides:true};
  const under={density:.5-.14*frame-.1*age,length:1.7-.2*frame,width:.7,aim:[.15,-.45],colour:rgb(lash.clone().lerp(skin,.2)),tip:rgb(lashTip),facing:[0,-.3,.95]};
  const browVertices=sink.position.length/3;
  strands("eyelashes01",s,idMap,origin,height,low=>low?under:upper,sink,inside);
  return browVertices;
}
function strandMesh(sink,material,plain){
  const geometry=new T.BufferGeometry();
  geometry.setAttribute("position",new T.Float32BufferAttribute(sink.position,3));
  geometry.setAttribute("normal",new T.Float32BufferAttribute(sink.normal,3));
  geometry.setAttribute("uv",new T.BufferAttribute(new Float32Array(sink.position.length/3*2).fill(.5),2));
  if(!plain)geometry.setAttribute("color",new T.Float32BufferAttribute(sink.colour,3));
  geometry.setIndex(sink.index);
  geometry.morphTargetsRelative=true;
  geometry.morphAttributes.position=sink.shifts.map((values,e)=>{
    const attr=new T.Float32BufferAttribute(values,3);attr.name=expressionNames[e];return attr;
  });
  const m=material("#ffffff").clone();
  if(!plain){m.vertexColors=true;m.roughness=.62;}
  // Keep every strand in a game export. A thinned strand would break into slivers.
  m.userData={...m.userData,fibreLOD:true};
  const mesh=new T.Mesh(geometry,m);mesh.name="brows-and-lashes";mesh.updateMorphTargets();
  return mesh;
}
export function humanFace(group,s,origin,material,plain,form) {
  const idMap=new Map(Array.from(s.ids,(v,i)=>[v,i]));
  const skin=group.children.find(mesh=>mesh.userData.faceSurface);
  // A point inside the head behind the eyes, for the way brow strands are lit.
  const inside=new T.Vector3(),box=new T.Box3(),v=new T.Vector3();
  for(const ids of s.eyeGroups)for(const id of ids)box.expandByPoint(v.fromArray(s.positions,id*3));
  box.getCenter(inside).sub(v.fromArray(origin));inside.z-=box.getSize(v).y*2.4;
  const sink=strandSink(),browVertices=browsAndLashes(sink,s,idMap,origin,form,inside,plain);
  // Facial hair reads the head's own texture coordinates, so it is grown before the face
  // paint refits them to the face rectangle.
  const beard=skin?facialHair(skin,form,material,plain,sink,hairColours(form),{s,idMap,origin}):null;
  const teeth=skin?mouthInterior(skin,form,material,plain):null;
  if(skin?.material.userData.faceLayout)fitFaceLayout(skin.geometry,mouthLining(skin.geometry));
  group.add(humanEyes(skin,eyeBalls(s,origin),material,plain,form,(form.human.height??1.72)/1.72));
  const fibres=strandMesh(sink,material,plain);
  // Brow vertices come first, then lash vertices, then any loose facial hair.
  fibres.geometry.userData.browVertices=browVertices;
  group.add(fibres);
  if(beard)group.add(beard);
  if(teeth)group.add(teeth);
}
