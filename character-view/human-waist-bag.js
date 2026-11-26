import { analyse, Piece, raycaster } from "./human-style-kit.js";

export const waistBagStyles = ["None", "Dispatch folio", "Running belt"];

export function fittedWaistBag(surface, style, clothing, material, plain) {
  if (!waistBagStyles.slice(1).includes(style.waistBag)) return [];
  const folio = style.waistBag === "Dispatch folio";
  const body = analyse(surface), scale = body.scale;
  const [cx, waist, cz] = body.joint("spine_01");
  const angle = folio ? .47 : -.30;
  const height = waist + (folio ? .015 : .035) * scale;
  const casts = [raycaster(body.P, body.tri)];
  for (const mesh of clothing) {
    const g = mesh.geometry, p = g?.getAttribute("position");
    if (!p || mesh.userData.styleRegion === "head") continue;
    g.computeBoundingBox();
    const box = g.boundingBox;
    if (box.min.y > height + .05*scale || box.max.y < height - .10*scale ||
        box.min.x > cx || box.max.x < cx) continue;
    casts.push(raycaster(p.array, g.index?.array ?? Array.from({length:p.count}, (_, i)=>i)));
  }
  function radius(a, y) {
    const dir = [Math.sin(a), 0, Math.cos(a)];
    let r = 0;
    for (const cast of casts) {
      const hit = cast([cx,y,cz], dir);
      if (Number.isFinite(hit)) r = Math.max(r,hit);
    }
    return r + .0055*scale;
  }
  function around(a, y, r) {
    return [cx+Math.sin(a)*r, y, cz+Math.cos(a)*r];
  }
  const leather = new Piece(), bag = new Piece(), lid = new Piece(), metal = new Piece();
  const band = folio ? .016 : .018;
  const rings = [[-band,-.002],[-band,.001],[band,.001],[band,-.002]].map(([dy, dr]) =>
    Array.from({length:48}, (_,j) => {
      const a = 2*Math.PI*j/48, y = height + scale*(dy - .016*Math.cos(a-angle));
      return around(a,y,radius(a,y)+dr*scale);
    }));
  leather.loft([...rings,rings[0]], p => body.trunkAt(p), {flip:true});

  const y0 = height - (folio ? .056 : .024)*scale;
  const r0 = radius(angle,y0);
  const skin = body.trunkAt(around(angle,height,r0));
  function panel(piece, x, y, width, tall, depth, base, power, pointed = 0) {
    const profile = [[.91,0],[1,.15],[1,.72],[.94,1]];
    const outline = Array.from({length:24}, (_,j) => {
      const a = 2*Math.PI*j/24, c = Math.cos(a), s = Math.sin(a);
      return [Math.sign(c)*Math.abs(c)**power, Math.sign(s)*Math.abs(s)**power];
    });
    const rows = profile.map(([factor, thick])=>outline.map(([u,v])=>{
      const a = angle + (x+u*width*factor)*scale/r0;
      const h = y0 + (y+v*tall*factor - pointed*Math.max(0,-v)*(1-u*u))*scale;
      return around(a,h,radius(a,h)+(base+depth*thick)*scale);
    }));
    piece.loft(rows, skin, {capStart:true,capEnd:true,flip:true});
  }
  if (folio) {
    panel(bag,0,0,.103,.078,.035,-.004,.24);
    panel(lid,0,.038,.107,.047,.012,.031,.26,.019);
    panel(leather,0,.012,.011,.040,.006,.043,.26);
    panel(metal,0,.002,.008,.008,.004,.049,.55);
    for (const x of [-.082,.082]) panel(metal,x,.061,.004,.004,.004,.043,1);
  } else {
    panel(bag,0,0,.126,.050,.042,-.004,.65);
    panel(lid,0,.009,.103,.007,.005,.036,.42);
    panel(metal,.066,-.0005,.005,.013,.004,.043,.5);
  }
  const selections = [
    [leather,"strap",folio ? "#463629" : "#333537","leather"],
    [bag,"pocket",folio ? style.leatherColor || "#775138" : style.accentColor || "#b25735",folio ? "leather" : "canvas"],
    [lid,folio ? "envelope flap" : "zip",folio ? "#8a6647" : "#3a3634",folio ? "leather" : "canvas"],
    [metal,folio ? "brass fasteners" : "zip pull",folio ? "#b29859" : "#91959b","metal"],
  ];
  return selections.map(([piece, part, colour, surfaceName])=>{
    const m = material(colour,surfaceName).clone();
    if (!plain) { m.metalness = surfaceName === "metal" ? .67 : 0; m.roughness = surfaceName === "canvas" ? .87 : .55; }
    return piece.mesh(m,"pelvis",style.waistBag+" "+part);
  });
}
