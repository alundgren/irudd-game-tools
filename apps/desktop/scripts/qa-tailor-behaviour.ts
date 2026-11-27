import assert from "node:assert/strict";
import { type Locator } from "@playwright/test";
import { openDetails, type Suite } from "./qa-field-parity.js";
import { setValue, type Compare } from "./qa-clothing-parity.js";

export async function tailorBehaviour(s: Suite, compare: Compare, group?: string) {
  const { web, desk } = s,
    left = web.locator("#human-tailor"),
    right = desk.locator("#tailor");
  const b = (host: Locator, name: string) =>
    host.getByRole("button", { name, exact: true, includeHidden: true });
  async function action(l: Locator, r: Locator) {
    await openDetails(l);
    await openDetails(r);
    await l.click();
    await s.checkHistory(() => r.click());
  }
  async function fresh() {
    await s.fresh(true, true);
    await web.click('[data-tab="sculpt"]');
  }
  const rows = left.locator("div > details");
  async function add(key: string) {
    await left.getByLabel("Piece to add").selectOption(key);
    await right.getByLabel("Piece to add").selectOption(key);
    await action(b(left, "Add piece"), b(right, "Add piece"));
  }
  async function mode(name: string) {
    const button =
      name === "Anatomy"
        ? web.locator("#human-dress-toggle")
        : web.locator("#outfits button").filter({ hasText: new RegExp("^" + name + "$") });
    const panel = await button.evaluate((el) =>
      el.closest("[data-panel]")?.getAttribute("data-panel"),
    );
    if (panel) await web.locator('[data-tab="' + panel + '"]').click();
    await openDetails(button);
    await button.click();
    const base = desk.getByLabel("Base outfit", { exact: true });
    await openDetails(base);
    await s.checkHistory(() => setValue(base, name));
    await web.click('[data-tab="sculpt"]');
  }
  if (!group || group === "sets") {
    for (const [index, look] of [
      "Light fantasy",
      "Heavy fantasy",
      "Light sci-fi",
      "Heavy sci-fi",
    ].entries()) {
      await fresh();
      const l = left.getByLabel("Armour look"),
        r = right.getByLabel("Armour set", { exact: true });
      await openDetails(l);
      await openDetails(r);
      await l.selectOption(look);
      await r.selectOption(look);
      await compare("T-set-" + (index + 1), look + " armour set", () =>
        action(b(left, "Wear armour set"), b(right, "Wear armour set")),
      );
      const seed = 341 + index * 79;
      const stable = async (c: Locator) =>
        c.evaluate((e, seed) => {
          if (!(e instanceof HTMLButtonElement)) throw new Error("Expected a button.");
          const random = Math.random;
          try {
            Math.random = () => (seed + 0.25) / 1000;
            e.click();
          } finally {
            Math.random = random;
          }
        }, seed);
      await compare(
        "T-set-" + (index + 1) + "-variation",
        look + " variation " + seed,
        async () => {
          await stable(b(left, "Another variation"));
          await s.checkHistory(() => stable(b(right, "Another variation")));
        },
      );
      const colour = rows.first().locator(":scope > label input[type=color]").first(),
        native = right.locator("input[type=color]").first();
      await openDetails(colour);
      await setValue(colour, "#9a7744");
      await s.checkHistory(() => setValue(native, "#9a7744"));
      await s.save();
    }
  }
  if (!group || group === "layers") {
    await fresh();
    await compare("T-layers-1", "Lay out starter layers", () =>
      action(b(left, "Tailor this outfit piece by piece"), b(right, "Tailor this outfit")),
    );
    await compare("T-layers-2", "Fill all twelve layer slots", async () => {
      for (const piece of ["boots", "gloves", "belt", "shoes", "belt", "gloves", "belt", "gloves"])
        await add(piece);
      assert.ok(await b(left, "Add piece").isDisabled());
      assert.ok(await b(right, "Add piece").isDisabled());
    });
    await compare("T-layers-4", "Remove one layer and clear the remaining layers", async () => {
      await action(b(rows.last(), "Remove"), b(right, "Remove piece"));
      await action(b(left, "Remove tailored pieces"), b(right, "Remove tailored pieces"));
    });
    await action(b(left, "Tailor this outfit piece by piece"), b(right, "Tailor this outfit"));
    await add("boots");
    await compare("T-layers-3", "Move boots below the trousers", async () => {
      for (let i = 4; i > 0; i--)
        await action(b(rows.nth(i), "Wear earlier"), b(right, "Wear earlier"));
      assert.ok(await b(rows.first(), "Wear earlier").isDisabled());
      assert.ok(await b(right, "Wear earlier").isDisabled());
    });
    await compare("T-layers-3-later", "Move boots over the trousers again", async () => {
      for (let i = 0; i < 4; i++)
        await action(b(rows.nth(i), "Wear later"), b(right, "Wear later"));
      assert.ok(await b(rows.last(), "Wear later").isDisabled());
      assert.ok(await b(right, "Wear later").isDisabled());
    });
    for (const [index, name] of [
      "Anatomy",
      "Base layer",
      "Pressure suit",
      "Work clothes",
    ].entries()) {
      const id = index === 3 ? "T-layers-5" : "T-layers-5-" + (index + 1);
      await compare(id, "Keep tailored layers in " + name, async () => {
        await mode(name);
        assert.equal(await rows.count(), 5);
      });
    }
    await compare("T-layers-6", "Mail, gorget, articulated guards and mantle", async () => {
      const i = 1;
      await right.getByLabel("Tailored layer").selectOption(String(i));
      const mail = rows
        .nth(i)
        .locator(":scope > label")
        .filter({ hasText: "Material" })
        .locator("select");
      await openDetails(mail);
      await setValue(mail, "mail");
      await s.checkHistory(() => setValue(right.getByLabel("Material", { exact: true }), "mail"));
      await add("cuirass");
      const collar = rows
        .last()
        .locator(":scope > label")
        .filter({ hasText: "Collar" })
        .locator("select");
      await openDetails(collar);
      await setValue(collar, "gorget");
      await s.checkHistory(() => setValue(right.getByLabel("Collar", { exact: true }), "gorget"));
      await add("pauldrons");
      await add("travellingMantle");
    });
    await s.save();
  }
  if (!group || group === "wardrobe-modes") {
    await fresh();
    const style = web.locator("#adult-outfit"),
      native = desk.locator("#human-outfit");
    await openDetails(style);
    await openDetails(native);
    async function pick(v: string) {
      await style.selectOption(v);
      await s.checkHistory(() => setValue(native, v));
    }
    const bag = web.locator("#adult-waistBag"),
      other = desk.locator("#human-waistBag");
    await openDetails(bag);
    await openDetails(other);
    await setValue(bag, "Dispatch folio");
    await s.checkHistory(() => setValue(other, "Dispatch folio"));
    await compare("S-mode-hide-anatomy", "Hide the bag in Anatomy", () => mode("Anatomy"));
    await compare("S-mode-hide-work", "Show the bag with its outfit again", () =>
      mode("Work clothes"),
    );
    await compare("S-mode-hide", "Wear the pressure suit", () => pick("Pressure suit"));
    await action(b(left, "Tailor this outfit piece by piece"), b(right, "Tailor this outfit"));
    await compare("S-mode-dress", "Selecting a preset clears tailored layers", async () => {
      await pick("None");
      assert.equal(await rows.count(), 0);
      assert.equal(await desk.getByLabel("Base outfit", { exact: true }).inputValue(), "Anatomy");
      const cast = web.locator("#adult-cast"),
        nativeCast = desk.locator("#human-cast");
      await openDetails(cast);
      await openDetails(nativeCast);
      await setValue(cast, "Gardener");
      await s.checkHistory(() => setValue(nativeCast, "Gardener"));
      assert.equal(
        await desk.getByLabel("Base outfit", { exact: true }).inputValue(),
        "Work clothes",
      );
    });
    await s.save();
  }
}
