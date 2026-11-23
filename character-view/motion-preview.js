import { AnimationMixer, SkeletonHelper } from "three";
import { poseExpression } from "./expressions.js";
import { skinCharacter } from "./skin.js";

export function motionPreview(scene, render) {
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
    if (!model) return;
    if (select.value === "Bind") {
      scene.add(model);
      setExpression();
      return;
    }
    scene.remove(model);
    rig = skinCharacter(recipe, model);
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
    playing = true;
    configure();
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
      let hasFace = false;
      figure.traverse((o) => {
        if (o.userData.faceSurface) hasFace = true;
      });
      document.getElementById("face-pose-tools").hidden = !hasFace;
      if (!hasFace) expression.value = "Rest";
      configure();
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
