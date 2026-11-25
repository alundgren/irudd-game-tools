import {coatFamilies,readCreatureCoat,drawCreatureCoat} from "./creature-coat.js";
import {
  buildCreature,
  creatureOptions,
  creaturePresets,
  drawCreatureEquipment,
  drawCreatureDress,
  randomCreaturePlan,
  readCreaturePlan,
  rebuildCreature,
  suggestWingStructure,
} from "./creature-plan.js";
import { wingCounts } from "./wing-surface.js";
import { dispatchHand } from "./dispatch-pose.js";
import { readEquipment } from "./creature-equipment.js";
import { readDress } from "./creature-dress.js";
import { growthFamilies } from "./creature-growth.js";

// The body plan panel. Every control edits the plan stored on the form and
// rebuilds the creature as one undoable step.
const make = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};
const title = (text) => text[0].toUpperCase() + text.slice(1);
const o = creatureOptions;

// [key, label, least, most, step] is a slider, [key, label, options] a list,
// [key, label, "color"] a colour and [key, label, "check"] a switch.
const fields = {
  spine: [
    ["length", "Body length", 0.2, 3, 0.01],
    ["girth", "Thickness", 0.04, 0.8, 0.005],
    ["flat", "Width to depth", 0.5, 2.2, 0.01],
    ["profile", "Outline", o.profile],
    ["rear", "Hip end tilt °", -30, 90, 1],
    ["front", "Chest end tilt °", -45, 100, 1],
    ["arch", "Back arch °", -40, 40, 1],
    ["stance", "Ride height", 0.05, 3, 0.01],
  ],
  head: [
    ["count", "Heads", 0, 3, 1],
    ["neck", "Neck length", 0.02, 2, 0.01],
    ["neckPitch", "Neck tilt °", -40, 100, 1],
    ["neckGirth", "Neck thickness", 0.3, 2, 0.01],
    ["size", "Head size", 0.4, 3, 0.01],
    ["shape", "Skull", o.headShape],
    ["snout", "Mouth parts", o.snout],
    ["billProfile", "Bill profile", o.billProfile],
    ["muzzleProfile", "Muzzle profile", o.muzzleProfile],
    ["snoutLength", "Mouth part length", 0.3, 4, 0.01],
    ["jaw", "Jaw gape", 0, 1, 0.01],
    ["teeth", "Teeth each side", 0, 6, 1],
    ["nostrils", "Nostrils", "check"],
    ["eyes", "Eyes", 0, 8, 1],
    ["eyeSize", "Eye size", 0.4, 3, 0.01],
    ["eyePlace", "Eye position", o.eyePlace],
    ["stalks", "Eye stalks", 0, 0.6, 0.01],
    ["lids", "Eyelids", 0, 1, 0.01],
    ["brow", "Brow ridge", 0, 1, 0.01],
    ["crest", "Crest", o.crest],
    ["crestSize", "Crest size", 0.3, 3, 0.01],
    ["ear", "Ear shape", o.ear],
    ["whiskers", "Whiskers", "check"],
    ["turn", "Looks to its left °", -50, 50, 1, 0],
  ],
  tail: [
    ["kind", "Tail", o.tail],
    ["length", "Tail length", 0.05, 3, 0.01],
    ["girth", "Tail thickness", 0.3, 2.5, 0.01],
    ["lift", "Tail lift °", -60, 120, 1],
    ["sway", "Tail sway °", -90, 90, 1, 0],
  ],
  dress: [
    ["kind", "Worn layers", o.dress],
    ["device", "Embroidered badge", o.dressDevice],
    ["color", "Cloth", "color"],
    ["trim", "Trim and metal", "color"],
    ["layers", "Layers", 1, 3, 1],
    ["size", "Cut", 0.7, 1.4, 0.01],
  ],
  equipment: [
    ["kind","Carried equipment",o.equipment],["station","Along spine",.14,.85,.01],
    ["hang","Hang down flank",-1.42,.85,.01],["size","Load size",.55,1.45,.01],["side","Main bag side",["left","right"]],["mount","Pack faces",["flank","back"]],["color","Bag colour","color"],
  ],
  back: [
    ["kind", "Along the back", o.back],
    ["count", "Count", 1, 12, 1],
    ["height", "Height", 0.02, 1, 0.01],
  ],
  skin: [
    ["base", "Hide", "color"],
    ["accent", "Accent", "color"],
    ["pale", "Claws and teeth", "color"],
    ["eye", "Iris", "color"],
    ["belly", "Pale underside", 0, 1, 0.01],
    ["socks", "Dark limb ends", 0, 1, 0.01],
    ["limbFade","Blend limb tips","check"],
    ["surface", "Texture", o.surface],
    ["blend", "Join limbs into one skin", "check"],
  ],
  markings: [
    ["color", "Marking colour", "color"],
    ["spacing", "Spacing", 0.06, 0.8, 0.01],
    ["coverage", "Coverage", 0.1, 0.9, 0.01],
    ["angle", "Angle °", -180, 180, 1],
  ],
};
const placing = [
  ["pairs", "Pairs", 1, 6, 1],
  ["side", "Sides", o.side],
  ["from", "First at (0 hips, 1 chest)", 0, 1, 0.01],
  ["to", "Last at", 0, 1, 0.01],
  ["girth", "Thickness", 0.3, 3, 0.01],
];
const muscle = ["muscle", "Muscle", 0, 1.6, 0.01];
const limbFields = {
  leg: [
    ...placing,
    muscle,
    ["style", "Joints", o.legStyle],
    ["sockets", "Thoracic leg shields", "check"],
    ["splay", "Sprawl °", 0, 78, 1],
    ["fan", "Fan around body °", 0, 240, 1],
    ["end", "Foot", o.legEnd],
    ["digits", "Toes", 0, 5, 1],
  ],
  arm: [
    ...placing,
    muscle,
    ["length", "Arm length", 0.08, 3, 0.01],
    ["drop", "Hang °", -80, 90, 1],
    ["forward", "Reach forward °", -80, 90, 1],
    ["elbow", "Elbow bend °", 0, 150, 1],
    ["end", "Ends in", o.armEnd],
    ["digits", "Fingers", 1, 6, 1],
    ["hand", "Hand size", 0.4, 3, 0.01],
    ["raise", "Left hand lifts °", -80, 80, 1, 0],
  ],
  wing: [
    ...placing,
    ["length", "Wing length", 0.1, 4, 0.01],
    ["rise", "Rise °", -30, 85, 1],
    ["sweep", "Sweep back °", -40, 70, 1],
    ["chord", "Depth", 0.03, 1.5, 0.01],
    ["structure", "Built as", o.wingStructure],
  ],
  fin: [
    ...placing,
    ["length", "Fin length", 0.05, 2, 0.01],
    ["sweep", "Sweep back °", -40, 80, 1],
    ["chord", "Depth", 0.03, 1, 0.01],
  ],
  tentacle: [
    ...placing,
    ["length", "Tentacle length", 0.1, 3, 0.01],
    ["droop", "Droop °", -60, 90, 1],
    ["forward", "Reach forward °", -80, 90, 1],
    ["fan", "Fan around body °", 0, 240, 1],
    ["curl", "Tip curl", -1, 1, 0.01],
  ],
};
// What a structured wing adds, named for the anatomy it changes.
const wingFields = {
  bat: [
    ["ribs", "Fingers", ...wingCounts.bat, 1],
    ["bend", "Arm fold", 0, 1, 0.01],
    ["notch", "Scallop depth", 0, 1, 0.01],
    ["point", "Pointed tip", 0, 1, 0.01],
  ],
  feather: [
    ["ribs", "Primary feathers", ...wingCounts.feather, 1],
    ["bend", "Arm fold", 0, 1, 0.01],
    ["notch", "Slotted tips", 0, 1, 0.01],
    ["point", "Pointed tip", 0, 1, 0.01],
  ],
  insect: [
    ["ribs", "Main veins", ...wingCounts.insect, 1],
    ["notch", "Lobed margin", 0, 1, 0.01],
    ["point", "Narrow tip", 0, 1, 0.01],
  ],
};
const wingFinish = [
  ["pattern", "Wing pattern", o.wingPattern],
  ["seed", "Variation", 0, 999, 1],
];
const fieldsOf = (limb) =>
  limb.kind === "wing" && wingFields[limb.structure]
    ? [...limbFields.wing, ...wingFields[limb.structure], ...wingFinish]
    : limbFields[limb.kind];
const plural = { leg: "legs", arm: "arms", wing: "wings", fin: "fins", tentacle: "tentacles" };
const starters = {
  leg: { kind: "leg", pairs: 1, from: 0.2 },
  arm: { kind: "arm", pairs: 1, from: 0.84 },
  wing: { kind: "wing", pairs: 1, from: 0.68 },
  fin: { kind: "fin", pairs: 1, from: 0.5 },
  tentacle: { kind: "tentacle", pairs: 1, from: 0.8 },
};
const scopes = {
  "Whole creature": ["anatomyRevision", "family", "scale", "spine", "head", "limbs", "tail", "back", "details", "dress", "equipment", "skin"],
  "Posture and limbs": ["spine", "limbs"],
  "Head": ["head"],
  "Tail, back and details": ["tail", "back", "details"],
  "Equipment": ["equipment"],
  "Worn layers": ["dress"],
  "Colours and markings": ["skin"],
};

export function creatureEditor(read, commit, frame, handles) {
  const wrap = document.getElementById("creature-plan");
  if (!wrap) return () => {};
  let plan = null,
    shown = "",
    bound = [],
    locked = false;
  const note = make("p", { className: "micro", role: "status" });

  // A change to the plan keeps hand sculpting, added regions and poses. A
  // preset or a whole new draw starts another animal, so nothing carries over.
  function apply(change, message, reframe = false, fresh = false) {
    const form = read();
    if (!form.origin?.plan) return;
    const draft = structuredClone(readCreaturePlan(form.origin.plan));
    try {
      change(draft);
      const next = readCreaturePlan(draft);
      note.textContent = "";
      commit(fresh ? buildCreature(next) : rebuildCreature(form, next), message);
      if (reframe) frame?.();
    } catch (error) {
      note.textContent = error.message;
      sync();
    }
  }
  function control(spec, get, set, what) {
    const [key, label, a, b, step] = spec;
    let input, output;
    if (Array.isArray(a))
      input = make("select", {}, ...a.map((v) => new Option(title(v), v)));
    else if (a === "color") input = make("input", { type: "color" });
    else if (a === "check") input = make("input", { type: "checkbox" });
    else {
      input = make("input", { type: "range", min: a, max: b, step });
      output = make("output");
      input.oninput = () => (output.textContent = Number(input.value));
    }
    const value = () =>
      a === "check"
        ? input.checked
        : Array.isArray(a) || a === "color"
          ? input.value
          : Number(input.value);
    input.onchange = () =>
      apply((draft) => set(draft, value()), title(what) + ": " + label.toLowerCase() + ".");
    bound.push(() => {
      const now = get(plan);
      if (now === undefined) {
        if (a === "check") input.checked = false;
        else if (Array.isArray(a)) input.value = a[0];
        return;
      }
      if (a === "check") input.checked = now;
      else input.value = a === "color" || Array.isArray(a) ? now : String(now);
      if (output) output.textContent = Number(Number(now).toFixed(3));
      input.disabled = locked;
    });
    const row = make("label", { className: "plan-row" }, make("span", {}, label), input);
    if (output) row.append(output);
    if (a === "check") row.classList.add("plan-check");
    return row;
  }
  const section = (name, key, open = false) =>
    make(
      "details",
      { open, className: "plan-group" },
      make("summary", {}, name),
      ...fields[key].map((spec) =>
        control(
          spec,
          (p) => p[key][spec[0]] ?? spec[5],
          (p, v) => (p[key][spec[0]] = v),
          name,
        ),
      ),
    );
  const summary = (limb) =>
    (limb.side === "both" ? limb.pairs * 2 : limb.pairs) +
    " " +
    plural[limb.kind] +
    (limb.kind === "leg"
      ? " · " + limb.style
      : limb.kind === "wing" && limb.structure !== "plain"
        ? " · " + limb.structure
        : "");

  function build() {
    const open = new Set(
      [...wrap.querySelectorAll("details[open]")].map((d) => d.dataset.key),
    );
    bound = [];
    const preset = make(
      "select",
      { ariaLabel: "Starting body plan" },
      new Option("Start from…", ""),
      ...Object.keys(creaturePresets).map((name) => new Option(name)),
    );
    preset.onchange = () => {
      const name = preset.value;
      if (!name) return;
      apply((draft) => {
        for (const key of Object.keys(draft)) delete draft[key];
        Object.assign(draft, readCreaturePlan(creaturePresets[name]));
      }, "Body plan: " + name.toLowerCase() + ".", true, true);
    };
    const scope = make(
      "select",
      { ariaLabel: "What to shuffle" },
      ...Object.keys(scopes).map((name) => new Option(name)),
    );
    const shuffle = make("button", { textContent: "Shuffle" });
    shuffle.onclick = () => {
      const seed=crypto.getRandomValues(new Uint32Array(1))[0];
      if(scope.value==="Equipment"){
        apply(draft=>{draft.equipment=drawCreatureEquipment(draft,seed)??readEquipment();},"Shuffled equipment.");
        return;
      }
      if(scope.value==="Worn layers"){
        apply(draft=>{const drawn=drawCreatureDress(draft,seed);if(drawn)draft.dress=drawn;else delete draft.dress;},"Shuffled worn layers.");
        return;
      }
      const drawn = randomCreaturePlan(seed);
      apply((draft) => {
        for (const key of scopes[scope.value]) {
          if (drawn[key] === undefined) delete draft[key];
          else draft[key] = drawn[key];
        }
      }, "Shuffled " + scope.value.toLowerCase() + ".", scope.value !== "Colours and markings", scope.value === "Whole creature");
    };
    const groups = plan.limbs.map((limb, index) => {
      const remove = make("button", { textContent: "Remove these " + plural[limb.kind] });
      remove.onclick = () =>
        apply((draft) => draft.limbs.splice(index, 1), "Removed " + plural[limb.kind] + ".");
      const copy = make("button", { textContent: "Duplicate" });
      copy.disabled = plan.limbs.length >= 8;
      copy.onclick = () =>
        apply((draft) => {
          const twin = structuredClone(draft.limbs[index]);
          const shift = twin.from > 0.5 ? -0.18 : 0.18;
          twin.from = Math.min(1, Math.max(0, twin.from + shift));
          twin.to = Math.min(1, Math.max(0, twin.to + shift));
          draft.limbs.splice(index + 1, 0, twin);
        }, "Duplicated " + plural[limb.kind] + ".");
      const kind = make(
        "select",
        {},
        ...o.limbKind.map((v) => new Option(title(v), v)),
      );
      kind.onchange = () =>
        apply((draft) => {
          const old = draft.limbs[index];
          draft.limbs[index] = {
            kind: kind.value,
            pairs: old.pairs,
            side: old.side,
            from: old.from,
            to: old.to,
          };
        }, "Limb group became " + plural[kind.value] + ".");
      bound.push(() => {
        kind.value = limb.kind;
        kind.disabled = remove.disabled = locked;
      });
      const group = make(
        "details",
        { className: "plan-group plan-limb" },
        make("summary", {}, summary(limb)),
        make("label", { className: "plan-row" }, make("span", {}, "Kind"), kind),
        ...fieldsOf(limb).map((spec) =>
          control(
            spec,
            (p) => p.limbs[index]?.[spec[0]] ?? spec[5],
            (p, v) => {
              const limb = p.limbs[index];
              // A single limb sits at its first station; moving that station
              // moves the limb instead of leaving the last one behind.
              if (spec[0] === "from" && limb.pairs === 1) limb.to = v;
              // Another structure counts other ribs.
              if (spec[0] === "structure" && limb.structure !== v) delete limb.ribs;
              limb[spec[0]] = v;
            },
            plural[limb.kind],
          ),
        ),
        make("div", { className: "actions" }, copy, remove),
      );
      group.dataset.key = "limb " + index;
      return group;
    });
    const adds = o.limbKind.map((kind) => {
      const add = make("button", { textContent: "+ " + title(plural[kind]) });
      add.disabled = plan.limbs.length >= 8;
      add.onclick = () =>
        apply((draft) => {
          const starter = { ...starters[kind] };
          // New wings are built the way the animal would grow them.
          if (kind === "wing") starter.structure = suggestWingStructure(draft, 0.3);
          // New limbs start clear of the limbs of the same kind.
          const taken = draft.limbs.filter((l) => l.kind === kind);
          if (taken.length) {
            const least = Math.min(...taken.map((l) => Math.min(l.from, l.to))),
              most = Math.max(...taken.map((l) => Math.max(l.from, l.to)));
            starter.from = 1 - most > least ? (1 + most) / 2 : least / 2;
          }
          draft.limbs.push(starter);
        }, "Added " + plural[kind] + ".");
      bound.push(() => (add.disabled = locked || plan.limbs.length >= 8));
      return add;
    });
    const marks = make(
      "select",
      {},
      ...o.markings.map((v) => new Option(title(v), v)),
    );
    marks.onchange = () =>
      apply((draft) => {
        draft.skin.markings =
          marks.value === "none"
            ? null
            : { ...(draft.skin.markings ?? {}), kind: marks.value };
      }, "Markings: " + marks.value.toLowerCase() + ".");
    bound.push(() => {
      marks.value = plan.skin.markings?.kind ?? "none";
      marks.disabled = preset.disabled = scope.disabled = shuffle.disabled = locked;
      preset.value = "";
    });
    const skin = section("Hide and colours", "skin");
    for (const [key, label] of [["faceMarking", "Face marking"], ["flankMarking", "Flank marking"]]) {
      skin.append(control([key, label, creatureOptions[key]], p => p.skin[key] ?? "None", (draft, value) => {
        if (value === "None") delete draft.skin[key];
        else draft.skin[key] = value;
      }, "Hide and colours"));
    }
    skin.append(control(["family","Coat family",["plain",...coatFamilies]],p=>p.skin.coat?.family??"plain",(draft,value)=>{
      if(value==="plain")delete draft.skin.coat;
      else draft.skin.coat=readCreatureCoat({...draft.skin.coat,family:value});
    },"Hide and colours"));
    if(!plan.skin.coat){
      const suggest=make("button",{textContent:"Try a coat for this anatomy"});
      suggest.onclick=()=>apply(draft=>{draft.skin=drawCreatureCoat(draft,crypto.getRandomValues(new Uint32Array(1))[0]);},"Applied a coat suited to the anatomy.");
      bound.push(()=>{suggest.disabled=locked;});skin.append(suggest);
    }
    if(plan.skin.coat) {
      skin.append(control(["graded","Grade back and throat","check"], p => Boolean(p.skin.coat.graded),
        (draft, value) => { draft.skin.coat.graded = value; }, "Hide and colours"));
      for(const spec of [["contrast","Coat contrast",0,1,.01],["density","Pattern density",.55,1.8,.01]])
        skin.append(control(spec,p=>p.skin.coat[spec[0]],(draft,value)=>{draft.skin.coat[spec[0]]=value;},"Hide and colours"));
      const reroll=make("button",{textContent:"Reroll coat"});reroll.onclick=()=>apply(draft=>{draft.skin.coat.seed=crypto.getRandomValues(new Uint32Array(1))[0];},"Rerolled coat.");
      bound.push(()=>{reroll.disabled=locked;});skin.append(reroll);
    }
    skin.append(
      make("label", { className: "plan-row" }, make("span", {}, "Markings"), marks),
      ...(plan.skin.markings
        ? fields.markings.map((spec) =>
            control(
              spec,
              (p) => p.skin.markings?.[spec[0]],
              (p, v) => (p.skin.markings[spec[0]] = v),
              "Markings",
            ),
          )
        : []),
    );
    const spine = section("Spine and posture", "spine", true);
    spine.append(
      ...["hips", "loin", "belly", "chest", "shoulders"].map((name, i) =>
        control(
          ["bulge", "Girth at " + name, 0.4, 2.2, 0.01],
          (p) => p.spine.bulge[i],
          (p, v) => (p.spine.bulge[i] = v),
          "Spine and posture",
        ),
      ),
    );
    const extras = make(
      "details",
      { className: "plan-group" },
      make("summary", {}, "Details"),
      ...o.detail.map((name) => {
        const box = make("input", { type: "checkbox" });
        box.onchange = () =>
          apply((draft) => {
            draft.details = box.checked
              ? [...draft.details, name]
              : draft.details.filter((d) => d !== name);
          }, "Details: " + name + ".");
        bound.push(() => {
          box.checked = plan.details.includes(name);
          box.disabled = locked;
        });
        return make(
          "label",
          { className: "plan-row plan-check" },
          make("span", {}, title(name)),
          box,
        );
      }),
    );
    const back = section("Along the back", "back");
    if (growthFamilies.includes(plan.back.kind)) {
      const reroll = make("button", { textContent: "Reroll growth" });
      reroll.onclick = () => apply((draft) => {
        draft.back.seed = crypto.getRandomValues(new Uint32Array(1))[0];
      }, "Rerolled this growth pattern.");
      bound.push(() => { reroll.disabled = locked; });
      back.append(control(
        ["spread", "Spread around trunk", 0, 1, 0.01],
        (p) => p.back.spread, (p, value) => { p.back.spread = value; }, "Growth",
      ), reroll);
    }
    const dressed = plan.equipment && plan.equipment.kind !== "none";
    const equipment = make("details", {className:"plan-group"}, make("summary", {}, "Equipment"),
      ...fields.equipment.filter(spec => dressed || spec[0] === "kind").map(spec =>
        control(spec, p => (p.equipment ?? readEquipment())[spec[0]], (draft, value) => {
          draft.equipment = readEquipment({...draft.equipment, [spec[0]]:value});
        }, "Equipment")));
    if (plan.equipment?.kind === "courier satchel") {
      if (dispatchHand(read(),plan.equipment.side))
        equipment.append(control(["handling","Dispatch tube",["packed","offer"]],p=>p.equipment.handling??"packed",(draft,value)=>{
          draft.equipment=readEquipment({...draft.equipment,handling:value});
        },"Equipment"),make("p",{className:"micro"},"Offer moves the signed tube into the hand. Play Offer dispatch under Motion, or edit the Present dispatch pose."));
      else equipment.append(make("p",{className:"micro"},"This animal carries the dispatch in its pack. A hand with a thumb and two fingers can present it."));
    }
    if (dressed) {
      const repack = make("button", {textContent:"Reroll packing"});
      repack.onclick = () => apply(draft => {
        draft.equipment.seed = crypto.getRandomValues(new Uint32Array(1))[0];
      }, "Rerolled the contents and packing.");
      bound.push(() => { repack.disabled = locked; });
      equipment.append(repack);
    }
    const worn = plan.dress && plan.dress.kind !== "none";
    const dress = make("details", {className:"plan-group"}, make("summary", {}, "Worn layers"),
      ...fields.dress.filter(spec => worn || spec[0] === "kind").map(spec =>
        control(spec, p => (p.dress ?? readDress())[spec[0]], (draft, value) => {
          if (spec[0] === "kind" && value === "none") delete draft.dress;
          else draft.dress = readDress({...(draft.dress ?? drawCreatureDress(draft, 1)), [spec[0]]:value});
        }, "Worn layers")));
    if (worn) {
      const recut = make("button", {textContent:"Reroll the cut"});
      recut.onclick = () => apply(draft => {
        draft.dress.seed = crypto.getRandomValues(new Uint32Array(1))[0];
      }, "Rerolled the worn layers.");
      bound.push(() => { recut.disabled = locked; });
      dress.append(recut);
    }
    const sections = [
      [spine, "spine"],
      [section("Head and neck", "head"), "head"],
      [section("Tail", "tail"), "tail"],
      [back, "back"],
      [extras, "details"],
      [dress, "dress"],
      [equipment, "equipment"],
      [skin, "skin"],
    ];
    for (const [node, key] of sections) node.dataset.key = key;
    // Handles on the model move limb groups and change the trunk thickness.
    const onModel = [];
    if (handles) {
      const box = make("input", { type: "checkbox" });
      box.onchange = () => (handles.enabled = box.checked);
      bound.push(() => {
        box.checked = handles.enabled;
        box.disabled = locked;
      });
      onModel.push(
        make(
          "label",
          { className: "plan-row plan-check" },
          make("span", {}, "Drag handles on the model"),
          box,
        ),
        make(
          "p",
          { className: "micro" },
          "Round handles slide a limb group along the spine. Diamonds change the thickness there. Drag elsewhere to orbit. Escape cancels a drag.",
        ),
      );
    }
    const size = control(
      ["scale", "Overall size", 0.2, 4, 0.01],
      (p) => p.scale,
      (p, v) => (p.scale = v),
      "Creature",
    );
    wrap.replaceChildren(
      make("legend", {}, "Creature body plan"),
      make("div", { className: "plan-top" }, preset),
      make("div", { className: "plan-top" }, scope, shuffle),
      ...onModel,
      size,
      sections[0][0],
      make("h3", { className: "plan-heading" }, "Limbs"),
      ...groups,
      make("div", { className: "actions" }, ...adds),
      ...sections.slice(1).map(([node]) => node),
      make(
        "p",
        { className: "micro" },
        "Each change rebuilds the creature. Hand sculpting stays on regions the change leaves alone, and added regions stay with their carrier.",
      ),
      note,
    );
    for (const d of wrap.querySelectorAll("details"))
      if (open.has(d.dataset.key)) d.open = true;
  }
  function sync() {
    for (const set of bound) set();
  }
  return (form, isLocked) => {
    const raw = form.origin?.plan;
    wrap.hidden = !raw;
    if (!raw) return;
    plan = readCreaturePlan(raw);
    locked = isLocked;
    // The controls are rebuilt only when their set changes, so a slider keeps
    // focus while it is being stepped.
    const layout = JSON.stringify([
      plan.limbs.map((l) => [l.kind, l.pairs, l.side, l.style, l.structure]),
      Boolean(plan.skin.markings), Boolean(plan.skin.coat),
      plan.equipment?.kind ?? "none", Boolean(dispatchHand(form)),
      growthFamilies.includes(plan.back.kind),
    ]);
    if (layout !== shown) {
      shown = layout;
      build();
    }
    sync();
  };
}
