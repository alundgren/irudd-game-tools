import { changePlateTip, growPlateField, plateDefaults, repeatedPlates } from "@irudd/character";
import {
  figurePlateField,
  figurePlateSite,
  figureSweep,
  plateFaces,
  type Part,
  type CharacterDocument,
  type PlateField,
} from "@irudd/document";
import { seed, type Fields, type Edit } from "./surface-fields.js";

export function spinePlates(
  doc: CharacterDocument,
  selected: Part,
  section: (title: string) => Fields,
  edit: Edit,
) {
  const site = figurePlateSite.read(selected.features),
    carrier = site ? doc.parts.find((p) => p.id === selected.parent) : selected;
  if (!carrier || !figureSweep.read(carrier.features)) return;
  const f = section("Spine plates"),
    existing = figurePlateField.read(carrier.features),
    s = existing ?? plateDefaults;
  const rows = f.numeric("Field rows", s.rows, 2, 12, 1),
    columns = f.choose("Field columns", ["1", "3", "5", "7"] as const, String(s.columns)),
    face = f.choose("Field face", plateFaces, s.face),
    direction = f.choose("Tips point toward", ["first", "last"] as const, s.direction),
    color = f.color("Field colour", s.color),
    start = f.numeric("Start along spine", s.start, 0, 0.96),
    end = f.numeric("End along spine", s.end, 0.04, 1),
    wrap = f.numeric("Wrap (degrees)", s.wrap, 20, 165),
    overlap = f.numeric("Plate overlap", s.overlap, 0, 0.8),
    crest = f.numeric("Crest height", s.crest, 0, 1),
    rise = f.numeric("Plate relief", s.rise ?? 1, 0.5, 3);
  const apply = (label: string, patch: () => Partial<PlateField>) =>
    f.action(label, () => edit(label, () => growPlateField(doc, carrier, patch())));
  apply(existing ? "Update plate field" : "Grow plate field", () => {
    const settings = {
      rows: rows(),
      columns: ([1, 3, 5, 7] as const).find((n) => String(n) === columns()) ?? 3,
      face: face(),
      direction: direction(),
      color: color(),
      start: start(),
      end: end(),
      wrap: wrap(),
      overlap: overlap(),
      crest: crest(),
      rise: rise(),
    };
    return existing
      ? Object.fromEntries(
          Object.entries(settings).filter(([k, v]) => Reflect.get(existing, k) !== v),
        )
      : { ...settings, seed: seed(), tipSeed: seed() };
  });
  if (existing) {
    apply("Refit to spine", () => ({}));
    apply("Reroll field tips", () => ({ tipSeed: seed() }));
    apply("Reroll layout", () => ({ seed: seed() }));
    if (site) {
      f.action("Reroll this tip and pin it", () =>
        edit("Reroll individual tip", () => changePlateTip(doc, selected, seed())),
      );
      f.action(
        "Unpin this tip",
        () => edit("Unpin individual tip", () => changePlateTip(doc, selected, null)),
        site.tipSeed !== undefined,
      );
    }
  }
  if (site) return;
  const count = f.numeric("Plate rows", 5, 1, 16, 1),
    across = f.numeric("Plate columns", 1, 1, 7, 1),
    side = f.choose("Plate face", plateFaces, "Back"),
    width = f.numeric("Repeated plate width (cm)", 12, 1, 100),
    outfit = f.check("Wear plates only with this outfit", false),
    armour = f.color("Armour colour", "#d4c6a7");
  f.action("Repeat plates", () => {
    let first: string | null = null;
    edit(
      "Repeat plates",
      () => {
        const parts = repeatedPlates(
          doc,
          carrier,
          count(),
          across(),
          side(),
          width() / 100,
          outfit(),
          armour(),
        );
        first = parts[0]?.id ?? null;
        return parts.map((part) => ({ op: "part.add", part }));
      },
      () => first,
    );
  });
}
