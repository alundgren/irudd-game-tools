import { captureJoints, inactiveJoints, poseClipName } from "./poses.js";
import { setGaze } from "./ocular.js";
import { creatureMoves, standardMoves } from "./creature-motion.js";
import { AnimationMixer, SkeletonHelper } from "three";
import { poseExpression } from "./expressions.js";
import { skinCharacter, movementRoles } from "./skin.js";

export function motionPreview(scene, render, changed) {
  const select = document.getElementById("motion"),
    time = document.getElementById("motion-time"),
    toggle = document.getElementById("motion-play");
  const bones = document.getElementById("show-bones"),
    details = document.getElementById("playback");
  let model = null,
    recipe = null,
    rig = null,
    mixer = null,
    clip = null,
    helper = null,
    playing = true,
    frame = null,
    previous = 0;
  const expression = document.getElementById("face-pose"),
    amount = document.getElementById("face-pose-amount");
  const lookX = document.getElementById("look-x"),
    lookY = document.getElementById("look-y");
  function gaze() {
    setGaze(
      rig?.actor ?? model,
      Number(lookX.value) / 100,
      Number(lookY.value) / 100,
    );
    render();
  }
  lookX.oninput = lookY.oninput = gaze;
  document.getElementById("look-center").onclick = () => {
    lookX.value = lookY.value = 0;
    gaze();
  };
  function setExpression() {
    poseExpression(
      rig?.actor ?? model,
      expression.value,
      Number(amount.value) / 100,
    );
    amount.disabled = expression.value === "Rest";
    render();
  }
  expression.onchange = setExpression;
  amount.oninput = setExpression;
  function release() {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    if (helper) {
      scene.remove(helper);
      helper.geometry.dispose();
      helper.material.dispose();
      helper = null;
    }
    if (rig) {
      mixer.stopAllAction();
      mixer.uncacheRoot(rig.actor);
      scene.remove(rig.actor);
      rig.dispose();
      rig = null;
    }
  }
  function overlay() {
    gaze();
    if (helper) {
      scene.remove(helper);
      helper.geometry.dispose();
      helper.material.dispose();
      helper = null;
    }
    if (rig && bones.checked) {
      helper = new SkeletonHelper(rig.actor);
      helper.material.depthTest = false;
      helper.renderOrder = 2;
      scene.add(helper);
    }
  }
  function tick(now) {
    frame = null;
    if (!playing || !rig) return;
    mixer.update(Math.min(0.08, (now - previous) / 1000));
    if (expression.value !== "Rest")
      poseExpression(rig.actor, expression.value, Number(amount.value) / 100);
    previous = now;
    time.value = ((mixer.time % clip.duration) / clip.duration) * 1000;
    render();
    frame = requestAnimationFrame(tick);
  }
  function play(state) {
    playing = state;
    toggle.textContent = state ? "Pause" : "Play";
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    if (playing && rig) {
      previous = performance.now();
      frame = requestAnimationFrame(tick);
    }
  }
  function configure() {
    release();
    details.hidden = select.value === "Bind";
    const missing = document.getElementById("pose-missing");
    missing.hidden = true;
    if (!model) return;
    if (select.value === "Bind") {
      scene.add(model);
      setExpression();
      gaze();
      return;
    }
    scene.remove(model);
    rig = skinCharacter(recipe, model);
    const stored = recipe.poses?.find(
      (p) => poseClipName(p.name) === select.value,
    );
    const absent = stored ? inactiveJoints(rig.bindings, stored.joints) : [];
    if (absent.length) {
      missing.hidden = false;
      missing.textContent =
        absent.length +
        " of " +
        stored.joints.length +
        " saved joint edits are inactive in this outfit or anatomy.";
    }
    scene.add(rig.actor);
    mixer = new AnimationMixer(rig.actor);
    clip = rig.clips.find((c) => c.name === select.value);
    mixer.clipAction(clip).play();
    mixer.setTime(0);
    time.value = 0;
    setExpression();
    overlay();
    play(playing);
    render();
  }
  select.onchange = () => {
    playing = !recipe?.poses?.some(
      (p) => poseClipName(p.name) === select.value,
    );
    configure();
    changed();
  };
  bones.onchange = () => {
    overlay();
    render();
  };
  toggle.onclick = () => play(!playing);
  time.oninput = () => {
    if (rig) {
      play(false);
      mixer.setTime((Number(time.value) / 1000) * clip.duration);
      if (expression.value !== "Rest") setExpression();
      else render();
    }
  };
  return {
    update(form, figure) {
      if (model === figure) return;
      release();
      model = figure;
      recipe = form;
      const last = select.value;
      const roles = [...movementRoles(form.parts).values()],
        names = [
          "Bind",
          ...standardMoves(roles),
          ...creatureMoves(roles),
          ...(form.poses ?? []).map((p) => poseClipName(p.name)),
        ];
      select.replaceChildren(
        ...names.map(
          (name) => new Option(name === "Bind" ? "Rest" : name, name),
        ),
      );
      select.value = names.includes(last) ? last : "Bind";
      let hasFace = false,
        hasEyes = false;
      figure.traverse((o) => {
        if (o.userData.faceSurface) hasFace = true;
        if (o.userData.fittedEyes) hasEyes = true;
      });
      document.getElementById("gaze-tools").hidden = !hasEyes;
      document.getElementById("face-pose-tools").hidden = !hasFace;
      if (!hasFace) expression.value = "Rest";
      configure();
    },
    capture() {
      const resume = Boolean(rig && playing);
      if (rig) play(false);
      const saved = recipe?.poses?.find(
        (p) => poseClipName(p.name) === select.value,
      );
      return {
        name: saved?.name ?? "",
        joints: rig ? captureJoints(rig.bindings, saved?.joints) : [],
        resume: () => {
          if (resume) play(true);
        },
      };
    },
    showPose(name) {
      select.value = poseClipName(name);
      playing = false;
      configure();
      changed();
    },
    get active() {
      return select.value !== "Bind";
    },
    bind() {
      if (select.value !== "Bind") {
        select.value = "Bind";
        configure();
      }
    },
  };
}
