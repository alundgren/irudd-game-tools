export function releaseGLTFScenes(groups) {
  if (!groups) return;
  const geometries = new Set(),
    materials = new Set(),
    textures = new Set(),
    skeletons = new Set();
  for (const group of groups)
    group.traverse((o) => {
      if (o.geometry) geometries.add(o.geometry);
      if (o.skeleton) skeletons.add(o.skeleton);
      for (const m of (Array.isArray(o.material)
        ? o.material
        : [o.material]
      ).filter(Boolean)) {
        materials.add(m);
        for (const v of Object.values(m)) if (v?.isTexture) textures.add(v);
      }
    });
  for (const v of [...geometries, ...materials, ...textures, ...skeletons])
    v.dispose();
  for (const bitmap of new Set([...textures].map((t) => t.source?.data)))
    bitmap?.close?.();
  for (const group of groups) group.removeFromParent();
}
