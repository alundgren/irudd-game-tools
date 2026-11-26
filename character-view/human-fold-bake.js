import { BufferAttribute, BufferGeometry, CanvasTexture, SRGBColorSpace } from "three";

export function foldPanels(mesh) {
  const g = mesh.geometry, p = g.attributes.position, uv = g.attributes.uv;
  const groups = [new Map(),new Map()], source=[], panels=[], indices=[];
  const t = g.index.array;
  for (let i=0;i<t.length;i+=3) {
    const a=t[i],b=t[i+1],c=t[i+2];
    const side = (p.getX(b)-p.getX(a))*(p.getY(c)-p.getY(a)) -
      (p.getY(b)-p.getY(a))*(p.getX(c)-p.getX(a)) < 0 ? 1 : 0;
    const group = groups[side];
    for (let j=i;j<i+3;j++) {
      const original=t[j];
      if (!group.has(original)) {
        group.set(original,source.length);source.push(original);panels.push(side);
      }
      indices.push(group.get(original));
    }
  }
  const geom=new BufferGeometry();
  for (const [key,attr] of Object.entries(g.attributes)) {
    const width=attr.itemSize, arr=new attr.array.constructor(source.length*width);
    for (let i=0;i<source.length;i++) arr.set(attr.array.subarray(source[i]*width,(source[i]+1)*width),i*width);
    geom.setAttribute(key,new BufferAttribute(arr,width,attr.normalized));
  }
  const joined=geom.attributes.uv;
  for(let i=0;i<source.length;i++) joined.setX(i,(panels[i]+uv.getX(source[i]))*.5);
  geom.setIndex(indices);
  const skin={...mesh.humanWeights};
  for (const key of ["weights","boneIndices"]) {
    const old=skin[key];
    if (!old) continue;
    const next=new old.constructor(source.length*4);
    for (let i=0;i<source.length;i++) next.set(old.subarray(4*source[i],4*source[i]+4),4*i);
    skin[key]=next;
  }
  return {geom,skin,indices,panels,source};
}

function layers(width,height) {
  const canvas=document.createElement("canvas");
  canvas.width=width;canvas.height=height;
  return canvas;
}

function raster(panel,source,heights,w,h) {
  const {indices,panels}=panel, pos=source.attributes.position, uv=source.attributes.uv;
  const zbuf=new Float32Array(2*w*h).fill(-Infinity), folds=new Float32Array(2*w*h);
  for (let i=0;i<indices.length;i+=3) {
    const ia=indices[i],a=panel.source[ia],b=panel.source[indices[i+1]],c=panel.source[indices[i+2]];
    const side=panels[ia],sx=uv.getX(a)*w,sy=(1-uv.getY(a))*h;
    const bx=uv.getX(b)*w-sx,by=(1-uv.getY(b))*h-sy;
    const cx=uv.getX(c)*w-sx,cy=(1-uv.getY(c))*h-sy;
    const area=bx*cy-cx*by;
    if (Math.abs(area)<1e-7) continue;
    const loX=Math.max(0, Math.floor(sx+Math.min(0,bx,cx))),hiX=Math.min(w-1,Math.ceil(sx+Math.max(0,bx,cx)));
    const loY=Math.max(0, Math.floor(sy+Math.min(0,by,cy))),hiY=Math.min(h-1,Math.ceil(sy+Math.max(0,by,cy)));
    for(let y=loY;y<=hiY;y++) for(let x=loX;x<=hiX;x++) {
      const dx=x+.5-sx,dy=y+.5-sy,v=(dx*cy-dy*cx)/area,k=(dy*bx-dx*by)/area,u=1-v-k;
      if(Math.min(u,v,k)<-.0001)continue;
      const z=(u*pos.getZ(a)+v*pos.getZ(b)+k*pos.getZ(c))*(side ? -1 : 1);
      const at=y*2*w+side*w+x;
      if(z>=zbuf[at]){zbuf[at]=z;folds[at]=u*heights[a]+v*heights[b]+k*heights[c];}
    }
  }
  for(let pass=0;pass<2;pass++) {
    const from=zbuf.slice();
    for(let y=1;y<h-1;y++)for(let x=1;x<2*w-1;x++){
      const at=y*2*w+x;
      if(from[at]!==-Infinity)continue;
      for(const off of [-1,1,-2*w,2*w]) if(from[at+off]!==-Infinity){
        zbuf[at]=from[at+off];folds[at]=folds[at+off];break;
      }
    }
  }
  return folds;
}

export function bakeGameFolds(mesh) {
  const m=mesh.material, source=mesh.geometry, heights=mesh.foldMetres;
  if (!heights || !m?.map?.image || !m.bumpMap?.image || m.normalMap ||
      m.roughnessMap!==m.bumpMap || !source.attributes.uv || !source.index || typeof document==="undefined") return;
  const w=Math.min(448,m.map.image.width),h=Math.min(560,m.map.image.height);
  if(w<8 || h<8)return;
  const color=layers(2*w,h), rel=layers(2*w,h);
  const paint=color.getContext("2d"), relief=rel.getContext("2d");
  if(!paint?.drawImage || !relief?.getImageData)return;
  const panel=foldPanels(mesh), fold=raster(panel,source,heights,w,h);
  for(let s=0;s<2;s++){
    paint.drawImage(m.map.image,s*w,0,w,h);relief.drawImage(m.bumpMap.image,s*w,0,w,h);
  }
  const image=paint.getImageData(0,0,2*w,h),surface=relief.getImageData(0,0,2*w,h);
  const scale=.034, yarn=m.bumpScale;
  const worn = /denim|jeans/i.test(m.name ?? "");
  const stride = 2*w, reach = Math.max(2, Math.round(h/60));
  for(let i=0;i<fold.length;i++){
    const j=4*i,delta=fold[i];
    const yarnHeight=(surface.data[j]/255-.5)*yarn;
    surface.data[j]=255*Math.max(0,Math.min(1,.5+(yarnHeight+delta*1.65)/scale));
    const x=i%w,y=Math.floor(i/stride);
    const left=fold[i-Math.min(x,reach)],right=fold[i+Math.min(w-1-x,reach)];
    const up=fold[i-stride*Math.min(y,reach)],down=fold[i+stride*Math.min(h-1-y,reach)];
    const pocket = Math.max(0, (left+right+up+down)*.25-delta);
    const cavity=Math.min(1,Math.max(0,-delta)/.006+pocket/.0035);
    const crest=worn ? Math.max(0,Math.min(1,delta/.004)) : 0;
    const shade=1-.23*cavity+.09*crest;
    for(let c=0;c<3;c++)image.data[j+c]*=shade;
  }
  paint.putImageData(image,0,0);relief.putImageData(surface,0,0);
  const diffuse=new CanvasTexture(color),detail=new CanvasTexture(rel);
  diffuse.colorSpace=SRGBColorSpace;diffuse.anisotropy=detail.anisotropy=4;
  m.map=diffuse;m.bumpMap=m.roughnessMap=detail;m.bumpScale=scale;
  m.addEventListener("dispose",()=>{diffuse.dispose();detail.dispose();});
  mesh.geometry=panel.geom;mesh.humanWeights=panel.skin;source.dispose();
}
