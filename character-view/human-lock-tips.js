import { BufferGeometry, CanvasTexture, Color, DoubleSide, Float32BufferAttribute, Mesh, MeshStandardMaterial, SRGBColorSpace, Vector3 } from "three";
import { randomStream } from "./random.js";

let tipTexture;
function texture() {
  if (tipTexture) return tipTexture;
  const canvas = document.createElement("canvas");
  canvas.width=192; canvas.height=192;
  const c=canvas.getContext("2d");
  if (!c?.quadraticCurveTo) return null;
  const random=randomStream(1237);
  for(let col=0;col<4;col++){
    for(let i=0;i<47;i++){
      const u=random(), root=col*48+6+36*u;
      const tip=root+(u-.5)*9+(random()-.5)*5;
      const end=96+87*(.3+.7*random())*(.65+.35*Math.sin(u*Math.PI));
      const r=.40+random()*.85, curve=(random()-.5)*4+3*Math.sin(2*Math.PI*u);
      const grey=Math.round(137+random()*109);
      c.fillStyle="rgb("+grey+","+grey+","+grey+")";
      c.beginPath();c.moveTo(root-r,2);
      c.quadraticCurveTo(root+curve-r,end*.55,tip,end);
      c.quadraticCurveTo(root+curve+r,end*.58,root+r,2);c.fill();
    }
  }
  tipTexture=new CanvasTexture(canvas);tipTexture.colorSpace=SRGBColorSpace;tipTexture.anisotropy=8;
  return tipTexture;
}

function outline(g) {
  const p=g.attributes.position, index=g.index?.array;
  const points = new Map(), ids=[];
  for(let i=0;i<p.count;i++){
    const key=[p.getX(i),p.getY(i),p.getZ(i)].map(x=>Math.round(x*5e4)).join("/");
    if(!points.has(key)) points.set(key,points.size);
    ids.push(points.get(key));
  }
  const edges=new Map();
  for(let i=0;i<(index?.length??p.count);i+=3){
    for(let j=0;j<3;j++){
      const a=index?.[i+j]??i+j,b=index?.[i+(j+1)%3]??i+(j+1)%3,c=index?.[i+(j+2)%3]??i+(j+2)%3;
      const lo=ids[a],hi=ids[b]; if(lo===hi)continue;
      const key=lo<hi?lo+"/"+hi:hi+"/"+lo;
      if(edges.has(key))edges.set(key,null);
      else edges.set(key,[a,b,c]);
    }
  }
  return [...edges.values()].filter(Boolean);
}

export function hairLockTips(main, frame, tone, style) {
  if(!main?.material?.map || typeof document==="undefined")return null;
  const map=texture();if(!map)return null;
  const g=main.geometry,p=g.attributes.position,n=g.attributes.normal;
  const random=randomStream(4672),k=frame.k;
  const a=new Vector3(),b=new Vector3(),third=new Vector3(),perp=new Vector3(),mid=new Vector3();
  const along=new Vector3(),normal=new Vector3(),run=new Vector3(),pt=new Vector3();
  const centre = new Vector3(...frame.centre), fromCentre = new Vector3();
  const choices=[];
  let length=0;
  for(const [i,j,other] of outline(g)){
    a.fromBufferAttribute(p,i);b.fromBufferAttribute(p,j);mid.copy(a).lerp(b,.5);
    along.subVectors(b,a);const edge=along.length();
    if(edge<.00002*k || edge>.061*k)continue;
    along.normalize();third.fromBufferAttribute(p,other);
    perp.subVectors(mid,third);perp.addScaledVector(along,-perp.dot(along)).normalize();
    const at=frame.aim(mid.toArray());
    if(at.eps>1.12 || (Math.abs(at.phi)<.58 && mid.y<frame.eye[1]+.013*k) || perp.y>.57) continue;
    length+=edge;choices.push({i,j,edge,end:length,out:perp.clone()});
  }
  if(!choices.length)return null;
  const pos=[],norm=[],colors=[],uv=[],index=[];
  const color=new Color(tone);const count=Math.min(255,Math.ceil(length/(.0034*k)));
  let row=0;
  for(let t=0;t<count;t++){
    const station=(t+random())*length/count;
    while(row<choices.length-1 && choices[row].end<station)row++;
    const {i,j,edge,end,out}=choices[row],s=1-(end-station)/edge;
    a.fromBufferAttribute(p,i);b.fromBufferAttribute(p,j);mid.copy(a).lerp(b,s);
    along.subVectors(b,a).normalize();fromCentre.subVectors(mid,centre).normalize();
    normal.fromBufferAttribute(n,i).lerp(pt.fromBufferAttribute(n,j),s).normalize();
    if(normal.dot(fromCentre)<0)normal.negate();
    const facing=frame.aim(mid.toArray()),front=Math.abs(facing.phi)<1.15;
    const tied=style==="Tied bun" || style==="Low ponytail";
    const len=k*(front && tied?.0045:front?.0085:.011)*(.65+random()*.8);
    const wide=k*(.0015+random()*.0014);
    run.copy(out).addScaledVector(along,(random()-.5)*.39);
    if(!front)run.y-=.22;
    run.addScaledVector(normal,-run.dot(normal)).normalize();
    const base=pos.length/3,col=Math.floor(random()*4),shade=.89+random()*.23;
    for(const v of [0,.52,1])for(const sign of [-1,1]){
      pt.copy(mid).addScaledVector(run,(v-.56)*len)
        .addScaledVector(along,sign*wide*(1-.44*v))
        .addScaledVector(normal,k*(.00032+.00088*Math.sin(v*2.42)));
      pos.push(pt.x,pt.y,pt.z);norm.push(normal.x,normal.y,normal.z);
      colors.push(color.r*shade,color.g*shade,color.b*shade);
      uv.push((col+(sign<0?.01:.99))/4,1-v);
    }
    index.push(base,base+2,base+1,base+1,base+2,base+3,base+2,base+4,base+3,base+3,base+4,base+5);
  }
  const geo=new BufferGeometry();geo.setIndex(index);
  for(const [name,arr,stride] of [["position",pos,3],["normal",norm,3],["color",colors,3],["uv",uv,2]])
    geo.setAttribute(name,new Float32BufferAttribute(arr,stride));
  const mat=new MeshStandardMaterial({map,vertexColors:true,roughness:.85,side:DoubleSide,alphaTest:.32});
  mat.userData.hairCards=true;
  const mesh=new Mesh(geo,mat);mesh.name=style+" fine ends";mesh.userData.styleRegion="head";
  return mesh;
}
