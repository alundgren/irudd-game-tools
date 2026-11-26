import {
  addDetail,
  adultWardrobeParams,
  blendable,
  blendParts,
  bodyCoatPart,
  copyDetailBranch,
  removeDetailBranch,
  detailShapes,
  finishPart,
  paintParts,
  viewPart,
} from "@irudd/character";
import {
  creatureSkin,
  finishes,
  markingKinds,
  motionRoles,
  outfitRoles,
  quatFromAxisAngle,
  type Part,
  type FigureEyes,
  type Vec3,
} from "@irudd/document";
import { byId, el } from "../dom.js";
import { failure, type PanelContext } from "./context.js";
import { fittedDetails } from "./detail-fit.js";
import { markControls } from "./face-marks.js";
import { surfaceFields, seed, type Edit } from "./surface-fields.js";

export function mountSurface(
  ctx: PanelContext,
  anchor: (face: string, pivot: string) => Vec3,
  eyes: (id: string) => FigureEyes,
  hand: (p: Part) => readonly object[],
) {
  const panel = byId("surface-editor", HTMLDetailsElement),
    body = panel.querySelector("div");
  const opened = new Set<string>();
  const cached = new WeakMap<Part, ReturnType<typeof viewPart>>();
  function detail(q: Part) {
    const last = cached.get(q);
    if (last) return last;
    const item = viewPart(q);
    cached.set(q, item);
    return item;
  }
  let markIndex = 0,
    lastDoc = "";
  function render() {
    const { doc, view } = ctx;
    panel.hidden = !doc;
    if (!doc || !view || !body || !panel.open) return;
    if (lastDoc !== doc.id) {
      lastDoc = doc.id;
      markIndex = 0;
    }
    const base = { documentId: doc.id, revision: view.revision };
    const p = doc.parts.find((q) => q.id === ctx.selection);
    body.replaceChildren();
    const section = (name: string) => {
      const f = surfaceFields(name, opened);
      body.append(f.box);
      return f;
    };
    const edit: Edit = (summary, make, select) => {
      try {
        const ops = make();
        if (!ops.length) throw new Error("Select a surface first.");
        panel.inert = true;
        void ctx
          .commit({ type: "edit", summary, ops }, summary, base)
          .then((ok) => {
            if (ok && select) ctx.selectPart(select());
          })
          .finally(() => {
            panel.inert = false;
          });
      } catch (err) {
        ctx.showBanner("error", failure(err));
      }
    };
    const adult = adultWardrobeParams(doc);
    if (adult)
      markControls(
        section("Face marks"),
        adult,
        markIndex,
        (i) => {
          markIndex = i;
          render();
        },
        edit,
      );
    const parts = section("Build parts"),
      kind = parts.choose("New part shape", detailShapes, "ellipsoid");
    let next: string | null = null;
    parts.action("Add part", () =>
      edit(
        "Add " + kind(),
        () => {
          const q = addDetail(p, kind());
          next = q.id;
          return [{ op: "part.add", part: q }];
        },
        () => next,
      ),
    );
    if (p) {
      const n = section("Shape nudge"),
        op = n.choose(
          "Operation",
          ["Size (%)", "Move (cm)", "Turn (degrees)"] as const,
          "Size (%)",
        ),
        axis = n.choose("Axis", ["X", "Y", "Z"] as const, "X"),
        amount = n.numeric("Amount", 10, -360, 360, 0.1);
      n.action("Apply shape nudge", () =>
        edit("Nudge " + p.label, () => {
          const axes = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] } as const;
          const unit = axes[axis()],
            v = amount();
          if (op() === "Size (%)" && v <= -100) throw new Error("Size must stay above zero.");
          const change =
            op() === "Size (%)"
              ? { scale: unit.map((x) => 1 + (x * v) / 100) }
              : op() === "Move (cm)"
                ? { translate: unit.map((x) => (x * v) / 100) }
                : { rotate: quatFromAxisAngle(unit, (v * Math.PI) / 180) };
          return [{ op: "part.transform", part: p.id, ...change }];
        }),
      );
    }
    const native = (q: Part) => !!adult && !!q.slot;
    if (p && !native(p)) {
      for (const mirror of [false, true]) {
        const label = mirror ? "Mirror branch" : "Duplicate branch";
        parts.action(label, () =>
          edit(
            label,
            () => {
              const copies = copyDetailBranch(doc, p, mirror);
              next = copies[0]?.id ?? null;
              return copies.map((part) => ({ op: "part.add", part }));
            },
            () => next,
          ),
        );
      }
      parts.action(
        "Remove branch",
        () =>
          edit(
            "Remove " + p.label,
            () => removeDetailBranch(doc, p),
            () => p.parent,
          ),
        doc.parts.some((q) => q.id !== p.id && q.parent === null) || p.parent !== null,
      );
    }
    if (p && native(p)) {
      body.append(
        el("p", {
          className: "muted",
          text: "Use Appearance and Face marks for the adult body. Attach a part to edit its surface.",
        }),
      );
      return;
    }
    const eligible = doc.parts.filter((q) => !native(q));
    const b = p && detail(p);
    if (p && b) {
      const f = section("Material and roles"),
        colour = f.color("Part colour", p.color),
        finish = f.choose("Surface finish", finishes, b.finish),
        region = f.choose("Clothing region", ["", ...outfitRoles], b.wear.role ?? ""),
        movement = f.choose("Movement role", ["", ...motionRoles], b.motion ?? "");
      f.action("Apply material", () =>
        edit("Set material and roles", () =>
          finishPart(p, colour(), finish(), region(), movement()),
        ),
      );
      if (b.sweep && b.wear.role === "hand" && !b.hand)
        section("Hand").action("Fit palm and fingers", () => edit("Fit hand", () => hand(p)));
      fittedDetails(section, p, b, doc.parts, anchor, eyes, edit);
    }
    const bodyParts = eligible.filter((q) => bodyCoatPart(detail(q)));
    const joined = eligible.filter((q) => detail(q).blend);
    if ((!b && eligible.length) || (b && !b.piece && !b.mantle && !b.wing)) {
      const f = section("Surface markings"),
        m = b?.markings;
      const kind = f.choose("Marking pattern", markingKinds, m?.kind ?? "Bands"),
        color = f.color("Marking colour", m?.color ?? "#573c38"),
        spacing = f.numeric("Mark spacing", m?.spacing ?? 0.2, 0.06, 0.8),
        coverage = f.numeric("Coverage", m?.coverage ?? 0.5, 0.1, 0.9),
        angle = f.numeric("Mark angle", m?.angle ?? 0, -180, 180, 1);
      const targets = () => (p ? [p] : bodyParts);
      function paint(roll: boolean) {
        return paintParts(targets(), {
          kind: kind(),
          color: color(),
          spacing: spacing(),
          coverage: coverage(),
          angle: angle(),
          seed: roll ? seed() : (m?.seed ?? seed()),
        });
      }
      f.action("Apply markings", () => edit("Paint surface markings", () => paint(false)));
      f.action("Redraw markings", () => edit("Redraw markings", () => paint(true)));
      f.action("Clear markings", () =>
        edit("Clear surface markings", () => paintParts(targets(), null)),
      );
    }
    if (eligible.length) {
      const f = section("Shared skin"),
        skin = creatureSkin.read(doc.features);
      const tint = f.color("Skin tint", skin?.tint ?? p?.color ?? "#b08566"),
        soft = f.numeric("Blend softness (mm)", (skin?.softness ?? 0.015) * 1000, 5, 45, 1),
        surface = f.choose("Skin texture", ["plain", "scales"] as const, skin?.surface ?? "plain");
      function appearance() {
        return {
          op: "feature.set",
          feature: creatureSkin.id,
          value: creatureSkin.json({ tint: tint(), softness: soft() / 1000, surface: surface() }),
        };
      }
      f.action(
        "Join body surfaces",
        () =>
          edit("Join organic body surfaces", () => [
            ...blendParts(bodyParts, true, joined),
            appearance(),
          ]),
        bodyParts.length >= 2,
      );
      if (p && b && blendable(b))
        f.action(b.blend ? "Leave shared skin" : "Join shared skin", () =>
          edit("Change shared skin membership", () => [
            ...blendParts([p], !b.blend, joined),
            appearance(),
          ]),
        );
      f.action(
        "Apply skin appearance",
        () => edit("Adjust shared skin", () => [appearance()]),
        joined.length > 0,
      );
      f.action(
        "Separate surfaces",
        () => edit("Separate organic surfaces", () => blendParts(joined, false)),
        joined.length > 0,
      );
    }
  }
  panel.ontoggle = () => {
    if (panel.open) render();
  };
  return { render };
}
