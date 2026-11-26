import {
  colourRanges,
  creatureScopes,
  currentCreature,
  generatedCreature,
  creatureEdits,
  drawCoat,
  limbGroup,
  mountWings,
  randomCreature,
  shuffleCreature,
  type Scope,
} from "@irudd/character/creature";
import { humanAdultId } from "@irudd/character/human";
import {
  dressKinds,
  dressDevices,
  equipmentKinds,
  backKinds,
  backGrowths,
  eyePlaces,
  earShapes,
  muzzleProfiles,
  billProfiles,
  coatFamilies,
  faceMarkings,
  flankMarkings,
  creatureFamilies,
  creatureDetails,
  creatureProfiles,
  headShapes,
  wingSurfaceStructures,
  tailKinds,
  crests,
  snouts,
  markingKinds,
  type CreaturePlan,
  type Vec3,
} from "@irudd/document";
import type { Direction } from "../direction.js";
import { byId } from "../dom.js";
import { failure, type PanelContext } from "./context.js";
import { surfaceFields, seed } from "./surface-fields.js";
import { limbFields } from "./creature-limbs.js";
import { planHandles } from "./creature-handles.js";

export function mountCreature(
  ctx: PanelContext,
  direction: () => Direction | undefined,
  project: (p: Vec3) => readonly [number, number],
  fromPlan: (plan: CreaturePlan, label: string) => Promise<void>,
) {
  const panel = byId("creature-editor", HTMLDetailsElement),
    body = panel.querySelector("div"),
    handles = planHandles(project);
  const open = new Set(["Shuffle", "Adult wings"]);
  let selected = 0,
    scope: Scope = "Whole creature",
    drag = false,
    last = "";
  function render() {
    handles.show();
    const { doc, view, humanBody } = ctx;
    const p = doc && currentCreature(doc),
      adult = doc?.generation?.generator === humanAdultId;
    panel.hidden = !p && !adult;
    if (!doc || !view || !body || !panel.open || panel.hidden) return;
    if (last !== doc.id) {
      last = doc.id;
      selected = 0;
      drag = false;
    }
    body.replaceChildren();
    const section = (name: string) => {
      const fields = surfaceFields(name, open);
      body.append(fields.box);
      return {
        ...fields,
        action: (name: string, run: () => void, enabled = true) =>
          fields.action(
            name,
            () => {
              try {
                run();
              } catch (error) {
                ctx.showBanner("error", failure(error));
              }
            },
            enabled,
          ),
      };
    };
    const base = { documentId: doc.id, revision: view.revision };
    const edit = (summary: string, fn: () => readonly object[]) => {
      try {
        const ops = fn();
        panel.inert = true;
        void ctx.commit({ type: "edit", ops, summary }, summary, base).finally(() => {
          panel.inert = false;
        });
      } catch (error) {
        ctx.showBanner("error", failure(error));
      }
    };
    if (adult && humanBody) {
      const wing = section("Adult wings"),
        structure = wing.choose("Wing structure", wingSurfaceStructures, "feather"),
        span = wing.numeric("Wing length", 0.86, 0.18, 2),
        color = wing.color("Wing colour", "#537d81");
      wing.action("Mount paired wings", () =>
        edit("Mount paired wings", () =>
          mountWings(doc, humanBody, structure(), span(), color(), seed()),
        ),
      );
      return;
    }
    if (!p) return;
    const generated = generatedCreature(doc);
    const apply = (next: CreaturePlan, summary: string) =>
      edit(summary, () => creatureEdits(doc, p, next));
    if (generated) {
      const s = section("Shuffle"),
        which = s.choose("Shuffle scope", creatureScopes, scope);
      s.action("Shuffle region", () => {
        scope = which();
        apply(shuffleCreature(p, scope, seed(), direction()), "Shuffle " + scope.toLowerCase());
      });
      const form = section("Body plan");
      const family = form.choose("Family", creatureFamilies, p.family ?? "wild"),
        colours = form.choose("Colour range", colourRanges, "Mixed");
      form.action("Draw family", () =>
        apply(randomCreature(seed(), family(), colours()), "Draw " + family()),
      );
      const profile = form.choose("Spine outline", creatureProfiles, p.spine.profile),
        len = form.numeric("Body length", p.spine.length, 0.2, 3),
        girth = form.numeric("Thickness", p.spine.girth, 0.04, 0.8),
        stance = form.numeric("Ride height", p.spine.stance, 0.05, 3),
        flat = form.numeric("Width to depth", p.spine.flat, 0.5, 2.2),
        rear = form.numeric("Hip tilt", p.spine.rear, -30, 90),
        arch = form.numeric("Back arch", p.spine.arch, -40, 40),
        tilt = form.numeric("Chest tilt", p.spine.front, -45, 100);
      form.action("Apply spine", () =>
        apply(
          {
            ...p,
            spine: {
              ...p.spine,
              profile: profile(),
              length: len(),
              girth: girth(),
              flat: flat(),
              rear: rear(),
              arch: arch(),
              stance: stance(),
              front: tilt(),
            },
          },
          "Edit creature spine",
        ),
      );
      form.action(drag ? "Hide drag handles" : "Show drag handles", () => {
        drag = !drag;
        render();
      });
      if (drag) handles.show(p, apply);
      const face = section("Head and tail"),
        shape = face.choose("Skull", headShapes, p.head.shape),
        snout = face.choose("Mouth parts", snouts, p.head.snout),
        crest = face.choose("Crest", crests, p.head.crest),
        heads = face.numeric("Heads", p.head.count, 0, 3, 1),
        hsize = face.numeric("Head size", p.head.size, 0.4, 3),
        neck = face.numeric("Neck length", p.head.neck, 0.02, 2),
        pitch = face.numeric("Neck tilt", p.head.neckPitch, -40, 100),
        mouth = face.numeric("Mouth length", p.head.snoutLength, 0.3, 4),
        crestSize = face.numeric("Crest size", p.head.crestSize, 0.3, 3),
        eyes = face.numeric("Eyes", p.head.eyes, 0, 8, 1),
        neckGirth = face.numeric("Neck thickness", p.head.neckGirth, 0.3, 2),
        eyeSize = face.numeric("Eye size", p.head.eyeSize, 0.4, 3),
        eyePlace = face.choose("Eye position", eyePlaces, p.head.eyePlace),
        stalks = face.numeric("Eye stalks", p.head.stalks, 0, 0.6),
        lids = face.numeric("Eyelids", p.head.lids, 0, 1),
        brow = face.numeric("Brow ridge", p.head.brow, 0, 1),
        jaw = face.numeric("Jaw gape", p.head.jaw, 0, 1),
        teeth = face.numeric("Teeth each side", p.head.teeth, 0, 6, 1),
        nostrils = face.check("Nostrils", p.head.nostrils),
        whiskers = face.check("Whiskers", p.head.whiskers),
        ear = face.choose("Ear shape", earShapes, p.head.ear ?? "lance"),
        bill = face.choose("Bill profile", billProfiles, p.head.billProfile ?? "spear"),
        muzzle = face.choose("Muzzle profile", muzzleProfiles, p.head.muzzleProfile ?? "canine"),
        turn = face.numeric("Head turn", p.head.turn ?? 0, -50, 50, 1),
        girthTail = face.numeric("Tail thickness", p.tail.girth, 0.3, 2.5),
        lift = face.numeric("Tail lift", p.tail.lift, -60, 120),
        sway = face.numeric("Tail sway", p.tail.sway ?? 0, -90, 90),
        tail = face.choose("Tail", tailKinds, p.tail.kind),
        length = face.numeric("Tail length", p.tail.length, 0.05, 3);
      face.action("Apply head and tail", () => {
        const angle = turn(),
          swing = sway(),
          mouthKind = snout();
        apply(
          {
            ...p,
            head: {
              mouth: p.head.mouth,
              neckGirth: neckGirth(),
              eyeSize: eyeSize(),
              eyePlace: eyePlace(),
              stalks: stalks(),
              lids: lids(),
              brow: brow(),
              jaw: jaw(),
              teeth: teeth(),
              nostrils: nostrils(),
              whiskers: whiskers(),
              ...(angle ? { turn: angle } : {}),
              ...(crest() === "ears" ? { ear: ear() } : {}),
              ...(mouthKind === "bill" || mouthKind === "beak" ? { billProfile: bill() } : {}),
              ...(mouthKind === "muzzle" ? { muzzleProfile: muzzle() } : {}),
              count: heads(),
              neck: neck(),
              neckPitch: pitch(),
              snoutLength: mouth(),
              crestSize: crestSize(),
              shape: shape(),
              size: hsize(),
              snout: snout(),
              crest: crest(),
              eyes: eyes(),
            },
            tail: {
              kind: tail(),
              length: length(),
              girth: girthTail(),
              lift: lift(),
              ...(swing ? { sway: swing } : {}),
            },
          },
          "Edit creature head and tail",
        );
      });
      const dorsal = section("Back"),
        backKind = dorsal.choose("Back growth", backKinds, p.back.kind),
        spread = dorsal.numeric("Growth spread", p.back.spread ?? 0.6, 0, 1),
        backCount = dorsal.numeric("Growth count", p.back.count, 1, 12, 1),
        backHeight = dorsal.numeric("Growth height", p.back.height, 0.02, 1);
      const detailFields = creatureDetails.map((name) => ({
        name,
        read: dorsal.check(name, p.details.includes(name)),
      }));
      dorsal.action("Apply back", () =>
        apply(
          {
            ...p,
            details: detailFields.filter((f) => f.read()).map((f) => f.name),
            back: {
              kind: backKind(),
              count: Math.max(backKind() === "shingles" ? 2 : 1, backCount()),
              height: backHeight(),
              ...(backGrowths.some((k) => k === backKind())
                ? { spread: spread(), seed: p.back.seed ?? seed() }
                : {}),
            },
          },
          "Edit creature back",
        ),
      );
      const equipment = section("Equipment"),
        kit = p.equipment;
      const bag = equipment.choose("Carried equipment", equipmentKinds, kit?.kind ?? "none"),
        station = equipment.numeric("Pack station", kit?.station ?? 0.54, 0.14, 0.85),
        hang = equipment.numeric("Pack hang", kit?.hang ?? -0.35, -1.42, 0.85),
        load = equipment.numeric("Load size", kit?.size ?? 1, 0.55, 1.45),
        side = equipment.choose("Bag side", ["left", "right"] as const, kit?.side ?? "left"),
        mount = equipment.choose("Pack mount", ["flank", "back"] as const, kit?.mount ?? "flank"),
        leather = equipment.color("Bag colour", kit?.color ?? p.skin.accent);
      equipment.action("Apply equipment", () => {
        const { equipment: old, ...plan } = p;
        const kind = bag();
        apply(
          kind === "none"
            ? plan
            : {
                ...p,
                equipment: {
                  kind,
                  station: station(),
                  hang: hang(),
                  size: load(),
                  side: side(),
                  mount: mount(),
                  color: leather(),
                  seed: old?.seed ?? seed(),
                },
              },
          "Fit creature equipment",
        );
      });
      const clothes = section("Worn layers"),
        dress = p.dress;
      const outfit = clothes.choose(
          "Outfit",
          ["none", ...dressKinds] as const,
          dress?.kind ?? "none",
        ),
        device = clothes.choose(
          "Badge",
          ["none", ...dressDevices] as const,
          dress?.device ?? "none",
        ),
        fabric = clothes.color("Cloth", dress?.color ?? p.skin.accent),
        trim = clothes.color("Trim", dress?.trim ?? p.skin.pale),
        layers = clothes.numeric("Layer count", dress?.layers ?? 1, 1, 3, 1),
        cut = clothes.numeric("Cut size", dress?.size ?? 1, 0.7, 1.4);
      clothes.action("Apply worn layers", () => {
        const { dress: old, ...plan } = p;
        const kind = outfit(),
          badge = device();
        apply(
          kind === "none"
            ? plan
            : {
                ...p,
                dress: {
                  kind,
                  ...(badge === "none" ? {} : { device: badge }),
                  layers: layers(),
                  color: fabric(),
                  trim: trim(),
                  size: cut(),
                  seed: old?.seed ?? seed(),
                },
              },
          "Fit creature clothing",
        );
      });
      const limbs = section("Limb groups"),
        kinds = ["leg", "arm", "wing", "fin", "tentacle"] as const;
      const newKind = limbs.choose("New limb kind", kinds, "leg");
      limbs.action(
        "Add limb group",
        () => {
          selected = p.limbs.length;
          apply(
            { ...p, limbs: [...p.limbs, limbGroup(newKind(), seed())] },
            "Add " + newKind() + " group",
          );
        },
        p.limbs.length < 8,
      );
      selected = Math.min(selected, Math.max(0, p.limbs.length - 1));
      const l = p.limbs[selected];
      if (l) {
        const names = p.limbs.map((v, i) => i + 1 + ". " + v.kind);
        const group = limbs.choose("Limb group", names, names[selected] ?? "");
        const control = limbs.rows.querySelector<HTMLSelectElement>(
          'select[aria-label="Limb group"]',
        );
        if (control)
          control.onchange = () => {
            selected = names.indexOf(group());
            render();
          };
        const read = limbFields(limbs, l);
        limbs.action("Apply limbs", () => {
          const next = read();
          apply(
            { ...p, limbs: p.limbs.map((item, i) => (i === selected ? next : item)) },
            "Edit " + l.kind + " group",
          );
        });
        limbs.action("Remove limb group", () =>
          apply(
            { ...p, limbs: p.limbs.filter((_, i) => i !== selected) },
            "Remove " + l.kind + " group",
          ),
        );
      }
    }
    if (!generated) {
      const form = section("Body plan");
      form.action(
        "Start editable copy from this plan",
        () => void fromPlan(p, doc.label + " variation"),
      );
    }
    const coat = section("Colours and coat"),
      skin = p.skin,
      old = skin.coat ?? drawCoat(p, 1);
    const baseColour = coat.color("Hide", skin.base),
      accent = coat.color("Accent", skin.accent),
      pale = coat.color("Claws and teeth", skin.pale),
      eye = coat.color("Iris", skin.eye);
    const belly = coat.numeric("Pale underside", skin.belly, 0, 1),
      socks = coat.numeric("Dark limb ends", skin.socks, 0, 1),
      fade = coat.check("Blend limb tips", Boolean(skin.limbFade)),
      surface = coat.choose("Hide texture", ["plain", "scales"] as const, skin.surface);
    const family = coat.choose(
        "Coat family",
        ["none", ...coatFamilies] as const,
        skin.coat?.family ?? "none",
      ),
      density = coat.numeric("Coat density", old.density, 0.55, 1.8),
      contrast = coat.numeric("Coat contrast", old.contrast, 0, 1);
    const mark = skin.markings,
      pattern = coat.choose("Markings", ["none", ...markingKinds] as const, mark?.kind ?? "none"),
      ink = coat.color("Marking colour", mark?.color ?? skin.accent),
      coverage = coat.numeric("Coverage", mark?.coverage ?? 0.4, 0.1, 0.9),
      spacing = coat.numeric("Spacing", mark?.spacing ?? 0.18, 0.06, 0.8);
    const faceMark = coat.choose(
        "Face marking",
        ["none", ...faceMarkings] as const,
        skin.faceMarking ?? "none",
      ),
      flankMark = coat.choose(
        "Flank marking",
        ["none", ...flankMarkings] as const,
        skin.flankMarking ?? "none",
      ),
      angle = coat.numeric("Marking angle", mark?.angle ?? 0, -180, 180);
    coat.action("Apply coat and colours", () => {
      const { coat: previous, faceMarking, flankMarking, limbFade, ...rest } = skin;
      const face = faceMark(),
        flank = flankMark();
      const f = family(),
        kind = pattern();
      apply(
        {
          ...p,
          skin: {
            ...rest,
            ...(face === "none" ? {} : { faceMarking: face === faceMarking ? faceMarking : face }),
            ...(flank === "none"
              ? {}
              : { flankMarking: flank === flankMarking ? flankMarking : flank }),
            belly: belly(),
            socks: socks(),
            ...(fade() ? { limbFade: limbFade ?? true } : {}),
            surface: surface(),
            base: baseColour(),
            accent: accent(),
            pale: pale(),
            eye: eye(),
            ...(f === "none"
              ? {}
              : {
                  coat: {
                    ...(previous ?? old),
                    family: f,
                    density: density(),
                    contrast: contrast(),
                  },
                }),
            markings:
              kind === "none"
                ? null
                : {
                    kind,
                    color: ink(),
                    coverage: coverage(),
                    spacing: spacing(),
                    angle: angle(),
                    seed: mark?.seed ?? seed(),
                  },
          },
        },
        "Edit creature coat and colours",
      );
    });
    coat.action("Generate coat", () =>
      apply(shuffleCreature(p, "Coat", seed(), direction()), "Generate creature coat"),
    );
  }
  panel.ontoggle = render;
  return { render, place: handles.place };
}
