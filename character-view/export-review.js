import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { garmentCoverage, compareCoverage } from "./coverage-review.js";
import { exportForm } from "./export-form.js";
import { releaseGLTFScenes } from "./release-gltf.js";

export async function compareExportViews(previous, current) {
  return Promise.all(
    current.map(async (view, index) => {
      const images = await Promise.all(
        [previous[index], view].map(async (v) => {
          const image = new Image();
          image.src = "data:image/jpeg;base64," + v.jpeg;
          await image.decode();
          return image;
        }),
      );
      const sheet = document.createElement("canvas");
      // Keep both views at their original resolution unless the server's JPEG
      // limit requires a smaller sheet for a particularly detailed texture.
      for (const width of [768, 576, 384]) {
        const height = Math.round((width * images[0].height) / images[0].width);
        sheet.width = width;
        sheet.height = (height + 26) * 2;
        const ctx = sheet.getContext("2d");
        ctx.fillStyle = "#263233";
        ctx.fillRect(0, 0, sheet.width, sheet.height);
        for (const [row, img] of images.entries()) {
          const y = row * (height + 26);
          ctx.fillStyle = "white";
          ctx.font = "16px sans-serif";
          ctx.fillText(
            row === 0 ? "Earlier proposal" : "Current proposal to refine",
            8,
            y + 19,
          );
          ctx.drawImage(img, 0, y + 26, width, height);
        }
        const jpeg = sheet.toDataURL("image/jpeg", 0.74).split(",")[1];
        if (jpeg.length <= 170000)
          return {
            ...view,
            name: "Earlier proposal above, current below: " + view.name,
            jpeg,
          };
      }
      throw new Error("The export comparison exceeds the request image limit.");
    }),
  );
}

const angles = [
  { name: "front / clay", direction: [0, 0, 1], clay: true },
  { name: "three-quarter / colour", direction: [0.62, 0.07, 1] },
  { name: "profile / clay", direction: [1, 0, 0], clay: true },
  { name: "rear three-quarter / colour", direction: [-0.7, 0.08, -1] },
];

function poseBounds(model) {
  model.updateMatrixWorld(true);
  return new T.Box3().setFromObject(model, true);
}

export async function inspectGameExport(form, renderer, previous) {
  const { bytes, triangles } = await exportForm(form, {
    game: true,
    motion: true,
    wardrobe: false,
  });
  const gltf = await new GLTFLoader().parseAsync(bytes, "");
  const model = gltf.scene,
    mixer = new T.AnimationMixer(model);
  const previousFrame = previous?.detail.cameraFrame;
  const coverage = garmentCoverage(form, model),
    masks = [];
  const scene = new T.Scene(),
    clay = new T.MeshStandardMaterial({ color: 0xb3b2ac, roughness: 0.9 });
  try {
    scene.background = new T.Color("#e5e8e5");
    scene.add(model, new T.HemisphereLight(0xffffff, 0xa5a6a8, 1.65));
    const light = new T.DirectionalLight(0xfff7e9, 2.2);
    light.position.set(-3, 5, 4);
    scene.add(light);
    const box = poseBounds(model);
    const height = box.max.y - box.min.y;
    const hasArms = form.parts.some((p) =>
      (p.motionRole ?? p.outfitRole ?? p.shape).includes("arm"),
    );
    const preferred = hasArms
      ? ["Reach", "Walk"]
      : ["Swim", "Slither", "Fly", "Walk"];
    const clip =
      preferred
        .map((name) => gltf.animations.find((c) => c.name === name))
        .find(Boolean) ?? gltf.animations[0];
    const sample = clip
      ? clip.duration * (clip.name === "Walk" ? 0.25 : 0.5)
      : 0;
    function pose(moving) {
      mixer.stopAllAction();
      if (moving && clip) {
        mixer.clipAction(clip).reset().play();
        mixer.setTime(sample);
      }
      model.updateMatrixWorld(true);
    }
    pose(true);
    box.union(poseBounds(model));
    const center = box.getCenter(new T.Vector3()),
      size = box.getSize(new T.Vector3());
    const directions = angles.map((a) =>
      new T.Vector3(...a.direction).normalize(),
    );
    // Project the common posed/rest bounding box onto each camera's axes.
    let extent = 0.05,
      fitsPrevious = Boolean(previousFrame);
    const offset = previousFrame
      ? center.clone().sub(new T.Vector3(...previousFrame.center))
      : null;
    const up = new T.Vector3(0, 1, 0);
    for (const dir of directions) {
      const right = up.clone().cross(dir).normalize(),
        vertical = dir.clone().cross(right);
      for (const v of [right, vertical]) {
        const width =
          Math.abs(v.x) * size.x +
          Math.abs(v.y) * size.y +
          Math.abs(v.z) * size.z;
        extent = Math.max(extent, width);
        if (
          offset &&
          2 * Math.abs(offset.dot(v)) + width > previousFrame.span * 0.98
        )
          fitsPrevious = false;
      }
    }
    const source = renderer.domElement,
      side = Math.min(source.width, source.height);
    const aspect = source.width / source.height;
    if (fitsPrevious) center.fromArray(previousFrame.center);
    const span = fitsPrevious ? previousFrame.span : extent * 1.08;
    const cameraFrame = { center: center.toArray(), span };
    const half = (span * 0.5) / Math.min(1, aspect);
    const cam = new T.OrthographicCamera(
      -half * aspect,
      half * aspect,
      half,
      -half,
      0.01,
      Math.max(100, size.length() * 6),
    );
    const views = [],
      tile = 384;
    for (let pair = 0; pair < 2; pair++) {
      pose(pair === 1);
      const shot = document.createElement("canvas");
      shot.width = tile * 2;
      shot.height = tile + 28;
      const ctx = shot.getContext("2d");
      const frame =
        pair && clip ? clip.name + " " + sample.toFixed(2) + " s" : "Rest";
      ctx.fillStyle = "#263233";
      ctx.fillRect(0, 0, shot.width, shot.height);
      for (let col = 0; col < 2; col++) {
        const index = pair * 2 + col,
          angle = angles[index];
        cam.position
          .copy(center)
          .addScaledVector(directions[index], size.length() * 2 + 1);
        cam.lookAt(center);
        scene.overrideMaterial = angle.clay ? clay : null;
        renderer.render(scene, cam);
        ctx.drawImage(
          source,
          (source.width - side) / 2,
          (source.height - side) / 2,
          side,
          side,
          col * tile,
          0,
          tile,
          tile,
        );
        ctx.fillStyle = "white";
        ctx.font = "16px sans-serif";
        if (coverage) masks.push(coverage.capture(renderer, scene, cam, span));
        ctx.fillText(frame + " | " + angle.name, col * tile + 8, tile + 20);
      }
      views.push({
        name:
          frame +
          " / " +
          angles
            .slice(pair * 2, pair * 2 + 2)
            .map((a) => a.name)
            .join(", "),
        height,
        jpeg: shot.toDataURL("image/jpeg", 0.77).split(",")[1],
      });
    }
    const coverageData = coverage && {
      resolution: coverage.resolution,
      labels: coverage.labels,
      masks,
    };
    const check =
      fitsPrevious && coverageData && previous.coverageData
        ? {
            resolution: coverage.resolution,
            changes: compareCoverage(
              previous.coverageData,
              coverageData,
              clip?.name === previous.detail.clip &&
                Math.abs(sample - previous.detail.timeSeconds) < 0.001,
            ),
          }
        : null;
    return {
      views,
      coverageData,
      detail: {
        ...(check ? { coverage: check } : {}),
        source: "Reimported game GLB",
        triangles,
        restHeightMetres: height,
        clip: clip?.name ?? null,
        timeSeconds: sample,
        cameraFrame,
        matchedPreviousFrame: fitsPrevious,
        attachments: views.map((v) => v.name),
      },
    };
  } finally {
    mixer.stopAllAction();
    mixer.uncacheRoot(model);
    coverage?.dispose();
    clay.dispose();
    releaseGLTFScenes(gltf.scenes);
  }
}
