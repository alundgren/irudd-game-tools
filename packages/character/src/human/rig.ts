// Binding an adult's regions (character-view/skin.js and human-mesh.js at
// 2761eb1). A region's joints run from its own pivot to its child's for the
// jointed limbs; every other region has one joint at its pivot. Authored skin
// weights name source bones, which resolve to the joints of the nearest
// region with that bone, so a duplicated limb binds to its own branch.

import * as T from "three";
import type { Region } from "../rig/region.js";
import type { HumanBuild } from "./binding.js";

const childRoles: Readonly<Record<string, string>> = {
  "upper arm": "forearm",
  forearm: "hand",
  thigh: "shin",
  shin: "foot",
};

/** Joint points of an adult region, or undefined for a part that is not a region. */
export function humanCentres(
  s: Region,
  regions: ReadonlyMap<string, Region>,
  human: HumanBuild,
): T.Vector3[] | undefined {
  if (!human.bones.has(s.part.id)) return undefined;
  const origin = s.object.getWorldPosition(new T.Vector3());
  const childRole = childRoles[s.role];
  const child = childRole
    ? [...regions.values()].find((r) => r.part.parent === s.part.id && r.role === childRole)
    : undefined;
  if (child) {
    const end = child.object.getWorldPosition(new T.Vector3());
    return [origin, origin.clone().lerp(end, 0.5), end];
  }
  return [origin];
}

/** Joint index of each source bone name, for one region's authored weights. */
export function humanBinding(
  owner: Region,
  regions: ReadonlyMap<string, Region>,
  index: ReadonlyMap<T.Bone, number>,
  names: ReadonlyArray<string>,
  human: HumanBuild,
): number[] {
  const path = (start: Region): string[] => {
    const chain: string[] = [];
    let region: Region | undefined = start;
    while (region) {
      chain.push(region.part.id);
      region = region.part.parent === null ? undefined : regions.get(region.part.parent);
    }
    return chain.reverse();
  };
  const boneOf = (r: Region): number => {
    const first = r.bones[0];
    return (first && index.get(first)) ?? 0;
  };
  const a = path(owner);
  const closest = new Map<string, { distance: number; bone: number }>();
  for (const region of regions.values()) {
    const bone = human.bones.get(region.part.id);
    if (!bone) continue;
    const b = path(region);
    let prefix = 0;
    while (prefix < a.length && a[prefix] === b[prefix]) prefix++;
    const distance = a.length + b.length - 2 * prefix;
    const prev = closest.get(bone);
    if (!prev || prev.distance > distance) closest.set(bone, { distance, bone: boneOf(region) });
  }
  return names.map((name) => closest.get(name)?.bone ?? boneOf(owner));
}
