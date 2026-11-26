import {
  Color,
  Float32BufferAttribute,
  MathUtils,
  Triangle,
  Vector3,
} from "three";
import { randomStream } from "./random.js";
import { sweepGeometry } from "./surface.js";

const directions = {
  Back: [0, 0, -1],
  Front: [0, 0, 1],
  Left: [1, 0, 0],
  Right: [-1, 0, 0],
  Top: [0, 1, 0],
};
export const plateGrowthDefaults = Object.freeze({
  seed: 1,
  tipSeed: 1,
  rows: 6,
  columns: 5,
  face: "Back",
  direction: "first",
  start: 0.14,
  end: 0.83,
  wrap: 150,
  overlap: 0.4,
  crest: 0.65,
  rise: 1,
  color: "#c2ab7c",
  mirrored: false,
});

const within = (n, min, max) => Number.isFinite(n) && n >= min && n <= max;
const integer = (n, min, max) => Number.isInteger(n) && within(n, min, max);
export function validPlateSite(site) {
  return (
    !!site &&
    typeof site === "object" &&
    !Array.isArray(site) &&
    Object.keys(site).every((k) => ["row", "column", "tipSeed"].includes(k)) &&
    integer(site.row, 0, 11) &&
    integer(site.column, 0, 6) &&
    (site.tipSeed === undefined || integer(site.tipSeed, 0, 0xffffffff))
  );
}
export function validPlateGrowth(settings) {
  if (!settings || typeof settings !== "object" || Array.isArray(settings))
    return false;
  return (
    Object.keys(settings).every((k) => Object.hasOwn(plateGrowthDefaults, k)) &&
    integer(settings.seed, 0, 0xffffffff) &&
    integer(settings.tipSeed, 0, 0xffffffff) &&
    integer(settings.rows, 2, 12) &&
    [1, 3, 5, 7].includes(settings.columns) &&
    Object.hasOwn(directions, settings.face) &&
    ["first", "last"].includes(settings.direction) &&
    within(settings.start, 0, 1) &&
    within(settings.end, 0, 1) &&
    settings.end - settings.start >= 0.04 - 1e-9 &&
    within(settings.wrap, 20, 165) &&
    within(settings.overlap, 0, 0.8) &&
    within(settings.crest, 0, 1) &&
    (settings.rise === undefined || within(settings.rise, 0.5, 3)) &&
    /^#[a-f\d]{6}$/i.test(settings.color) &&
    typeof settings.mirrored === "boolean"
  );
}

const lerp = MathUtils.lerp;
const rounded = (n) => Math.round(n * 1e8) / 1e8;
const xyz = (v) => v.toArray().map(rounded);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const siteKey = (row, column) => row * 7 + column;
function stream(seed, row, column) {
  return randomStream(
    (seed ^
      Math.imul(row + 1, 0x9e3779b1) ^
      Math.imul(column + 1, 0x85ebca77)) >>>
      0,
  );
}

export function validPlateGrowthRest(rest) {
  const knots=rest?.knots;
  return !!rest && typeof rest.horizontal==="boolean" &&
    Array.isArray(rest.frameSize) && rest.frameSize.length===3 && rest.frameSize.every(n=>within(n,.005,12)) &&
    Array.isArray(knots) && knots.length>=2 && knots.length<=48 &&
    knots.every((k,i)=>Array.isArray(k) && k.length===5 && k.slice(0,3).every(v=>within(v,-8,8)) &&
      k.slice(3).every(v=>within(v,.0005,4)) && (!i || k.slice(0,3).some((v,j)=>Math.abs(v-knots[i-1][j])>.00001)));
}

export function plateGrowthRest(carrier,settings=carrier.plateGrowth) {
  return {
    knots:carrier.knots.map(([x,y,z,w,d])=>[settings?.mirrored ? -x : x,y,z,w,d]),
    horizontal:Boolean(carrier.paint && carrier.paint.frame!=="path"),
    frameSize:[...(carrier.frameSize ?? [1,1,1])]
  };
}

function surfaceChart(rest, settings) {
  const geometry = sweepGeometry(rest.knots, rest.horizontal, 8);
  const positions = geometry.attributes.position,
    rings = [];
  let length = 0;
  for (let i = 0; i < positions.count; i += 9) {
    const first = new Vector3().fromBufferAttribute(positions, i);
    const center = new Vector3()
      .fromBufferAttribute(positions, i + 4)
      .lerp(first, 0.5);
    if (rings.length) length += center.distanceTo(rings.at(-1).center);
    rings.push({
      center,
      across: first.sub(center),
      depth: new Vector3().fromBufferAttribute(positions, i + 2).sub(center),
      distance: length,
    });
  }
  geometry.dispose();
  if (length < 0.015)
    throw new Error("Choose a longer carrier for the plate field.");
  const mount = new Vector3(...rest.frameSize);
  function section(t) {
    const distance = MathUtils.clamp(t, 0, 1) * length;
    let lo = 0,
      hi = rings.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (rings[mid].distance < distance) lo = mid;
      else hi = mid;
    }
    const a = rings[lo],
      b = rings[hi];
    const f = (distance - a.distance) / (b.distance - a.distance || 1);
    return {
      center: a.center.clone().lerp(b.center, f),
      across: a.across.clone().lerp(b.across, f),
      depth: a.depth.clone().lerp(b.depth, f),
    };
  }
  let face = settings.face;
  if (settings.mirrored && ["Left", "Right"].includes(face))
    face = face === "Left" ? "Right" : "Left";
  const middle = section((settings.start + settings.end) / 2);
  const across = middle.across.clone().normalize(),
    depth = middle.depth.clone().normalize();
  let outward = new Vector3(...directions[face]);
  if (Math.hypot(outward.dot(across), outward.dot(depth)) < 0.05) {
    outward.set(0, 1, 0);
    if (Math.hypot(outward.dot(across), outward.dot(depth)) < 0.05)
      outward.copy(depth);
  }
  const centerAngle = Math.atan2(
    outward.dot(depth) / middle.depth.length(),
    outward.dot(across) / middle.across.length(),
  );
  function point(t, angle) {
    const ring = section(t);
    return ring.center
      .addScaledVector(ring.across, Math.cos(angle))
      .addScaledVector(ring.depth, Math.sin(angle));
  }
  function normal(t, angle) {
    const along = point(t + 0.0003, angle).sub(point(t - 0.0003, angle));
    const around = point(t, angle + 0.001).sub(point(t, angle - 0.001));
    const n = around.cross(along).normalize();
    if (n.dot(point(t, angle).sub(section(t).center)) < 0) n.negate();
    return n;
  }
  const arcs = new Map();
  function arcMeridian(t, fraction) {
    const side = fraction < 0 ? -1 : 1,
      key = side * (t + 1);
    let table = arcs.get(key);
    const delta = (side * MathUtils.degToRad(settings.wrap)) / 48;
    if (!table) {
      table = [0];
      const ring = section(t),
        width = ring.across.length(),
        depth = ring.depth.length();
      let prevX = width * Math.cos(centerAngle),
        prevY = depth * Math.sin(centerAngle);
      for (let i = 1; i <= 36; i++) {
        const a = centerAngle + i * delta,
          x = width * Math.cos(a),
          y = depth * Math.sin(a);
        table.push(table[i - 1] + Math.hypot(x - prevX, y - prevY));
        prevX = x;
        prevY = y;
      }
      arcs.set(key, table);
    }
    const target = Math.min(table[36], Math.abs(fraction) * table[24]);
    let i = 1;
    while (i < 36 && table[i] < target) i++;
    return (
      centerAngle +
      delta * (i - 1 + (target - table[i - 1]) / (table[i] - table[i - 1] || 1))
    );
  }
  return { length, point, normal, arcMeridian, mount };
}

const stations = [
  [0, 0.55, 0.12, 0],
  [0.1, 0.82, 0.39, 0.004],
  [0.2, 0.96, 0.69, 0.012],
  [0.25, 0.98, 0.58, 0.018],
  [0.35, 1, 0.89, 0.028],
  [0.4, 0.98, 0.69, 0.04],
  [0.48, 0.96, 1, 0.055],
  [0.53, 0.93, 0.76, 0.07],
  [0.63, 0.82, 0.86, 0.1],
  [0.68, 0.77, 0.65, 0.13],
  [0.79, 0.57, 0.57, 0.21],
  [0.9, 0.32, 0.29, 0.33],
  [1, 0.075, 0.095, 0.45],
];
const ring = [
  [-1, 0],
  [-0.69, 0.47],
  [-0.19, 0.8],
  [0.015, 1],
  [0.63, 0.5],
  [1, 0],
  [0.58, -0.22],
  [-0.58, -0.22],
];

function makePlate(chart, settings, row, column) {
  const draw = stream(settings.seed, row, column),
    tip = stream(settings.tipSeed, row, column);
  const rank = Math.ceil(column / 2) * (column % 2 ? -1 : 1);
  const phase =
    (Math.abs(rank) % 2 === 1 ? 0.16 : -0.12) + (draw() - 0.5) * 0.13;
  const u = (row + 0.5 + phase) / settings.rows;
  const s = lerp(settings.start, settings.end, u),
    pitch = (settings.end - settings.start) / settings.rows;
  const edge = (2 * Math.abs(rank)) / settings.columns;
  const dorsal = Math.exp(-2.25 * edge * edge);
  const flex = 0.53 + 0.47 * Math.sin(Math.PI * u) ** 0.62;
  const sign = settings.direction === "first" ? -1 : 1;
  const angularCell = 2 / settings.columns;
  const side =
    rank * angularCell +
    angularCell *
      ((row % 2 ? 0.14 : -0.14) * (column ? 1 : 0.42) + (draw() - 0.5) * 0.06);
  const spin = chart.arcMeridian(s, side);
  const angle0 = chart.arcMeridian(s, side - angularCell * 0.4),
    angle1 = chart.arcMeridian(s, side + angularCell * 0.4);
  const width = chart.point(s, angle0).distanceTo(chart.point(s, angle1)) / 0.8;
  const span = Math.min(
    settings.end - settings.start,
    pitch *
      (0.89 + 0.23 * dorsal) *
      flex *
      (1 + 0.9 * settings.overlap) *
      (0.96 + 0.08 * draw()),
  );
  const length = chart.length * span;
  if (Math.min(width, length) < 0.011)
    throw new Error("Choose a longer or wider carrier, or use fewer plates.");
  const height =
    Math.min(width, length) *
    (0.11 + settings.crest * (0.12 + 0.49 * dorsal)) *
    flex;
  const root = MathUtils.clamp(
    s - sign * span * 0.34,
    settings.start + (sign < 0 ? span : 0),
    settings.end - (sign > 0 ? span : 0),
  );
  const widthFactor =
    (0.83 + 0.19 * dorsal) * (0.77 + 0.23 * flex) * (0.97 + 0.08 * draw());
  const flare = (draw() - 0.5) * 0.06 + rank * 0.11;
  const sway = (tip() - 0.5) * 0.3,
    curl = (tip() - 0.5) * 0.63,
    chip = tip() * 0.32,
    chippedSide = tip() < 0.5 ? -1 : 1;
  const base = chart.point(
    MathUtils.clamp(root, settings.start, settings.end),
    spin,
  );
  const vertices = [];
  const rise = settings.rise ?? 1;
  for (const [t, envelope, ridge, lift] of stations) {
    const distal = MathUtils.smoothstep(t, 0.52, 1);
    const free = MathUtils.smoothstep(t, 0.1, 0.95);
    const tilt = Math.max(0, rise - 1) * height * free * (0.35 + 0.8 * t);
    const flatten = 1 + Math.min(0, rise - 1) * free;
    for (const [x, z] of ring) {
      const swept = t - 0.16 * Math.abs(x) ** 1.3 * Math.sin(Math.PI * t);
      const pathT = root + sign * span * swept;
      const edgeLoss =
        Math.sign(x) === chippedSide ? chip * distal * Math.abs(x) : 0;
      const cross =
        side +
        (x * envelope * widthFactor * 0.55 * (1 - edgeLoss) +
          t * t * flare +
          distal * sway) *
          angularCell;
      const angle = chart.arcMeridian(pathT, cross);
      const h =
        height * (z * ridge + lift * (1 + curl * distal)) * flatten +
        tilt -
        Math.min(0.004, height * 0.13) * (1 - t);
      const v = chart
        .point(pathT, angle)
        .addScaledVector(chart.normal(pathT, angle), h)
        .sub(base)
        .multiply(chart.mount);
      if (settings.mirrored) v.x *= -1;
      vertices.push(xyz(v));
    }
  }
  const faces = [],
    creaselines = [];
  const k = ring.length;
  faces.push(Array.from({ length: k }, (_, i) => k - 1 - i));
  for (let r = 0; r < stations.length - 1; r++) {
    for (let c = 0; c < k; c++) {
      const n = (c + 1) % k,
        a = r * k + c,
        b = r * k + n;
      faces.push([a, b, b + k, a + k]);
    }
    for (const c of [0, 5]) creaselines.push([r * k + c, (r + 1) * k + c]);
    if (r > 0 && r < stations.length - 2)
      creaselines.push([r * k + 3, (r + 1) * k + 3]);
  }
  faces.push(
    Array.from({ length: k }, (_, i) => (stations.length - 1) * k + i),
  );
  if (sign < 0 !== settings.mirrored) for (const face of faces) face.reverse();
  const position = base.clone().multiply(chart.mount);
  if (settings.mirrored) position.x *= -1;
  const tone = new Color(settings.color).multiplyScalar(
    0.83 + 0.12 * dorsal + 0.19 * draw(),
  );
  return {
    shape: "cage",
    position: xyz(position),
    rotation: [0, 0, 0],
    size: [1, 1, 1],
    frameSize: [1, 1, 1],
    color: "#" + tone.getHexString(),
    surface: "horn",
    hornSwatch: Math.floor(stream(0x418a59d3,row,column)()*4),
    motionRole: "rigid",
    cage: { vertices, faces, creases: creaselines, levels: 1 },
    surfaceJoin: {
      faces: [0],
      depth: MathUtils.clamp(height * 0.09, 0.001, 0.006),
    },
    plateSite: { row, column },
  };
}

function drawing(chart, settings, overrides) {
  const result = new Map();
  for (let row = 0; row < settings.rows; row++)
    for (let column = 0; column < settings.columns; column++) {
      const key = siteKey(row, column),
        tipSeed = overrides.get(key) ?? settings.tipSeed;
      result.set(key, makePlate(chart, { ...settings, tipSeed }, row, column));
    }
  return result;
}

function shifted(current, old, next) {
  return current.map((v, i) =>
    v === old[i]
      ? next[i]
      : old[i] === next[i]
        ? v
        : rounded(v + next[i] - old[i]),
  );
}

function updatePlate(plate, old, next) {
  if (!old || plate.shape !== "cage") return plate;
  const result = { ...plate, hornSwatch:plate.hornSwatch ?? next.hornSwatch };
  result.position = shifted(plate.position, old.position, next.position);
  if (plate.color === old.color) result.color = next.color;
  if (
    plate.cage.vertices.length === old.cage.vertices.length &&
    same(plate.cage.faces, old.cage.faces)
  ) {
    result.cage = {
      ...plate.cage,
      faces: next.cage.faces,
      vertices: plate.cage.vertices.map((v, i) =>
        shifted(v, old.cage.vertices[i], next.cage.vertices[i]),
      ),
    };
  }
  if (same(plate.surfaceJoin, old.surfaceJoin))
    result.surfaceJoin = next.surfaceJoin;
  return result;
}

function plateName(used, carrier, row, column) {
  const suffix = " plate " + (row + 1) + "." + (column + 1);
  const base = carrier.slice(0, 64 - suffix.length) + suffix;
  let id = base;
  for (let n = 2; used.has(id); n++) {
    const extra = " " + n;
    id = base.slice(0, 64 - extra.length) + extra;
  }
  used.add(id);
  return id;
}

function changeOneTip(form, plate, changes) {
  const tipSeed = changes.tipSeed;
  if (
    Object.keys(changes).length !== 1 ||
    !Object.hasOwn(changes, "tipSeed") ||
    (tipSeed !== null && !integer(tipSeed, 0, 0xffffffff))
  ) {
    throw new Error("Choose a tip seed or clear this tip override.");
  }
  const host = form.parts.find((p) => p.id === plate.parent),
    settings = host?.plateGrowth;
  if (!settings || !validPlateSite(plate.plateSite))
    throw new Error("This plate has no growth field.");
  const { row, column } = plate.plateSite,
    chart = surfaceChart(host.plateGrowthRest ?? plateGrowthRest(host), settings);
  const template = (seed) =>
    makePlate(chart, { ...settings, tipSeed: seed }, row, column);
  const previous = template(plate.plateSite.tipSeed ?? settings.tipSeed);
  if (
    plate.shape !== "cage" ||
    plate.cage.vertices.length !== previous.cage.vertices.length ||
    !same(plate.cage.faces, previous.cage.faces)
  ) {
    throw new Error(
      "This plate has a custom topology. Sculpt its tip directly.",
    );
  }
  const next = updatePlate(
    plate,
    previous,
    template(tipSeed ?? settings.tipSeed),
  );
  next.plateSite =
    tipSeed === null ? { row, column } : { row, column, tipSeed };
  return {
    form: { ...form, parts: form.parts.map((p) => (p === plate ? next : p)) },
    id: plate.id,
  };
}

export function growPlateField(form, carrierId, patch = {}) {
  const carrier = form.parts.find((p) => p.id === carrierId);
  const { op, id, ...changes } = patch;
  if (carrier?.plateSite) return changeOneTip(form, carrier, changes);
  if (carrier?.shape !== "sweep" || !carrier.knots?.length)
    throw new Error("Choose a swept carrier for growing plates.");
  const previous = carrier.plateGrowth;
  const settings = { ...plateGrowthDefaults, ...previous, ...changes };
  if (!validPlateGrowth(settings))
    throw new Error(
      "Choose valid plate seeds, counts, bounds and growth settings.",
    );
  const overrides = new Map();
  for (const plate of form.parts) {
    if (plate.parent === carrier.id && plate.plateSite?.tipSeed !== undefined)
      overrides.set(
        siteKey(plate.plateSite.row, plate.plateSite.column),
        plate.plateSite.tipSeed,
      );
  }
  const baseline=carrier.plateGrowthRest ?? plateGrowthRest(carrier,previous ?? settings);
  const keys=Object.keys(changes);
  const tipsOrColour=keys.length>0 && keys.every(k=>k==="tipSeed" || k==="color");
  const rest=previous && tipsOrColour ? baseline : plateGrowthRest(carrier,settings);
  const next = drawing(surfaceChart(rest, settings), settings, overrides);
  const old = previous
    ? drawing(surfaceChart(baseline, previous), previous, overrides)
    : new Map();
  const used = new Set(form.parts.map((p) => p.id)),
    occupied = new Set(),
    result = [];
  const hasChildren = new Set(form.parts.map((p) => p.parent));
  let first;
  for (const p of form.parts) {
    if (p === carrier) result.push({ ...p, plateGrowth: settings, plateGrowthRest: rest });
    else if (p.parent !== carrier.id || !p.plateSite) result.push(p);
    else {
      const { row, column } = p.plateSite,
        key = siteKey(row, column);
      if (occupied.has(key))
        throw new Error(
          "Two plates occupy one growth site. Detach the duplicate before updating the field.",
        );
      occupied.add(key);
      if (!next.has(key)) {
        if (hasChildren.has(p.id))
          throw new Error(
            "Move the attachments from " +
              p.id +
              " before reducing this field.",
          );
        const { id, parent, plateSite, ...body } = p,
          template = old.get(key);
        if (
          !template ||
          plateSite.tipSeed !== undefined ||
          Object.keys(body).some((k) => !same(body[k], template[k]))
        ) {
          const free = { ...p };
          delete free.plateSite;
          result.push(free);
        }
      } else {
        result.push(updatePlate(p, old.get(key), next.get(key)));
        first ??= p.id;
      }
    }
  }
  for (const [key, p] of next) {
    if (occupied.has(key) || old.has(key)) continue;
    const id = plateName(used, carrier.id, p.plateSite.row, p.plateSite.column);
    result.push({ ...p, id, parent: carrier.id });
    first ??= id;
  }
  if (result.length > 128)
    throw new Error("This plate field exceeds the 128 part limit.");
  return { form: { ...form, parts: result }, id: first ?? carrier.id };
}

function growthUv(geometry, cage) {
  const width = ring.length,
    count = stations.length,
    expected = 2 + (count - 1) * width;
  if (
    cage.vertices.length !== count * width ||
    cage.faces.length !== expected ||
    !geometry.cageFaces
  )
    return;
  const coords = cage.vertices.map((v, i) => {
    const row = Math.floor(i / width),
      col = i % width;
    return {
      p: new Vector3(...v),
      u: 0.5 + 0.5 * ring[col][0] * stations[row][1],
      v: 1 - stations[row][0],
    };
  });
  const triangles = cage.faces.map((face) => {
    const first = coords[face[0]];
    return face.slice(1, -1).map((id, i) => {
      const b = coords[id],
        c = coords[face[i + 2]];
      return {
        triangle: new Triangle(first.p, b.p, c.p),
        controls: [first, b, c],
      };
    });
  });
  const pos = geometry.attributes.position,
    uv = geometry.attributes.uv,
    seen = new Uint8Array(pos.count);
  const at = new Vector3(),
    point = new Vector3(),
    closest = new Vector3(),
    weights = new Vector3();
  const underside = new Uint8Array(pos.count);
  for (let i = 0; i < geometry.index.count; i++) {
    const v = geometry.index.getX(i);
    if (seen[v]) continue;
    seen[v] = 1;
    const face = geometry.cageFaces[Math.floor(i / 3)];
    let best,
      dist = Infinity;
    at.fromBufferAttribute(pos, v);
    for (const patch of triangles[face]) {
      patch.triangle.closestPointToPoint(at, point);
      const d = at.distanceToSquared(point);
      if (d < dist) {
        best = patch;
        dist = d;
        closest.copy(point);
      }
    }
    if (!best || !best.triangle.getBarycoord(closest, weights)) continue;
    const [a, b, c] = best.controls;
    uv.setXY(
      v,
      weights.x * a.u + weights.y * b.u + weights.z * c.u,
      weights.x * a.v + weights.y * b.v + weights.z * c.v,
    );
    if (face > 0 && face < expected - 1 && (face - 1) % width >= 5)
      underside[v] = 1;
  }
  return underside;
}

export function finishPlateSurface(mesh, part, material) {
  const g = mesh.geometry,
    lower = growthUv(g, part.cage);
  if (!lower) return;
  const base = new Color(part.color),
    uv = g.attributes.uv,
    rgb = new Float32Array(3 * uv.count);
  const swatch=part.hornSwatch ?? 0;
  const tileX=swatch%2,tileY=Math.floor(swatch/2);
  for (let i = 0; i < uv.count; i++) {
    const t = 1 - uv.getY(i),
      shade = lower[i] ? 0.54 : 0.83 + 0.17 * t;
    uv.setXY(i,(tileX+.025+.95*uv.getX(i))/2,(tileY+.025+.95*uv.getY(i))/2);
    rgb[i * 3] = base.r * shade;
    rgb[i * 3 + 1] = base.g * shade;
    rgb[i * 3 + 2] = base.b * shade;
  }
  g.setAttribute("color", new Float32BufferAttribute(rgb, 3));
  const shared = material("#ffffff", "horn");
  shared.vertexColors = true;
  shared.roughness = 0.72;
  mesh.material = shared;
}
