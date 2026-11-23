import {
  AnimationClip,
  Box3,
  MathUtils,
  Quaternion,
  QuaternionKeyframeTrack,
  Vector3,
  VectorKeyframeTrack,
} from "three";

export function standardMoves(roles) {
  const set = new Set(roles);
  return set.has("axial spine") &&
    !["thigh", "shin", "foot"].some((r) => set.has(r))
    ? ["Idle", "Reach"]
    : ["Idle", "Walk", "Crouch", "Reach"];
}
export function creatureMoves(roles) {
  const set = new Set(roles),
    moves = [];
  if (set.has("wing")) moves.push("Fly");
  if (["tail", "fin", "axial spine"].some((r) => set.has(r)))
    moves.push("Swim");
  if (set.has("axial spine")) moves.push("Slither", "Coil");
  return moves;
}
const up = new Vector3(0, 1, 0),
  side = new Vector3(1, 0, 0),
  forward = new Vector3(0, 0, 1);
function bendAxis(direction, toward) {
  const axis = new Vector3().crossVectors(direction, toward);
  return axis.lengthSq() < 1e-6 ? forward : axis.normalize();
}
export function creatureClips(root, regions) {
  const values = [...regions.values()],
    box = new Box3();
  for (const s of values) box.union(s.bounds);
  const size = box.getSize(new Vector3()),
    span = Math.max(size.x, size.y, size.z);
  return creatureMoves(values.map((s) => s.role)).map((name) => {
    const period = MathUtils.clamp(
      (name === "Fly" ? 0.83 : name === "Swim" ? 1.45 : 1.76) *
        Math.sqrt(Math.max(0.15, span) / 1.4),
      0.55,
      3.2,
    );
    const time = [],
      position = [],
      tracks = new Map(),
      q = new Quaternion();
    function rotate(bone, axis, angle) {
      q.setFromAxisAngle(axis, angle);
      if (!tracks.has(bone)) tracks.set(bone, []);
      tracks.get(bone).push(q.x, q.y, q.z, q.w);
    }
    for (let frame = 0; frame <= 40; frame++) {
      const t = frame / 40,
        phase = t * Math.PI * 2,
        sin = Math.sin(phase);
      time.push(t * period);
      const lift =
        name === "Fly"
          ? size.y * (0.18 + 0.065 * Math.cos(phase))
          : name === "Swim"
            ? Math.max(0.065 * span, 0.12 * size.y) +
              0.025 * size.y * Math.sin(phase)
            : 0;
      position.push(0, lift, 0);
      for (const s of values) {
        const { points, bones, role } = s,
          n = bones.length;
        if ((role === "axial spine" || role === "tail") && n > 1) {
          // Each joint contributes the difference between successive desired
          // headings, so waves travel down a long spine without accumulating turns.
          const amplitude =
            name === "Slither" ? 0.64 : name === "Swim" ? 0.52 : 0.17;
          const cycles = role === "tail" ? 0.72 : 1.16,
            lag = role === "tail" ? 0.62 : 0;
          for (let j = 0; j < n; j++) {
            const station = j / (n - 1),
              previous = (j - 1) / (n - 1);
            const direction = points[Math.min(n - 1, j + 1)]
              .clone()
              .sub(points[Math.min(n - 2, j)])
              .normalize();
            if (name === "Coil") {
              rotate(
                bones[j],
                up,
                j
                  ? (1.48 * Math.PI * (1 - Math.cos(phase)) * 0.5) / (n - 1)
                  : 0,
              );
              continue;
            }
            const heading = (v) =>
              amplitude *
              (0.44 + 0.56 * Math.max(0, v)) *
              Math.sin(phase - v * cycles * 2 * Math.PI - lag);
            rotate(
              bones[j],
              bendAxis(direction, side),
              heading(station) - (j ? heading(previous) : 0),
            );
          }
        } else if ((role === "wing" || role === "fin") && n > 1) {
          const appendage = points.at(-1).clone().sub(points[0]).normalize(),
            axis = bendAxis(appendage, up);
          const strength =
            name === "Fly" ? 0.69 : name === "Swim" ? 0.31 : 0.06;
          for (let j = 0; j < n; j++)
            rotate(
              bones[j],
              axis,
              strength * (j === 0 ? 1 : 0.4) * Math.sin(phase - j * 0.72) -
                (name === "Fly" && j === 0 ? 0.08 : 0),
            );
        } else if (role === "thigh" || role === "shin") {
          if (name === "Fly")
            rotate(
              bones[0],
              side,
              role === "thigh" ? -0.28 + 0.065 * sin : 0.52,
            );
          if (name === "Swim")
            rotate(bones[0], side, (points[0].x >= 0 ? 1 : -1) * 0.28 * sin);
        } else if (role === "torso" && name !== "Slither")
          rotate(
            bones[0],
            side,
            (name === "Fly" ? -0.045 : -0.1) + 0.045 * sin,
          );
      }
    }
    const animation = [
      new VectorKeyframeTrack(root.name + ".position", time, position),
    ];
    for (const [bone, v] of tracks)
      animation.push(
        new QuaternionKeyframeTrack(bone.name + ".quaternion", time, v),
      );
    const clip = new AnimationClip(name, period, animation);
    clip.optimize();
    return clip;
  });
}
