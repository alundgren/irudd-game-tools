import { required } from "./required.js";
import {
  Color,
  DoubleSide,
  MeshDepthMaterial,
  NearestFilter,
  RGBADepthPacking,
  Scene,
  Vector4,
  WebGLRenderTarget,
  type WebGLRenderer,
  type OrthographicCamera,
  type Object3D,
} from "three";

function background(p: Uint8Array, i: number) {
  return (
    (p[i] ?? 0) === 255 &&
    (p[i + 1] ?? 0) === 255 &&
    (p[i + 2] ?? 0) === 255 &&
    (p[i + 3] ?? 0) === 255
  );
}
function depth(p: Uint8Array, i: number) {
  return (
    (p[i] ?? 0) / 256 +
    (p[i + 1] ?? 0) / 65536 +
    (p[i + 2] ?? 0) / 16777216 +
    (p[i + 3] ?? 0) / (255 * 16777216)
  );
}
export function compareDepthMaps(reference: Uint8Array, candidate: Uint8Array, clipRange: number) {
  let union = 0,
    sum = 0;
  const errors = [];
  for (let i = 0; i < reference.length; i += 4) {
    const a = !background(reference, i),
      b = !background(candidate, i);
    if (a || b) union++;
    if (a && b) {
      const mm = Math.abs(depth(reference, i) - depth(candidate, i)) * clipRange * 1000;
      sum += mm;
      errors.push(mm);
    }
  }
  errors.sort((a, b) => a - b);
  return {
    overlap: union ? errors.length / union : null,
    meanMm: errors.length ? sum / errors.length : null,
    p95Mm: errors.length
      ? (errors[Math.min(errors.length - 1, Math.floor(errors.length * 0.95))] ?? 0)
      : null,
    sharedPixels: errors.length,
    unionPixels: union,
  };
}

export function compareViewContours(
  maps: Uint8Array[],
  width: number,
  height: number,
  range: number,
  pixelX: number,
  pixelY: number,
) {
  const stepX = Math.round(0.0025 / pixelX),
    stepY = Math.round(0.0025 / pixelY);
  if (Math.max(pixelX, pixelY) > 0.001 || Math.min(stepX, stepY) < 1) return null;
  if (stepX * 2 >= width || stepY * 2 >= height) return null;
  const values = maps.map((bytes) => {
    const z = new Float64Array(width * height);
    for (let i = 0; i < z.length; i++)
      z[i] = background(bytes, 4 * i) ? NaN : depth(bytes, 4 * i) * range;
    return z;
  });
  const scores = maps
    .slice(1)
    .map((): { angles: number[]; relief: number[] } => ({ angles: [], relief: [] }));
  const slopes = new Float64Array(3 * maps.length);
  const axes = [
    [1, stepX],
    [width, stepY],
  ] as const;
  let pixels = 0;
  for (let y = stepY; y < height - stepY; y++) {
    pixel: for (let x = stepX; x < width - stepX; x++) {
      const i = y * width + x;
      for (let j = 0; j < values.length; j++) {
        const z = required(values[j]),
          centre = z[i] ?? 0;
        if (!Number.isFinite(centre)) continue pixel;
        for (const [stride, count] of axes) {
          for (let k = -count; k < count; k++) {
            if (!(Math.abs((z[i + (k + 1) * stride] ?? 0) - (z[i + k * stride] ?? 0)) <= 0.004))
              continue pixel;
          }
        }
        slopes[3 * j] = ((z[i + 1] ?? 0) - (z[i - 1] ?? 0)) / (2 * pixelX);
        slopes[3 * j + 1] = ((z[i + width] ?? 0) - (z[i - width] ?? 0)) / (2 * pixelY);
        slopes[3 * j + 2] =
          centre -
          0.25 *
            ((z[i - stepX] ?? 0) +
              (z[i + stepX] ?? 0) +
              (z[i - width * stepY] ?? 0) +
              (z[i + width * stepY] ?? 0));
      }
      pixels++;
      const refLength = Math.hypot(slopes[0] ?? 0, slopes[1] ?? 0, 1);
      for (let j = 1; j < maps.length; j++) {
        const dx = slopes[3 * j] ?? 0,
          dy = slopes[3 * j + 1] ?? 0;
        const cos =
          ((slopes[0] ?? 0) * dx + (slopes[1] ?? 0) * dy + 1) / (refLength * Math.hypot(dx, dy, 1));
        required(scores[j - 1]).angles.push(
          (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI,
        );
        required(scores[j - 1]).relief.push(
          1000 * Math.abs((slopes[3 * j + 2] ?? 0) - (slopes[2] ?? 0)),
        );
      }
    }
  }
  if (pixels < 20) return null;
  return scores.map(({ angles, relief }) => ({
    normalMeanDeg: angles.reduce((sum, angle) => sum + angle, 0) / pixels,
    reliefErrorP95Mm: relief.sort((a, b) => a - b)[Math.floor(0.95 * (pixels - 1))] ?? 0,
    pixels,
  }));
}

export function measureReferenceView(
  renderer: WebGLRenderer,
  camera: OrthographicCamera,
  reference: Object3D,
  original: Object3D,
  fitted: Object3D,
) {
  const aspect = (camera.right - camera.left) / (camera.top - camera.bottom);
  const w = Math.max(1, Math.round(384 * Math.min(1, aspect)));
  const h = Math.max(1, Math.round(384 * Math.min(1, 1 / aspect)));
  const target = new WebGLRenderTarget(w, h, {
    minFilter: NearestFilter,
    magFilter: NearestFilter,
  });
  const material = new MeshDepthMaterial({ depthPacking: RGBADepthPacking, side: DoubleSide });
  const oldTarget = renderer.getRenderTarget(),
    color = renderer.getClearColor(new Color());
  const alpha = renderer.getClearAlpha(),
    test = renderer.getScissorTest();
  const viewport = renderer.getViewport(new Vector4()),
    scissor = renderer.getScissor(new Vector4());
  function capture(object: Object3D) {
    const scene = new Scene(),
      model = object.clone(true);
    model.visible = true;
    scene.add(model);
    scene.overrideMaterial = material;
    renderer.clear();
    renderer.render(scene, camera);
    const bytes = new Uint8Array(w * h * 4);
    renderer.readRenderTargetPixels(target, 0, 0, w, h, bytes);
    return bytes;
  }
  try {
    renderer.setRenderTarget(target);
    renderer.setScissorTest(false);
    renderer.setClearColor(0xffffff, 1);
    const ref = capture(reference),
      start = capture(original),
      result = capture(fitted);
    const range = camera.far - camera.near;
    const contours = compareViewContours(
      [ref, start, result],
      w,
      h,
      range,
      (camera.right - camera.left) / (w * camera.zoom),
      (camera.top - camera.bottom) / (h * camera.zoom),
    );
    return {
      width: w,
      height: h,
      original: { ...compareDepthMaps(ref, start, range), contours: contours?.[0] ?? null },
      fitted: { ...compareDepthMaps(ref, result, range), contours: contours?.[1] ?? null },
    };
  } finally {
    renderer.setRenderTarget(oldTarget);
    renderer.setClearColor(color, alpha);
    renderer.setViewport(viewport);
    renderer.setScissor(scissor);
    renderer.setScissorTest(test);
    target.dispose();
    material.dispose();
  }
}
