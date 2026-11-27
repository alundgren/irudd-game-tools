import * as T from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  fittingSkin,
  eyeBalls,
  humanEyes,
  smoothHumanSurface,
  refineFaceForm,
  skinBoneCorners,
  boneNames,
  regionOfBone,
  vertexAreas,
  summarise,
  referenceTree,
  measureReferenceView,
  type FitRegion,
  type FittedAdult,
  type HumanBody,
  type ReferenceMesh,
} from "@irudd/character/human/reference";

const frames: Record<FitRegion, readonly [number, number, number]> = {
  whole: [0.5, 1.1, 0.84],
  head: [0.937, 0.174, 0.142],
  trunk: [0.66, 0.52, 0.46],
  arms: [0.68, 0.56, 0.9],
  legs: [0.27, 0.62, 0.5],
};
export function referenceViewport(
  stage: HTMLElement,
  canvas: HTMLCanvasElement,
  changed: () => void,
) {
  const renderer = new T.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setScissorTest(true);
  const scene = new T.Scene(),
    camera = new T.OrthographicCamera(-1, 1, 1, -1, 0.01, 40);
  scene.background = new T.Color(0xdfe5df);
  const light = new T.DirectionalLight(0xfffaf0, 2.1);
  scene.add(
    new T.HemisphereLight(0xffffff, 0x737a72, 1.05),
    light,
    light.target,
    new T.GridHelper(3, 30, 0x93a297, 0xc3ccc3),
  );
  const orbit = new OrbitControls(camera, canvas);
  orbit.minZoom = 0.5;
  orbit.maxZoom = 14;
  orbit.screenSpacePanning = true;
  const clay = new T.MeshStandardMaterial({ color: 0xb9b3a6, roughness: 0.9 });
  const ghost = new T.MeshStandardMaterial({
    color: 0x3f7fb5,
    roughness: 0.85,
    transparent: true,
    depthWrite: false,
  });
  const heat = new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 });
  const reference = new T.Mesh(new T.BufferGeometry(), clay),
    original = new T.Mesh(new T.BufferGeometry(), clay),
    now = new T.Mesh(new T.BufferGeometry(), clay);
  const hidden = new T.Mesh(
    new T.BufferGeometry(),
    new T.MeshBasicMaterial({
      color: 0x8e685e,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      side: T.DoubleSide,
    }),
  );
  scene.add(reference, original, now, hidden);
  const dots = new T.Group();
  scene.add(dots);
  let mode = "side",
    before = false,
    opacity = 0.6,
    wipe = 0.5,
    region: FitRegion = "whole",
    height = 1.72;
  let has = false,
    headZ = 0;
  function size() {
    const w = stage.clientWidth,
      h = stage.clientHeight;
    if (!w || !h) return;
    const panes = mode === "side" && has ? 2 : 1;
    const [, high, wide] = frames[region];
    const refWidth =
      region === "whole" && reference.geometry.boundingBox
        ? reference.geometry.boundingBox.getSize(new T.Vector3()).x * 1.06
        : 0;
    const extent = Math.max(high * height, (Math.max(wide * height, refWidth) * h * panes) / w);
    camera.top = extent / 2;
    camera.bottom = -camera.top;
    camera.right = (camera.top * w) / panes / h;
    camera.left = -camera.right;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }
  function render() {
    const w = stage.clientWidth,
      h = stage.clientHeight;
    if (!w || !h) return;
    changed();
    light.position.set(-2.2, 2.4, 3).applyQuaternion(camera.quaternion).add(orbit.target);
    light.target.position.copy(orbit.target);
    const shown = before ? original : now;
    original.visible = now.visible = false;
    shown.material = mode === "deviation" && has ? heat : clay;
    ghost.opacity = opacity;
    ghost.transparent = opacity < 1;
    ghost.depthWrite = opacity >= 1;
    reference.material = mode === "overlay" ? ghost : clay;
    const panes = has && (mode === "side" || mode === "wipe") ? 2 : 1;
    const boundary = Math.round(w * (mode === "wipe" ? wipe : 0.5));
    for (let i = 0; i < panes; i++) {
      const left = i === 0 ? 0 : boundary,
        right = panes === 1 || i === 1 ? w : boundary;
      if (right <= left) continue;
      reference.visible = has && (panes === 2 ? i === 0 : mode === "overlay");
      shown.visible = panes === 1 || i === 1;
      hidden.visible = reference.visible && mode === "side";
      for (const dot of dots.children)
        dot.visible =
          dot.userData["side"] === "both" ||
          dot.userData["side"] === (reference.visible ? "reference" : "human");
      renderer.setViewport(mode === "wipe" ? 0 : left, 0, mode === "wipe" ? w : right - left, h);
      renderer.setScissor(left, 0, right - left, h);
      renderer.render(scene, camera);
    }
  }
  orbit.addEventListener("change", render);
  new ResizeObserver(() => {
    size();
    render();
  }).observe(stage);
  function look(angle: number) {
    camera.position
      .copy(orbit.target)
      .add(new T.Vector3(6 * Math.sin(angle), 0, 6 * Math.cos(angle)));
    orbit.update();
    render();
  }
  function frame(next: FitRegion, angle = orbit.getAzimuthalAngle()) {
    region = next;
    orbit.target.set(0, frames[next][0] * height, next === "head" ? headZ : 0);
    camera.zoom = 1;
    size();
    look(angle);
  }
  function geometry(mesh: ReferenceMesh) {
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.BufferAttribute(mesh.positions, 3));
    g.setIndex(new T.BufferAttribute(mesh.indices, 1));
    g.computeVertexNormals();
    g.computeBoundingBox();
    return g;
  }
  function setReference(mesh: ReferenceMesh | undefined, cropped?: ReferenceMesh) {
    hidden.geometry.dispose();
    hidden.geometry = cropped ? geometry(cropped) : new T.BufferGeometry();
    has = !!mesh;
    reference.geometry.dispose();
    reference.geometry = mesh ? geometry(mesh) : new T.BufferGeometry();
    size();
  }
  let latest: ReturnType<typeof smoothHumanSurface> | undefined;
  let boneCorners: number[][] | undefined;
  const headBone = boneNames.indexOf("head");
  function actor(
    which: "now" | "original",
    body: HumanBody,
    adult: FittedAdult,
    tree?: ReturnType<typeof referenceTree>,
    headOnly = false,
    mask?: (p: T.Vector3, d: number) => boolean,
  ) {
    const skin = fittingSkin(body, adult),
      s = refineFaceForm(body, smoothHumanSurface(body, skin));
    const mesh = which === "now" ? now : original;
    const indices = s.indices.subarray(0, 3 * s.bodyTriangles);
    mesh.geometry.dispose();
    mesh.geometry = geometry({ positions: s.positions, indices });
    const old = mesh.children[0];
    if (old instanceof T.Mesh && old.geometry instanceof T.BufferGeometry) {
      old.geometry.dispose();
      mesh.remove(old);
    }
    const eyes = humanEyes(mesh, eyeBalls(skin.positions, skin.eyeGroups, [0, 0, 0]), () => clay, {
      skin: "#b9b3a6",
      age: adult.human.age ?? 0,
      plain: true,
      scale: skin.height / 1.72,
    });
    if (eyes.material instanceof T.Material) eyes.material.dispose();
    eyes.material = clay;
    mesh.add(eyes);
    if (which === "now") {
      latest = s;
      height = Math.max(s.height, reference.geometry.boundingBox?.getSize(new T.Vector3()).y ?? 0);
      let lo = Infinity,
        hi = -Infinity;
      for (let v = 0; v < skin.bodyVertices; v++)
        if (skin.boneIndices[v * 4] === headBone) {
          lo = Math.min(lo, skin.positions[3 * v + 2] ?? 0);
          hi = Math.max(hi, skin.positions[3 * v + 2] ?? 0);
        }
      headZ = (lo + hi) / 2;
    }
    const samples: Record<FitRegion, number[]> = {
      whole: [],
      head: [],
      trunk: [],
      arms: [],
      legs: [],
    };
    let totalArea = 0,
      hiddenArea = 0;
    if (tree) {
      const area = mask ? vertexAreas(s.positions, indices) : undefined;
      const p = new T.Vector3(),
        shade = new T.Color(),
        cool = new T.Color(0x2f6fb3),
        even = new T.Color(0xe9e6dc),
        warm = new T.Color(0xc6452d);
      const colors = new Float32Array(s.positions.length);
      const distances = new Float64Array(s.positions.length / 3).fill(NaN);
      const excluded = new Uint8Array(distances.length);
      boneCorners ??= skinBoneCorners(s);
      boneCorners.forEach((corners, bone) => {
        const chosen = !headOnly || bone === headBone;
        const region = regionOfBone(boneNames[bone] ?? "");
        const visited = new Set<number>();
        for (const corner of corners) {
          const v = indices[corner] ?? 0;
          if (!chosen) {
            if (!Number.isFinite(distances[v])) shade.setHex(0xb9b3a6).toArray(colors, v * 3);
            continue;
          }
          if (!Number.isFinite(distances[v])) {
            const near = tree.nearest(p.fromArray(s.positions, 3 * v));
            if (!near) continue;
            distances[v] = near.signed;
            excluded[v] = mask?.(p, near.signed) ? 1 : 0;
            if (area) {
              totalArea += area[v] ?? 0;
              if (excluded[v]) hiddenArea += area[v] ?? 0;
            }
            if (excluded[v]) shade.setHex(0x8f918a);
            else
              shade.lerpColors(
                even,
                near.signed < 0 ? cool : warm,
                Math.min(1, Math.abs(near.signed) / 0.02),
              );
            shade.toArray(colors, v * 3);
          }
          const key = v * 65536 + (s.uvFaces[corner] ?? 0);
          if (excluded[v] || visited.has(key)) continue;
          visited.add(key);
          const distance = distances[v] ?? 0;
          samples[region].push(distance);
          if (!headOnly) samples.whole.push(distance);
        }
      });
      mesh.geometry.setAttribute("color", new T.BufferAttribute(colors, 3));
    }
    const regions = Object.fromEntries(
      Object.entries(samples).map(([key, list]) => [key, summarise(list)]),
    );
    return { regions, hiddenShare: totalArea ? hiddenArea / totalArea : 0 };
  }
  function markers(
    points: readonly { point: T.Vector3; side: "reference" | "human" | "both"; color: number }[],
  ) {
    for (const child of dots.children) {
      if (
        child instanceof T.Mesh &&
        child.geometry instanceof T.SphereGeometry &&
        child.material instanceof T.MeshBasicMaterial
      ) {
        child.geometry.dispose();
        child.material.dispose();
      }
    }
    dots.clear();
    for (const mark of points) {
      const dot = new T.Mesh(
        new T.SphereGeometry(0.0025, 10, 8),
        new T.MeshBasicMaterial({ color: mark.color, depthTest: false }),
      );
      dot.position.copy(mark.point);
      dot.userData["side"] = mark.side;
      dot.renderOrder = 10;
      dots.add(dot);
    }
    render();
  }
  function pick(event: PointerEvent) {
    const rect = canvas.getBoundingClientRect(),
      x = event.clientX - rect.left,
      y = event.clientY - rect.top;
    const side = x < rect.width / 2 ? "reference" : "human";
    const ray = new T.Raycaster();
    ray.setFromCamera(
      new T.Vector2(2 * ((x % (rect.width / 2)) / (rect.width / 2)) - 1, 1 - (2 * y) / rect.height),
      camera,
    );
    const hit = ray.intersectObject(
      side === "reference" ? reference : before ? original : now,
      false,
    )[0];
    if (!hit || hit.faceIndex == null) return;
    return {
      side,
      point: hit.point,
      face: hit.faceIndex,
      corners: hit.face ? ([hit.face.a, hit.face.b, hit.face.c] as const) : undefined,
      shares: hit.barycoord?.clone(),
      quad: latest?.parentFaces[hit.faceIndex],
      latest,
    };
  }
  return {
    actor,
    setReference,
    frame,
    look,
    pick,
    markers,
    render,
    settings(view: string, originalShape: boolean, alpha: number, coverage: number) {
      mode = view;
      before = originalShape;
      opacity = alpha;
      wipe = coverage;
      size();
      render();
    },
    score: () => measureReferenceView(renderer, camera, reference, original, now),
    cameraUp: () => new T.Vector3(0, 1, 0).applyQuaternion(camera.quaternion),
  };
}
