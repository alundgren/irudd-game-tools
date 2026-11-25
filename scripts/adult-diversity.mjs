/**
 * Compare seeded adults on the editable mesh before clothing or paint.
 * node scripts/adult-diversity.mjs [first seed] [count] [output JSON]
 */
import {writeFile} from "node:fs/promises";
import {evaluateHuman,randomHuman,humanControls} from "../character-view/human-surface.js";
import {dressHuman} from "../character-view/human-wardrobe.js";

const seed=Number(process.argv[2]??8710),count=Number(process.argv[3]??64);
if(!Number.isSafeInteger(seed)||seed<0||!Number.isSafeInteger(count)||count<2||count>256)
  throw new Error("Choose a nonnegative first seed and 2–256 adults.");
const base=evaluateHuman({}), anchors=humanControls().ids;
const regionOf=i=>base.names[base.boneIndices[i*4]];
const bodyIds=Array.from(anchors).filter(i=>/pelvis|spine|arm|thigh|calf/.test(regionOf(i)));
const headIds=Array.from(anchors).filter(i=>regionOf(i)==="head");
// The cage has equal topology across subjects. Centre heads at the skull joint,
// rescale both groups to 1.72 m and compare corresponding anatomical landmarks.
function probe(s,ids,head){
  const joint=s.names.indexOf("head")*3,points=[];
  for(const i of ids)for(let d=0;d<3;d++)points.push((s.positions[i*3+d]-(head?s.joints[joint+d]:0))*1.72/s.height);
  return points;
}
const samples=[];
for(let index=0;index<count;index++){
  const id=seed+index,p=randomHuman(id),s=evaluateHuman(p);
  const {humanStyle}=dressHuman({human:p},id);
  samples.push({id,height:s.height,body:probe(s,bodyIds,false),head:probe(s,headIds,true),outfit:humanStyle.outfit,hair:humanStyle.hair});
}
function rms(a,b){
  let sum=0;
  for(let i=0;i<a.length;i++)sum+=(a[i]-b[i])**2;
  return 1000*Math.sqrt(sum/(a.length/3));
}
function quantiles(v){
  v.sort((a,b)=>a-b);
  const at=t=>+v[Math.round(t*(v.length-1))].toFixed(2);
  return {min:at(0),p10:at(.1),median:at(.5),p90:at(.9),max:at(1)};
}
function pairs(key){
  const distances=[],identities=[];let closest={mm:Infinity},furthest={mm:0};
  for(let i=0;i<samples.length;i++)for(let j=0;j<i;j++){
    const a=samples[i],b=samples[j],mm=rms(a[key],b[key]);
    distances.push(mm);identities.push({mm,ids:[b.id,a.id]});
    if(mm<closest.mm)closest={mm,ids:[b.id,a.id]};
    if(mm>furthest.mm)furthest={mm,ids:[b.id,a.id]};
  }
  const used=new Set(),closePairs=[];
  for(const pair of identities.sort((a,b)=>a.mm-b.mm)){
    if(pair.ids.some(id=>used.has(id)))continue;
    closePairs.push(pair.ids);
    pair.ids.forEach(id=>used.add(id));
    if(closePairs.length===3)break;
  }
  return {anchors:samples[0][key].length/3,pairs:distances.length,rmsMm:quantiles(distances),closest:closest.ids,furthest:furthest.ids,closePairs,
    identityControlMm:rms(samples[0][key],samples[0][key])};
}
const result={seed,count,method:"Equal-topology landmark RMS in millimetres at matched stature. Includes proportion changes. The skull group is separately centred. This measures shape spread, not attractiveness, likeness or realism.",
    statureCm:quantiles(samples.map(s=>s.height*100)),body:pairs("body"),head:pairs("head"),
    firstFour:samples.slice(0,4).map(({id,height,outfit,hair})=>({id,height,outfit,hair}))};
const json=JSON.stringify(result,null,2)+"\n";
if(process.argv[4])await writeFile(process.argv[4],json);
console.log(json);
