import {bindParts,bindHumanoid} from "../character-view/rig.js";
import {startingForm,anchors} from "../character-view/recipe.js";

// Original editable studies. These authoring helpers produce ordinary form data
// accepted by the same importer as an agent's proposal.
function study(look, proportions, empty=false) {
  const form=startingForm(()=>.5,false);
  Object.assign(form.appearance,look);
  for(const part of form.parts){
    part.size=[...proportions];
    part.position=anchors[part.shape].map((x,i)=>x*proportions[i]);
  }
  if(empty)form.parts=[];
  const add=(id,shape,position,size,color,rotation=[0,0,0])=>{
    const part={id,shape,position,size,color,rotation};
    form.parts.push(part);return part;
  };
  const oval=(...args)=>add(args[0],"ellipsoid",...args.slice(1));
  const box=(...args)=>add(args[0],"box",...args.slice(1));
  function sweep(id,color,knots){
    const pivot=knots[0].slice(0,3);
    const p=add(id,"sweep",pivot,[1,1,1],color);
    p.knots=knots.map(row=>row.map((n,i)=>i<3?n-pivot[i]:n));
    return p;
  }
  function cloth(p){p.visibleIn=["Work clothes"];return p;}
  // Accessories in body-local metres follow each study's chosen proportions.
  function fitted(p){
    p.position=p.position.map((x,i)=>x*proportions[i]);
    p.size=p.size.map((x,i)=>x*proportions[i]);
    return p;
  }
  return {form,add,oval,box,sweep,cloth,fitted};
}
const both=[-1,1];
function bindStudy(form,locate){
  const links={};
  for(const p of form.parts) if(!Object.hasOwn(anchors,p.shape)){
    const parent=locate(p.id,p);
    if(parent)links[p.id]=parent;
  }
  // Bind accessories first so anatomical parents are still in world space.
  return bindHumanoid(bindParts(form,links));
}
function ranger(){
  const {form,sweep,oval,box,cloth,fitted}=study({face:0,skin:"#a9785c",hair:"Bald",hairColor:"#9e9890",
    palette:"Tide",sculpt:{nose:1.42,brow:1.36,jaw:1.12,cheek:.84},tones:{cloth:"#474e46",pants:"#47433c",boots:"#554237",panel:"#655848",trim:"#a68b63"}},[1.07,1.075,1.05]);
  fitted(oval("silver crown",[0,1.724,-.014],[.202,.109,.202],"#aaa79d"));
  for(let i=0;i<13;i++){
    const a=(i-6)*.22, x=Math.sin(a)*.092, z=-Math.cos(a)*.089;
    fitted(sweep("swept lock "+(i+1),i%2?"#a8a69c":"#807e76",[
      [x*.58,1.75,z*.3,.024,.016],[x,1.69,z,.025,.021],[x*.91,1.58,z-.019,.021,.022],[x*.62,1.49,z-.045,.006,.008]]));
  }
  for(const s of both){
    fitted(sweep("sideburn "+s,"#8e8980",[[s*.087,1.65,.015,.019,.015],[s*.083,1.59,.037,.017,.012],[s*.072,1.56,.058,.004,.005]]));
    cloth(fitted(oval("leather shoulder "+s,[s*.206,1.331,0],[.216,.133,.197],"#615444",[0,0,-s*14])));
    cloth(fitted(sweep("shoulder binding "+s,"#a49271",[[s*.142,1.358,.073,.009,.013],[s*.204,1.335,.102,.009,.012],[s*.282,1.31,.070,.008,.012]])));
  }
  cloth(fitted(sweep("chest baldric","#72513c",[[-.14,1.363,.089,.032,.009],[-.055,1.247,.145,.034,.013],[.05,1.09,.132,.036,.012],[.118,.938,.095,.033,.01]])));
  cloth(fitted(box("bronze buckle",[-.045,1.22,.16],[.061,.047,.013],"#ab9667",[0,0,32])));
  return bindStudy(form,id=>id.includes("lock")||id.includes("crown")||id.includes("sideburn")?"head":"torso");
}
function surveyor(){
  const {form,sweep,oval,box,cloth,fitted}=study({face:1,skin:"#ac7f60",hair:"Bald",hairColor:"#706b62",palette:"Ochre",
    belly:1.28,sculpt:{jaw:1.34,nose:1.52,brow:.82,cheek:1.28},tones:{cloth:"#806b52",pants:"#56534d",boots:"#483b32",panel:"#8d7961",trim:"#937449"}},[1.24,.87,1.19]);
  for(const s of both){
    fitted(sweep("grey horseshoe "+s,"#8b8881",[[s*.069,1.727,-.055,.023,.021],[s*.095,1.666,-.026,.025,.029],[s*.089,1.605,-.011,.015,.023]]));
    const arc=[];
    for(let j=0;j<=12;j++){const t=j*Math.PI*2/12;arc.push([s*.042+.041*Math.cos(t),1.632+.029*Math.sin(t),.100+.006*Math.cos(t)*-s,.0035,.0035]);}
    fitted(sweep("round spectacle frame "+s,"#4b443a",arc));
    fitted(sweep("spectacle temple "+s,"#605347",[[s*.082,1.636,.100,.003,.003],[s*.10,1.637,.007,.003,.003],[s*.09,1.62,-.016,.003,.003]]));
    cloth(fitted(box("coat pocket "+s,[s*.111,1.04,.125],[.071,.083,.017],"#70604c")));
  }
  fitted(box("spectacle bridge",[0,1.638,.112],[.017,.006,.007],"#53473b"));

  for(let j=0;j<3;j++)cloth(fitted(oval("horn button "+j,[.007,1.055+j*.061,.165-j*.006],[.012,.014,.007],"#493d32")));
  return bindStudy(form,id=>id.includes("coat")||id.includes("button")?"torso":"head");
}
function elder(){
  const {form,sweep,oval,cloth,fitted}=study({face:2,collar:false,pockets:false,skin:"#ad9dbb",hair:"Bald",hairColor:"#dfd9cf",palette:"Polar",
    sculpt:{jaw:1.03,nose:.92,brow:1.12,cheek:1.25},tones:{cloth:"#343d50",trim:"#c9a76b",panel:"#485162",boots:"#353542",pants:"#34384c"}},[1.16,.985,1.11]);
  cloth(fitted(sweep("ink velvet dress","#363848",[[0,.035,0,.258,.186],[0,.15,0,.243,.181],[0,.47,0,.205,.152],[0,.78,0,.224,.158],[0,.91,0,.191,.144],[0,1.03,0,.167,.134],[0,1.20,0,.189,.145],[0,1.34,0,.174,.124],[0,1.38,0,.111,.082]])));
  for(let i=0;i<9;i++){
    const a=i*2*Math.PI/9;
    cloth(fitted(sweep("skirt fold "+(i+1),i%2?"#454454":"#424454",[
      [.25*Math.cos(a),.043,.18*Math.sin(a),.008,.010],[.219*Math.cos(a+.11),.27,.166*Math.sin(a+.11),.012,.009],[.198*Math.cos(a+.2),.51,.147*Math.sin(a+.2),.009,.007],[.199*Math.cos(a+.34),.70,.145*Math.sin(a+.34),.002,.003]])));
  }
  for(let i=0;i<9;i++){
    const x=(i-4)*.021;
    fitted(sweep("silver wave "+(i+1),i%2?"#d5d1c7":"#a6a8a5",[
      [x,1.683+.015*Math.cos(i),.065,.019,.021],[x+.027,1.752,.028,.027,.029],[x+.009,1.762,-.036,.029,.027],[x-.012,1.692,-.084,.022,.023],[x-.011,1.64,-.096,.011,.015]]));
  }
  for(const s of both)fitted(oval("drop earring "+s,[s*.102,1.564,.012],[.014,.033,.015],"#bd9c5b"));
  cloth(fitted(oval("amber brooch",[-.089,1.298,.133],[.038,.046,.016],"#c89a59")));
  return bindStudy(form,id=>id.includes("wave")||id.includes("earring")?"head":"torso");
}
function courier(){
  const {form,sweep,oval,cloth,fitted}=study({face:3,skin:"#bd8f72",hair:"Bald",hairColor:"#262524",sleeves:"none",collar:false,pockets:false,palette:"Polar",sculpt:{jaw:.84,nose:.75,brow:.87,cheek:1.08},
    tones:{cloth:"#2d3638",pants:"#c4c4b9",boots:"#a64b38",trim:"#c89a75",panel:"#373d3d"}},[.87,1.01,.91]);
  fitted(oval("dark bob crown",[0,1.711,-.009],[.205,.15,.216],"#26292a"));
  for(const s of both)fitted(sweep("cut bob "+s,"#222526",[[s*.062,1.74,-.018,.043,.064],[s*.090,1.67,-.012,.024,.073],[s*.087,1.578,-.022,.021,.065],[s*.079,1.552,-.025,.013,.048]]));
  for(let i=0;i<7;i++)fitted(sweep("cropped fringe "+i,"#282929",[
    [(i-3)*.020,1.747,.046,.020,.018],[(i-3)*.022,1.70,.082,.018,.012],[(i-3)*.023+.006,1.672+.006*Math.sin(i),.093,.010,.006]]));
  cloth(fitted(sweep("signal wrist wrap","#aa4735",[[.294,.875,.050,.046,.044],[.292,.939,.036,.051,.049]])));
  for(const s of both)cloth(fitted(oval("trail shoe "+s,[s*.14,.055,.058],[.144,.098,.248],"#ae503f")));
  return bindStudy(form,(id,p)=>id.includes("wrist")?"left arm":id.includes("shoe")?(p.position[0]>0?"left leg":"right leg"):"head");
}
function merchant(){
  const {form,sweep,oval,box}=study({},[1,1,1],true);
  const green="#829073",deep="#586d5c",linen="#c9c6aa",leather="#735d46",gold="#aa8956";
  sweep("arched spine",green,[[0,.67,-.018,.155,.143],[0,.95,-.008,.216,.155],[0,1.22,-.025,.184,.14],[0,1.47,-.012,.106,.095],[0,1.62,.04,.071,.071]]);
  sweep("travel robe",linen,[[0,.28,0,.239,.201],[0,.58,.004,.24,.188],[0,.84,.006,.19,.161],[0,1.08,-.005,.201,.158],[0,1.24,-.018,.182,.14]]);
  sweep("wrapped belt",leather,[[0,.885,0,.211,.168],[0,.97,0,.21,.165]]);
  sweep("long muzzle",green,[[0,1.54,.01,.071,.075],[0,1.64,.035,.127,.128],[0,1.68,.124,.108,.087],[0,1.62,.22,.077,.065],[0,1.608,.256,.054,.042]]);
  for(const s of both){
    oval("watchful eye "+s,[s*.092,1.701,.102],[.077,.068,.062],"#d5bd6b");
    oval("vertical pupil "+s,[s*.106,1.704,.127],[.022,.048,.022],"#27352f");
    sweep("folded ear "+s,deep,[[s*.096,1.66,.002,.04,.040],[s*.155,1.681,-.05,.032,.071],[s*.205,1.724,-.089,.006,.013]]);
    sweep("long shin "+s,deep,[[s*.127,.65,0,.084,.085],[s*.143,.38,.054,.071,.069],[s*.143,.11,-.012,.058,.056]]);
    oval("splayed foot "+s,[s*.145,.075,.046],[.17,.14,.24],green);
    for(let level=0;level<2;level++){
      const y=1.31-level*.25,reach=.37+level*.047;
      sweep("bent arm "+s+" "+level,green,[[s*.143,y,-.018,.074,.071],[s*.273,y-.096,-.013,.063,.061],[s*reach,y-.234,.046,.045,.044],[s*(reach-.014),y-.334,.138,.032,.034]]);
      oval("palm "+s+" "+level,[s*(reach-.014),y-.352,.156],[.084,.096,.073],deep);
      for(let f=0;f<3;f++)sweep("finger "+s+" "+level+" "+f,green,[[s*(reach-.05+f*.030),y-.37,.163,.012,.014],[s*(reach-.05+f*.032),y-.409,.187,.011,.012],[s*(reach-.043+f*.032),y-.419,.212,.005,.007]]);
    }
  }
  sweep("traveller hood",deep,[[0,1.70,-.03,.131,.129],[-.004,1.77,-.039,.127,.126],[-.013,1.865,-.056,.09,.095],[-.034,1.90,-.065,.083,.082]]);
  sweep("woven hatband",gold,[[0,1.758,-.032,.131,.129],[0,1.781,-.037,.127,.124]]);
  for(let i=0;i<5;i++)box("belt case "+i,[(i-2)*.068,.899,.142-Math.abs(i-2)*.013],[.057,.091,.042],i%2?gold:leather);
  for(const p of form.parts)p.surface=p.color===green||p.color===deep?"scales":p.color===linen?"canvas":p.color===leather?"leather":"plain";
  return form;
}
function carapace(){
  const {form,sweep,oval}=study({},[1,1,1],true);
  const stone="#b1a995",dark="#454a43",rim="#837e6e",skin="#726f62";
  sweep("hunched trunk",skin,[[0,.68,.025,.165,.147],[0,.9,0,.244,.195],[0,1.12,-.038,.302,.222],[0,1.29,-.031,.312,.237],[0,1.48,.025,.218,.19],[0,1.56,.11,.119,.123]]);
  oval("low projecting skull",[0,1.49,.163],[.323,.27,.274],dark);
  for(let i=0;i<5;i++){
    const a=(i-2)*.5;
    oval("brow shield "+i,[.125*Math.sin(a),1.543,.168+.098*Math.cos(a)],[.071,.11,.069],stone,[10,0,(i-2)*-12]);
  }
  for(const s of both){
    oval("amber eye "+s,[s*.097,1.473,.259],[.044,.025,.025],"#cbaa68");
    sweep("load bearing leg "+s,dark,[[s*.137,.77,0,.124,.113],[s*.174,.48,.085,.107,.111],[s*.195,.22,.016,.083,.090],[s*.205,.08,.037,.084,.087]]);
    oval("load foot "+s,[s*.208,.085,.091],[.234,.17,.305],rim);
    sweep("power arm "+s,skin,[[s*.252,1.31,-.03,.136,.132],[s*.341,1.132,.003,.116,.12],[s*.424,.92,.063,.101,.107],[s*.442,.71,.118,.077,.082]]);
    oval("hand "+s,[s*.446,.664,.132],[.175,.197,.169],dark);
    for(let i=0;i<3;i++)sweep("hook digit "+s+"/"+i,stone,[[s*(.386+i*.056),.64,.14,.029,.028],[s*(.386+i*.057),.565,.17,.026,.024],[s*(.382+i*.057),.53,.207,.007,.006]]);
    for(let i=0;i<4;i++)oval("shoulder scute "+s+"/"+i,[s*(.245+.039*i),1.332-i*.075,-.005],[.22-i*.011,.158,.249-i*.012],i%2?rim:stone,[0,0,s*20]);
    for(let i=0;i<3;i++)oval("gauntlet ridge "+s+"/"+i,[s*(.421+.006*i),.873-.054*i,.090],[.206,.072,.208],i%2?rim:stone);
    for(let i=0;i<3;i++)oval("shin scute "+s+"/"+i,[s*(.175+.011*i),.473-.096*i,.127-i*.015],[.162-i*.012,.132,.085],stone,[10,0,0]);
  }
  for(let r=0;r<4;r++)for(let c=-1;c<=1;c++)
    oval("back plate "+r+"/"+c,[c*(.144+.008*r),.938+r*.122,-.161-.017*r+.054*Math.abs(c)],[.177,.18,.106],(r+c)%2?stone:rim,[12,0,c*-9]);
  for(let i=0;i<4;i++)oval("chest plate "+i,[0,.936+i*.095,.169+i*.005],[.312+i*.019,.134,.092],i%2?stone:rim);
  for(const p of form.parts)p.surface=p.color===stone||p.color===rim?"scales":"leather";
  return form;
}
export const studies=[
  {id:"ranger",title:"Scarred ranger",game:"Dragon’s Dogma 2",make:ranger},
  {id:"surveyor",title:"Dock surveyor",game:"Dragon’s Dogma 2",make:surveyor},
  {id:"merchant",title:"Marsh trader",game:"Spore",make:merchant},
  {id:"carapace",title:"Ridgeback porter",game:"Spore",make:carapace},
  {id:"elder",title:"Estuary elder",game:"The Sims 4",make:elder},
  {id:"courier",title:"Relay runner",game:"The Sims 4",make:courier},
];
