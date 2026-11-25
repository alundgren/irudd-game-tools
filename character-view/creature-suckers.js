import { BufferGeometry, Color, Float32BufferAttribute, Vector3 } from "three";
import { sweepRings } from "./surface.js";

// The oral side is transported with the arm, so the cups face out of the curl.
// Each lip stands proud of its own recessed centre and sits inside the arm at its base.
export function suckerGeometry(knots, rows, colour, pale, game) {
  const rings = sweepRings(knots);
  const first = rings[0], oral = new Vector3(0, -0.78, 0.62);
  const angle = Math.atan2(oral.dot(first.v), oral.dot(first.u));
  const skin = new Color(colour), rim = skin.clone().lerp(new Color(pale), 0.48);
  const hollow = skin.clone().multiplyScalar(0.43);
  const position = [], colors = [], indices = [], sides = game ? 8 : 12;
  const armLength = rings.slice(1).reduce((sum,ring,i)=>sum+ring.center.distanceTo(rings[i].center),0);
  const spacing = armLength / (game ? 16 : 24);
  for (let row = 0; row < rows; row++) {
    let previous = null;
    for (let j = 4 + row; j < rings.length - 1; j++) {
      const ring = rings[j], radius = Math.min(ring.w, ring.d);
      if (previous && previous.distanceTo(ring.center) < Math.max(spacing, radius * 0.98)) continue;
      previous = ring.center;
      const a = angle + (rows === 1 ? 0 : row === 0 ? -0.49 : 0.49);
      const normal = ring.u.clone().multiplyScalar(Math.cos(a) / ring.w)
        .addScaledVector(ring.v, Math.sin(a) / ring.d).normalize();
      const sideways = new Vector3().crossVectors(normal, ring.along).normalize();
      const root = ring.center.clone().addScaledVector(ring.u, Math.cos(a) * ring.w)
        .addScaledVector(ring.v, Math.sin(a) * ring.d);
      const size = radius * (rows === 1 ? 0.56 : 0.44), start = position.length / 3;
      const profile = [[0.72,-0.40,skin],[1,0.12,rim],[0.83,0.39,rim],[0.53,0.15,hollow]];
      for (const [r,h,color] of profile)
        for (let i = 0; i < sides; i++) {
          const t = i * 2 * Math.PI / sides;
          const p = root.clone().addScaledVector(normal, size*h)
            .addScaledVector(ring.along, size*r*Math.cos(t)*1.08)
            .addScaledVector(sideways, size*r*Math.sin(t));
          position.push(p.x,p.y,p.z);
          colors.push(color.r,color.g,color.b);
        }
      const centre = root.clone().addScaledVector(normal, 0.035 * size);
      const cap = position.length / 3;
      position.push(centre.x,centre.y,centre.z);
      colors.push(hollow.r,hollow.g,hollow.b);
      for (let i=0; i<sides; i++) {
        const next=(i+1)%sides;
        for (let k=0; k<profile.length-1; k++) {
          const lo=start+k*sides, hi=lo+sides;
          indices.push(lo+i,lo+next,hi+next,lo+i,hi+next,hi+i);
        }
        const lip=start+(profile.length-1)*sides;
        indices.push(lip+i,lip+next,cap);
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(position,3));
  geometry.setAttribute("color", new Float32BufferAttribute(colors,3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
