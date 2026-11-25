import assert from "node:assert/strict";
import test from "node:test";
import { compareDepthMaps, compareViewContours } from "./reference-depth.js";

test("camera contours measure a slope independently of distance and omit holes and coarse views", () => {
  const width=40, height=34, pixel=0.0005;
  function plane(slope, offset) {
    const bytes = new Uint8Array(width*height*4);
    for (let i=0; i<width*height; i++) {
      const z = 0.25 + slope*(i%width)*pixel + offset;
      const encoded = Math.round(z*16777216);
      bytes.set([encoded>>>16, (encoded>>>8)&255, encoded&255, 0], 4*i);
    }
    return bytes;
  }
  const maps = [plane(0,0), plane(0,.015), plane(1,.003)];
  const [offset, tilted] = compareViewContours(maps,width,height,1,pixel,pixel);
  assert.equal(offset.normalMeanDeg,0);
  assert.equal(offset.reliefErrorP95Mm,0);
  assert.ok(Math.abs(tilted.normalMeanDeg-45)<.01);
  assert.ok(tilted.reliefErrorP95Mm < .001);
  const centre = 4*(width*16+15);
  maps[2].fill(255,centre,centre+4);
  const withHole = compareViewContours(maps,width,height,1,pixel,pixel);
  assert.ok(withHole[0].pixels < offset.pixels);
  assert.equal(withHole[0].pixels,withHole[1].pixels);
  assert.equal(compareViewContours(maps,width,height,1,.005,.005),null);
});

test("local relief registers fine shape even if mean depth is correct", () => {
  const width=32, height=24;
  const flat = new Uint8Array(width*height*4);
  const corrugated = flat.slice();
  for (let i=0; i<width*height; i++) {
    flat[4*i]=100;
    corrugated[4*i] = 100 + Math.round(2*Math.sin(i%width*Math.PI/4));
  }
  const [result] = compareViewContours([flat,corrugated],width,height,.2,.0005,.0005);
  assert.ok(result.reliefErrorP95Mm > .5);
  assert.ok(result.normalMeanDeg > 10);
});

test("camera depth uses shared foreground and measures millimetres at the current clip range", () => {
  const empty = [255,255,255,255];
  const target = Uint8Array.from([64,0,0,0, ...empty, 64,0,0,0, ...empty]);
  const result = Uint8Array.from([65,0,0,0, 64,0,0,0, ...empty, ...empty]);
  const reading = compareDepthMaps(target,result,2.56);
  assert.equal(reading.overlap, 1/3);
  assert.equal(reading.sharedPixels, 1);
  assert.equal(reading.meanMm, 10);
  assert.equal(reading.p95Mm, 10);
  assert.equal(compareDepthMaps(target,target,2.56).meanMm, 0);
  const none = Uint8Array.from(empty);
  assert.equal(compareDepthMaps(none,none,2.56).overlap,null);
});
