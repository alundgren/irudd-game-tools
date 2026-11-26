import * as T from "three";
import {unzlibSync} from "three/addons/libs/fflate.module.js";
import data from "./human-complexion-data.json" with {type:"json"};
import {randomStream} from "./random.js";
import {tuftMap,tuftTiles} from "./human-groom.js";
import {authoredFacialHair,authoredFacialMesh} from "./human-authored-hair.js";
import {beardGroom} from "./human-beard-groom.js";
import {tintedStrands} from "./human-library.js";
import {expressionDisplacements} from "./human-surface.js";

const styles={
  "Clipped beard":{thick:[1.3,2.1,1.5],cover:[1,1,1],paint:0,tufts:0,strands:48},
  Stubble:{thick:[0,0,0],cover:[1,1,1],paint:.5,tufts:0,strands:0},
  Moustache:{thick:[4.5,0,0],cover:[1,0,0],paint:.8,tufts:130,strands:50},
  "Short beard":{thick:[3.5,5,3.5],cover:[1,1,1],paint:.9,tufts:400,strands:110},
  "Full beard":{thick:[6.5,17,10],cover:[1,1,1],paint:.92,tufts:470,strands:150},
};
export const facialHairNames=["None",...Object.keys(styles)];
export const facialHairStyle=name=>styles[name]??null;

const layout=2048,[left,top,right,bottom]=data.rect,[columns,rows]=data.growth.size;
let grids;
export const facePoint=(u,v)=>[(u*layout-left)/(right-left),((1-v)*layout-top)/(bottom-top)];
export function growthAt(x,y,out=[0,0,0]){
  grids??=["moustache","chin","side"].map(key=>unzlibSync(Uint8Array.from(atob(data.growth[key]),c=>c.charCodeAt(0))));
  if(!(x>=0&&x<=1&&y>=0&&y<=1)){out[0]=out[1]=out[2]=0;return out;}
  const fx=Math.min(columns-1.001,Math.max(0,x*columns-.5)),fy=Math.min(rows-1.001,Math.max(0,y*rows-.5));
  const i=Math.floor(fx),j=Math.floor(fy),a=fx-i,b=fy-j,at=j*columns+i;
  for(let k=0;k<3;k++){
    const g=grids[k];
    out[k]=((g[at]*(1-a)+g[at+1]*a)*(1-b)+(g[at+columns]*(1-a)+g[at+columns+1]*a)*b)/255;
  }
  return out;
}

const smooth=(v,a,b)=>{const t=Math.min(1,Math.max(0,(v-a)/(b-a)));return t*t*(3-2*t);};
const hash=(i,j,seed)=>((Math.imul(i+seed,374761393)^Math.imul(j+7,668265263)^Math.imul(i*j+13,2246822519))>>>0)/4294967296;
function noise(x,y,seed){
  const i=Math.floor(x),j=Math.floor(y),a=x-i,b=y-j,u=a*a*(3-2*a),v=b*b*(3-2*b);
  return (hash(i,j,seed)*(1-u)+hash(i+1,j,seed)*u)*(1-v)+(hash(i,j+1,seed)*(1-u)+hash(i+1,j+1,seed)*u)*v;
}

export function facialHair(skin,form,material,plain,sink,colours,fit=null,game=false){
  const style=styles[form.humanStyle?.facialHair];
  if(!style||!style.thick.some(Boolean))return null;
  if(fit&&!plain){
    const grown=beardGroom(skin,form,material,colours,fit,game);
    if(grown)return grown;
  }
  const worn=fit&&!plain?authoredFacialHair[form.humanStyle.facialHair]:null;
  const cards=name=>{
    const names=["Blink","Smile","BrowLift"],hex="#"+colours.hair.getHexString();
    return authoredFacialMesh(form.humanStyle.facialHair,fit.s,fit.idMap,fit.origin,names.map(n=>expressionDisplacements(n,false,fit.s)),names,
      material,colours.hair,tintedStrands(worn.groom,hex),name);
  };
  if(worn)return cards("facial-hair");
  const g=skin.geometry,pos=g.attributes.position,nor=g.attributes.normal,uv=g.attributes.uv,index=g.index.array;
  const moves=g.morphAttributes.position??[],seed=(form.origin?.seed??0)>>>0;
  const mm=(form.human.height??1.72)/1.72/1000,count=pos.count;
  const depth=new Float32Array(count),droop=new Float32Array(count),shade=new Float32Array(count),upper=new Uint8Array(count),w=[0,0,0];
  for(let i=0;i<count;i++){
    const [x,y]=facePoint(uv.getX(i),uv.getY(i));
    growthAt(x,y,w);
    const climb=.3+.7*smooth(x,.5,.78),rim=smooth(Math.min(x,1-x)*(right-left),2,24)*smooth(Math.min(y,1-y)*(bottom-top),2,24);
    let deep=0;
    for(let k=0;k<3;k++)deep=Math.max(deep,style.thick[k]*smooth(w[k],.1,.75)*(k===2?climb:1));
    deep*=rim;
    if(!deep)continue;
    const clump=noise(x*17,y*85,seed%977),fine=noise(x*60,y*230,seed%613);
    depth[i]=deep*(.74+.4*clump+.12*fine);
    droop[i]=.22+.5*Math.max(w[1],w[2])*smooth(deep,3,12);
    shade[i]=.7+.42*clump+.16*fine;
    upper[i]=w[0]>Math.max(w[1],w[2])?1:0;
  }
  const least=plain?.3:2.2,slot=new Int32Array(count).fill(-1),crossings=new Map(),from=[],triangles=[];
  const corner=v=>{if(slot[v]<0){slot[v]=from.length;from.push([v,v,0]);}return slot[v];};
  const crossing=(inside,outside)=>{
    const key=inside<outside?inside*count+outside:outside*count+inside;
    if(!crossings.has(key)){
      crossings.set(key,from.length);
      from.push([inside,outside,(depth[inside]-least)/(depth[inside]-depth[outside])]);
    }
    return crossings.get(key);
  };
  for(let t=0;t<index.length;t+=3){
    const v=[index[t],index[t+1],index[t+2]],covered=v.map(i=>depth[i]>=least),some=covered[0]+covered[1]+covered[2];
    if(!some)continue;
    if(some===3){triangles.push(corner(v[0]),corner(v[1]),corner(v[2]));continue;}
    const first=covered.indexOf(some===1),[a,b,c]=[v[first],v[(first+1)%3],v[(first+2)%3]];
    if(some===1)triangles.push(corner(a),crossing(a,b),crossing(a,c));
    else{
      const far=crossing(c,a);
      triangles.push(corner(b),corner(c),far,corner(b),far,crossing(b,a));
    }
  }
  if(!triangles.length)return null;
  const raised=from.length,position=[],colour=[],shifts=moves.map(()=>[]);
  const hair=colours.hair,skinTone=colours.skin,n=new T.Vector3(),d=new T.Vector3();
  const along=(array,[a,b,t],k,size=3)=>array[a*size+k]*(1-t)+array[b*size+k]*t;
  const deepAt=source=>along(depth,source,0,1);
  const put=(source,out)=>{
    for(let k=0;k<3;k++)position.push(along(pos.array,source,k)+d.getComponent(k)*out);
    moves.forEach((move,e)=>shifts[e].push(along(move.array,source,0),along(move.array,source,1),along(move.array,source,2)));
  };
  const outward=source=>n.set(along(nor.array,source,0),along(nor.array,source,1),along(nor.array,source,2)).normalize();
  for(const source of from){
    outward(source);
    d.set(0,-1,.12).multiplyScalar(along(droop,source,0,1)).add(n).normalize();
    const deep=deepAt(source);
    put(source,deep*mm);
    const tone=.84*Math.min(1.25,shade[source[0]]||.9);
    colour.push(Math.min(1,hair.r*tone),Math.min(1,hair.g*tone),Math.min(1,hair.b*tone));
  }
  const edges=new Map();
  for(let t=0;t<triangles.length;t+=3)for(let k=0;k<3;k++){
    const a=triangles[t+k],b=triangles[t+(k+1)%3],key=a<b?a*raised+b:b*raised+a;
    edges.set(key,edges.has(key)?null:[a,b]);
  }
  const foot=new Map();
  const base=slotIndex=>{
    if(!foot.has(slotIndex)){
      foot.set(slotIndex,position.length/3);
      d.copy(outward(from[slotIndex]));
      put(from[slotIndex],-.3*mm);
      colour.push(...colour.slice(slotIndex*3,slotIndex*3+3).map(c=>c*.8));
    }
    return foot.get(slotIndex);
  };
  for(const edge of edges.values()){
    if(!edge)continue;
    const [a,b]=edge;
    if(Math.max(deepAt(from[a]),deepAt(from[b]))<.6)continue;
    const a0=base(a),b0=base(b);
    triangles.push(a,a0,b0,a,b0,b);
  }
  const geometry=new T.BufferGeometry();
  geometry.setAttribute("position",new T.Float32BufferAttribute(position,3));
  geometry.setAttribute("uv",new T.BufferAttribute(new Float32Array(position.length/3*2).fill(.5),2));
  if(!plain)geometry.setAttribute("color",new T.Float32BufferAttribute(colour,3));
  geometry.setIndex(triangles);
  geometry.computeVertexNormals();
  if(moves.length){
    geometry.morphTargetsRelative=true;
    geometry.morphAttributes.position=shifts.map((values,e)=>{
      const attr=new T.Float32BufferAttribute(values,3);attr.name=moves[e].name;return attr;
    });
  }
  const m=material("#ffffff").clone();
  if(!plain){m.vertexColors=true;m.roughness=.82;}
  const mesh=new T.Mesh(geometry,m);
  mesh.name="facial-hair";mesh.castShadow=true;mesh.updateMorphTargets();
  if(!plain){
    const tufts=facialTufts(skin,style,{depth,droop,shade,upper,least,mm,seed,hair,skinTone},material);
    if(tufts)mesh.add(tufts);
  }

  const next=randomStream(seed^0x51ed270b),shell=geometry.attributes.position,normal=geometry.attributes.normal;
  const areas=[],a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3(),ab=new T.Vector3(),ac=new T.Vector3();
  let total=0;
  for(let t=0;t<index.length;t+=3){
    const ids=[slot[index[t]],slot[index[t+1]],slot[index[t+2]]];
    if(ids[0]<0||ids[1]<0||ids[2]<0)continue;
    const deep=(depth[index[t]]+depth[index[t+1]]+depth[index[t+2]])/3;
    if(deep<.5)continue;
    a.fromBufferAttribute(shell,ids[0]);b.fromBufferAttribute(shell,ids[1]);c.fromBufferAttribute(shell,ids[2]);
    total+=ab.subVectors(b,a).cross(ac.subVectors(c,a)).length()*Math.sqrt(deep);
    areas.push([total,ids,deep]);
  }
  const root=new T.Vector3(),flow=new T.Vector3(),side=new T.Vector3(),point=new T.Vector3(),move=[0,0,0];
  for(let strand=0;strand<style.strands&&areas.length;strand++){
    const pick=next()*total;
    let lo=0,hi=areas.length-1;
    while(lo<hi){const mid=(lo+hi)>>1;if(areas[mid][0]<pick)lo=mid+1;else hi=mid;}
    const [,ids,deep]=areas[lo];
    let u=next(),v=next();if(u+v>1){u=1-u;v=1-v;}
    const weights=[1-u-v,u,v];
    root.set(0,0,0);n.set(0,0,0);
    weights.forEach((weight,k)=>{
      root.addScaledVector(a.fromBufferAttribute(shell,ids[k]),weight);
      n.addScaledVector(b.fromBufferAttribute(normal,ids[k]),weight);
    });
    n.normalize();
    const lip=upper[from[ids[0]][0]]+upper[from[ids[1]][0]]+upper[from[ids[2]][0]]>1;
    flow.set(lip?Math.sign(root.x||1)*.8:(next()-.5)*.35,lip?-.5:-1,.12);
    flow.addScaledVector(n,-flow.dot(n)).normalize().addScaledVector(n,.18+.3*next()).normalize();
    const length=((.45+.75*next())*deep+1.3)*mm,width=(.3+.32*next())*mm;
    side.crossVectors(flow,n).normalize();
    root.addScaledVector(n,-.3*deep*mm);
    const start=sink.position.length/3,tone=.62+.55*next();
    const points=[[0,-1],[0,1],[.52,-.62],[.52,.62],[1,0]];
    for(const [along,across] of points){
      point.copy(root).addScaledVector(flow,length*along).addScaledVector(side,width*across)
        .addScaledVector(n,length*.14*Math.sin(along*Math.PI));
      point.y-=length*.12*along*along;
      sink.position.push(point.x,point.y,point.z);
      sink.normal.push(n.x,n.y,n.z);
      const fade=along*.28;
      sink.colour.push(...["r","g","b"].map(k=>Math.min(1,(hair[k]+(skinTone[k]-hair[k])*fade)*tone)));
    }
    moves.forEach((target,e)=>{
      move[0]=move[1]=move[2]=0;
      weights.forEach((weight,k)=>{for(let axis=0;axis<3;axis++)move[axis]+=weight*shifts[e][ids[k]*3+axis];});
      for(let k=0;k<points.length;k++)sink.shifts[e].push(...move);
    });
    sink.index.push(start,start+1,start+3,start,start+3,start+2,start+2,start+3,start+4);
  }
  return mesh;
}

function facialTufts(skin,style,{depth,droop,shade,upper,least,mm,seed,hair,skinTone},material){
  const g=skin.geometry,pos=g.attributes.position.array,nor=g.attributes.normal.array,index=g.index.array,moves=g.morphAttributes.position??[];
  const thin=.35,patches=[],a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3();
  let total=0;
  for(let t=0;t<index.length;t+=3){
    const deep=(depth[index[t]]+depth[index[t+1]]+depth[index[t+2]])/3;
    if(deep<thin)continue;
    a.fromArray(pos,index[t]*3);b.fromArray(pos,index[t+1]*3).sub(a);c.fromArray(pos,index[t+2]*3).sub(a);
    total+=b.cross(c).length()*Math.sqrt(deep)*(.2+.8*smooth(deep,thin,1.8));
    patches.push([total,t]);
  }
  if(!patches.length||!style.tufts)return null;
  const next=randomStream(seed^0x2f6b1d43),position=[],normal=[],colour=[],uv=[],triangles=[],shifts=moves.map(()=>[]);
  const root=new T.Vector3(),n=new T.Vector3(),flow=new T.Vector3(),side=new T.Vector3(),point=new T.Vector3(),hang=new T.Vector3(),move=[0,0,0];
  for(let tuft=0;tuft<style.tufts;tuft++){
    const pick=next()*total;
    let lo=0,hi=patches.length-1;
    while(lo<hi){const mid=(lo+hi)>>1;if(patches[mid][0]<pick)lo=mid+1;else hi=mid;}
    const t=patches[lo][1],ids=[index[t],index[t+1],index[t+2]];
    let u=next(),v=next();if(u+v>1){u=1-u;v=1-v;}
    const weights=[1-u-v,u,v];
    let deep=0,drop=0,tone=0,lip=0;
    root.set(0,0,0);n.set(0,0,0);
    weights.forEach((weight,k)=>{
      root.addScaledVector(a.fromArray(pos,ids[k]*3),weight);n.addScaledVector(b.fromArray(nor,ids[k]*3),weight);
      deep+=weight*depth[ids[k]];drop+=weight*droop[ids[k]];tone+=weight*(shade[ids[k]]||.9);lip+=weight*upper[ids[k]];
    });
    n.normalize();
    const upperLip=lip>.5;
    flow.set(upperLip?Math.sign(root.x||1)*(.75+.3*next()):(next()-.5)*.5,upperLip?-.55:-1,.1);
    flow.addScaledVector(n,-flow.dot(n)).normalize();
    side.crossVectors(n,flow).normalize();
    hang.set(0,-1,.12).multiplyScalar(drop).add(n).normalize();
    const edge=1-smooth(deep,thin,1.8),length=Math.min(16,Math.max(6,4.5+.9*deep))*(.75+.45*next())*(1-.35*edge)*mm,width=Math.min(7.5,Math.max(3.6,.6*length/mm))*(.85+.3*next())*(1-.35*edge)*mm;
    root.addScaledVector(hang,(deep>=least?.72*deep:.25)*mm);
    const lift=((deep>=least?.3*deep:.2)+.5+1.1*next())*mm,steps=length>9*mm?2:1,first=position.length/3;
    const tiles=tuftTiles.short,tile=tiles[Math.floor(next()*tiles.length)%tiles.length],flip=next()<.5;
    const value=Math.min(1.15,.55+.45*tone)*(.92+.14*next());
    for(let step=0;step<=steps;step++){
      const along=step/steps;
      for(const sign of [-1,1]){
        point.copy(root).addScaledVector(flow,length*along).addScaledVector(side,sign*width*.5*(1-.2*along))
          .addScaledVector(n,lift*Math.sin(along*Math.PI*.5));
        point.y-=length*.14*along*along;
        position.push(point.x,point.y,point.z);
        normal.push(n.x,n.y,n.z);
        const light=value*(.82+.24*along),fine=.55*edge;
        colour.push(...["r","g","b"].map(k=>Math.min(1,hair[k]*light)*(1-fine)+skinTone[k]*fine));
        uv.push((tile[0]+2+(tile[2]-4)*((sign<0)!==flip?0:1))/256,1-(tile[1]+1.5+(tile[3]-3)*(1-along))/256);
      }
      if(step){const at=first+step*2;triangles.push(at-2,at+1,at-1,at-2,at,at+1);}
    }
    moves.forEach((target,e)=>{
      move[0]=move[1]=move[2]=0;
      weights.forEach((weight,k)=>{for(let axis=0;axis<3;axis++)move[axis]+=weight*target.array[ids[k]*3+axis];});
      for(let k=0;k<(steps+1)*2;k++)shifts[e].push(...move);
    });
  }
  const geometry=new T.BufferGeometry();
  geometry.setAttribute("position",new T.Float32BufferAttribute(position,3));
  geometry.setAttribute("normal",new T.Float32BufferAttribute(normal,3));
  geometry.setAttribute("color",new T.Float32BufferAttribute(colour,3));
  geometry.setAttribute("uv",new T.Float32BufferAttribute(uv,2));
  geometry.setIndex(triangles);
  if(moves.length){
    geometry.morphTargetsRelative=true;
    geometry.morphAttributes.position=shifts.map((values,e)=>{
      const attr=new T.Float32BufferAttribute(values,3);attr.name=moves[e].name;return attr;
    });
  }
  const m=material("#ffffff").clone();
  m.vertexColors=true;m.roughness=.74;m.map=tuftMap();m.alphaTest=.4;m.side=T.DoubleSide;
  m.userData={...m.userData,fibreLOD:true};
  const mesh=new T.Mesh(geometry,m);
  mesh.name="facial-hair-tufts";mesh.castShadow=false;mesh.updateMorphTargets();
  return mesh;
}
