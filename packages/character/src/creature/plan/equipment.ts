import { Box3, Euler, MathUtils, Quaternion, Sphere, Triangle, Vector3 } from "three";
import { equipmentKinds } from "@irudd/document";
import { dispatchHand, handHandle, placeInHand } from "./dispatch-pose.js";
import { wingGeometry } from "../../surfaces/wing.js";
import { randomStream } from "../../random.js";
import { need } from "./need.js";
import type {
  Cage,
  Form,
  FormPart,
  Plan,
  RawEquipment,
  Shell,
  Spine,
  SpineStation,
  Triple,
} from "./types.js";

export type Kit = NonNullable<Plan["equipment"]>;
type At = (x: number, y: number, z: number) => Vector3;
interface Facet {
  tri: Triangle;
  box: Box3;
}

const { clamp, lerp } = MathUtils;
const kitColors = ["#ca884a", "#b55b46", "#498e88", "#b8a364", "#798da6", "#b98382"];
const bounded = (v: number | undefined, lo: number, hi: number, base: number) =>
  v !== undefined && Number.isFinite(v) ? clamp(v, lo, hi) : base;
export function readEquipment(raw: RawEquipment = {}): Kit {
  return {
    kind: equipmentKinds.find((k) => k === raw.kind) ?? "none",
    ...(raw.kind === "courier satchel" && raw.handling === "offer"
      ? { handling: "offer" as const }
      : {}),
    station: bounded(raw.station, 0.14, 0.85, 0.42),
    hang: bounded(raw.hang, -1.42, 0.85, 0.12),
    size: bounded(raw.size, 0.55, 1.45, 1),
    side: raw.side === "right" ? "right" : "left",
    mount: raw.mount === "back" ? "back" : "flank",
    color:
      raw.color !== undefined && /^#[0-9a-f]{6}$/i.test(raw.color)
        ? raw.color.toLowerCase()
        : need(kitColors[0]),
    seed: Math.floor(bounded(raw.seed, 0, 4294967295, 1)),
  };
}
export function drawEquipment(plan: Plan, seed: number): Kit | null {
  const draw = randomStream((seed ^ 0xb218593f) >>> 0);
  const roll = draw(),
    leg = plan.limbs.find((l) => l.kind === "leg");
  const pairs = leg?.kind === "leg" ? leg.pairs : 0;
  if (!leg || roll > 0.54 || plan.back.kind === "spiral shell") return null;
  const wings = plan.limbs.some((l) => l.kind === "wing"),
    grasp = plan.limbs.some((l) => l.kind === "arm" && (l.end === "hand" || l.end === "pincer"));
  const kind =
    pairs >= 2 && (!grasp || draw() < 0.54)
      ? draw() < 0.6
        ? "trader panniers"
        : "survey kit"
      : grasp && draw() < 0.49
        ? "survey kit"
        : "courier satchel";
  return readEquipment({
    kind,
    station: wings ? lerp(0.26, 0.39, draw()) : lerp(0.33, 0.57, draw()),
    size: lerp(0.82, 1.18, draw()),
    side: draw() < 0.5 ? "left" : "right",
    color: need(kitColors[Math.floor(draw() * kitColors.length)]),
    seed: Math.floor(draw() * 4294967296),
  });
}
const needed: Record<Kit["kind"], number> = {
  none: 0,
  "courier satchel": 11,
  "trader panniers": 10,
  "survey kit": 9,
};
export const equipmentRegionCount = (
  gear: { kind: Kit["kind"]; handling?: "offer" | undefined } | undefined | null,
) =>
  needed[gear?.kind ?? "none"] +
  (gear?.kind === "courier satchel" && gear.handling === "offer" ? 1 : 0);

function shell(rings: Vector3[][], closedPath = false): Shell {
  const vertices = rings.flat(),
    faces: number[][] = [],
    sides = need(rings[0]).length,
    rows = rings.length;
  const center = (row: number) =>
    need(rings[row])
      .reduce((a, p) => a.add(p), new Vector3())
      .multiplyScalar(1 / sides);
  if (!closedPath) {
    const a = vertices.push(center(0)) - 1,
      b = vertices.push(center(rows - 1)) - 1;
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      faces.push([a, j, i], [b, (rows - 1) * sides + i, (rows - 1) * sides + j]);
    }
  }
  for (let r = 0; r < (closedPath ? rows : rows - 1); r++)
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides,
        next = (r + 1) % rows;
      faces.push([r * sides + i, r * sides + j, next * sides + j, next * sides + i]);
    }
  const cross = new Vector3();
  let volume = 0;
  for (const f of faces)
    for (let i = 1; i < f.length - 1; i++)
      volume += need(vertices[need(f[0])]).dot(
        cross.crossVectors(need(vertices[need(f[i])]), need(vertices[need(f[i + 1])])),
      );
  if (volume < 0) for (const f of faces) f.reverse();
  return { vertices, faces };
}
const beveled: [number, number][] = [
  [-0.72, -1],
  [0.72, -1],
  [1, -0.72],
  [1, 0.72],
  [0.72, 1],
  [-0.72, 1],
  [-1, 0.72],
  [-1, -0.72],
];
function caseShell(
  at: At,
  x: number,
  y: number,
  z: number,
  depth: number,
  height: number,
  width: number,
  levels: number[][] = [
    [0, 0.89],
    [0.09, 1],
    [0.83, 1],
    [1, 0.88],
  ],
) {
  return shell(
    levels.map(([h = 0, s = 0]) =>
      beveled.map(([i, j]) =>
        at(x + i * depth * 0.5 * s, y + (h - 0.5) * height, z + j * width * 0.5 * s),
      ),
    ),
  );
}
function cylinder(a: Vector3, b: Vector3, profile: number[][], sides = 8) {
  const axis = b.clone().sub(a).normalize(),
    ref = Math.abs(axis.y) > 0.8 ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0);
  const u = new Vector3().crossVectors(axis, ref).normalize(),
    v = new Vector3().crossVectors(axis, u);
  return shell(
    profile.map(([t = 0, r = 0]) =>
      Array.from({ length: sides }, (_, j) =>
        a
          .clone()
          .lerp(b, t)
          .addScaledVector(u, r * Math.cos((j * 2 * Math.PI) / sides))
          .addScaledVector(v, r * Math.sin((j * 2 * Math.PI) / sides)),
      ),
    ),
  );
}
function band(spine: Spine, station: number, width: number) {
  const ring = (t: number, r: number) => {
    const f = spine.at(t);
    return Array.from({ length: 14 }, (_, i) => {
      const angle = (i * Math.PI) / 7;
      return f.centre
        .clone()
        .addScaledVector(f.dorsal, r * f.radius[1] * Math.cos(angle))
        .add(new Vector3(r * f.radius[0] * Math.sin(angle), 0, 0));
    });
  };
  return shell(
    [
      ring(station - width, 0.9),
      ring(station - width, 1.105),
      ring(station + width, 1.105),
      ring(station + width, 0.9),
    ],
    true,
  );
}
function diagonalSling(
  spine: Spine,
  station: number,
  side: number,
  halfWidth: number,
  path: [number, number, number] = [0.24, 0.07, 0],
) {
  const ring = (delta: number, radius: number) =>
    Array.from({ length: 22 }, (_, i) => {
      const angle = (i * Math.PI) / 11;
      const t =
        clamp(
          station +
            path[0] * (1 - side * Math.sin(angle)) * 0.5 +
            path[1] * Math.cos(angle) +
            path[2] * (1 + side * Math.sin(angle)) * 0.5,
          0.045 + halfWidth,
          0.95 - halfWidth,
        ) + delta;
      const f = spine.at(t);
      return f.centre
        .clone()
        .addScaledVector(f.dorsal, f.radius[1] * radius * Math.cos(angle))
        .add(new Vector3(f.radius[0] * radius * Math.sin(angle), 0, 0));
    });
  return shell(
    [
      ring(-halfWidth, 0.92),
      ring(-halfWidth, 1.125),
      ring(halfWidth, 1.125),
      ring(halfWidth, 0.92),
    ],
    true,
  );
}

function cageFrom(shells: Shell[], pivot: Vector3, scale: number): Cage {
  const vertices: number[][] = [],
    faces: number[][] = [];
  for (const s of shells) {
    const offset = vertices.length;
    vertices.push(
      ...s.vertices.map((v) =>
        v
          .clone()
          .sub(pivot)
          .multiplyScalar(1 / scale)
          .toArray(),
      ),
    );
    faces.push(...s.faces.map((f) => f.map((i) => i + offset)));
  }
  return { vertices, faces, levels: 1 };
}

function loadUnit(plan: Plan, kit: { size: number }) {
  return (
    kit.size *
    Math.max(
      0.027,
      Math.min(plan.spine.girth * plan.scale * 1.46, plan.spine.length * plan.scale * 0.31),
    )
  );
}
function bagPosition(
  frame: SpineStation,
  side: number,
  hang: number,
  unit: number,
  mount = "flank",
): At {
  const angle = 0.16 - hang;
  const base = frame.centre
    .clone()
    .addScaledVector(frame.dorsal, frame.radius[1] * Math.sin(angle));
  base.x += side * frame.radius[0] * 0.91 * Math.cos(angle);
  base.y = Math.max(base.y, unit * 0.77 + 0.008);
  const turn = mount === "back" ? MathUtils.smoothstep(-hang, 0.52, 1.39) * angle : 0;
  const outward = new Vector3(
    side * Math.cos(turn),
    0,
    frame.dorsal.z * Math.sin(turn),
  ).normalize();
  const along = new Vector3(-side * outward.z, 0, side * outward.x);
  return (x: number, y: number, z: number) =>
    base
      .clone()
      .addScaledVector(outward, x * unit)
      .addScaledVector(along, z * unit)
      .add(new Vector3(0, y * unit, 0));
}

const euler = (r: readonly number[]) =>
  new Euler(
    (r[0] ?? 0) * MathUtils.DEG2RAD,
    (r[1] ?? 0) * MathUtils.DEG2RAD,
    (r[2] ?? 0) * MathUtils.DEG2RAD,
  );
function limbClearance(parts: FormPart[], includeLegs = false) {
  const boneFrames = new Map<string, { origin: Vector3; rotation: Quaternion }>(),
    blockers: Sphere[] = [];
  for (const p of parts) {
    const parent = p.parent === undefined ? undefined : boneFrames.get(p.parent);
    const rotation = new Quaternion().setFromEuler(euler(p.rotation));
    const origin = new Vector3().fromArray(p.position);
    if (parent) {
      origin.applyQuaternion(parent.rotation).add(parent.origin);
      rotation.premultiply(parent.rotation);
    }
    boneFrames.set(p.id, { origin, rotation });
    const arm = /^(left|right) arm /.test(p.id);
    const leg = includeLegs && /^(left|right) leg /.test(p.id);
    if (!arm && !leg) continue;
    if (p.knots)
      for (const [x = 0, y = 0, z = 0, a = 0, b = 0] of p.knots) {
        const point = new Vector3(x, y, z).applyQuaternion(rotation).add(origin);
        blockers.push(new Sphere(point, Math.max(a, b) * 1.12));
      }
    else if (p.shape === "hand") {
      blockers.push(
        new Sphere(
          new Vector3(0, -need(p.size[1]) * 0.11, 0).applyQuaternion(rotation).add(origin),
          need(p.size[0]) * 0.1,
        ),
      );
    }
  }
  return blockers;
}

function wingClearance(form: Form, wings: FormPart[]) {
  const body = need(form.parts.find((p) => p.id === "body"));
  const facets: Facet[] = [];
  for (const part of wings) {
    const arm = need(form.parts.find((p) => p.id === part.parent));
    const base = new Vector3()
      .fromArray(body.position)
      .add(new Vector3().fromArray(arm.position))
      .add(new Vector3().fromArray(part.position));
    if (!part.wing) continue;
    const geom = wingGeometry(part.wing, part.color, { game: true });
    const vertices = geom.getAttribute("position"),
      indices = need(geom.index ?? undefined).array;
    const points = Array.from({ length: vertices.count }, (_, i) =>
      new Vector3().fromBufferAttribute(vertices, i).add(base),
    );
    for (let j = 0; j < indices.length; j += 3) {
      const tri = new Triangle(
        need(points[need(indices[j])]),
        need(points[need(indices[j + 1])]),
        need(points[need(indices[j + 2])]),
      );
      facets.push({
        tri,
        box: new Box3().setFromPoints([tri.a, tri.b, tri.c]),
      });
    }
    geom.dispose();
  }
  return facets;
}

function routedSling(form: Form, spine: Spine, station: number, side: number, halfWidth: number) {
  const spheres = limbClearance(form.parts);
  for (const s of spheres) s.radius *= 1.18;
  const wingFaces = wingClearance(
    form,
    form.parts.filter((p) => p.shape === "wing"),
  );
  const probe = new Vector3();
  function cost(band: Shell) {
    let hits = 0;
    for (const f of band.faces) {
      const triangle = new Triangle(
        need(band.vertices[need(f[0])]),
        need(band.vertices[need(f[1])]),
        need(band.vertices[need(f[2])]),
      );
      const box = new Box3().setFromPoints([triangle.a, triangle.b, triangle.c]);
      if (
        spheres.some(
          (s) =>
            box.intersectsSphere(s) &&
            triangle.closestPointToPoint(s.center, probe).distanceToSquared(s.center) <
              s.radius * s.radius,
        )
      )
        hits++;
      if (wingFaces.some((f) => box.intersectsBox(f.box) && box.intersectsTriangle(f.tri))) hits++;
    }
    return hits;
  }
  const paths: [number, number, number][] = [
    [0.24, 0.07, 0],
    [0.09, 0.03, -0.09],
    [-0.14, 0.055, -0.14],
    [-0.2, -0.04, -0.12],
    [0.28, -0.04, 0.13],
    [-0.03, -0.06, -0.24],
    [0.32, 0.04, 0.22],
  ];
  let best: Shell | undefined,
    least = Infinity;
  for (const path of paths) {
    const band = diagonalSling(spine, station, side, halfWidth, path),
      hits = cost(band);
    if (hits < least) {
      best = band;
      least = hits;
    }
    if (!hits) break;
  }
  return need(best);
}

export function fitDrawnEquipment(plan: Plan, kit: Kit, form: Form, spine: Spine): Kit | null {
  const wings = form.parts.filter((p) => p.shape === "wing");
  const limbs = limbClearance(form.parts, plan.anatomyRevision === 2);
  if (!wings.length && !limbs.length) return kit;
  const facets = wingClearance(form, wings);
  const sides = kit.kind === "trader panniers" ? [1, -1] : [kit.side === "left" ? 1 : -1];
  const stations = [kit.station, 0.16, 0.24, 0.42, 0.55, 0.69, 0.82].sort(
    (a, b) => Math.abs(a - kit.station) - Math.abs(b - kit.station),
  );
  const attempts: [number, Kit["mount"]][] = [
    [kit.size, "flank"],
    [Math.max(0.62, kit.size * 0.75), "flank"],
  ];
  if (kit.kind !== "trader panniers" && plan.spine.front > 62) attempts.push([kit.size, "back"]);
  attempts.push([0.57, "flank"]);
  for (const [size, mount] of attempts) {
    const unit = loadUnit(plan, { ...kit, size });
    for (const station of stations)
      for (const hang of mount === "back"
        ? [-1.4, -0.98]
        : kit.kind === "trader panniers"
          ? [kit.hang, 0.47, 0.82, -0.52, -0.98]
          : [kit.hang, 0.47, 0.82, -0.52, -0.98, -1.4]) {
        const frame = spine.at(station);
        const clear = sides.every((side) => {
          const p = bagPosition(frame, side, hang, unit, mount);
          const high = kit.kind === "survey kit" ? 1.9 : 1.39,
            end = kit.kind === "survey kit" ? 1.37 : 1;
          const bounds = new Box3();
          for (const x of [-0.02, 0.95])
            for (const y of [-0.7, high])
              for (const z of [-1, end]) bounds.expandByPoint(p(x, y, z));
          return (
            !limbs.some((sphere) => bounds.intersectsSphere(sphere)) &&
            !facets.some((f) => bounds.intersectsBox(f.box) && bounds.intersectsTriangle(f.tri))
          );
        });
        if (clear) return { ...kit, size, station, hang, mount };
      }
  }
  return null;
}

export function equipCreature(
  form: Form,
  plan: Plan,
  spine: Spine,
  unavailableHands?: Set<string>,
): Form {
  const kit = plan.equipment;
  if (!kit || kit.kind === "none") return form;
  const selectedHand =
    kit.handling === "offer" ? dispatchHand(form, kit.side, unavailableHands) : null;
  const count = equipmentRegionCount(selectedHand ? kit : { kind: kit.kind });
  let heldTube: { centre: Vector3; axis: Vector3; radial: Vector3; tubeId: string } | undefined;
  if (form.parts.length + count > 128)
    throw new Error("This " + kit.kind + " needs " + count + " free regions on the creature.");
  const parts = [...form.parts],
    body = need(parts.find((p) => p.id === "body")),
    frame = spine.at(kit.station);
  const draw = randomStream(kit.seed),
    side = kit.side === "left" ? 1 : -1;
  const scale = plan.scale,
    unit = loadUnit(plan, kit);
  const volumes = new Map([["body", new Vector3().fromArray(body.position)]]);
  const add = (
    id: string,
    parent: string,
    pivot: Vector3,
    geometry: Shell[],
    color: string,
    surface = "plain",
  ) => {
    const part: FormPart = {
      id,
      parent,
      shape: "cage",
      cage: cageFrom(geometry, pivot, unit),
      position: pivot
        .clone()
        .sub(need(volumes.get(parent)))
        .toArray(),
      size: [unit, unit, unit],
      frameSize: [unit, unit, unit],
      rotation: [0, 0, 0],
      color,
      surface,
      motionRole: "rigid",
    };
    parts.push(part);
    volumes.set(id, pivot);
    return id;
  };
  const pos = (side: number) => bagPosition(frame, side, kit.hang, unit, kit.mount);
  const at = pos(side),
    far = pos(-side);
  const strap = "#554337",
    gold = "#d9b779",
    metal = "#587178",
    parchment = "#e2cc9b",
    wood = "#926642";
  const separation = clamp((unit / (plan.spine.length * scale)) * 0.55, 0.065, 0.15),
    bandWidth = clamp((unit / (plan.spine.length * scale)) * 0.09, 0.012, 0.031);
  const saddles = [at, ...(kit.kind === "trader panniers" ? [far] : [])].map((p) =>
    caseShell(p, 0.015, 0, 0, 0.37, 1.17, 1.41, [
      [0, 0.79],
      [0.78, 1],
      [1, 0.86],
    ]),
  );
  const harness = add(
    "gear harness",
    "body",
    frame.centre,
    [
      band(spine, kit.station - separation, bandWidth),
      band(spine, kit.station + separation, bandWidth),
      ...saddles,
    ],
    strap,
    "leather",
  );
  const box = (
    p: At,
    x: number,
    y: number,
    z: number,
    d: number,
    h: number,
    w: number,
    levels?: number[][],
  ) => caseShell(p, x, y, z, d, h, w, levels);
  const tube = (p: At, start: Triple, end: Triple, profile: number[][]) =>
    cylinder(
      p(...start),
      p(...end),
      profile.map(([t = 0, r = 0]) => [t, r * unit]),
    );
  const pouch = (p: At) =>
    add(
      "gear bag",
      harness,
      p(0.23, 0, 0),
      [box(p, 0.26, 0, 0, 0.83, 1.28, 1.43)],
      kit.color,
      "canvas",
    );
  const buckleFrame = (p: At, z: number) => {
    const ring = (x: number, width: number, height: number) =>
      beveled.map(([i, j]) => p(x, 0.14 + j * height, z + i * width));
    return shell(
      [
        ring(0.708, 0.1, 0.14),
        ring(0.708, 0.152, 0.195),
        ring(0.794, 0.152, 0.195),
        ring(0.794, 0.1, 0.14),
      ],
      true,
    );
  };
  const closures = (p: At, carrier: string) => {
    const lid = add(
      "gear flap",
      carrier,
      p(0.55, 0.3, 0),
      [
        box(p, 0.32, 0.56, 0, 0.91, 0.26, 1.5),
        box(p, 0.67, 0.34, 0, 0.16, 0.51, 1.34, [
          [0, 0.76],
          [0.18, 0.94],
          [0.92, 1],
          [1, 0.93],
        ]),
        ...[-0.4, 0.4].map((z) => box(p, 0.7, 0.055, z, 0.14, 0.51, 0.16)),
      ],
      "#694631",
      "leather",
    );
    add(
      "gear clasps",
      lid,
      p(0.79, 0.14, 0),
      [-0.4, 0.4].map((z) => buckleFrame(p, z)),
      gold,
      "metal",
    );
  };
  const bedroll = (p: At, carrier: string) => {
    const radius = 0.33,
      lift = 0.74;
    const tilt = (draw() - 0.5) * 0.2;
    const y = (z: number) => lift + tilt * z;
    const id = add(
      "gear bedroll",
      carrier,
      p(0.24, lift, 0),
      [
        tube(
          p,
          [0.24, y(-0.82), -0.82],
          [0.24, y(0.85), 0.85],
          [
            [0, radius * 0.88],
            [0.07, radius],
            [0.93, radius],
            [1, radius * 0.88],
          ],
        ),
      ],
      "#778570",
      "canvas",
    );
    add(
      "gear bedroll straps",
      id,
      p(0.24, lift, 0),
      [-0.5, 0.5].map((z) =>
        tube(
          p,
          [0.24, y(z - 0.07), z - 0.07],
          [0.24, y(z + 0.07), z + 0.07],
          [
            [0, radius * 0.94],
            [0.15, radius * 1.09],
            [0.85, radius * 1.09],
            [1, radius * 0.94],
          ],
        ),
      ),
      strap,
      "leather",
    );
  };
  if (kit.kind === "courier satchel") {
    const bag = pouch(at);
    closures(at, bag);
    add(
      "gear courier sling",
      "body",
      frame.centre,
      [routedSling(form, spine, kit.station, side, bandWidth * 1.75)],
      "#c58e55",
      "leather",
    );
    const lift = 0.82 + 0.19 * draw();
    const line = (t: number): Triple => [0.64, 0.04 + lift * t, -0.55 + 1.14 * t];
    const tubeId = add(
      "gear dispatch tube",
      bag,
      at(...line(0.5)),
      [
        tube(at, line(-0.36), line(1.17), [
          [0, 0.19],
          [0.06, 0.215],
          [0.93, 0.215],
          [1, 0.2],
        ]),
      ],
      "#dbc696",
      "canvas",
    );
    add(
      "gear tube fittings",
      tubeId,
      at(...line(0.58)),
      [-0.29, 0.3, 0.69, 1.18].map((t, i) => {
        const h = i === 3 ? 0.13 : 0.066,
          r = i === 3 ? 0.29 : 0.238;
        return tube(at, line(t - h), line(t + h), [
          [0, r * 0.9],
          [0.12, r],
          [0.9, r],
          [1, r * 0.92],
        ]);
      }),
      gold,
      "metal",
    );
    if (selectedHand) {
      const grip = handHandle(selectedHand),
        middle = at(...line(-0.025));
      const axis = at(...line(1))
        .sub(at(...line(0)))
        .normalize();
      const radial = at(1, 0, 0)
        .sub(at(0, 0, 0))
        .normalize();
      const stem = middle.clone().addScaledVector(radial, 0.16 * unit);
      const centre = middle.clone().addScaledVector(radial, 0.215 * unit + grip.radius * 2.4);
      const along = (p: Vector3, d: number) => p.clone().addScaledVector(axis, d);
      const profile = [
        [0, 0.84 * grip.radius],
        [0.1, grip.radius],
        [0.9, grip.radius],
        [1, 0.84 * grip.radius],
      ];
      add(
        "gear dispatch handle",
        tubeId,
        centre,
        [
          cylinder(
            along(centre, -grip.length * 0.5),
            along(centre, grip.length * 0.5),
            profile,
            12,
          ),
          ...[-1, 1].map((sign) => {
            const d = sign * grip.length * 0.46;
            return cylinder(along(stem, d), along(centre, d), [
              [0, grip.radius * 0.63],
              [1, grip.radius * 0.59],
            ]);
          }),
        ],
        metal,
        "metal",
      );
      heldTube = { centre, axis, radial, tubeId };
    }
    const cap = line(1.19),
      waferX = cap[0] + 0.22;
    add(
      "gear dispatch seal",
      "gear tube fittings",
      at(waferX, cap[1], cap[2]),
      [
        tube(
          at,
          [waferX - 0.1, cap[1], cap[2]],
          [waferX + 0.04, cap[1], cap[2]],
          [
            [0, 0.13],
            [0.23, 0.2],
            [0.86, 0.2],
            [1, 0.16],
          ],
        ),
        box(at, waferX - 0.04, cap[1] - 0.14, cap[2] - 0.015, 0.075, 0.37, 0.12),
      ],
      "#a83d30",
      "leather",
    );
    const envelope = add(
      "gear dispatch envelope",
      "gear flap",
      at(0.77, 0.22, 0),
      [
        box(at, 0.766, 0.24, 0, 0.09, 0.64, 0.9, [
          [0, 0.94],
          [0.08, 1],
          [0.92, 1],
          [1, 0.96],
        ]),
      ],
      "#ebdcb0",
      "canvas",
    );
    add(
      "gear envelope fold",
      envelope,
      at(0.824, 0.3, 0),
      [-1, 1].map((sign) =>
        tube(
          at,
          [0.814, 0.49, sign * 0.39],
          [0.822, 0.24, 0],
          [
            [0, 0.023],
            [0.08, 0.034],
            [0.94, 0.034],
            [1, 0.023],
          ],
        ),
      ),
      "#976847",
      "plain",
    );
    add(
      "gear envelope seal",
      envelope,
      at(0.821, 0.23, 0),
      [
        tube(
          at,
          [0.791, 0.23, 0],
          [0.856, 0.23, 0],
          [
            [0, 0.105],
            [0.28, 0.145],
            [0.84, 0.145],
            [1, 0.12],
          ],
        ),
      ],
      "#9c352c",
      "leather",
    );
  } else if (kit.kind === "survey kit") {
    const fieldCase = add(
      "gear instrument case",
      harness,
      at(0.27, 0.05, 0),
      [
        box(at, 0.26, 0.03, 0, 0.79, 1.5, 1.04, [
          [0, 0.72],
          [0.12, 1],
          [0.88, 1],
          [1, 0.84],
        ]),
      ],
      kit.color,
      "metal",
    );
    const pitch = 0.35 + 0.3 * draw(),
      za = -1.09,
      zb = 1.27;
    const scopeY = (z: number) => 1.03 + pitch * z;
    const cradle = add(
      "gear case edges",
      fieldCase,
      at(0.3, 0.05, 0),
      [
        ...[-0.52, 0.58].map((y) => box(at, 0.26, y, 0, 0.83, 0.14, 1.08)),
        ...[-0.32, 0.35].map((z) =>
          box(at, 0.33, (scopeY(z) + 0.56) * 0.5, z, 0.35, scopeY(z) - 0.56, 0.22, [
            [0, 1],
            [0.74, 0.7],
            [1, 0.94],
          ]),
        ),
      ],
      metal,
      "metal",
    );
    const scope = add(
      "gear telescope",
      cradle,
      at(0.33, 1.03, 0),
      [
        tube(
          at,
          [0.33, scopeY(za), za],
          [0.33, scopeY(zb), zb],
          [
            [0, 0.105],
            [0.09, 0.105],
            [0.11, 0.075],
            [0.28, 0.075],
            [0.29, 0.127],
            [0.55, 0.127],
            [0.56, 0.174],
            [0.8, 0.174],
            [0.81, 0.236],
            [0.92, 0.28],
            [1, 0.28],
          ],
        ),
      ],
      gold,
      "metal",
    );
    add(
      "gear telescope rims",
      scope,
      at(0.33, 1.03, 0),
      [-0.94, 0.2, 1.18].map((z, i) => {
        const r = need([0.13, 0.186, 0.3][i]);
        return tube(
          at,
          [0.33, scopeY(z - 0.066), z - 0.066],
          [0.33, scopeY(z + 0.066), z + 0.066],
          [
            [0, r * 0.95],
            [0.13, r],
            [0.87, r],
            [1, r * 0.95],
          ],
        );
      }),
      "#434c51",
      "metal",
    );
    add(
      "gear objective",
      scope,
      at(0.33, scopeY(zb), zb),
      [
        tube(
          at,
          [0.33, scopeY(zb - 0.015), zb - 0.015],
          [0.33, scopeY(zb + 0.045), zb + 0.045],
          [
            [0, 0.231],
            [0.5, 0.24],
            [1, 0.2],
          ],
        ),
      ],
      "#41818b",
      "metal",
    );
    add(
      "gear compass",
      fieldCase,
      at(0.65, 0.19, 0),
      [
        tube(
          at,
          [0.6, 0.19, 0],
          [0.78, 0.19, 0],
          [
            [0, 0.29],
            [0.25, 0.35],
            [0.86, 0.35],
            [1, 0.29],
          ],
        ),
      ],
      parchment,
      "plain",
    );
    add(
      "gear compass needle",
      "gear compass",
      at(0.79, 0.19, 0),
      [
        tube(
          at,
          [0.79, 0.005, -0.1],
          [0.79, 0.39, 0.13],
          [
            [0, 0.023],
            [0.45, 0.085],
            [0.65, 0.071],
            [1, 0.012],
          ],
        ),
      ],
      "#944137",
      "plain",
    );
    const legs = [
      [-0.31, -0.21],
      [0.08, 0.0],
      [0.51, 0.22],
    ];
    add(
      "gear tripod",
      fieldCase,
      at(0.72, -0.18, 0),
      legs.map(([z = 0, top = 0]) =>
        tube(
          at,
          [0.72, -0.93, z - 0.31],
          [0.55, 0.12, top],
          [
            [0, 0.055],
            [0.1, 0.073],
            [0.9, 0.073],
            [1, 0.055],
          ],
        ),
      ),
      metal,
      "metal",
    );
  } else {
    const bag = pouch(far);
    closures(far, bag);
    bedroll(far, bag);
    const rings = [
      [-0.64, 0.74],
      [-0.54, 0.85],
      [0.44, 1],
      [0.59, 1.02],
      [0.6, 0.88],
      [-0.49, 0.71],
    ].map(([y = 0, s = 0]) => beveled.map(([i, j]) => at(0.35 + i * 0.56 * s, y, j * 0.85 * s)));
    const basket = add(
      "gear pannier",
      harness,
      at(0.35, 0, 0),
      [shell(rings), box(at, 0.35, 0.15, 0, 0.9, 0.28, 1.4)],
      wood,
      "canvas",
    );
    const slats = [-0.51, 0, 0.51].map((z) => box(at, 0.855, -0.04, z, 0.14, 1.02, 0.12));
    add(
      "gear basket straps",
      basket,
      at(0.35, 0.03, 0),
      [...[-0.38, 0.39].map((y) => box(at, 0.35, y, 0, 1.13, 0.12, 1.7)), ...slats],
      strap,
      "leather",
    );
    const jarHeight = 0.82 + 0.38 * draw();
    add(
      "gear trade jar",
      basket,
      at(0.38, 0.65, -0.39),
      [
        tube(
          at,
          [0.38, 0.21, -0.39],
          [0.39, jarHeight + 0.22, -0.37],
          [
            [0, 0.19],
            [0.19, 0.31],
            [0.53, 0.32],
            [0.72, 0.27],
            [0.81, 0.13],
            [0.93, 0.14],
            [0.94, 0.185],
            [1, 0.18],
          ],
        ),
      ],
      draw() < 0.5 ? "#b55740" : "#748692",
      "plain",
    );
    const fabric = draw() < 0.5;
    const stock = fabric
      ? [
          box(at, 0.38, 0.66, 0.33, 0.54, 0.91, 0.62, [
            [0, 0.73],
            [0.09, 0.94],
            [0.71, 1],
            [1, 0.84],
          ]),
        ]
      : [
          tube(
            at,
            [0.37, 0.2, 0.34],
            [0.38, 1.37, 0.47],
            [
              [0, 0.23],
              [0.16, 0.27],
              [0.65, 0.27],
              [0.88, 0.15],
              [1, 0.1],
            ],
          ),
        ];
    add(
      "gear trade bundle",
      basket,
      at(0.37, 0.82, 0.35),
      stock,
      fabric ? "#c49850" : "#649287",
      "canvas",
    );
  }
  const result = { ...form, parts };
  if (heldTube && selectedHand) {
    const index = parts.findIndex((p) => p.id === selectedHand.id),
      hand = { ...selectedHand };
    parts[index] = hand;
    placeInHand(
      result,
      hand,
      need(parts.find((p) => p.id === heldTube.tubeId)),
      heldTube.centre,
      heldTube.axis,
      heldTube.radial,
    );
  } else if (kit.handling === "offer") {
    const { handling: _, ...packed } = kit;
    result.origin = { ...result.origin, plan: { ...plan, equipment: packed } };
  }
  return result;
}
