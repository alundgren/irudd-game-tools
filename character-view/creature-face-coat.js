import { Color, Float32BufferAttribute, MathUtils } from "three";

export const faceMarkings = ["None", "Eye stripe", "Facial disc", "Cheek flashes", "Forehead blaze"];

const { smoothstep } = MathUtils;
const edge = (distance, width, feather = .055) => 1 - smoothstep(distance, width-feather, width+feather);

export function faceCoat(part, object, plan) {
  const style = plan?.skin.faceMarking;
  if (!style || style === "None" || !/^head(?: [0-9]+)?$/.test(part.id) || !object) return null;
  const { eyePlace } = plan.head;
  const azimuth = eyePlace === "side" ? 1.25 : eyePlace === "top" ? .42 : .50;
  const elevation = eyePlace === "side" ? .26 : eyePlace === "top" ? .98 : .36;
  const base = new Color(part.color);
  const accent = new Color(plan.skin.accent).lerp(base,.13);
  const pale = new Color(plan.skin.pale).lerp(base,.16);
  const shadow = base.clone().lerp(accent,.13).multiplyScalar(.28);
  const ink = new Color();
  object.updateWorldMatrix(true, false);
  const transform = object.matrixWorld.clone().invert().elements;
  function paint(color, x, y, z, share = 1) {
    const angle = Math.abs(Math.atan2(x,z));
    const height = Math.atan2(y,Math.hypot(x,z));
    const a = angle-azimuth, h = height-elevation;
    const fringe = .015*Math.sin(39*angle + 9*height) + .010*Math.sin(67*angle - 6*height);
    let dark = 0, light = 0, bright = 0;
    if (style === "Eye stripe") {
      const width = .20*(1-smoothstep(a,.15,1.18));
      const active = smoothstep(a,-.72,-.38)*(1-smoothstep(a,.92,1.15));
      const line = h-.15*a+.13*Math.sin(2.3*a);
      dark = active*edge(Math.abs(line)+fringe,width);
      light = active*edge(Math.abs(line-width-.055)+fringe,.075)*.9;
    } else if (style === "Facial disc") {
      const d = Math.hypot(a/.63,(h+.11)/.61);
      dark = edge(d+fringe,1.04);
      light = edge(d+fringe,.91)*.92;
      bright = edge(d,.46)*.64;
    } else if (style === "Cheek flashes") {
      const q = (a-.15)/.72, along = 1-smoothstep(Math.abs(q),.70,1);
      const line = h+.39+.10*Math.cos(2.2*q)-.22*q;
      bright = along*edge(Math.abs(line)+fringe,.13);
      dark = along*edge(Math.abs(line+.20)+fringe,.055);
      light = along*edge(Math.abs(line-.18)+fringe,.045);
    } else if (style === "Forehead blaze") {
      const t = smoothstep(height,-.48,.93);
      const width = .10 + .19*t + .11*Math.exp(-((height-.61)**2)/.035);
      const fade = smoothstep(height,-.56,-.33)*(1-smoothstep(height,1.17,1.42));
      dark = edge(angle+fringe,width+.075)*fade;
      light = edge(angle+fringe,width)*fade;
      bright = fade*edge(angle,width*.55)*smoothstep(height,.32,.67);
    }
    ink.copy(color).lerp(shadow,.90*dark).lerp(pale,.90*light).lerp(accent,.91*bright);
    return color.lerp(ink,share);
  }
  return {
    local: paint,
    world(color,x,y,z,share) {
      const e = transform;
      return paint(color,e[0]*x+e[4]*y+e[8]*z+e[12],e[1]*x+e[5]*y+e[9]*z+e[13],e[2]*x+e[6]*y+e[10]*z+e[14],share);
    },
  };
}

export function paintFaceCoatVertices(mesh, part, plan) {
  if (part.paint || part.hull || part.surface !== plan.skin.surface) return;
  const coat = faceCoat(part, mesh, plan);
  if (!coat) return;
  const mat = mesh.material.clone(), geometry = mesh.geometry;
  const prior = mat.vertexColors && geometry.attributes.color, p = geometry.attributes.position;
  const rgb = new Float32Array(3*p.count), color = new Color();
  for (let i=0; i<p.count; i++) {
    color.copy(mat.color);
    if (prior) { color.r *= prior.getX(i); color.g *= prior.getY(i); color.b *= prior.getZ(i); }
    coat.local(color,p.getX(i),p.getY(i),p.getZ(i)).toArray(rgb,3*i);
  }
  geometry.setAttribute("color",new Float32BufferAttribute(rgb,3));
  mat.color.setHex(0xffffff); mat.vertexColors = true;
  mesh.material = mat;
}
