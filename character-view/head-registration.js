import { Box3, Matrix4, Quaternion, Vector3 } from "three";

const point = (xyz) => new Vector3(...xyz);

// Three non-collinear pairs specify a similarity transform without changing handedness.
// After matching the planes, solve the remaining in-plane rotation and uniform scale
// in least squares. This also handles imperfectly matched artist landmarks.
export function fitLandmarks(source, target) {
  function frame(points) {
    if (points.length !== 3 || points.some(p => p.length !== 3 || !p.every(Number.isFinite)))
      throw new Error("Place all three landmark pairs.");
    const [a,b,c] = points.map(point);
    const x = b.clone().sub(a);
    const span = x.length();
    const z = x.clone().cross(c.clone().sub(a));
    if (span < 0.001 || z.length() / span < 0.002)
      throw new Error("Use well-separated landmarks on both eyes and the chin.");
    x.normalize(); z.normalize();
    const y = z.clone().cross(x);
    const center = a.clone().add(b).add(c).divideScalar(3);
    const basis = new Matrix4().makeBasis(x,y,z);
    const flat = points.map(p => {
      const d = point(p).sub(center);
      return [d.dot(x), d.dot(y)];
    });
    return {center, basis, flat};
  }
  const from = frame(source), to = frame(target);
  let dot = 0, cross = 0, lengthSq = 0;
  for (let i = 0; i < 3; i++) {
    const [x,y] = from.flat[i], [u,v] = to.flat[i];
    dot += x*u + y*v;
    cross += x*v - y*u;
    lengthSq += x*x + y*y;
  }
  const scale = Math.hypot(dot,cross) / lengthSq;
  const rotation = to.basis.clone().multiply(new Matrix4().makeRotationZ(Math.atan2(cross,dot)))
    .multiply(from.basis.clone().transpose());
  const orient = new Quaternion().setFromRotationMatrix(rotation);
  const shift = to.center.clone().sub(from.center.clone().applyQuaternion(orient).multiplyScalar(scale));
  const transform = new Matrix4().compose(shift, orient, new Vector3(scale,scale,scale));
  const rmsMm = 1000*Math.sqrt(source.reduce((sum,p,i) =>
    sum + point(p).applyMatrix4(transform).distanceToSquared(point(target[i])),0)/3);
  return { transform, rmsMm, scale };
}

// Bring an isolated scan into the head pane so the artist can mark it. The
// three point pairs refine this provisional size and pose against the actual person.
export function placeHeadScan(raw, options, surface, registration) {
  const head = surface.names.indexOf("head"), skull = new Box3(), p = new Vector3();
  for (let i=0; i<surface.bodyVertices; i++)
    if (surface.boneIndices[i*4] === head) skull.expandByPoint(p.fromArray(surface.positions,i*3));
  const targetCenter = skull.getCenter(new Vector3());
  const orient = new Matrix4().makeRotationY((Number(options.turn)||0)*Math.PI/180);
  if (options.up === "z") orient.multiply(new Matrix4().makeRotationX(-Math.PI/2));
  const box = new Box3();
  // Only referenced positions count towards the initial frame.
  for (const i of raw.indices) box.expandByPoint(p.fromArray(raw.positions,i*3).applyMatrix4(orient));
  const size = box.getSize(new Vector3()), sourceCenter = box.getCenter(new Vector3());
  if (size.y <= 1e-8 || size.x <= 1e-8) throw new Error("The head scan needs a measurable surface.");
  const units = {m:1, cm:.01, mm:.001, in:.0254, ft:.3048};
  const factor = units[options.units] ?? ((skull.max.y-skull.min.y)/size.y);
  const positions = new Float32Array(raw.positions.length);
  const shift = point(options.nudge || [0,0,0]);
  for (let i=0; i<positions.length; i+=3) {
    p.fromArray(raw.positions,i).applyMatrix4(orient).sub(sourceCenter).multiplyScalar(factor).add(targetCenter);
    if (registration) p.applyMatrix4(registration.transform);
    p.add(shift).toArray(positions,i);
  }
  return {positions, report: {stature:size.y*factor*(registration?.scale??1), headOnly:true,
    factor:factor*(registration?.scale??1), notes:[], rmsMm:registration?.rmsMm}};
}
