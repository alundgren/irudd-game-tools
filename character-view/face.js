import * as T from "three";
import atlasUrl from "./faces.atlas.webp";

// The four original diffuse studies share one atlas. UVs sample each portrait
// from the front and carry its temple colour around the back of the skull.
const paint=[];
export async function loadFacePaint() {
  const image=await new T.ImageLoader().loadAsync(atlasUrl);
  const source=document.createElement("canvas");source.width=image.width;source.height=image.height;
  const ctx=source.getContext("2d",{willReadFrequently:true});ctx.drawImage(image,0,0);
  const pixels=ctx.getImageData(0,0,source.width,source.height).data;
  for(let cell=0;cell<4;cell++){
    const canvas=document.createElement("canvas");canvas.width=640;canvas.height=384;
    const target=canvas.getContext("2d");const result=target.createImageData(canvas.width,canvas.height);
    const ox=(cell%2)*source.width/2,oy=Math.floor(cell/2)*source.height/2;
    function sample(u,v,k){
      const x=Math.min(source.width-1,Math.max(0,Math.floor(ox+u*source.width/2)));
      const y=Math.min(source.height-1,Math.max(0,Math.floor(oy+v*source.height/2)));
      return pixels[(y*source.width+x)*4+k];
    }
    for(let y=0;y<canvas.height;y++){
      const t=1-y/(canvas.height-1);
      let r=1;while(r<contour.length-1 && contour[r][0]<t)r++;
      const p=contour[r-1],q=contour[r],width=T.MathUtils.lerp(p[1],q[1],(t-p[0])/(q[0]-p[0]));
      for(let x=0;x<canvas.width;x++){
        const angle=x/(canvas.width-1)*Math.PI*2-Math.PI;
        const front=T.MathUtils.smoothstep(Math.cos(angle),-.05,.58);
        const u=.5+width*Math.sin(angle)/.195*.64;
        const v=.958-t*.949;
        const off=(y*canvas.width+x)*4;
        for(let k=0;k<3;k++){
          // A small forehead patch supplies skin grain around the unpainted rear.
          const rear=sample(.48+.052*Math.sin(angle*6),.156+.028*Math.sin(t*12),k);
          result.data[off+k]=T.MathUtils.lerp(rear,sample(u,v,k),front);
        }
        result.data[off+3]=255;
      }
    }
    target.putImageData(result,0,0);
    const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;texture.anisotropy=4;paint[cell]=texture;
  }
}
export const faces=[
  {skin:"#ac785a",jaw:1.03,nose:1.08,brow:1.1,cheek:1},
  {skin:"#ae7f5d",jaw:1.14,nose:1.09,brow:.91,cheek:1.12},
  {skin:"#956449",jaw:.98,nose:.92,brow:.91,cheek:1.16},
  {skin:"#c9997c",jaw:.91,nose:.86,brow:.94,cheek:1.03},
];
const contour=[
  // chin -> crown: half width, depth in front of and behind the ear.
  [0,.034,.076,.009],[.045,.058,.092,.035],[.15,.078,.094,.065],
  [.27,.086,.091,.083],[.38,.091,.090,.094],[.49,.095,.092,.101],
  [.62,.096,.087,.103],[.73,.096,.093,.101],[.83,.089,.091,.096],
  [.91,.075,.078,.082],[.97,.051,.055,.058],[1,.002,.002,.002],
];
const bump=(x,y,cx,cy,rx,ry)=>Math.exp(-(((x-cx)/rx)**2)-((y-cy)/ry)**2);
export function createFace(appearance,silhouette,material){
  const cell=appearance.face??0;
  const traits={...faces[cell],...appearance.sculpt};
  const vertices=[],uv=[],indices=[];
  const columns=80, rows=52;
  for(let i=0;i<=rows;i++){
    const t=i/rows;
    let k=1;while(k<contour.length-1 && contour[k][0]<t) k++;
    const a=contour[k-1],b=contour[k], u=(t-a[0])/(b[0]-a[0]);
    const interp=j=>T.MathUtils.lerp(a[j],b[j],u);
    const width=interp(1)*(1+(traits.jaw-1)*Math.exp(-(((t-.18)/.22)**2)));
    for(let j=0;j<=columns;j++){
      const angle=j*Math.PI*2/columns-Math.PI;
      const sin=Math.sin(angle), cos=Math.cos(angle);
      const x=width*sin;
      let z=(cos>0?interp(2):interp(3))*cos;
      if(cos>0){
        const eye=Math.abs(x);
        const nose=.039*bump(x,t,0,.43,.022,.085)+.017*bump(x,t,0,.54,.014,.16);
        const cheek=.012*bump(eye,t,.054,.42,.035,.14);
        const ridge=.012*bump(eye,t,.038,.66,.032,.070);
        const socket=-.010*bump(eye,t,.037,.58,.030,.055);
        const lips=.009*bump(x,t,0,.25,.044,.048);
        z+=(traits.nose*nose+traits.cheek*cheek+traits.brow*ridge+socket+lips)*cos;
      }
      vertices.push(x,1.466+t*.294,z);
      uv.push(j/columns,t);
      if(i<rows && j<columns){
        const v=i*(columns+1)+j;
        indices.push(v,v+1,v+columns+1,v+1,v+columns+2,v+columns+1);
      }
    }
  }
  const geo=new T.BufferGeometry();
  geo.setAttribute("position",new T.Float32BufferAttribute(vertices,3));
  geo.setAttribute("uv",new T.Float32BufferAttribute(uv,2));
  geo.setIndex(indices);geo.computeVertexNormals();
  const surface=silhouette||!paint[cell]?material(appearance.skin):
    new T.MeshStandardMaterial({map:paint[cell], roughness:.9});
  if(paint[cell] && !silhouette){
    const base=new T.Color(faces[cell].skin);
    surface.color.set(appearance.skin);
    surface.color.r/=base.r;surface.color.g/=base.g;surface.color.b/=base.b;
  }
  const face=new T.Mesh(geo,surface);face.castShadow=true;return face;
}
