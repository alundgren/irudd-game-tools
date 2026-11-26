import { faceChart } from "./human-face-chart.js";

const clamp = value => Math.min(1, Math.max(0, value));
function fade(value, low, high) {
  const t = clamp((value - low) / (high - low));
  return t * t * (3 - 2*t);
}
const fields = new Map();

export function expressionLines(seed) {
  const variant = (seed >>> 5) % 6;
  if (fields.has(variant)) return fields.get(variant);
  const c = faceChart(), height = new Int8Array(c.x.length);
  const phase = variant*1.13;
  const groove = (distance, width) => {
    const t = distance / width;
    return .32*Math.exp(-((t-1.5)**2)) - Math.exp(-t*t);
  };
  for (let i=0; i<height.length; i++) {
    const x=c.x[i], y=c.y[i], a=Math.abs(x);
    const skin=c.skin[i]*fade(c.nz[i], .12, .6);
    if (skin < .001 || y < -19 || y > 65) continue;
    let relief=0;
    if (y>12 && a<52) {
      for (let row=0; row<3; row++) {
        const length=43-4*row + 3*Math.sin(phase+row);
        const t=a/length;
        const arc=28+8.2*row + 4.7*(1-t*t) + 1.4*Math.sin(.13*x+phase+.8*row);
        const strength=(1-fade(t,.48,1))*(.66+.24*Math.cos(.14*x-.7*row+phase));
        relief+=strength*groove(y-arc,.65+.12*row);
      }
      const path=3.9+.15*(y-13)+.8*Math.sin((y-13)*.15+phase);
      relief+=groove(a-path,.86)*fade(y,12,18)*(1-fade(y,23,32));
    }
    if (a>40 && a<70 && y<10) {
      for(let ray=0; ray<3; ray++){
        const run=a-45, line=-1.3+(ray-1)*2.3 + run*((ray-1)*.35-.10)
          + .54*Math.sin(run*.24 + phase + ray);
        const strength=fade(run,-2,3)*(1-fade(run,8+ray,16+ray));
        relief+=.72*strength*groove(y-line,.52+.017*Math.max(0,run));
      }
    }
    height[i]=Math.round(Math.max(-1,Math.min(1,relief*skin))*110);
  }
  fields.set(variant,height);
  return height;
}
