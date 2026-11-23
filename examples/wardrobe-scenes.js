// glTF animations target nodes globally. Collect the active scene's subtree
// before exposing its clips, since each wardrobe rig bakes its own clearance.
export function clipsForScene(gltf, index) {
  if (gltf.scenes.length === 1) return gltf.animations;
  const json = gltf.parser.json,
    nodes = new Set();
  function visit(id) {
    if (nodes.has(id)) return;
    nodes.add(id);
    for (const child of json.nodes[id].children ?? []) visit(child);
  }
  for (const id of json.scenes[index].nodes ?? []) visit(id);
  return gltf.animations.filter((_, i) =>
    json.animations[i].channels.every((c) => nodes.has(c.target.node)),
  );
}
