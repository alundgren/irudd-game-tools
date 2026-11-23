import { AnimationMixer, LoopOnce, VectorKeyframeTrack } from "three";

// Measure the skinned sole, talon or hem rather than assuming that the
// ankle joint lies on the floor. At each motion key, translate the whole
// actor by the residual. Limb IK continues to determine its local shape.
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
    const action = mixer.clipAction(clip);
    action.clampWhenFinished = true;
    action.setLoop(LoopOnce, 1).play();
    const times = [],
      positions = [];
    for (let k = 0; k <= 32; k++) {
      const t = (k / 32) * clip.duration;
      action.time = t;
      mixer.update(0);
      actor.updateMatrixWorld(true);
      mesh.skeleton.update();
      const matrices = mesh.skeleton.boneMatrices;
      let low = Infinity;
      for (const i of candidates) {
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
      times.push(t);
      positions.push(
        root.position.x,
        root.position.y + min.y - low,
        root.position.z,
      );
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
