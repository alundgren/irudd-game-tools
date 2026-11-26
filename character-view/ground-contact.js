import { AnimationMixer, LoopOnce, VectorKeyframeTrack } from "three";

export function alignGroundContacts(actor, mesh, root, clips) {
  const pos = mesh.geometry.attributes.position,
    joints = mesh.geometry.attributes.skinIndex,
    weights = mesh.geometry.attributes.skinWeight;
  mesh.geometry.computeBoundingBox();
  const { min, max } = mesh.geometry.boundingBox,
    band = min.y + (max.y - min.y) * 0.36 + 0.02;
  const candidates = [];
  for (let i = 0; i < pos.count; i++)
    if (pos.getY(i) <= band) candidates.push(i);
  if (!candidates.length) return;
  const mixer = new AnimationMixer(actor);
  for (const clip of clips) {
    const airborne = ["Fly", "Swim"].includes(clip.name);
    let lowest = Infinity;
    const action = mixer.clipAction(clip);
    action.clampWhenFinished = true;
    action.setLoop(LoopOnce, 1).play();
    const times = [],
      positions = [];
    const samples = airborne ? 40 : 32;
    for (let k = 0; k <= samples; k++) {
      const t = (k / samples) * clip.duration;
      action.time = t;
      mixer.update(0);
      actor.updateMatrixWorld(true);
      mesh.skeleton.update();
      const matrices = mesh.skeleton.boneMatrices;
      let low = Infinity;
      const count = airborne ? pos.count : candidates.length;
      for (let n = 0; n < count; n++) {
        const i = airborne ? n : candidates[n];
        const x = pos.getX(i),
          y = pos.getY(i),
          z = pos.getZ(i);
        let result = 0;
        for (let j = 0; j < 4; j++) {
          const w = weights.array[4 * i + j];
          if (!w) continue;
          const a = joints.array[4 * i + j] * 16;
          result +=
            w *
            (x * matrices[a + 1] +
              y * matrices[a + 5] +
              z * matrices[a + 9] +
              matrices[a + 13]);
        }
        low = Math.min(low, result);
      }
      lowest = Math.min(lowest, low);
      times.push(t);
      positions.push(
        root.position.x,
        airborne ? root.position.y : root.position.y + min.y - low,
        root.position.z,
      );
    }
    if (airborne) {
      const lift = Math.max(0, min.y + 0.035 * (max.y - min.y) - lowest);
      for (let i = 1; i < positions.length; i += 3) positions[i] += lift;
    }
    action.stop();
    mixer.uncacheClip(clip);
    const track = clip.tracks.findIndex(
      (x) => x.name === root.name + ".position",
    );
    clip.tracks[track] = new VectorKeyframeTrack(
      root.name + ".position",
      times,
      positions,
    );
    clip.optimize();
  }
  mixer.uncacheRoot(actor);
  actor.updateMatrixWorld(true);
  mesh.skeleton.update();
}
