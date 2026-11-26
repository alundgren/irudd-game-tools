import { test } from "node:test";
import assert from "node:assert/strict";
import { UsageError } from "../src/commands.js";
import { parseShot } from "../src/review.js";

test("a shot spec becomes a review shot", () => {
  assert.deepEqual(parseShot("view=front"), { view: "front" });
  assert.deepEqual(
    parseShot("view=portrait-angle,yaw=-30,pitch=10,gaze=0.5:-0.25,morph=Smile,light=studio"),
    {
      view: "portrait-angle",
      morph: "Smile",
      angle: { yaw: -30, pitch: 10 },
      gaze: { x: 0.5, y: -0.25 },
      light: "studio",
    },
  );
  assert.deepEqual(parseShot("view=side,clip=Walk,time=0.5,surface=ink"), {
    view: "side",
    clip: "Walk",
    time: 0.5,
    surface: "ink",
  });
});

test("a bad shot spec is a usage error that names the problem", () => {
  assert.throws(
    () => parseShot("clip=Walk"),
    (e) => e instanceof UsageError && /view=/.test(e.message),
  );
  assert.throws(
    () => parseShot("view=front,zoom=2"),
    (e) => e instanceof UsageError && /zoom/.test(e.message),
  );
  assert.throws(
    () => parseShot("view=front,time=soon"),
    (e) => e instanceof UsageError && /time/.test(e.message),
  );
  assert.throws(
    () => parseShot("view=front,gaze=1"),
    (e) => e instanceof UsageError && /gaze/.test(e.message),
  );
  assert.throws(() => parseShot("view=front,flat"), UsageError);
});
