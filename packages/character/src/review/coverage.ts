import * as T from "three";

export interface CoverageLabel {
  name: string;
  bare: boolean;
  outer: boolean;
}
export interface Masks {
  resolution: number;
  labels: readonly (CoverageLabel | undefined)[];
  masks: readonly Uint8Array[];
}
export function coverageMask(
  attribute: "_coverage" | "_region",
  labels: readonly (CoverageLabel | undefined)[],
) {
  const material = new T.ShaderMaterial({
    vertexShader: `
      attribute float ${attribute};
      varying float region;
      #include <common>
      #include <morphtarget_pars_vertex>
      #include <skinning_pars_vertex>
      void main() {
        region = ${attribute};
        #include <morphinstance_vertex>
        #include <skinbase_vertex>
        #include <begin_vertex>
        #include <morphtarget_vertex>
        #include <skinning_vertex>
        #include <project_vertex>
      }`,
    fragmentShader:
      "varying float region; void main(){gl_FragColor=vec4((region+1.)/255.,0.,0.,1.);}",
  });
  const resolution = 256,
    target = new T.WebGLRenderTarget(resolution, resolution);
  return {
    labels,
    resolution,
    capture(renderer: T.WebGLRenderer, scene: T.Scene, camera: T.OrthographicCamera, span: number) {
      const square = camera.clone();
      Object.assign(square, {
        left: -span / 2,
        right: span / 2,
        top: span / 2,
        bottom: -span / 2,
      });
      square.updateProjectionMatrix();
      const oldTarget = renderer.getRenderTarget(),
        oldMaterial = scene.overrideMaterial,
        oldBackground = scene.background;
      const bytes = new Uint8Array(resolution * resolution * 4);
      try {
        renderer.setRenderTarget(target);
        scene.overrideMaterial = material;
        scene.background = new T.Color(0);
        renderer.render(scene, square);
        renderer.readRenderTargetPixels(target, 0, 0, resolution, resolution, bytes);
      } finally {
        scene.overrideMaterial = oldMaterial;
        scene.background = oldBackground;
        renderer.setRenderTarget(oldTarget);
      }
      return Uint8Array.from({ length: resolution * resolution }, (_, i) => bytes[i * 4] ?? 0);
    },
    dispose() {
      target.dispose();
      material.dispose();
    },
  };
}

export function enclosedSkin(
  mask: Uint8Array,
  size: number,
  labels: readonly (CoverageLabel | undefined)[],
) {
  const visited = new Uint8Array(mask.length),
    queue = new Uint32Array(mask.length);
  const patches = [];
  for (let start = 0; start < mask.length; start++) {
    if (visited[start] || mask[start] !== 2) continue;
    let at = 0,
      length = 1,
      enclosed = true;
    const garments = new Set<string>();
    queue[0] = start;
    visited[start] = 1;
    while (at < length) {
      const i = queue[at++] ?? 0,
        y = Math.floor(i / size),
        x = i % size;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx,
            ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) {
            enclosed = false;
            continue;
          }
          const n = ny * size + nx,
            id = mask[n] ?? 0;
          if (id < 2) enclosed = false;
          else if (id > 2) garments.add(labels[id - 1]?.name ?? "Clothing");
          else if (!visited[n]) {
            visited[n] = 1;
            queue[length++] = n;
          }
        }
    }
    if (enclosed && length >= 4)
      patches.push({ pixels: length, borderingPieces: [...garments].sort() });
  }
  return patches.sort((a, b) => b.pixels - a.pixels).slice(0, 5);
}

export function exposedSkinPixels(
  full: Uint8Array,
  game: Uint8Array,
  size: number,
  fullLabels?: readonly (CoverageLabel | undefined)[],
  gameLabels?: readonly (CoverageLabel | undefined)[],
) {
  if (full.length !== size * size || game.length !== full.length)
    throw new Error("Coverage masks must use the same square camera.");
  let clothing = 0,
    skin = 0;
  const changed = new Map<string, { fullPiece: string; gamePiece: string; pixels: number }>();
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      const i = y * size + x;
      const before = full[i] ?? 0,
        after = game[i] ?? 0;
      if (
        before < 3 ||
        full[i - 1] !== before ||
        full[i + 1] !== before ||
        full[i - size] !== before ||
        full[i + size] !== before
      )
        continue;
      clothing++;
      if (after === 2) skin++;
      if (fullLabels && after >= 3) {
        const from = fullLabels[before - 1]?.name ?? "Clothing",
          to = gameLabels?.[after - 1]?.name ?? "Clothing";
        if (from !== to) {
          const pair = JSON.stringify([from, to]);
          changed.set(pair, {
            fullPiece: from,
            gamePiece: to,
            pixels: (changed.get(pair)?.pixels ?? 0) + 1,
          });
        }
      }
    }
  }
  const layers = [...changed.values()].sort((a, b) => b.pixels - a.pixels).slice(0, 5);
  return {
    interiorClothingPixels: clothing,
    exposedSkinPixels: skin,
    ...(fullLabels && gameLabels
      ? {
          layers,
          fullSkinPatches: enclosedSkin(full, size, fullLabels),
          gameSkinPatches: enclosedSkin(game, size, gameLabels),
        }
      : {}),
  };
}

export function compareCoverage(previous: Masks | null, current: Masks | null, sameClip: boolean) {
  const changes: { view: string; garment: string; body: string; pixels: number }[] = [];
  if (!previous || !current || previous.resolution !== current.resolution) return changes;
  const views = ["rest front", "rest three-quarter", "moving profile", "moving rear three-quarter"];
  for (const [view, mask] of current.masks.entries()) {
    if (view >= 2 && !sameClip) continue;
    const old = previous.masks[view],
      counts = new Map<string, { garment: string; body: string; pixels: number }>();
    if (!old || old.length !== mask.length) continue;
    for (let i = 0; i < mask.length; i++) {
      const a = previous.labels[(old[i] ?? 0) - 1],
        b = current.labels[(mask[i] ?? 0) - 1];
      if (!a?.outer || !b?.bare) continue;
      const key = JSON.stringify([a.name, b.name]);
      counts.set(key, {
        garment: a.name,
        body: b.name,
        pixels: (counts.get(key)?.pixels ?? 0) + 1,
      });
    }
    for (const change of counts.values()) {
      if (change.pixels >= 4) changes.push({ view: views[view] ?? "Unknown view", ...change });
    }
  }
  return changes.sort((a, b) => b.pixels - a.pixels);
}
