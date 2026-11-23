import assert from "node:assert/strict";
import test from "node:test";
import { Mesh,MeshStandardMaterial } from "three";
import {reshapeSpine} from "./spine-edit.js";
import { cageGeometry,checkCage } from "./control-cage.js";
import {growPlateField,finishPlateSurface,plateGrowthDefaults,validPlateGrowth,validPlateGrowthRest,validPlateSite} from "./plate-growth.js";
import {startingForm, validateForm} from "./recipe.js";

const sweep = (id,knots,parent) => ({
  id,shape:"sweep",position:[0,0,0],rotation:[0,0,0],size:[1,1,1],color:"#504135",knots,...(parent?{parent}:{}),
});
const trunk = sweep("hump",[[0,0,0,.16,.12],[0,.39,-.06,.27,.22],[0,.79,.06,.1,.09]]);
const limb = sweep("arm",[[0,0,0,.09,.08],[.23,-.08,.05,.08,.09],[.42,-.03,.11,.07,.07]],"hump");
const recipe = () => ({...startingForm(()=>.5),parts:structuredClone([trunk,limb])});
const patch={seed:17,tipSeed:71,rows:4,columns:3};
const grown=()=>growPlateField(recipe(),"hump",patch).form;
const sites=(form,id="hump")=>form.parts.filter(p=>p.parent===id && p.plateSite);
const match=(form,id)=>form.parts.find(p=>p.id===id);

test("seeded shells follow the carrier, retain a folded keel and validate as closed editable cages",()=>{
  assert.ok(validPlateGrowth(plateGrowthDefaults));
  const a=grown(),b=grown(),plates=sites(a);
  assert.deepEqual(a,b);
  assert.deepEqual(growPlateField(a,"hump",patch).form,a);
  assert.equal(plates.length,12);
  assert.equal(validateForm(JSON.parse(JSON.stringify(a))).parts.length,a.parts.length);
  for(const p of plates){
    checkCage(p.cage);
    const edges = new Map();
    for(const f of p.cage.faces)for(const [j,x] of f.entries()){
      const y=f[(j+1)%f.length],key=[x,y].sort((x,y)=>x-y).join("/");
      edges.set(key,(edges.get(key)??0)+1);
    }
    assert.ok([...edges.values()].every(n=>n===2));
    assert.equal(p.surface,"horn");
    assert.ok(p.cage.creases.length>12);
    assert.deepEqual(p.surfaceJoin.faces,[0]);
  }
  const altered=growPlateField(a,"hump",{crest:.1}).form;
  assert.deepEqual(sites(altered).map(p=>p.id),plates.map(p=>p.id));
  assert.deepEqual(sites(altered).map(p=>p.position),plates.map(p=>p.position));
  assert.notDeepEqual(sites(altered)[6].cage.vertices,plates[6].cage.vertices);
});

test("tip rerolls preserve placement, root geometry, authored sculpt offsets, materials and children",()=>{
  const form=grown(),plate=sites(form)[6],id=plate.id;
  plate.position[0]+=.037; plate.rotation[2]=12; plate.size[1]=1.11;plate.color="#886633";
  plate.cage.vertices[0][0]+=.019;plate.cage.vertices.at(-1)[2]+=.012;
  const sprout=sweep("offshoot",[[0,0,0,.03,.03],[.02,.11,0,.02,.02]],id);
  form.parts.push(sprout);
  const snapshot=structuredClone(form);
  const changed=growPlateField(form,"hump",{tipSeed:230}).form,other=match(changed,id);
  assert.deepEqual(snapshot,form);
  assert.equal(changed.parts.at(-1),sprout);
  for(const k of ["id","position","rotation","color","size","plateSite"])assert.deepEqual(plate[k],other[k]);
  assert.deepEqual(other.cage.vertices.slice(0,56),plate.cage.vertices.slice(0,56));
  assert.notDeepEqual(other.cage.vertices.slice(-8),plate.cage.vertices.slice(-8));
  const unedited=match(growPlateField(grown(),"hump",{tipSeed:230}).form,id);
  assert.ok(Math.abs(other.cage.vertices.at(-1)[2]-unedited.cage.vertices.at(-1)[2]-.012)<1e-7);
  assert.equal(match(changed,"arm"),match(form,"arm"));
});

test("one tip can be rerolled, kept through a whole-field reroll and released",()=>{
  const form=grown(), initial=sites(form)[4];
  const result=growPlateField(form,initial.id,{op:"growPlateField",id:initial.id,tipSeed:58});
  assert.equal(result.id,initial.id);
  const individual=match(result.form,initial.id);
  assert.equal(individual.plateSite.tipSeed,58);
  assert.deepEqual(individual.position,initial.position);
  assert.deepEqual(individual.cage.vertices.slice(0,56),initial.cage.vertices.slice(0,56));
  assert.notDeepEqual(individual.cage.vertices.slice(-8),initial.cage.vertices.slice(-8));
  for(const p of result.form.parts)if(p.id!==initial.id)assert.equal(p,match(form,p.id));
  const group=growPlateField(result.form,"hump",{tipSeed:44}).form;
  assert.deepEqual(match(group,initial.id),individual);
  const released=growPlateField(group,initial.id,{tipSeed:null}).form;
  assert.deepEqual(released,growPlateField(form,"hump",{tipSeed:44}).form);
  assert.throws(()=>growPlateField(form,initial.id,{crest:.5}),/tip seed/);
});

test("shrinking protects attached children, custom sculpting and deliberately removed sites",()=>{
  const form=grown(),p=sites(form).at(-1);
  const hand=sweep("child",[[0,0,0,.034,.021],[.03,.16,0,.018,.02]],p.id);
  assert.throws(()=>growPlateField({...form,parts:[...form.parts,hand]},"hump",{rows:3}),/attachments/);
  p.rotation[1]=12;
  const less=growPlateField(form,"hump",{rows:3}).form;
  assert.equal(match(less,p.id).plateSite,undefined);
  assert.deepEqual(match(less,p.id).rotation,p.rotation);
  assert.equal(sites(less).length,9);
  const deleted=sites(less)[1].id;
  const without={...less,parts:less.parts.filter(p=>p.id!==deleted)};
  const expanded=growPlateField(without,"hump",{columns:5}).form;
  assert.equal(match(expanded,deleted),undefined);
  assert.equal(expanded.parts.filter(p=>p.id===p.parent).length,0);
  assert.equal(sites(expanded).length,14);
});

test("transfer to a diagonal limb and reflection follow the requested local face",()=>{
  const source=recipe(),g=growPlateField(source,"arm",{...patch,face:"Top",direction:"last"}).form;
  validateForm(g);
  const m=structuredClone(source); m.parts[1].knots=m.parts[1].knots.map(([x,...rest])=>[-x,...rest]);
  const mirrored=growPlateField(m,"arm",{...patch,face:"Top",direction:"last",mirrored:true}).form;
  validateForm(mirrored);
  const south=sites(g,"arm"),north=sites(mirrored,"arm");
  const close=(a,b)=>Math.abs(a-b)<1e-7;
  for(const [i,a] of south.entries()){
    const b=north[i];
    assert.deepEqual(a.plateSite,b.plateSite);
    assert.ok(close(a.position[0],-b.position[0])&&close(a.position[1],b.position[1])&&close(a.position[2],b.position[2]));
    for(const [j,v] of a.cage.vertices.entries()){
      const w=b.cage.vertices[j]; assert.ok(close(v[0],-w[0])&&close(v[1],w[1])&&close(v[2],w[2]));
    }
    assert.deepEqual(b.cage.faces,a.cage.faces.map(f=>[...f].reverse()));
  }
  assert.equal(g.parts[0],source.parts[0]);
  assert.ok(south.find(p=>p.plateSite.row===2&&p.plateSite.column===0).position[1]>-.01);
});

test("shared horn material and growth UVs survive copying and independent local tip rerolls",()=>{
  const f=grown(),a=sites(f)[2],b=match(growPlateField(f,a.id,{tipSeed:686}).form,a.id);
  const shared=new MeshStandardMaterial();
  const finish=(p)=>{
    const mesh=new Mesh(cageGeometry(p.cage),new MeshStandardMaterial());finishPlateSurface(mesh,p,()=>shared);
    assert.equal(mesh.material,shared);assert.equal(mesh.material.vertexColors,true);
    const uv=mesh.geometry.attributes.uv, rgb=mesh.geometry.attributes.color;
    assert.ok(rgb.count>100);assert.ok([...uv.array].every(n=>Number.isFinite(n)&&n>=0&&n<=1));
    return [Array.from(uv.array),Array.from(rgb.array)];
  };
  assert.deepEqual(finish(a),finish({...a,plateSite:undefined}));
  const extrema=arr=>[Math.floor(2*Math.min(...arr.filter((_,i)=>i%2===0))),Math.floor(2*Math.min(...arr.filter((_,i)=>i%2===1)))];
  assert.deepEqual(extrema(finish(a)[0]),extrema(finish(b)[0]));
});

test("invalid configurations and insufficient carrier space fail without changing the recipe",()=>{
  const f=recipe();
  for(const p of [{rows:20},{columns:4},{foo:2},{seed:-1},{start:.7,end:.72},{crest:2}])assert.throws(()=>growPlateField(f,"hump",p));
  assert.throws(()=>growPlateField(f,"absent",{}),/swept/);
  assert.throws(()=>growPlateField(f,"arm",{rows:12,columns:7,wrap:20,start:.3,end:.36}),/longer or wider/);
  assert.equal(validPlateSite({row:0,column:0,tipSeed:null}),false);
  assert.equal(validPlateSite({row:0,column:0,other:"data"}),false);
  assert.equal(match(f,"hump").plateGrowth,undefined);
});
test("refitting a reshaped carrier applies the shape difference once and preserves hand edits",()=>{
  const initial=grown(), carrier=match(initial,"hump"), source=sites(initial)[4];
  const knots=carrier.knots.map(([x,y,z,w,d],i)=>[x+i*.11,y,z-.061*i,w*1.14,d*1.13]);
  const old=structuredClone(initial);
  const edited=match(old,source.id);
  edited.position[0]+=.033;edited.cage.vertices[13][2]+=.014;edited.rotation[0]=-14;
  const direct={...old,parts:old.parts.map(p=>p.id===carrier.id ? {...p,knots} : p)};
  const tips=growPlateField(direct,carrier.id,{tipSeed:13}).form;
  assert.deepEqual(match(tips,source.id).position,edited.position);
  assert.deepEqual(match(tips,carrier.id).plateGrowthRest,carrier.plateGrowthRest);
  const corrected=growPlateField(direct,carrier.id).form;
  const auto=reshapeSpine(old,carrier.id,knots);
  assert.deepEqual(sites(auto),sites(corrected));
  const base=recipe();match(base,carrier.id).knots=knots;
  const expected=match(growPlateField(base,carrier.id,patch).form,source.id);
  const actual=match(auto,source.id);
  assert.ok(Math.abs(actual.position[0]-expected.position[0]-.033)<1e-7);
  assert.ok(Math.abs(actual.cage.vertices[13][2]-expected.cage.vertices[13][2]-.014)<1e-7);
  assert.deepEqual(actual.rotation,edited.rotation);
  assert.deepEqual(growPlateField(corrected,carrier.id).form,corrected);
  assert.ok(validPlateGrowthRest(match(corrected,carrier.id).plateGrowthRest));
  assert.equal(validPlateGrowthRest({knots,frameSize:[1,1,0],horizontal:false}),false);
  const legacy=structuredClone(initial);delete match(legacy,carrier.id).plateGrowthRest;
  assert.deepEqual(sites(reshapeSpine(legacy,carrier.id,knots)),sites(growPlateField(base,carrier.id,patch).form));
});
test("radial rise articulates a pointed crest while its sockets and basal cross-sections stay fixed", () => {
  const base = recipe();
  const shape = { ...patch, rows: 6, columns: 1, wrap: 22, crest: 1, face: "Back" };
  const low = growPlateField(base, "hump", shape).form;
  const high = growPlateField(low, "hump", { rise: 3 }).form;
  const flat = growPlateField(low, "hump", { rise: 0.5 }).form;
  assert.ok(validPlateGrowth({ ...plateGrowthDefaults, rise: undefined }));
  assert.equal(validPlateGrowth({ ...plateGrowthDefaults, rise: 3.01 }), false);
  const tip = (p) => p.cage.vertices.at(-5);
  const distance = (a, b) => Math.hypot(...a.map((n, i) => b[i] - n));
  for (const plate of sites(low)) {
    const extended = match(high, plate.id);
    const folded = match(flat, plate.id);
    assert.deepEqual(extended.position, plate.position);
    assert.deepEqual(
      extended.cage.vertices.slice(0, 16),
      plate.cage.vertices.slice(0, 16),
    );
    assert.deepEqual(extended.surfaceJoin, plate.surfaceJoin);
    assert.ok(distance(tip(plate), tip(extended)) > 0.018);
    assert.ok(distance(tip(plate), tip(folded)) > 0.001);
    checkCage(extended.cage);
    checkCage(folded.cage);
  }
  assert.deepEqual(sites(growPlateField(high, "hump", { rise: 1 }).form), sites(low));
});
