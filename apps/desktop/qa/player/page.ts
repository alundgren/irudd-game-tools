// The hidden player check. Runs in a never-shown Electron window on the
// hardware GPU, against tracked example GLBs, through the same Player,
// controls and Inspector the web player and the desktop library ship.
//
// It checks that inspection and the motion check never write to the live
// stage (setter counters stay at zero and the live pose is unchanged, also
// when a sheet fails), that portraits frame the face surface at the legacy
// directions and measured angles, and that the look is held over clips and
// handed back to them.

import * as T from "three";
import {
  Inspector,
  Player,
  Stage,
  gazeNames,
  mountControls,
  type InspectionSheet,
} from "@irudd/player";

const portraitFile = "portrait-gaze.glb";
const faceless = "fen-crown.glb";

let failed = false;

function report(line: string): void {
  console.log(`QA ${line}`);
}

async function check(name: string, run: () => Promise<string | undefined>): Promise<void> {
  const started = performance.now();
  try {
    const detail = await run();
    report(
      `ok   ${name} (${Math.round(performance.now() - started)} ms)${detail ? ` · ${detail}` : ""}`,
    );
  } catch (error) {
    failed = true;
    report(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function near(a: number, b: number, tolerance: number, what: string): void {
  expect(Math.abs(a - b) <= tolerance, `${what}: ${a} is not within ${tolerance} of ${b}`);
}

async function example(name: string): Promise<Uint8Array> {
  const response = await fetch(`examples/${name}`);
  if (!response.ok) throw new Error(`${name} is unavailable (${response.status}).`);
  return new Uint8Array(await response.arrayBuffer());
}

function byId(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} is missing.`);
  return node;
}

const isMesh = (node: T.Object3D): node is T.Mesh => Reflect.get(node, "isMesh") === true;
const isSkinned = (node: T.Object3D): node is T.SkinnedMesh =>
  Reflect.get(node, "isSkinnedMesh") === true;

/** Every morph weight in the stage's scene, keyed by mesh and target name. */
function weights(stage: Stage): Map<string, number> {
  const found = new Map<string, number>();
  stage.scene.traverse((node) => {
    if (!isMesh(node)) return;
    const influences = node.morphTargetInfluences ?? [];
    for (const [key, id] of Object.entries(node.morphTargetDictionary ?? {}))
      found.set(`${node.uuid}/${key}`, influences[id] ?? 0);
  });
  return found;
}

function gazeWeights(stage: Stage): Record<string, number[]> {
  const found: Record<string, number[]> = {};
  for (const [key, value] of weights(stage)) {
    const name = key.slice(key.indexOf("/") + 1);
    if (gazeNames.some((g) => g === name)) (found[name] ??= []).push(value);
  }
  return found;
}

/** Everything a write to the live stage could change: clip, time, look, materials, weights, bones. */
function liveSnapshot(stage: Stage): string {
  const parts: string[] = [
    String(stage.clip),
    stage.time.toFixed(9),
    JSON.stringify(stage.gaze),
    String(stage.morph),
  ];
  stage.scene.traverse((node) => {
    if (!isMesh(node)) return;
    const material: T.Material | T.Material[] = node.material;
    parts.push(
      node.uuid,
      (Array.isArray(material) ? material : [material]).map((m) => m.uuid).join(","),
      JSON.stringify(node.morphTargetInfluences ?? []),
    );
    if (isSkinned(node))
      for (const bone of node.skeleton.bones)
        parts.push(bone.position.toArray().join(","), bone.quaternion.toArray().join(","));
  });
  return parts.join("|");
}

const watched = [
  "load",
  "clear",
  "showScene",
  "setSurface",
  "setClip",
  "setTime",
  "advance",
  "setMorph",
  "setGaze",
  "frame",
  "measureClips",
] as const;

/** Count calls of every stage method that writes state, without changing what they do. */
function spy(stage: Stage): { counts: Map<string, number>; restore: () => void } {
  const counts = new Map<string, number>();
  const originals: [string, unknown][] = [];
  for (const name of watched) {
    const original: unknown = Reflect.get(stage, name);
    if (typeof original !== "function") throw new Error(`Stage.${name} is not a method.`);
    counts.set(name, 0);
    originals.push([name, Object.getOwnPropertyDescriptor(stage, name)?.value]);
    Reflect.set(stage, name, (...args: unknown[]): unknown => {
      counts.set(name, (counts.get(name) ?? 0) + 1);
      const value: unknown = Reflect.apply(original, stage, args);
      return value;
    });
  }
  return {
    counts,
    restore: () => {
      for (const [name, own] of originals)
        if (own === undefined) Reflect.deleteProperty(stage, name);
        else Reflect.set(stage, name, own);
    },
  };
}

function untouched(counts: Map<string, number>): void {
  const touched = [...counts].filter(([, n]) => n > 0);
  expect(
    !touched.length,
    `the live stage was written: ${touched.map(([k, n]) => `${k}×${n}`).join(", ")}`,
  );
}

function select(id: string, value: string): void {
  const node = byId("panel").querySelector(`select[name="${id}"]`);
  if (!(node instanceof HTMLSelectElement)) throw new Error(`No ${id} control.`);
  node.value = value;
  node.dispatchEvent(new Event("change"));
}

async function pngPixels(png: Uint8Array): Promise<Uint8ClampedArray> {
  const bitmap = await createImageBitmap(new Blob([png.slice()], { type: "image/png" }));
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No 2D context.");
  context.drawImage(bitmap, 0, 0);
  return context.getImageData(0, 0, bitmap.width, bitmap.height).data;
}

async function changedPixels(a: Uint8Array, b: Uint8Array): Promise<number> {
  const [x, y] = await Promise.all([pngPixels(a), pngPixels(b)]);
  let changed = 0;
  for (let i = 0; i < x.length; i += 4)
    if (
      Math.abs((x[i] ?? 0) - (y[i] ?? 0)) +
        Math.abs((x[i + 1] ?? 0) - (y[i + 1] ?? 0)) +
        Math.abs((x[i + 2] ?? 0) - (y[i + 2] ?? 0)) >
      6
    )
      changed++;
  return changed;
}

async function run(): Promise<void> {
  const portrait = await example(portraitFile);
  const noFace = await example(faceless);
  const player = new Player(byId("player"));
  let lastSheet: InspectionSheet | undefined;
  const controls = mountControls(byId("panel"), player, { onSheet: (s) => (lastSheet = s) });

  await check("hardware GPU", async () => {
    expect(!player.gpu.software, `software rendering: ${player.gpu.renderer}`);
    return player.gpu.renderer;
  });

  await check("portrait file offers face views, look and expressions", async () => {
    const info = await controls.load(portrait, portraitFile);
    expect(info !== undefined, "the file did not load");
    expect(info?.face !== null, "no face surface found");
    expect(info?.gaze === true, "no look morphs found");
    expect(
      !(info?.expressions ?? []).some((e) => gazeNames.some((g) => g === e)),
      "a look morph is offered as an expression",
    );
    const disabled = [...byId("panel").querySelectorAll("option")]
      .filter((o) => o.value.startsWith("portrait"))
      .some((o) => o.disabled);
    expect(!disabled, "portrait views are disabled for a file with a face");
    return `face ${info?.face?.min.map((n) => n.toFixed(3)).join(",")} → ${info?.face?.max.map((n) => n.toFixed(3)).join(",")}`;
  });

  await check(
    "inspection sheet leaves a paused mid-clip, clay, looking live stage alone",
    async () => {
      select("clip", "Walk");
      player.setTime(0.43);
      select("surface", "clay");
      player.setGaze(0.4, -0.2);
      await new Promise(requestAnimationFrame);
      const before = liveSnapshot(player.stage);
      const watch = spy(player.stage);
      try {
        const sheet = await controls.inspect(256, 256);
        expect(sheet !== undefined && sheet === lastSheet, "no sheet was taken");
        untouched(watch.counts);
        expect(liveSnapshot(player.stage) === before, "the live pose changed");
        const shots = sheet?.shots ?? [];
        expect(shots.length === 9, `expected 9 shots with portraits, got ${shots.length}`);
        for (const shot of shots) {
          expect(
            shot.clip === "Walk" && shot.surface === "clay",
            `${shot.view} lost the live state`,
          );
          near(shot.time, 0.43, 1e-6, `${shot.view} time`);
          near(shot.gaze.x, 0.4, 1e-9, `${shot.view} look across`);
        }
        // The counters do see a write to the live stage.
        player.setTime(0.43);
        expect(watch.counts.get("setTime") === 1, "the setter counter missed a live write");
        return `${shots.length} shots · ${shots.map((s) => s.view).join(", ")}`;
      } finally {
        watch.restore();
      }
    },
  );

  await check("motion check leaves the live stage alone", async () => {
    const before = liveSnapshot(player.stage);
    const watch = spy(player.stage);
    try {
      const button = [...byId("panel").querySelectorAll("button")].find(
        (b) => b.textContent === "Check motion",
      );
      expect(button !== undefined, "no motion check button");
      button?.click();
      const reportNode = byId("panel").querySelector(".pl-report");
      for (let i = 0; i < 200 && !reportNode?.textContent; i++)
        await new Promise((r) => setTimeout(r, 25));
      expect(Boolean(reportNode?.textContent?.includes("Walk")), "no motion report");
      untouched(watch.counts);
      expect(liveSnapshot(player.stage) === before, "the live pose changed");
      return reportNode?.textContent?.split("\n")[0];
    } finally {
      watch.restore();
    }
  });

  await check("a failing sheet leaves the live stage alone", async () => {
    const before = liveSnapshot(player.stage);
    const watch = spy(player.stage);
    const inspector = new Inspector(64, 64);
    try {
      let message = "";
      try {
        await inspector.sheet(portrait, portraitFile, {
          shots: [
            { view: "front", clip: "Walk", time: 0.43 },
            { view: "front", clip: "Nope" },
          ],
        });
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message.includes("Nope"), `the sheet did not fail as expected (${message})`);
      untouched(watch.counts);
      expect(liveSnapshot(player.stage) === before, "the live pose changed");
      return message;
    } finally {
      inspector.dispose();
      watch.restore();
    }
  });

  await check("portraits frame the face at the legacy directions and measured angles", async () => {
    const inspector = new Inspector(128, 128);
    try {
      await inspector.load(portrait, portraitFile);
      const stage = new Stage();
      const info = await stage.load(portrait, portraitFile);
      const face = new T.Box3(
        new T.Vector3().fromArray(info.face?.min ?? []),
        new T.Vector3().fromArray(info.face?.max ?? []),
      );
      const centre = face.getCenter(new T.Vector3());
      const size = face.getSize(new T.Vector3());
      const distance = Math.max(size.x, size.y, size.z) * 2.55;
      const camera = new T.PerspectiveCamera(34, 1, 0.01, 250);
      const target = new T.Vector3();
      const cases: [Parameters<Stage["frame"]>[1], { yaw: number; pitch: number }, number[]][] = [
        ["portrait", { yaw: 0, pitch: 0 }, [0, 0, 1]],
        ["portrait-side", { yaw: 0, pitch: 0 }, [-1, 0, 0]],
        [
          "portrait-oblique",
          { yaw: 0, pitch: 0 },
          new T.Vector3(-0.74, 0, 1).normalize().toArray(),
        ],
        ["portrait-angle", { yaw: 90, pitch: 0 }, [1, 0, 0]],
        [
          "portrait-angle",
          { yaw: -30, pitch: 30 },
          [-0.5 * Math.cos(Math.PI / 6), 0.5, Math.cos(Math.PI / 6) ** 2],
        ],
        [
          "portrait-angle",
          { yaw: 400, pitch: -200 },
          new T.Vector3().setFromSphericalCoords(1, T.MathUtils.degToRad(170), Math.PI).toArray(),
        ],
      ];
      for (const [view, angle, direction] of cases) {
        const used = stage.frame(camera, view, target, angle);
        expect(used === view, `${view} fell back to ${used}`);
        near(target.distanceTo(centre), 0, 1e-9, `${view} target`);
        const offset = camera.position.clone().sub(centre);
        near(offset.length(), distance, 1e-6, `${view} distance`);
        const aim = offset.normalize();
        near(
          aim.distanceTo(new T.Vector3().fromArray(direction)),
          0,
          1e-6,
          `${view} ${angle.yaw}/${angle.pitch} direction`,
        );
      }
      const shot = await inspector.shoot({
        view: "portrait-angle",
        angle: { yaw: 400, pitch: -200 },
      });
      expect(
        shot.angle?.yaw === 180 && shot.angle.pitch === -80,
        "the measured angle was not clamped",
      );
      stage.dispose();
      return `face centre ${centre
        .toArray()
        .map((n) => n.toFixed(3))
        .join(",")} at ${distance.toFixed(3)} m`;
    } finally {
      inspector.dispose();
    }
  });

  await check("the look is held over clip samples and handed back at centre", async () => {
    const stage = new Stage();
    const reference = new Stage();
    try {
      await stage.load(portrait, portraitFile);
      await reference.load(portrait, portraitFile);
      stage.setClip("Idle");
      stage.setGaze(0.6, -0.3);
      const expected: Record<string, number> = {
        LookLeft: 0.6,
        LookRight: 0,
        LookUp: 0,
        LookDown: 0.3,
      };
      const held = (what: string): void => {
        const found = gazeWeights(stage);
        expect(Object.keys(found).length === 4, `${what}: look morphs missing`);
        for (const [name, values] of Object.entries(found))
          for (const v of values) near(v, expected[name] ?? -1, 1e-6, `${what} ${name}`);
      };
      held("after setGaze");
      stage.advance(0.37);
      held("after advance");
      stage.setTime(0.5);
      held("after setTime");
      stage.setClip("Walk");
      held("after setClip");
      stage.setMorph("LookLeft");
      expect(stage.morph === null, "a look morph was accepted as an expression");
      const withLook = stage.measureClips();
      const plain = reference.measureClips();
      expect(
        JSON.stringify(withLook) === JSON.stringify(plain),
        "the motion check sampled the held look",
      );
      held("after the motion check");
      stage.setTime(0.25);
      stage.setGaze(0, 0);
      reference.setClip("Walk");
      reference.setTime(0.25);
      const mine = weights(stage);
      const theirs = weights(reference);
      const ids = (m: Map<string, number>): string[] =>
        [...m].map(([k, v]) => `${k.slice(k.indexOf("/"))}=${v.toFixed(6)}`).sort();
      expect(
        JSON.stringify(ids(mine)) === JSON.stringify(ids(theirs)),
        "released weights differ from the clip's own",
      );
      return `${Object.values(gazeWeights(stage)).flat().length} look weights per sample`;
    } finally {
      stage.dispose();
      reference.dispose();
    }
  });

  await check("the look and the measured angle change the portrait image", async () => {
    const inspector = new Inspector(256, 256);
    try {
      await inspector.load(portrait, portraitFile);
      const ahead = await inspector.shoot({ view: "portrait" });
      const left = await inspector.shoot({ view: "portrait", gaze: { x: 1, y: 0 } });
      const back = await inspector.shoot({ view: "portrait" });
      const turned = await inspector.shoot({
        view: "portrait-angle",
        angle: { yaw: 45, pitch: 15 },
      });
      const look = await changedPixels(ahead.png, left.png);
      const again = await changedPixels(ahead.png, back.png);
      const turn = await changedPixels(ahead.png, turned.png);
      expect(look > 20, `looking left changed only ${look} pixels`);
      expect(again === 0, `centring the look again left ${again} pixels changed`);
      expect(turn > 2000, `turning the camera changed only ${turn} pixels`);
      return `look ${look} px · recentred ${again} px · turned ${turn} px of 65536`;
    } finally {
      inspector.dispose();
    }
  });

  await check("a file without a face surface falls back to the body view", async () => {
    const info = await controls.load(noFace, faceless);
    expect(info?.face === null, "unexpected face surface");
    const portraits = [...byId("panel").querySelectorAll("option")].filter((o) =>
      o.value.startsWith("portrait"),
    );
    expect(
      portraits.length === 4 && portraits.every((o) => o.disabled),
      "portrait views stay enabled",
    );
    const stage = new Stage();
    try {
      await stage.load(noFace, faceless);
      const used = stage.frame(new T.PerspectiveCamera(), "portrait-oblique");
      expect(used === "threequarter", `framed ${used}`);
    } finally {
      stage.dispose();
    }
    const sheet = await controls.inspect(64, 64);
    expect(sheet?.shots.length === 5, `expected 5 body shots, got ${sheet?.shots.length}`);
    return undefined;
  });

  player.dispose();
}

run().then(
  () => console.log(failed ? "QA-DONE fail" : "QA-DONE pass"),
  (error: unknown) => {
    report(`FAIL ${error instanceof Error ? error.message : String(error)}`);
    console.log("QA-DONE fail");
  },
);
