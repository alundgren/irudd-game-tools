import { outfitPalette, toneFields } from "@irudd/character/human/dress";
import { decodeWith } from "@irudd/document";
import {
  adultStyleOptions,
  castDonor,
  castFigureNames,
  castOutfits,
  castSkin,
  changeMeasurement,
  chooseAdultStyle,
  drawnComplexions,
  eyeColors,
  humanAdultId,
  HumanAdultParams,
  humanRange,
  humanWornCast,
  isHumanAxis,
  lookDirections,
  measurementGroups,
  newHumanLook,
  rerollRegion,
  restoreSkin,
  showOutfit,
  skinTone,
  tintSkin,
  type LookDirection,
  type MeasurementRegion,
} from "@irudd/character/human";
import type { Direction } from "../direction.js";
import { button, byId, el } from "../dom.js";
import type { PanelContext } from "./context.js";

const styleLabels = {
  hair: "Hairstyle",
  fringe: "Fringe",
  browStyle: "Eyebrows",
  makeup: "Makeup",
  armInk: "Arm ink",
  eyewear: "Eyewear",
  necklace: "Necklace",
  outfit: "Clothing",
  clothDesign: "Cloth design",
  secondDesign: "Second piece design",
};
const tones = {
  hairColor: "Hair colour",
  clothColor: "Cloth tint",
  clothSecond: "Second cloth",
  clothLight: "Pale cloth",
  accentColor: "Accent piece",
  clothAccent: "Print colour",
  leatherColor: "Leather",
  soleColor: "Soles",
  metalColor: "Metal",
} as const;

function select(
  id: string,
  options: readonly string[],
  value: string,
  change: (value: string) => void,
  empty?: string,
) {
  const input = el("select");
  input.id = id;
  if (empty) input.add(new Option(empty, ""));
  for (const name of options) input.add(new Option(name, name));
  input.value = value;
  input.onchange = () => change(input.value);
  return input;
}

function input(
  id: string,
  type: "color" | "range",
  value: string,
  change: (value: string) => void,
) {
  const field = el("input");
  field.type = type;
  field.id = id;
  if (type === "range") {
    field.min = "0";
    field.max = "1";
    field.step = "0.01";
  }
  field.value = value;
  field.onchange = () => change(field.value);
  return field;
}

const field = (name: string, control: HTMLElement) => el("label", {}, name, control);
const seed = () => crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
function keys<T extends object>(record: T) {
  const result = [];
  for (const key in record) if (Object.hasOwn(record, key)) result.push(key);
  return result;
}

export function mountHuman(ctx: PanelContext, variation: () => Direction | undefined) {
  const panel = byId("human-editor", HTMLElement);
  const anatomy = byId("human-anatomy", HTMLDetailsElement);
  const appearance = byId("human-appearance", HTMLDetailsElement);
  const styling = byId("human-styling", HTMLDetailsElement);
  let region: MeasurementRegion = "Body";
  let axis = "height";
  let direction: LookDirection = "Any";

  function render(): void {
    const generation = ctx.doc?.generation;
    const decoded =
      generation?.generator === humanAdultId && decodeWith(HumanAdultParams, generation.params);
    const body = ctx.humanBody;
    const view = ctx.view;
    panel.hidden = !decoded || !decoded.ok || !view || !body;
    if (!decoded || !decoded.ok || !view || !body) return;
    const params = decoded.value;
    const base = { documentId: view.documentId, revision: view.revision };
    function steer(next: HumanAdultParams, summary: string) {
      panel.inert = true;
      void ctx
        .commit(
          { type: "edit", ops: [{ op: "generation.steer", params: next }], summary },
          summary,
          base,
        )
        .then((ok) => {
          panel.inert = false;
          if (!ok) render();
        });
    }
    const measurements = Object.entries<string>(measurementGroups[region]);
    if (!measurements.some(([key]) => key === axis)) axis = measurements[0]?.[0] ?? "height";
    const measurement = axis;
    if (!isHumanAxis(measurement)) return;
    const [min, max, initial] = humanRange(measurement);
    const value = params.human[measurement] ?? initial;
    const reading = el("output");
    const describeValue = (n: number) =>
      measurement === "height" ? Math.round(n * 100) + " cm" : n.toFixed(2);
    reading.textContent = describeValue(value);
    const name = measurements.find(([key]) => key === measurement)?.[1] ?? measurement;
    const slider = input("human-measurement", "range", "0", (v) =>
      steer(changeMeasurement(params, measurement, Number(v)), "Adjust " + name),
    );
    slider.min = String(min);
    slider.max = String(max);
    slider.value = String(value);
    slider.oninput = () => {
      reading.textContent = describeValue(slider.valueAsNumber);
    };
    const choice = el("select");
    choice.id = "human-axis";
    choice.replaceChildren(...measurements.map(([key, label]) => new Option(label, key)));
    choice.value = axis;
    choice.onchange = () => {
      axis = choice.value;
      render();
    };
    anatomy.querySelector("div")?.replaceChildren(
      field(
        "Region",
        select("human-region", Object.keys(measurementGroups), region, (v) => {
          const selected = keys(measurementGroups).find((key) => key === v);
          if (selected) region = selected;
          render();
        }),
      ),
      field("Measurement", choice),
      field(name, slider),
      reading,
      button("Reroll " + region, () =>
        steer(
          rerollRegion(body, params, region, seed(), variation()?.strength),
          "Reroll " + region,
        ),
      ),
    );

    const cast = humanWornCast(params);
    const restore = button("Restore source skin tone", () =>
      steer(restoreSkin(params), "Restore source skin tone"),
    );
    restore.disabled = cast ? skinTone(params) === castSkin(cast) : !params.sourceSkin;
    const eye = select(
      "human-eye",
      eyeColors,
      params.eyeColor ?? "",
      (v) => {
        const { eyeColor: _previous, ...rest } = params;
        const color = eyeColors.find((n) => n === v);
        steer(color ? { ...rest, eyeColor: color } : rest, "Change eye colour");
      },
      "Source eye colour",
    );
    const complexion = select(
      "human-complexion",
      drawnComplexions,
      params.complexion ?? "",
      (v) => {
        const { complexion: _previous, ...rest } = params;
        steer(v ? { ...rest, complexion: v } : rest, "Change facial detail");
      },
      "Follow age",
    );
    complexion.disabled = !!cast;
    appearance.querySelector("div")?.replaceChildren(
      field(
        "Skin tone",
        input("human-skin", "color", skinTone(params), (v) =>
          steer(tintSkin(params, v), "Change skin tone"),
        ),
      ),
      restore,
      field("Eye colour", eye),
      field("Facial detail", complexion),
    );
    function rollLook() {
      const decks = variation()?.decks;
      const choice = (name: string) => decks?.find((d) => d.label.toLowerCase() === name)?.value;
      const family = lookDirections.find(
        (v) => v.toLowerCase() === choice("outfit")?.toLowerCase(),
      );
      const look = newHumanLook(params, seed(), family ?? direction);
      const skin = choice("skin");
      return skin && /^#[0-9a-f]{6}$/i.test(skin) ? tintSkin(look, skin) : look;
    }
    const dressed = params.outfit !== undefined && params.outfit !== "Anatomy";
    const style = params.style;
    const fields: HTMLElement[] = [
      button(dressed ? "Show base shape" : "Show current outfit", () =>
        steer(showOutfit(params, !dressed), dressed ? "Show base shape" : "Show current outfit"),
      ),
      field(
        "New looks lean",
        select("human-direction", lookDirections, direction, (v) => {
          direction = lookDirections.find((n) => n === v) ?? "Any";
        }),
      ),
      button("Try a new outfit and hairstyle", () =>
        steer(rollLook(), "Try a new outfit and hairstyle"),
      ),
      field(
        "Character artwork",
        select(
          "human-cast",
          castFigureNames,
          style.cast ?? "",
          (v) =>
            steer(
              chooseAdultStyle(params, v ? { cast: v } : {}, v ? undefined : "cast"),
              "Change character artwork",
            ),
          "Individual styling",
        ),
      ),
    ];
    if (cast) {
      fields.push(
        el("p", {
          className: "muted",
          text: "Character artwork supplies the face, hair and clothing. Choose Individual styling to edit them separately.",
        }),
      );
      const outfits = castOutfits(cast);
      const top = style.castTop ?? outfits[0]?.castTop;
      if (top) {
        fields.push(
          field(
            "Authored top",
            select("human-castTop", [...new Set(outfits.map((o) => o.castTop))], top, (v) =>
              steer(chooseAdultStyle(params, { castTop: v }), "Change authored top"),
            ),
          ),
        );
        fields.push(
          field(
            "Authored bottom",
            select(
              "human-castBottom",
              outfits.filter((o) => o.castTop === top).map((o) => o.castBottom),
              style.castBottom ?? outfits[0]?.castBottom ?? "",
              (v) => steer(chooseAdultStyle(params, { castBottom: v }), "Change authored bottom"),
            ),
          ),
        );
      }
      if (castDonor(cast))
        for (const [key, label] of [
          ["castShape", "Authored face shape"],
          ["castPigment", "Authored face colour"],
        ] as const) {
          fields.push(
            field(
              label,
              input("human-" + key, "range", String(style[key] ?? 0), (v) =>
                steer(chooseAdultStyle(params, { [key]: Number(v) }), "Adjust " + label),
              ),
            ),
          );
        }
    } else {
      for (const key of keys(styleLabels)) {
        const label = styleLabels[key];
        const value = style[key];
        fields.push(
          field(
            label,
            select(
              "human-" + key,
              adultStyleOptions[key],
              key === "outfit" && style.tailor
                ? ""
                : (value ?? (key === "browStyle" ? "As drawn" : "")),
              (v) =>
                steer(
                  chooseAdultStyle(params, v ? { [key]: v } : {}, v ? undefined : key),
                  "Change " + label,
                ),
              key === "outfit" && style.tailor
                ? "Tailored outfit"
                : key === "armInk"
                  ? "None"
                  : key === "browStyle"
                    ? undefined
                    : "As drawn",
            ),
          ),
        );
      }
      const palette = outfitPalette(style);
      const defaults = {
        hairColor: "#45352e",
        clothColor: palette["main"],
        clothAccent: "#dfd0ae",
      };
      for (const key of keys(tones)) {
        const label = tones[key];
        const fallback =
          key === "hairColor" || key === "clothColor" || key === "clothAccent"
            ? defaults[key]
            : palette[toneFields[key]];
        fields.push(
          field(
            label,
            input("human-" + key, "color", style[key] ?? fallback ?? "#6f7f86", (v) =>
              steer(chooseAdultStyle(params, { [key]: v }), "Change " + label),
            ),
          ),
        );
      }
    }
    styling.querySelector("div")?.replaceChildren(...fields);
  }
  return { render };
}
