import { CanvasTexture, MathUtils, SRGBColorSpace } from "three";

const maps = new Map();
const { smoothstep } = MathUtils;

export function billChart(part, head) {
  if (!head || !["bill", "beak"].includes(head.snout) || part.shape !== "cage") return null;
  const lower = /^lower beak(?: [0-9]+)?$/.test(part.id);
  if (!lower && !/^beak(?: [0-9]+)?$/.test(part.id)) return null;
  const sides = lower ? 8 : 10;
  if (part.cage.vertices.length !== 7 * sides + 2) return null;
  const length = [0, .14, .35, .62, .83, .95, 1];
  const uv = part.cage.vertices.map((_, index) => {
    if (index >= 7 * sides) return [index === 7 * sides ? .01 : .99, .5];
    const section = index % sides;
    return [.01 + .98 * length[Math.floor(index / sides)],
      .01 + .98 * (1 - 2 * Math.min(section, sides - section) / sides)];
  });
  return { uv, lower, broad: head.snout === "bill", nostrils: !lower && head.nostrils };
}

function paintBill({lower, broad, nostrils}) {
  const key = [lower, broad, nostrils].join("/");
  if (maps.has(key)) return maps.get(key);
  if (typeof document === "undefined") return null;
  const width = 192, height = 128;
  function canvas() {
    const element = document.createElement("canvas");
    element.width = width; element.height = height;
    return element.getContext("2d");
  }
  const paint = canvas(), relief = canvas();
  if (!paint?.createImageData || !relief?.createImageData) return null;
  const rgb = paint.createImageData(width,height), pbr = relief.createImageData(width,height);
  for (let row=0; row<height; row++) for (let col=0; col<width; col++) {
    const u=(col+.5)/width, flank=(row+.5)/height;
    const cere = lower ? 0 : 1-smoothstep(u + .06*Math.cos(flank*5),.25,.39);
    const tip = smoothstep(u, broad ? .81 : .66, .98);
    const seamAt = lower ? .32 : .66;
    const edge = Math.exp(-(((flank-seamAt)/.048)**2));
    const growth = Math.sin(295*(u+.22*(flank-.36)**2) + .8*Math.sin(57*u));
    const fibre = Math.sin(154*flank + 4*Math.sin(11*u+2*flank));
    const dx = (u-(broad ? .36 : .29))/.070;
    const dy = (flank-(broad ? .23 : .33)+.018*dx)/.065;
    const aperture = Math.hypot(dx,dy);
    const hole = nostrils ? 1-smoothstep(aperture,.46,.96) : 0;
    const lip = nostrils ? Math.exp(-(((aperture-1.05)/.24)**2)) : 0;
    const sheen = .88 + .055*Math.cos(flank*Math.PI) + .034*growth + .018*fibre;
    const tone = sheen*(1-.32*tip+.095*edge-.72*hole + .085*lip);
    const i=4*(row*width+col);
    rgb.data.set([255*tone,255*tone*(1-.065*cere),255*tone*(1-.13*cere+.08*tip),255],i);
    pbr.data.set([124+7*growth+3*fibre-63*hole+24*lip, 108+68*cere-36*tip+18*hole+5*fibre,0,255],i);
  }
  paint.putImageData(rgb,0,0); relief.putImageData(pbr,0,0);
  const map = new CanvasTexture(paint.canvas), surface = new CanvasTexture(relief.canvas);
  map.colorSpace = SRGBColorSpace;
  map.anisotropy = surface.anisotropy = 4;
  const result = {map, bumpMap: surface, roughnessMap: surface};
  maps.set(key,result);
  return result;
}

export function finishBill(mesh, chart) {
  const material = mesh.material.clone();
  const finish = paintBill(chart);
  if (finish) Object.assign(material,finish);
  material.name = chart.broad ? "Bill sheath" : "Horn beak";
  material.metalness = 0;
  material.roughness = finish ? 1 : .43;
  material.bumpScale = .0014;
  mesh.material = material;
}
