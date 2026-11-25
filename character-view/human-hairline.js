import { CanvasTexture, Float32BufferAttribute, SRGBColorSpace } from "three";
import { randomStream } from "./random.js";

// Fine hairs at the edge of the underlayer taper into exposed scalp. Deeper in
// the groom the same chart shows the short hairs underneath longer locks.
let rootsMap;
function hairlineTexture() {
  if (rootsMap) return rootsMap;
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const pen = canvas.getContext("2d"), random = randomStream(73191);
  pen.fillStyle = "#cec7c1";
  pen.fillRect(0, 0, 512, 84);
  for (let i = 0; i < 1400; i++) {
    const x = random() * 536 - 12, sway = 3.5*Math.sin(x/29) + 2*Math.cos(x/11);
    const start = random()*74, tip = 87 + 33*random() + 5*Math.sin(x/17);
    const width = .4 + 2.3*random(), bend = sway + (random()-.5)*6;
    const grey = Math.round(174 + 78*random());
    pen.fillStyle = "rgb("+grey+","+grey+","+grey+")";
    pen.beginPath();
    pen.moveTo(x - width, start);
    pen.quadraticCurveTo(x + .4*bend - width, tip-11, x + bend, tip);
    pen.quadraticCurveTo(x + .4*bend + width, tip-17, x + width, start);
    pen.fill();
  }
  rootsMap = new CanvasTexture(canvas);
  rootsMap.colorSpace = SRGBColorSpace;
  rootsMap.anisotropy = 8;
  return rootsMap;
}

export function textureHairRoots(mesh, shell, frame) {
  if (typeof document === "undefined") return;
  const uv = new Float32Array(mesh.geometry.attributes.position.count*2);
  for (let i=0; i<shell.count; i++) {
    const {q} = frame.aim(shell.anchor(i));
    // A continuous longitude projection across the front, temples and nape.
    // Extra vertices on the closed underside keep the clear edge of the map.
    uv[2*i] = .5 + .42*q[0] + .06*q[2];
    uv[2*i+1] = Math.max(0,Math.min(1,shell.f.line[i] / .24));
  }
  mesh.geometry.setAttribute("uv", new Float32BufferAttribute(uv,2));
  mesh.material = mesh.material.clone();
  mesh.material.map = hairlineTexture();
  mesh.material.alphaTest = .32;
  mesh.material.roughness = .83;
}
