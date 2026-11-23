import * as T from "three";

// Render exported region IDs through the same skin and morph transforms.
// This distinguishes uncovered anatomy from a shadow or skin-coloured cloth.
export function garmentCoverage(form, model) {
  if (!form.parts.some((p) => p.bare) || !form.parts.some((p) => p.visibleIn))
    return null;
  let names;
  model.traverse((o) => {
    if (!names && o.geometry?.attributes._region)
      names = o.userData.regionNames;
  });
  if (!names) return null;
  const labels = names.map((id) => {
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
      attribute float _region;
      varying float region;
      #include <common>
      #include <morphtarget_pars_vertex>
      #include <skinning_pars_vertex>
      void main() {
        region = _region;
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
