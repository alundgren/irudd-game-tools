import { defaultTailor, tailorLayer, tailorLimit, tailorPieces } from "./human-tailor.js";
import { armourLooks, armourSet, armourTailor } from "./human-armour.js";

const make = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

export function tailorEditor(read, commit, host = document.getElementById("human-styling")) {
  const list = make("div"), note = make("p", { className: "feedback" });
  const start = make("button", { type: "button", textContent: "Tailor this outfit piece by piece" });
  const kind = make("select", { ariaLabel: "Piece to add" }, ...Object.entries(tailorPieces).map(([piece, spec]) => new Option(spec.label, piece)));
  const add = make("button", { type: "button", textContent: "Add piece" });
  const clear = make("button", { type: "button", textContent: "Remove tailored pieces" });
  const adding = make("div", {}, make("label", { className: "field" }, "Add a piece", kind), add, " ", clear);
  const look = make("select", { ariaLabel: "Armour look" }, ...armourLooks.map((name) => new Option(name, name)));
  const wear = make("button", { type: "button", textContent: "Wear armour set" }), again = make("button", { type: "button", textContent: "Another variation" });
  const armour = make("div", {}, make("label", { className: "field" }, "Armour set", look), wear, " ", again);
  const box = make("details", { id: "human-tailor" }, make("summary", { textContent: "Tailored outfit" }), note, start, armour, list, adding);
  host.append(box);
  const open = new Set();
  let shown = null;

  const worn = (style) => style?.tailor?.layers ?? (style?.armour ? armourTailor(style.armour).layers : []);
  const layers = () => worn(read().humanStyle);
  function save(next, message) {
    const form = read(), { tailor, armour: set, ...style } = form.humanStyle ?? {};
    commit({ ...form, outfit: next.length && form.outfit === "Anatomy" ? "Work clothes" : form.outfit, humanStyle: next.length ? { ...style, tailor: { layers: next } } : style }, message);
  }
  start.onclick = () => { box.open = true; save(defaultTailor(read().humanStyle?.clothColor).layers, "Outfit laid out piece by piece."); };
  add.onclick = () => { open.add(layers().length); save([...layers(), tailorLayer(kind.value)], tailorPieces[kind.value].label + " added."); };
  clear.onclick = () => save([], "Tailored pieces removed. The chosen clothing shows again.");
  let variation = 0;
  const dress = (seed) => { variation = seed; box.open = true; open.clear(); save(armourSet(seed, look.value).layers, look.value + " armour laid out, variation " + seed + ". Open a piece to change it."); };
  wear.onclick = () => dress(variation);
  again.onclick = () => dress(Math.floor(Math.random() * 1000));

  function control(layer, index, key, field) {
    const set = (value) => save(layers().map((l, i) => (i === index ? { ...l, [key]: value } : l)), field.label + " changed.");
    if (field.type === "choice") {
      const select = make("select", {}, ...field.options.map((o) => new Option(o[0].toUpperCase() + o.slice(1), o)));
      select.value = layer[key] ?? field.value;
      select.onchange = () => set(select.value);
      return make("label", { className: "field" }, field.label, select);
    }
    if (field.type === "colour") {
      const input = make("input", { type: "color", value: layer[key] ?? field.value });
      input.onchange = () => set(input.value);
      return make("label", { className: "field" }, field.label, input);
    }
    const value = layer[key] ?? field.value, readout = make("output", { textContent: " " + value });
    const input = make("input", { type: "range", min: field.min, max: field.max, step: field.step, value });
    input.oninput = () => { readout.textContent = " " + input.value; };
    input.onchange = () => set(+input.value);
    return make("label", { className: "field" }, field.label, readout, input);
  }
  function row(layer, index, all, locked) {
    const spec = tailorPieces[layer.piece];
    const move = (to) => {
      const next = all.slice();
      next.splice(to, 0, ...next.splice(index, 1));
      const wasOpen = open.has(index), other = open.has(to);
      for (const [at, state] of [[to, wasOpen], [index, other]]) state ? open.add(at) : open.delete(at);
      save(next, spec.label + (to < index ? " put on earlier." : " put on later."));
    };
    const earlier = make("button", { type: "button", textContent: "Wear earlier", disabled: locked || index === 0 });
    const later = make("button", { type: "button", textContent: "Wear later", disabled: locked || index === all.length - 1 });
    const remove = make("button", { type: "button", textContent: "Remove", disabled: locked });
    earlier.onclick = () => move(index - 1);
    later.onclick = () => move(index + 1);
    remove.onclick = () => { open.delete(index); save(all.filter((_, i) => i !== index), spec.label + " removed."); };
    const panel = make("details", { open: open.has(index) }, make("summary", { textContent: index + 1 + " · " + spec.label }),
      ...Object.entries(spec.fields).map(([key, field]) => control(layer, index, key, field)), make("div", {}, earlier, " ", later, " ", remove));
    panel.ontoggle = () => (panel.open ? open.add(index) : open.delete(index));
    for (const item of panel.querySelectorAll("input,select")) item.disabled = locked;
    return panel;
  }

  return (form, locked) => {
    box.hidden = !form.human;
    if (!form.human) return;
    const all = worn(form.humanStyle), state = JSON.stringify([all, locked, form.outfit]);
    if (state === shown) return;
    shown = state;
    const hiddenBy = ["Anatomy", "Base layer", "Pressure suit"].includes(form.outfit);
    note.textContent = !all.length
      ? "Build an outfit from single pieces with their own colour, length, room and details. It replaces the chosen clothing until you remove it or choose other clothing."
      : hiddenBy
        ? "These pieces are kept while the base shape or a suit is showing."
        : "Pieces are listed in dressing order. A later piece is worn over an earlier one: boots after trousers take the legs inside the shaft, trousers after boots fall over it.";
    start.hidden = all.length > 0;
    list.hidden = adding.hidden = !all.length;
    start.disabled = clear.disabled = kind.disabled = look.disabled = wear.disabled = again.disabled = locked;
    add.disabled = locked || all.length >= tailorLimit;
    list.replaceChildren(...all.map((layer, index) => row(layer, index, all, locked)));
  };
}
