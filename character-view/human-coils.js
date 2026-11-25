import * as T from "three";
import {ImprovedNoise} from "three/addons/math/ImprovedNoise.js";
const grain=new ImprovedNoise();
import {evaluateHuman} from "./human-surface.js";
import {randomStream} from "./random.js";

// Sample the scalp of the canonical mesh once. Triangle coordinates carry the
// cut and the individual locks to the same scalp landmarks on every adult.
const TAU=Math.PI*2;
const clamp=x=>Math.max(0,Math.min(1,x));
const smooth=t=>{t=clamp(t);return t*t*(3-2*t);};
let scalp;
const vec=(s,i)=>new T.Vector3().fromArray(s.positions,i*3);
function scalpTriangles(){
  if(scalp)return scalp;
  const base=evaluateHuman({height:1.72}),head=base.names.indexOf("head"), triangles=[];
  let area=0;
  function margin(p){
    const a=Math.atan2(p.x/.077,(p.z-.051)/.10),front=Math.cos(a);
    // The forehead has a shallow widow's peak. The hairline rises above
    // the ear, then descends behind it towards the nape.
    const forehead=1.644+.014*Math.sin(a)**2-.004*Math.exp(-((a/.16)**2));
    const rear=1.548+.058*(1+front);
    let line=T.MathUtils.lerp(rear,forehead,smooth((front+.12)/.77));
    line+=.012*Math.exp(-((Math.abs(a)-1.63)**2)/.10);
    return p.y-line+.0019*grain.noise(p.x*180,p.y*160,p.z*180);
  }
  for(let i=0;i<base.bodyTriangles*3;i+=3){
    const ids=Array.from(base.indices.subarray(i,i+3));
    if(!ids.every(v=>base.boneIndices[v*4]===head))continue;
    const points=ids.map(v=>vec(base,v)), margins=points.map(margin);
    if(Math.max(...margins)<0)continue;
    const faceArea=new T.Triangle(...points).getArea();
    if(faceArea<1e-9)continue;
    area+=faceArea;
    triangles.push({ids,margins,total:area});
  }
  return scalp={triangles,area};
}
const specs={
  "Coiled crop":{length:.016,radius:.0033,locks:1250},
  "Rounded coils":{length:.034,radius:.0045,locks:1480},
};
export const coilStyles=Object.keys(specs);
export function coilGroom(surface,style,material,plain,skinColor,gameBudget=0){
  const spec=specs[style.hair];
  if(!spec)return [];
  const {triangles,area}=scalpTriangles(), scale=surface.height/1.72, draw=randomStream(0x1b835b);
  const hair=new T.Color(style.hairColor??"#48372e"),skin=new T.Color(skinColor??"#96735d");
  const headIndex=surface.names.indexOf("head"),centre=new T.Vector3().fromArray(surface.joints,headIndex*3);
  centre.y+=.061*scale;
  const point=(t,q)=>{
    const v=new T.Vector3();
    for(let i=0;i<3;i++)v.addScaledVector(vec(surface,t.ids[i]),q[i]);
    return v;
  };
  const normal=p=>new T.Vector3((p.x-centre.x)/.78,(p.y-centre.y)/1.04,(p.z-centre.z)/1.08).normalize();
  const pos=[], col=[], idx=[];
  function vertex(p,c){let i=pos.length/3;pos.push(p.x,p.y,p.z);col.push(c.r,c.g,c.b);return i;}
  function baseLength(p,m) {
    const side=Math.abs(p.x-centre.x)/scale,front=(p.z-centre.z)/scale;
    return scale*spec.length*(.76+.32*smooth((p.y-centre.y)/(.09*scale))-.14*smooth((side-.045)/.035))*
      smooth((m+.0005)/.022)*(1+.055*Math.sin(98*p.x/scale+47*front)*Math.cos(67*p.y/scale));
  }
  const smoothNormals=new Map(),shellVertices=new Map();
  // Clip the root shell at the actual hairline, including cut triangles.
  for(const t of triangles){
    const polygon=[];
    for(let k=0;k<3;k++){
      const last=(k+2)%3,a=t.margins[last],b=t.margins[k];
      if((a>=0)!==(b>=0)){
        const f=a/(a-b),q=[0,0,0];q[last]=1-f;q[k]=f;polygon.push({q,m:0});
      }
      if(b>=0){const q=[0,0,0];q[k]=1;polygon.push({q,m:b});}
    }
    function shellVertex({q,m}){
      const p=point(t,q),n=normal(p),length=baseLength(p,m),fade=smooth(m/.009);
      const key=p.toArray().map(v=>Math.round(v*100000)).join("/");
      if(shellVertices.has(key))return shellVertices.get(key);
      const gx=p.x/scale,gy=p.y/scale,gz=p.z/scale;
      const waves=grain.noise(gx*185,gy*160,gz*195), coarse=grain.noise(gx*67,gy*77,gz*76);
      const shade=hair.clone().multiplyScalar(.68+.43*waves+.23*coarse).lerp(skin,(1-fade)*.70);
      const i=vertex(p.addScaledVector(n,.0007*scale+length*.70+fade*(waves*.0027+coarse*.0020)*scale),shade);
      smoothNormals.set(i,n);shellVertices.set(key,i);return i;
    }
    const mid=(a,b)=>({q:a.q.map((v,i)=>(v+b.q[i])*.5),m:(a.m+b.m)*.5});
    function shellTriangle(a,b,c,depth){
      if(!depth){idx.push(shellVertex(a),shellVertex(b),shellVertex(c));return;}
      const ab=mid(a,b),bc=mid(b,c),ca=mid(c,a);
      shellTriangle(a,ab,ca,depth-1);shellTriangle(ab,b,bc,depth-1);
      shellTriangle(ca,bc,c,depth-1);shellTriangle(ab,bc,ca,depth-1);
    }
    for(let k=1;k<polygon.length-1;k++)shellTriangle(polygon[0],polygon[k],polygon[k+1],2);
  }
  // A lock is a tapered elliptical tube with an open spiral above the root
  // shell. Vary phase, length and lay to break a uniform rows-of-dots pattern.
  const up=new T.Vector3(0,1,0),sideDir=new T.Vector3(1,0,0);
  const steps=gameBudget?7:12,sides=gameBudget?3:4;
  const locks=gameBudget?Math.min(spec.locks,Math.floor(gameBudget*.55/(steps*sides*2))):spec.locks;
  for(let lock=0;lock<locks;lock++){
    const pick=draw()*area;
    let lo=0,hi=triangles.length-1;
    while(lo<hi){const mid=(lo+hi)>>1;if(triangles[mid].total>=pick)hi=mid;else lo=mid+1;}
    const face=triangles[lo],r=Math.sqrt(draw()),u=draw();
    const bary=[1-r,r*(1-u),r*u],m=face.margins.reduce((sum,v,i)=>sum+v*bary[i],0);
    if(m<0)continue;
    const root=point(face,bary),n=normal(root),h=baseLength(root,m),fade=smooth((m+.0004)/.016);
    const x=new T.Vector3().crossVectors(Math.abs(n.y)>.93?sideDir:up,n).normalize();
    const y=new T.Vector3().crossVectors(n,x);
    const rad=spec.radius*scale*(.60+.74*draw())*(.24+.76*fade),phase=TAU*draw(),turn=TAU*(.83+.77*draw());
    const span=h*(.84+.26*draw()),thick=scale*(.00064+.00085*draw())*(.22+.78*fade);
    const shade=hair.clone().multiplyScalar(.72+draw()*.73);
    const prev=new T.Vector3(),ringNormal=new T.Vector3(),u2=new T.Vector3(),v2=new T.Vector3();
    const path=[];
    for(let r=0;r<=steps;r++){
      const t=r/steps,a=phase+t*turn;
      const z=span*(.64+.33*t+.10*Math.sin(Math.PI*t))+.0008*scale;
      path.push(root.clone().addScaledVector(n,z)
        .addScaledVector(x,rad*Math.cos(a)+t*rad*.65)
        .addScaledVector(y,rad*Math.sin(a)-t*rad*.85));
    }
    let last;
    for(let r=0;r<path.length;r++){
      const t=r/steps,p=path[r];
      ringNormal.subVectors(path[Math.min(steps,r+1)],path[Math.max(0,r-1)]).normalize();
      u2.crossVectors(ringNormal,Math.abs(ringNormal.dot(x))>.95?y:x).normalize();v2.crossVectors(ringNormal,u2);
      const ring=[],width=thick*(1-.84*t**3);
      for(let j=0;j<sides;j++){
        const a=TAU*j/sides;
        prev.copy(p).addScaledVector(u2,width*Math.cos(a)).addScaledVector(v2,width*.75*Math.sin(a));
        ring.push(vertex(prev,shade));
      }
      if(last)for(let j=0;j<sides;j++){const k=(j+1)%sides;idx.push(last[j],last[k],ring[k], last[j],ring[k],ring[j]);}
      last=ring;
    }
  }
  const g=new T.BufferGeometry();g.setAttribute("position",new T.Float32BufferAttribute(pos,3));
  if(!plain)g.setAttribute("color",new T.Float32BufferAttribute(col,3));
  g.setAttribute("uv",new T.BufferAttribute(new Float32Array(pos.length/3*2),2));g.setIndex(idx);g.computeVertexNormals();
  const normals=g.attributes.normal,faceted=new T.Vector3();
  for(const [i,n] of smoothNormals){
    faceted.fromBufferAttribute(normals,i).lerp(n,.72).normalize();
    normals.setXYZ(i,faceted.x,faceted.y,faceted.z);
  }
  const mat=material("#ffffff").clone();
  if(!plain){mat.vertexColors=true;mat.roughness=.72;}
  const mesh=new T.Mesh(g,mat);mesh.name=style.hair;mesh.castShadow=true;mesh.userData.styleRegion="head";
  return [mesh];
}
