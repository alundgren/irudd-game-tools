import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { local, revision, targets } from "./local.mjs";

const raw = "https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/" + revision + "/";
const page = "https://github.com/microsoft/Microsoft-Rocketbox/blob/" + revision + "/";
const licenceBlob = "9bcfb3ece5301a55d3a41bbd00a029ab27d61d13";
const blobs = {
  "Assets/Avatars/Adults/Female_Adult_04/Export/Female_Adult_04.fbx": "cf5a84ba111473c662e1ad77ae6c68d840e4ec71",
  "Assets/Avatars/Adults/Female_Adult_04/Textures/f004_body_color.tga": "d087c788a3d06ddff161f7d726e5964d10ab5679",
  "Assets/Avatars/Adults/Female_Adult_04/Textures/f004_head_color.tga": "8431d9774e3d416447096367fecf4a0f75bc7ea5",
  "Assets/Avatars/Adults/Female_Adult_04/Textures/f004_opacity_color.tga": "86f656686004a338b13026515c7395c946170352",
  "Assets/Avatars/Professions/Gardener_Male_01/Export/Gardener_Male_01.fbx": "d1def87bb530743db2df841edb77c607d8924937",
  "Assets/Avatars/Professions/Gardener_Male_01/Textures/m106_body_color.tga": "5ccd297d5609765d8d6cfccbc34113a94944d27a",
  "Assets/Avatars/Professions/Gardener_Male_01/Textures/m106_head_color.tga": "cbcb8b66787378c76bb74c810f14208d721606ba",
  "Assets/Avatars/Professions/Gardener_Male_01/Textures/m106_opacity_color.tga": "1eda6be82167a0956c40000eaaabe96094c70dbd",
};
const blobId = (bytes) => createHash("sha1").update("blob " + bytes.length + "\0").update(bytes).digest("hex");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function fetched(path, want, file) {
  if (existsSync(file)) {
    const bytes = await readFile(file);
    if (blobId(bytes) === want) return { bytes, kept: true };
  }
  const response = await fetch(raw + path);
  if (!response.ok) throw new Error(path + ": " + response.status + " " + response.statusText);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (blobId(bytes) !== want) throw new Error(path + " does not match git blob " + want + " at the pinned commit.");
  return { bytes, kept: false };
}

const manifest = {
  library: "Microsoft Rocketbox Avatar Library",
  repository: "https://github.com/microsoft/Microsoft-Rocketbox",
  commit: revision,
  licence: { name: "MIT", copyright: "Copyright (c) 2020 Microsoft", url: page + "LICENSE.md", gitBlob: licenceBlob, copy: local + "LICENSE-rocketbox.txt" },
  sources: [],
  targets: [],
};
const licence = await fetched("LICENSE.md", licenceBlob, local + "LICENSE.md");
await mkdir(local, { recursive: true });
await writeFile(local + "LICENSE.md", licence.bytes);
if (!existsSync(local + "LICENSE-rocketbox.txt"))
  await writeFile(local + "LICENSE-rocketbox.txt", "Microsoft Rocketbox Avatar Library\nhttps://github.com/microsoft/Microsoft-Rocketbox\nLICENSE.md at commit " + revision + " (git blob " + licenceBlob + ")\n\n" + licence.bytes.toString("utf8").replace(/^\s+/, ""));
for (const [path, want] of Object.entries(blobs)) {
  const file = local + "source/" + path.split("/")[3] + "/" + path.split("/").pop();
  const { bytes, kept } = await fetched(path, want, file);
  if (!kept) { await mkdir(dirname(file), { recursive: true }); await writeFile(file, bytes); }
  manifest.sources.push({ url: page + path, file, bytes: bytes.length, gitBlob: want, sha256: sha256(bytes) });
  console.log((kept ? "kept    " : "fetched ") + file);
}
for (const target of targets) {
  const file = local + "targets/" + target.name + ".glb";
  manifest.targets.push({
    file, sha256: existsSync(file) ? sha256(await readFile(file)) : null,
    from: local + "source/" + target.model + "/" + target.model + ".fbx",
    changes: "Skeleton and skin weights removed in the bind pose, units converted to metres with Y up, colour textures only, head texture 2048 px and others 1024 px as WebP. Made by scripts/rocketbox-study/convert-fbx.py.",
  });
}
await writeFile(local + "manifest.json", JSON.stringify(manifest, null, 1) + "\n");
console.log("Wrote " + local + "manifest.json\nNext, with Blender 4.2 or newer and Python with Pillow:");
for (const target of targets)
  console.log('  blender --background --factory-startup --python scripts/rocketbox-study/convert-fbx.py -- ' + local + "source/" + target.model + "/" + target.model + ".fbx " + local + "targets/" + target.name + '.glb "Microsoft Rocketbox Avatar Library, Copyright (c) 2020 Microsoft, MIT License. Modified."');
console.log("  python scripts/rocketbox-study/unpack-textures.py\n  node scripts/rocketbox-study/fetch.mjs   (again, to record the converted targets in the manifest)");
