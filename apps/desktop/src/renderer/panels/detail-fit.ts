import {
  figureEyes,
  figureFaceAnchor,
  figureFibres,
  figureGroom,
  figureHand,
  figureJoin,
  groomPatterns,
  type Part,
  type FigureEyes,
  type Vec3,
} from "@irudd/document";
import { acceptsGuide, viewPart, setDetail, type BuildPart } from "@irudd/character";
import { choices, field } from "./garment-fields.js";
import { seed, type Fields, type Edit } from "./surface-fields.js";

export function fittedDetails(
  section: (title: string) => Fields,
  p: Part,
  b: BuildPart,
  parts: readonly Part[],
  anchor: (face: string, pivot: string) => Vec3,
  eyes: (id: string) => FigureEyes,
  edit: Edit,
) {
  const face = b.piece?.piece === "head" || b.anatomy === "face";
  if (face) {
    const f = section("Movable eyes"),
      old = b.eyes,
      color = f.color("Iris colour", old?.color ?? "#574331");
    const opening = f.numeric("Opening", old?.opening ?? 1, 0.42, 1.8),
      width = f.numeric("Eye width", old?.width ?? 1, 0.62, 1.6),
      spacing = f.numeric("Spacing", old?.spacing ?? 1, 0.7, 1.3);
    const lift = f.numeric("Eye lift", old?.lift ?? 0, -0.1, 0.1, 0.001),
      iris = f.numeric("Iris size", old?.iris ?? 1, 0.55, 1.45);
    const offsets = (["Left", "Right"] as const).map(
      (side, i) =>
        [
          f.numeric(side + " across", old?.offsets?.[i]?.[0] ?? 0, -0.09, 0.09, 0.001),
          f.numeric(side + " up", old?.offsets?.[i]?.[1] ?? 0, -0.09, 0.09, 0.001),
        ] as const,
    );
    f.action("Fit from face paint", () =>
      edit("Trace eyes on face paint", () => [
        setDetail(p, figureEyes.id, figureEyes.json({ ...eyes(p.id), stage: "finish" })),
      ]),
    );
    f.action("Fit eyes", () =>
      edit("Fit movable eyes", () => [
        setDetail(p, figureEyes.id, {
          ...old,
          color: color(),
          opening: opening(),
          width: width(),
          spacing: spacing(),
          lift: lift(),
          iris: iris(),
          offsets: offsets.map(([x, y]) => [x(), y()]),
          source: old?.color === color() && !!old.source,
        }),
      ]),
    );
    f.action(
      "Remove eyes",
      () => edit("Remove movable eyes", () => [setDetail(p, figureEyes.id, null)]),
      !!old,
    );
    const children = parts.filter((q) => q.parent === p.id);
    if (children.length) {
      const rigid = section("Rigid accessories"),
        names = children.map((q) => String(q.id)),
        label = (id: string) => children.find((q) => q.id === id)?.label ?? id;
      const pieces = choices(names, names[0] ?? "", label),
        pivot = choices(names, names[0] ?? "", label);
      pieces.input.multiple = true;
      pieces.input.selectedIndex = 0;
      rigid.rows.append(field("Attach pieces", pieces.input), field("Pivot piece", pivot.input));
      const clearance = rigid.numeric("Face clearance (mm)", 0, 0, 25, 1);
      function mount(release: boolean) {
        const selected = new Set(Array.from(pieces.input.selectedOptions, (o) => o.value));
        if (!selected.size) throw new Error("Select at least one attached piece.");
        const point = release ? undefined : anchor(p.id, pivot.read()),
          gap = clearance() / 1000;
        return children
          .filter((q) => selected.has(q.id))
          .map((q) =>
            setDetail(
              q,
              figureFaceAnchor.id,
              point ? { anchor: point, ...(gap ? { clearance: gap } : {}) } : null,
            ),
          );
      }
      rigid.action("Fit accessory", () => edit("Fit rigid accessory", () => mount(false)));
      rigid.action("Release accessory", () => edit("Release rigid accessory", () => mount(true)));
    }
  }
  if (face || b.wear.role === "head" || b.groom) {
    const f = section("Hair groom"),
      g = b.groom;
    const pattern = f.choose("Hair pattern", groomPatterns, g?.pattern ?? "Locks"),
      color = f.color("Hair colour", g?.color ?? "#45352e");
    const length = f.numeric("Hair length", g?.length ?? 0.46, 0, 2),
      curl = f.numeric("Hair curl", g?.curl ?? 0.18, 0, 1),
      gather = f.numeric("Gather", g?.gather ?? 0, 0, 1),
      sweep = f.numeric("Sweep", g?.sweep ?? 0.24, -1, 1),
      volume = f.numeric("Volume", g?.volume ?? 0.18, 0, 1),
      part = f.numeric("Parting", g?.part ?? 0, -1, 1),
      nape = f.numeric("Nape", g?.nape ?? 0, 0, 1);
    const apply = (roll: boolean) => [
      setDetail(p, figureGroom.id, {
        pattern: pattern(),
        color: color(),
        length: length(),
        curl: curl(),
        gather: gather(),
        sweep: sweep(),
        volume: volume(),
        part: part(),
        nape: nape(),
        seed: roll ? seed() : (g?.seed ?? seed()),
      }),
    ];
    f.action("Apply groom", () => edit("Style hair", () => apply(false)));
    f.action("Reroll groom", () => edit("Reroll groom", () => apply(true)));
    f.action(
      "Remove groom",
      () => edit("Remove groom", () => [setDetail(p, figureGroom.id, null)]),
      !!g,
    );
  }
  const guides = parts.filter(
    (q) => (q.id === p.id || q.parent === p.id) && acceptsGuide(viewPart(q)),
  );
  const firstGuide = guides.find((q) => q.id === p.id) ?? guides[0];
  if (firstGuide) {
    const f = section("Guide strands");
    const list = choices(
      guides.map((q) => String(q.id)),
      String(firstGuide.id),
      (id) => guides.find((q) => q.id === id)?.label ?? id,
    );
    list.input.multiple = true;
    const label = field("Guide curves", list.input);
    const selected = () =>
      guides.filter((q) => Array.from(list.input.selectedOptions, (o) => o.value).includes(q.id));
    function settings() {
      f.rows.replaceChildren(label);
      const g = selected()[0],
        current = g && figureFibres.read(g.features);
      const count = f.numeric("Strand count", current?.count ?? 32, 4, 96, 1),
        wave = f.numeric("Wave", current?.wave ?? 0.28, 0, 1),
        fall = f.numeric("Fall", current?.fall ?? 0.2, 0, 1),
        grey = f.numeric("Grey fraction", current?.grey ?? 0.12, 0, 1),
        rooted = f.check("Root strands", current?.rooted ?? true);
      function apply(roll: boolean) {
        return selected().map((q) => {
          const saved = figureFibres.read(q.features);
          const style =
            roll && saved
              ? saved
              : { count: count(), wave: wave(), fall: fall(), grey: grey(), rooted: rooted() };
          return setDetail(
            q,
            figureFibres.id,
            figureFibres.json({ ...style, seed: roll ? seed() : (saved?.seed ?? seed()) }),
          );
        });
      }
      f.action("Grow strands", () => edit("Grow guide strands", () => apply(false)), !!g);
      f.action("Reroll strands", () => edit("Reroll strands", () => apply(true)), !!g);
      f.action(
        "Restore guide",
        () =>
          edit("Restore guides", () => selected().map((q) => setDetail(q, figureFibres.id, null))),
        !!g,
      );
    }
    list.input.onchange = settings;
    settings();
  }
  if (b.hand) {
    const f = section("Hand"),
      hand = b.hand;
    const fingers = f.numeric("Fingers", hand.fingers ?? 4, 1, 6, 1),
      curl = f.numeric("Finger curl", hand.curl ?? 0.15, 0, 1),
      spread = f.numeric("Finger spread", hand.spread ?? 0.2, 0, 1);
    f.action("Shape hand", () =>
      edit("Shape fingers", () => [
        setDetail(
          p,
          figureHand.id,
          figureHand.json({ ...hand, fingers: fingers(), curl: curl(), spread: spread() }),
        ),
      ]),
    );
  }
  if (p.parent && (b.cage || b.sweep || b.scute)) {
    const f = section("Seat on parent"),
      join = b.join,
      depth = f.numeric("Seat depth (mm)", (join?.depth ?? 0.008) * 1000, 1, 80, 1);
    const end = b.cage
      ? undefined
      : f.choose(
          "Contact end",
          b.scute ? (["base"] as const) : (["first", "last", "both", "along"] as const),
          join?.end ?? (b.scute ? "base" : "first"),
        );
    const patch = b.cage
      ? f.numeric("Cage face", (join?.faces?.[0] ?? 0) + 1, 1, b.cage.faces.length, 1)
      : undefined;
    f.action("Seat surface", () =>
      edit("Seat surface on parent", () => [
        setDetail(p, figureJoin.id, {
          depth: depth() / 1000,
          ...(patch
            ? { faces: [...new Set([...(join?.faces ?? []), patch() - 1])] }
            : { end: end?.() ?? "first" }),
        }),
      ]),
    );
    f.action(
      "Release surface",
      () => edit("Release seated surface", () => [setDetail(p, figureJoin.id, null)]),
      !!join,
    );
  }
}
