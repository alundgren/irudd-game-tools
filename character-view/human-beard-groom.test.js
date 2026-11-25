import test from "node:test";
import assert from "node:assert/strict";
import * as T from "three";
import { humanRegions } from "./human-mesh.js";
import { costumeStudies } from "../examples/costume-studies.js";
import { BEARD_TILES, beardGroomStyles, beardStrandMap, beardStrandPixels } from "./human-beard-groom.js";

function buildHead(form, plain = false) {
  const build = humanRegions(form, (color) => new T.MeshStandardMaterial({ color }), plain);
  return build(form.parts.find((part) => part.humanBone === "head"));
}

test("beard atlas has six feathered tufts and a continuous patch of beard", () => {
  const { width, height, data } = beardStrandPixels();
  assert.equal(width, 256);
  assert.equal(height, 256);
  assert.equal(data.length, 256 * 256 * 4);
  const allTiles = [...BEARD_TILES.lock, ...BEARD_TILES.border];
  assert.equal(allTiles.length, 6);
  for (const [tx, ty, tw, th] of allTiles) {
    let opaque = 0, transparent = 0;
    for (let y = 0; y < th; y++) {
      for (let x = 0; x < tw; x++) {
        const a = data[((ty + y) * width + tx + x) * 4 + 3];
        if (x < 2 || x >= tw - 2 || y < 2 || y >= th - 2) assert.equal(a, 0, "tile gutter stays transparent");
        if (a > .32 * 255) opaque++;
        if (a < 20) transparent++;
      }
    }
    // Every tile has both real hair coverage AND feathered transparent gaps (zero opaque square stickers).
    assert.ok(opaque > tw * th * 0.12, `tile (${tx},${ty}) has hair coverage`);
    assert.ok(transparent > tw * th * 0.14, `tile (${tx},${ty}) has feathered transparent border/gaps`);
  }
  const [bx,by,bw,bh] = BEARD_TILES.bed;
  let light=0, dark=0;
  for(let y=by+4;y<by+bh-4;y++) for(let x=bx+4;x<bx+bw-4;x++){
    const i=4*(y*width+x);
    assert.equal(data[i+3],255);
    if(data[i]>180) light++;
    if(data[i]<130) dark++;
  }
  assert.ok(light>500 && dark>500,"light and dark fibres across the continuous patch");
  const tex = beardStrandMap();
  assert.equal(tex.colorSpace, T.SRGBColorSpace);
});

test("salt-road warden grey beard has real tonal variation, responds to editable colour, and keeps the red lips clear", () => {
  const warden = costumeStudies.find((c) => c.id === "salt-road-warden").make();
  const group = buildHead(warden, false);
  const beard = group.children.find((m) => m.name === "facial-hair");
  const teeth = group.children.find((m) => m.name === "teeth");
  assert.equal(beard.userData.originalBeardGroom, "Short beard");
  assert.equal(beard.material.userData.fibreLOD, true);
  assert.equal(beard.material.userData.portrait, true);

  // Measure grey tonal spread across vertices (salt-and-pepper variation, not flat [1,1,1])
  const col = beard.geometry.attributes.color;
  let minL = 1, maxL = 0, sumL = 0;
  for (let i = 0; i < col.count; i++) {
    const l = 0.2126 * col.getX(i) + 0.7152 * col.getY(i) + 0.0722 * col.getZ(i);
    if (l < minL) minL = l;
    if (l > maxL) maxL = l;
    sumL += l;
  }
  const meanL = sumL / col.count;
  assert.ok(maxL - minL > 0.18, `grey beard tonal spread ${(maxL - minL).toFixed(3)} exceeds flat paste`);
  assert.ok(meanL > 0.25 && meanL < 0.60, `grey beard mean linear luma ${meanL.toFixed(3)} stays faithful to #bcb2a3`);

  // Editable hairColor changes vertex colours cleanly
  const darkWarden = { ...warden, humanStyle: { ...warden.humanStyle, hairColor: "#241c18" } };
  const darkBeard = buildHead(darkWarden, false).children.find((m) => m.name === "facial-hair");
  let darkSum = 0;
  for (let i = 0; i < darkBeard.geometry.attributes.color.count; i++) {
    const c = darkBeard.geometry.attributes.color;
    darkSum += 0.2126 * c.getX(i) + 0.7152 * c.getY(i) + 0.0722 * c.getZ(i);
  }
  assert.ok(darkSum / darkBeard.geometry.attributes.color.count < meanL * 0.25, "editable hairColor darkens beard");

  // Central red-lip clearance holds cleanly (no moustache fangs covering the mouth)
  const tb = new T.Box3().setFromBufferAttribute(teeth.geometry.attributes.position);
  const mouthMidY = 0.5 * (tb.min.y + tb.max.y);
  const bp = beard.geometry.attributes.position;
  let blockedMouthVerts = 0;
  for (let i = 0; i < bp.count; i++) {
    if (Math.abs(bp.getX(i)) < 0.012 && bp.getZ(i) > 0.085 && Math.abs(bp.getY(i) - mouthMidY) < 0.006) {
      blockedMouthVerts++;
    }
  }
  assert.equal(blockedMouthVerts, 0, "central lips remain clear of overhanging moustache locks");
});

test("Short beard and Full beard styles stay distinct in silhouette, volume, and clay mode", () => {
  const warden = costumeStudies.find((c) => c.id === "salt-road-warden").make();
  assert.deepEqual(beardGroomStyles, ["Clipped beard", "Short beard", "Full beard"]);
  const clippedMesh = buildHead({ ...warden, humanStyle: { ...warden.humanStyle, facialHair: "Clipped beard" } })
    .children.find((mesh) => mesh.name === "facial-hair");
  assert.equal(clippedMesh.userData.originalBeardGroom, "Clipped beard");
  for (const target of clippedMesh.geometry.morphAttributes.position) {
    assert.equal(target.count, clippedMesh.geometry.attributes.position.count);
  }
  const shortMesh = buildHead(warden, false).children.find((m) => m.name === "facial-hair");
  const fullMesh = buildHead({ ...warden, humanStyle: { ...warden.humanStyle, facialHair: "Full beard" } }, false)
    .children.find((m) => m.name === "facial-hair");
  const shortBox = new T.Box3().setFromBufferAttribute(shortMesh.geometry.attributes.position);
  const fullBox = new T.Box3().setFromBufferAttribute(fullMesh.geometry.attributes.position);
  const clippedBox = new T.Box3().setFromBufferAttribute(clippedMesh.geometry.attributes.position);
  assert.ok(clippedBox.min.y > shortBox.min.y, "the clipped jaw has less hanging hair");
  assert.ok(fullBox.min.y < shortBox.min.y - 0.025, "Full beard hangs well below Short beard");
  assert.ok(fullBox.max.z > shortBox.max.z + 0.001, "Full beard stands further forward than Short beard");
  // Clay mode preserves sculpted mass without texture cutout
  const clayMesh = buildHead(warden, true).children.find((m) => m.name === "facial-hair");
  assert.equal(clayMesh.userData.originalBeardGroom, undefined);
  assert.equal(clayMesh.material.map, null);
});
