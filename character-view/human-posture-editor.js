import {
  drawPosture,
  mirrorPosture,
  postureAxes,
  postureLabels,
  posturePreset,
  postureRanges,
  postureStyleNames,
} from "./human-posture.js";

const fitting = "Fitting pose",
  own = "Own";

function field(title, ...children) {
  const label = document.createElement("label");
  label.className = "field";
  label.append(title, ...children);
  return label;
}
function button(id, title) {
  const b = document.createElement("button");
  b.id = id;
  b.type = "button";
  b.textContent = title;
  return b;
}

export function postureEditor(panel, before, read, commit) {
  const details = document.createElement("details");
  details.id = "human-posture";
  const summary = document.createElement("summary");
  summary.textContent = "Posture and walk";
  const style = document.createElement("select");
  style.id = "human-posture-style";
  const axis = document.createElement("select");
  axis.id = "human-posture-axis";
  axis.replaceChildren(...postureAxes.map((key) => new Option(postureLabels[key], key)));
  const slider = document.createElement("input");
  slider.id = "human-posture-value";
  slider.type = "range";
  slider.min = 0;
  slider.max = 100;
  const reading = document.createElement("output");
  reading.id = "human-posture-reading";
  const roll = button("human-posture-roll", "New posture"),
    mirror = button("human-posture-mirror", "Mirror"),
    level = button("human-posture-reset", "Reset control");
  const actions = document.createElement("div");
  actions.className = "actions";
  actions.append(roll, mirror, level);
  details.append(summary, field("Way of standing", style), field("Control", axis), field("Amount ", reading, slider), actions);
  panel.insertBefore(details, before);

  const value = (p, key) => p?.[key] ?? postureRanges[key][2];
  const toSlider = (key, v) => Math.round(((v - postureRanges[key][0]) / (postureRanges[key][1] - postureRanges[key][0])) * 100);
  const fromSlider = (key) => {
    const [lo, hi] = postureRanges[key];
    return Math.round((lo + (Number(slider.value) / 100) * (hi - lo)) * 100) / 100;
  };
  function show(next, message) {
    commit(next, message);
    const motion = document.getElementById("motion");
    const wanted = next.posture ? "Stand" : "Bind";
    if (motion && motion.value !== wanted && [...motion.options].some((o) => o.value === wanted) && ["Bind", "Stand"].includes(motion.value)) {
      motion.value = wanted;
      motion.dispatchEvent(new Event("change"));
    }
  }
  function describe() {
    reading.textContent = fromSlider(axis.value).toFixed(2);
  }
  style.onchange = () => {
    const form = read();
    if (!form.human || style.value === own) return;
    if (style.value === fitting) {
      const next = { ...form };
      delete next.posture;
      return show(next, "Standing posture removed. The adult rests in the fitting pose.");
    }
    show({ ...form, posture: posturePreset(style.value, value(form.posture, "weight") < 0) }, style.value + " posture applied.");
  };
  axis.onchange = () => {
    slider.value = toSlider(axis.value, value(read().posture, axis.value));
    describe();
  };
  slider.oninput = describe;
  slider.onchange = () => {
    const form = read();
    if (!form.human) return;
    show({ ...form, posture: { ...form.posture, [axis.value]: fromSlider(axis.value) } }, postureLabels[axis.value] + " set.");
  };
  level.onclick = () => {
    const form = read();
    if (!form.human || form.posture?.[axis.value] === undefined) return;
    const posture = { ...form.posture };
    delete posture[axis.value];
    show({ ...form, posture }, postureLabels[axis.value] + " reset.");
  };
  roll.onclick = () => {
    const form = read();
    if (!form.human) return;
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    show({ ...form, posture: drawPosture(seed, form.human) }, "New posture drawn.");
  };
  mirror.onclick = () => {
    const form = read();
    if (!form.human || !form.posture) return;
    show({ ...form, posture: mirrorPosture(form.posture) }, "Posture mirrored.");
  };
  return (form) => {
    if (!form.human) return;
    const p = form.posture;
    style.replaceChildren(
      new Option(fitting, fitting),
      ...postureStyleNames.map((name) => new Option(name, name)),
      ...(p && !p.style ? [new Option("Own posture", own)] : []),
    );
    style.value = p ? (p.style ?? own) : fitting;
    if (document.activeElement !== slider) slider.value = toSlider(axis.value, value(p, axis.value));
    describe();
    mirror.disabled ||= !p;
    level.disabled ||= p?.[axis.value] === undefined;
  };
}
