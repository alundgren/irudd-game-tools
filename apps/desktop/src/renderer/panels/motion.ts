import {
  bendElbow,
  poseClipName,
  recutSleeves,
  type ElbowDirection,
  type PoseScope,
  type PoseTool,
} from "@irudd/character";
import { currentCreature } from "@irudd/character/creature";
import { HumanAdultParams, humanAdultId, type postureRanges } from "@irudd/character/human";
import { decodeWith, motionHold, motionPoses } from "@irudd/document";
import { byId, button, el } from "../dom.js";
import type { EditorViewport } from "../viewport.js";
import type { PanelContext } from "./context.js";
import { choices, colour, field } from "./garment-fields.js";
import { postureFields } from "./posture.js";

function slider(min: number, max: number, value: number, onInput: () => void) {
  const input = el("input");
  Object.assign(input, { type: "range", min, max, step: 0.001, value });
  input.oninput = onInput;
  return input;
}

export function mountMotion(ctx: PanelContext, viewport: EditorViewport) {
  const panel = byId("motion-editor", HTMLDetailsElement);
  const rows = panel.querySelector("div");
  let previous: string | undefined,
    clipName = "Rest",
    jointKey = "",
    armId = "",
    bones = false,
    tool: PoseTool = "rotate",
    scope: PoseScope = "one",
    plant: boolean | undefined;
  let postureAxis: keyof typeof postureRanges = "weight";
  let active: typeof viewport.motion;
  function render() {
    const view = ctx.view,
      doc = ctx.doc;
    panel.hidden = !doc || !view || !viewport.shows(doc);
    if (previous !== doc?.id) {
      clipName = "Rest";
      jointKey = armId = "";
      tool = "rotate";
      scope = "one";
      plant = undefined;
      previous = doc?.id;
    }
    if (!rows || !panel.open || panel.hidden || !doc || !view) {
      viewport.closeMotion();
      active = undefined;
      return;
    }
    const preview = viewport.preview();
    if (!preview) return;
    const generation = doc.generation;
    const adult =
      generation?.generator === humanAdultId && decodeWith(HumanAdultParams, generation.params);
    const saved = motionPoses.read(doc.features)?.poses ?? [];
    const names = [
      "Rest",
      ...(adult && adult.ok && adult.value.posture ? ["Fitting pose"] : []),
      ...preview.clips.map((c) => c.name),
    ];
    if (!names.includes(clipName)) clipName = "Rest";
    if (active !== preview) {
      active = preview;
      preview.select(clipName);
    }
    const base = { documentId: view.documentId, revision: view.revision };
    function edit(summary: string, make: () => readonly object[], next = clipName) {
      try {
        const ops = make();
        panel.inert = true;
        const last = clipName;
        clipName = next;
        void ctx.commit({ type: "edit", ops, summary }, summary, base).then((ok) => {
          if (!ok) clipName = last;
          panel.inert = false;
        });
      } catch (error) {
        ctx.showBanner("error", String(error));
      }
    }
    const clips = choices(names, clipName, (n) =>
      n === "Rest" && adult && adult.ok && adult.value.posture ? "Standing" : n,
    );
    const time = slider(0, 1, preview.time, () => {
      preview.playing = false;
      play.textContent = "Play";
      preview.seek(time.valueAsNumber);
      viewport.request();
    });
    const play = button(preview.playing ? "Pause" : "Play", () => {
      preview.playing = !preview.playing;
      play.textContent = preview.playing ? "Pause" : "Play";
      viewport.request();
    });
    const joints = el("input");
    joints.type = "checkbox";
    joints.checked = bones;
    joints.onchange = () => {
      bones = joints.checked;
      viewport.showJoints(bones);
      attachJoint();
    };
    viewport.showJoints(bones);
    viewport.onMotionFrame = (t) => {
      time.value = String(t);
      play.textContent = preview.playing ? "Pause" : "Play";
    };
    const moving =
      preview.clips.some((c) => c.name === clipName) &&
      !saved.some((p) => poseClipName(p.name) === clipName);
    time.disabled = play.disabled = !moving;
    clips.input.onchange = () => {
      clipName = clips.read();
      preview.select(clipName);
      render();
      viewport.request();
    };
    rows.replaceChildren(
      field("Pose or clip", clips.input),
      field("Clip time", time),
      play,
      field("Show joints", joints),
    );
    if (preview.morphs.size) {
      const expression = choices(
        ["Rest", ...["Blink", "Smile", "BrowLift"].filter((n) => preview.morphs.has(n))],
        preview.expression,
        (n) => (n === "BrowLift" ? "Raise brows" : n),
      );
      const strength = slider(0, 1, preview.strength, face),
        x = slider(-1, 1, preview.gaze[0], face),
        y = slider(-1, 1, preview.gaze[1], face);
      function face() {
        preview?.setFace(
          expression.read(),
          strength.valueAsNumber,
          x.valueAsNumber,
          y.valueAsNumber,
        );
        viewport.request();
      }
      expression.input.onchange = face;
      if (expression.input.length > 1)
        rows.append(field("Expression", expression.input), field("Expression strength", strength));
      if (preview.morphs.has("LookLeft") && clipName !== "Gaze")
        rows.append(
          field("Horizontal gaze", x),
          field("Vertical gaze", y),
          button("Centre gaze", () => {
            x.value = y.value = "0";
            face();
          }),
        );
      face();
    }
    const joint = el("select");
    for (const [key, b] of preview.rig.bindings) {
      const { part, station, digit } = b.address;
      joint.add(
        new Option(
          part
            ? (ctx.part(part)?.label ?? part) +
                " · " +
                (digit ? digit + " " + station : "joint " + (station + 1))
            : "Whole skeleton",
          key,
        ),
      );
    }
    if (preview.rig.bindings.has(jointKey)) joint.value = jointKey;
    joint.onchange = () => {
      jointKey = joint.value;
      attachJoint();
    };
    const playback = preview;
    const session = preview.posing(currentCreature(doc) !== undefined);
    if (plant === undefined) plant = session.plant;
    const axis = choices(["x", "y", "z"] as const, "x", (k) => k.toUpperCase());
    const toolLabels: Record<PoseTool, string> = {
      rotate: "Rotate",
      translate: "Move",
      reach: "Guide wrist",
      tip: "Guide limb tip",
    };
    const mode = choices(
      ["rotate", "translate", "reach", "tip"] as const,
      tool,
      (t) => toolLabels[t],
    );
    const together = el("select");
    const planted = el("input");
    planted.type = "checkbox";
    const step = el("input");
    Object.assign(step, { type: "number", step: "any", min: 0.001, max: 180, value: 15 });
    const note = el("output");
    note.setAttribute("role", "status");
    note.className = "pose-note";
    const surface = button("Choose a point on the model", () => {
      viewport.pickingSurface = !viewport.pickingSurface;
      surface.setAttribute("aria-pressed", String(viewport.pickingSurface));
      note.textContent = viewport.pickingSurface
        ? "Click a point on the posed surface for this wrist."
        : "";
      attachJoint();
    });
    surface.setAttribute("aria-pressed", "false");
    const elbowLabels: Record<ElbowDirection, string> = {
      original: "Along existing bend",
      clear: "Give other arms room",
      down: "Toward floor",
      left: "Character left",
      right: "Character right",
      back: "Toward back",
    };
    const elbow = choices(
      ["original", "clear", "down", "left", "right", "back"] as const,
      "original",
      (d) => elbowLabels[d],
    );
    const turn = el("input");
    Object.assign(turn, { type: "number", min: -180, max: 180, step: 5, value: 0 });
    const reachControls = el("div", { className: "pose-reach" });
    reachControls.append(
      surface,
      field("Point elbow", elbow.input),
      field("Elbow turn in degrees", turn),
    );
    const undo = button("Undo pose edit", () => {
      session.undo();
      attachJoint(false);
    });
    function refresh() {
      undo.disabled = !session.undoable;
      surface.setAttribute("aria-pressed", String(viewport.pickingSurface));
      if (session.note) note.textContent = session.note;
      viewport.request();
    }
    function attachJoint(fresh = true) {
      const choice = session.choose(joint.value, mode.read(), scope, plant);
      if (!choice) return;
      tool = choice.tool;
      scope = choice.scope;
      plant = choice.plant;
      mode.input.value = choice.tool;
      for (const option of mode.input.options)
        option.disabled =
          (option.value === "reach" && !choice.canReach) ||
          (option.value === "tip" && !choice.canTip);
      together.replaceChildren(...choice.scopes.map((v) => new Option(session.scopeLabel(v), v)));
      together.value = choice.scope;
      together.disabled = choice.scopes.length < 2;
      planted.checked = choice.plant;
      planted.disabled = !choice.canPlant;
      reachControls.hidden = choice.tool !== "reach";
      if (choice.tool !== "reach" && viewport.pickingSurface) {
        viewport.pickingSurface = false;
        surface.setAttribute("aria-pressed", "false");
      }
      if (fresh) {
        elbow.input.value = "original";
        turn.value = "0";
        session.note = "";
        note.textContent = "";
      } else {
        session.elbow = elbow.read();
        session.roll = turn.valueAsNumber;
      }
      viewport.poseJoint(joint.value, choice.tool === "rotate" ? "rotate" : "translate", session);
      refresh();
    }
    viewport.onPoseChange = () => {
      play.textContent = "Play";
      refresh();
    };
    attachJoint();
    viewport.onJointPick = (key) => {
      jointKey = joint.value = key;
      attachJoint();
    };
    mode.input.onchange = () => {
      const was = tool === "rotate";
      tool = mode.read();
      attachJoint();
      if (was !== (tool === "rotate")) step.value = tool === "rotate" ? "15" : "0.025";
    };
    together.onchange = () => {
      scope = together.value === "pair" || together.value === "kind" ? together.value : "one";
      attachJoint();
    };
    planted.onchange = () => {
      plant = planted.checked;
      attachJoint();
    };
    const reguide = () => {
      session.elbow = elbow.read();
      session.roll = Number.isFinite(turn.valueAsNumber) ? turn.valueAsNumber : 0;
      session.reguide();
      refresh();
    };
    elbow.input.onchange = reguide;
    turn.onchange = reguide;
    function adjust(sign: number) {
      if (!step.checkValidity() || !Number.isFinite(step.valueAsNumber)) return;
      playback.playing = false;
      if (sign) session.nudge(axis.read(), sign * step.valueAsNumber);
      else session.relax();
      if (!sign && session.guiding) attachJoint();
      play.textContent = "Play";
      refresh();
    }
    const pose = saved.find((p) => poseClipName(p.name) === clipName);
    const name = el("input");
    name.maxLength = 60;
    let n = 1;
    while (saved.some((p) => p.name.toLowerCase() === "pose " + n)) n++;
    name.value = pose?.name ?? "Pose " + n;
    rows.append(
      field("Joint", joint),
      field("Joint adjustment", mode.input),
      button("Front view", () => viewport.setAngle("front")),
      field("Pose together", together),
      field("Keep the other feet planted", planted),
      reachControls,
      field("Axis", axis.input),
      field("Step (degrees or metres)", step),
      button("Decrease joint", () => adjust(-1)),
      button("Increase joint", () => adjust(1)),
      button("Relax joint", () => adjust(0)),
      undo,
      note,
      field("Pose name", name),
      button("Save pose", () => {
        const title = name.value.trim();
        edit(
          "Save pose " + title,
          () => {
            if (
              !title ||
              saved.some((p) => p !== pose && p.name.toLowerCase() === title.toLowerCase())
            )
              throw new Error("Choose a unique pose name.");
            const next = preview.capture(title, saved);
            return [
              {
                op: "feature.set",
                feature: motionPoses.id,
                value: motionPoses.json({
                  poses: [
                    ...saved.filter((p) => p.name.toLowerCase() !== title.toLowerCase()),
                    next,
                  ],
                }),
              },
            ];
          },
          poseClipName(title),
        );
      }),
    );
    if (adult && adult.ok) {
      const params = adult.value;
      rows.append(
        ...postureFields(
          params,
          postureAxis,
          (axis) => {
            postureAxis = axis;
            render();
          },
          (posture) => {
            const { posture: _old, ...rest } = params;
            edit(
              "Adjust standing posture",
              () => [{ op: "generation.steer", params: posture ? { ...rest, posture } : rest }],
              "Rest",
            );
          },
        ),
      );
    }
    const arms = viewport.arms();
    const arm = arms.find((a) => a.upper.part.id === armId) ?? arms[0];
    if (arm) {
      const select = choices(
        arms.map((a) => a.upper.part.id),
        arm.upper.part.id,
        (id) => ctx.part(id)?.label ?? id,
      );
      select.input.onchange = () => {
        armId = select.read();
        render();
      };
      const fabric = colour(arm.upper.part.color);
      const recut = button("Recut sleeves", () =>
        edit("Recut arm sleeves", () => recutSleeves(doc, arm, fabric.value)),
      );
      recut.disabled = !arm.upper.part.sweep || !arm.lower.part.sweep;
      const held = el("input");
      held.type = "checkbox";
      held.checked = arm.upper.part.hold;
      held.onchange = () =>
        edit("Set arm carry pose", () => [
          {
            op: "feature.set",
            part: arm.upper.part.id,
            feature: motionHold.id,
            value: held.checked ? motionHold.json({}) : null,
          },
        ]);
      rows.append(
        field("Segmented arm", select.input),
        button("Bend elbow", () => edit("Bend elbow", () => [bendElbow(arm, 15)])),
        button("Open elbow", () => edit("Open elbow", () => [bendElbow(arm, -15)])),
        field("Hold carry pose", held),
        field("Sleeve colour", fabric),
        recut,
      );
    }
    viewport.request();
  }
  panel.ontoggle = render;
  return { render };
}
