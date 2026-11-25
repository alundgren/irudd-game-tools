import { Vector3 } from "three";
import { triangles, section } from "../character-view/mesh-sections.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { createCharacter, disposeCharacter } from "../character-view/model.js";
import { mhrStudy } from "../examples/mhr-study.js";

const bottom = 0.852,
  step = 0.019,
  levels = 32,
  rays = 32;
function samples(faces, check) {
  const start = check ? 1 : 0,
    end = check ? levels - 2 : levels;
  const slices = [];
  for (let i = start; i < end; i++)
    slices.push(
      section(
        faces,
        bottom + step * (i + (check ? 0.5 : 0)),
        rays,
        check ? 0.5 : 0,
      ),
    );
  return slices;
}
function metrics(source, target) {
  const err = source
    .flatMap((row, i) => row.map((x, j) => Math.abs(x - target[i][j]) * 1000))
    .sort((a, b) => a - b);
  function normal(rows, i, j) {
    const point = (r, k) => {
      const index = (k + rays) % rays;
      const angle = (2 * Math.PI * (index + 0.5)) / rays;
      const radius = rows[r][index];
      return new Vector3(
        radius * Math.sin(angle),
        r * step,
        radius * Math.cos(angle),
      );
    };
    const azimuth = point(i, j + 1).sub(point(i, j - 1));
    const vertical = point(i + 1, j).sub(point(i - 1, j));
    return azimuth.cross(vertical).normalize();
  }
  const angles = [];
  for (let i = 1; i < source.length - 1; i++)
    for (let j = 0; j < rays; j++)
      angles.push(
        (180 / Math.PI) * normal(source, i, j).angleTo(normal(target, i, j)),
      );
  return {
    rays: err.length,
    meanMm: err.reduce((a, b) => a + b) / err.length,
    p95Mm: err[Math.floor(0.95 * (err.length - 1))],
    normalSamples: angles.length,
    meanNormalDegrees: angles.reduce((a, b) => a + b) / angles.length,
  };
}
function surface(fit) {
  const form = mhrStudy(fit),
    root = createCharacter(form, false, true);
  const result = triangles(root);
  disposeCharacter(root);
  return result;
}
export async function fitRig(bytes) {
  const ref = (await new GLTFLoader().parseAsync(bytes, "")).scene;
  const mesh = triangles(ref),
    target = samples(mesh, false),
    check = samples(mesh, true);
  const baseline = surface(null);
  const origin = mhrStudy(null).parts.find((p) => p.id === "body").position;
  const fit = {
    bottom: bottom - origin[1],
    step,
    rows: target.map((row) => row.map(() => 0)),
  };
  const starting = samples(baseline, false);
  const goal = target.map((row, i) => {
    const t = Math.min(1, i / 6, (levels - 1 - i) / 6);
    const w = t * t * (3 - 2 * t);
    return row.map((r, j) => {
      // Above the axilla a lateral ray can exit through the upper arm.
      // Fade that arc back into the native shoulder attachment.
      const side = Math.abs(Math.sin((2 * Math.PI * j) / rays));
      const lateral = Math.max(0, Math.min(1, (side - 0.7) / 0.24));
      const high = Math.max(
        0,
        Math.min(1, (bottom + i * step - 1.245) / 0.085),
      );
      const blend = w * (1 - lateral * high);
      return starting[i][j] + blend * (r - starting[i][j]);
    });
  });
  let current = baseline;
  for (let pass = 0; pass < 4; pass++) {
    const measured = samples(current, false);
    for (let i = 1; i < levels - 1; i++)
      for (let j = 0; j < rays; j++) {
        const delta = goal[i][j] - measured[i][j];
        fit.rows[i][j] = Number(
          Math.max(
            -0.095,
            Math.min(0.095, fit.rows[i][j] + 0.82 * delta),
          ).toFixed(5),
        );
      }
    current = surface(fit);
  }
  const report = {
    floorFrame: "metres, y up, z forward; no scale fitting",
    bottomMetres: bottom,
    topMetres: bottom + (levels - 1) * step,
    levels,
    angularSamples: rays,
    validation:
      "Interleaved heights and azimuths inside the fitted band, same subject and pose",
    before: metrics(samples(baseline, true), check),
    after: metrics(samples(current, true), check),
  };
  return { fit, report };
}
