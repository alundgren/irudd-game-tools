import * as T from "three";

export function alignGroundContacts(
  actor: T.Object3D,
  mesh: T.SkinnedMesh,
  root: T.Bone,
  clips: ReadonlyArray<T.AnimationClip>,
): void {
  const pos = mesh.geometry.getAttribute("position");
  const joints = mesh.geometry.getAttribute("skinIndex");
  const weights = mesh.geometry.getAttribute("skinWeight");
  mesh.geometry.computeBoundingBox();
  const box = mesh.geometry.boundingBox;
  if (!box) return;
  const { min, max } = box;
  const band = min.y + (max.y - min.y) * 0.36 + 0.02;
  const candidates: number[] = [];
  for (let i = 0; i < pos.count; i++) if (pos.getY(i) <= band) candidates.push(i);
  if (!candidates.length) return;
  const jointArray = joints.array;
  const weightArray = weights.array;
  const mixer = new T.AnimationMixer(actor);
  for (const clip of clips) {
    const airborne = ["Fly", "Swim"].includes(clip.name);
    let lowest = Infinity;
    const action = mixer.clipAction(clip);
    action.clampWhenFinished = true;
    action.setLoop(T.LoopOnce, 1).play();
    const times: number[] = [];
    const positions: number[] = [];
    const samples = airborne ? 40 : 32;
    for (let k = 0; k <= samples; k++) {
      const t = (k / samples) * clip.duration;
      action.time = t;
      mixer.update(0);
      actor.updateMatrixWorld(true);
      mesh.skeleton.update();
      const matrices = mesh.skeleton.boneMatrices;
      if (!matrices) throw new Error("The skeleton has no bone matrices.");
      let low = Infinity;
      const count = airborne ? pos.count : candidates.length;
      for (let n = 0; n < count; n++) {
        const i = airborne ? n : (candidates[n] ?? 0);
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);
        let result = 0;
        for (let j = 0; j < 4; j++) {
          const w = weightArray[4 * i + j] ?? 0;
          if (!w) continue;
          const a = (jointArray[4 * i + j] ?? 0) * 16;
          result +=
            w *
            (x * (matrices[a + 1] ?? 0) +
              y * (matrices[a + 5] ?? 0) +
              z * (matrices[a + 9] ?? 0) +
              (matrices[a + 13] ?? 0));
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
      for (let i = 1; i < positions.length; i += 3) positions[i] = (positions[i] ?? 0) + lift;
    }
    action.stop();
    mixer.uncacheClip(clip);
    const track = clip.tracks.findIndex((x) => x.name === root.name + ".position");
    clip.tracks[track] = new T.VectorKeyframeTrack(root.name + ".position", times, positions);
    clip.optimize();
  }
  mixer.uncacheRoot(actor);
  actor.updateMatrixWorld(true);
  mesh.skeleton.update();
}
