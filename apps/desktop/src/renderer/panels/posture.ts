import {
  drawPosture,
  mirrorPosture,
  postureAxes,
  postureRanges,
  postureStyleNames,
  postureStyles,
  type Posture,
  type HumanAdultParams,
} from "@irudd/character/human";
import { button, el } from "../dom.js";
import { field, choices } from "./garment-fields.js";

const labels = {
  weight: "Weight on right or left leg",
  hip: "Hip drop",
  lean: "Forward lean",
  slouch: "Slouch",
  twist: "Shoulder turn",
  shoulders: "Shoulder tilt",
  shrug: "Shrug",
  arms: "Arms hanging",
  elbows: "Elbow bend",
  hands: "Relaxed fingers",
  headTilt: "Head tilt",
  headTurn: "Head turn",
  chin: "Chin lift",
  feet: "Stance width",
  toes: "Toe angle",
  step: "Free foot placement",
  stride: "Walking stride",
  swing: "Walking arm swing",
  handAtWaist: "Hand on hip",
};

export function postureFields(
  params: HumanAdultParams,
  axis: keyof typeof postureRanges,
  chooseAxis: (key: keyof typeof postureRanges) => void,
  apply: (p: Posture | undefined) => void,
) {
  const current = params.posture;
  const style = choices(
    ["Fitting pose", ...postureStyleNames, ...(current && !current.style ? ["Custom"] : [])],
    current ? (current.style ?? "Custom") : "Fitting pose",
  );
  style.input.onchange = () => {
    const name = postureStyleNames.find((n) => n === style.read());
    const preset = name && { style: name, ...postureStyles[name] };
    apply(preset && (current?.weight ?? 0) < 0 ? mirrorPosture(preset) : preset);
  };
  const control = choices(postureAxes, axis, (k) => labels[k]);
  control.input.onchange = () => chooseAxis(control.read());
  const amount = el("input");
  const [min, max, initial] = postureRanges[axis];
  Object.assign(amount, { type: "range", min, max, step: 0.01, value: current?.[axis] ?? initial });
  amount.onchange = () => apply({ ...current, [axis]: amount.valueAsNumber });
  const mirror = button("Mirror posture", () => current && apply(mirrorPosture(current)));
  mirror.disabled = !current;
  const reset = button("Reset posture control", () => {
    const next = { ...current };
    delete next[axis];
    apply(next);
  });
  reset.disabled = current?.[axis] === undefined;
  return [
    field("Standing posture", style.input),
    field("Posture control", control.input),
    field(labels[axis], amount),
    button("New posture", () =>
      apply(drawPosture(crypto.getRandomValues(new Uint32Array(1))[0] ?? 0, params.human)),
    ),
    mirror,
    reset,
  ];
}
