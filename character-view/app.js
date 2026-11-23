import * as T from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {manipulator,findPart} from "./manipulator.js";
import {appendPart,copyBranch,removePart} from "./parts.js";
import {generateForm} from "./generator.js";
import {GLTFExporter} from "three/addons/exporters/GLTFExporter.js";
import {studies} from "../examples/studies.js";
import {loadSurfaces} from "./materials.js";
import {loadFacePaint} from "./face.js";
import { createCharacter, disposeCharacter } from "./model.js";
import {startingForm,nudge,neutral,outfits,entropy,makeBrief,readProposal,validateForm,anchors,modes} from "./recipe.js";

const $ = selector=>document.querySelector(selector);
const storageKey="irudd-character-workshop-v1";
let form=generateForm(), revision=crypto.randomUUID(), amounts=neutral(), target=null, instructions="", request=null;
const history=[];
try {
  const saved=JSON.parse(localStorage.getItem(storageKey));
  if(saved && typeof saved.revision==="string") {
    form=validateForm(saved.form);revision=saved.revision;
    const savedRequest=saved.request;
    if(savedRequest?.revision===revision && savedRequest.format==="irudd.form-request.v1"){
      validateForm(savedRequest.preview);
      request=savedRequest; amounts={...(request.nudge.amounts??request.nudge.percent)};target=request.nudge.target;instructions=request.instructions;
    }
  }
} catch { /* Storage may be unavailable when running a downloaded file. */ }
let silhouette=false, proposal=null, showCurrent=false, busy=false;
const connected=document.querySelector('meta[name="workshop-agent"]')?.content==="local";
const scene = new T.Scene();
scene.background = new T.Color("#dce4e1");
const camera = new T.OrthographicCamera(-1, 1, 1, -1, 0.05, 50);
let figure;
const stage = $("#stage");
const canvas = $("#viewport");

const views = {
  "3/4": [2.1, 1.36, 4.25],
  Front: [0, 0.7, 4.8],
  Side: [4.8, 0.7, 0],
  Back: [0, 0.7, -4.8],
};
const axes=Object.values(modes).flat();
let operation="shape";
let renderer, controls, gizmo, direct=false, knot=null;

function button(label, handler) {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = label;
  element.addEventListener("click", handler);
  return element;
}
function pressed(element, state) {
  element.setAttribute("aria-pressed", String(state));
}
function status(text){$("#status").textContent=text;}
function persist(){
  try{localStorage.setItem(storageKey,JSON.stringify({form,revision,request}));}catch{}
}
function clearDraft(){
  knot=null;
  amounts=neutral();request=null;proposal=null;showCurrent=false;
}
function commit(next,message){
  validateForm(next);
  history.push(form);if(history.length>64) history.shift();
  form=next;revision=crypto.randomUUID();clearDraft();
  if(!form.parts.some(p=>p.id===target)) target=null;
  if((operation==="face"&&!form.parts.some(p=>p.shape==="head"))||(!target&&operation==="turn"))operation="shape";
  persist();update();status(message);
}
function chooseAngle(name, resetZoom = false) {
  if(resetZoom && figure){
    const bounds=visibleBounds(figure);
    bounds.getCenter(controls.target);
    const ext=bounds.getSize(new T.Vector3());
    camera.zoom=Math.min(3,(camera.top-camera.bottom)/Math.max(ext.y*1.32,ext.z*.55,.35),
      (camera.right-camera.left)/(Math.max(ext.x,ext.z)*1.45+.06));camera.updateProjectionMatrix();
  }else if(!figure) controls.target.set(0,.9,0);
  camera.position.copy(controls.target).add(new T.Vector3(...views[name]));
  controls.update();
  for (const el of $("#angles").children)
    pressed(el, el.dataset.angle === name);
  render();
}
function selectTarget(id){
  if(busy||proposal)return;
  if(axes.some(k=>Boolean(amounts[k]))){$("#target").value=target??"";status("Apply or reset the current nudge before selecting another part.");return;}
  target=id;knot=null;request=null;
  if((operation==="turn"&&!id)||(operation==="face" && id && form.parts.find(p=>p.id===id)?.shape!=="head"))operation="shape";
  persist();update();status("");
}
function editPart(change){
  try{
    const preview=nudge(form,target,amounts),part=preview.parts.find(p=>p.id===target);
    if(!part)return;
    const updated=change(part),next={...preview,parts:preview.parts.map(p=>p.id===target?updated:p)};
    commit(next,"Updated "+target+".");
  }catch(e){status(e.message);update();}
}
function visibleBounds(object){
  const bounds=new T.Box3().makeEmpty();
  object.updateWorldMatrix(true,true);
  object.traverseVisible(part=>{
    if(part.isMesh){
      if(!part.geometry.boundingBox)part.geometry.computeBoundingBox();
      bounds.union(part.geometry.boundingBox.clone().applyMatrix4(part.matrixWorld));
    }
  });
  return bounds;
}
function download(blob,name){
  const url=URL.createObjectURL(blob),link=document.createElement("a");link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),3000);
}
function switchTab(name){
  for(const el of document.querySelectorAll("[data-tab]"))pressed(el,el.dataset.tab===name);
  for(const panel of document.querySelectorAll("[data-panel]"))panel.hidden=panel.dataset.panel!==name;
}
function bindControls(){
  const input=$("#steering");
  input.value=instructions;
  input.oninput=()=>{request=null;persist();status("");};
  $("#target").onchange=()=>selectTarget($("#target").value||null);
  $("#direct").onclick=()=>{direct=!direct;update();status(direct?"Select a part on the model, then drag an axis.":"Orbit view.");};
  $("#focus").onclick=()=>{
    const object=findPart(figure,target)??figure, bounds=visibleBounds(object);
    const size=bounds.getSize(new T.Vector3());
    const offset=camera.position.clone().sub(controls.target);
    bounds.getCenter(controls.target);camera.position.copy(controls.target).add(offset);
    camera.zoom=Math.min(15,(camera.top-camera.bottom)/Math.max(size.y*1.5,.12),
      (camera.right-camera.left)/(Math.max(size.x,size.z)*1.65+.03));
    camera.updateProjectionMatrix();controls.update();render();
  };
  $("#knot").onchange=()=>{knot=$("#knot").value===""?null:Number($("#knot").value);direct=true;update();};
  for(const [id,mul] of [["thinner",.89],["thicker",1.12]])$("#"+id).onclick=()=>editPart(p=>({...p,knots:p.knots.map((r,i)=>i===knot?[...r.slice(0,3),r[3]*mul,r[4]*mul]:r)}));
  $("#insert-knot").onclick=()=>editPart(p=>{
    const i=Math.min(knot,p.knots.length-2),a=p.knots[i],b=p.knots[i+1];
    return {...p,knots:[...p.knots.slice(0,i+1),a.map((v,k)=>(v+b[k])*.5),...p.knots.slice(i+1)]};
  });
  $("#surface").onchange=()=>editPart(p=>({...p,surface:$("#surface").value}));
  $("#part-color").onchange=()=>editPart(p=>({...p,color:$("#part-color").value}));
  for(const [id,action] of [["attach",f=>appendPart(f,target,$("#shape").value)],["duplicate",f=>copyBranch(f,target,false)],["mirror",f=>copyBranch(f,target,true)]])
    $("#"+id).onclick=()=>{try{const next=action(nudge(form,target,amounts));validateForm(next.form);target=next.id;commit(next.form,"Created "+next.id+".");}catch(e){status(e.message);}};
  $("#remove").onclick=()=>{try{commit(removePart(nudge(form,target,amounts),target),"Removed the selected branch.");}catch(e){status(e.message);}};
  for(const tab of document.querySelectorAll("[data-tab]")) tab.onclick=()=>switchTab(tab.dataset.tab);
  for(const el of $("#operations").children)el.onclick=()=>{operation=el.dataset.op;update();};
  $("#clear").onclick=()=>{amounts=neutral();request=null;persist();update();status("Nudges cleared.");};
  $("#studies").replaceChildren(...studies.map(s=>new Option(s.title+" · "+s.game,s.id)));
  $("#study").onclick=()=>{const study=studies.find(s=>s.id===$("#studies").value);commit(study.make(),"Loaded "+study.title+".");switchTab("sculpt");chooseAngle("3/4",true);};
  $("#save").onclick=()=>download(new Blob([JSON.stringify({format:"irudd.form.v1",form},null,2)],{type:"application/json"}),"character.form.json");
  $("#open").onclick=()=>$("#openfile").click();
  $("#openfile").onchange=async()=>{const f=$("#openfile").files[0];$("#openfile").value="";if(!f)return;
    try{if(f.size>500000)throw new Error("Form exceeds 500 KB.");const data=JSON.parse(await f.text());
      if(data.format!=="irudd.form.v1")throw new Error("Choose a saved form."); commit(data.form,"Form opened.");switchTab("sculpt");chooseAngle("3/4",true);
    }catch(e){status(e.message);}};
  $("#glb").onclick=async()=>{let exporting;try{
    exporting=createCharacter(form,false);
    const bytes=await new GLTFExporter().parseAsync(exporting,{binary:true});
    download(new Blob([bytes],{type:"model/gltf-binary"}),"character.glb");
    status("Exported the accepted 3D form.");
  }catch(e){status(e.message);}finally{if(exporting)disposeCharacter(exporting);}};
  for(const key of axes){
    const row=document.createElement("label");row.className="nudge";
    const label=document.createElement("span");label.textContent=key[0].toUpperCase()+key.slice(1);
    const slider=document.createElement("input");
    row.dataset.axis=key;
    slider.type="range";slider.min=modes.face.includes(key)?-40:-15;slider.max=-slider.min;slider.step=1;slider.id=key;
    slider.setAttribute("aria-label",key+" nudge");
    const out=document.createElement("output");out.id="value-"+key;
    slider.oninput=()=>{amounts[key]=Number(slider.value);request=null;persist();update();status("");};
    row.append(label,slider,out);$("#features").append(row);
  }
  $("#roll").onclick=()=>{
    const choices=modes[operation];const key=choices[Math.floor(entropy()*choices.length)];
    amounts[key]=(entropy()<.5?-1:1)*(3+Math.floor(entropy()*10));
    request=null;persist();update();status("Small variation ready to apply or use as AI direction.");
  };
  $("#apply").onclick=()=>{try{commit(nudge(form,target,amounts),"Nudge applied.");}catch(e){status(e.message);}};
  $("#fresh").onclick=()=>{target=null;commit(generateForm($("#body-plan").value),"Generated a new starting form.");chooseAngle("3/4",true);switchTab("sculpt");};
  $("#undo").onclick=()=>{
    if(!history.length)return;
    form=history.pop();revision=crypto.randomUUID();clearDraft();target=null;persist();update();status("Restored the previous form.");
  };
  for(const outfit of outfits) {
    const el=button(outfit,()=>commit({...nudge(form,target,amounts),outfit},"Wardrobe updated."));
    el.className="outfit";$("#outfits").append(el);
  }
  $("#generate").textContent=connected?"Generate variation":"Export AI request";
  $("#agent-help").textContent=connected?"Sends the current form, nudges and direction to your local Codex CLI.":"Give the exported JSON to your agent, then load its proposal here.";
  $("#generate").onclick=generate;
  $("#import").onclick=()=>$("#file").click();
  $("#file").onchange=async()=>{
    const file=$("#file").files[0];$("#file").value="";
    if(!file)return;
    try{if(file.size>500000)throw new Error("Proposal exceeds 500 KB.");
      const raw=JSON.parse(await file.text());proposal=readProposal(raw,request,revision);
      showCurrent=false;update();status("Review the proposed form.");
    }catch(e){status(e.message);}
  };
  $("#compare").onclick=()=>{showCurrent=!showCurrent;update();};
  $("#accept").onclick=()=>commit(proposal.form,"AI variation accepted.");
  $("#discard").onclick=()=>{proposal=null;request=null;showCurrent=false;persist();update();status("Proposal discarded. Your nudge is still editable.");};
  for (const el of $("#angles").children) el.onclick=()=>chooseAngle(el.dataset.angle);
  $("#reset").onclick=()=>chooseAngle("3/4",true);
  for (const el of $("#display").children) el.onclick=()=>{silhouette=el.dataset.mode==="Silhouette";update();};
}
function referenceViews(){
  const bounds=visibleBounds(figure),center=bounds.getCenter(new T.Vector3()),extent=bounds.getSize(new T.Vector3());
  const radius=Math.max(extent.length()*.56,.15);
  const aspect=canvas.width/canvas.height;
  const half=radius/Math.min(1,aspect);
  const cam=new T.OrthographicCamera(-half*aspect,half*aspect,half,-half,.01,100);
  const shot=document.createElement("canvas");shot.width=shot.height=448;
  const ctx=shot.getContext("2d"),side=Math.min(canvas.width,canvas.height);
  const views=[];
  try{
    for(const [name,dir] of [["front-quarter",[.45,.18,1]],["rear-quarter",[-.7,.16,-1]]]){
      cam.position.copy(center).addScaledVector(new T.Vector3(...dir).normalize(),radius*3.5+2);
      cam.lookAt(center);cam.updateMatrixWorld();renderer.render(scene,cam);
      ctx.drawImage(canvas,(canvas.width-side)/2,(canvas.height-side)/2,side,side,0,0,448,448);
      views.push({name,jpeg:shot.toDataURL("image/jpeg",.76).split(",")[1]});
    }
  }finally{render();}
  return views;
}
async function generate(){
  if(busy||proposal)return;
  const direction=$("#steering").value.trim();
  if(!direction && !axes.some(axis=>Boolean(amounts[axis]))){status("Describe a change or move a nudge first.");$("#steering").focus();return;}
  try{
    request=makeBrief(form,revision,target,amounts,direction);
    persist();
    if(!connected){
      const url=URL.createObjectURL(new Blob([JSON.stringify(request,null,2)],{type:"application/json"}));
      const link=document.createElement("a");link.href=url;link.download="form-request.json";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
      status("Request exported. Ask your agent to return the proposal as JSON.");return;
    }
    const views=referenceViews();busy=true;update();status("Generating a variation…");
    const res=await fetch("/variation",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...request,views})});
    const raw=await res.json();if(!res.ok)throw new Error(raw.error || "Generation failed.");
    proposal=readProposal(raw,request,revision);showCurrent=false;status("Review the proposed form.");
  }catch(e){status(e.message);}finally{busy=false;update();}
}
function update(){
  const preview=proposal?(showCurrent?form:proposal.form):nudge(form,target,amounts);
  gizmo?.detach();
  if(figure){scene.remove(figure);disposeCharacter(figure);}
  figure=createCharacter(preview,silhouette);scene.add(figure);
  const height=visibleBounds(figure).getSize(new T.Vector3()).y;
  $("#size").textContent=height.toFixed(2)+" m overall";
  const changed=axes.some(key=>Boolean(amounts[key])), locked=busy||Boolean(proposal);
  $("#revision").textContent=proposal?(showCurrent?"Current form":"AI proposal"):changed?"Nudge preview":"Current form";
  $("#look").textContent=preview.parts.length+" parts";
  $("#candidate").hidden=!proposal;
  $("#summary").textContent=proposal?.summary||"";
  $("#compare").textContent=showCurrent?"Show proposal":"Show current";
  pressed($("#compare"),showCurrent);
  const list=$("#target");
  const options=[["","Whole form"],...form.parts.map(p=>[p.id,p.id])];
  if(list.length!==options.length || options.some(([id],i)=>list.options[i]?.value!==id))
    list.replaceChildren(...options.map(([id,label])=>new Option(label,id)));
  list.value=target||"";
  const part=form.parts.find(p=>p.id===target);
  for(const el of $("#operations").children){
    pressed(el,operation===el.dataset.op);
    el.disabled=locked || (el.dataset.op==="face" && (part?part.shape!=="head":!form.parts.some(p=>p.shape==="head"))) || (el.dataset.op==="turn" && !target);
  }
  for(const key of axes){
    const value=amounts[key]??0;
    $("#"+key).parentElement.hidden=!modes[operation].includes(key);
    $("#"+key).value=value;$("#value-"+key).textContent=(value>0?"+":"")+value+(modes.turn.includes(key)?"°":modes.move.includes(key)?" cm":"%");
    $("#"+key).disabled=locked;
  }
  for(const id of ["target","roll","generate","fresh","import","steering","study","open","clear"])$("#"+id).disabled=locked;
  $("#undo").disabled=!history.length||locked;$("#apply").disabled=!changed||locked;
  $("#direct").disabled=locked;pressed($("#direct"),direct);
  $("#focus").disabled=!target;
  $("#paintpart").hidden=!part || Object.hasOwn(anchors,part.shape);
  if(!$("#paintpart").hidden){$("#surface").value=part.surface??"plain";$("#part-color").value=part.color;}
  $("#knot-tools").hidden=part?.shape!=="sweep"||!direct||locked;
  if(!$("#knot-tools").hidden){
    $("#knot").replaceChildren(new Option("Whole part",""),...part.knots.map((_,i)=>new Option("Point "+(i+1),i)));
    $("#knot").value=knot??"";
  }
  for(const id of ["thinner","thicker","insert-knot"])$("#"+id).disabled=knot===null||locked;
  for(const id of ["duplicate","mirror","remove"])$("#"+id).disabled=!part||locked;
  for(const id of ["attach","part-color","surface"])$("#"+id).disabled=locked;
  gizmo?.attach(figure,preview,target,operation,direct&&!locked,knot);
  const hasBody=preview.parts.some(p=>Object.hasOwn(anchors,p.shape));
  for(const el of $("#outfits").children){pressed(el,hasBody&&el.textContent===preview.outfit);el.disabled=locked||!hasBody||el.textContent===form.outfit;}
  for(const el of $("#display").children)pressed(el,(el.dataset.mode==="Silhouette")===silhouette);
  render();
}
function render() {
  if(!renderer)return;
  renderer.render(scene, camera);
  for (let h = 0; h <= 2; h++) {
    const pos = new T.Vector3(0, h, 0).project(camera);
    $("#tick" + h).style.top = (1 - pos.y) * 50 + "%";
  }
}
function resize() {
  const width = stage.clientWidth,
    height = stage.clientHeight,
    aspect = width / height;
  const frame = Math.max(2.65, 1.65 / aspect);
  Object.assign(camera, {
    top: frame / 2,
    bottom: -frame / 2,
    left: (-frame * aspect) / 2,
    right: (frame * aspect) / 2,
  });
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
  render();
}
function setup() {
  renderer = new T.WebGLRenderer({
    canvas,
    antialias: true,
    preserveDrawingBuffer: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFShadowMap;
  scene.fog = new T.FogExp2("#dce4e1", 0.035);
  const ground = new T.Mesh(
    new T.PlaneGeometry(80, 80),
    new T.MeshStandardMaterial({ color: "#becdbf", roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.015;
  ground.receiveShadow = true;
  scene.add(ground);
  const grid = new T.GridHelper(10, 40, "#9aafa2", "#aabbaf");
  grid.position.y = -0.011;
  grid.material.transparent = true;
  grid.material.opacity = 0.54;
  scene.add(grid);
  const rim = new T.Mesh(
    new T.RingGeometry(1.27, 1.278, 96),
    new T.MeshBasicMaterial({ color: "#8da195" }),
  );
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = -0.008;
  scene.add(rim);
  scene.add(new T.HemisphereLight("#f2f6ff", "#a5aaa5", 1.35));
  const key = new T.DirectionalLight("#fff3dd", 2.8);
  key.position.set(-3.2, 5, 4.5);
  key.castShadow = true;
  Object.assign(key.shadow.camera, {
    left: -2.4,
    right: 2.4,
    top: 2.5,
    bottom: -2.5,
    near: 0.1,
    far: 12,
  });
  key.shadow.camera.updateProjectionMatrix();
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.normalBias = 0.009;
  key.shadow.bias = -0.0003;
  scene.add(key);
  const back = new T.DirectionalLight("#d8e9ff", 2.1);
  back.position.set(2.5, 3, -3);
  scene.add(back);
  controls = new OrbitControls(camera, canvas);
  controls.enablePan = false;
  controls.minZoom = 0.65;
  controls.maxZoom = 15;
  controls.minPolarAngle = 0.35;
  controls.maxPolarAngle = Math.PI / 2 - 0.024;
  controls.rotateSpeed = 0.75;
  controls.addEventListener("change", () => {
    for (const el of $("#angles").children) pressed(el, false);
    render();
  });
  gizmo=manipulator(scene,camera,canvas,controls,{pick:selectTarget,finish:p=>editPart(()=>p),render});
  bindControls();
  chooseAngle("3/4");
  resize();
  update();
  chooseAngle("3/4",true);
  new ResizeObserver(resize).observe(stage);
}
try {
  setup();
  Promise.all([loadFacePaint(),loadSurfaces()]).then(update).catch(()=>status("Some surface paint is unavailable."));
} catch (error) {
  console.error(error);
  $("#failure").hidden = false;
  $("#failure").textContent =
    "The 3D view could not start. Open this file in a browser with WebGL 2 hardware acceleration enabled.";
  document
    .querySelectorAll("button,input")
    .forEach((el) => (el.disabled = true));
}
