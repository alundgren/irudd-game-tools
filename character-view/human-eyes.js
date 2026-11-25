import { capturedIris } from "./human-captured-portraits.js";
import * as T from "three";
import {randomStream} from "./random.js";
import {unzlibSync} from "three/addons/libs/fflate.module.js";
import stroma from "./human-iris-data.json" with {type: "json"};

// Each iris runs from a warmer ring at the pupil, through its main colour, to a dark limbal ring.
const irisTones={
  "dark brown":[[66,40,25],[88,54,33],[32,20,14]],
  brown:[[126,76,38],[130,83,47],[50,32,21]],
  hazel:[[172,119,55],[134,123,73],[56,56,39]],
  amber:[[192,131,52],[170,118,57],[84,53,27]],
  green:[[168,142,79],[114,140,96],[47,66,54]],
  grey:[[168,161,142],[146,159,168],[62,75,86]],
  blue:[[178,176,152],[120,159,194],[47,71,103]],
};
export const eyeColorNames=Object.keys(irisTones);
export const irisBaseTone = name => irisTones[name]?.[1];
// The iris radius in the iris image, where 1 is the image edge. The image carries the limbus
// and a narrow margin of white around it for the edge of the moving cornea.
export const irisRadius=.7;
const white=[224,218,211];

const seedOf=form=>(form.origin?.seed??0)>>>0;
// Dark irises are the common case. Lighter ones appear more often with lighter skin.
export function defaultEyeColor(form){
  const skin=new T.Color(form.appearance?.skin??"#b98a6c"),light=.299*skin.r+.587*skin.g+.114*skin.b;
  const draw=randomStream(seedOf(form)^0x51ed27)();
  const pale=T.MathUtils.smoothstep(light,.16,.42);
  const table=[["dark brown",.42-.3*pale],["brown",.4-.12*pale],["hazel",.1+.06*pale],["amber",.03],
    ["green",.03+.09*pale],["grey",.01+.08*pale],["blue",.01+.19*pale]];
  let total=0;for(const [,w] of table)total+=w;
  let at=draw*total;
  for(const [name,w] of table){at-=w;if(at<=0)return name;}
  return "brown";
}

const smooth=(v,a,b)=>{const t=Math.min(1,Math.max(0,(v-a)/(b-a)));return t*t*(3-2*t);};
// The front of one eye along its own axis: pupil, iris, a soft limbus and the white around it.
// It holds no light and no lid shadow. Those belong to the scene and to the socket.
const irisPatterns = [];
function stromaSampler(index, rotation) {
  const {width, height} = stroma;
  const map = irisPatterns[index] ??= unzlibSync(Uint8Array.from(atob(stroma.maps[index]), c => c.charCodeAt(0)));
  return (radius, angle) => {
    const u = (angle/(2*Math.PI) + rotation + 2)*width;
    const v = Math.min(1,Math.max(0,(radius-.31)/.69))*(height-1);
    const x = Math.floor(u)%width, y = Math.floor(v);
    const next = (x+1)%width, top = y*width, bottom = Math.min(y+1,height-1)*width;
    const fx = u-Math.floor(u), fy = v-y;
    const low = map[top+x] + fx*(map[top+next]-map[top+x]);
    const high = map[bottom+x] + fx*(map[bottom+next]-map[bottom+x]);
    return (low+fy*(high-low)-128)/110;
  };
}

export function irisPixels(name,seed=0,size=256){
  const tones=irisTones[name]??irisTones.brown,next=randomStream(seed^0x9e3779b9);
  const sample = stromaSampler(Math.floor(next()*stroma.maps.length), next());
  const pupil=irisRadius*(.31+.05*next()),out=new Uint8ClampedArray(size*size*4);
  for(let j=0;j<size;j++)for(let i=0;i<size;i++){
    const x=(i+.5)/size*2-1,y=1-(j+.5)/size*2,r=Math.hypot(x,y),angle=Math.atan2(y,x),q=r/irisRadius;
    let c=white.slice();
    if(q<1.12){
      const fibres=sample(q,angle);
      // The stroma is a shallow bowl: brightest at the collarette round the pupil, falling
      // away to the limbal ring. Its fibres are low relief, so they stay quiet.
      const body=smooth(q,.36,.66),rim=smooth(q,.66,.98),ring=Math.exp(-(((q-.46)/.09)**2)),bowl=1-.2*smooth(q,.5,.92);
      const iris=[0,1,2].map(k=>{
        let v=tones[0][k]+(tones[1][k]-tones[0][k])*body;
        v*=(1+.47*fibres*smooth(q,.29,.39)*(1-.56*rim)+.12*ring)*bowl;
        return v+(tones[2][k]-v)*rim*.88;
      });
      const hole=1-smooth(r,pupil-.035,pupil+.03);
      for(let k=0;k<3;k++)iris[k]=iris[k]*(1-hole)+[9,8,9][k]*hole;
      // The limbus is a gradient about a tenth of the iris radius wide, not a cut line. Just
      // outside it the white is a little grey, where the cornea's edge overlies it.
      const inside=1-smooth(q,.9,1.08),halo=.1*(1-smooth(q,1,1.1));
      c=c.map((v,k)=>(v*(1-halo*[1,.9,.75][k]))*(1-inside)+iris[k]*inside);
    }
    out.set(c.concat(255),(j*size+i)*4);
  }
  return out;
}
// The white of the eye as the socket shows it: faint mottling and a few fine vessels that
// grow from both corners. The lids' shadow is laid over it per head, on the mesh.
export function scleraPixels(seed=0,size=256){
  const next=randomStream(seed^0x2c1b3c6d),out=new Uint8ClampedArray(size*size*4);
  const vessels=Array.from({length:14},(_,k)=>{
    const from=k%2?1:-1,y=(next()-.5)*.7;
    return {from,y,slope:(next()-.5)*.5,reach:.25+.4*next(),wave:3+5*next(),phase:6.283*next(),gain:.5+.5*next()};
  });
  for(let j=0;j<size;j++)for(let i=0;i<size;i++){
    const x=(i+.5)/size*2-1,y=1-(j+.5)/size*2;
    const mottle=.012*(Math.sin(7.3*x+2.1*y+seed)+Math.sin(5.1*y-3.7*x+1.3*seed));
    let red=0;
    for(const v of vessels){
      const along=(v.from>0?1-x:x+1),centre=v.y+v.slope*along+.03*Math.sin(v.wave*along+v.phase);
      red=Math.max(red,v.gain*(1-smooth(along,.6*v.reach,v.reach))*(1-smooth(Math.abs(y-centre),.004,.02)));
    }
    out.set([white[0]*(1+mottle),white[1]*(1+mottle-.07*red),white[2]*(1+mottle-.09*red),255],(j*size+i)*4);
  }
  return out;
}

const cache=new Map();
function texture(pixels,width,height,srgb){
  let map;
  if(typeof document!=="undefined"){
    const canvas=document.createElement("canvas");canvas.width=width;canvas.height=height;
    canvas.getContext("2d").putImageData(new ImageData(pixels,width,height),0,0);
    map=new T.CanvasTexture(canvas);
  }else{
    map=new T.DataTexture(new Uint8Array(pixels.buffer),width,height,T.RGBAFormat);map.flipY=true;
  }
  if(srgb)map.colorSpace=T.SRGBColorSpace;
  map.anisotropy=4;map.needsUpdate=true;
  return map;
}
// One image, twice as wide as tall: the eye's front on the left and the socket's white on the right.
function eyeTexture(name,seed,complexion){
  const capture = capturedIris(complexion);
  const key="eye/"+name+"/"+seed+(capture ? "/"+complexion : "");
  if(!cache.has(key)){
    const size=256,pixels=new Uint8ClampedArray(2*size*size*4);
    const front=irisPixels(name,seed,size),back=scleraPixels(seed,size);
    if (capture) {
      const tint = (irisTones[name] ?? irisTones.brown)[1];
      const sclera = [.90,.88,.87];
      const sample = value => Math.min(capture.size-1, Math.max(0, Math.floor((value+1)*capture.size/2)));
      for (let y=0;y<size;y++) for (let x=0;x<size;x++) {
        const u=((x+.5)/size*2-1)/irisRadius, v=((y+.5)/size*2-1)/irisRadius;
        const radius=Math.hypot(u,v), coverage=1-smooth(radius,.86,1.04);
        const grain=Math.min(1.45,capture.values[sample(v)*capture.size+sample(u)]/142);
        const offset=4*(y*size+x);
        for (let k=0;k<3;k++) {
          const iris=(radius<.29 ? 12 : tint[k]*(.40+.50*smooth(radius,.29,.46)))*grain;
          front[offset+k] = coverage*iris + (1-coverage)*front[offset+k]*sclera[k];
          back[offset+k] *= sclera[k];
        }
      }
    }
    for(let j=0;j<size;j++){
      pixels.set(front.subarray(j*size*4,(j+1)*size*4),j*2*size*4);
      pixels.set(back.subarray(j*size*4,(j+1)*size*4),(j*2+1)*size*4);
    }
    cache.set(key,texture(pixels,2*size,size,true));
  }
  return cache.get(key);
}
// The cornea is the smoothest surface on the head. The white is moist but far more diffuse.
export const eyeRoughness={cornea:.26,white:.5};
function roughnessTexture(){
  if(!cache.has("eye/roughness")){
    const size=128,pixels=new Uint8ClampedArray(2*size*size*4);
    for(let j=0;j<size;j++)for(let i=0;i<2*size;i++){
      const x=(i+.5)/size*2-1,y=1-(j+.5)/size*2,q=Math.hypot(x,y)/irisRadius;
      // Top band of the sclera half (v > 0.87, unused by the sclera mesh) carries the wet tear meniscus roughness.
      const meniscus=i>=size&&(j+.5)/size<.13;
      const wet=i<size?1-smooth(q,1,1.1):0,value=meniscus?.15:eyeRoughness.white+(eyeRoughness.cornea-eyeRoughness.white)*wet;
      pixels.set([255,Math.round(255*value),0,255],(j*2*size+i)*4);
    }
    cache.set("eye/roughness",texture(pixels,2*size,size,false));
  }
  return cache.get("eye/roughness");
}

/* The opening the lids leave over the ball, as a viewer in front of the face sees it. A lid's
   edge can stand a few millimetres proud of the ball and overhang it, so the opening is read
   from what the lid skin covers: every point of the ball's front that has skin before it is
   closed. `a` runs across one eye from the nose side outward and `y` runs up, both from the
   ball's centre. */
export function lidOpening(skin,centre,radius,side){
  const p=skin.geometry.attributes.position.array,index=skin.geometry.index.array;
  const wide=192,tall=128,spanA=1.02*radius,spanY=.68*radius,cellA=2*spanA/wide,cellY=2*spanY/tall;
  // The ball's depth at each cell, then the frontmost skin over it.
  const open=new Uint8Array(wide*tall),ball=new Float32Array(wide*tall);
  for(let j=0;j<tall;j++)for(let i=0;i<wide;i++){
    const a=-spanA+(i+.5)*cellA,y=-spanY+(j+.5)*cellY,d=radius*radius-a*a-y*y;
    ball[j*wide+i]=d>0?Math.sqrt(d):Infinity;open[j*wide+i]=d>0?1:0;
  }
  const points=[[0,0,0],[0,0,0],[0,0,0]];
  for(let t=0;t<index.length;t+=3){
    let near=true;
    for(let e=0;e<3&&near;e++){
      const i=index[t+e],c=points[e];
      c[0]=side*(p[i*3]-centre.x);c[1]=p[i*3+1]-centre.y;c[2]=p[i*3+2]-centre.z;
      near=Math.abs(c[0])<2*radius&&Math.abs(c[1])<2*radius&&c[2]>-.2*radius;
    }
    if(!near)continue;
    const [u,v,w]=points,area=(v[0]-u[0])*(w[1]-u[1])-(w[0]-u[0])*(v[1]-u[1]);
    if(Math.abs(area)<1e-14)continue;
    const i0=Math.max(0,Math.floor((Math.min(u[0],v[0],w[0])+spanA)/cellA)),i1=Math.min(wide-1,Math.floor((Math.max(u[0],v[0],w[0])+spanA)/cellA));
    const j0=Math.max(0,Math.floor((Math.min(u[1],v[1],w[1])+spanY)/cellY)),j1=Math.min(tall-1,Math.floor((Math.max(u[1],v[1],w[1])+spanY)/cellY));
    for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++){
      if(!open[j*wide+i])continue;
      const a=-spanA+(i+.5)*cellA,y=-spanY+(j+.5)*cellY;
      const f=((v[0]-a)*(w[1]-y)-(w[0]-a)*(v[1]-y))/area,g=((w[0]-a)*(u[1]-y)-(u[0]-a)*(w[1]-y))/area,h=1-f-g;
      if(f<0||g<0||h<0)continue;
      if(f*u[2]+g*v[2]+h*w[2]>ball[j*wide+i])open[j*wide+i]=0;
    }
  }
  // In each column the opening is the tallest open run.
  const low=new Float32Array(wide).fill(NaN),high=new Float32Array(wide).fill(NaN);
  let first=-1,last=-1;
  for(let i=0;i<wide;i++){
    let best=0,from=0,run=0;
    for(let j=0;j<=tall;j++){
      if(j<tall&&open[j*wide+i]){run++;continue;}
      if(run>best){best=run;from=j-run;}
      run=0;
    }
    if(best<2||best===tall)continue;
    low[i]=-spanY+from*cellY;high[i]=-spanY+(from+best)*cellY;
    if(first<0)first=i;last=i;
  }
  if(first<0||last-first<12)return null;
  // Keep the run of columns that holds the widest part, should stray openings lie beside it.
  let widest=first;
  for(let i=first;i<=last;i++)if(high[i]-low[i]>(high[widest]-low[widest]||0))widest=i;
  first=last=widest;
  while(first>0&&!Number.isNaN(low[first-1]))first--;
  while(last<wide-1&&!Number.isNaN(low[last+1]))last++;
  const inner=-spanA+first*cellA,outer=-spanA+(last+1)*cellA;
  const columns=33,bottom=new Float32Array(columns),top=new Float32Array(columns);
  for(let k=0;k<columns;k++){
    const at=first+(last-first)*k/(columns-1),i=Math.floor(at),f=at-i,j=Math.min(last,i+1);
    bottom[k]=low[i]+(low[j]-low[i])*f;top[k]=high[i]+(high[j]-high[i])*f;
  }
  const lerp=(values,a)=>{
    const f=T.MathUtils.clamp((a-inner)/(outer-inner)*columns-.5,0,columns-1),k=Math.min(columns-2,Math.floor(f));
    return values[k]+(values[k+1]-values[k])*(f-k);
  };
  // Past either corner the lids are closed on the corner's own height.
  const corner=k=>(bottom[k]+top[k])/2,close=a=>smooth(a,inner,inner+(outer-inner)/columns)*(1-smooth(a,outer-(outer-inner)/columns,outer));
  const at=a=>{
    const edge=a<(inner+outer)/2?corner(0):corner(columns-1),open=close(a);
    return [edge+(lerp(bottom,a)-edge)*open,edge+(lerp(top,a)-edge)*open];
  };
  return {inner,outer,at};
}
/* The ball each eye turns on, fitted to the base head's own eye vertices. Those cover the front
   of a sphere and a cornea bulge, so their bounding box is neither centred on the sphere nor
   as deep as it. Points that stand off the fitted sphere, the bulge, are left out and it is
   fitted again. */
export function eyeBalls(s,origin=[0,0,0]){
  return s.eyeGroups.map(ids=>{
    let use=Array.from(ids),centre=null,radius=0;
    for(let pass=0;pass<4&&use.length>=8;pass++){
      // Least squares for |p|^2 = 2 c.p + k, about the points' mean to keep it well conditioned.
      const mean=[0,0,0];
      for(const id of use)for(let d=0;d<3;d++)mean[d]+=s.positions[id*3+d]/use.length;
      const m=new Float64Array(16),rhs=new Float64Array(4);
      for(const id of use){
        const q=[0,1,2].map(d=>s.positions[id*3+d]-mean[d]),row=[2*q[0],2*q[1],2*q[2],1],value=q[0]*q[0]+q[1]*q[1]+q[2]*q[2];
        for(let i=0;i<4;i++){rhs[i]+=row[i]*value;for(let j=0;j<4;j++)m[i*4+j]+=row[i]*row[j];}
      }
      for(let i=0;i<4;i++){
        let pivot=i;for(let r=i+1;r<4;r++)if(Math.abs(m[r*4+i])>Math.abs(m[pivot*4+i]))pivot=r;
        if(pivot!==i){for(let j=0;j<4;j++)[m[i*4+j],m[pivot*4+j]]=[m[pivot*4+j],m[i*4+j]];[rhs[i],rhs[pivot]]=[rhs[pivot],rhs[i]];}
        for(let r=0;r<4;r++){
          if(r===i||!m[i*4+i])continue;
          const f=m[r*4+i]/m[i*4+i];
          for(let j=0;j<4;j++)m[r*4+j]-=f*m[i*4+j];rhs[r]-=f*rhs[i];
        }
      }
      const c=[0,1,2].map(i=>rhs[i]/m[i*5]);
      radius=Math.sqrt(rhs[3]/m[15]+c[0]*c[0]+c[1]*c[1]+c[2]*c[2]);
      centre=c.map((v,d)=>v+mean[d]);
      const far=id=>Math.hypot(...[0,1,2].map(d=>s.positions[id*3+d]-centre[d]))-radius;
      const kept=use.filter(id=>far(id)<.012*radius);
      if(kept.length===use.length)break;
      use=kept;
    }
    return {centre:new T.Vector3(centre[0]-origin[0],centre[1]-origin[1],centre[2]-origin[2]),radius};
  });
}
// Without a face to read, a plain almond.
function almond(radius){
  const inner=-.66*radius,outer=.7*radius;
  return {inner,outer,at(a){
    const t=T.MathUtils.clamp((a-inner)/(outer-inner),0,1),arch=Math.sin(Math.PI*t)**.8;
    return [-.19*radius*arch-.02*radius,.25*radius*arch-.02*radius];
  }};
}

/* The colour the socket lays over the ball at one point of the opening, as a multiplier on
   the white. Distances are millimetres on an average adult head. The brow and lids hide part
   of the sky from the whole eye; the upper lid and its lashes shade a band below it; the
   lower lid leaves a narrow contact line; both corners close in and turn pink; and the nose
   corner carries the caruncle. */
export function socketTint(above,below,fromInner,fromOuter,look){
  const hidden=Math.max(smooth(-above,0,.8),smooth(-below,0,.8));
  const lid=Math.exp(-Math.max(above,0)/1.5),lashes=Math.exp(-Math.max(above,0)/3.8),low=Math.exp(-Math.max(below,0));
  // The upper lid is about a millimetre thick and carries the lash roots, so right under its
  // edge the ball is nearly dark. The lower lid's edge is a moist ledge that faces up: it reads
  // as a pale pink line between the lashes and the white, and takes the shadow's place there.
  const margin=Math.exp(-((Math.max(above,0)/.62)**2)),ledge=look.rim?(1-smooth(below,.45,1.05))*(1-smooth(-below,.1,.5)):0;
  const shade=look.sky*(1-.58*lid)*(1-.32*lashes)*(1-.48*margin)*(1-.36*low*(1-ledge))*(1-.45*hidden);
  const near=Math.max(lid,low),flesh=1-smooth(fromInner,.7,2.4),pink=.3*(1-smooth(fromOuter,0,3.2))+.16*near;
  const tone=[1,1,1].map((v,k)=>{
    v*=1-pink*[0,.2,.24][k];
    v+=(look.flesh[k]-v)*flesh;
    if(ledge)v+=(look.rim[k]-v)*.8*ledge*(1-flesh);
    return v*look.cast[k];
  });
  return tone.map(v=>v*shade);
}
function socketLook(form){
  const skin=new T.Color(form.appearance?.skin??"#b98a6c"),age=T.MathUtils.clamp(form.human?.age??0,0,1);
  // Light reaches the ball off the lids and cheek, so the white takes a little of the skin's
  // colour. It also yellows slightly with age.
  const cast=[skin.r,skin.g,skin.b].map((v,k)=>(1-.1+.1*Math.min(1,v/Math.max(skin.r,1e-3)))*[1,1-.02*age,1-.07*age][k]);
  const flesh=[.6,.3,.27].map((v,k)=>v*(.7+.3*Math.min(1,[skin.r,skin.g,skin.b][k]/Math.max(skin.r,1e-3))));
  // The lid's inner edge is the skin's own colour, thinned and reddened.
  const rim=[.82,.5,.46].map((v,k)=>v*(.62+.38*Math.min(1,[skin.r,skin.g,skin.b][k]/Math.max(skin.r,1e-3))));
  return {sky:.84,cast,flesh,rim};
}

const gazeTargets=[["LookLeft",1,.32],["LookRight",1,-.32],["LookUp",0,-.23],["LookDown",0,.23]];
// Anatomical sizes in metres on a 1.72 m adult: the visible iris, how much of the opening it
// spans, and how far the upper lid normally overlaps it.
const anatomy={iris:[.0108,.0124],irisOfOpening:.5,lidCover:.00215,coverShare:.78,pupilClear:.00055,sink:.0003,cornea:7.8/11.7,
  // Share of the cornea's radius its normals are drawn with at the apex. See `humanEyes`.
  glint:.56};

/* Both eyes as one mesh. Each eye has a strip of white fixed in the socket, which carries the
   lids' shadow, and the front of the eye as a cap that alone turns with the gaze: cornea dome,
   iris, limbus and a margin of white lying on the ball. The cap's surface joins the ball's, so
   a highlight on it comes from the scene's lights and its shape. */
export function humanEyes(skin,centres,material,plain,form,scale=1){
  const look=socketLook(form),mm=.001*scale;
  const fits=centres.map(({centre,radius})=>{
    const side=centre.x>=0?1:-1,ball=radius-anatomy.sink*scale;
    const opening=(skin&&lidOpening(skin,centre,ball,side))||almond(ball);
    const width=opening.outer-opening.inner;
    const iris=T.MathUtils.clamp(anatomy.irisOfOpening*width,anatomy.iris[0]*scale,anatomy.iris[1]*scale);
    const a=opening.inner+.485*width;
    let bottom=0,top=0;
    for(const f of [-.25,0,.25]){const [b,t]=opening.at(a+f*iris);bottom+=b/3;top+=t/3;}
    // The upper lid takes most of what the opening cannot show, as it does on a face at rest:
    // it rests on the iris and stays clear of the pupil, and the lower lid meets the lower limbus.
    const most=iris/2-.36*iris/2-anatomy.pupilClear*scale;
    const cover=Math.min(most,Math.max(anatomy.coverShare*(iris-(top-bottom)),anatomy.lidCover*scale));
    return {centre,side,ball,opening,iris,a,y:top+cover-iris/2};
  });
  // Both eyes look the same way: a shared height, and the same turn toward the nose.
  const pitch=fits.reduce((sum,f)=>sum+Math.asin(T.MathUtils.clamp(f.y/f.ball,-.6,.6)),0)/fits.length;
  const turn=fits.reduce((sum,f)=>sum+Math.asin(T.MathUtils.clamp(f.a/f.ball,-.6,.6)),0)/fits.length;
  const position=[],normal=[],uv=[],colour=[],index=[],moving=[],domed=[];
  const v=new T.Vector3(),n=new T.Vector3();
  for(const fit of fits){
    const {centre,side,ball,opening}=fit,start=position.length/3;
    // The moving front is shaded for where it rests. What rests under a lid can turn into
    // view, so there it keeps the shade of the lid's edge and no more.
    const tint=(a,y,least=-Infinity)=>{
      const [bottom,top]=opening.at(a);
      return socketTint(Math.max(least,(top-y)/mm),Math.max(least,(y-bottom)/mm),(a-opening.inner)/mm,(opening.outer-a)/mm,look);
    };
    // A wide opening on a small ball reaches round its side. The strip stops short of the ball's outline.
    const onBall=(a,y,r)=>{
      const out=Math.hypot(a,y),keep=Math.min(1,.96*r/Math.max(out,1e-9));
      return v.set(side*a*keep,y*keep,Math.sqrt(r*r-(out*keep)**2));
    };
    // The socket's strip. Its rows follow both lids, close together where the shading changes.
    const across=[-2.6,-.2,.6,1.6,2.8].map(d=>opening.inner+d*mm);
    const inner=across.at(-1),far=opening.outer-2.8*mm,spans=5;
    for(let k=1;k<spans;k++)across.push(inner+(far-inner)*k/spans);
    for(const d of [-2.8,-1.4,-.4,.2,2.6])across.push(opening.outer+d*mm);
    const rows=9;
    across.forEach((a,i)=>{
      const [bottom,top]=opening.at(a),h=Math.max(0,top-bottom);
      // The rows reach under both lids: a lid that stands proud shows the ball beneath it from below.
      const ys=[bottom-2.6*mm,bottom-.2*mm,bottom+Math.min(.4*mm,.12*h),bottom+Math.min(1.2*mm,.3*h),
        top-Math.min(2.6*mm,.45*h),top-Math.min(1.3*mm,.28*h),top-Math.min(.5*mm,.1*h),top+.2*mm,top+1.8*mm];
      for(const y of ys){
        onBall(a,y,ball);
        position.push(centre.x+v.x,centre.y+v.y,centre.z+v.z);
        n.copy(v).normalize();normal.push(n.x,n.y,n.z);
        uv.push(.75+.22*a/ball,.5+.44*y/ball);
        colour.push(...(plain?[1,1,1]:tint(a,y)));moving.push(0);domed.push(-1);
      }
      if(!i)return;
      for(let r=0;r<rows-1;r++){
        const p=start+(i-1)*rows+r,q=start+i*rows+r;
        if(side>0)index.push(p,q,q+1,p,q+1,p+1);else index.push(p,q+1,q,p,p+1,q+1);
      }
    });
    // Fitted 3D lower tear meniscus / wet edge along the edited lower lid opening.
    // Stationary in the socket (never turns with gaze), with upward-tilted normals and glossy
    // meniscus roughness so overhead light catches a genuine moist lower-lid waterline.
    const outer=ball+anatomy.sink*scale;
    const mStart=position.length/3,mCols=9,mA0=opening.inner+1.1*mm,mA1=opening.outer-.9*mm;
    for(let i=0;i<mCols;i++){
      const t=i/(mCols-1),a=mA0+(mA1-mA0)*t,[bottom]=opening.at(a);
      const endFade=smooth(t,0,.18)*(1-smooth(t,.82,1));
      const baseC=plain?[1,1,1]:tint(a,bottom+.25*mm);
      for(let r=0;r<2;r++){
        const y=bottom+(r?.58:-.14)*mm,rad=outer+(r?.05:.24)*mm;
        onBall(a,y,rad);
        position.push(centre.x+v.x,centre.y+v.y,centre.z+v.z);
        n.copy(v).normalize();
        n.y+=r?.52:.78;n.normalize();
        normal.push(n.x,n.y,n.z);
        uv.push(.62+.26*t,.94);
        const moist=plain?[1,1,1]:baseC.map((c,k)=>{
          const rimCol=look.rim?look.rim[k]*.55+.45*[.94,.86,.84][k]:[.88,.84,.82][k];
          return T.MathUtils.clamp(c+(rimCol*look.sky-c)*(.55-.2*r)*endFade,0,1);
        });
        colour.push(...moist);moving.push(0);domed.push(-1);
      }
      if(!i)continue;
      const p=mStart+(i-1)*2,q=mStart+i*2;
      if(side>0)index.push(p,q,q+1,p,q+1,p+1);else index.push(p,q+1,q,p,p+1,q+1);
    }
    // The front of the eye, built about its own axis and then turned to where it rests.
    const first=position.length/3,r=fit.iris/2,corneal=anatomy.cornea*fit.iris;
    const seat=Math.sqrt(outer*outer-r*r)-Math.sqrt(corneal*corneal-r*r);
    // The front carries as little white as its soft edge allows: white that turns with the gaze
    // takes its resting shade along.
    const rings=[.3,.42,.62,.82,.95,1.03,1.08,1.13],around=16;
    const height=q=>{
      const rho=q*r,sphere=Math.sqrt(outer*outer-rho*rho);
      let z=q<1.03?Math.max(sphere,seat+Math.sqrt(corneal*corneal-rho*rho)):sphere;
      // Clay has no paint, so the iris is cut in as a shallow dish with a deeper pupil.
      if(plain)z-=ball*((1-smooth(q,.78,.97))*(.05+.07*Math.max(0,1-q*q))+.07*(1-smooth(q,.32,.44)));
      return z;
    };
    const aim=new T.Quaternion().setFromEuler(new T.Euler(-pitch,side*turn,0,"YXZ"));
    const place=(q,angle)=>{
      v.set(q*r*Math.cos(angle),q*r*Math.sin(angle),height(q)).applyQuaternion(aim);
      const a=side*v.x;
      // Subtle corneal-bowl vertical light transmission: upper iris sits deeper under orbital shadow
      // while lower-middle iris catches overhead light focused through the curved cornea.
      const bowlBias=1-.11*Math.sin(angle)*(1-smooth(q,.72,1));
      const shade=plain?[1,1,1]:[-.25,0,.25].reduce((sum,d)=>{
        const c=tint(a,v.y+d*mm,.25);return sum.map((s,k)=>s+c[k]/3);
      },[0,0,0]).map(c=>T.MathUtils.clamp(c*bowlBias,0,1));
      position.push(centre.x+v.x,centre.y+v.y,centre.z+v.z);
      uv.push(.25+.25*q*irisRadius*Math.cos(angle),.5+.5*q*irisRadius*Math.sin(angle));
      colour.push(...shade);moving.push(1);normal.push(0,0,0);domed.push(q<1.03?q:-1);
    };
    place(0,0);
    rings.forEach((q,j)=>{
      for(let k=0;k<around;k++)place(q,(k+.5*(j%2))/around*2*Math.PI);
      for(let k=0;k<around;k++){
        const b=first+1+j*around+k,c=first+1+j*around+(k+1)%around;
        if(!j){index.push(first,b,c);continue;}
        const shift=j%2?0:-1,p=first+1+(j-1)*around+(k+around+shift+1)%around,q2=first+1+(j-1)*around+(k+around+shift)%around;
        index.push(q2,b,p,p,b,c);
      }
    });
    fit.first=first;fit.count=position.length/3-first;
  }
  const geometry=new T.BufferGeometry();
  geometry.setAttribute("position",new T.Float32BufferAttribute(position,3));
  geometry.setAttribute("uv",new T.Float32BufferAttribute(uv,2));
  if(!plain)geometry.setAttribute("color",new T.Float32BufferAttribute(colour,3));
  geometry.setIndex(index);
  // The strip keeps the ball's own normals. The cap takes its shape's, and its rim the ball's.
  geometry.computeVertexNormals();
  const made=geometry.attributes.normal;
  for(const fit of fits){
    const rim=fit.first+fit.count-16;
    for(let i=rim;i<fit.first+fit.count;i++){
      n.fromBufferAttribute(geometry.attributes.position,i).sub(fit.centre).normalize();made.setXYZ(i,n.x,n.y,n.z);
    }
  }
  for(let i=0;i<moving.length;i++)if(!moving[i])made.setXYZ(i,normal[i*3],normal[i*3+1],normal[i*3+2]);
  /* The highlight in the eye is the scene's light reflected by the cornea. A light above the
     head reflects from high on a true cornea, under the upper lid, and a baked file has no sky
     to reflect lower down. So the cornea's normals, not its surface, are those of a steeper
     dome about the same axis: the same light then shows in the upper iris, clear of the lid,
     and still moves with the light, the viewer and the gaze. The rim keeps its true normals. */
  if(!plain)for(const fit of fits){
    const axis=n.fromBufferAttribute(made,fit.first).clone(),apex=new T.Vector3().fromBufferAttribute(geometry.attributes.position,fit.first);
    const corneal=anatomy.cornea*fit.iris;
    for(let i=fit.first+1;i<fit.first+fit.count;i++){
      const q=domed[i];if(q<0)continue;
      v.fromBufferAttribute(geometry.attributes.position,i).sub(apex);v.addScaledVector(axis,-v.dot(axis));
      const rho=v.length(),share=anatomy.glint+(1-anatomy.glint)*smooth(q,.4,1),sine=Math.min(.94,rho/(corneal*share));
      if(rho<1e-9)continue;
      v.multiplyScalar(sine/rho).addScaledVector(axis,Math.sqrt(1-sine*sine));
      // Join the true normal toward the rim, where the dome meets the white.
      const keep=smooth(q,.86,1.03);n.fromBufferAttribute(made,i);
      v.lerp(n,keep).normalize();made.setXYZ(i,v.x,v.y,v.z);
    }
  }
  geometry.morphTargetsRelative=true;
  const turned=gazeTargets.map(([name,axis,angle])=>{
    const shift=new Float32Array(position.length),lean=new Float32Array(position.length);
    const from=new T.Vector3(),a=new T.Vector3().setComponent(axis,1);
    for(const fit of fits)for(let i=fit.first;i<fit.first+fit.count;i++){
      from.fromBufferAttribute(geometry.attributes.position,i);
      v.copy(from).sub(fit.centre).applyAxisAngle(a,angle).add(fit.centre).sub(from).toArray(shift,i*3);
      from.fromBufferAttribute(made,i);
      v.copy(from).applyAxisAngle(a,angle).sub(from).toArray(lean,i*3);
    }
    const moved=new T.BufferAttribute(shift,3),leaned=new T.BufferAttribute(lean,3);
    moved.name=leaned.name=name;
    return [moved,leaned];
  });
  geometry.morphAttributes.position=turned.map(pair=>pair[0]);
  // The cap's normals turn with it, so its highlight stays where the light puts it.
  geometry.morphAttributes.normal=turned.map(pair=>pair[1]);
  const m=material("#ffffff").clone();
  if(!plain){
    m.map=eyeTexture(form.eyeColor??defaultEyeColor(form),seedOf(form)%64,form.complexion);
    m.roughnessMap=roughnessTexture();m.roughness=1;m.metalness=0;m.vertexColors=true;
  }
  const mesh=new T.Mesh(geometry,m);mesh.name="high-poly";mesh.userData.eyePiece="Iris";
  // How each eye was fitted, for tests and measurement. Kept off userData, which exports.
  mesh.eyeFits=fits.map(f=>({side:f.side,centre:f.centre.clone(),ball:f.ball,iris:f.iris,opening:f.opening,first:f.first,count:f.count,pitch,turn}));
  return mesh;
}
