import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import type { Locator } from "@playwright/test";
import { tailorPieces, type TailorField } from "@irudd/character/human";
import { openDetails, type Suite } from "./qa-field-parity.js";

export type Compare = (
  id: string,
  title: string,
  edit: () => Promise<void>,
  height?: number,
  y?: number,
  yaw?: number,
) => Promise<void>;
export async function setValue(control: Locator, value: string) {
  await control.evaluate((e, value) => {
    if (!(e instanceof HTMLInputElement || e instanceof HTMLSelectElement))
      throw new Error("Missing garment control.");
    e.value = value;
    e.dispatchEvent(new Event("input", { bubbles: true }));
    e.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

export async function clothingParity(s: Suite, compare: Compare, group?: string) {
  const { web, desk } = s;
  const fields: unknown = JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        "import {tailorPieces} from './character-view/human-tailor.js';console.log(JSON.stringify(Object.entries(tailorPieces).map(([key,p])=>[key,...Object.keys(p.fields)])))",
      ],
      { cwd: s.root, encoding: "utf8" },
    ),
  );
  assert.ok(Array.isArray(fields));
  const browser = web.locator("#human-tailor"),
    desktop = desk.locator("#tailor");
  for (const row of fields) {
    assert.ok(Array.isArray(row) && row.every((x: unknown) => typeof x === "string"));
    const key = String(row[0]);
    if (group && group !== "tailor" && group !== "tailor-" + key) continue;
    const spec = tailorPieces[key];
    assert.ok(spec, key);
    await s.fresh(true, true);
    await web.click('[data-tab="sculpt"]');
    const start = browser.getByRole("button", {
      name: "Tailor this outfit piece by piece",
      includeHidden: true,
    });
    const nativeStart = desktop.getByRole("button", {
      name: "Tailor this outfit",
      exact: true,
      includeHidden: true,
    });
    await openDetails(start);
    await openDetails(nativeStart);
    await start.click();
    await s.checkHistory(() => nativeStart.click());
    if (key === "shoes") {
      const starter = browser.locator("div > details").last();
      const remove = starter.getByRole("button", {
        name: "Remove",
        exact: true,
        includeHidden: true,
      });
      await openDetails(remove);
      await desktop.getByLabel("Tailored layer").selectOption("3");
      await remove.click();
      await s.checkHistory(() =>
        desktop.getByRole("button", { name: "Remove piece", exact: true }).click(),
      );
    }
    const add = browser.getByRole("button", { name: "Add piece", exact: true });
    const nativeAdd = desktop.getByRole("button", { name: "Add piece", exact: true });
    await browser.getByLabel("Piece to add").selectOption(key);
    await desktop.getByLabel("Piece to add").selectOption(key);
    await add.click();
    await s.checkHistory(() => nativeAdd.click());
    const last = browser.locator("div > details").last();
    for (const [index, fieldKey] of row.slice(1).entries()) {
      const name = String(fieldKey);
      const requested = process.env["IRUDD_TAILOR_FIELD"];
      if (requested && requested !== name) continue;
      const info: TailorField | undefined = spec.fields[name];
      assert.ok(info, name);
      const left = last.locator(":scope > label").nth(index).locator("input,select");
      const right = desktop
        .getByLabel(info.label, { exact: true })
        .and(
          desktop.locator(
            info.type === "choice"
              ? "select"
              : info.type === "colour"
                ? 'input[type="color"]'
                : 'input[type="number"]',
          ),
        );
      await openDetails(left);
      const prerequisite =
        key === "top" && name === "depth"
          ? (["neck", "Neckline", "v"] as const)
          : key === "belt" && name === "trim"
            ? (["buckle", "Buckle", "frame"] as const)
            : null;
      if (prerequisite) {
        const [fieldKey, label, choice] = prerequisite;
        const native = desktop.getByLabel(label, { exact: true }).and(desktop.locator("select"));
        const original = last
          .locator(":scope > label")
          .nth(row.indexOf(fieldKey) - 1)
          .locator("select");
        if ((await original.inputValue()) !== choice) await setValue(original, choice);
        if ((await native.inputValue()) !== choice)
          await s.checkHistory(() => setValue(native, choice));
      }
      const choices: string[] =
        info.type === "choice"
          ? await left
              .locator("option")
              .evaluateAll((els) => els.map((e) => e.getAttribute("value") ?? e.textContent ?? ""))
          : info.type === "colour"
            ? ["#93572f"]
            : [(await left.getAttribute("max")) ?? ""];
      async function change(v: string) {
        await setValue(left, v);
        await s.checkHistory(() => setValue(right, v));
      }
      for (const [i, v] of choices.entries()) {
        if (info.type === "range" || (await right.inputValue()) === v) {
          const alternate: string | null | undefined =
            info.type === "choice"
              ? choices.find((t) => t !== v)
              : info.type === "colour"
                ? "#498975"
                : await left.getAttribute("min");
          assert.ok(alternate, name);
          if ((await right.inputValue()) !== alternate) await change(alternate);
        }
        await compare(
          "T-" + key + "-" + name + "-" + (i + 1),
          spec.label + " / " + info.label + " / " + v,
          () => change(v),
          key === "cuirass" || key === "pauldrons"
            ? 0.95
            : key === "boots" || key === "shoes"
              ? 1.1
              : 2.05,
          key === "cuirass" || key === "pauldrons"
            ? 1.42
            : key === "boots" || key === "shoes"
              ? 0.43
              : 0.96,
          name === "back" ? Math.PI + 0.18 : 0.18,
        );
      }
    }
    await s.save();
  }
}
