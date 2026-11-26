import { CanvasTexture, Color, Float32BufferAttribute, MathUtils, SRGBColorSpace } from "three";

const tau = 2 * Math.PI;
const { smoothstep } = MathUtils;

export function finishMantle(mesh, coordinates, layer) {
  if (!coordinates) return;
  mesh.geometry.setAttribute("uv", new Float32BufferAttribute(coordinates, 2));
  if (typeof document === "undefined") return;
  const width = 512, height = 384;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const relief = document.createElement("canvas");
  relief.width = width;
  relief.height = height;
  const paint = canvas.getContext("2d"), bump = relief.getContext("2d");
  if (!paint?.createImageData || !bump?.createImageData) return;
  const pixels = paint.createImageData(width, height), heights = bump.createImageData(width,height);
  const body = new Color(layer.color);
  const braid = new Color(layer.trim);
  const thread = braid.clone().lerp(new Color(layer.clasp), .35);
  const wool = new Color();
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const u = (x + .5) / width, v = (y + .5) / height;
    const twill = Math.cos(tau * (x * .21 + y * .32));
    const nap = .53 * Math.sin(1.42*x + Math.sin(.21*y)) + .47 * Math.cos(1.17*y + .33*x);
    const edge = Math.min(u, 1-u);
    const hem = 1-v;
    const guard = smoothstep(hem,.020,.028) * (1-smoothstep(hem,.124,.132));
    const rail = Math.max(1-smoothstep(Math.abs(hem-.031), .002, .006),
                          1-smoothstep(Math.abs(hem-.120), .002, .006));
    const along = Math.abs((u*32 % 1)-.5)*2;
    const across = Math.abs(hem-.075)/.034;
    const lozenge = 1-smoothstep(Math.abs(along+across-1),.045,.16);
    const facing = 1-smoothstep(Math.abs(edge-.013),.0015,.004);
    const brocade = Math.max(guard * lozenge, rail, .7*facing);
    wool.copy(body).multiplyScalar(1 + .055*twill + .028*nap);
    wool.lerp(braid,guard*.25);
    wool.lerp(thread,brocade*(.72+.16*twill));
    wool.convertLinearToSRGB();
    const i=4*(y*width+x);
    pixels.data[i] = 255*wool.r;
    pixels.data[i+1] = 255*wool.g;
    pixels.data[i+2] = 255*wool.b;
    pixels.data[i+3] = 255;
    heights.data[i] = 120+32*twill+11*nap+52*brocade;
    heights.data[i+1] = 235-28*brocade+8*twill;
    heights.data[i+2] = 0;
    heights.data[i+3] = 255;
  }
  paint.putImageData(pixels,0,0);
  bump.putImageData(heights,0,0);
  const mat = mesh.material.clone();
  mat.color.set(0xffffff);
  mat.map = new CanvasTexture(canvas);
  mat.map.colorSpace = SRGBColorSpace;
  mat.bumpMap = mat.roughnessMap = new CanvasTexture(relief);
  mat.map.anisotropy = mat.bumpMap.anisotropy = 4;
  mat.bumpScale = .0017;
  mat.roughness = 1;
  mat.metalness = 0;
  mat.userData.foldedCloth = true;
  mat.name = "Mantle wool and woven guard";
  mat.addEventListener("dispose", () => { mat.map.dispose(); mat.bumpMap.dispose(); });
  mesh.material = mat;
}
