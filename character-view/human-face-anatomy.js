import * as T from "three";
import {evaluateHuman,smoothHumanSurface} from "./human-surface.js";

export const faceAnatomy={
  seam:1540.8,upper:1549.6,lower:1534.5,corner:[23.5,1539.6],
  upperBack:2.3,lowerBack:1.4,seamForward:1.6,cornerBack:1.3,
  philtrum:.75,columns:.35,bow:.7,
  nostril:[10.6,1567.6,154],nostrilDeepen:1.3,
  upperRim:[.72,.16],tarsal:.38,upperCrease:[1.32,.24],upperHood:[.42,.22],
  lowerRim:[.82,.16],lowerGroove:.32,
  shade:{nostril:.66,seam:.3,corner:.24,lash:.56,crease:.28,lowerRim:.1},
  smileLift:.34,smileLiftMost:3.2,
  blinkUnwind:.65,
};

const smooth=(v,a,b)=>{const t=Math.min(1,Math.max(0,(v-a)/(b-a)));return t*t*(3-2*t);};
const bell=(v,at,width)=>Math.exp(-(((v-at)/width)**2));

let fields=null;
export function faceAnatomyFields(){
  if(fields)return fields;
  const A=faceAnatomy,cage=evaluateHuman({}),s=smoothHumanSurface(cage),p=s.positions,count=p.length/3,corners=s.bodyTriangles*3;
  const g=new T.BufferGeometry();
  g.setAttribute("position",new T.BufferAttribute(p,3));g.setIndex(new T.BufferAttribute(s.indices,1));g.computeVertexNormals();
  const normal=g.attributes.normal.array;
  const lip=new Uint8Array(count),lid=new Uint8Array(count),head=new Uint8Array(count);
  const bone=s.names.indexOf("head");
  for(let c=0;c<s.indices.length;c++){
    const v=s.indices[c],t=s.uvFaces[c]*4;
    lip[v]=Math.max(lip[v],s.pigments[t]);lid[v]=Math.max(lid[v],s.pigments[t+1]);
  }
  for(let v=0;v<count;v++)for(let j=v*4;j<v*4+4;j++)if(s.boneIndices[j]===bone&&s.weights[j]>.5)head[v]=1;
  const eye=[0,0,0];let eyes=0;
  const eyeCentres=cage.eyeGroups.map(ids=>{
    const c=[0,0,0];
    for(const id of ids){
      for(let d=0;d<3;d++)c[d]+=cage.positions[id*3+d]/ids.length;
      eye[0]+=Math.abs(p[id*3]);eye[1]+=p[id*3+1];eye[2]+=p[id*3+2];eyes++;
    }
    let reach=0;
    for(const id of ids)reach=Math.max(reach,Math.hypot(cage.positions[id*3]-c[0],cage.positions[id*3+1]-c[1],cage.positions[id*3+2]-c[2]));
    return {c,reach};
  });
  for(let d=0;d<3;d++)eye[d]*=1000/eyes;
  const adj=Array.from({length:count},()=>new Set());
  for(let c=0;c<corners;c+=3){
    const a=s.indices[c],b=s.indices[c+1],d=s.indices[c+2];
    adj[a].add(b);adj[a].add(d);adj[b].add(a);adj[b].add(d);adj[d].add(a);adj[d].add(b);
  }
  const lidCage=v=>(v>=6756&&v<6784)||(v>=13352&&v<13380);
  const ring0=new Uint8Array(count);
  for(let v=0;v<count;v++)if(lidCage(v))ring0[v]=1;
  for(let v=0;v<count;v++){
    if(ring0[v])continue;
    const nbrs=[...adj[v]].filter(lidCage);
    if(nbrs.length!==2)continue;
    const [u,w]=nbrs;
    const d=Math.hypot(p[v*3]-.5*(p[u*3]+p[w*3]),p[v*3+1]-.5*(p[u*3+1]+p[w*3+1]),p[v*3+2]-.5*(p[u*3+2]+p[w*3+2]));
    const seg=Math.hypot(p[u*3]-p[w*3],p[u*3+1]-p[w*3+1],p[u*3+2]-p[w*3+2]);
    if(d<.22*seg)ring0[v]=1;
  }
  const uvParent=Int32Array.from({length:s.uv.length/2},(_,i)=>i);
  const findUv=i=>{while(uvParent[i]!==i)i=uvParent[i]=uvParent[uvParent[i]];return i;};
  for(let t=0;t<corners;t+=3){const a=findUv(s.uvFaces[t]);uvParent[findUv(s.uvFaces[t+1])]=a;uvParent[findUv(s.uvFaces[t+2])]=a;}
  const firstIsl=new Int32Array(count).fill(-1),sharedSeam=new Uint8Array(count),islands=new Map();
  for(let i=0;i<corners;i++){
    const isl=findUv(s.uvFaces[i]),v=s.indices[i];
    if(firstIsl[v]<0)firstIsl[v]=isl;else if(firstIsl[v]!==isl)sharedSeam[v]=1;
    if(!islands.has(isl))islands.set(isl,new Set());
    islands.get(isl).add(v);
  }
  const innerSocket=new Uint8Array(count),qIn=[];
  for(const {c,reach} of eyeCentres){
    for(const members of islands.values()){
      let wraps=true;const mid=[0,0,0];
      for(const v of members){
        if(Math.hypot(p[v*3]-c[0],p[v*3+1]-c[1],p[v*3+2]-c[2])>1.8*reach){wraps=false;break;}
        for(let d=0;d<3;d++)mid[d]+=p[v*3+d]/members.size;
      }
      if(!wraps||Math.hypot(mid[0]-c[0],mid[1]-c[1],mid[2]-c[2])>.6*reach)continue;
      for(const v of members)if(!sharedSeam[v]&&!ring0[v]&&!innerSocket[v]){innerSocket[v]=1;qIn.push(v);}
    }
  }
  for(let h=0;h<qIn.length;h++)for(const w of adj[qIn[h]])if(!innerSocket[w]&&!ring0[w]){innerSocket[w]=1;qIn.push(w);}
  const lidRing=new Int16Array(count).fill(-1),qOut=[];
  for(let v=0;v<count;v++)if(ring0[v]){lidRing[v]=0;qOut.push(v);}
  for(let h=0;h<qOut.length;h++){
    const u=qOut[h];
    if(lidRing[u]>=16)continue;
    for(const w of adj[u])if(lidRing[w]<0&&!innerSocket[w]){lidRing[w]=lidRing[u]+1;qOut.push(w);}
  }
  const lidDist=new Float32Array(count).fill(Infinity);
  for(let v=0;v<count;v++)if(ring0[v])lidDist[v]=0;
  for(let iter=0;iter<18;iter++){
    let changed=false;
    for(let v=0;v<count;v++){
      if(lidRing[v]<0||innerSocket[v])continue;
      for(const w of adj[v]){
        if(lidRing[w]<0||innerSocket[w])continue;
        const e=1000*Math.hypot(p[v*3]-p[w*3],p[v*3+1]-p[w*3+1],p[v*3+2]-p[w*3+2]);
        if(lidDist[v]+e<lidDist[w]-1e-5){lidDist[w]=lidDist[v]+e;changed=true;}
      }
    }
    if(!changed)break;
  }
  let minAx=Infinity,maxAx=-Infinity,innerY=0,outerY=0;
  for(let v=13352;v<13380;v++){
    const ax=Math.abs(p[v*3]),y=p[v*3+1];
    if(ax<minAx){minAx=ax;innerY=y;}
    if(ax>maxAx){maxAx=ax;outerY=y;}
  }
  const cornerY=ax=>{const t=Math.min(1,Math.max(0,(ax-minAx)/(maxAx-minAx)));return (innerY+(outerY-innerY)*t)*1000;};
  const move=new Float32Array(count*3),shade=new Float32Array(count),lower=new Float32Array(count),crease=new Float32Array(count),lidAnchors=new Uint8Array(count);
  const upperEdge=[],lowerEdge=[];
  for(let v=0;v<count;v++){
    if(ring0[v]){lidAnchors[v]=1;continue;}
    if(innerSocket[v]&&v<cage.bodyVertices){
      for(const w of adj[v])if(ring0[w]){lidAnchors[v]=1;break;}
      continue;
    }
    const r=lidRing[v];
    if(r<1)continue;
    const y=p[v*3+1]*1000,cY=cornerY(Math.abs(p[v*3]));
    if(r===2)lidAnchors[v]=1;
    else if(r===10&&y>cY)lidAnchors[v]=1;
    else if((r===6||r===12)&&y>cY&&v<cage.bodyVertices)lidAnchors[v]=1;
    else if(r===3&&y<=cY&&v<cage.bodyVertices)lidAnchors[v]=1;
  }
  for(let v=0;v<count;v++){
    if(!head[v])continue;
    const x=1000*p[v*3],y=1000*p[v*3+1],z=1000*p[v*3+2],ax=Math.abs(x),side=x<0?-1:1;
    if(z<118||y<1505||y>1640)continue;
    let dx=0,dy=0,dz=0,dark=0;
    if(y<1568&&y>1518&&ax<34){
      const front=smooth(z,144,148.5),across=1-smooth(ax/A.corner[0],.5,1.02);
      const up=bell(y,A.upper,y>A.upper?3.6:3.3),low=bell(y,A.lower,4.2),meet=bell(y,A.seam,1.7);
      dz+=front*across*(-A.upperBack*up-A.lowerBack*low)+smooth(z,143,147)*across*A.seamForward*meet;
      const corner=Math.exp(-(((ax-A.corner[0])/5.2)**2+((y-A.corner[1])/4.6)**2))*smooth(z,128,138);
      dz-=A.cornerBack*corner;
      const run=smooth(y,A.upper-.5,A.upper+2.5)*(1-smooth(y,1559,1563))*front;
      dz+=run*(-A.philtrum*bell(x,0,2.8)+A.columns*bell(ax,5,1.9));
      const border=bell(y,A.upper+.6,2.2)*front;
      dy+=border*A.bow*(-bell(x,0,2.6)+.6*bell(ax,5.2,2.4));
      const lips=lip[v]/255;
      dark=Math.max(dark,A.shade.seam*lips*bell(y,A.seam-.25*(ax/A.corner[0])**2,1.15)*smooth(z,140,146),A.shade.corner*corner*smooth(z,134,140));
    }
    if(y<A.seam+1.2&&y>A.seam-22&&ax<26&&z>126){
      const facing=y>A.seam-2.2?smooth(normal[v*3+1],-.05,.3):1;
      lower[v]=facing*(1-smooth(ax/A.corner[0],.3,.98))*(1-smooth(A.seam-y,8,21))*smooth(z,128,140);
    }
    if(ax<5&&Math.abs(y-A.seam)<1.7&&z>147.5&&lip[v]>128){
      if(normal[v*3+1]>.25)lowerEdge.push(v);else if(normal[v*3+1]<-.25)upperEdge.push(v);
    }
    const [nx,ny,nz]=A.nostril,down=smooth(-normal[v*3+1],-.35,.7);
    const hole=Math.exp(-(((ax-nx)/3.6)**2+((y-ny)/2.6)**2+((z-nz)/4.8)**2));
    if(hole>.01){
      dy+=A.nostrilDeepen*hole*down;dz-=.5*A.nostrilDeepen*hole*down;
      const wide=Math.exp(-(((ax-nx)/4.1)**2+((y-ny)/2.9)**2+((z-nz)/5.3)**2));
      dark=Math.max(dark,A.shade.nostril*Math.min(1,1.25*wide)*down);
    }
    const d=lidDist[v];
    if(Number.isFinite(d)&&d>0&&d<12.5&&!innerSocket[v]){
      const cY=cornerY(Math.abs(p[v*3])),tAcross=(Math.abs(p[v*3])-minAx)/(maxAx-minAx);
      const acrossU=smooth(tAcross,-.05,.24)*(1-smooth(tAcross,.78,1.15));
      const acrossL=smooth(tAcross,-.04,.20)*(1-smooth(tAcross,.78,1.10));
      const isUpper=smooth(y-cY,-.5,.7),isLower=1-isUpper;
      const uRim=bell(d,2.2,1.4)*smooth(d,.15,1);
      dz+=isUpper*acrossU*A.upperRim[0]*uRim;
      dy-=isUpper*acrossU*A.upperRim[1]*uRim;
      dz+=isUpper*acrossU*A.tarsal*bell(d,3.5,1.3);
      const creaseW=isUpper*acrossU*bell(d,5.9,1.65);
      dz-=A.upperCrease[0]*creaseW;
      dy+=A.upperCrease[1]*creaseW;
      crease[v]=creaseW;
      const hood=bell(d,8.4,1.65);
      dz+=isUpper*acrossU*A.upperHood[0]*hood;
      dy-=isUpper*acrossU*A.upperHood[1]*hood;
      const lRim=bell(d,1.65,1.1)*smooth(d,.15,.8);
      dz+=isLower*acrossL*A.lowerRim[0]*lRim;
      dy+=isLower*acrossL*A.lowerRim[1]*lRim;
      dz-=isLower*acrossL*A.lowerGroove*bell(d,4.6,1.5);
      dark=Math.max(dark,A.shade.crease*creaseW,A.shade.lowerRim*isLower*acrossL*bell(d,3.5,1.15)*smooth(-normal[v*3+1],-.05,.35));
    }
    if(lid[v]>100&&Math.abs(y-eye[1])<14){
      const margin=lid[v]/255*smooth(z,eye[2]-6,eye[2]-1);
      if(y>eye[1])dark=Math.max(dark,margin*A.shade.lash*smooth(-normal[v*3+1],.05,.5));
    }
    move[v*3]=side*dx;move[v*3+1]=dy;move[v*3+2]=dz;shade[v]=dark;
  }
  return fields={move,shade,lower,crease,lidAnchors,upperEdge,lowerEdge,count};
}

export function facialMorphNormals(geometry, vertexIds) {
  const distinct = new Map(), representatives = [];
  const welded = vertexIds.map((v, i) => {
    if (!distinct.has(v)) {
      distinct.set(v, representatives.length);
      representatives.push(i);
    }
    return distinct.get(v);
  });
  const positions = geometry.attributes.position;
  const probe = new T.BufferGeometry();
  probe.setIndex(Array.from(geometry.index.array, i => welded[i]));
  const posed = new T.Float32BufferAttribute(new Float32Array(representatives.length * 3), 3);
  probe.setAttribute("position", posed);
  function sample(target) {
    for (let j = 0; j < representatives.length; j++) {
      const i = representatives[j];
      posed.setXYZ(j, positions.getX(i) + (target?.getX(i) ?? 0),
        positions.getY(i) + (target?.getY(i) ?? 0), positions.getZ(i) + (target?.getZ(i) ?? 0));
    }
    probe.computeVertexNormals();
    return probe.attributes.normal.array;
  }
  const rest = sample().slice();
  geometry.morphAttributes.normal = geometry.morphAttributes.position.map(target => {
    const now = sample(target), delta = new Float32Array(positions.count * 3);
    for (let i = 0; i < welded.length; i++) {
      const j = welded[i] * 3;
      for (let d = 0; d < 3; d++) delta[3 * i + d] = now[j + d] - rest[j + d];
    }
    const attribute = new T.BufferAttribute(delta, 3);
    attribute.name = target.name;
    return attribute;
  });
  probe.dispose();
}

export function refineFaceForm(surface){
  const {move,count}=faceAnatomyFields(),p=surface.positions;
  if(p.length!==count*3)return surface;
  const unit=.001*(surface.height??1.72)/1.72;
  for(let i=0;i<move.length;i++)if(move[i])p[i]+=unit*move[i];
  return surface;
}

export function shadeFaceForm(geometry,vertexIds){
  const colour=geometry.attributes.color;
  if(!colour)return;
  const {shade}=faceAnatomyFields();
  for(let i=0;i<vertexIds.length;i++){
    const dark=shade[vertexIds[i]];
    if(!dark)continue;
    colour.setXYZ(i,colour.getX(i)*(1-.86*dark),colour.getY(i)*(1-dark),colour.getZ(i)*(1-dark));
  }
  colour.needsUpdate=true;
}

export function refineExpressions(geometry,vertexIds,scale=1){
  const blink=geometry.morphAttributes.position?.find(attr=>attr.name==="Blink");
  const {lower,crease,upperEdge,lowerEdge}=faceAnatomyFields();
  if(blink&&!blink.userData?.creaseUnwound){
    const unit=.001*scale*faceAnatomy.blinkUnwind;
    for(let i=0;i<vertexIds.length;i++){
      const w=crease[vertexIds[i]];
      if(w)blink.setXYZ(i,blink.getX(i),blink.getY(i)-unit*faceAnatomy.upperCrease[1]*w,blink.getZ(i)+unit*faceAnatomy.upperCrease[0]*w);
    }
    blink.userData={...blink.userData,creaseUnwound:true};
    blink.needsUpdate=true;
  }
  const smile=geometry.morphAttributes.position?.find(attr=>attr.name==="Smile");
  if(!smile)return 0;
  const p=geometry.attributes.position,at=new Map();
  vertexIds.forEach((v,i)=>{if(!at.has(v))at.set(v,i);});
  const height=(ids,posed)=>{
    let total=0,n=0;
    for(const v of ids){const i=at.get(v);if(i===undefined)continue;total+=p.getY(i)+(posed?smile.getY(i):0);n++;}
    return n?total/n:null;
  };
  const top=height(upperEdge,true),bottom=height(lowerEdge,true),restTop=height(upperEdge,false),restBottom=height(lowerEdge,false);
  if(top===null||bottom===null)return 0;
  const parted=Math.max(0,(top-bottom)-(restTop-restBottom));
  const lift=Math.min(faceAnatomy.smileLift*parted,.001*scale*faceAnatomy.smileLiftMost);
  if(lift<=0)return 0;
  for(let i=0;i<vertexIds.length;i++){
    const w=lower[vertexIds[i]];
    if(w)smile.setXYZ(i,smile.getX(i),smile.getY(i)+lift*w,smile.getZ(i)+.2*lift*w);
  }
  smile.needsUpdate=true;
  return lift;
}
