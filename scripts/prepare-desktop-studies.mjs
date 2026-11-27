import { bundledAsset } from "../packages/character/src/assets.ts";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { prepareForm, preparePacks } from "../verification/families/src/prepare.ts";
import { localReferencesPlugin } from "./local-references.mjs";
import { mhrFit, rigs } from "../examples/local-references.js";

const directory=process.argv[2];
if (!directory) throw new Error("Choose the desktop forms directory.");
const root=fileURLToPath(new URL("../",import.meta.url));
const work=mkdtempSync(join(tmpdir(),"prepare-irudd-studies-"));
const renderer=join(dirname(directory),"renderer");
const index=join(directory,"artwork.json");
const manifest=JSON.parse(readFileSync(index,"utf8"));
const files=new Map(manifest.files.map(asset=>[asset.digest,asset]));
const entry=`
import {studies} from "./character-view/study-catalogue.js";
import {loadTurnarounds} from "./character-view/turnaround.js";
import {validateForm} from "./character-view/recipe.js";
import {armourTailor} from "./character-view/human-armour.js";
window.readStudyForms=async()=>{
  await loadTurnarounds();
  return studies.map(({id,title,game,angle,mode,source,make})=>{
    const form=validateForm(make());
    if (form.humanStyle?.armour) {
      const {armour,...style}=form.humanStyle;
      form.humanStyle={...style,tailor:style.tailor??armourTailor(armour)};
    }
    return {id,title,game,angle:angle??"3/4",mode,source,form};
  });
};`;
try {
  const options={bundle:true,write:false,loader:{".webp":"dataurl",".glb":"dataurl"},define:{WORKSHOP_MHR_LICENSE:JSON.stringify(readFileSync(join(root,"docs/licenses/mhr-apache-2.0.txt"),"utf8"))},plugins:[localReferencesPlugin()]};
  const {outputFiles}=await build({...options,stdin:{contents:entry,resolveDir:root}});
  const page=join(work,"catalogue.html"), output=join(work,"forms.json");
  writeFileSync(join(work,"catalogue.js"),outputFiles[0].contents);
  writeFileSync(page,'<meta charset="utf-8"><script src="catalogue.js"></script>');
  const pkg=join(root,"apps/desktop/node_modules/electron");
  const exe=join(pkg,"dist",readFileSync(join(pkg,"path.txt"),"utf8").trim());
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  execFileSync(exe,[join(root,"scripts/render-desktop-studies.cjs"),page,output,join(work,"profile")],{env,windowsHide:true});
  await preparePacks();
  const catalogue=JSON.parse(readFileSync(output,"utf8")).map(({form,...study})=>{
    const {document,blobs}=prepareForm(study.id,form);
    const starter=study.id.startsWith("scan-")?study.id:"study."+study.id;
    writeFileSync(join(directory,starter+".json"),JSON.stringify({...document,label:study.title}));
    for (const {digest,mediaType,byteLength} of document.assets) {
      if(files.has(digest)) continue;
      const bundled=bundledAsset(digest);
      const portrait={"salt-road-warden":"examples/warden-portrait.json","tramline-runner":"examples/runner-portrait.json"}[study.id];
      const bytes=bundled ? readFileSync(join(root,"character-view",bundled.file)) : blobs.get(digest);
      const origin=bundled?.origin ?? (portrait && {kind:"project",license:"MIT",source:portrait});
      if(!origin || !bytes || bytes.length!==byteLength || "sha256:"+createHash("sha256").update(bytes).digest("hex")!==digest)
        throw new Error(study.id+": missing verified artwork or origin for "+digest);
      const file="artwork/"+digest.slice(7)+".webp";
      writeFileSync(join(directory,file),bytes);
      files.set(digest,{digest,mediaType,byteLength,file,origin});
    }
    return {...study,starter,...(form.referenceRigs?.length ? {referenceRigs:true} : {})};
  });
  writeFileSync(index,JSON.stringify({...manifest,files:[...files.values()]}));
  const hasRig=Boolean(mhrFit && rigs.includes("mhr-rest"));
  writeFileSync(join(renderer,"rig-available.json"),JSON.stringify(hasRig));
  if (hasRig) {
    const bundled=await build({...options,entryPoints:[join(root,"examples/rig-study-standalone.js")]});
    const html=readFileSync(join(root,"examples/rig-study.html"),"utf8").replace("<template data-workshop-app></template>",()=>'<script src="rig-study.js"></script>');
    writeFileSync(join(renderer,"rig-study.js"),bundled.outputFiles[0].contents);
    writeFileSync(join(renderer,"rig-study.html"),html);
  }
  console.log(JSON.stringify(catalogue));
} finally {rmSync(work,{recursive:true,force:true});}
