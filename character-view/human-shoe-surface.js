import { CanvasTexture, Float32BufferAttribute, SRGBColorSpace } from "three";

// The horizontal coordinate runs around the upper, with the seam under the sole.
// Heel to toe runs down the chart; the tongue and facings meet at the instep.
const cache = new WeakMap();
function upperMaterial(base, kind) {
  const variants = cache.get(base) ?? new Map();
  cache.set(base, variants);
  if (variants.has(kind)) return variants.get(kind);
  const layers = ["colour", "height", "roughness"].map(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    return canvas.getContext("2d");
  });
  const [colour, relief, rough] = layers;
  const upper = base.color;
  const dye = (light, tint = 0) => "#" + upper.clone().multiplyScalar(light)
    .lerp(upper.clone().set(0xb8aca0), tint).getHexString();
  function fill(paints) {
    layers.forEach((ctx, i) => {ctx.fillStyle = paints[i]; ctx.fillRect(0, 0, 256, 256);});
  }
  const sport = kind === "trainer", flat = kind === "flat", tall = kind === "boot";
  fill([dye(1), "#808080", sport ? "#b5b5b5" : "#929292"]);
  // Suede/leather grain is much finer than the quarter panels and eyelets.
  for (let j=0; j<1800; j++) {
    const hash = Math.imul(j+1, 2654435761) >>> 0;
    const x = (hash >> 8) & 255, y = (Math.imul(hash, 1274126177) >>> 21) & 255;
    colour.fillStyle = j % 3 ? "rgba(0,0,0,.045)" : "rgba(255,255,255,.065)";
    colour.fillRect(x, y, 1, 1.5);
  }
  function panel(path, tone) {
    [tone, "#999", sport ? "#9c9c9c" : "#7e7e7e"].forEach((paint,i)=>{
      layers[i].fillStyle=paint;
      layers[i].fill(path);
    });
    edge(path);
  }
  function stroke(path, width, paints, dashed = false) {
    layers.forEach((ctx,i)=>{
      ctx.strokeStyle = paints[i]; ctx.lineWidth = width; ctx.lineCap = "round";
      ctx.setLineDash(dashed ? [2.1,2.3] : []); ctx.stroke(path);
    });
  }
  function edge(path) {
    stroke(path, 3.6, [dye(.48), "#535353", "#adadad"]);
    stroke(path, 1.1, [dye(1.12,.18), "#aaa", "#999"], true);
  }
  const toe = new Path2D("M-5 191 Q52 188 83 202 Q128 220 173 202 Q204 188 261 191 L261 261 L-5 261 Z");
  panel(toe, dye(sport ? .74 : .84));
  for (const mirror of [false, true]) {
    layers.forEach(ctx=>{ctx.save(); if(mirror){ctx.translate(256,0); ctx.scale(-1,1);}});
    const quarter = new Path2D("M-4 -4 L103 -4 Q117 52 106 96 L110 159 Q89 170 80 185 Q56 172 39 146 L-4 150 Z");
    panel(quarter,dye(.79));
    if (sport) {
      const stripe = new Path2D("M32 70 Q57 95 88 107 L83 120 Q52 107 25 87 Z");
      panel(stripe,dye(1.15,.30));
    }
    layers.forEach(ctx=>ctx.restore());
  }
  // Low flats leave a plain vamp. Riding boots have a stitched throat rather
  // than laces disappearing up the shaft.
  if (!flat && !tall) {
    const count = sport ? 5 : 4, start = sport ? 68 : 80;
    const cord = sport ? dye(1.2,.55) : dye(.42);
    for(let row=0; row<count; row++) {
      const y = start+16*row, half = 18+row;
      for (const side of [-1,1]) {
        const x = 128+side*half;
        const hole = new Path2D();
        hole.arc(x,y,3.3,0,Math.PI*2);
        panel(hole,dye(.32));
        if (row+1 < count) {
          const cordPath = new Path2D();
          cordPath.moveTo(x,y);
          cordPath.quadraticCurveTo(128,y+5,128-side*(half+1),y+16);
          stroke(cordPath,4.6,[dye(.28),"#737373","#b0b0b0"]);
          stroke(cordPath,2.8,[cord,"#dedede","#b8b8b8"]);
        }
      }
    }
  }
  const [map, bump, roughness] = layers.map(ctx=>new CanvasTexture(ctx.canvas));
  map.colorSpace = SRGBColorSpace;
  for (const tex of [map, bump, roughness]) tex.anisotropy=4;
  const mat = base.clone();
  mat.map=map; mat.color.set(0xffffff);
  mat.bumpMap=bump; mat.bumpScale=.0014;
  mat.roughnessMap=roughness; mat.roughness=1;
  variants.set(kind, mat);
  return mat;
}

export function finishFootwear(mesh, coordinates) {
  if (!coordinates || typeof document === "undefined" || typeof Path2D === "undefined") return;
  mesh.geometry.setAttribute("uv", new Float32BufferAttribute(coordinates,2));
  const name = mesh.name.toLowerCase();
  const kind = /trainer|sneaker/.test(name) ? "trainer" : /flat/.test(name) ? "flat"
    : name === "boot" || name === "suit boot" ? "boot" : "lace-up";
  mesh.material=upperMaterial(mesh.material,kind);
}
