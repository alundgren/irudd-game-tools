import * as T from "three";

import {surfaceMaterial} from "./materials.js";
import {sweepGeometry} from "./surface.js";
import {createFace} from "./face.js";
import { anchors } from "./recipe.js";

const palettes = {
  Tide: ["#38685f", "#e49a55", "#bcccb7"],
  Ochre: ["#bc904c", "#375951", "#e3d6b0"],
  Clay: ["#a35847", "#e1bf75", "#d6b9a3"],
  Polar: ["#93aeb4", "#e68d5a", "#d3dfdc"],
};
const waist = "#374a46",
  sole = "#273a38",
  hardware = "#85958c";
const up = new T.Vector3(0, 1, 0);

// Ring sections, in metres, describe the outer contour at each landmark.
// Each row holds height, half-width, half-depth, forward offset and lateral offset.
function shellGeometry(rows,sides) {
  const knots=rows.map(([y,w,d,z=0,x=0])=>[x,y,z,w,d]);
  return sweepGeometry(knots);
}

function baseParts(recipe, material, silhouette) {
  const groups = Object.fromEntries(Object.keys(anchors).map(key=>[key,new T.Group()]));
  let region = "torso";
  const base=palettes[recipe.palette], tones=recipe.tones??{};
  const cloth=tones.cloth??base[0], trim=tones.trim??base[1], panel=tones.panel??base[2];
  const suit = recipe.outfit === "Pressure suit",
    work = recipe.outfit === "Work clothes";
  const body = 1;
  const skin = recipe.skin,
    hair = recipe.hairColor;
  function mesh(geometry, color, x = 0, y = 0, z = 0) {
    const type=color===skin||color===hair?"plain":color===hardware?"metal":color===sole||color==="#685343"||color===tones.boots?"leather":"canvas";
    const part = new T.Mesh(geometry,material(color,type));
    part.position.set(x, y, z);
    part.castShadow = true;
    groups[region].add(part);
    return part;
  }
  function shell(rows, color, sides = 12, x = 0, z = 0) {
    return mesh(shellGeometry(rows, sides), color, x, 0, z);
  }
  function oval(x, y, z, width, height, depth, color, detail = 1) {
    const part = mesh(new T.SphereGeometry(1,20+4*detail,14), color, x, y, z);
    part.scale.set(width, height, depth);
    return part;
  }
  function box(x, y, z, width, height, depth, color) {
    return mesh(new T.BoxGeometry(width, height, depth), color, x, y, z);
  }
  function segment(a, b, radiusA, radiusB, color, depth = 1) {
    const start = new T.Vector3(...a),
      end = new T.Vector3(...b);
    const delta = end.clone().sub(start);
    const geo = new T.CylinderGeometry(radiusB, radiusA, delta.length(), 10);
    geo.scale(1, 1, depth);
    const part = mesh(geo, color);
    part.position.copy(start).lerp(end, 0.5);
    part.quaternion.setFromUnitVectors(up, delta.normalize());
    return part;
  }

  const hip = 0.104 * body,
    shoulder = 0.198 * body;
  const torso = (rows, color) =>
    shell(
      rows.map(([y, x, z, dz]) => [y, x * body, z, dz]),
      color,
    );
  const pack = suit ? 0.024 : 0;
  for (const side of [-1, 1]) {
    region = side > 0 ? "left leg" : "right leg";
    const x = hip * side,
      foot = x + 0.036 * side;
    const leg = suit ? cloth : work ? (tones.pants??waist) : skin;
    shell(
      [
        [0.075, 0.045 + pack, 0.048 + pack, 0, 0.036 * side],
        [0.17, 0.043 + pack, 0.048 + pack, 0, 0.03 * side],
        [0.33, 0.064 + pack, 0.073 + pack, -0.013, 0.014 * side],
        [0.47, 0.06 + pack, 0.063 + pack, 0.008],
        [0.55, 0.074 + pack, 0.081 + pack],
        [0.73, 0.089 + pack, 0.096 + pack],
        [0.87, 0.098 + pack, 0.105 + pack],
      ],
      leg,
      10,
      x,
    );
    if (!work && !suit)
      shell(
        [
          [0.61, 0.089, 0.099],
          [0.7, 0.1, 0.105],
          [0.87, 0.101, 0.113],
        ],
        waist,
        10,
        x,
      );
    if (suit) {
      oval(x, 0.495, 0.09, 0.07, 0.074, 0.034, panel);
      box(x, 0.494, 0.119, 0.076, 0.012, 0.009, hardware);
      shell(
        [
          [0.205, 0.073, 0.079],
          [0.226, 0.075, 0.08],
        ],
        trim,
        10,
        x,
      );
      box(x + side * 0.091, 0.72, 0.01, 0.027, 0.137, 0.103, waist);
    } else if (work && recipe.pockets!==false) {
      box(x + side * 0.082, 0.69, 0.018, 0.025, 0.114, 0.085, cloth);
      box(x + side * 0.09, 0.735, 0.018, 0.024, 0.026, 0.098, panel);
    }
    const boot = suit ? 0.211 : work ? 0.155 : 0.086;
    shell(
      [
        [0.013, 0.064 + pack, 0.12 + pack, 0.046],
        [0.045, 0.067 + pack, 0.126 + pack, 0.044],
        [0.081, 0.061 + pack, 0.091 + pack, 0.031],
        [boot, 0.053 + pack, 0.06 + pack, -0.003],
      ],
      suit ? waist : work ? (tones.boots??"#685343") : sole,
      10,
      foot,
    );
    shell(
      [
        [0, 0.066 + pack, 0.127 + pack, 0.045],
        [0.021, 0.067 + pack, 0.129 + pack, 0.045],
      ],
      sole,
      10,
      foot,
    );
    for(let lace=0;lace<3;lace++) {
      const z=.087-lace*.019;
      const y=.076+lace*.012;
      segment([foot-.032,y,z],[foot+.032,y+.008,z+.006],.0026,.0026,suit?trim:sole);
    }
  }
  region = "torso";
  const belly=recipe.belly??1;
  const jacket=torso(
    [
      [0.815, 0.176, 0.11],
      [0.88, 0.181, 0.116],
      [0.99, 0.156*belly, 0.113*belly, (belly-1)*.052],
      [1.12, 0.164*belly, 0.122*belly, (belly-1)*.045],
      [1.21, 0.185, 0.132],
      [1.31, 0.202, 0.134],
      [1.39, 0.176, 0.099],
      [1.43, 0.074, 0.078],
    ],
    suit || work ? cloth : (tones.cloth??"#435e58"),
  );
  if(work&&recipe.collar!==false)jacket.material=material(cloth,"jacket");
  torso(
    [
      [0.763, 0.105, 0.078,-.019],
      [0.795, 0.164, 0.114],
      [0.87, 0.186, 0.119],
      [0.91, 0.163, 0.114],
    ],
    work?(tones.pants??waist):waist,
  );
  torso(
    [
      [0.905, 0.184, 0.127],
      [0.942, 0.179, 0.129],
    ],
    suit ? waist : (tones.boots??"#554738"),
  );
  box(0, 0.925, 0.13, 0.059, 0.036, 0.018, hardware);

  for (const side of [-1, 1]) {
    region = side > 0 ? "left arm" : "right arm";
    const outer = shoulder + (suit ? 0.026 : 0);
    const elbow = outer + 0.073,
      wrist = outer + 0.099;
    const armColor = suit || work ? cloth : skin;
    const shortSleeve=work&&recipe.sleeves==="short", bare=work&&recipe.sleeves==="none";
    const armSurface=bare?skin:armColor;
    const outline=[
      [side*(outer-.041),1.368,-.012,.041+pack,.050+pack],
      [side*(outer-.006),1.336,-.004,.075+pack,.081+pack],
      [side*(outer+.019),1.28,-.005,.076+pack,.079+pack],
      [side*(outer+.044),1.208,-.004,.058+pack,.067+pack],
      [side*(elbow-.007),1.137,0,.052+pack,.058+pack],
      [side*elbow,1.087,.009,.048+pack,.05+pack],
      [side*(elbow+.010),1.032,.021,.053+pack,.053+pack],
      [side*(wrist-.004),.946,.040,.040+pack,.042+pack],
      [side*wrist,.88,.05,.032+pack,.033+pack]];
    mesh(sweepGeometry(outline),shortSleeve?skin:armSurface);
    if(shortSleeve)mesh(sweepGeometry(outline.slice(0,4).map(([x,y,z,w,d])=>[x,y,z,w+.003,d+.003])),armColor);
    if (suit || (work&&!bare&&!shortSleeve)) {
      if(suit) oval(side*outer,1.351,0,.11+pack,.063+pack,.09+pack,panel);
      segment(
        [side * (wrist - 0.003), 0.91, 0.043],
        [side * wrist, 0.883, 0.048],
        0.045 + pack,
        0.042 + pack,
        suit ? trim : panel,
      );
    }
    const hand=suit?sole:skin;
    const handX=side*wrist;
    oval(handX,.843,.056,.031+pack*.35,.049,.040+pack*.4,hand);
    for(let i=0;i<4;i++){
      const z=.026+i*.018;
      const length=[.045,.058,.063,.057][i];
      mesh(sweepGeometry([[handX,.821,z,.009+pack*.12,.011+pack*.12],
        [handX+side*.004,.802,z+.005,.009+pack*.12,.010+pack*.12],
        [handX-side*.002,.82-length,z+.011,.006+pack*.1,.007+pack*.1]]),hand);
    }
    mesh(sweepGeometry([[handX-side*.014,.855,.084,.015,.015],
      [handX-side*.024,.826,.104,.012,.012],[handX-side*.023,.804,.105,.008,.008]]),hand);
  }
  region = "head";
  shell(
    [
      [1.37, 0.063, 0.062],
      [1.49, 0.056, 0.06],
    ],
    skin,
  );
  for (const side of [-1, 1])
    oval(side * 0.088, 1.606, 0.002, 0.021, 0.039, 0.019, skin);
  groups.head.add(createFace(recipe,silhouette,material));
  if(recipe.hair!=="Bald") shell(
    [
      [1.655, 0.095, 0.101, -0.008],
      [1.7, 0.101, 0.105, -0.006],
      [1.75, 0.084, 0.089, -0.008],
      [1.771, 0.041, 0.043, -0.008],
    ],
    hair,
  );
  if (recipe.hair === "Sweep") {
    const fringe = oval(-0.021, 1.714, 0.063, 0.083, 0.039, 0.067, hair);
    fringe.rotation.z = 0.3;
    oval(0.012, 1.663, -0.089, 0.075, 0.085, 0.05, hair);
  } else if (recipe.hair === "Coils") {
    for (let i = 0; i < 10; i++) {
      const angle = (i * Math.PI) / 5;
      oval(
        0.069 * Math.sin(angle),
        1.72 + 0.009 * Math.cos(3 * angle),
        0.073 * Math.cos(angle),
        0.046,
        0.053,
        0.048,
        hair,
      );
    }
    oval(0, 1.755, 0, 0.076, 0.045, 0.077, hair);
  }
  region = "torso";
  if (work && recipe.collar!==false) {
    for (const side of [-1, 1]) {
      const collar = box(
        side * 0.055,
        1.381,
        0.077,
        0.082,
        0.049,
        0.024,
        panel,
      );
      collar.rotation.z = side * 0.44;

    }
  }
  if (suit) {
    torso(
      [
        [0.995, 0.157, 0.122],
        [1.1, 0.184, 0.148],
        [1.29, 0.211, 0.155],
        [1.36, 0.192, 0.136],
      ],
      cloth,
    );
    shell(
      [
        [1.38, 0.114, 0.108],
        [1.408, 0.14, 0.128],
        [1.444, 0.14, 0.128],
        [1.451, 0.115, 0.109],
      ],
      trim,
      16,
    );
    shell(
      [
        [1.443, 0.134, 0.123],
        [1.463, 0.125, 0.116],
      ],
      waist,
      16,
    );
    region = "head";
    // An open-face helmet leaves the face visible and gives the suit a
    // distinct outline in profile. The cheek guards join the neck seal.
    shell(
      [
        [1.55, 0.115, 0.059, -0.069],
        [1.68, 0.123, 0.081, -0.042],
        [1.754, 0.113, 0.103, -0.014],
        [1.79, 0.086, 0.084, -0.012],
        [1.805, 0.048, 0.05, -0.013],
      ],
      panel,
      16,
    );
    for (const side of [-1, 1]) {
      oval(side * 0.11, 1.625, -0.025, 0.032, 0.06, 0.058, waist);
      oval(side * 0.128, 1.627, -0.025, 0.02, 0.041, 0.044, trim);
      segment(
        [side * 0.118, 1.62, -0.042],
        [side * 0.103, 1.47, 0.012],
        0.024,
        0.02,
        panel,
      );
    }
    box(0, 1.764, 0.081, 0.123, 0.019, 0.039, waist);
    region = "torso";
    box(0, 1.227, 0.151, 0.194, 0.122, 0.04, panel);
    box(-0.026, 1.24, 0.174, 0.101, 0.039, 0.008, sole);
    box(-0.023, 1.245, 0.18, 0.071, 0.009, 0.005, "#94cebd");
    for (let i = 0; i < 3; i++)
      box(0.041 + i * 0.017, 1.201, 0.176, 0.01, 0.013, 0.009, trim);
    box(0, 1.19, -0.164, 0.283, 0.33, 0.132, waist);
    for (const side of [-1, 1]) {
      segment(
        [side * 0.129 * body, 1.344, 0.103],
        [side * 0.121 * body, 1.103, 0.142],
        0.018,
        0.017,
        waist,
      );
      shell(
        [
          [0.988, 0.043, 0.045],
          [1.022, 0.064, 0.066],
          [1.3, 0.065, 0.066],
          [1.337, 0.045, 0.046],
        ],
        panel,
        10,
        side * 0.128,
        -0.181,
      );
      box(side * 0.126, 1.143, -0.24, 0.097, 0.031, 0.021, trim);
    }
  }
  for(const [key,group] of Object.entries(groups)) {
    const pivot=new T.Vector3(...anchors[key]);
    for(const child of group.children) child.position.sub(pivot);
  }
  return groups;
}

export function createCharacter(form,silhouette) {
  const group = new T.Group(), materials=new Map();
  function material(color,type="plain") {
    const key=silhouette?"ink":color+type;
    if(!materials.has(key)) materials.set(key,silhouette
      ? new T.MeshBasicMaterial({color:"#203733"})
      : surfaceMaterial(color,type));
    return materials.get(key);
  }
  const library=form.parts.some(p=>Object.hasOwn(anchors,p.shape))
    ? baseParts({...form.appearance,outfit:form.outfit},material,silhouette) : {};
  const objects=new Map();
  for(const part of form.parts) {
    let object;
    if(Object.hasOwn(library,part.shape)) object=library[part.shape].clone();
    else {
      let geometry;
      switch(part.shape) {
        case "box": geometry=new T.BoxGeometry(1,1,1); break;
        case "ellipsoid": geometry=new T.SphereGeometry(.5,16,12); break;
        case "sweep": geometry=sweepGeometry(part.knots);break;
        case "cone": geometry=new T.ConeGeometry(.5,1,12); break;
        case "cylinder": geometry=new T.CylinderGeometry(.5,.5,1,12); break;
      }
      object=new T.Mesh(geometry,material(part.color,part.surface));
      object.castShadow=true;
    }
    object.name=part.id;
    object.position.fromArray(part.position);
    object.scale.fromArray(part.size);
    object.rotation.set(...part.rotation.map(T.MathUtils.degToRad));
    object.visible=!part.visibleIn||part.visibleIn.includes(form.outfit);
    objects.set(part.id,object);object.userData.partId=part.id;
  }
  for(const part of form.parts)(objects.get(part.parent)??group).add(objects.get(part.id));
  return group;
}

export function disposeCharacter(group) {
  const materials = new Set();
  group.traverse((part) => {
    if (part.isMesh) {
      part.geometry.dispose();
      materials.add(part.material);
    }
  });
  for (const material of materials) material.dispose();
}
