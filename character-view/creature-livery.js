import { CanvasTexture, Color, SRGBColorSpace } from "three";

// The cloth is cut along these rows before smoothing. The painting follows
// the same control points through the subdivision and through hand sculpting.
const skirtRows = [0,.15,.36,.58,.79,.94,1,1,.78,.52,.24,0];
const tunics = new Set(["robe","capelet","surcoat","poncho","tassets","kilt"]);

export function liveryChart(part, dress) {
  if (!dress?.device || part.shape !== "cage" || !part.id.startsWith("dress ")) return null;
  const name = part.id.slice(6), total = part.cage.vertices.length;
  if (name === "mantle" && total === 126) {
    return { band: false, uv: Array.from({length:total}, (_,i) =>
      [(i%9)/8,1-Math.floor((i%63)/9)/6]) };
  }
  let rows, sides, band;
  if (tunics.has(name)) {
    rows = skirtRows; sides = 16; band = false;
  } else if (["collar","sash","cinch","stole"].includes(name) && total%4 === 0) {
    rows = [0,0,1,1]; sides = total/4; band = true;
  } else return null;
  if (total !== rows.length*sides) return null;
  return { band, uv: Array.from({length:total}, (_,i) => {
    const angle = 2*Math.PI*(i%sides)/sides;
    return [.5+Math.asin(Math.sin(angle))/Math.PI,1-rows[Math.floor(i/sides)]];
  }) };
}

// Coordinates follow each sprung or hammered plate through subdivision. The
// two sides of the sheet meet at the rolled edge. Hinged lames occupy the
// narrow strip in the same metalworking texture that is used for adult armour.
export function creaturePlateChart(part) {
  if (part.shape !== "cage" || part.surface !== "metal" || !part.id.startsWith("dress ")) return null;
  const count = part.cage.vertices.length;
  let rows, cols, tiers;
  if (/ (pauldron|guard)$/.test(part.id)) {
    rows = 4; cols = 7; tiers = count / (2 * rows * cols);
    if (tiers !== 1 && tiers !== 2) return null;
  } else if (part.id.endsWith(" greave") && count === 70) {
    rows = 5; cols = 7; tiers = 1;
  } else if (part.id === "dress lamellar barding" && count === 180) {
    rows = 3; cols = 5; tiers = 6;
  } else if (part.id === "dress cuirass" && count === 96) {
    // Mirrored side panels keep the engraved fan centred over the breastbone.
    const levels = [1, 1, .7, .3, 0, 0];
    return Array.from({length:count}, (_,i) => {
      const angle = 2 * Math.PI * (i % 16) / 16;
      return [.5 + .488 * Math.sin(angle), 1 - (.02 + .64 * levels[Math.floor(i / 16)])];
    });
  } else return null;
  return Array.from({length:count}, (_,i) => {
    const tier = Math.floor(i / (2 * rows * cols));
    const plate = i % (rows * cols);
    const v = Math.floor(plate / cols) / (rows - 1);
    const u = (plate % cols) / (cols - 1);
    const lame = tiers === 6 || tier > 0;
    return [.012 + .976 * u, 1 - (lame ? .69 + .29 * v : .02 + .64 * v)];
  });
}

function insignia(ctx, design, gold, light, shadow) {
  const fill = (paint, draw) => {
    ctx.fillStyle = paint; ctx.beginPath(); draw(); ctx.closePath(); ctx.fill();
  };
  const poly = (paint, points) => fill(paint, () => {
    ctx.moveTo(...points[0]); for (const p of points.slice(1)) ctx.lineTo(...p);
  });
  const disc = (paint,x,y,r) => fill(paint, () => ctx.arc(x,y,r,0,2*Math.PI));
  ctx.lineJoin = "round";
  if (design === "swallow") {
    // Primaries separate at the tip; the lower feathers trail into a fork.
    for (const side of [-1,1]) {
      ctx.save(); ctx.scale(side,1);
      fill(gold, () => {
        ctx.moveTo(0,12); ctx.quadraticCurveTo(12,-19,55,-37);
        ctx.bezierCurveTo(50,-17,45,-6,34,0); ctx.lineTo(43,-4);
        ctx.quadraticCurveTo(35,13,18,13); ctx.lineTo(24,14);
        ctx.quadraticCurveTo(15,21,3,19);
      });
      poly(light,[[7,11],[40,-21],[25,0]]);
      ctx.restore();
    }
    fill(light, () => { ctx.moveTo(-6,2); ctx.quadraticCurveTo(-10,-21,3,-28);
      ctx.quadraticCurveTo(12,-32,16,-24); ctx.lineTo(25,-21); ctx.lineTo(13,-17);
      ctx.quadraticCurveTo(10,5,5,18); ctx.lineTo(19,42);ctx.lineTo(0,28);
      ctx.lineTo(-22,44);ctx.quadraticCurveTo(-5,17,-6,2); });
    disc(shadow,9,-24,1.5);
  } else if (design === "oak") {
    for (const side of [-1,1]) {
      ctx.save(); ctx.scale(side,1);
      fill(gold, () => {
        ctx.moveTo(0,31);ctx.bezierCurveTo(7,11,24,8,38,-25);
        ctx.bezierCurveTo(22,-23,22,-16,20,-14);ctx.quadraticCurveTo(18,-25,12,-20);
        ctx.quadraticCurveTo(7,-16,9,-6);ctx.quadraticCurveTo(-3,-11,1,7);
      });
      poly(light,[[0,35],[8,13],[31,-18],[11,13],[5,34]]);
      disc(gold,28,11,5);disc(light,24,19,3);
      ctx.restore();
    }
    poly(light,[[0,-38],[7,-24],[0,-11],[-7,-24]]);
  } else if (design === "tide") {
    for (const dy of [-11,9,29]) {
      fill(dy === -11 ? light : gold, () => {
        ctx.moveTo(-43,dy+7);ctx.bezierCurveTo(-20,dy+12,-11,dy-19,13,dy-17);
        ctx.quadraticCurveTo(29,dy-18,30,dy-6);ctx.quadraticCurveTo(13,dy-13,11,dy-1);
        ctx.quadraticCurveTo(16,dy+8,42,dy-1);ctx.quadraticCurveTo(21,dy+17,3,dy+5);
        ctx.quadraticCurveTo(-19,dy+22,-43,dy+7);
      });
    }
  } else {
    const star = design === "sunburst" ? 12 : 8;
    for (let i=0;i<star;i++) {
      ctx.save();ctx.rotate(i*2*Math.PI/star);
      const tip = star===12 ? 43 : i%2===0 ? 45 : 29;
      poly(gold,[[-6,0],[0,-tip],[7,0],[0,7]]);
      poly(light,[[0,0],[0,-tip],[7,0]]);
      ctx.restore();
    }
    disc(shadow,0,0,star===12?16:11);disc(gold,0,0,star===12?12:6);
  }
}

function picture(cloth, trim, device, band) {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 384; canvas.height = band ? 64 : 256;
  const ctx = canvas.getContext("2d");
  if (typeof ctx?.bezierCurveTo !== "function") return null;
  const width = canvas.width, height = canvas.height;
  const dye = new Color(cloth), thread = new Color(trim);
  // Keep enough separation on a pale animal wearing a pale uniform.
  if (Math.abs(dye.getHSL({}).l-thread.getHSL({}).l)<.15)
    thread.lerp(new Color(dye.getHSL({}).l>.45 ? "#4e3832" : "#f7eaca"),.48);
  const hex = value => "#"+value.getHexString();
  const gold=hex(thread), light=hex(thread.clone().lerp(new Color("#ffebc8"),.36)),
    shadow=hex(dye.clone().multiplyScalar(.48)), field=hex(dye.clone().lerp(thread,.09));
  ctx.fillStyle=cloth;ctx.fillRect(0,0,width,height);
  // A narrow woven selvage frames broad areas of undisturbed dyed cloth.
  const hem = (y,h) => {
    ctx.fillStyle=shadow; ctx.fillRect(0,y,width,h);
    ctx.fillStyle=gold; ctx.fillRect(0,y+1,width,2); ctx.fillRect(0,y+h-3,width,2);
    const n=band?14:16, step=width/n;
    for (let i=0;i<n;i++) {
      const x=(i+.5)*step, cy=y+h/2;
      ctx.fillStyle=i%2?light:gold;ctx.beginPath();ctx.moveTo(x,cy-h*.28);
      ctx.lineTo(x+step*.33,cy);ctx.lineTo(x,cy+h*.28);ctx.lineTo(x-step*.33,cy);
      ctx.closePath();ctx.fill();
    }
  };
  if (band) {
    hem(7,height-14);
  } else {
    ctx.fillStyle=field;ctx.beginPath();
    ctx.moveTo(width*.24,0);ctx.lineTo(width*.76,0);ctx.lineTo(width*.66,height*.65);
    ctx.lineTo(width*.50,height*.80);ctx.lineTo(width*.34,height*.65);ctx.closePath();ctx.fill();
    ctx.save();ctx.translate(width*.50,height*.39);ctx.scale(1.66,1.66);
    insignia(ctx,device,gold,light,shadow);ctx.restore();
    hem(height*.85,height*.10);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace; texture.anisotropy = 4;
  return texture;
}

export function finishLivery(mesh, part, dress, chart, materials) {
  const key = [part.color,dress.trim,dress.device,chart.band,mesh.material.uuid].join("/");
  if (!materials.has(key)) {
    const map = picture(part.color,dress.trim,dress.device,chart.band);
    if (!map) return;
    const material = mesh.material.clone();
    material.color.set(0xffffff);
    material.map = map;
    material.userData.ownedLivery = true;
    materials.set(key,material);
  }
  mesh.material = materials.get(key);
}
