import { Vector3 } from "three";
import { analyse, Piece, raycaster } from "./human-style-kit.js";

export const necklaceStyles = ["None", "Teardrop pendant", "Pearl strand", "Fan collar"];
const tau = 2 * Math.PI;

function bead(piece, at, rx, ry, rz, skin, facets = 10) {
  const rings = [-1.42, -.88, 0, .88, 1.42].map(lat =>
    Array.from({length:facets}, (_, j) => {
      const lon = tau*j/facets;
      return [at.x + rx*Math.cos(lat)*Math.cos(lon), at.y + ry*Math.sin(lat),
        at.z + rz*Math.cos(lat)*Math.sin(lon)];
    }));
  piece.loft(rings, skin, {capStart:true, capEnd:true});
}

// A convex shell with ribs radiating from the hinge. The edge turns at each scallop.
function fan(piece, at, k, skin) {
  const shell = outset => Array.from({length:5}, (_, i) => Array.from({length:27}, (_, j) => {
    const a = (j/26-.5)*2.38, r = (.004 + .038*i/4)*k;
    const flute = .5 + .5*Math.cos(j*Math.PI);
    const reach = r*(1+.07*(i/4)**2*flute);
    return [at.x + Math.sin(a)*reach, at.y - .038*k + Math.cos(a)*reach,
      at.z + k*(.0024*flute*(i/4) + .006*Math.sin(Math.PI*i/6) + outset)];
  }));
  piece.slab(shell(.003),shell(0),skin);
}

/** A necklace rests on the fitted surface of the clothes and the skin beneath.
 * Its back crosses the nape, the sides ride the collarbones and the front hangs lower. */
export function fittedNecklace(surface, style, clothes, material, plain = false) {
  const cut = style.necklace;
  if (!cut || cut === "None" || !necklaceStyles.includes(cut)) return [];
  const body = analyse(surface), k = body.scale;
  const [cx,cy,cz] = body.joint("neck_01");
  const casts = [raycaster(body.P, body.tri)];
  for (const mesh of clothes) {
    if (mesh.userData.styleRegion === "head") continue;
    const g = mesh.geometry, p = g?.getAttribute("position");
    if (!p) continue;
    g.computeBoundingBox();
    if (g.boundingBox.max.y < cy-.18*k || g.boundingBox.min.y > cy+.08*k) continue;
    casts.push(raycaster(p.array, g.index?.array ?? Array.from({length:p.count}, (_, i)=>i)));
  }
  const ornate = cut === "Fan collar", pearls = cut === "Pearl strand";
  const count = 64;
  const chain = new Piece(), stones = new Piece();
  function pointAt(a, frontDrop) {
    const dx = Math.sin(a), dz = Math.cos(a);
    const y = cy + k*(.018 - .018*Math.max(0,-dz) - frontDrop*Math.max(0,dz)**1.35);
    // A slight downward slope brings the chain over the shoulders at the sides.
    const outer = .29*k, rise = (.22+.49*dx*dx)*outer;
    const from = [cx+dx*outer, y+rise, cz+dz*outer];
    const dir = new Vector3(-dx, -rise/outer, -dz).normalize();
    let distance = Math.min(...casts.map(cast => cast(from,dir.toArray())));
    if (!Number.isFinite(distance)) distance = outer*.70;
    return new Vector3(...from).addScaledVector(dir,distance-.0035*k);
  }
  const path = Array.from({length:count}, (_, i)=>pointAt(tau*i/count, ornate ? .142 : pearls ? .110 : .157));
  const skins = path.map(p=>body.skinAt(p.toArray()));
  const rings = path.map((p,i) => {
    const tangent = path[(i+1)%count].clone().sub(path[(i+count-1)%count]).normalize();
    const outward = new Vector3(Math.sin(tau*i/count),.2,Math.cos(tau*i/count));
    const side = new Vector3().crossVectors(tangent,outward).normalize();
    outward.crossVectors(side,tangent).normalize();
    const width = (ornate ? .0024 : .0015)*k;
    return Array.from({length:6}, (_, j)=>p.clone().addScaledVector(outward,width*Math.cos(tau*j/6))
      .addScaledVector(side,width*Math.sin(tau*j/6)).toArray());
  });
  chain.loft([...rings,rings[0]], (_p,i)=>skins[i%count], {flip:true});
  if (pearls || ornate) {
    for (let i=0; i<count; i+=2) {
      const p=path[i], face = Math.max(0,Math.cos(tau*i/count));
      const r=(pearls ? .0038+.0025*face : .0027+.0018*face)*k;
      bead(stones, p,r,r*1.04,r,skins[i],8);
    }
  }
  if (!pearls) {
    const at = path[0].clone(), skin = skins[0];
    if (ornate) {
      // A fluted scallop setting and a pearl at the hinge.
      fan(chain,at,k,skin);
      bead(stones,at.clone().add(new Vector3(0,-.032*k,.006*k)),.006*k,.007*k,.005*k,skin);
    } else {
      bead(chain,at,.004*k,.005*k,.003*k,skin);
      const centre = at.clone().add(new Vector3(0,-.016*k,.002*k));
      bead(chain,centre,.0105*k,.014*k,.004*k,skin);
      bead(stones,centre.clone().add(new Vector3(0,0,.0035*k)),.0088*k,.0117*k,.0038*k,skin,8);
    }
  }
  function mesh(piece, colour, metal, name) {
    const m = material(colour, metal ? "metal" : "cloth").clone();
    if (!plain) { m.metalness = metal ? .72 : .11; m.roughness = metal ? .31 : .24; }
    (m.userData ??= {}).fibreLOD = true;
    return piece.mesh(m, "spine_03", name);
  }
  const enamel = style.clothAccent || "#26766f";
  return [mesh(chain, style.metalColor || "#b1935e", true, cut+" setting"),
    mesh(stones, pearls || ornate ? "#ecdec8" : enamel, false,cut+" beads")];
}
