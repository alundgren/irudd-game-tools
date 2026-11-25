import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { earSources } from "./human-groom.js";

export const earringStyles = ["None", "Pearl studs", "Hammered hoops", "Enamel drops", "Single ear pendant", "Sea fan ear cuffs"];

function lobe(surface, sign, scale) {
  const ear = earSources(), p = surface.positions;
  let low = Infinity, best = -Infinity, anchor;
  for (let i = 0; i < surface.ids.length; i++)
    if (p[3*i]*sign > 0 && ear.has(surface.ids[i])) low = Math.min(low, p[3*i+1]);
  // Pick the forward, exposed side of the lobe a few mm above its free edge.
  for (let i = 0; i < surface.ids.length; i++) {
    const x = p[3*i]*sign, y = p[3*i+1], z = p[3*i+2];
    if (x <= 0 || !ear.has(surface.ids[i]) || y > low + .012*scale) continue;
    const score = x + .35*z - .75*Math.abs(y - low - .004*scale);
    if (score > best) {
      best = score;
      anchor = new T.Vector3(x*sign, y, z);
    }
  }
  return anchor;
}

/** A chased wire comb over the outer ear, with enamel leaves and a suspended drop.
 * Points describe the right-hand pattern in metres from the piercing. Mirror it for
 * the other ear and shorten its branches, as in an asymmetric pair of stage jewels. */
function seaFan(metal, stones, anchor, sign, scale) {
  const size = scale * (sign === 1 ? 1 : .71);
  const point = (x, y, z) => new T.Vector3(anchor.x + sign*x*size, anchor.y + y*size, anchor.z + z*size);
  const rod = (points, radius) => {
    const curve = new T.CatmullRomCurve3(points);
    metal.push(new T.TubeGeometry(curve, 10, radius * size, 5, false));
  };
  // The sprung spine follows the rim of the ear, turning behind the helix at the top.
  rod([point(0,0,.001), point(.007,.016,-.002), point(.009,.034,-.014),
    point(.004,.049,-.021), point(-.002,.047,-.023)], .0022);
  // Each loop has open space around its enamel inlay. Its narrow base bends back
  // toward the preceding loop so the leaves form a spray from one continuous comb.
  const blades = [[.016,.089,-.025,.012],[.036,.082,-.027,.012],[.051,.063,-.029,.013],
    [.056,.041,-.030,.012],[.050,.021,-.030,.009]];
  for (const [i,[x,y,z,width]] of blades.entries()) {
    const start = point(.005,.034-i*.005,-.013+i*.002);
    const tip = point(x,y,z);
    const across = new T.Vector3(-sign*(y-(.034-i*.005)), x-.005, 0).normalize();
    const mid = start.clone().lerp(tip,.60);
    const left = mid.clone().addScaledVector(across,width*size*.5);
    const right = mid.clone().addScaledVector(across,-width*size*.5);
    rod([start,left,tip], .00145);
    rod([start,right,tip], .00145);
    // A faceted lozenge hangs toward the tip, with the lower half of the loop pierced.
    const gem = new T.OctahedronGeometry(1);
    const axis = tip.clone().sub(start);
    const length = axis.length();
    const centre = start.clone().lerp(tip,.69);
    centre.z += .0008*size;
    gem.scale(width*.38*size,length*.245,.0029*size);
    gem.applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0,1,0), axis.normalize()));
    stones.push(gem.translate(centre.x,centre.y,centre.z));
  }
  const drop = point(.006,-.030,.001);
  rod([point(.001,0,.003),point(.008,-.009,.004),point(.005,-.021,.002)],.0012);
  stones.push(new T.SphereGeometry(1,9,6).scale(.0048*size,.0095*size,.0040*size).translate(drop.x,drop.y,drop.z));
}

/** All components hang from a piercing on the current editable ear. The
 * two materials merge into the normal game atlas with their own reflectance. */
export function fittedEarrings(surface, style, material, plain) {
  const cut = style.earrings;
  if (!cut || cut === "None" || !earringStyles.includes(cut)) return [];
  const scale = (surface.joints[surface.names.indexOf("head")*3+1] || 1.55) / 1.55;
  const metal = [], stones = [];
  for (const sign of cut === "Single ear pendant" ? [1] : [-1, 1]) {
    const anchor = lobe(surface, sign, scale);
    if (!anchor) continue;
    const rotation = sign * .66;
    const place = (g, x, y, z) => g.translate(x,y,z).rotateY(rotation).scale(scale,scale,scale)
      .translate(anchor.x,anchor.y,anchor.z);
    const bead = (parts, dx, dy, dz, rx, ry, rz, facets = 10) => {
      const g = new T.SphereGeometry(1, facets, 6).scale(rx,ry,rz);
      parts.push(place(g,dx,dy,dz));
    };
    const loop = (height, width, tube, y, tilt=0) => {
      const g = new T.TorusGeometry(1, tube/width, 6, 24);
      g.scale(width, height, width).rotateY(tilt);
      metal.push(place(g,sign*.001,y,.001));
    };
    if (cut === "Sea fan ear cuffs") {
      seaFan(metal, stones, anchor, sign, scale);
    } else if (cut === "Pearl studs") {
      bead(metal, sign*.001,0,.001,.0049,.0049,.0026);
      bead(stones, sign*.002,0,.0032,.0046,.0046,.0042);
    } else if (cut === "Hammered hoops") {
      // A vertical hoop passing through the lobe, wider on its lower arc.
      const g = new T.TorusGeometry(.014, .0015, 6, 28);
      const p = g.attributes.position;
      for (let i=0; i<p.count; i++) {
        const x=p.getX(i), y=p.getY(i), z=p.getZ(i);
        const a=Math.atan2(y,x), r=.014, thick=1.2-.62*Math.sin(a);
        p.setXYZ(i, r*Math.cos(a)+(x-r*Math.cos(a))*thick, r*Math.sin(a)+(y-r*Math.sin(a))*thick,z*thick);
      }
      g.computeVertexNormals();
      metal.push(place(g.rotateY(sign*.45),sign*.001,-.0135,.0005));
    } else {
      const long = cut === "Single ear pendant";
      bead(metal,sign*.001,0,.001,.0031,.0031,.0029);
      loop(.005,.0031,.0009,-.006,sign*.55);
      const y = long ? -.029 : -.020;
      if (long) loop(.009,.0026,.00075,-.016,sign*-.4);
      // A pierced metal rim frames a faceted enamel lozenge.
      const gem = new T.OctahedronGeometry(1).scale(.0065,.010,.0036);
      // OctahedronGeometry is unindexed. The other gem pieces are indexed.
      stones.push(place(gem,sign*.001,y,.001));
      loop(.0097,.0068,.00095,y);
      bead(metal,sign*.001,y-.010, .001,.0019,.0019,.0019);
    }
  }
  const make = (parts, colour, kind, roughness, metallic) => {
    if (!parts.length) return [];
    const buffers = parts.map(g => g.index ? g.toNonIndexed() : g);
    const geometry = mergeGeometries(buffers);
    for (const g of new Set([...buffers,...parts])) g.dispose();
    const mat = material(colour, kind).clone();
    if (!plain) {
      mat.roughness = roughness;
      mat.metalness = metallic;
    }
    (mat.userData ??= {}).fibreLOD = true;
    const mesh = new T.Mesh(geometry, mat);
    mesh.name = cut + (kind === "metal" ? " settings" : " inlay");
    mesh.userData.styleRegion = "head";
    mesh.castShadow = true;
    return [mesh];
  };
  const pearl = cut === "Pearl studs";
  return [...make(metal, style.metalColor ?? "#bf9860","metal",.29,.72),
    ...make(stones, pearl ? "#eadac1" : style.clothAccent ?? "#2d8881","cloth",pearl ? .31 : .20,.12)];
}
