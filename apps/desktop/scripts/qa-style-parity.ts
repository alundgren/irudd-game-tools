import { tailorBehaviour } from "./qa-tailor-behaviour.js";
import { appearanceParity } from "./qa-appearance-parity.js";
import { setValue, clothingParity } from "./qa-clothing-parity.js";
import assert from "node:assert/strict";
import { join } from "node:path";
import { readFileSync, readdirSync } from "node:fs";
import { contactSheet } from "./contact-sheet.js";
import { openDetails, type Suite } from "./qa-field-parity.js";

export async function styleParity(s: Suite) {
  const { web, desk } = s;
  const images: { name: string; image: string }[] = [];
  async function thumbnail(id: string, title: string) {
    const source = readFileSync(join(s.dir, id + ".png")).toString("base64");
    const thumb = await web.evaluate(async (bytes) => {
      const image = await createImageBitmap(
        new Blob([Uint8Array.from(atob(bytes), (c) => c.charCodeAt(0))], { type: "image/png" }),
      );
      const canvas = document.createElement("canvas");
      canvas.width = 440;
      canvas.height = Math.round((440 * image.height) / image.width);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Cannot draw thumbnail.");
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      image.close();
      return canvas.toDataURL("image/jpeg", 0.91).split(",")[1] ?? "";
    }, source);
    images.push({ name: title, image: thumb });
  }
  async function render(
    id: string,
    title: string,
    edit: () => Promise<void>,
    height = 2.05,
    y = 0.96,
    yaw = 0.18,
    rearYaw?: number,
  ) {
    async function shots(angle: number) {
      const colour = web.locator('[data-mode="Color"]');
      if ((await colour.getAttribute("aria-pressed")) !== "true") await colour.click();
      return Promise.all(
        [web, desk].map(async (p) => {
          await s.frame(p);
          return Buffer.from(
            await p.evaluate(([h, cy, angle]) => window.shapeProbe.capture([0, cy, 0], h, angle), [
              height,
              y,
              angle,
            ] as const),
            "base64",
          );
        }),
      );
    }
    const before = await shots(yaw);
    const rearBefore = rearYaw === undefined ? undefined : await shots(rearYaw);
    await edit();
    const after = await shots(yaw);
    await s.writePair(id, title, before, after);
    await thumbnail(id, title);
    if (rearBefore && rearYaw !== undefined) {
      await s.writePair(id + "-rear", title + " from behind", rearBefore, await shots(rearYaw));
      await thumbnail(id + "-rear", title + " from behind");
    }
    console.log(id, title);
  }
  async function fresh(dressed = false) {
    await s.fresh(true, dressed);
    await web.click('[data-tab="sculpt"]');
  }
  const group = process.env["IRUDD_STYLE_GROUP"];
  if (group === "sheet") {
    const names = readdirSync(s.dir)
      .filter((n) => /^(?:S-|T-|W-|G-|C-).*\.png$/.test(n))
      .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
    for (const n of names) {
      const id = n.slice(0, -4);
      await thumbnail(id, id);
    }
    assert.ok(images.length);
    await contactSheet(web, s.dir, images, 1, "contact-sheet.png", 8);
    return;
  }
  if (!group || group === "shape") {
    for (const structure of ["bat", "feather", "insect"]) {
      await fresh();
      const grow = web.locator("#human-styling button").filter({ hasText: "Grow paired wings" });
      const mount = desk
        .locator("#creature-editor button")
        .filter({ hasText: "Mount paired wings" });
      await openDetails(grow);
      if (!(await desk.locator("#creature-editor").evaluate((el) => el.hasAttribute("open"))))
        await desk.click("#creature-editor > summary");
      await openDetails(mount);
      await web
        .locator("#human-styling label")
        .filter({ hasText: "Wing structure" })
        .locator("select")
        .selectOption(structure);
      await desk.getByLabel("Wing structure", { exact: true }).selectOption(structure);
      await render(
        "W-" + structure,
        "Paired " + structure + " wings",
        async () => {
          await grow.click();
          await s.checkHistory(() => mount.click());
        },
        1.95,
        1.24,
        Math.PI - 0.16,
      );
      const delta = web.locator("#human-delta"),
        measurement = desk.locator("#human-measurement");
      await openDetails(delta);
      await openDetails(measurement);
      await web.selectOption("#human-group", "Body");
      await web.selectOption("#human-parameter", "height");
      await desk.selectOption("#human-region", "Body");
      await desk.selectOption("#human-axis", "height");
      const height = Number(await measurement.inputValue()),
        shift = height > 1.72 ? -0.12 : 0.12;
      await render(
        "W-" + structure + "-refit",
        "Reshape the adult with " + structure + " wings",
        async () => {
          await setValue(delta, String(Math.round((100 * shift) / 0.3)));
          await web.click("#human-apply");
          await s.checkHistory(() => setValue(measurement, (height + shift).toFixed(2)));
        },
        2.25,
        1.1,
        0.13,
      );
      await s.save();
    }
    await fresh(true);
    const fabric = desk.locator("#cutting").getByLabel("Garment cut");
    await openDetails(fabric);
    await openDetails(web.locator("#garment-cut"));
    for (const [i, kind] of ["Cape", "Poncho", "Tabard", "Skirt"].entries()) {
      await s.part(kind === "Skirt" ? "pelvis" : "chest", false);
      await fabric.selectOption(kind);
      await web.selectOption("#garment-cut", kind);
      await render("G-" + (i + 1), "Layer " + kind, async () => {
        await web.click("#cut-garment");
        await s.checkHistory(() => desk.locator("#cutting button").click());
      });
    }
    await s.save();
  }
  const fields = [
    "outfit",
    "earrings",
    "eyewear",
    "necklace",
    "waistBag",
    "handProp",
    "fringe",
    "browStyle",
    "armInk",
    "clothDesign",
    "secondDesign",
    "facialHair",
    "hat",
    "makeup",
    "hair",
  ];
  if (group !== "shape") {
    for (const field of fields.filter((f) => !group || f === group)) {
      await fresh(true);
      if (field === "fringe" || field === "secondDesign") {
        const subject = field === "fringe" ? "hair" : "outfit",
          value = field === "fringe" ? "Fringed bob" : "Shirt and chinos";
        const a = web.locator("#adult-" + subject),
          b = desk.locator("#human-" + subject);
        await openDetails(a);
        await openDetails(b);
        await a.selectOption(value);
        await s.checkHistory(() => setValue(b, value));
      }
      const left = web.locator("#adult-" + field),
        right = desk.locator("#human-" + field);
      await openDetails(left);
      await openDetails(right);
      const values = await left
        .locator("option")
        .evaluateAll((list) => list.map((e) => e.getAttribute("value") ?? e.textContent ?? ""));
      const portrait = [
        "hair",
        "earrings",
        "eyewear",
        "fringe",
        "browStyle",
        "hat",
        "makeup",
        "facialHair",
      ].includes(field);
      const nativeValue = (name: string) => (field === "armInk" && name === "None" ? "" : name);
      const select = async (value: string) => {
        await left.selectOption(value);
        await s.checkHistory(async () => {
          await right.selectOption(nativeValue(value));
        });
      };
      const entries = process.env["IRUDD_STYLE_ENTRIES"]?.split(",").map(Number);
      for (const [i, name] of values.entries()) {
        if (entries && !entries.includes(i + 1)) continue;
        const available = await right
          .locator("option")
          .evaluateAll((list) => list.map((e) => e.getAttribute("value") ?? e.textContent ?? ""));
        assert.ok(
          available.includes(nativeValue(name)),
          field + " lacks " + name + " in the desktop workshop",
        );
        if (
          field === "secondDesign" &&
          (i < 2 || name === "Knit yoke") &&
          (await right.inputValue()) !== "Gingham"
        )
          await select("Gingham");
        if (
          (await right.inputValue()) === nativeValue(name) ||
          (await left.inputValue()) === name
        ) {
          const alternate = values.find((v) => v !== name && available.includes(v) && v !== "None");
          assert.ok(alternate);
          await select(alternate);
        }
        await render(
          "S-" + field + "-" + (i + 1),
          field + " / " + name,
          () => select(name),
          portrait ? 0.55 : field === "necklace" ? 0.62 : field === "armInk" ? 0.96 : 2.05,
          portrait ? 1.82 : field === "necklace" ? 1.64 : field === "armInk" ? 1.23 : 0.96,
          field === "armInk" ? 0.52 : 0.18,
          field === "hair" &&
            [
              "Ponytail",
              "Bun",
              "Braid",
              "Low ponytail",
              "Tied bun",
              "Sculpted tie-back",
              "Fringed ponytail",
              "Ribbon ponytail",
            ].includes(name)
            ? Math.PI - 0.69
            : undefined,
        );
      }
      await s.save();
    }
  }
  if (!group || ["cast", "palette", "family"].includes(group))
    await appearanceParity(s, render, group);
  if (!group || ["sets", "layers", "wardrobe-modes"].includes(group))
    await tailorBehaviour(s, render, group);
  if (!group || group.startsWith("tailor")) await clothingParity(s, render, group);
  assert.ok(images.length);
  await contactSheet(
    web,
    s.dir,
    images,
    1,
    group ? "contact-" + group + ".png" : "contact-sheet.png",
    group ? 2 : 8,
  );
}
