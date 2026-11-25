import { MathUtils, Ray, Vector3 } from "three";

const { lerp } = MathUtils;

// Rings run from the nape towards the nose (+Z); x is half breadth, y is
// elevation. The cheekbone and jaw ramus have separate corners on each ring.
export function skullCage(shape, snout) {
  const crusher = snout === "mandibles";
  const grazer = snout === "muzzle";
  const proboscis = snout === "trunk";
  const bill = snout === "bill";
  const low = shape === "flat" || bill;
  const skull = [
    [-0.59, 0.12, 0.19, -0.12],
    [-0.44, crusher ? 0.43 : 0.33, proboscis ? 0.52 : 0.37, -0.29],
    [
      -0.23,
      crusher ? 0.64 : 0.51,
      proboscis ? 0.71 : 0.54,
      grazer ? -0.57 : -0.43,
    ],
    [
      0.06,
      crusher ? 0.65 : 0.55,
      proboscis ? 0.67 : 0.48,
      grazer ? -0.55 : -0.44,
    ],
    [0.29, bill ? 0.5 : 0.43, low ? 0.32 : 0.43, -0.36],
    [0.48, bill ? 0.42 : 0.31, proboscis ? 0.35 : 0.21, -0.26],
    [0.56, bill ? 0.32 : 0.21, 0.08, -0.19],
  ];
  const rings = skull.map(([z, w, top, base]) => {
    const orbit = z > 0 && z < 0.4 ? 0.79 : 1;
    const points = [
      [0, top],
      [0.58 * w, top * 0.96],
      [0.86 * w, top * 0.66],
      [orbit * w, top * 0.22],
      [w * (z > -0.32 && z < 0.22 ? 1.11 : 0.98), base * 0.22],
      [w * 0.86, base * 0.71],
      [w * 0.53, base],
      [0, base * 1.04],
    ];
    return [
      ...points,
      ...points
        .slice(1, -1)
        .reverse()
        .map(([x, y]) => [-x, y]),
    ].map(([x, y]) => [x, y, z]);
  });
  return loft(rings);
}

// Attach an orbit or a crest by casting its local unit direction against
// the cranial control hull. The small inset matches the subdivided surface.
export function skullSurfaceRadius(cage, az, el) {
  const direction = new Vector3(
    Math.sin(az) * Math.cos(el),
    Math.sin(el),
    Math.cos(az) * Math.cos(el),
  );
  const ray = new Ray(new Vector3(), direction);
  const a = new Vector3(),
    b = new Vector3(),
    c = new Vector3(),
    hit = new Vector3();
  for (const face of cage.faces) {
    a.fromArray(cage.vertices[face[0]]);
    for (let j = 1; j < face.length - 1; j++)
      if (
        ray.intersectTriangle(
          a,
          b.fromArray(cage.vertices[face[j]]),
          c.fromArray(cage.vertices[face[j + 1]]),
          false,
          hit,
        )
      )
        return hit.length() * 0.971;
  }
  return 0.5;
}

// Closed section loft with centroid fans on either end. Consistent winding
// also supports the reflected blade of the other mandible.
function loft(rings) {
  const vertices = rings.flat(),
    faces = [],
    sides = rings[0].length;
  for (let j = 0; j < rings.length - 1; j++)
    for (let i = 0; i < sides; i++) {
      const n = (i + 1) % sides,
        a = j * sides,
        b = a + sides;
      faces.push([a + i, a + n, b + n, b + i]);
    }
  for (const [row, first] of [
    [0, true],
    [rings.length - 1, false],
  ]) {
    const ring = rings[row],
      center = ring.reduce(
        (p, v) => p.map((x, i) => x + v[i] / sides),
        [0, 0, 0],
      );
    const c = vertices.push(center) - 1,
      a = row * sides;
    for (let i = 0; i < sides; i++) {
      const n = (i + 1) % sides;
      faces.push(first ? [c, a + n, a + i] : [c, a + i, a + n]);
    }
  }
  return finish(vertices, faces);
}

function finish(vertices, faces) {
  let volume = 0;
  const a = new Vector3(),
    b = new Vector3(),
    c = new Vector3();
  for (const face of faces) {
    a.fromArray(vertices[face[0]]);
    for (let j = 1; j < face.length - 1; j++)
      volume += a.dot(
        b
          .fromArray(vertices[face[j]])
          .cross(c.fromArray(vertices[face[j + 1]])),
      );
  }
  if (volume < 0) for (const face of faces) face.reverse();
  return { vertices, faces, levels: 1 };
}

// The dorsal lip is taller and swept backwards. Its lower lip opens onto
// the moving femur. All sockets on one side share a trunk attachment.
export function coxalShields(row) {
  // Beyond eight sockets the widest joints carry the shields.
  row = [...row].sort((a,b)=>b.r0-a.r0).slice(0,8);
  const points = [], faces = [];
  const centre = row.reduce((sum,leg) => sum.add(leg.root),new Vector3()).divideScalar(row.length);
  const unit = Math.max(...row.map(leg=>leg.frame.radius[0]),.01);
  // Keep the editable cage within its point budget even on radial walkers.
  const sides = Math.min(10, Math.floor((192/row.length-2)/5));
  for (const {root,knee,r0,frame} of row) {
    const axis = knee.clone().sub(root).normalize();
    const dorsal = frame.dorsal.clone().addScaledVector(axis,-frame.dorsal.dot(axis)).normalize();
    const cross = new Vector3().crossVectors(axis,dorsal).normalize();
    const reach = Math.min(root.distanceTo(knee)*.56,frame.radius[0]*.56);
    const partial = loft([[-.06,.95,0],[.38,1.48,.28],[.72,1.41,.44],
      [1.05,1.22,.17],[1.13,.91,0]].map(([t,r,lip]) =>
      Array.from({length:sides},(_,i)=>{
        const a=i*2*Math.PI/sides, top=Math.sin(a), span=Math.cos(a);
        const cap=root.clone().addScaledVector(axis,reach*t)
          .addScaledVector(dorsal,r0*(r*top+lip*Math.max(top,0)))
          .addScaledVector(cross,r0*r*span*.96)
          .addScaledVector(frame.tangent,-r0*.45*lip*Math.max(top,0));
        return cap.sub(centre).divideScalar(unit).toArray();
      })));
    const base = points.length;
    for (const v of partial.vertices) points.push(v);
    for (const f of partial.faces) faces.push(f.map(i=>i+base));
  }
  return {centre,unit,cage:{vertices:points,faces,levels:1}};
}

// The whole pinna is one sheet folded back around its lip. Its cupped inner
// face has a raised antihelix below a softer turned-over tip.
// Profiles grow from the same nine cartilage loops as the original ear.
// Each station gives the centreline's sideways, vertical and rearward reach,
// followed by its half width. The last two stations turn the tip.
const pinnae = {
  lance: [[0,0,0,.035],[.09,.12,.01,.14],[.19,.29,.065,.15],[.29,.49,.16,.105],[.35,.68,.22,.016]],
  fan: [[0,0,0,.05],[.085,.10,.02,.16],[.20,.22,.08,.25],[.29,.36,.15,.19],[.33,.48,.23,.04]],
  lop: [[0,0,0,.055],[.15,.07,.03,.145],[.32,.025,.07,.16],[.40,-.12,.15,.13],[.41,-.29,.19,.034]],
  swept: [[0,0,0,.04],[.12,.08,.05,.11],[.28,.16,.16,.145],[.42,.21,.30,.096],[.53,.255,.45,.018]],
  tufted: [[0,0,0,.075],[.07,.085,.015,.16],[.14,.20,.03,.125],[.19,.34,.08,.065],[.225,.49,.12,.009]],
};

function shapedPinna(outward, up, forward, style) {
  const side = outward.clone().addScaledVector(up, -outward.dot(up));
  side.addScaledVector(forward, -side.dot(forward)).normalize();
  const stations = pinnae[style];
  // In a front view the rim spreads across the centreline. In profile
  // it rolls forward at the base and bends back towards the tip.
  const rows = [[.22,-.062],[.72,-.066],[.97,-.038],[1,.012],[.92,.051],
    [.77,.025],[.60,-.031],[.36,.002],[.16,-.027]];
  const rings = rows.map(([radius, depth], ring) => Array.from({length:16}, (_, i) => {
    const angle = i * Math.PI / 8;
    const v = (.5 + .5 * Math.sin(angle) * radius) * 4;
    const j = Math.min(3, Math.floor(v));
    const [reach, height, back, width] = stations[j].map((value,k) =>
      lerp(value,stations[j+1][k],v-j));
    const x = radius * Math.cos(angle);
    const t = v / 4;
    const lateral = style === "lop" ? .46 : style === "swept" ? .55 : .85;
    const fold = (ring === 6 || ring === 7) ? .038 * Math.max(0,1-2*t) : 0;
    return side.clone().multiplyScalar(reach + x*width*lateral)
      .addScaledVector(up, height - x*width*(1-lateral))
      .addScaledVector(forward, -back+depth+fold - .05*x*x + x*width*.45).toArray();
  }));
  return loft(rings);
}

export function earCage(outward, up, forward, rounded, style) {
  if (Object.hasOwn(pinnae, style)) return shapedPinna(outward, up, forward, style);
  const axis = outward.clone().multiplyScalar(.70).addScaledVector(up,.56)
    .addScaledVector(forward,-.15).normalize();
  const across = new Vector3().crossVectors(axis,forward).normalize();
  const towards = new Vector3().crossVectors(across,axis).normalize();
  const size = rounded ? .50 : .67;
  const rows = [[.19,-.09],[.70,-.082],[1,-.036],[1.01,.029],[.86,.064],[.72,.019],[.53,-.032],[.35,.012],[.17,-.04]];
  return loft(rows.map(([radius, depth], row) => Array.from({length:16}, (_, i) => {
    const a = i*Math.PI/8, t = Math.sin(a);
    const profile = rounded ? .235*(1-.12*t) : .185*(1-.45*t);
    const x = Math.cos(a)*radius*profile;
    const y = size*(.46+.57*t*radius);
    const bowl = depth + .038*t*t*radius - .061*Math.max(0,t)**2*radius
      + (row===7 ? .04*(1-t)*Math.abs(Math.cos(a)) : 0);
    return axis.clone().multiplyScalar(y).addScaledVector(across,x).addScaledVector(towards,bowl).toArray();
  })));
}

// The two fingers of a chela have different jobs. The fixed finger carries the
// heavy crushing teeth and grows out of the palm. The moving finger hinges
// from the far shoulder of the palm and hooks over its tip.
export function chelaCage(part, forward, opening) {
  const normal = new Vector3().crossVectors(forward, opening).normalize();
  let sections;
  if (part === "palm") {
    // Distance along the wrist, centre in the gape plane, half-width, depth.
    sections = [
      [-.17, 0, .21, .24], [-.08, 0, .30, .30], [.11, -.02, .34, .34],
      [.28, -.055, .47, .40], [.60, -.065, .55, .41], [.84, -.085, .51, .32],
      [1.01, -.14, .39, .24], [1.12, -.21, .24, .17]
    ];
  } else {
    const movable = part === "upper";
    const sign = movable ? 1 : -1;
    // Opposing teeth are staggered. They belong to the blade's own surface.
    const profile = movable
      ? [[.72,.25,.21],[.88,.35,.25],[1.08,.46,.23],[1.23,.52,.185],
         [1.37,.53,.16],[1.49,.52,.14],[1.64,.47,.12],[1.81,.37,.085],
         [1.98,.17,.042],[2.03,.075,.016]]
      : [[.73,.22,.25],[.95,.31,.29],[1.12,.37,.24],[1.26,.42,.21],
         [1.42,.43,.18],[1.57,.42,.15],[1.72,.37,.13],[1.89,.29,.095],
         [2.03,.19,.057],[2.14,.075,.014]];
    sections = profile.map(([z, y, width]) => [z,sign*y,width,width*(movable ? .78 : .95)]);
  }
  return loft(sections.map(([z, y, width, depth], row) =>
    Array.from({length: 10}, (_, i) => {
      const a = i*Math.PI/5, lateral = Math.cos(a);
      const inward = part === "upper" ? -lateral : lateral;
      const tooth = part !== "palm" && row >= 3 && row <= 7 &&
        row % 2 === (part === "upper" ? 0 : 1) ? .15*Math.max(0,inward)**5 : 0;
      return forward.clone().multiplyScalar(z)
        .addScaledVector(opening, y + (width+tooth)*lateral)
        .addScaledVector(normal, depth*Math.sin(a)).toArray();
    })));
}

// A pectoral fin opens from a narrow muscular base, with longer anterior
// rays and a trailing membrane that draws inward between their tips.
export function pectoralFinCage(side, sweep, span, chord, girth) {
  const direction = new Vector3(side * Math.cos(sweep), -0.18, -Math.sin(sweep)).normalize();
  const across = new Vector3(-side * Math.sin(sweep), 0, -Math.cos(sweep));
  const up = new Vector3().crossVectors(direction, across).normalize().multiplyScalar(side);
  const vertices = [], faces = [], columns = 13, stations = [0, 0.24, 0.66, 1];
  const upper = columns * stations.length;
  const unit = Math.max(span, chord, girth);
  for (const sign of [1, -1])
    for (const t of stations)
      for (let i = 0; i < columns; i++) {
        const u = i / (columns - 1), ray = i % 2 === 0;
        const length = span * (0.94 + 0.12 * Math.sin(Math.PI * u) - 0.51 * u ** 2);
        const notch = ray ? 0 : 0.085 * span * t ** 3;
        const fan = (u - 0.28) * chord * (0.47 + 1.13 * t);
        const camber = span * (0.14 * t * (1 - t) - 0.095 * u * t ** 2);
        const web = girth * (0.16 * (1 - t) ** 2 + (ray ? 0.073 : 0.018) * (1 - 0.8*t));
        vertices.push(direction.clone().multiplyScalar(t * length - notch)
          .addScaledVector(across, fan + 0.20 * span * t ** 2)
          .addScaledVector(up, camber + sign * web).divideScalar(unit).toArray());
      }
  for (let row = 0; row < stations.length - 1; row++)
    for (let i = 0; i < columns - 1; i++) {
      const a = row * columns + i;
      const face = [a, a + columns, a + columns + 1, a + 1];
      faces.push(face, face.map(j => j + upper).reverse());
    }
  const edge = [];
  for (let row = 0; row < stations.length; row++) edge.push(row * columns);
  for (let i = 1; i < columns; i++) edge.push(upper - columns + i);
  for (let row = stations.length - 2; row >= 0; row--) edge.push(row * columns + columns - 1);
  for (let i = columns - 2; i > 0; i--) edge.push(i);
  for (let i = 0; i < edge.length; i++) {
    const a = edge[i], b = edge[(i + 1) % edge.length];
    faces.push([b, a, a + upper, b + upper]);
  }
  return finish(vertices, faces);
}

// The two caudal lobes share a narrow peduncle and sweep back around a fork.
export function caudalFinCage(along, horizontal) {
  const across = new Vector3(1, 0, 0).addScaledVector(along, -along.x).normalize();
  const vertical = new Vector3().crossVectors(across, along).normalize();
  const width = horizontal ? across : vertical, normal = horizontal ? vertical : across;
  const rings = [];
  for (let i = -8; i <= 8; i++) {
    const u = i / 8, v = Math.abs(u);
    const leading = -0.53 + 3.65 * v ** 1.68;
    const trailing = 1.62 + 1.70 * v ** 0.77 + 0.11 * Math.sin(i * Math.PI / 2) ** 2;
    const half = Math.max(0.022, 0.28 * (1 - v ** 1.15));
    const middle = lerp(leading, trailing, 0.42);
    const bent = 0.20 * v ** 1.5;
    rings.push([[leading, 0], [middle, half], [trailing, 0], [middle, -half]].map(([z,h]) =>
      width.clone().multiplyScalar(u * 3.65).addScaledVector(along, z)
        .addScaledVector(normal, h + bent).multiplyScalar(0.25).toArray()));
  }
  return loft(rings);
}

// Corneous upper and lower shells keep their own culmen and cutting edge.
// Sections run from the cheek across the bridge to the paired upper lip pads.
// The lower jaw sits on its own hinge; the teeth retain their separate roots.
export function mammalMuzzle(profile, lower, width, height, reach, drop) {
  const cat = profile === "feline", rooting = profile === "rooting";
  const grazing = profile === "grazing";
  const widths = lower ? [.35,.38,.33,.26,.19,.11] :
    [.40,.38,.30,cat ? .36 : .265,rooting ? .25 : cat ? .27 : .21,rooting ? .22 : .13];
  const sections = [0,.22,.49,.73,.91,1];
  const rings = sections.map((t,i) => {
    const w = width*widths[i];
    const h = height*(lower ? [.19,.21,.17,.14,.105,.075] :
      [.34,.35,.27,.19,.15,.12])[i];
    const bridge = lower ? 0 : height * .047 * Math.sin(Math.PI*t);
    return Array.from({length:20}, (_,j) => {
      const a = 2*Math.PI*j/20, x = Math.cos(a), y = Math.sin(a);
      const pad = (cat ? .54 : grazing ? .40 : .32) * Math.sin(t*Math.PI*.65)**3;
      const lip = lower ? 0 : pad*Math.abs(x)**1.3*Math.max(0,-y);
      const sectionY = y >= 0 ? y*(lower ? .72 : 1) :
        y*(lower ? .95 : .78) - lip;
      const tip = lower ? .007 : (grazing ? .08 : .04);
      const z = reach*t + reach*tip*Math.abs(x)*t**4;
      return [w*x, drop*t + bridge + h*sectionY,z];
    });
  });
  return loft(rings);
}

// Each nasal wing has a thick rim rolled around a blind cavity. The two
// wings share a straight medial border; their concave ends face forward.
export function noseWing(profile, side) {
  const rooting = profile === "rooting";
  const scaleY = rooting ? .85 : .65;
  const border = [[0,.63],[.31,.67],[.76,.56],[1,.27],[.99,-.10],
    [.73,-.36],[.34,-.53],[0,-.63],[0,-.36],[0,-.08],[0,.16],[0,.42]];

  const edge = border.map(([x,y]) => [x,y,(rooting ? .33 : .45)-.29*x*x+.09*y]);
  const centre = [.60,.03];
  const opening = border.map(([x,y]) => {
    const angle = Math.atan2(y-centre[1],x-centre[0]);
    return [centre[0]+.245*Math.cos(angle),centre[1]+.20*Math.sin(angle)+.11*Math.cos(angle)];
  });
  const rings = [
    edge.map(([x,y,z])=>[x*.88,y*.82,z-.66]), edge,
    opening.map(([x,y])=>[x,y,.47-.20*x]),
    opening.map(([x,y])=>[.60+(x-.60)*.69,.03+(y-.03)*.68,.22-.14*x]),
    opening.map(([x,y])=>[.60+(x-.60)*.44,.03+(y-.03)*.38,.05-.12*x]),
  ];
  return loft(rings.map(row=>row.map(([x,y,z])=>[x*side,y*scaleY,z])));
}

// The bill fans out near its tip; the beak hooks under the shorter lower jaw.
// Longitudinal sections of the upper and lower rhamphotheca. A spear
// tapers to a common point, a seed cracker bears deep opposed cutting
// faces, and a spoon narrows at mid-length before spreading at the tip.
const feedingBills = {
  spear: { length: 1.36, width: .72, depth: .64, lower: .985, bend: -.08,
    breadth: [.95,1,.76,.5,.29,.12,.025], crown: [.72,1,.78,.54,.32,.14,.03] },
  spoon: { length: 1.30, width: 1.28, depth: .5, lower: .97, bend: .13,
    breadth: [.70,.80,.51,.41,.86,1,.52], crown: [.88,1,.65,.39,.45,.42,.26] },
  crusher: { length: .67, width: 1.32, depth: 1.09, lower: .87, bend: -.34,
    breadth: [.88,1,.92,.65,.40,.18,.05], crown: [.84,1,1.07,1.03,.77,.41,.13] },
  shear: { length: .83, width: 1.40, depth: .69, lower: .93, bend: -.47,
    breadth: [.91,1,.98,.88,.65,.32,.08], crown: [.60,.82,.91,.80,.64,.44,.18] },
  scythe: { length: 1.54, width: .60, depth: .63, lower: .98, bend: -1.22,
    breadth: [.82,1,.76,.59,.43,.24,.06], crown: [.77,1,.85,.68,.43,.26,.09] },
};

export function beakCage(bill, lower, width, height, length, gape, profile) {
  const cut = feedingBills[profile];
  width *= cut?.width ?? 1;
  height *= cut?.depth ?? 1;
  const long = length * (cut?.length ?? 1) * (lower ? (cut?.lower ?? (bill ? .96 : .77)) : 1);
  const rows = bill
    ? [
        [-0.12, 0.64, 0.94],
        [0.04, 0.68, 1],
        [0.27, 0.6, 0.66],
        [0.58, 0.8, 0.54],
        [0.81, 1, 0.49],
        [0.94, 0.81, 0.44],
        [1, 0.36, 0.31],
      ]
    : [
        [-0.13, 0.8, 0.82],
        [0.04, 1, 1],
        [0.27, 0.9, 1.05],
        [0.55, 0.65, 0.85],
        [0.78, 0.42, 0.65],
        [0.93, 0.18, 0.41],
        [1, 0.045, 0.13],
      ];
  const rings = rows.map(([t, w, h], row) => {
    const at = Math.max(0, t);
    if (cut) {
      w = cut.breadth[row];
      h = cut.crown[row];
    }
    // Preserve the common seam of the jaws as the lower jaw pivots open.
    const arc = cut ? height * cut.bend * at ** 1.8 : 0;
    const y = cut ? arc - (lower ? height*.28 + long*at*Math.sin(gape*.49) : 0) : lower
      ? -height * 0.32 - long * at * Math.sin(gape * 0.49)
      : bill
        ? -at * height * 0.16
        : height * (0.21 * Math.sin(at * Math.PI) - 1.25 * Math.pow(at, 4));
    const W = width * w * (lower ? 0.89 : 1),
      H = height * h * (lower ? 0.58 : 1);
    const section = lower
      ? [
          [0, 0.16],
          [0.84, 0.15],
          [1, -0.05],
          [0.8, -0.57],
          [0, -1],
          [-0.8, -0.57],
          [-1, -0.05],
          [-0.84, 0.15],
        ]
      : [
          [0, 1],
          [0.62, 0.76],
          [0.93, 0.35],
          [1, -0.04],
          [0.82, -0.18],
          [0, -0.22],
          [-0.82, -0.18],
          [-1, -0.04],
          [-0.93, 0.35],
          [-0.62, 0.76],
        ];
    return section.map(([x, d]) => [x * W, y + d * H, t * long]);
  });
  return loft(rings);
}

// The inner serration and outer cutting blade belong to one editable solid.
export function mandibleCage(side, length, width, height, gape) {
  const rows = [
    [-0.1, 0, 0.66],
    [0.04, 0.14, 1],
    [0.25, 0.4, 0.9],
    [0.43, 0.55, 0.66],
    [0.55, 0.57, 0.76],
    [0.64, 0.54, 0.47],
    [0.76, 0.39, 0.57],
    [0.86, 0.25, 0.31],
    [0.96, -0.04, 0.16],
    [1, -0.17, 0.025],
  ];
  return loft(
    rows.map(([t, arc, f], i) => {
      const span = width * f,
        z = length * t,
        offset =
          side *
          (arc * width * 3.1 -
            width * 1.05 * Math.max(0, t) ** 3 +
            gape * Math.max(0, t) * length * 0.42);
      const inside = i === 4 || i === 6 ? 2.0 : 0.76,
        y =
          height * (-0.45 * Math.sin(Math.PI * t) + 1.38 * Math.max(0, t) ** 3);
      return [
        [0, 1],
        [0.81, 0.76],
        [1, -0.03],
        [0.65, -0.78],
        [-0.12, -0.8],
        [-inside, -0.06],
        [-0.61, 0.61],
      ].map(([x, h]) => [offset + side * x * span, y + h * height * f, z]);
    }),
  );
}

// A shared septum divides two recessed nasal passages. The rear of the
// piece overlaps the trunk; the front lip projects past its rounded cap.
export function trunkTipCage(across, axis) {
  const vertical = new Vector3().crossVectors(axis, across).normalize();
  const vertices = [],
    faces = [],
    ids = new Map();
  const point = (x, y, z) => {
    const key = [x, y, z].map((v) => v.toFixed(6)).join(",");
    if (!ids.has(key))
      ids.set(
        key,
        vertices.push(
          across
            .clone()
            .multiplyScalar(x)
            .addScaledVector(vertical, y)
            .addScaledVector(axis, z)
            .toArray(),
        ) - 1,
      );
    return ids.get(key);
  };
  const boundary = [
    [0, 1],
    [0.63, 0.94],
    [1, 0.51],
    [1.08, -0.03],
    [0.92, -0.58],
    [0.5, -0.83],
    [0, -0.76],
  ];
  for (const side of [1, -1]) {
    const outer = boundary.map(([x, y]) => point(x * side, y, 1.05));
    const rear = boundary.map(([x, y]) =>
      point(x * 0.9 * side, y * 0.92, -0.55),
    );
    const inner = boundary.map(([x, y]) =>
      point(side * (0.49 + (x - 0.49) * 0.62), 0.07 + (y - 0.07) * 0.65, 1.26),
    );
    const cavity = boundary.map(([x, y]) =>
      point(side * (0.49 + (x - 0.49) * 0.4), 0.07 + (y - 0.07) * 0.44, 0.43),
    );
    const polygons = [];
    for (let i = 0; i < outer.length; i++) {
      const j = (i + 1) % outer.length;
      if (j !== 0) polygons.push([rear[i], rear[j], outer[j], outer[i]]);
      polygons.push(
        [outer[i], outer[j], inner[j], inner[i]],
        [inner[i], inner[j], cavity[j], cavity[i]],
      );
    }
    polygons.push(cavity, [...rear].reverse());
    for (const polygon of polygons)
      faces.push(side === 1 ? polygon : [...polygon].reverse());
  }
  return finish(vertices, faces);
}

// Each ray and the scalloped membrane between it and the next ray share
// vertices. The outer web therefore moves with the same tarsal joint.
function webbedFoot(digits, ankle) {
  const n = Math.max(2, Math.min(digits || 2, 6)),
    columns = 2 * n - 1;
  const vertices = [],
    faces = [],
    rows = [];
  for (const [z, w, high, notch] of [
    [-1.38, 0.42, 0.72, 0],
    [-0.64, 0.88, ankle * 1.3 + 1.55, 0],
    [0.48, 1.42, 1.03, 0.04],
    [2.23, 2.31, 0.69, 0.16],
    [3.64, 2.91, 0.48, 0.53],
    [5.65, 3.42, 0.31, 1.41],
  ]) {
    const top = [],
      bottom = [];
    for (let j = 0; j < columns; j++) {
      const u = (2 * j) / (columns - 1) - 1,
        between = j % 2 === 1;
      const reach = z - Math.max(0, z) * 0.17 * u * u - (between ? notch : 0);
      const y = 0.045 + 0.04 * u * u;
      bottom.push(vertices.push([u * w, y - ankle, reach]) - 1);
      top.push(
        vertices.push([
          u * w,
          high * (1 - 0.22 * u * u) * (between && notch > 0.1 ? 0.61 : 1) -
            ankle,
          reach,
        ]) - 1,
      );
    }
    rows.push({ top, bottom });
  }
  for (let i = 0; i < rows.length - 1; i++) {
    const a = rows[i],
      b = rows[i + 1],
      last = columns - 1;
    for (let j = 0; j < last; j++)
      faces.push(
        [a.top[j], b.top[j], b.top[j + 1], a.top[j + 1]],
        [a.bottom[j], a.bottom[j + 1], b.bottom[j + 1], b.bottom[j]],
      );
    faces.push(
      [a.bottom[0], b.bottom[0], b.top[0], a.top[0]],
      [a.bottom[last], a.top[last], b.top[last], b.bottom[last]],
    );
  }
  for (let j = 0; j < columns - 1; j++) {
    const a = rows[0],
      b = rows.at(-1);
    faces.push(
      [a.bottom[j], a.top[j], a.top[j + 1], a.bottom[j + 1]],
      [b.bottom[j], b.bottom[j + 1], b.top[j + 1], b.top[j]],
    );
  }
  return finish(vertices, faces);
}

const footProfiles = {
  hoof: { width: 1.62, length: 2.85, spread: 0.45 },
  talons: { width: 1.43, length: 5.7, spread: 3.15 },
  point: { width: 0.81, length: 3.06, spread: 0.85 },
  tarsus: { width: 0.81, length: 4.15, spread: 0.85 },
  pad: { width: 1.83, length: 2.65, spread: 0.5 },
  paw: { width: 1.73, length: 3.96, spread: 1.05 },
};

function toeRay(profile, count, digit) {
  const side = (2 * digit + 1) / count - 1;
  return {
    centre: side * profile.width,
    shift: side * profile.spread,
    reach:
      profile.length *
      (1 - (profile === footProfiles.hoof ? 0.03 : 0.18) * Math.abs(side)),
  };
}

export function nailKnots(end, count, digit) {
  const ray = toeRay(footProfiles[end], count, digit);
  return [
    [0.7, 0.53],
    [0.83, 0.54],
    [0.97, 0.28],
    [1.08, 0.08],
  ].map(([t, h]) => [ray.centre + t * ray.shift, h, lerp(1.12, ray.reach, t)]);
}

// A single watertight foot has a sloping heel, metatarsal pad, and toes
// extruded from shared metatarsal edges. It keeps the leg's animation joint.
export function footCage(end, style, digits, ankleRatio) {
  if (end === "paddle") return webbedFoot(digits, ankleRatio);
  if (!digits && (end === "paw" || end === "talons")) end = "pad";
  const hoof = end === "hoof",
    claw = end === "talons",
    point = end === "point";
  const n = hoof
    ? 2
    : point
      ? style === "insect"
        ? 2
        : 1
      : Math.max(1, Math.min(6, digits || 1));
  const profile = footProfiles[point && style === "insect" ? "tarsus" : end],
    soleWidth = profile.width;
  const vertices = [],
    faces = [];
  const index = (x, y, z) => vertices.push([x, y - ankleRatio, z]) - 1;
  const body = [];
  const heelBack = claw ? -2.75 : point ? -1.13 : hoof ? -1.46 : -1.55;
  for (const [z, half, high, bottom] of [
    [heelBack, 0.48, claw ? 0.32 : 0.72, 0.14],
    [-0.73, 0.82, ankleRatio * 1.3 + 1.55, 0.023],
    [0.4, soleWidth, Math.max(1.12, ankleRatio * 0.65), 0.018],
    [1.12, soleWidth, hoof ? 1.33 : 1.03, 0.037],
  ]) {
    const low = [],
      up = [];
    for (let j = 0; j <= n; j++) {
      const u = (2 * j) / n - 1;
      low.push(index(u * half, bottom + 0.065 * u * u, z));
      up.push(index(u * half, high * (1 - 0.29 * u * u), z));
    }
    body.push({ low, up });
  }
  for (let i = 0; i < body.length - 1; i++) {
    const a = body[i],
      b = body[i + 1];
    for (let j = 0; j < n; j++)
      faces.push(
        [a.low[j], a.low[j + 1], b.low[j + 1], b.low[j]],
        [a.up[j], b.up[j], b.up[j + 1], a.up[j + 1]],
      );
    faces.push(
      [a.low[0], b.low[0], b.up[0], a.up[0]],
      [a.low[n], a.up[n], b.up[n], b.low[n]],
    );
  }
  const heel = body[0],
    front = body.at(-1);
  for (let j = 0; j < n; j++) {
    faces.push([heel.low[j], heel.up[j], heel.up[j + 1], heel.low[j + 1]]);
    const ray = toeRay(profile, n, j);
    let ring = [front.low[j], front.low[j + 1], front.up[j + 1], front.up[j]];
    const half = soleWidth / n;
    const samples = hoof
      ? [
          [0.13, 1.02, 0.03, 1.48],
          [0.72, 0.97, 0.025, 0.97],
          [1, 0.71, 0.033, 0.49],
        ]
      : claw || point
        ? [
            [0.22, 0.78, 0.09, 0.8],
            [0.49, 0.62, 0.055, 0.63],
            [0.74, 0.49, 0.27, 0.75],
            [0.91, 0.31, 0.19, 0.47],
            [1, 0.075, 0.035, 0.16],
          ]
        : [
            [0.21, 0.93, 0.03, 0.96],
            [0.62, 0.91, 0.025, 1.0],
            [0.87, 0.81, 0.08, 0.8],
            [1, 0.48, 0.17, 0.52],
          ];
    for (const [t, width, low, hi] of samples) {
      const x = ray.centre + ray.shift * t,
        z = lerp(1.12, ray.reach, t),
        h = half * width;
      const next = [
        index(x - h, low, z),
        index(x + h, low, z),
        index(x + h, hi, z),
        index(x - h, hi, z),
      ];
      for (let k = 0; k < 4; k++) {
        let m = (k + 1) % 4;
        faces.push([ring[k], ring[m], next[m], next[k]]);
      }
      ring = next;
    }
    faces.push(ring);
  }
  return finish(vertices, faces);
}
