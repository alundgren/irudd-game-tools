import {startingForm, validateForm} from "./recipe.js";
import {bindParts} from "./rig.js";

function randomStream(seed){
  let state=seed>>>0;
  return ()=>{state=(state+0x6d2b79f5)>>>0;let t=state;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};
}
function hueColor(h,s,l){
  const f=n=>{const k=(n+h/30)%12;return l-s*Math.min(l,1-l)*Math.max(-1,Math.min(k-3,9-k,1));};
  return "#"+[0,8,4].map(n=>Math.round(f(n)*255).toString(16).padStart(2,"0")).join("");
}
export function generateForm(kind="human", seed=crypto.getRandomValues(new Uint32Array(1))[0]){
  const rnd=randomStream(seed),between=(a,b)=>a+(b-a)*rnd(),integer=(a,b)=>Math.floor(between(a,b+1));
  const form=startingForm(rnd);
  form.origin={generator:1,seed,kind};
  if(kind==="human"){
    form.appearance.sculpt=Object.fromEntries(["jaw","nose","brow","cheek"].map(k=>[k,between(.76,1.25)]));
    form.appearance.sleeves=["long","short","none"][integer(0,2)];
    return form;
  }
  const parts=[],links={};
  const add=(part,parent)=>{parts.push(part);if(parent)links[part.id]=parent;return part.id;};
  function sweep(id,rows,color,surface,parent){
    const pivot=rows[0].slice(0,3);
    return add({id,shape:"sweep",position:pivot,size:[1,1,1],rotation:[0,0,0],color,surface,
      knots:rows.map(row=>row.map((v,i)=>i<3?v-pivot[i]:v))},parent);
  }
  const oval=(id,position,size,color,surface,parent,angle=[0,0,0])=>add({id,shape:"ellipsoid",position,size,rotation:angle,color,surface},parent);
  const hue=between(0,360),base=hueColor(hue,.24,.38), highlight=hueColor((hue+34)%360,.3,.58);
  const accent=hueColor((hue+145)%360,.40,.53), dark=hueColor(hue,.22,.20);
  const pairs=integer(1,4), length=between(.65,1.65),width=between(.12,.35);
  const hip=between(.30,.95), arch=between(.02,.24), neck=between(.18,.77), eyePairs=integer(1,2);
  const bodyY=t=>hip+.10+arch*Math.sin(t*Math.PI);
  const bodyZ=t=>(t-.5)*length;
  sweep("spine",Array.from({length:9},(_,i)=>{
    const t=i/8,full=.31+.69*Math.sin(t*Math.PI)**.62;
    return [0,bodyY(t),bodyZ(t),width*full,width*full*.84];
  }),base,"scales");
  const tail=between(.2,.93);
  sweep("tail",[[0,bodyY(0),bodyZ(0)+.05,width*.37,width*.35],[0,hip+.1,-length*.5-tail*.33,width*.29,width*.25],
    [tail*.13,hip+.07,-length*.5-tail*.72,width*.17,width*.12],[tail*.23,hip+tail*.24,-length*.5-tail,.003,.004]],base,"scales","spine");
  for(let pair=0;pair<pairs;pair++){
    const t=pairs===1?.52:.14+pair/(pairs-1)*.72;
    const z=bodyZ(t),y=bodyY(t),spread=between(.06,.17),stride=between(-.085,.085);
    for(const side of [-1,1]){
      const tag=(side>0?"Left":"Right")+" "+(pair+1),rootX=side*width*.65,kneeX=side*(width+spread);
      const root=sweep(tag+" thigh",[[rootX,y,z,width*.35,width*.32],[kneeX,y*.67,z+.09,width*.27,width*.26],[kneeX*.97,y*.51,z+.025,width*.20,width*.20]],base,"scales","spine");
      const ankle=side*(width+spread*.88);
      const shin=sweep(tag+" shin",[[kneeX*.97,y*.51,z+.025,width*.20,width*.20],[ankle,y*.27,z-.055,width*.16,width*.14],
        [ankle,.065,z+stride,width*.12,width*.14]],base,"scales",root);
      oval(tag+" foot",[ankle,.045,z+stride+.035],[width*.69,.09,width*.84],dark,"leather",shin);
      for(let f=0;f<3;f++){
        const toe=(f-1)*.035;
        sweep(tag+" toe "+(f+1),[[ankle+toe,.044,z+stride+.05,.014,.013],
          [ankle+toe*1.5,.024,z+stride+.1,.012,.01],[ankle+toe*1.7,.018,z+stride+.135,.002,.003]],highlight,"plain",shin);
      }
    }
  }
  const faceY=hip+.19+neck*.68,faceZ=length*.50+neck*.56;
  sweep("neck",[[0,bodyY(.87),bodyZ(.87),width*.57,width*.52],[0,hip+.19+neck*.31,length*.45+neck*.18,width*.39,width*.35],
    [0,faceY,faceZ,width*.31,width*.35]],base,"scales","spine");
  const head=oval("head",[0,faceY,faceZ],[width*1.14,width*.93,width*1.4],highlight,"scales","neck");
  oval("muzzle",[0,faceY-width*.14,faceZ+width*.53],[width*.7,width*.51,width*.94],base,"scales",head);
  for(let i=0;i<eyePairs;i++){
    for(const side of [-1,1]){
      const x=side*width*(.46-i*.12),y=faceY+width*(.19+i*.19),z=faceZ+width*(.27-i*.30);
      oval("eye "+side+"/"+i,[x,y,z],[width*.28,width*.28,width*.29],accent,"plain",head);
      oval("pupil "+side+"/"+i,[x+side*.009,y,z+width*.12],[width*.10,width*.17,width*.07],"#182c2a","plain",head);
    }
  }
  const crests=integer(3,9);
  for(let i=0;i<crests;i++){
    const t=.08+i/crests*.8, y=bodyY(t)+width*(.32+.51*Math.sin(t*Math.PI)), z=bodyZ(t);
    const h=between(.08,.27);
    sweep("dorsal fin "+(i+1),[[0,y-.035,z,.026,.059],[0,y+.035,z-.009,.02,.05],
      [0,y+h,z-.045,.003,.009]],i%2?highlight:accent,"scales","spine");
  }
  form.parts=parts;
  const result=bindParts(form,links);validateForm(result);return result;
}
