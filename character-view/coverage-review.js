import * as T from "three";

// Render exported region IDs through the same skin and morph transforms.
// This distinguishes uncovered anatomy from a shadow or skin-coloured cloth.
export function garmentCoverage(form, model) {
  const native = Boolean(form.human);
  if (!native && (!form.parts.some((p) => p.bare) || !form.parts.some((p) => p.visibleIn))) return null;
  let names;
  model.traverse((o) => {
    if (!names && o.geometry?.attributes[native ? "_coverage" : "_region"])
      names = native ? o.userData.coverageNames : o.userData.regionNames;
  });
  if (!names) return null;
  const labels = native ? names.map((name, i) => ({ name, bare: i === 1, outer: i >= 2 })) : names.map((id) => {
    const p = form.parts.find((part) => part.id === id);
    return (
      p && {
        name: p.id,
        bare: Boolean(p.bare),
        outer: !p.bare && Boolean(p.visibleIn?.includes(form.outfit)),
      }
    );
  });
  const material = new T.ShaderMaterial({
    vertexShader: `
      attribute float ${native ? "_coverage" : "_region"};
      varying float region;
      #include <common>
      #include <morphtarget_pars_vertex>
      #include <skinning_pars_vertex>
      void main() {
        region = ${native ? "_coverage" : "_region"};
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
    capture(renderer, scene, camera, span) {
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
        renderer.readRenderTargetPixels(
          target,
          0,
          0,
          resolution,
          resolution,
          bytes,
        );
      } finally {
        scene.overrideMaterial = oldMaterial;
        scene.background = oldBackground;
        renderer.setRenderTarget(oldTarget);
      }
      return Uint8Array.from(
        { length: resolution * resolution },
        (_, i) => bytes[i * 4],
      );
    },
    dispose() {
      target.dispose();
      material.dispose();
    },
  };
}

// Skin can already show through a full-detail garment. Report enclosed
// islands separately from reduction errors. A deliberate cutout can also
// enclose skin, so the readings describe visible pixels and their borders.
export function enclosedSkin(mask, size, labels) {
  const visited = new Uint8Array(mask.length), queue = new Uint32Array(mask.length);
  const patches = [];
  for (let start = 0; start < mask.length; start++) {
    if (visited[start] || mask[start] !== 2) continue;
    let at = 0, length = 1, enclosed = true;
    const garments = new Set();
    queue[0] = start; visited[start] = 1;
    while (at < length) {
      const i = queue[at++], y = Math.floor(i/size), x = i%size;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x+dx, ny = y+dy;
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) { enclosed = false; continue; }
        const n = ny*size+nx, id = mask[n];
        if (id < 2) enclosed = false;
        else if (id > 2) garments.add(labels[id-1].name);
        else if (!visited[n]) { visited[n] = 1; queue[length++] = n; }
      }
    }
    if (enclosed && length >= 4) patches.push({ pixels:length, borderingPieces:[...garments].sort() });
  }
  return patches.sort((a,b) => b.pixels-a.pixels).slice(0, 5);
}

// Interior garment pixels are less sensitive to subpixel silhouette and cuff
// changes. Use this comparison only for two detail levels of the same outfit
// and pose, measured with the same camera.
export function exposedSkinPixels(full, game, size, fullLabels, gameLabels) {
  if (full.length !== size * size || game.length !== full.length)
    throw new Error("Coverage masks must use the same square camera.");
  let clothing = 0, skin = 0;
  const changed = new Map();
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      const i = y * size + x;
      const before = full[i], after = game[i];
      if (before < 3 || full[i-1] !== before || full[i+1] !== before ||
          full[i-size] !== before || full[i+size] !== before) continue;
      clothing++;
      if (after === 2) skin++;
      if (fullLabels && after >= 3) {
        const from = fullLabels[before-1].name, to = gameLabels[after-1].name;
        if (from !== to) {
          const pair = JSON.stringify([from, to]);
          changed.set(pair, (changed.get(pair) ?? 0) + 1);
        }
      }
    }
  }
  const layers = [...changed].sort((a,b) => b[1]-a[1]).slice(0, 5).map(([pair, pixels]) => {
    const [fullPiece, gamePiece] = JSON.parse(pair);
    return { fullPiece, gamePiece, pixels };
  });
  return { interiorClothingPixels: clothing, exposedSkinPixels: skin,
    ...(fullLabels ? { layers, fullSkinPatches: enclosedSkin(full, size, fullLabels),
                       gameSkinPatches: enclosedSkin(game, size, gameLabels) } : {}) };
}

export function compareCoverage(previous, current, sameClip) {
  const changes = [];
  if (!previous || !current || previous.resolution !== current.resolution)
    return changes;
  const views = [
    "rest front",
    "rest three-quarter",
    "moving profile",
    "moving rear three-quarter",
  ];
  for (const [view, mask] of current.masks.entries()) {
    if (view >= 2 && !sameClip) continue;
    const old = previous.masks[view],
      counts = new Map();
    for (let i = 0; i < mask.length; i++) {
      const a = previous.labels[old[i] - 1],
        b = current.labels[mask[i] - 1];
      if (!a?.outer || !b?.bare) continue;
      const key = JSON.stringify([a.name, b.name]);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const [key, pixels] of counts) {
      if (pixels < 4) continue;
      const [garment, body] = JSON.parse(key);
      changes.push({ view: views[view], garment, body, pixels });
    }
  }
  return changes.sort((a, b) => b.pixels - a.pixels);
}
