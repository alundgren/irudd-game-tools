import { MathUtils, Matrix4 } from "three";
import { sweepRings } from "./surface.js";

const same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);
const placed = ["position", "rotation", "size", "knots", "frameSize"];
const plainSweep = (part) =>
  part.shape === "sweep" &&
  !part.paint &&
  !part.seamGroup &&
  !part.drape &&
  !part.wearFit &&
  !part.outfitRole;

export function warpSteps(base, next) {
  if (base.parts.length !== next.parts.length) return null;
  for (const key of new Set([...Object.keys(base), ...Object.keys(next)]))
    if (key !== "parts" && key !== "origin" && key !== "poses" && !same(base[key], next[key]))
      return null;
  const steps = [];
  for (let i = 0; i < base.parts.length; i++) {
    const was = base.parts[i],
      now = next.parts[i];
    if (was === now) {
      steps.push(null);
      continue;
    }
    for (const key of new Set([...Object.keys(was), ...Object.keys(now)]))
      if (!placed.includes(key) && !same(was[key], now[key])) return null;
    if (Boolean(was.frameSize) !== Boolean(now.frameSize)) return null;
    const rings = !same(was.knots, now.knots);
    if (
      rings &&
      !(plainSweep(was) && was.knots.length === now.knots.length)
    )
      return null;
    const moved =
      !same(was.position, now.position) ||
      !same(was.rotation, now.rotation) ||
      !same(was.size, now.size) ||
      !same(was.frameSize, now.frameSize);
    steps.push(moved || rings ? { moved, rings } : null);
  }
  return steps;
}

function ringNumbers(knots) {
  const rings = sweepRings(knots),
    out = new Float64Array(rings.length * 14);
  rings.forEach((ring, i) => {
    ring.center.toArray(out, i * 14);
    ring.u.toArray(out, i * 14 + 3);
    ring.v.toArray(out, i * 14 + 6);
    ring.along.toArray(out, i * 14 + 9);
    out[i * 14 + 12] = ring.w;
    out[i * 14 + 13] = ring.d;
  });
  return out;
}
function ringMaps(from, to) {
  const count = from.length / 14,
    maps = new Float64Array(count * 21);
  for (let i = 0; i < count; i++) {
    const a = i * 14,
      m = i * 21;
    const wide = to[a + 12] / from[a + 12],
      deep = to[a + 13] / from[a + 13];
    for (let r = 0; r < 3; r++)
      for (let c = 0; c < 3; c++) {
        const across = to[a + 3 + r] * from[a + 3 + c],
          depth = to[a + 6 + r] * from[a + 6 + c],
          along = to[a + 9 + r] * from[a + 9 + c];
        maps[m + r * 3 + c] = wide * across + deep * depth + along;
        maps[m + 12 + r * 3 + c] = across / wide + depth / deep + along;
      }
    for (let r = 0; r < 3; r++)
      maps[m + 9 + r] =
        to[a + r] -
        maps[m + r * 3] * from[a] -
        maps[m + r * 3 + 1] * from[a + 1] -
        maps[m + r * 3 + 2] * from[a + 2];
  }
  return maps;
}
function alongRings(rings, x, y, z) {
  const count = rings.length / 14;
  let best = 0,
    least = Infinity;
  for (let i = 0; i < count; i++) {
    const dx = x - rings[i * 14],
      dy = y - rings[i * 14 + 1],
      dz = z - rings[i * 14 + 2],
      gap = dx * dx + dy * dy + dz * dz;
    if (gap < least) {
      least = gap;
      best = i;
    }
  }
  let place = best;
  least = Infinity;
  for (const i of [best - 1, best]) {
    if (i < 0 || i > count - 2) continue;
    const a = i * 14,
      b = a + 14;
    const sx = rings[b] - rings[a],
      sy = rings[b + 1] - rings[a + 1],
      sz = rings[b + 2] - rings[a + 2];
    const span = sx * sx + sy * sy + sz * sz;
    const f = span
      ? Math.min(
          1,
          Math.max(
            0,
            ((x - rings[a]) * sx + (y - rings[a + 1]) * sy + (z - rings[a + 2]) * sz) /
              span,
          ),
        )
      : 0;
    const dx = x - rings[a] - sx * f,
      dy = y - rings[a + 1] - sy * f,
      dz = z - rings[a + 2] - sz * f,
      gap = dx * dx + dy * dy + dz * dz;
    if (gap < least) {
      least = gap;
      place = i + f;
    }
  }
  return place;
}

const scratch = new Matrix4(),
  inverse = new Matrix4();
const alike = (a, b) => {
  for (let i = 0; i < 16; i++)
    if (Math.abs(a.elements[i] - b.elements[i]) > 1e-9) return false;
  return true;
};

export function creatureWarp() {
  let bound = null;

  function bind(figure, base) {
    figure.updateMatrixWorld(true);
    const objects = new Map();
    figure.traverse((node) => {
      const id = node.userData.partId;
      if (id !== undefined && !objects.has(id)) objects.set(id, node);
    });
    bound = {
      figure,
      base,
      meshes: new Map(),
      warped: false,
      byId: new Map(),
      regions: base.parts.map((part) => {
        const object = objects.get(part.id);
        if (!object) return null;
        const mount =
          object.children.find((c) => c.userData.attachmentFrame) ?? null;
        return {
          part,
          object,
          mount,
          position: object.position.clone(),
          quaternion: object.quaternion.clone(),
          scale: object.scale.clone(),
          mountScale: mount?.scale.clone(),
          world: object.matrixWorld.clone(),
          rings: null,
          maps: null,
          moved: false,
          shifted: false,
        };
      }),
    };
    for (const region of bound.regions)
      if (region) bound.byId.set(region.part.id, region);
  }
  const ringsOf = (region) =>
    plainSweep(region.part)
      ? (region.rings ??= ringNumbers(region.part.knots))
      : null;

  function bindMesh(region) {
    const mesh = region.object,
      geometry = mesh.geometry,
      position = geometry.attributes.position,
      normal = geometry.attributes.normal;
    if (
      !position ||
      position.isInterleavedBufferAttribute ||
      normal?.isInterleavedBufferAttribute
    )
      return null;
    const count = position.count,
      blend = mesh.blendOwners;
    const owners = [],
      local = new Map();
    const ownerOf = (id) => {
      if (!local.has(id)) {
        const owner = bound.byId.get(id);
        if (!owner) return 255;
        local.set(id, owners.length);
        owners.push(owner);
      }
      return local.get(id);
    };
    const slots = [0, 1].map(() => ({
      owner: new Uint8Array(count).fill(255),
      at: new Float32Array(count * 3),
      turn: normal ? new Float32Array(count * 3) : null,
      ring: new Float32Array(count),
    }));
    const weight = new Float32Array(count).fill(1);
    for (let i = 0; i < count; i++) {
      if (!blend) {
        slots[0].owner[i] = ownerOf(region.part.id);
        continue;
      }
      const first = ownerOf(blend.ids[blend.first[i]]);
      const second =
        blend.weight[i] < 1 && blend.first[i] !== blend.second[i]
          ? ownerOf(blend.ids[blend.second[i]])
          : 255;
      slots[0].owner[i] = first === 255 ? ownerOf(region.part.id) : first;
      if (first !== 255 && second !== 255) {
        slots[1].owner[i] = second;
        weight[i] = blend.weight[i];
      }
    }
    const p = position.array,
      n = normal?.array;
    owners.forEach((owner, k) => {
      const to = scratch
        .copy(owner.world)
        .invert()
        .multiply(region.world).elements;
      const back = inverse
        .copy(region.world)
        .invert()
        .multiply(owner.world).elements;
      const rings = ringsOf(owner);
      for (const slot of slots)
        for (let i = 0; i < count; i++) {
          if (slot.owner[i] !== k) continue;
          const x = p[i * 3],
            y = p[i * 3 + 1],
            z = p[i * 3 + 2];
          const ax = to[0] * x + to[4] * y + to[8] * z + to[12],
            ay = to[1] * x + to[5] * y + to[9] * z + to[13],
            az = to[2] * x + to[6] * y + to[10] * z + to[14];
          slot.at[i * 3] = ax;
          slot.at[i * 3 + 1] = ay;
          slot.at[i * 3 + 2] = az;
          if (rings) slot.ring[i] = alongRings(rings, ax, ay, az);
          if (!n) continue;
          const nx = n[i * 3],
            ny = n[i * 3 + 1],
            nz = n[i * 3 + 2];
          slot.turn[i * 3] = back[0] * nx + back[1] * ny + back[2] * nz;
          slot.turn[i * 3 + 1] = back[4] * nx + back[5] * ny + back[6] * nz;
          slot.turn[i * 3 + 2] = back[8] * nx + back[9] * ny + back[10] * nz;
        }
    });
    return {
      geometry,
      position: p.slice(),
      normal: n?.slice() ?? null,
      box: geometry.boundingBox?.clone() ?? null,
      sphere: geometry.boundingSphere?.clone() ?? null,
      owners,
      slots,
      weight,
      warped: false,
    };
  }

  function rest(region, kept) {
    if (!kept.warped) return;
    const geometry = kept.geometry;
    geometry.attributes.position.array.set(kept.position);
    geometry.attributes.position.needsUpdate = true;
    if (kept.normal) {
      geometry.attributes.normal.array.set(kept.normal);
      geometry.attributes.normal.needsUpdate = true;
    }
    geometry.boundingBox = kept.box?.clone() ?? null;
    geometry.boundingSphere = kept.sphere?.clone() ?? null;
    kept.warped = false;
  }

  function pose(region, kept) {
    const geometry = kept.geometry,
      p = geometry.attributes.position.array,
      n = geometry.attributes.normal?.array,
      count = kept.weight.length;
    const world = region.object.matrixWorld;
    const carry = kept.owners.map((owner) => ({
      to: scratch
        .copy(world)
        .invert()
        .multiply(owner.object.matrixWorld)
        .elements.slice(),
      back: inverse
        .copy(owner.object.matrixWorld)
        .invert()
        .multiply(world)
        .elements.slice(),
      maps: owner.maps,
      last: owner.maps ? owner.maps.length / 21 - 2 : 0,
    }));
    const out = [0, 0, 0, 0, 0, 0];
    function place(slot, i, share, fresh) {
      const c = carry[slot.owner[i]];
      let x = slot.at[i * 3],
        y = slot.at[i * 3 + 1],
        z = slot.at[i * 3 + 2];
      let nx = 0,
        ny = 0,
        nz = 0;
      if (n) {
        nx = slot.turn[i * 3];
        ny = slot.turn[i * 3 + 1];
        nz = slot.turn[i * 3 + 2];
      }
      const m = c.maps;
      if (m) {
        const ring = Math.min(c.last, Math.floor(slot.ring[i])),
          f = slot.ring[i] - ring,
          a = ring * 21,
          b = a + 21,
          g = 1 - f;
        const px =
            g * (m[a] * x + m[a + 1] * y + m[a + 2] * z + m[a + 9]) +
            f * (m[b] * x + m[b + 1] * y + m[b + 2] * z + m[b + 9]),
          py =
            g * (m[a + 3] * x + m[a + 4] * y + m[a + 5] * z + m[a + 10]) +
            f * (m[b + 3] * x + m[b + 4] * y + m[b + 5] * z + m[b + 10]),
          pz =
            g * (m[a + 6] * x + m[a + 7] * y + m[a + 8] * z + m[a + 11]) +
            f * (m[b + 6] * x + m[b + 7] * y + m[b + 8] * z + m[b + 11]);
        x = px;
        y = py;
        z = pz;
        if (n) {
          const qx =
              g * (m[a + 12] * nx + m[a + 13] * ny + m[a + 14] * nz) +
              f * (m[b + 12] * nx + m[b + 13] * ny + m[b + 14] * nz),
            qy =
              g * (m[a + 15] * nx + m[a + 16] * ny + m[a + 17] * nz) +
              f * (m[b + 15] * nx + m[b + 16] * ny + m[b + 17] * nz),
            qz =
              g * (m[a + 18] * nx + m[a + 19] * ny + m[a + 20] * nz) +
              f * (m[b + 18] * nx + m[b + 19] * ny + m[b + 20] * nz);
          nx = qx;
          ny = qy;
          nz = qz;
        }
      }
      const t = c.to,
        k = c.back;
      const keep = fresh ? 0 : 1;
      out[0] = keep * out[0] + share * (t[0] * x + t[4] * y + t[8] * z + t[12]);
      out[1] = keep * out[1] + share * (t[1] * x + t[5] * y + t[9] * z + t[13]);
      out[2] = keep * out[2] + share * (t[2] * x + t[6] * y + t[10] * z + t[14]);
      if (n) {
        out[3] = keep * out[3] + share * (k[0] * nx + k[1] * ny + k[2] * nz);
        out[4] = keep * out[4] + share * (k[4] * nx + k[5] * ny + k[6] * nz);
        out[5] = keep * out[5] + share * (k[8] * nx + k[9] * ny + k[10] * nz);
      }
    }
    const [first, second] = kept.slots;
    for (let i = 0; i < count; i++) {
      const share = second.owner[i] === 255 ? 1 : kept.weight[i];
      place(first, i, share, true);
      if (share < 1) place(second, i, 1 - share, false);
      p[i * 3] = out[0];
      p[i * 3 + 1] = out[1];
      p[i * 3 + 2] = out[2];
      if (n) {
        const length = Math.hypot(out[3], out[4], out[5]) || 1;
        n[i * 3] = out[3] / length;
        n[i * 3 + 1] = out[4] / length;
        n[i * 3 + 2] = out[5] / length;
      }
    }
    geometry.attributes.position.needsUpdate = true;
    if (n) geometry.attributes.normal.needsUpdate = true;
    if (kept.box) geometry.computeBoundingBox();
    if (kept.sphere) geometry.computeBoundingSphere();
    kept.warped = true;
  }

  function settle(region) {
    if (!region.moved) return;
    region.object.position.copy(region.position);
    region.object.quaternion.copy(region.quaternion);
    region.object.scale.copy(region.scale);
    region.mount?.scale.copy(region.mountScale);
    region.moved = false;
  }

  function restore() {
    if (!bound?.warped) return;
    for (const region of bound.regions) {
      if (!region) continue;
      settle(region);
      region.maps = null;
      region.shifted = false;
    }
    bound.figure.updateMatrixWorld(true);
    for (const [region, kept] of bound.meshes) if (kept) rest(region, kept);
    bound.warped = false;
  }

  function show(figure, base, next) {
    if (!figure || !base || !next) return false;
    const steps = warpSteps(base, next);
    if (!steps) return false;
    if (bound?.figure !== figure || bound.base !== base) {
      restore();
      bind(figure, base);
    }
    for (let i = 0; i < steps.length; i++)
      if (steps[i] && !bound.regions[i]) return false;
    for (let i = 0; i < steps.length; i++) {
      const region = bound.regions[i];
      if (!steps[i]?.rings || !region.object.isMesh) continue;
      if (!bound.meshes.has(region)) bound.meshes.set(region, bindMesh(region));
      if (!bound.meshes.get(region)) return false;
    }
    for (let i = 0; i < steps.length; i++) {
      const region = bound.regions[i];
      if (!region) continue;
      const step = steps[i],
        was = region.part,
        now = next.parts[i];
      settle(region);
      region.maps = step?.rings
        ? ringMaps(ringsOf(region), ringNumbers(now.knots))
        : null;
      if (!step?.moved) continue;
      const { object } = region;
      object.position.set(
        region.position.x + now.position[0] - was.position[0],
        region.position.y + now.position[1] - was.position[1],
        region.position.z + now.position[2] - was.position[2],
      );
      if (!same(was.rotation, now.rotation))
        object.rotation.set(...now.rotation.map(MathUtils.degToRad));
      if (!same(was.size, now.size))
        object.scale.set(
          (region.scale.x * now.size[0]) / was.size[0],
          (region.scale.y * now.size[1]) / was.size[1],
          (region.scale.z * now.size[2]) / was.size[2],
        );
      if (region.mount && now.frameSize)
        region.mount.scale.set(...now.frameSize.map((v) => 1 / v));
      region.moved = true;
    }
    figure.updateMatrixWorld(true);
    for (const region of bound.regions)
      if (region)
        region.shifted =
          Boolean(region.maps) || !alike(region.object.matrixWorld, region.world);
    for (const region of bound.regions) {
      if (!region?.object.isMesh) continue;
      const joined = region.object.blendOwners;
      let kept = bound.meshes.get(region);
      const touched = joined
        ? kept
          ? region.shifted || kept.owners.some((owner) => owner.shifted)
          : region.shifted ||
            joined.ids.some((id) => bound.byId.get(id)?.shifted)
        : Boolean(region.maps);
      if (!touched) {
        if (kept) rest(region, kept);
        continue;
      }
      if (kept === undefined) {
        kept = bindMesh(region);
        bound.meshes.set(region, kept);
      }
      if (!kept) continue;
      if (kept.owners.some((owner) => owner.shifted) || region.shifted)
        pose(region, kept);
      else rest(region, kept);
    }
    bound.warped = true;
    return true;
  }

  return {
    show,
    restore,
    release() {
      bound = null;
    },
    get warped() {
      return Boolean(bound?.warped);
    },
  };
}
