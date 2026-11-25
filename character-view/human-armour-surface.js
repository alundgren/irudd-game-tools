import { Color, CanvasTexture, Float32BufferAttribute, SRGBColorSpace } from "three";

export const breastplateDevices = ["Plain", "Night moth", "Reed heron", "Knotted oak", "Compass"];
let artwork;
export function setArmourDeviceArtwork(image) { artwork = image; }

// Front and back each have their own half of the sheet. Split the side seam
// after computing normals so the skin weights and smooth highlights continue across it.
function plateChart(mesh, fit) {
  const geometry = mesh.geometry, weights = mesh.humanWeights;
  const position = geometry.getAttribute("position"), normals = geometry.getAttribute("normal");
  const ids = new Map(), points = [], directions = [], uv = [], indices = [], boneIds = [], influences = [];
  geometry.computeBoundingBox();
  const {min, max} = geometry.boundingBox, halfWidth = Math.max(Math.abs(min.x), Math.abs(max.x), .01);
  const corners = geometry.index.array;
  for (let face = 0; face < corners.length; face += 3) {
    const front = (position.getZ(corners[face]) + position.getZ(corners[face+1]) + position.getZ(corners[face+2])) / 3 >= fit.centreZ;
    for (let corner = 0; corner < 3; corner++) {
      const source = corners[face+corner], key = source * 2 + Number(front);
      let target = ids.get(key);
      if (target === undefined) {
        target = points.length / 3;
        ids.set(key, target);
        const x = position.getX(source), y = position.getY(source);
        points.push(x, y, position.getZ(source));
        directions.push(normals.getX(source), normals.getY(source), normals.getZ(source));
        const height = Math.max(.001, fit.top - fit.bottom);
        uv.push((front ? .25 : .75) + (front ? 1 : -1) * .24*x/halfWidth,
          Math.min(.99, Math.max(.01, (y-fit.bottom)/height)));
        for (let j = 0; j < 4; j++) {
          boneIds.push(weights.boneIndices[source*4+j]);
          influences.push(weights.weights[source*4+j]);
        }
      }
      indices.push(target);
    }
  }
  geometry.setAttribute("position", new Float32BufferAttribute(points, 3));
  geometry.setAttribute("normal", new Float32BufferAttribute(directions, 3));
  geometry.setAttribute("uv", new Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  mesh.humanWeights = { weights: Float32Array.from(influences), boneIndices: Uint8Array.from(boneIds) };
  return 2*halfWidth;
}

function canvas(w, h) {
  const result = document.createElement("canvas");
  result.width = w;
  result.height = h;
  return result.getContext("2d", { willReadFrequently: true });
}

function rgb(hex) {
  return [1, 3, 5].map(i => parseInt(hex.slice(i, i+2), 16));
}

// Pigment, tooled height, polished inlay and rough base are separate. The
// highlight therefore follows the light as a character turns in the player.
// Broad, soft patches, as the fire and the hammer leave them in a forged plate and wear leaves them in leather:
// two sizes of smooth noise between -1 and 1. `x` and `y` are in patches.
function mottle(x, y) {
  const at = (i, j) => { const n = Math.imul(i * 374761393 + j * 668265263 ^ 0x5bd1e995, 1274126177); return ((n ^ n >>> 15) >>> 0) / 4294967296; };
  const soft = (px, py) => {
    const i = Math.floor(px), j = Math.floor(py), a = px - i, b = py - j, u = a * a * (3 - 2 * a), v = b * b * (3 - 2 * b);
    return (at(i, j) * (1 - u) + at(i + 1, j) * u) * (1 - v) + (at(i, j + 1) * (1 - u) + at(i + 1, j + 1) * u) * v;
  };
  return (soft(x, y) * 2 + soft(x * 2.7 + 9, y * 2.7 + 4)) / 1.5 - 1;
}

export function finishBreastplate(mesh, finish) {
  const widthM = plateChart(mesh, finish);
  if (typeof document === "undefined") return;
  const width = 768, height = 384, diffuse = canvas(width, height), surface = canvas(width, height);
  const device = breastplateDevices.indexOf(finish.device) - 1;
  if (device >= 0 && artwork) {
    const side = artwork.width / 2, h = height*.39, w = h * (finish.top-finish.bottom)/widthM * .96;
    diffuse.drawImage(artwork, device%2*side, Math.floor(device/2)*side, side, side,
      width*.25-w/2, height*.34-h/2, w, h);
  }
  const colour = diffuse.getImageData(0, 0, width, height);
  const detail = surface.createImageData(width, height);
  const base = rgb(finish.color), inlay = rgb(finish.trim);
  const leather = finish.kind === "leather", steel = finish.kind === "metal";
  const heightM = finish.top - finish.bottom;
  const waistBand = Math.max(.018, (finish.ribs-finish.bottom) / Math.max(1, finish.lames));
  const segmented = finish.build === "segmented";
  const clamp = value => Math.min(1, Math.max(0, value));
  let random = 42;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = 4*(y*width+x), mark = colour.data[offset]/255;
    random = (Math.imul(random,1664525)+1013904223) >>> 0;
    const grit = random/4294967296-.5;
    // Broad tooling marks are shallow so a polished plate keeps its silhouette.
    const hammer = Math.sin(x*.15 + Math.sin(y*.17)*1.7)*Math.cos(y*.13 + Math.sin(x*.07));
    // A plate is darker and duller where scale stayed in its hollows; a hide where it has been handled less.
    const patch = mottle(x/width*14, y/height*7);
    const grain = (leather ? grit*.12 + hammer*.025 : grit*.042 + hammer*.019) + patch*(leather ? .07 : .085);
    // The visible rivet heads fix overlapping waist plates to internal
    // leathers. A pair of stitched side tabs closes the upper shell.
    const px = Math.abs(((x+.5) % (width/2) / (width/2) - .5) * widthM/.96);
    const aboveHem = (1-(y+.5)/height)*heightM;
    let metal = mark, raise = 0, seam = 0, strap = 0;
    if (segmented) {
      const waist = aboveHem < finish.ribs-finish.bottom;
      const row = waist ? ((aboveHem/waistBand+.15)%1 - .5)*waistBand : aboveHem-.79*heightM;
      const col = waist ? px-.31*widthM : px-.29*widthM;
      const d = Math.hypot(col,row);
      const rivet = clamp((.0047-d)/.0014);
      const rim = clamp(1-Math.abs(d-.0051)/.0019);
      metal = Math.max(metal, .83*rivet);
      raise = .8*rivet + .27*rim;
      seam = .23*rim;
      if (leather && px>.27*widthM) {
        const dist = Math.min(Math.abs(aboveHem-.54*heightM), Math.abs(aboveHem-.68*heightM));
        const fromEnd = (px-.27*widthM);
        const sideEdge = Math.max(dist-.012,.007-fromEnd-Math.max(0,.009-dist));
        strap = clamp(-sideEdge/.0015);
        const stitch = clamp(1-Math.abs(sideEdge+.0036)/.0014) *
          clamp((Math.cos(fromEnd*2*Math.PI/.006)+.35)*1.7);
        const buckle = Math.max(Math.abs(fromEnd-.037)-.006,dist-.015);
        const frame = clamp(1-Math.abs(buckle)/.0025);
        metal = Math.max(metal,.9*frame,.34*stitch);
        raise += .38*strap+.73*frame+.23*stitch;
        seam += .27*clamp(1-Math.abs(sideEdge-.001)/.0022);
      }
    }
    for (let c=0; c<3; c++)
      colour.data[offset+c] = (base[c]*(1-metal)*(1-.27*strap) + inlay[c]*metal)*(1+grain-seam);
    colour.data[offset+3] = 255;
    detail.data[offset] = 88 + 106*mark + 98*raise + grit*(leather ? 24 : 7) + 6*hammer;
    detail.data[offset+1] = (leather ? 172 : steel ? 112 : 92) - 54*metal + 14*grit + 6*hammer - (leather ? 16 : 30)*patch;
    detail.data[offset+2] = (steel ? 214 : 8)*(1-metal) + 189*metal;
    detail.data[offset+3] = 255;
  }
  diffuse.putImageData(colour,0,0);
  surface.putImageData(detail,0,0);
  const material = mesh.material.clone(), map = new CanvasTexture(diffuse.canvas), orm = new CanvasTexture(surface.canvas);
  map.colorSpace = SRGBColorSpace;
  map.anisotropy = orm.anisotropy = 4;
  material.color.set(0xffffff);
  material.map = map;
  material.metalness = material.roughness = 1;
  material.metalnessMap = material.roughnessMap = material.bumpMap = orm;
  material.bumpScale = .0016;
  material.name = "Cuirass " + finish.kind + (device >= 0 ? " with " + finish.device : "");
  material.addEventListener("dispose", () => { map.dispose(); orm.dispose(); });
  mesh.material = material;
}

const shoulderSurfaces = new WeakMap();

// Stamped and chased decoration follows each sheet of metal through a pose.
// The bell has a fan of flutes. Each articulated lame has a pair of fasteners
// and a rolled edge, leaving the gaps between moving plates free.
export function finishShoulder(mesh, coordinates, style, limb = false) {
  if (coordinates) mesh.geometry.setAttribute("uv", new Float32BufferAttribute(coordinates,2));
  if (typeof document === "undefined") return;
  const base = mesh.material;
  const key = [style.color, style.trim, style.material, style.cut, limb].join("/");
  const variants = shoulderSurfaces.get(base) ?? new Map();
  shoulderSurfaces.set(base, variants);
  if (variants.has(key)) { mesh.material=variants.get(key); return; }
  const size=256;
  function layer() {
    const canvas = document.createElement("canvas");
    canvas.width=canvas.height=size;
    return canvas.getContext("2d");
  }
  const albedo=layer(), details=layer();
  if (!albedo?.createImageData || !details?.createImageData) return;
  const colour=albedo.createImageData(size,size), packed=details.createImageData(size,size);
  const metal = style.material === "steel", leather = style.material === "leather";
  const tint = new Color(style.trim), plate = new Color(style.color), sample = new Color();
  for (let j=0;j<size;j++) for (let i=0;i<size;i++) {
    const x=((i+.5)/size-.012)/.976, y=(j+.5)/size, bell=y<.675;
    const t=bell ? (y-.02)/.64 : (y-.69)/.29;
    const width=Math.min(x,1-x), edge=Math.min(width, (bell ? .34 : .13)*Math.min(t,1-t));
    const rim=Math.exp(-((edge-.009)**2)/.000013);
    const recessed=Math.exp(-((edge-.021)**2)/.000012);
    const span=.105+.48*Math.min(1,Math.max(0,t));
    const rib=Math.abs((x-.5)/span);
    let ridge=bell && rib<1 && t>0 && t<1
      ? Math.cos(rib*Math.PI*3)**8 * Math.sin(Math.PI*t)**.7 : 0;
    // A greave or vambrace has a central crest with two swept flutes. Their
    // section narrows towards the ankle or wrist. Studs pin the side straps.
    const u = Math.min(1, Math.max(0,t));
    if (limb && bell) {
      const across = Math.abs(x-.5);
      const flute = across - (.045+.255*(1-u)**1.6);
      ridge = Math.sin(Math.PI*u)**.48 * (
        Math.exp(-(across**2)/.00022) + .80*Math.exp(-(flute**2)/.00028));
    }
    const v = limb && bell ? (t<.5 ? .22 : .78) : bell ? .82 : .64;
    const distance=Math.hypot(Math.min(Math.abs(x-.085),Math.abs(x-.915)),(t-v)*(bell ? .34 : .13));
    const stud=Math.max(0,Math.min(1,(.014-distance)/.004));
    const peen=Math.exp(-((distance-.017)**2)/.000012);
    const chased = limb && bell ? .28*ridge : 0;
    const bright = Math.max(chased, (bell ? .45 : .64)*rim);
    const raised=Math.max(bright,stud);
    const metalTone=metal ? 1 : .5;
    const hammer=Math.sin(i*.37+Math.sin(j*.19))*Math.sin(j*.51+i*.06);
    const patch=mottle(i/size*7,j/size*9);
    sample.copy(plate).multiplyScalar(1-.33*recessed-.24*peen+.08*ridge+.022*hammer+(leather?.07:.085)*patch);
    sample.lerp(tint, raised).convertLinearToSRGB();
    const k=4*(j*size+i);
    colour.data[k]=255*sample.r; colour.data[k+1]=255*sample.g; colour.data[k+2]=255*sample.b;
    colour.data[k+3]=255;
    packed.data[k]=112+54*ridge+48*rim-36*recessed+70*stud+4*hammer;
    packed.data[k+1]=(leather?163:107)+22*recessed-30*raised+8*hammer-(leather?16:30)*patch;
    packed.data[k+2]=metal ? 214+30*raised : 5+200*metalTone*raised;
    packed.data[k+3]=255;
  }
  albedo.putImageData(colour,0,0); details.putImageData(packed,0,0);
  const mat=base.clone(), map=new CanvasTexture(albedo.canvas), pbr=new CanvasTexture(details.canvas);
  map.colorSpace=SRGBColorSpace;
  map.anisotropy=pbr.anisotropy=4;
  mat.map=map; mat.color.set(0xffffff);
  mat.bumpMap=mat.roughnessMap=mat.metalnessMap=pbr;
  mat.bumpScale= .0022; mat.roughness=mat.metalness=1;
  mat.name=(limb ? "Fluted limb guard " : "Articulated shoulder ")+style.material;
  mat.addEventListener("dispose", () => {
    variants.delete(key);
    map.dispose();
    pbr.dispose();
  });
  variants.set(key,mat); mesh.material=mat;
}
