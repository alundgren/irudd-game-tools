import assert from "node:assert/strict";
import { castOutfits, castDonor, castFigureNames } from "@irudd/character/human";
import { type Locator } from "@playwright/test";
import { openDetails, type Suite } from "./qa-field-parity.js";
import { setValue, type Compare } from "./qa-clothing-parity.js";

export async function appearanceParity(s: Suite, compare: Compare, group?: string) {
  const { web, desk } = s;
  const pair = (key: string) =>
    [web.locator("#adult-" + key), desk.locator("#human-" + key)] as const;
  async function edit(controls: readonly [Locator, Locator], value: string, other = value) {
    await openDetails(controls[0]);
    await openDetails(controls[1]);
    await setValue(controls[0], value);
    await s.checkHistory(() => setValue(controls[1], other));
  }
  async function fresh() {
    await s.fresh(true, true);
    await web.click('[data-tab="sculpt"]');
  }
  async function options(control: Locator) {
    return control
      .locator("option")
      .evaluateAll((els) => els.map((e) => e.getAttribute("value") ?? e.textContent ?? ""));
  }
  if (!group || group === "cast") {
    await fresh();
    const cast = pair("cast");
    const names = await options(cast[0]);
    let donorChecked = false;
    for (const [i, name] of names.entries()) {
      const native = name === "None" ? "" : name;
      if ((await cast[1].inputValue()) === native) {
        const different = names.find((n) => n !== name && n !== "None");
        assert.ok(different);
        await edit(cast, different);
      }
      await compare("S-cast-" + (i + 1), "Character artwork / " + name, () =>
        edit(cast, name, native),
      );
      if (!native) continue;
      const label = castFigureNames.find((n) => n === name);
      assert.ok(label);
      const fits = castOutfits(label);
      const top = pair("castTop"),
        bottom = pair("castBottom");
      for (const [j, look] of fits.entries()) {
        const current = await top[1].inputValue();
        if (current === look.castTop && (await bottom[1].inputValue()) === look.castBottom) {
          const alt = fits.find((f) => f.castTop !== current);
          if (alt) await edit(top, alt.castTop);
          else {
            await edit(cast, "None", "");
          }
        }
        await compare(
          "C-" + name + "-" + (j + 1),
          name + " / " + look.castTop + " / " + look.castBottom,
          async () => {
            if ((await cast[1].inputValue()) !== native) await edit(cast, name);
            if ((await top[1].inputValue()) !== look.castTop) await edit(top, look.castTop);
            if ((await bottom[1].inputValue()) !== look.castBottom)
              await edit(bottom, look.castBottom);
            assert.equal(await bottom[0].inputValue(), look.castBottom);
            assert.equal(await bottom[1].inputValue(), look.castBottom);
          },
        );
      }
      if (!donorChecked && castDonor(name)) {
        for (const key of ["castShape", "castPigment"])
          await compare("S-" + key, key, () => edit(pair(key), ".85"), 0.58, 1.82);
        const skin = [web.locator("#human-skin"), desk.locator("#human-skin")] as const;
        await compare(
          "S-castSkin",
          "Change cast skin tone",
          () => edit(skin, "#89532d"),
          0.68,
          1.79,
        );
        await compare(
          "S-mode-cast",
          "Restore the artwork's source skin tone",
          async () => {
            assert.ok(await web.locator("#adult-hair").isDisabled());
            assert.equal(await desk.locator("#human-hair").count(), 0);
            const left = web.getByRole("button", { name: "Restore source skin tone" }),
              right = desk.getByRole("button", { name: "Restore source skin tone" });
            await openDetails(left);
            await openDetails(right);
            await left.click();
            await s.checkHistory(() => right.click());
          },
          0.68,
          1.79,
        );
        donorChecked = true;
      }
      await s.save();
    }
    assert.ok(donorChecked);
  }
  if (!group || group === "palette") {
    await fresh();
    await edit(pair("outfit"), "Explorer");
    await edit(pair("hair"), "Loose waves");
    await edit(pair("hat"), "Beret");

    for (const key of [
      "hatColor",
      "hairColor",
      "clothColor",
      "clothAccent",
      "clothSecond",
      "clothLight",
      "accentColor",
      "leatherColor",
      "soleColor",
      "metalColor",
    ]) {
      const selected = process.env["IRUDD_STYLE_FIELDS"]?.split(",");
      if (selected && !selected.includes(key)) continue;
      if (
        (key === "clothLight" || key === "metalColor") &&
        (await pair("outfit")[1].inputValue()) !== "Split mantle"
      )
        await edit(pair("outfit"), "Split mantle");
      if (key === "clothAccent") {
        const choices = await options(pair("clothDesign")[0]);
        const design = choices.find((v) => v !== "Plain cloth");
        assert.ok(design);
        await edit(pair("clothDesign"), design);
      }
      await compare(
        "S-" + key,
        "Change " + key,
        () => edit(pair(key), "#ac315c"),
        key === "hairColor" || key === "hatColor" ? 0.57 : 2.05,
        key === "hairColor" || key === "hatColor" ? 1.82 : 0.96,
      );
    }
    await s.save();
  }
  if (!group || group === "family") {
    await fresh();
    for (const key of ["facePlanes", "faceFamily", "faceFamilyHair"]) {
      const c = pair(key),
        choices = await options(c[0]);
      for (const [i, v] of choices.entries()) {
        if ((await c[0].inputValue()) === v || (await c[1].inputValue()) === v) {
          const other = choices.find((n) => n !== v);
          assert.ok(other);
          await edit(c, other);
        }
        await compare("S-" + key + "-" + (i + 1), key + " / " + v, () => edit(c, v), 0.6, 1.82);
      }
    }
    await compare(
      "S-mode-family",
      "Start a Studio Rain person",
      async () => {
        const left = web.getByRole("button", { name: "Start a Studio Rain person" }),
          right = desk.getByRole("button", { name: "Start a Studio Rain person" });
        await openDetails(left);
        await openDetails(right);
        await left.click();
        await s.checkHistory(() => right.click());
        for (const c of pair("hair")) assert.ok(await c.isEnabled());
        for (const c of pair("makeup")) assert.ok(await c.isDisabled());
        await edit(pair("faceFamilyHair"), "Family");
        for (const c of pair("hair")) assert.ok(await c.isDisabled());
      },
      0.65,
      1.82,
    );
    await s.save();
  }
}
