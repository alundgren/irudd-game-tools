import { capturedSkinNames, capturedSkin } from "./human-captured-portraits.js";
import beardScan from "./human-clipped-beard-data.json" with {type:"json"};
import castSkin from "./human-cast-skin-data.json" with {type:"json"};
import shavedScan from "./human-shaved-scan-data.json" with {type:"json"};
import {beardRootTone,shortBeardCover,shortBeardRoot,shortBeardGrowth} from "./human-beard-texture.js";
import { fittedBrow } from "./human-brow-styles.js";
import * as T from "three";
import {unzlibSync} from "three/addons/libs/fflate.module.js";
import seafarer from "./human-seafarer-data.json" with {type:"json"};
import data from "./human-complexion-data.json" with {type:"json"};
import browLayout from "./human-brow-paint.json" with {type:"json"};
import bodyRelief from "./human-body-relief.json" with { type: "json" };
import dermalData from "./human-dermal-data.json" with { type: "json" };
import { expressionLines } from "./human-dermal.js";
import registeredPigment from "./human-facial-pigment-data.json" with {type:"json"};
import finishData from "./human-portrait-finish-data.json" with {type:"json"};
import visibility from "./human-face-visibility.json" with {type:"json"};
import {randomStream} from "./random.js";
import {facialHairStyle,growthAt} from "./human-face-hair.js";
import {browPigment,makeupPalette,mixMakeup} from "./human-makeup.js";
import {photoDetail,photoDetailNames,skinPigment} from "./human-photo-detail.js";

export const complexionNames=["Smooth","Fine","Weathered","Lined","Soft lines",...photoDetailNames,"Weathered scars","Shaved complexion",...Object.keys(castSkin).map(k=>"Portrait "+k), ...capturedSkinNames];
const layout=2048,density=2;
export const detailEncoding="signed-detail";
if(data.encoding?.name!==detailEncoding||data.encoding.neutral!==128)
  throw new Error("human-complexion-data.json is not packed as "+detailEncoding+". Run scripts/pack-human-complexion.py.");
const [left,top,right,bottom]=data.rect,width=right-left,height=bottom-top;
const sources={maps:[],fields:[],pigment:[],dermal:[],brows:{},finish:null},painted=new Map();
export const finishEncoding="portrait-finish-v1";
if(finishData.encoding?.name!==finishEncoding||finishData.encoding.neutral!==128)
  throw new Error("human-portrait-finish-data.json is not packed as "+finishEncoding+". Run scripts/pack-human-portrait-finish.py.");

function canvasOf(w,h){const c=document.createElement("canvas");c.width=w;c.height=h;return c;}
async function pixelsOf(url){
  const image=new Image();image.src=url;await image.decode();
  const c=canvasOf(width,height).getContext("2d",{willReadFrequently:true});
  c.drawImage(image,0,0,width,height);
  return c.getImageData(0,0,width,height).data;
}
export async function loadComplexions(){
  if(typeof document==="undefined"||sources.fields.length)return;
  const loadBrow = async ([name, entry]) => {
    const image = new Image();
    image.src = entry.url;
    await image.decode();
    return [name, image];
  };
  const loadBody = async () => {
    const loader = new T.TextureLoader();
    const [normalMap, roughnessMap] = await Promise.all([bodyRelief.normal,bodyRelief.roughness].map(url => loader.loadAsync(url)));
    normalMap.anisotropy = roughnessMap.anisotropy = 4;
    return { normalMap, roughnessMap };
  };
  const loadFinish=async()=>{
    const decoded=async url=>{const image=new Image();image.src=url;await image.decode();return image;};
    const [donors,micro,meso,gloss,lips]=await Promise.all([Promise.all(finishData.maps.map(decoded)),
      ...[finishData.micro,finishData.meso,finishData.gloss,finishData.lips].map(pixelsOf)]);
    return {donors,micro,meso,gloss,lips,pixels:new Map()};
  };
  const [maps,fields,pigment,dermal,brows,body,finish]=await Promise.all([
    ...[data.maps,[...data.fields,visibility.map],registeredPigment.maps,dermalData.maps].map(list=>Promise.all(list.map(pixelsOf))),
    Promise.all(Object.entries(browLayout).map(loadBrow)), loadBody(), loadFinish()
  ]);
  [sources.seafarer, sources.scanColour, sources.scanSurface] = await Promise.all([seafarer.url, shavedScan.colour, shavedScan.surface].map(pixelsOf));
  sources.castSkin=Object.fromEntries(await Promise.all(Object.entries(castSkin).map(async ([name,donor])=>[
    "Portrait "+name, await Promise.all([donor.paint,donor.surface].map(pixelsOf))
  ])));
  sources.captured = Object.fromEntries(await Promise.all(capturedSkinNames.map(async name => {
    const { paint, surface } = capturedSkin(name);
    return [name, await Promise.all([paint, surface].map(pixelsOf))];
  })));
  sources.clippedBeard=await pixelsOf(beardScan.url);
  sources.finish=finish;
  sources.maps=maps;sources.fields=fields;sources.pigment=pigment;sources.dermal=dermal;
  sources.brows=Object.fromEntries(brows);
  sources.body=body;
}
function points(encoded){
  const bytes=unzlibSync(Uint8Array.from(atob(encoded),c=>c.charCodeAt(0)));
  return Float32Array.from(new Uint16Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/2),v=>v/65535);
}
const mix=(a,b,t)=>a+(b-a)*t;
const clamp=(v,lo,hi)=>Math.min(hi,Math.max(lo,v));
const smooth=(v,a,b)=>{const t=clamp((v-a)/(b-a),0,1);return t*t*(3-2*t);};
const srgbDecode=Float64Array.from({length:256},(_,i)=>{const v=i/255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;});
const srgbEncode=v=>{const c=clamp(v,0,1);return 255*(c<=.0031308?12.92*c:1.055*c**(1/2.4)-.055);};
const srgbUnitToLinear=v=>{const c=clamp(v,0,1.5);return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;};
const headGain=1.46;
export const portraitRead={pigment:1.6,planes:.8,blush:.85,lip:.5,lipDonor:.5,lid:.34,socket:.42,under:.8,browMass:.34,browInk:1.35,lash:1};
export function headroomForSkin(skin,gain=headGain){
  const c=skin?.isColor?skin:new T.Color(skin??"#b08566");
  const channels=[c.r,c.g,c.b],neutral=[255,255,255],base=[c.r,c.g,c.b];
  for(let k=0;k<3;k++){
    const v=channels[k];
    if(v<=1e-4)continue;
    const wanted=Math.min(1,v*gain);
    if(wanted<=v*1.0001)continue;
    const byte=Math.max(1,Math.floor(srgbEncode(v/wanted)));
    neutral[k]=byte;
    base[k]=v/srgbDecode[byte];
  }
  return {neutral,base};
}
function tintOn(skin,target){
  const encode=v=>Math.round(255*(v<=.0031308?12.92*v:1.055*v**(1/2.4)-.055));
  return [target.r/Math.max(skin.r,.01),target.g/Math.max(skin.g,.01),target.b/Math.max(skin.b,.01)].map(v=>encode(Math.min(1,v)));
}

const ageComplexion=age=>age>.63?"Soft lines":age>.35?"Weathered":"Fine";

const detailPresets={
  Smooth:{poreRelief:.24,wrinkleRelief:0,wrinkleShade:0,mottleAmp:.42,dryness:-.015},
  Fine:{poreRelief:.76,wrinkleRelief:.32,wrinkleShade:.26,mottleAmp:.78,dryness:0},
  Weathered:{poreRelief:.92,wrinkleRelief:.68,wrinkleShade:.48,mottleAmp:.94,dryness:.03},
  Lined:{poreRelief:.95,wrinkleRelief:1,wrinkleShade:.68,mottleAmp:.9,dryness:.05},
  "Soft lines":{poreRelief:.82,wrinkleRelief:.78,wrinkleShade:.54,mottleAmp:.84,dryness:.04},
};

export function complexionProfile({choice,ageDetail,skin,age=0,frame=0}={}){
  const c=skin?.isColor?skin:new T.Color(skin??"#b08566");
  const light=.2126*c.r+.7152*c.g+.0722*c.b;
  const fair=smooth(light,.05,.45);
  const naturalHue=smooth(c.r-c.g,-.02,.05)*smooth(c.g-c.b,-.04,.03);
  const clampedAge=clamp(age,0,1);
  const baseName=detailPresets[choice]?choice:detailPresets[ageDetail]?ageDetail:ageComplexion(clampedAge);
  const preset=detailPresets[baseName];
  const bodyRoughness=clamp(mix(.69,.64,fair)+.04*clampedAge+preset.dryness*.45,.58,.76);
  const faceRoughness=clamp(mix(.64,.56,fair)+.045*clampedAge+preset.dryness*.55,.52,.73);
  const shineDrop=mix(.095,.125,fair)*(1-.18*clampedAge);
  const lipRoughness=clamp(faceRoughness-.035,.5,.68);
  return {
    light,fair,naturalHue,age:clampedAge,baseName,
    bodyRoughness,faceRoughness,shineDrop,lipRoughness,
    lidRoughnessDrop:.042,
    microRoughAmp:mix(.030,.044,fair),
    poreRelief:preset.poreRelief,
    wrinkleRelief:preset.wrinkleRelief,
    wrinkleShade:preset.wrinkleShade*mix(.85,1,fair),
    mottleAmp:preset.mottleAmp*mix(.78,1,fair),
    blushG:mix(.042,.074,fair)*(1-.22*clampedAge),
    blushB:mix(.046,.070,fair)*(1-.22*clampedAge),
    lipTint:[mix(.9,mix(.88,.95,fair),naturalHue),mix(.84,mix(.8,.83,fair),naturalHue),mix(.86,mix(.82,.84,fair),naturalHue)],
    lidTint:[mix(.93,.92,fair),mix(.86,.84,fair),mix(.86,.85,fair)],
    socketTint:[mix(.9,.88,fair),mix(.84,.8,fair),mix(.85,.82,fair)],
    underTint:[mix(.93,.905,fair),mix(.90,.87,fair),mix(.90,.895,fair)],
    beard:Math.min(.20,Math.max(0,frame-.24)*.28),
  };
}

export function detailTint(r,g,b,profile,skinArea=1,open=1,lids=0){
  const pore=(r-128)/96,wrinkle=(g-128)/96,mottle=(b-128)/88;
  const mv=mottle*profile.mottleAmp*skinArea;
  const crease=Math.min(0,wrinkle)*profile.wrinkleShade*open*(1-lids*.5);
  const poreWhisper=1+.014*Math.min(0,pore)*profile.poreRelief*skinArea;
  return [
    (mv<0?1+.024*mv:1)*(1+.10*crease)*poreWhisper,
    (mv<0?1+.006*mv:1-.032*mv)*(1+.16*crease)*poreWhisper,
    (mv<0?1+.014*mv:1-.038*mv)*(1+.18*crease)*poreWhisper,
  ];
}

export function pigmentTint(r,g,b,profile,strength=1){
  if(r===128&&g===128&&b===128||strength<=0)return [1,1,1];
  const scales=registeredPigment.scales??{lumPos:.28,lumNeg:.34,rg:.22,yb:.22};
  const rawL=(r-128)/120;
  const dL=rawL*(rawL>=0?(scales.lumPos??scales.lum??.28):(scales.lumNeg??scales.lum??.34));
  const dRG=((g-128)/120)*(scales.rg??.22);
  const dYB=((b-128)/120)*(scales.yb??.22);
  const posGain=mix(1.38,1.08,profile.fair);
  const negGain=mix(.88,1.02,profile.fair);
  const lumExp=clamp(dL*(dL>=0?Math.min(strength,1.2)*posGain:strength*negGain),-.6,.26);
  const chromaScale=mix(.34,mix(.72,1.18,profile.fair),profile.naturalHue??1)*strength;
  const rg=dRG*chromaScale,yb=dYB*chromaScale*.76;
  return [
    Math.exp(lumExp+.64*rg+.28*yb),
    Math.exp(lumExp-.38*rg+.18*yb),
    Math.exp(lumExp-.22*rg-.62*yb),
  ];
}

const [liningLeft,liningTop,liningRight,liningBottom]=data.mouth.island,[patchX,patchY,patchHalf]=data.mouth.patch;
export function fitFaceLayout(geometry,lining){
  const uv=geometry.attributes.uv,unit=v=>Math.min(1,Math.max(0,v));
  for(let i=0;i<uv.count;i++){
    const x=uv.getX(i)*layout,y=(1-uv.getY(i))*layout;
    if(lining?lining[i]:x>liningLeft&&x<liningRight&&y>liningTop&&y<liningBottom)
      uv.setXY(i,(patchX+(unit((x-liningLeft)/(liningRight-liningLeft))-.5)*patchHalf)/width,
        1-(patchY+(unit((y-liningTop)/(liningBottom-liningTop))-.5)*patchHalf)/height);
    else uv.setXY(i,(x-left)/width,1-(y-top)/height);
  }
  uv.needsUpdate=true;
}
let grown;
function growthPixels(){
  if(grown)return grown;
  grown=[0,1,2].map(()=>new Float32Array(width*height));
  const at=[0,0,0];
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    growthAt((x+.5)/width,(y+.5)/height,at);
    const fade=smooth(Math.min(x,y,width-1-x,height-1-y),3,30);
    for(let k=0;k<3;k++)grown[k][y*width+x]=at[k]*fade;
  }
  return grown;
}

function poreReliefTile(seed,size=96){
  const next=randomStream(seed^0x2f6b1d);
  const grid=new Float32Array(size*size);
  for(let i=0;i<grid.length;i++){
    const u=next();
    grid[i]=(u<.18?-1.15*(1-u/.18):.22*(u-.5));
  }
  const out=new Float32Array(size*size);
  let mean=0;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const ym=(y+size-1)%size,yp=(y+1)%size,xm=(x+size-1)%size,xp=(x+1)%size;
    const v=(
      grid[ym*size+xm]+2*grid[ym*size+x]+grid[ym*size+xp]+
      2*grid[y*size+xm]+4*grid[y*size+x]+2*grid[y*size+xp]+
      grid[yp*size+xm]+2*grid[yp*size+x]+grid[yp*size+xp]
    )/16;
    out[y*size+x]=v;mean+=v;
  }
  mean/=out.length;
  for(let i=0;i<out.length;i++)out[i]-=mean;
  return out;
}

export function beardRoot(skin,hair,facial){
  if(!facial||facial==="None"||facial==="Stubble")return null;
  const tone=hair.clone().multiplyScalar(facial==="Short beard"?.8:.66).lerp(skin,.12);
  const gain=clamp(1.04*Math.max(tone.r/Math.max(skin.r,.004),tone.g/Math.max(skin.g,.004),tone.b/Math.max(skin.b,.004)),headGain,6);
  return {tone,gain};
}
export const finishRead={bumpScale:.0025,legacyRelief:.5,relief:96,micro:1.1,meso:.6,gloss:1.1,fantasyChroma:.4,lipChroma:.64,lipChromaBroad:.56};
export function finishDonors({skin,age=0,frame=0,seed=0,facial},donors=finishData.donors){
  const c=skin?.isColor?skin:new T.Color(skin??"#b08566");
  const deep=1-smooth(.2126*c.r+.7152*c.g+.0722*c.b,.085,.125),male=facial&&facial!=="None"?1:smooth(frame,.05,.25);
  const a=clamp(age,0,1),t=a<.25?0:a<.45?(a-.25)/.2:a<.58?1:a<.76?1+(a-.58)/.18:2,lower=Math.floor(t);
  let choice=Math.imul(seed^seed>>>16,0x45d9f3b);choice=(choice^choice>>>13)>>>0;
  const shares=new Map();
  for(const [band,ofBand] of [[lower,1-(t-lower)],[lower+1,t-lower]])for(const [isDeep,ofDepth] of [[true,deep],[false,1-deep]])for(const [isMale,ofFrame] of [[true,male],[false,1-male]]){
    const share=ofBand*ofDepth*ofFrame;
    if(share<=0)continue;
    const fit=donors.map((d,i)=>[d,i]).filter(([d])=>d.age===band&&d.deep===isDeep&&d.male===isMale);
    const index=fit[choice%fit.length][1];
    shares.set(index,(shares.get(index)??0)+share);
  }
  return [...shares];
}
function donorPixels(index){
  const kept=sources.finish.pixels;
  if(!kept.has(index)){
    if(kept.size>=8)kept.delete(kept.keys().next().value);
    const c=canvasOf(width,height).getContext("2d",{willReadFrequently:true});
    c.drawImage(sources.finish.donors[index],0,0,width,height);
    kept.set(index,c.getImageData(0,0,width,height).data);
  }
  return kept.get(index);
}
const finishLog=Float64Array.from({length:256},(_,b)=>{const v=(b-128)/127;return v*(v<0?finishData.encoding.darker:finishData.encoding.lighter);});
export function finishTint(r,g,b,chroma=1,weight=1){
  if(r===128&&g===128&&b===128||weight<=0)return [1,1,1];
  const lr=finishLog[r],lg=finishLog[g],lb=finishLog[b],l=(lr+lg+lb)/3;
  return [Math.exp(weight*(l+chroma*(lr-l))),Math.exp(weight*(l+chroma*(lg-l))),Math.exp(weight*(l+chroma*(lb-l)))];
}

export function cheekPlane(fx,fy){
  const side=Math.abs(fy-.5);
  return smooth(fx,.44,.50)*(1-smooth(fx,.66,.74))*smooth(side,.075,.125)*(1-smooth(side,.36,.44));
}
export const weatheredCheek={wash:.35,layer:.45};
function paint(look){
  const {choice,skin,hair,age,frame,seed,brow}=look,facial=facialHairStyle(look.facial);
  const grows=facial&&growthPixels(),dense=tintOn(skin,hair.clone().lerp(skin,.22)).map(v=>v/255);
  const hairy=facial&&new ImageData(width,height);
  const makeup=makeupPalette(look.makeup);
  const photographic=photoDetail(choice,seed);
  const cast = sources.castSkin?.[choice];
  const captured = sources.captured?.[choice];
  const scanned = choice === "Shaved complexion" && sources.scanColour;
  const scanSurface = scanned && sources.scanSurface;
  const weathering=choice==="Weathered scars"?sources.seafarer:null;
  const baseDetail=weathering?"Weathered":(photographic || cast || captured) ? look.ageDetail : choice;
  const detail=sources.maps[complexionNames.indexOf(baseDetail)-1],[tone,zones,eyes]=sources.fields;
  const fin=sources.finish,finish=finishRead;
  const profile=fin?{...complexionProfile(look),mottleAmp:0}:complexionProfile(look);
  const donors=fin?finishDonors(look).map(([index,share])=>[donorPixels(index),share]):[],onlyDonor=donors.length===1&&donors[0][0];
  const donorChroma=mix(finish.fantasyChroma,1,profile.naturalHue);
  const lipChroma=(look.frame>.15||facial?finish.lipChromaBroad:finish.lipChroma)*mix(.82,1,profile.fair);
  const ageLines=smooth(profile.age,.3,.8);
  const pigmentAt = baseDetail === "Smooth" ? null : skinPigment(seed);
  const localPigment = [0,0,0];
  const pigmentGain = .95 * (1 - .40 * ageLines);
  const family = baseDetail === "Lined" || baseDetail === "Soft lines" ? 2 : baseDetail === "Weathered" ? 1 : 0;
  const pigment = sources.pigment[family*2 + (family===2 ? (frame>.15 ? 0 : 1) : seed>>>3&1)] ?? null;
  const reliefMap = baseDetail === "Smooth" ? null : sources.dermal[(seed >>> 3) & 1];
  const tissue = reliefMap ? .39 + .48*profile.age : 0;
  const lineStrength = baseDetail === "Smooth" ? 0 : Math.min(1, Math.max(0,(age-.18)*1.25)
    + (baseDetail === "Lined" ? .25 : 0));
  const lines = lineStrength > 0 ? expressionLines(seed) : null;
  const pigmentStrength = baseDetail === "Smooth" ? .72 : [1.08,1.18,1.24][family];
  const root=fin&&facial?beardRoot(skin,hair,look.facial):null;
  const {neutral,base:headBase}=headroomForSkin(skin,root?root.gain:headGain);
  const trimmed = look.facial === "Clipped beard";
  const clipped = trimmed || look.facial === "Stubble" ? sources.clippedBeard : null;
  const standingBeard = look.facial==="Short beard" || look.facial==="Full beard";
  const mousDeepen=.22+.3*smooth(.2126*hair.r+.7152*hair.g+.0722*hair.b,.12,.4);
  const bareLinear=neutral.map(b=>srgbDecode[b]);
  const rootLinear=root&&[root.tone.r/headBase[0],root.tone.g/headBase[1],root.tone.b/headBase[2]];
  const isV2Pigment=registeredPigment.encoding==="local-pigment-v2";
  const synWeight=pigment&&isV2Pigment?.34:1,read=portraitRead;
  const {lipTint:lip,lidTint:lid,socketTint:soc,underTint:und,beard}=profile;
  const stubble=tintOn(skin,hair.clone().lerp(skin,.48)).map(v=>v/255);
  const poreTileSize=96,poreTile=poreReliefTile(seed,poreTileSize);
  const small=canvasOf(width,height),rough=canvasOf(width,height),relief=canvasOf(width,height);
  const colour=new ImageData(width,height),gloss=new ImageData(width,height),bump=new ImageData(width,height);
  for(let i=0;i<width*height*4;i+=4){
    const pixel=i/4,px=pixel%width,py=Math.floor(pixel/width);
    const mask=eyes[i+2]/255,lips=fin?fin.lips[i]/255:tone[i]/255,lids=tone[i+1]/255,form=tone[i+2]/255-.5;
    const blush=zones[i]/255,shine=zones[i+1]/255,growth=zones[i+2]/255*(1-lips)*beard;
    let cover=0;
    const fx=(px+.5)/width,fy=(py+.5)/height;
    if(facial){
      const cheekFade=standingBeard?smooth(fx,(.635-.085*smooth(Math.abs(fy-.5)*2,.28,.74))-.095,(.635-.085*smooth(Math.abs(fy-.5)*2,.28,.74))+.105):1;
      for(let k=0;k<3;k++)cover=Math.max(cover,facial.cover[k]*grows[k][pixel]*(k===2?cheekFade:1));
      cover=standingBeard
        ? (look.facial==="Short beard" ? shortBeardCover(shortBeardGrowth(fx,fy,[grows[0][pixel],grows[1][pixel],grows[2][pixel]])) : (smooth(cover,.08,.86)**1.2)*facial.paint)
        : smooth(cover,.06,.7)*facial.paint;
      if (clipped) {
        const density = clipped[i] / 255 * mask * (1 - lips);
        cover = trimmed ? Math.min(.96, 1.33 * density) : .32 * density;
      }
      hairy.data[i+3]=Math.round(255*cover);
    }
    const rootGrain = clipped ? .26+.70*clipped[i+1]/128 : standingBeard && cover>0 ? (look.facial==="Short beard" ? shortBeardRoot(fx,fy,grows[0][pixel],mousDeepen) : beardRootTone(fx,fy)) : 1;
    const under=eyes[i]/255*(.14+.42*age),socket=eyes[i+1]/255;
    const pore=detail?(detail[i]-128)/96:0;
    const wrinkle=detail?(detail[i+1]-128)/96:0;
    const mottle=detail?(detail[i+2]-128)/88:0;
    const open=mask*(1-lips)*(1-cover);
    const skinArea=open*(1-lids*.7);
    if (pigmentAt && skinArea > 0) pigmentAt((px+.5)/width,(py+.5)/height,localPigment);
    const photo=photographic
      ? photographic((px+.5)/width,(py+.5)/height)*skinArea : 0;
    const procPore=poreTile[(py%poreTileSize)*poreTileSize+(px%poreTileSize)]*profile.poreRelief;
    const plane=fin?1:Math.min(1,1+.16*Math.max(synWeight,read.planes)*form*mask);
    const warmG=fin?1:1-blush*mask*profile.blushG*Math.max(synWeight,read.blush);
    const warmB=fin?1:1-blush*mask*profile.blushB*Math.max(synWeight,read.blush);
    const [detR,detG,detB]=detail?detailTint(detail[i],detail[i+1],detail[i+2],profile,skinArea,open,lids):[1,1,1];
    const zone=fin?0:1;
    const lipW=lips*read.lip*zone,lidW=lids*read.lid*zone,socW=socket*read.socket*zone,undW=under*read.under*zone;
    const tints=[
      plane*detR*mix(1,lip[0],lipW)*mix(1,lid[0],lidW)*mix(1,soc[0],socW)*mix(1,und[0],undW)*mix(1,stubble[0],growth)*mix(1,dense[0],root?0:cover),
      plane*detG*warmG*mix(1,lip[1],lipW)*mix(1,lid[1],lidW)*mix(1,soc[1],socW)*mix(1,und[1],undW)*mix(1,stubble[1],growth)*mix(1,dense[1],root?0:cover),
      plane*detB*warmB*mix(1,lip[2],lipW)*mix(1,lid[2],lidW)*mix(1,soc[2],socW)*mix(1,und[2],undW)*mix(1,stubble[2],growth)*mix(1,dense[2],root?0:cover),
    ];
    let pigLinear=[1,1,1];
    if(fin){
      const chroma=donorChroma*(1-(1-lipChroma)*lips),weight=1-cover;
      if(onlyDonor)pigLinear=finishTint(onlyDonor[i],onlyDonor[i+1],onlyDonor[i+2],chroma,weight);
      else{
        let r=0,g=0,b=0;
        for(const [donor,share] of donors){r+=finishLog[donor[i]]*share;g+=finishLog[donor[i+1]]*share;b+=finishLog[donor[i+2]]*share;}
        const l=(r+g+b)/3;
        pigLinear=[Math.exp(weight*(l+chroma*(r-l))),Math.exp(weight*(l+chroma*(g-l))),Math.exp(weight*(l+chroma*(b-l)))];
      }
    }else if(pigment){
      if(isV2Pigment){
        pigLinear=pigmentTint(pigment[i],pigment[i+1],pigment[i+2],profile,pigmentStrength*read.pigment*mask*(1-cover)*(1-(1-read.lipDonor)*lips));
      }else{
        const local = (pigment[i]-128)/127;
        const warm = (pigment[i+1]-128)/127;
        const grain = (pigment[i+2]-128)/127;
        const strength = pigmentStrength*mask*(1-cover);
        const pigmentLight = strength*(.54*Math.min(0,local)+.18*Math.max(0,local)+.09*grain);
        tints[0] *= 1+pigmentLight+.09*warm*strength;
        tints[1] *= 1+pigmentLight-.14*warm*strength;
        tints[2] *= 1+pigmentLight-.12*warm*strength;
      }
    }
    const ridge = reliefMap ? (reliefMap[i]-128)/118*tissue*mask : 0;
    const sebum = reliefMap ? (reliefMap[i+1]-128)/118*tissue*mask : 0;
    const cavity = reliefMap ? (reliefMap[i+2]-128)/118*tissue*mask : 0;
    const crease = lines ? lines[pixel]/110*lineStrength*mask : 0;
    const depth = Math.min(0,crease)*.26 + Math.min(0,cavity)*.14;
    tints[0] *= 1 + depth*.78;
    tints[1] *= 1 + depth;
    tints[2] *= 1 + depth*1.04;
    if(cast){
      const [paint,material]=cast;
      const region=material[i+2]/255, weight=mask*(1-cover)*(1-.32*profile.age);
      const lum=(.25*paint[i]+.61*paint[i+1]+.14*paint[i+2])-128;
      for(let k=0;k<3;k++){
        const chroma=paint[i+k]-128-lum;
        const local=(1.18*lum+(.15+.85*profile.naturalHue)*chroma)/94;
        pigLinear[k]=Math.exp((1-weight*region)*Math.log(pigLinear[k])+weight*local);
      }
    }
    if (captured) {
      const [paint, surface] = captured;
      const region = surface[i+2]/255 * mask * (1-cover);
      const light = (.26*paint[i] + .59*paint[i+1] + .15*paint[i+2] - 128)/51;
      const liftedBrow = look.photoBrows ? 0 : surface[i+1]/102;
      for (let k=0; k<3; k++) {
        const chroma = (paint[i+k]-128)/51 - light;
        const target = .94*light + .8*profile.naturalHue*chroma + liftedBrow;
        pigLinear[k] = Math.exp((1-region)*Math.log(pigLinear[k]) + region*target);
      }
    }
    if(makeup)mixMakeup(tints,makeup,lips,lids,socket,blush,mask);
    if (scanned && mask > 0 && cover < 1) {
      const scanWeight = scanSurface[i+2]/255 * mask * (1-cover) * (1-.4*profile.age);
      const brightness = (.26*scanned[i]+.57*scanned[i+1]+.17*scanned[i+2])-128;
      for (let k=0;k<3;k++) {
        const ratio = .0054*(brightness + profile.naturalHue*(scanned[i+k]-128-brightness));
        pigLinear[k] = Math.exp((1-scanWeight)*Math.log(pigLinear[k]) + ratio*mask*(1-cover));
      }
    }
    if (weathering && mask > 0 && cover < 1) {
      const luminance=.25*weathering[i]+.5*weathering[i+1]+.25*weathering[i+2]-128;
      const cheek = cheekPlane(fx,fy) * (1-eyes[i]/255);
      const wash = .0055 * (1-(1-weatheredCheek.wash)*cheek) * mask * (1-cover);
      for (let channel=0; channel<3; channel++) {
        const chroma=weathering[i+channel]-128-luminance;
        pigLinear[channel]*=Math.exp(wash*(luminance+.60*profile.naturalHue*chroma));
      }
    }
    for(let k=0;k<3;k++){
      const sVal=tints[k]+(photo*.18)/255;
      if(mask===0&&photo===0&&sVal===1&&pigLinear[k]===1){
        colour.data[i+k]=neutral[k];
      }else{
        const variation = pigmentAt ? Math.exp(pigmentGain * skinArea * localPigment[k]) : 1;
        const lit=srgbUnitToLinear(sVal)*pigLinear[k]*bareLinear[k]*variation;
        colour.data[i+k]=Math.round(srgbEncode(rootLinear&&cover>0?mix(lit,rootLinear[k]*rootGrain,cover):lit));
      }
    }
    colour.data[i+3]=255;

    let roughVal=mix(profile.bodyRoughness,profile.faceRoughness,mask);
    roughVal-=profile.shineDrop*shine*mask*(1-cover);
    if(fin)roughVal-=finish.gloss*(fin.gloss[i]-128)/finishData.encoding.gloss*(1-cover)*(1-lips);
    if (scanSurface) {
      const measured = profile.faceRoughness - .00125*(scanSurface[i+1]-128);
      roughVal = mix(roughVal,measured,scanSurface[i+2]/255*mask*(1-cover));
    }
    if(cast){
      const cm=cast[1], spatial=.0019*(cm[i+1]-128);
      roughVal=mix(roughVal,profile.faceRoughness-.045-spatial,cm[i+2]/255*mask*(1-cover));
    }
    roughVal-=profile.lidRoughnessDrop*lids*mask;
    roughVal=mix(roughVal,makeup?.roughness ?? profile.lipRoughness,lips*mask);
    roughVal=mix(roughVal,.72,Math.min(1,growth*1.35));
    roughVal=mix(roughVal,.76,cover);
    roughVal+=(-profile.microRoughAmp*(pore*profile.poreRelief+.55*procPore)-.028*wrinkle*profile.wrinkleRelief-(photo/255)*.08)*skinArea;
    roughVal=clamp(roughVal-.11*sebum-.035*crease,.24,.8);
    gloss.data[i]=sources.fields[3][i];
    gloss.data[i+1]=Math.round(255*(roughVal/.8));
    gloss.data[i+2]=0;
    gloss.data[i+3]=255;

    const lipGrain=lips*mask*procPore*4.5;
    let high=128+(pore*36*profile.poreRelief+wrinkle*48*profile.wrinkleRelief+procPore*12+photo*1.1)*skinArea+lipGrain+104*ridge+105*crease;
    if(fin){
      const forms=Math.max(lips,mix(.4,.7,ageLines)*Math.max(lids,.6*socket),.06+.94*ageLines),fine=1-(1-ageLines)*(.2+.5*Math.max(socket,eyes[i]/255));
      high=128+(high-128)*finish.legacyRelief+finish.relief*(1-cover)*(
        finish.micro*fine*(1-.55*zones[i+2]/255)*(fin.micro[i]-128)/finishData.encoding.micro+finish.meso*forms*(fin.meso[i]-128)/finishData.encoding.meso);
    }
    if(cast){
      const cm=cast[1], area=mask*(1-cover);
      high=128+(high-128)*(1-.48*cm[i+2]/255*area)+1.15*(cm[i]-128)*area;
    }
    if (scanSurface) {
      const fraction = scanSurface[i+2]/255*mask*(1-cover);
      high=128+(high-128)*(1-.6*fraction)+.9*(scanSurface[i]-128)*mask*(1-cover);
    }
    if (captured) {
      const surface = captured[1], amount = surface[i+2]/255 * mask * (1-cover);
      high = mix(high, 128 + .09*(surface[i]-128) + .32*(high-128), amount);
    }
    if(clipped) high+=(clipped[i+2]-128)*cover*.62;
    bump.data[i]=bump.data[i+1]=bump.data[i+2]=high;
    bump.data[i+3]=255;
  }
  small.getContext("2d").putImageData(colour,0,0);
  rough.getContext("2d").putImageData(gloss,0,0);
  relief.getContext("2d").putImageData(bump,0,0);
  const w=width*density,h=height*density;
  const enlarge=source=>{
    const c=canvasOf(w,h),ctx=c.getContext("2d");
    ctx.imageSmoothingQuality="high";ctx.drawImage(source,0,0,w,h);return c;
  };
  const map=enlarge(small),roughness=enlarge(rough),height2=enlarge(relief);
  const fine=canvasOf(w,h),f=fine.getContext("2d");
  f.fillStyle="#fff";f.fillRect(0,0,w,h);
  const next=randomStream(seed^0x2f6b1d);
  const ink=target=>{const [r,g2,b]=tintOn(skin,target);return "rgb("+r+","+g2+","+b+")";};
  const browImage = sources.brows[brow], placement = browLayout[brow];
  if (browImage && !(captured && look.photoBrows && capturedSkin(choice).brows)) {
    const tint = canvasOf(browImage.width, browImage.height);
    const inkLayer = tint.getContext("2d");
    inkLayer.drawImage(browImage, 0, 0);
    inkLayer.globalCompositeOperation = "source-in";
    inkLayer.fillStyle = ink(browPigment(hair, skin, age, look.makeup));
    inkLayer.fillRect(0, 0, tint.width, tint.height);
    if (portraitRead.browMass > 0) {
      f.save(); f.filter = "blur(" + 1.8 * density + "px)"; f.globalAlpha = portraitRead.browMass;
      for (const dx of [-3.2, -1.6, 0, 1.6, 3.2]) f.drawImage(tint, placement.x + dx * density, placement.y);
      f.restore();
    }
    f.drawImage(tint, placement.x, placement.y);
    if (portraitRead.browInk > 1) { f.globalAlpha = Math.min(1, portraitRead.browInk - 1); f.drawImage(tint, placement.x, placement.y); f.globalAlpha = 1; }
    if (look.makeup === "Plum stage" || look.makeup === "Smoked charcoal") {
      f.globalAlpha = .32;
      f.drawImage(tint, placement.x, placement.y);
      f.globalAlpha = 1;
    }
  }
  f.lineCap="round";
  const lash=hair.clone().lerp(new T.Color("#120d0b"),.7);
  for(const lidLine of data.lids){
    const p=points(lidLine.points);
    f.strokeStyle=ink(lidLine.lower?lash.clone().lerp(skin,.5):lash.clone().lerp(skin,.06));
    for(const [line,alpha] of lidLine.lower?[[4*density,.12],[1.3*density,.3]]:[[10*density,.2],[5*density,.5],[2.2*density,.85]]){
      f.lineWidth=line;f.globalAlpha=alpha;f.lineJoin="round";f.beginPath();
      for(let i=0;i<p.length;i+=2)f[i?"lineTo":"moveTo"](p[i]*w,p[i+1]*h);
      f.stroke();
    }
  }
  f.globalAlpha=1;
  const coverCanvas=canvasOf(width,height),cover2d=coverCanvas.getContext("2d"),alpha=new ImageData(width,height);
  for(let i=0;i<alpha.data.length;i+=4)alpha.data[i+3]=eyes[i+2];
  cover2d.putImageData(alpha,0,0);
  f.globalCompositeOperation="destination-in";f.drawImage(coverCanvas,0,0,w,h);
  const mc=map.getContext("2d");mc.globalCompositeOperation="multiply";mc.drawImage(fine,0,0);
  if(facial){
    const tile=canvasOf(160,160),t=tile.getContext("2d");
    t.fillStyle="#fff";t.fillRect(0,0,160,160);
    t.strokeStyle=ink(hair.clone().lerp(skin,.1));t.lineCap="round";
    for(let n=0;n<1500;n++){
      const x=next()*160,y=next()*160,angle=(next()-.5)*1.3,length=(1.6+2.6*next())*density;
      t.globalAlpha=.3+.45*next();t.lineWidth=(.45+.4*next())*density;
      for(const [dx,dy] of [[0,0],[-160,0],[0,-160],[-160,-160]]){
        t.beginPath();t.moveTo(x+dx,y+dy);t.lineTo(x+dx+Math.cos(angle)*length,y+dy+Math.sin(angle)*length);t.stroke();
      }
    }
    const hairs=canvasOf(w,h),hc=hairs.getContext("2d");
    hc.fillStyle=hc.createPattern(tile,"repeat");hc.fillRect(0,0,w,h);
    const where=canvasOf(width,height);where.getContext("2d").putImageData(hairy,0,0);
    hc.globalCompositeOperation="destination-in";hc.imageSmoothingQuality="high";hc.drawImage(where,0,0,w,h);
    mc.globalCompositeOperation="multiply";mc.drawImage(hairs,0,0);
  }
  const inner=(patchHalf+4)*density,cx=patchX*density,cy=patchY*density;
  const mouthRgb=[142,112,110].map((v,k)=>Math.round(srgbEncode(srgbDecode[v]*bareLinear[k])));
  for(const [canvas,fill] of [[map,`rgb(${mouthRgb[0]},${mouthRgb[1]},${mouthRgb[2]})`],[roughness,fin?"rgb(96,205,0)":"rgb(255,90,0)"],[height2,"rgb(128,128,128)"]]){
    const c=canvas.getContext("2d");c.globalCompositeOperation="source-over";c.globalAlpha=1;
    c.fillStyle=fill;c.fillRect(cx-inner,cy-inner,2*inner,2*inner);
  }
  const texture=(canvas,srgb)=>{
    const t=new T.CanvasTexture(canvas);if(srgb)t.colorSpace=T.SRGBColorSpace;t.anisotropy=8;return t;
  };
  return {map:texture(map,true),roughnessMap:texture(roughness,false),bumpMap:texture(height2,false),headBase,skinColor:[skin.r,skin.g,skin.b],finished:Boolean(fin)};
}

function lookFromForm(form){
  const human=form.human??{},age=human.age??0,style=form.humanStyle??{};
  return {
    makeup:style.makeup ?? "None",
    choice:form.complexion ?? (style.facialHair === "Stubble" ? "Shaved complexion" : ageComplexion(age)),ageDetail:ageComplexion(age),
    skin:new T.Color(form.appearance.skin),hair:new T.Color(style.hairColor??form.appearance.hairColor),
    age:Math.round(age*20)/20,frame:Math.round(T.MathUtils.clamp(human.frame??0,-1,1)*10)/10,
    seed:(form.origin?.seed??0)>>>0,brow:fittedBrow(form),
    photoBrows: (style.browStyle ?? "As drawn") === "As drawn",
    facial:facialHairStyle(style.facialHair)?style.facialHair:"None",
  };
}

export function skinMaterial(base,form){
  const material=base.clone();
  const profile=complexionProfile(lookFromForm(form));
  material.roughness=profile.bodyRoughness;
  if (sources.body) {
    Object.assign(material,sources.body);
    material.normalScale.setScalar(.82);
    material.userData.bodySkin = true;
  }
  return material;
}

export function faceMaterial(base,form){
  const material=base.clone();
  const look=lookFromForm(form);
  if(!sources.fields.length){
    material.roughness=complexionProfile(look).bodyRoughness;
    return material;
  }
  const key=[look.choice,look.ageDetail,look.skin.getHexString(),look.hair.getHexString(),look.age,look.frame,look.seed,look.brow,look.photoBrows,look.facial,look.makeup].join("/");
  if(painted.has(key)){
    const kept=painted.get(key);painted.delete(key);painted.set(key,kept);
  }else{
    if(painted.size>=6){
      const oldest=painted.keys().next().value;
      for(const t of Object.values(painted.get(oldest)))t?.dispose?.();
      painted.delete(oldest);
    }
    painted.set(key,paint(look));
  }
  const {map,roughnessMap,bumpMap,headBase,skinColor,finished}=painted.get(key);
  material.color.setRGB(...headBase);
  Object.assign(material,{map,roughnessMap,metalnessMap:roughnessMap,metalness:0,aoMap:roughnessMap,aoMapIntensity:.72,bumpMap,bumpScale:capturedSkin(look.choice) ? .0016 : finished?finishRead.bumpScale:.00125,roughness:.8});
  material.userData={...material.userData,portrait:true,faceLayout:true,quietCheeks:look.choice==="Weathered scars",skinColor,paintedLips:finished && look.makeup==="None"};
  return material;
}
