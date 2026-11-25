import * as T from "three";
import data from "./human-complexion-data.json" with {type:"json"};

const layout=2048,[boxLeft,boxTop,boxRight,boxBottom]=data.mouth.island;
const smooth=(v,a,b)=>{const t=Math.min(1,Math.max(0,(v-a)/(b-a)));return t*t*(3-2*t);};
const mix=(a,b,t)=>a+(b-a)*t;
const found=new WeakMap();

/**
 * Which vertices of the head skin are the lining of the mouth: 1 for each. The lining is its
 * own island of the skin layout, so it is every vertex joined by triangles to the ones stored
 * for it. Call this while the head still has the texture coordinates of the skin layout.
 */
export function mouthLining(geometry){
  if(found.has(geometry))return found.get(geometry);
  const uv=geometry.attributes.uv,index=geometry.index.array,count=uv.count;
  const parent=Int32Array.from({length:count},(_,i)=>i);
  const find=i=>{while(parent[i]!==i)i=parent[i]=parent[parent[i]];return i;};
  for(let t=0;t<index.length;t+=3){
    const a=find(index[t]);parent[find(index[t+1])]=a;parent[find(index[t+2])]=a;
  }
  const size=new Map(),within=new Map();
  for(let i=0;i<count;i++){
    const root=find(i),x=uv.getX(i)*layout,y=(1-uv.getY(i))*layout;
    size.set(root,(size.get(root)??0)+1);
    if(x>boxLeft&&x<boxRight&&y>boxTop&&y<boxBottom)within.set(root,(within.get(root)??0)+1);
  }
  const flags=new Uint8Array(count);
  for(let i=0;i<count;i++){const root=find(i);if((within.get(root)??0)>.5*size.get(root))flags[i]=1;}
  found.set(geometry,flags);
  return flags;
}

// Crown widths and heights in millimetres from the middle outward: two incisors, the canine
// and two premolars. Lower crowns are kept short so they stay inside the lip and chin.
const upperTeeth=[[8.6,10],[6.8,8.8],[7.6,9.8],[7,7.8],[6.8,7.2]];
const lowerTeeth=[[5.4,7],[6,7],[6.8,7.4],[7,6.4],[7,6]];

/**
 * The inside of the mouth. The lining of the head skin becomes a shallow pocket that hangs
 * from the lips and moves with them, and two short rows of teeth stand inside it. Returns
 * the teeth, which are not skin. Closed lips hide both rows; an expression that parts the
 * lips slides the rows into the opening, the upper row showing most.
 */
export function mouthInterior(skin,form,material,plain){
  const g=skin.geometry,p=g.attributes.position,index=g.index.array,moves=g.morphAttributes.position??[];
  const lining=mouthLining(g),mm=(form.human.height??1.72)/1.72/1000;
  // The seam is where the lining meets the lips: the two share positions there.
  const key=i=>Math.round(p.getX(i)*2e5)+"/"+Math.round(p.getY(i)*2e5)+"/"+Math.round(p.getZ(i)*2e5);
  const lips=new Set(),seam=[],inner=[];
  let any=false;
  for(let i=0;i<p.count;i++)if(lining[i])any=true;else lips.add(key(i));
  if(!any)return null;
  for(let i=0;i<p.count;i++)if(lining[i])(lips.has(key(i))?seam:inner).push(i);
  if(seam.length<12)return null;
  // The line of the closed lips, by distance from the middle of the face.
  let corner=0,widest=0,tallest=0;
  for(const i of seam)corner=Math.max(corner,Math.abs(p.getX(i)));
  const bins=Math.max(4,Math.round(corner/(3*mm))),sum=Array.from({length:bins+1},()=>[0,0,0]);
  for(const i of seam){
    const at=Math.abs(p.getX(i))/corner*bins,k=Math.min(bins-1,Math.floor(at)),f=at-k;
    for(const [slot,weight] of [[k,1-f],[k+1,f]]){
      sum[slot][0]+=weight;sum[slot][1]+=weight*p.getY(i);sum[slot][2]+=weight*p.getZ(i);
    }
  }
  const knots=sum.map(([weight,y,z])=>weight>1e-6?[y/weight,z/weight]:null);
  for(let k=0;k<=bins;k++)knots[k]??=knots.slice(0,k).reverse().find(Boolean)??knots.find(Boolean);
  const line=(across,axis)=>{
    const at=Math.min(1,Math.abs(across)/corner)*bins,k=Math.min(bins-1,Math.floor(at));
    return mix(knots[k][axis],knots[k+1][axis],at-k);
  };
  const depthOf=i=>Math.max(0,line(p.getX(i),1)-p.getZ(i)),heightOf=i=>p.getY(i)-line(p.getX(i),0);
  for(const i of inner){
    widest=Math.max(widest,Math.abs(p.getX(i)));tallest=Math.max(tallest,Math.abs(heightOf(i)));
  }
  // Squeeze the deep cavity into a pocket: it keeps its shape at the lips, then narrows,
  // flattens and stops about a centimetre in. Every step grows with depth, so nothing folds.
  const narrow=Math.min(1,(corner-1.5*mm)/Math.max(widest,1e-6)),flat=Math.min(1,8*mm/Math.max(tallest,1e-6));
  const settle=5*mm,deep=new Float32Array(p.count),high=new Float32Array(p.count),across=new Float32Array(p.count);
  for(const i of seam){high[i]=heightOf(i);across[i]=p.getX(i);}
  for(const i of inner){
    const d=depthOf(i),e=heightOf(i),t=smooth(d,0,7*mm);
    const x=p.getX(i)*mix(1,narrow,t),out=Math.min(1,Math.abs(x)/corner);
    deep[i]=settle*(1-Math.exp(-d/settle))+.09*d;
    high[i]=e*mix(1,flat*(1-.55*out*out),t);
    across[i]=x;
    p.setXYZ(i,x,line(x,0)+high[i],line(x,1)-deep[i]);
  }
  // The pocket rides with the lips: its roof with the upper lip, its floor with the lower.
  for(const move of moves){
    const from=seam.map(i=>[move.getX(i),move.getY(i),move.getZ(i)]);
    for(const i of inner){
      let total=0,x=0,y=0,z=0;
      seam.forEach((j,n)=>{
        const dx=(across[i]-across[j])/mm,dy=2.5*(high[i]-high[j])/mm,weight=1/(.05+(dx*dx+dy*dy)**2);
        total+=weight;x+=weight*from[n][0];y+=weight*from[n][1];z+=weight*from[n][2];
      });
      move.setXYZ(i,x/total,y/total,z/total);
    }
    move.needsUpdate=true;
  }
  // Light the pocket by its own shape, and let the paint darken toward the back.
  const normal=g.attributes.normal,added=new Float32Array(p.count*3);
  const a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3();
  for(let t=0;t<index.length;t+=3){
    const ids=[index[t],index[t+1],index[t+2]];
    if(!ids.every(i=>lining[i]))continue;
    a.fromBufferAttribute(p,ids[0]);b.fromBufferAttribute(p,ids[1]).sub(a);c.fromBufferAttribute(p,ids[2]).sub(a);
    b.cross(c);
    for(const i of ids){added[i*3]+=b.x;added[i*3+1]+=b.y;added[i*3+2]+=b.z;}
  }
  const colour=g.attributes.color;
  for(let i=0;i<p.count;i++){
    if(!lining[i])continue;
    const length=Math.hypot(added[i*3],added[i*3+1],added[i*3+2]);
    if(length>1e-14){
      // No light reaches the pocket past the lips. A file has no shadow there, so its normals
      // turn to face into the head as it deepens and no lamp in front can light or glint on it.
      const hide=smooth(deep[i],.6*mm,3.5*mm),x=added[i*3]/length*(1-hide),y=added[i*3+1]/length*(1-hide),z=added[i*3+2]/length*(1-hide)-hide,size=Math.hypot(x,y,z)||1;
      normal.setXYZ(i,x/size,y/size,z/size);
    }
    if(colour){
      const dim=mix(1,.4,smooth(deep[i],1*mm,8*mm));
      colour.setXYZ(i,colour.getX(i)*dim,colour.getY(i)*dim,colour.getZ(i)*dim);
    }
  }
  p.needsUpdate=normal.needsUpdate=true;
  if(colour)colour.needsUpdate=true;
  g.computeBoundingBox();g.computeBoundingSphere();

  // The teeth stand on an arch that clears the lips at rest and in every expression.
  const scale=corner/(24.5*mm)*mm,points=[];
  for(const i of seam){
    points.push([Math.abs(p.getX(i)),p.getZ(i)]);
    for(const move of moves)points.push([Math.abs(p.getX(i)+move.getX(i)),p.getZ(i)+move.getZ(i)]);
  }
  let front=Infinity,bend=14;
  for(const [x,z] of points)if(x<.25*corner)front=Math.min(front,z-2.6*scale);
  for(const [x,z] of points)if(x>.3*corner)bend=Math.max(bend,(front-(z-2.6*scale))/(x*x));
  const arch=x=>front-bend*x*x;
  // Where the lips part in the middle of the mouth, at rest and in each expression.
  const middle=seam.filter(i=>Math.abs(p.getX(i))<.2*corner),mean=(ids,of)=>ids.reduce((total,i)=>total+of(i),0)/Math.max(1,ids.length);
  const above=middle.filter(i=>high[i]>0),below=middle.filter(i=>high[i]<=0);
  const upperLip=mean(above,i=>p.getY(i)),lowerLip=mean(below,i=>p.getY(i));
  const edges=[upperLip+1.8*scale,lowerLip-1.8*scale];
  // Each lip's own line across the mouth, as an offset from the middle: the rows follow it,
  // so lips that curve or sit apart at the sides still cover them.
  const lipLine=[above,below].map((_,which)=>{
    const total=Array.from({length:bins+1},()=>[0,0]);
    for(const i of seam){
      if((high[i]>0)!==(which===0))continue;
      const at=Math.abs(p.getX(i))/corner*bins,k=Math.min(bins-1,Math.floor(at)),f=at-k;
      total[k][0]+=1-f;total[k][1]+=(1-f)*p.getY(i);total[k+1][0]+=f;total[k+1][1]+=f*p.getY(i);
    }
    const centre=which?lowerLip:upperLip,offsets=total.map(([weight,y],k)=>weight>.5?y/weight-centre:line(k/bins*corner,0)-line(0,0));
    return across=>{
      const at=Math.min(1,Math.abs(across)/corner)*bins,k=Math.min(bins-1,Math.floor(at));
      return mix(offsets[k],offsets[k+1],at-k);
    };
  });
  const slides=moves.map(move=>{
    const top=mean(above,i=>p.getY(i)+move.getY(i)),bottom=mean(below,i=>p.getY(i)+move.getY(i));
    const opening=top-bottom,parted=smooth(opening-(upperLip-lowerLip),.5*mm,3*mm);
    return [parted*(top-.5*opening-edges[0]),parted*Math.min(0,top-.62*opening-edges[1])];
  });
  const position=[],colours=[],triangles=[],row=[];
  const rows=(teeth,up,back,lean,enamel)=>{
    for(const side of [1,-1]){
      // Stations along the arch: the edges of each crown and two points on its face.
      const stations=[];
      let x=0;
      teeth.forEach(([width,height],tooth)=>{
        for(const u of tooth?[.25,.75,1]:[0,.25,.75,1]){
          stations.push({x:x+u*width*scale/Math.hypot(1,2*bend*(x+.5*width*scale)),u,height:height*scale,tooth});
        }
        x=stations.at(-1).x;
      });
      const reach=x,start=position.length/3,levels=7;
      for(const {x:along,u,height,tooth} of stations){
        const edge=u===0||u===1,slope=2*bend*along,unit=Math.hypot(1,slope);
        // Crowns bulge between the gaps, round off at their corners and scallop the gum.
        const round=(edge?(tooth===2?.7:.3):0)*scale+(tooth===1?.4*scale:0);
        const neck=height-(edge?1.9*scale:0),bulge=edge?-.9*scale:0;
        const shade=1-.7*(along/reach)**1.3;
        const level=[
          [neck+2.2*scale,bulge-.5*scale,"gum",.7],
          [neck,bulge+.45*scale,"gum",1],
          [neck,bulge+.45*scale,"enamel",.9],
          [.6*height,bulge+.2*scale,"enamel",1],
          [.15*height+round,bulge,"enamel",1],
          [round,bulge-.5*scale,"enamel",.92],
          [round+.2*scale,bulge-2*scale,"enamel",.5],
        ];
        for(const [rise,out,kind,light] of level){
          const push=out-back*scale-lean*rise;
          position.push(side*(along+push*slope/unit),edges[up>0?0:1]+lipLine[up>0?0:1](along)+up*rise,arch(along)+push/unit);
          row.push(up>0?0:1);
          const tone=kind==="gum"?[.5,.26,.27]:enamel;
          // The gap between two crowns is in shadow, deepest toward the gum, and the biting
          // edge is a little grey. Without these a row of teeth reads as one band.
          const gap=edge&&kind==="enamel"?(rise>.5*height?.42:rise>.2*height?.6:.8):1,tip=kind==="enamel"&&rise<.2*height?.93:1;
          colours.push(...tone.map((value,k)=>value*light*shade*gap*(k===2?tip:1)));
        }
      }
      const flip=side*up<0;
      for(let s=0;s+1<stations.length;s++)for(let r=0;r+1<levels;r++){
        if(r===1)continue;
        const q=start+s*levels+r,n=q+levels;
        if(flip)triangles.push(q,n,q+1,q+1,n,n+1);
        else triangles.push(q,q+1,n,q+1,n+1,n);
      }
    }
  };
  rows(upperTeeth,1,0,.12,[.8,.74,.62]);
  rows(lowerTeeth,-1,1.5,.3,[.7,.65,.55]);
  const geometry=new T.BufferGeometry();
  geometry.setAttribute("position",new T.Float32BufferAttribute(position,3));
  geometry.setAttribute("uv",new T.BufferAttribute(new Float32Array(position.length/3*2).fill(.5),2));
  if(!plain)geometry.setAttribute("color",new T.Float32BufferAttribute(colours,3));
  geometry.setIndex(triangles);
  geometry.computeVertexNormals();
  if(moves.length){
    geometry.morphTargetsRelative=true;
    geometry.morphAttributes.position=moves.map((move,e)=>{
      const values=new Float32Array(position.length);
      row.forEach((which,i)=>{values[i*3+1]=slides[e][which];});
      const attr=new T.BufferAttribute(values,3);attr.name=move.name;return attr;
    });
  }
  const m=material("#ffffff").clone();
  if(!plain){m.vertexColors=true;m.roughness=.5;}
  // Every triangle of the teeth is kept in a game export: there are few and each one shows.
  m.userData={...m.userData,fibreLOD:true};
  const mesh=new T.Mesh(geometry,m);
  mesh.name="teeth";mesh.receiveShadow=true;mesh.updateMorphTargets();
  return mesh;
}
