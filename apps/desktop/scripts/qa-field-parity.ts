import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { callEditor, type Running } from "./editor-session.js";
import { contactSheet } from "./contact-sheet.js";
import type {} from "../qa/shape/probe.js";

export interface Suite {
  web: Page;
  desk: Page;
  editor: Running;
  stud: Locator;
  root: string;
  work: string;
  dir: string;
  adultFile: string;
  fresh: (adult: boolean, dressed?: boolean) => Promise<void>;
  part: (label: string, focus?: boolean) => Promise<void>;
  nativeId: (label: string) => Promise<string>;
  frame: (page: Page) => Promise<void>;
  save: () => Promise<void>;
  revision: () => Promise<number>;
  ready: (revision: number) => Promise<void>;
  checkHistory: (action: () => Promise<void>) => Promise<void>;
  geom: (page: Page, name: string) => Promise<number[]>;
  digest: () => Promise<string>;
  highlightDetail: (id: string) => Promise<{ name: string; image: string }>;
  writePair: (id: string, title: string, before: Buffer[], after: Buffer[]) => Promise<void>;
}
export async function openDetails(control: Locator) {
  await control.waitFor({ state: "attached" });
  const details = control.locator("xpath=ancestor::details");
  for (const el of await details.all())
    if (!(await el.evaluate((n) => n.hasAttribute("open"))))
      await el.locator(":scope > summary").click();
}
async function seeds(p: Page, values: number[]) {
  await p.evaluate((values) => {
    const get = crypto.getRandomValues.bind(crypto);
    crypto.getRandomValues = <A extends ArrayBufferView<ArrayBuffer>>(a: A): A => {
      if (a instanceof Uint32Array && a.length === 1 && values.length) {
        a[0] = values.shift() ?? 0;
        if (!values.length) crypto.getRandomValues = get;
        return a;
      }
      return get(a);
    };
  }, values);
}
export async function fieldParity(s: Suite) {
  const { web, desk, stud, editor } = s,
    arm = "right forearm",
    head = "head and neck";
  const input = (name: string) => stud.getByLabel(name, { exact: true }),
    button = (name: string) => stud.getByRole("button", { name, exact: true });
  const growth = (key: string, sign?: number) =>
    web.locator("[data-growth=" + key + "]" + (sign ? "[data-sign='" + sign + "']" : ""));
  const check = (name: string) => s.checkHistory(() => button(name).click());
  let subject = arm,
    desktopSubject = arm,
    span = 0.35,
    yaw = 0.17;
  async function compare(
    id: string,
    title: string,
    run: () => Promise<void>,
    center?: [number, number, number],
  ) {
    console.log(id, title);
    const centers = center
      ? [center, center]
      : await Promise.all([
          web.evaluate((k) => window.shapeProbe.centre(k), subject),
          desk.evaluate((k) => window.shapeProbe.centre(k), await s.nativeId(desktopSubject)),
        ]);
    const shot = async () =>
      Promise.all(
        [web, desk].map(async (p, i) => {
          await s.frame(p);
          const at = centers[i];
          assert.ok(at);
          return Buffer.from(
            await p.evaluate(([c, h, a]) => window.shapeProbe.capture(c, h, a), [
              at,
              span,
              yaw,
            ] as const),
            "base64",
          );
        }),
      );
    const before = await shot();
    await run();
    const after = await shot();
    for (const i of [0, 1])
      assert.notDeepEqual(before[i], after[i], id + " must visibly change both workshops");
    await s.writePair(id, title, before, after);
  }
  async function select(label: string) {
    await s.part(label, false);
    subject = desktopSubject = label;
  }
  async function outfit(name: string) {
    await web.click('[data-tab="sculpt"]');
    const chosen = web.locator("#outfits").getByRole("button", { name, exact: true });
    await chosen.click();
    const base = desk.getByLabel("Base outfit", { exact: true });
    await openDetails(base);
    await s.checkHistory(async () => {
      await base.selectOption(name);
    });
  }
  async function fieldAction(key: string, name: string, random?: number) {
    if (random !== undefined) await Promise.all([web, desk].map((p) => seeds(p, [random])));
    await growth(key).click();
    await check(name);
  }
  async function plates() {
    if (process.argv[4] !== "repeat") {
      await s.fresh(false);
      await select(arm);
      await openDetails(input("Field rows"));
      await openDetails(growth("create"));
      await web.fill("#growth-rows", "3");
      await input("Field rows").fill("3");
      await web.selectOption("#growth-face", "Front");
      await input("Field face").selectOption("Front");
      await web.selectOption("#growth-direction", "last");
      await input("Tips point toward").selectOption("last");
      await web.fill("#growth-color", "#d07a38");
      await input("Field colour").fill("#d07a38");
      await compare("F1", "Grow fitted horn plates on the forearm", async () => {
        await Promise.all([web, desk].map((p) => seeds(p, [101, 201])));
        await growth("create").click();
        await check("Grow plate field");
      });
      await compare("F2", "Raise the crest and relief, widen and overlap the rows", async () => {
        for (const [key, n] of [
          ["crest", 3],
          ["rise", 6],
          ["overlap", 3],
          ["wrap", 1],
          ["rows", 1],
          ["columns", 1],
        ] as const)
          for (let i = 0; i < n; i++) {
            await growth(key, 1).click();
            await s.frame(web);
          }
        for (const [label, v] of [
          ["Crest height", "0.95"],
          ["Plate relief", "2.5"],
          ["Plate overlap", "0.7"],
          ["Wrap (degrees)", "160"],
          ["Field rows", "4"],
        ]) {
          assert.ok(label && v);
          await input(label).fill(v);
        }
        await input("Field columns").selectOption("5");
        await check("Update plate field");
      });
      await compare("F3", "Reroll the layout and free tips of the field", async () => {
        await s.part(arm, true);
        await input("Shape mode").selectOption("Spine");
        await web.click('[data-op="spine"]');
        const direct = web.locator("#direct");
        await openDetails(direct);
        if ((await direct.getAttribute("aria-pressed")) !== "true") await direct.click();
        await openDetails(web.locator("#knot"));
        await web.selectOption("#knot", "1");
        for (const page of [web, desk]) {
          const id = page === web ? arm : await s.nativeId(arm);
          const move = await page.evaluate(
            (id) => window.shapeProbe.corner(id, [0, -0.218126, 0], 0.075, 0.035),
            id,
          );
          const box = await page
            .getByRole("button", { name: "Spine point 2", exact: true })
            .boundingBox();
          assert.ok(box);
          const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
          const gesture = async () => {
            await page.mouse.move(at.x, at.y);
            await page.mouse.down();
            await page.mouse.move(
              at.x + move.end.x - move.start.x,
              at.y + move.end.y - move.start.y,
              { steps: 7 },
            );
            await page.mouse.up();
            await s.frame(page);
          };
          if (page === desk) await s.checkHistory(gesture);
          else await gesture();
        }
        await input("Shape mode").selectOption("Select");
        if ((await direct.getAttribute("aria-pressed")) === "true") await direct.click();
        await fieldAction("layout", "Reroll layout", 7281);
        await fieldAction("tips", "Reroll field tips", 389);
      });
      const savedCarrier = join(s.work, "edited-carrier.form.json");
      await web.click('[data-tab="files"]');
      const download = web.waitForEvent("download");
      await web.click("#save");
      await (await download).saveAs(savedCarrier);
      const knots: unknown = JSON.parse(
        execFileSync(
          process.execPath,
          [
            "--input-type=module",
            "-e",
            `import {readFileSync,writeFileSync} from 'node:fs';
        const [file,id]=process.argv.slice(1), data=JSON.parse(readFileSync(file));
        const {knots}=data.form.parts.find(p=>p.id===id);
        knots[4][0]+=0.055;
        knots[4][3]*=1.6;
        writeFileSync(file,JSON.stringify(data));
        process.stdout.write(JSON.stringify(knots));`,
            savedCarrier,
            arm,
          ],
          { encoding: "utf8" },
        ),
      );
      const documentId = await desk.inputValue("#document"),
        rev = await s.revision();
      await callEditor(desk, "apply", {
        request: {
          format: "irudd.command",
          version: 1,
          requestId: "qa-edited-carrier",
          documentId,
          expectedRevision: rev,
          command: {
            type: "edit",
            ops: [
              {
                op: "feature.set",
                part: await s.nativeId(arm),
                feature: "figure.sweep",
                value: { knots },
              },
            ],
          },
        },
      });
      await s.ready(rev + 1);
      await web.locator("#openfile").setInputFiles(savedCarrier);
      await web.waitForFunction(() =>
        document.querySelector("#status")?.textContent?.includes("Form opened"),
      );
      await web.click('[data-tab="sculpt"]');
      await select(arm);
      await openDetails(growth("refit"));
      await compare("F3-refit", "Refit a saved field to its altered carrier", () =>
        fieldAction("refit", "Refit to spine"),
      );
      const tip = arm + " plate 4.1";
      await select(tip);
      span = 0.085;
      assert.equal(await button("Unpin this tip").isDisabled(), true);
      await compare("F4", "Pin a new distal shape on one plate", async () => {
        await fieldAction("one-tip", "Reroll this tip and pin it", 9234);
        const before = await s.geom(desk, tip);
        await fieldAction("tips", "Reroll field tips", 901);
        assert.deepEqual(await s.geom(desk, tip), before);
        await fieldAction("release-tip", "Unpin this tip");
        await fieldAction("one-tip", "Reroll this tip and pin it", 555);
      });
      await select(arm);
      span = 0.35;
      await compare("F5", "Shrink the field and retain the customized outer plate", async () => {
        await growth("rows", -1).click();
        await growth("columns", -1).click();
        await input("Field rows").fill("3");
        await input("Field columns").selectOption("3");
        await check("Update plate field");
        await s.nativeId(tip);
      });
      await s.save();
    }
    for (const [id, title, count, across, equipped] of [
      ["R1", "A single centred row with four scutes", 1, 4, false],
      ["R2", "Fitted scutes project the painted carrier", 5, 2, false],
      ["R3", "Outfit armour with colour and rigid base joins", 3, 3, true],
    ] as const) {
      await s.fresh(false);
      if (id === "R2") await outfit("Base layer");
      await select(id === "R2" ? "right shin" : arm);
      await openDetails(input("Plate rows"));
      await openDetails(web.locator("#repeat"));
      await web.fill("#repeat-count", String(count));
      await input("Plate rows").fill(String(count));
      await web.fill("#repeat-cols", String(across));
      await input("Plate columns").fill(String(across));
      await web.selectOption("#repeat-side", "Front");
      await input("Plate face").selectOption("Front");
      await web.fill("#repeat-width", "11");
      await input("Repeated plate width (cm)").fill("11");
      await web.locator("#repeat-outfit").setChecked(equipped);
      await input("Wear plates only with this outfit").setChecked(equipped);
      if (equipped) {
        await web.fill("#repeat-color", "#48c2a4");
        await input("Armour colour").fill("#48c2a4");
      }
      await compare(id, title, async () => {
        await web.click("#repeat");
        await check("Repeat plates");
      });
      const plate = (equipped ? "armour scale " : "plate ") + "1/1",
        partId = await s.nativeId(plate);
      if (id === "R2") {
        for (const [page, key] of [
          [web, plate],
          [desk, partId],
        ] as const) {
          const uv = await page.evaluate((id) => window.shapeProbe.uvSpan(id), key);
          assert.ok(
            uv.every((v) => Number.isFinite(v) && v > 0),
            "Mounted scutes need a projected UV footprint",
          );
        }
      }
      if (equipped) {
        await outfit("Base layer");
        for (const page of [web, desk]) assert.equal((await s.geom(page, plate)).length, 0);
        await outfit("Work clothes");
        for (const page of [web, desk]) assert.ok((await s.geom(page, plate)).length);
      }
      await s.save();
    }
  }
  async function guards() {
    await s.fresh(false);
    await select(arm);
    const setup = async (rows: number, columns: number) => {
      await openDetails(growth("create"));
      await openDetails(input("Field rows"));
      await web.fill("#growth-rows", String(rows));
      await web.selectOption("#growth-columns", String(columns));
      await input("Field rows").fill(String(rows));
      await input("Field columns").selectOption(String(columns));
    };
    const rejected = async (
      runWeb: () => Promise<void>,
      runDesktop: () => Promise<void>,
      reason: RegExp,
    ) => {
      const before = await s.digest();
      await runWeb();
      await runDesktop();
      assert.match(await web.locator("#status").innerText(), reason);
      await desk.locator("#banner").filter({ hasText: reason }).waitFor();
      assert.equal(await s.digest(), before);
    };
    await setup(12, 7);
    await Promise.all([web, desk].map((p) => seeds(p, [7, 11])));
    await rejected(
      () => growth("create").click(),
      () => button("Grow plate field").click(),
      /128|longer or wider/,
    );
    await setup(3, 3);
    await Promise.all([web, desk].map((p) => seeds(p, [7, 11])));
    await growth("create").click();
    await check("Grow plate field");
    const surface = desk.locator("#surface-editor"),
      partAction = (name: string) =>
        surface.locator("button").filter({ hasText: new RegExp("^" + name + "$") });
    if (!(await surface.evaluate((el) => el.hasAttribute("open"))))
      await surface.locator(":scope > summary").click();
    const gone = arm + " plate 1.2";
    await select(gone);
    await openDetails(web.locator("#remove"));
    await openDetails(partAction("Remove branch"));
    await web.click("#remove");
    await s.checkHistory(() => partAction("Remove branch").click());
    await select(arm);
    await fieldAction("layout", "Reroll layout", 221);
    assert.equal(await web.locator("#target option").filter({ hasText: gone }).count(), 0);
    assert.equal(await desk.locator("#outliner .row").filter({ hasText: gone }).count(), 0);
    const attached = arm + " plate 3.2";
    await select(attached);
    await web.selectOption("#shape", "ellipsoid");
    await web.click("#attach");
    await s.checkHistory(() => partAction("Add part").click());
    await select(arm);
    await input("Field rows").fill("2");
    await rejected(
      () => growth("rows", -1).click(),
      () => button("Update plate field").click(),
      /attach/i,
    );
    await s.save();
  }
  async function donorFile() {
    await s.fresh(true);
    const file = join(s.work, "adult-donor.irudd-character");
    await editor.answerDialogs({ save: file });
    await desk.click("#character-save");
    await desk.waitForFunction(() =>
      document.querySelector("#status")?.textContent?.includes("adult-donor.irudd-character"),
    );
    return file;
  }
  async function grafts() {
    const adult = await donorFile();
    for (const [id, mode, title, root, target] of [
      ["G1", "attach", "Load a saved adult head with its own skin", "head", arm],
      [
        "G2",
        "replace",
        "Replace the conductor's shin and preserve the foot",
        "left forearm",
        "right shin",
      ],
      [
        "G3",
        "replaceBranch",
        "Replace the entire branch at measured height",
        "left upper arm",
        arm,
      ],
      ["G4", "attach", "Attach a donor hand above the head without resizing", "left hand", head],
      ["G5", "wear", "Wear a saved branch with per-axis clearance", "left forearm", arm],
      ["G6", "pattern", "Recut the donor cape on the receiving body", "cape", "body"],
    ] as const) {
      if (process.argv[4] && !process.argv[4].split(",").includes(id)) continue;
      await s.fresh(false);
      if (id === "G2") await outfit("Base layer");
      await select(target);
      if (id === "G6") {
        await web.click('[data-tab="sculpt"]');
        await openDetails(web.locator("#garment-cut"));
        await web.selectOption("#garment-cut", "Cape");
        await web.click("#cut-garment");
        assert.match(await web.locator("#status").innerText(), /Cut cape/i);
        const cut = desk.locator("#cutting button");
        await openDetails(cut);
        await s.checkHistory(() => cut.click());
        await web.click('[data-tab="files"]');
        const downloaded = web.waitForEvent("download");
        await web.click("#save");
        await (await downloaded).saveAs(join(s.work, "cape-donor.form.json"));
        await s.save();
        const source = await desk.inputValue("#document");
        await s.fresh(false);
        await select(target);
        await openDetails(input("Source character"));
        await input("Source character").selectOption(source);
      } else {
        await openDetails(input("Source character"));
        await editor.answerDialogs({ open: adult });
        await button("Use a saved form").click();
      }
      await web.click('[data-tab="files"]');
      await web
        .locator("#donor-file")
        .setInputFiles(id === "G6" ? join(s.work, "cape-donor.form.json") : s.adultFile);
      await web.waitForFunction(() =>
        document.querySelector("#status")?.textContent?.includes("Choose a branch from"),
      );
      await web.selectOption("#donor-region", root);
      await web.selectOption("#graft-mode", mode);
      await web.selectOption("#graft-target", target);
      const modes = {
        replace: "Replace part, keep children",
        wear: "Wear in current outfit",
        pattern: "Recut garment pattern",
        replaceBranch: "Replace whole branch",
        attach: "Attach above selection",
      };
      await input("Source part").selectOption({
        label:
          (await input("Source part").locator("option").allTextContents()).find(
            (n) => n.toLowerCase() === root,
          ) ?? root,
      });
      await input("Attachment").selectOption(modes[mode]);
      if (mode !== "pattern") {
        await input("Match destination height").setChecked(id !== "G4");
        await web.locator("#graft-fit").setChecked(id !== "G4");
      }
      span = id === "G6" ? 1 : 0.66;
      await compare(id, title, async () => {
        await web.click("#graft");
        assert.match(await web.locator("#status").innerText(), /grafted|fitted/i);
        await check("Graft branch");
      });
      await s.save();
    }
  }
  async function shoulderBlade() {
    await s.fresh(true);
    const file = join(s.work, "wing-donor.form.json");
    const parts: unknown = JSON.parse(
      execFileSync(
        process.execPath,
        [
          "--import",
          "./packages/document/test/support/register.ts",
          "--input-type=module",
          "-e",
          `import {generatedHuman} from './character-view/human-form.js';
      import {attachCreatureLimbs} from './character-view/human-creature-mount.js';
      import {prepareForm,preparePacks} from './verification/families/src/prepare.ts';
      import {writeFileSync} from 'node:fs';
      const source=generatedHuman(491,'any'),form=attachCreatureLimbs(source);
      writeFileSync(process.argv[1],JSON.stringify({format:'irudd.form.v1',form}));
      await preparePacks();
      const {document}=prepareForm('wing-donor',form);
      const added=new Set(form.parts.slice(source.parts.length).map(p=>p.id));
      process.stdout.write(JSON.stringify(document.parts.filter(p=>added.has(p.label))));`,
          file,
        ],
        { cwd: s.root, encoding: "utf8" },
      ),
    );
    assert.ok(Array.isArray(parts) && parts.length > 2);
    const chest = await s.nativeId("chest"),
      donor = await desk.inputValue("#document");
    const operations = parts.map((value: unknown) => {
      assert.ok(value && typeof value === "object");
      const parent: unknown = Reflect.get(value, "parent");
      assert.equal(typeof parent, "string");
      const part = {
        ...value,
        parent: parent === "p-chest" ? chest : parent,
      };
      return { op: "part.add", part };
    });
    await callEditor(desk, "apply", {
      request: {
        format: "irudd.command",
        version: 1,
        requestId: "qa-wing-donor",
        documentId: donor,
        expectedRevision: 1,
        command: { type: "edit", ops: operations },
      },
    });
    await desk.locator("#outliner .row").filter({ hasText: "left wing 1" }).first().waitFor();
    await s.save();
    await s.fresh(true);
    await select("chest");
    await openDetails(input("Source character"));
    await input("Source character").selectOption(donor);
    await input("Source part").selectOption({ label: "left wing 1" });
    await web.click('[data-tab="files"]');
    await web.locator("#donor-file").setInputFiles(file);
    await web.selectOption("#donor-region", "left wing 1");
    await web.selectOption("#graft-target", "chest");
    await input("Attachment").selectOption("Recut garment pattern");
    await web.selectOption("#graft-mode", "pattern");
    assert.equal(await input("Match destination height").isVisible(), false);
    const unchanged = await s.digest();
    await web.click("#graft");
    await button("Graft branch").click();
    assert.match(await web.locator("#status").innerText(), /cut garment/i);
    await desk
      .locator("#banner")
      .filter({ hasText: /cut garment/i })
      .waitFor();
    assert.equal(await s.digest(), unchanged);
    await input("Attachment").selectOption("Attach above selection");
    await web.selectOption("#graft-mode", "attach");
    await input("Match destination height").check();
    await web.locator("#graft-fit").check();
    span = 1.35;
    yaw = Math.PI;
    await compare(
      "G4-shoulder",
      "Seat the donor wing on the adult shoulder blade",
      async () => {
        await web.click("#graft");
        assert.match(await web.locator("#status").innerText(), /grafted/i);
        await check("Graft branch");
      },
      [0, 1.35, 0],
    );
    await s.save();
  }
  async function shelf() {
    await s.fresh(false);
    await select(head);
    await openDetails(input("Source character"));
    await web.click('[data-tab="files"]');
    const choices = await web
      .locator("#donor-component option")
      .evaluateAll((options) =>
        options.map((o) => o.getAttribute("value")).filter((v) => !!v && v !== "custom"),
      );
    for (const key of choices) {
      const local = "shelf-" + key;
      assert.equal(
        await input("Source character")
          .locator("option[value='" + local + "']")
          .count(),
        1,
        local,
      );
      await input("Source character").selectOption(local);
      await button("Graft branch").waitFor({ state: "attached" });
    }
    await web.selectOption("#donor-component", "dorsal-plate");
    await input("Source character").selectOption("shelf-dorsal-plate");
    await web.selectOption("#graft-mode", "attach");
    await web.selectOption("#graft-target", head);
    await input("Attachment").selectOption("Attach above selection");
    await input("Match destination height").check();
    await web.locator("#graft-fit").check();
    span = 0.67;
    await compare("G1-shelf", "Attach a convex bone plate from the component shelf", async () => {
      await web.click("#graft");
      assert.match(await web.locator("#status").innerText(), /grafted/i);
      await check("Graft branch");
    });
    await s.save();
  }
  async function handles() {
    const old = await desk.inputValue("#document");
    await desk.selectOption("#start", "creature-plan/seed");
    await desk.selectOption("#creature-family", "grazer");
    await desk.fill("#creature-seed", "33");
    await desk.getByRole("button", { name: "Create creature", exact: true }).click();
    await desk.waitForFunction(
      (k) =>
        document.querySelector<HTMLSelectElement>("#document")?.value !== k &&
        !document.querySelector("#viewport")?.hasAttribute("inert"),
      old,
    );
    const read = await callEditor(desk, "inspect", {
      documentId: await desk.inputValue("#document"),
    });
    const plan: unknown = Reflect.get(
      Object(Reflect.get(Object(Reflect.get(Object(read), "document")), "generation")),
      "params",
    );
    assert.ok(plan);
    const file = join(s.work, "handles.form.json"),
      planFile = join(s.work, "plan.json");
    writeFileSync(planFile, JSON.stringify(plan));
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import {buildCreature} from './character-view/creature-plan.js';import {readFileSync,writeFileSync} from 'node:fs';writeFileSync(process.argv[2],JSON.stringify({format:'irudd.form.v1',form:buildCreature(JSON.parse(readFileSync(process.argv[1])))}));`,
        planFile,
        file,
      ],
      { cwd: s.root },
    );
    await web.locator("#openfile").setInputFiles(file);
    await web.waitForFunction(() =>
      document.querySelector("#status")?.textContent?.includes("Form opened"),
    );
    await web.click('[data-tab="sculpt"]');
    const toggle = web.getByLabel("Drag handles on the model");
    await openDetails(toggle);
    await toggle.check();
    const panel = desk.locator("#creature-editor");
    if (!(await panel.evaluate((e) => e.hasAttribute("open"))))
      await panel.locator(":scope > summary").click();
    await openDetails(panel.locator("button").filter({ hasText: "Show drag handles" }));
    await desk.getByRole("button", { name: "Show drag handles" }).click();
    await desk.click("#camera-side");
    await web.click('[data-angle="Side"]');
    await desk.selectOption("#display-mode", "clay");
    subject = desktopSubject = "body";
    span = 1.14;
    yaw = Math.PI / 2;
    const handle = (p: Page, limb: boolean) =>
      p === desk
        ? p.locator(".creature-handle." + (limb ? "limb" : "girth")).nth(limb ? 0 : 2)
        : p.locator('[data-key="' + (limb ? "limb 0" : "girth 2") + '"].creature-handle');
    const initialScreens: Buffer[] = [],
      heldScreens: Buffer[] = [];
    const viewportScreenshot = async (p: Page) => {
      const clip = await p
        .locator(p === desk ? "#viewport canvas" : "#viewport")
        .first()
        .boundingBox();
      assert.ok(clip);
      return p === desk
        ? editor.capture({
            x: Math.round(clip.x),
            y: Math.round(clip.y),
            width: Math.round(clip.width),
            height: Math.round(clip.height),
          })
        : p.screenshot({ clip });
    };
    const drag = async (p: Page, limb: boolean, cancel = false, sign = 1) => {
      await s.frame(p);
      const h = handle(p, limb),
        box = await h.boundingBox();
      assert.ok(box);
      const x = box.x + box.width / 2,
        y = box.y + box.height / 2;
      await p.mouse.move(x, y);
      const before = limb || cancel ? undefined : await s.geom(p, "body");
      const capture = !limb && !cancel && sign > 0;
      if (capture) initialScreens.push(await viewportScreenshot(p));
      await p.mouse.down();
      await p.mouse.move(x + (limb ? 90 : 0), y - (limb ? 0 : sign * 145), { steps: 5 });
      await s.frame(p);
      if (before) {
        const during = await s.geom(p, "body");
        assert.ok(
          during.length && before.some((n, i) => Math.abs(n - (during[i] ?? n)) > 0.01),
          "A held girth drag must move the visible body by at least one centimetre",
        );
      }
      if (capture) {
        const guide = p.locator(p === desk ? ".plan-guides svg" : ".creature-guide");
        assert.ok(
          (await guide.locator("polyline,polygon").count()) >= 2,
          "The held handle should show its previous and current sections",
        );
        const readout = p.locator(p === desk ? ".plan-guides output" : ".creature-readout");
        assert.ok(await readout.isVisible());
        heldScreens.push(await viewportScreenshot(p));
      }
      if (cancel) await p.keyboard.press("Escape");
      await p.mouse.up();
      await s.frame(p);
    };
    await drag(web, false, false, -1);
    await s.checkHistory(() => drag(desk, false, false, -1));
    for (const [id, limb, title] of [
      ["H1", false, "Pull the belly girth to its visible limit"],
      ["H2", true, "Slide the limb group along the spine"],
    ] as const) {
      await compare(id, title, async () => {
        await drag(web, limb);
        await s.checkHistory(() => drag(desk, limb));
      });
    }
    await s.writePair(
      "H1-live",
      "Belly section and live readout while the handle is held",
      initialScreens,
      heldScreens,
    );
    await compare("H3", "Cancel a drag and nudge the focused belly handle", async () => {
      const digest = await s.digest(),
        bodyId = await s.nativeId("body");
      for (const p of [web, desk]) {
        await drag(p, false, true);
        const h = handle(p, false);
        await h.click();
        await s.frame(p);
        await h.hover();
        const cameraPoint = () =>
          p.evaluate(
            (id) => window.shapeProbe.corner(id, [0, 0, 0], 0.25, 0).end,
            p === web ? "body" : bodyId,
          );
        const beforeZoom = await cameraPoint();
        await p.mouse.wheel(0, -150);
        await s.frame(p);
        const zoomed = await cameraPoint();
        assert.ok(
          Math.hypot(zoomed.x - beforeZoom.x, zoomed.y - beforeZoom.y) > 0.1,
          "The wheel should zoom over a handle",
        );
        await h.hover();
        await p.mouse.wheel(0, 150);
        await s.frame(p);
      }
      assert.equal(await s.digest(), digest);
      for (let i = 0; i < 8; i++) {
        await handle(web, false).press("ArrowDown");
        await s.checkHistory(() => handle(desk, false).press("ArrowDown"));
      }
    });
    await s.save();
  }
  const group = process.argv[3];
  for (const [name, run] of Object.entries({
    plates,
    grafts,
    shelf,
    handles,
    guards,
    shoulderBlade,
  }))
    if (!group || group === name) await run();
  if (!group || group === "sheet") {
    const ids =
      "F1 F2 F3 F3-refit F4 F5 R1 R2 R3 G1 G1-shelf G2 G3 G4 G4-shoulder G5 G6 H1 H1-live H2 H3".split(
        " ",
      );
    await contactSheet(
      web,
      s.dir,
      await Promise.all(
        ids.map(async (name) =>
          name === "F4" || name === "F5"
            ? s.highlightDetail(name)
            : {
                name,
                image: readFileSync(join(s.dir, name + ".png")).toString("base64"),
              },
        ),
      ),
      2,
    );
  }
}
