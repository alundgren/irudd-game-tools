// The Appearance controls for face marks: a short list of marks, and the settings of the one
// that is selected. Every change is one committed edit of `form.faceMarks`.
import {
  changeFaceMarkKind,
  faceMark,
  faceMarkKind,
  faceMarkKinds,
  faceMarkLimit,
  faceMarkSides,
  faceMarkToneHex,
} from "./human-face-marks.js";

const sliders = {
  strength: ["Strength", 0, 100, (v) => v / 100, (v) => Math.round(v * 100)],
  size: ["Size", 0, 100, (v) => v / 100, (v) => Math.round(v * 100)],
  across: ["Move outwards", -100, 100, (v) => v / 100, (v) => Math.round((v ?? 0) * 100)],
  up: ["Move up", -100, 100, (v) => v / 100, (v) => Math.round((v ?? 0) * 100)],
  turn: ["Turn", -90, 90, (v) => v, (v) => Math.round(v ?? 0)],
};
const describe = (mark, index) => index + 1 + " · " + mark.kind + ", " + mark.place.toLowerCase() + (mark.side === "Both" ? "" : ", " + mark.side.toLowerCase());

/**
 * Build the controls after `anchor` and return the function that shows a form in them.
 * `read()` gives the current form and `commit(form, message)` applies an edit.
 */
export function faceMarksEditor(anchor, read, commit) {
  const make = (tag, set = {}) => Object.assign(document.createElement(tag), set),
    field = (title, input) => {
      const label = make("label", { className: "field" });
      label.append(title, input);
      return label;
    };
  const wrap = make("div", { id: "face-marks" }),
    list = make("select", { id: "face-mark" }),
    add = make("select", { id: "face-mark-add" }),
    detail = make("div", { id: "face-mark-detail" }),
    kind = make("select", { id: "face-mark-kind" }),
    place = make("select", { id: "face-mark-place" }),
    side = make("select", { id: "face-mark-side" }),
    tone = make("input", { id: "face-mark-tone", type: "color" }),
    natural = make("button", { id: "face-mark-natural", type: "button" }),
    redraw = make("button", { id: "face-mark-redraw", type: "button", textContent: "Redraw" }),
    remove = make("button", { id: "face-mark-remove", type: "button", textContent: "Remove" }),
    actions = make("div", { className: "actions" }),
    ranges = {};
  add.replaceChildren(new Option("Add a mark…", ""), ...faceMarkKinds.map((name) => new Option(name, name)));
  kind.replaceChildren(...faceMarkKinds.map((name) => new Option(name, name)));
  side.replaceChildren(...faceMarkSides.map((name) => new Option(name === "Both" ? "Both sides" : name + " side", name)));
  detail.append(field("Kind", kind), field("Place", place), field("Side", side));
  for (const [key, [title, min, max]] of Object.entries(sliders)) {
    ranges[key] = make("input", { id: "face-mark-" + key, type: "range", min, max, step: 1 });
    detail.append((ranges[key].row = field(title, ranges[key])));
  }
  actions.append(natural, redraw, remove);
  detail.append(field("Tone", tone), actions);
  wrap.append(field("Face marks", list), field("New mark", add), detail);
  anchor.after(wrap);

  let selected = 0;
  const marks = () => read().faceMarks ?? [];
  // Replace the list of marks. An empty list leaves the form without the field.
  function save(next, message) {
    const { faceMarks, ...form } = read();
    commit(next.length ? { ...form, faceMarks: next } : form, message);
  }
  function change(patch, message = "Face mark changed.") {
    const all = marks();
    if (!all[selected]) return;
    const mark = typeof patch === "function" ? patch(all[selected]) : { ...all[selected], ...patch };
    save(all.map((m, i) => (i === selected ? mark : m)), message);
  }
  const seed = () => crypto.getRandomValues(new Uint32Array(1))[0];

  list.onchange = () => {
    selected = Number(list.value);
    show(read(), false);
  };
  add.onchange = () => {
    const name = add.value,
      all = marks();
    add.value = "";
    if (!name || all.length >= faceMarkLimit) return;
    selected = all.length;
    save([...all, faceMark(name, seed())], name + " added.");
    // Marks are painted, so they show in colour and not in clay.
    document.querySelector('[data-mode="Color"]')?.click();
  };
  kind.onchange = () => change((mark) => changeFaceMarkKind(mark, kind.value));
  place.onchange = () => change({ place: place.value });
  side.onchange = () => change({ side: side.value });
  for (const [key, [, , , value]] of Object.entries(sliders))
    ranges[key].onchange = () =>
      change((mark) => {
        const next = { ...mark, [key]: value(Number(ranges[key].value)) };
        // A control at rest is left out of the saved mark.
        if (["across", "up", "turn"].includes(key) && !next[key]) delete next[key];
        return next;
      });
  tone.onchange = () => change({ tone: tone.value });
  natural.onclick = () =>
    change((mark) => {
      const { tone: _, ...rest } = mark;
      return rest;
    });
  redraw.onclick = () => change({ seed: seed() }, "Face mark redrawn.");
  remove.onclick = () => {
    const all = marks();
    if (!all[selected]) return;
    const next = all.filter((_, i) => i !== selected);
    selected = Math.max(0, Math.min(selected, next.length - 1));
    save(next, "Face mark removed.");
  };

  function show(form, locked) {
    const all = form.faceMarks ?? [];
    selected = Math.max(0, Math.min(selected, all.length - 1));
    list.replaceChildren(...(all.length ? all.map((mark, i) => new Option(describe(mark, i), i)) : [new Option("None", "")]));
    list.disabled = locked || !all.length;
    add.disabled = locked || all.length >= faceMarkLimit;
    const mark = all[selected];
    detail.hidden = !mark;
    if (!mark) return;
    list.value = String(selected);
    const options = faceMarkKind(mark.kind);
    kind.value = mark.kind;
    place.replaceChildren(...options.places.map((name) => new Option(name, name)));
    place.value = mark.place;
    side.value = mark.side;
    for (const [key, [, , , , shown]] of Object.entries(sliders)) ranges[key].value = shown(mark[key]);
    ranges.across.row.hidden = ranges.up.row.hidden = !options.move;
    ranges.turn.row.hidden = !options.turn;
    tone.value = faceMarkToneHex(mark, form.appearance.skin);
    natural.textContent = options.worn && mark.kind !== "Eyeliner" ? "Palette tone" : "Natural tone";
    natural.disabled = locked || !mark.tone;
  }
  return show;
}
