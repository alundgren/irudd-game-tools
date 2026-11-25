// The head as hair sees it, and a comb that takes a fringe off the eyes.
// Every groom measures the same frame from the adult it is built on, so a parting
// or a sweep follows the actual skull, the actual eyes and the actual hairline.
import { analyse, clamp, length, mix, smooth, sub, unit } from "./human-style-kit.js";

const DEG = Math.PI / 180;
// Hairline height (degrees above the cranium centre) by direction: 0 is the front, 180 the nape.
const HAIRLINE = [[0, 27], [28, 28], [50, 31], [64, 25], [74, 6], [80, -4], [87, 3], [96, 5], [110, 3], [122, -14], [140, -40], [180, -52]];
// A smooth curve through the rows, so the line has no corners where two rows meet.
const table = (rows, x) => {
  const n = rows.length - 1, i = Math.min(n, Math.max(1, rows.findIndex(row => x <= row[0])));
  if (x >= rows[n][0]) return rows[n][1];
  const [x0, y0] = rows[Math.max(0, i - 2)], [x1, y1] = rows[i - 1], [x2, y2] = rows[i], [x3, y3] = rows[Math.min(n, i + 1)];
  const t = (x - x1) / (x2 - x1), a = (y2 - y0) / (x2 - x0 || 1) * (x2 - x1), b = (y3 - y1) / (x3 - x1 || 1) * (x2 - x1);
  return (2 * t ** 3 - 3 * t * t + 1) * y1 + (t ** 3 - 2 * t * t + t) * a + (3 * t * t - 2 * t ** 3) * y2 + (t ** 3 - t * t) * b;
};
/** Hairline elevation in radians at an azimuth in radians. */
export const hairline = phi => table(HAIRLINE, Math.abs(phi) / DEG) * DEG;

/** How far the head reaches from the cranium centre, by unit direction. */
function dome(body, f) {
  const head = body.weight(/^head/), step = 6 * DEG, cols = 60, rows = 30, far = new Float32Array(cols * rows).fill(-1);
  for (let v = 0; v < body.count; v++) {
    if (head[v] < .5) continue;
    const d = sub(body.point(v), f.centre), r = length(d), row = clamp(Math.floor((Math.asin(d[1] / r) + Math.PI / 2) / step), 0, rows - 1), col = Math.floor((Math.atan2(d[0], d[2]) + Math.PI) / step) % cols;
    far[row * cols + col] = Math.max(far[row * cols + col], r);
  }
  // The jaw can leave a broad empty sector on the underside of a narrow head.
  // Fill every direction before interpolating radii, including the polar rows.
  for (let pass = 0; pass < rows + cols / 2 && far.includes(-1); pass++) {
    const old = far.slice();
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) if (old[i * cols + j] < 0)
      far[i * cols + j] = Math.max(old[i * cols + (j + 1) % cols], old[i * cols + (j + cols - 1) % cols], old[Math.max(0, i - 1) * cols + j], old[Math.min(rows - 1, i + 1) * cols + j]);
  }
  return q => {
    const fr = clamp((Math.asin(clamp(q[1], -1, 1)) + Math.PI / 2) / step - .5, 0, rows - 1), fc = ((Math.atan2(q[0], q[2]) + Math.PI) / step - .5 + cols) % cols;
    const i = Math.min(rows - 2, Math.floor(fr)), t = fr - i, j = Math.floor(fc) % cols, n = (j + 1) % cols, u = fc - Math.floor(fc);
    return mix(mix(far[i * cols + j], far[i * cols + n], u), mix(far[(i + 1) * cols + j], far[(i + 1) * cols + n], u), t);
  };
}

/**
 * Cranium centre, size and directions used to place every style, measured on `body`
 * (the result of `analyse`). `m` gives the scale `k` and the head joint; both default to the body's.
 *   aim(p)              direction of a point: azimuth `phi` (0 front, positive to the wearer's left), elevation `eps`, unit vector `q`
 *   bone(u)             distance from the centre to the head along a unit direction in metres
 *   over(p)             `phi`, `eps` and the height `h` of a point above the head
 *   place(phi, eps, h)  the point at a direction and a height above the head
 *   clear(p, gap)       the point pushed out of the skin to leave a gap
 *   eyes                both eyes with their centre, direction and angular half sizes
 */
export function headFrame(body, m = {}) {
  const k = m.k ?? body.scale, head = body.weight(/^head/), { positions, ids } = body.surface, joint = m.head ?? body.joint("head");
  let top = -Infinity, eye = null, count = 0;
  const balls = [[], []];
  for (let v = 0; v < body.count; v++) if (head[v] > .5) top = Math.max(top, body.P[v * 3 + 1]);
  for (let v = body.count; v < ids.length; v++) if (ids[v] >= 14598 && ids[v] <= 14741) {
    eye ??= [0, 0, 0]; eye[1] += positions[v * 3 + 1]; eye[2] += positions[v * 3 + 2]; count++;
    balls[positions[v * 3] > 0 ? 0 : 1].push([positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]]);
  }
  eye = eye ? [0, eye[1] / count, eye[2] / count] : [0, top - .118 * k, joint[2] + .07 * k];
  let back = Infinity, front = -Infinity, wide = 0;
  for (let v = 0; v < body.count; v++) {
    if (head[v] < .5) continue;
    const [x, y, z] = body.point(v);
    if (y > eye[1]) back = Math.min(back, z);
    if (y > eye[1] + .02 * k) front = Math.max(front, z);
    if (y > eye[1] + .03 * k) wide = Math.max(wide, Math.abs(x));
  }
  const centre = [0, eye[1] + .22 * (top - eye[1]), (back + front) / 2], radii = [wide, top - centre[1], (front - back) / 2];
  const aim = p => {
    const q = unit([(p[0] - centre[0]) / radii[0], (p[1] - centre[1]) / radii[1], (p[2] - centre[2]) / radii[2]]);
    return { q, phi: Math.atan2(q[0], q[2]), eps: Math.asin(clamp(q[1], -1, 1)) };
  };
  const f = { k, centre, radii, top, eye, aim, size: (radii[0] + radii[1] + radii[2]) / 3 };
  let reach = null;
  f.bone = u => (reach ??= dome(body, f))(u);
  f.over = p => { const d = sub(p, centre), r = length(d) || 1e-9, u = [d[0] / r, d[1] / r, d[2] / r], a = aim(p); return { phi: a.phi, eps: a.eps, r, u, h: r - f.bone(u) }; };
  f.place = (phi, eps, h) => {
    const c = Math.cos(eps), u = unit([c * Math.sin(phi) * radii[0], Math.sin(eps) * radii[1], c * Math.cos(phi) * radii[2]]), r = f.bone(u) + h;
    return [centre[0] + u[0] * r, centre[1] + u[1] * r, centre[2] + u[2] * r];
  };
  // Native cage landmarks at the upper rim of each ear. An ear close to the
  // skull can disappear from a radial silhouette while its rim still needs clearance.
  const earRims = [5413, 12012].map(id => ids.indexOf(id)).filter(i => i >= 0);
  f.earElevation = Math.max(...earRims.map(i => aim(body.point(i)).eps));
  f.clear = (p, gap) => body.clear(p, gap);
  f.eyes = balls.map((points, n) => {
    if (!points.length) points = [[(n ? -1 : 1) * .031 * k, eye[1], eye[2]]];
    const mid = points.reduce((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0]).map(x => x / points.length), at = aim(mid);
    let widest = 4 * DEG, tallest = 4 * DEG;
    // Only the front of each eyeball faces out of the head.
    for (const p of points) if (p[2] > mid[2]) { const a = aim(p); widest = Math.max(widest, Math.abs(a.phi - at.phi)); tallest = Math.max(tallest, Math.abs(a.eps - at.eps)); }
    return { centre: mid, phi: at.phi, eps: at.eps, wide: widest, tall: tallest };
  });
  return f;
}

const bodies = new WeakMap(), frames = new WeakMap();
/** The analysed body of a surface from `evaluateHuman`, measured once. */
export function surfaceBody(surface) {
  if (!bodies.has(surface)) bodies.set(surface, analyse(surface));
  return bodies.get(surface);
}
/** The head frame of a surface from `evaluateHuman`, measured once. */
export function surfaceFrame(surface) {
  if (!frames.has(surface)) frames.set(surface, headFrame(surfaceBody(surface)));
  return frames.get(surface);
}

/**
 * Ways to wear the hair that grows over the forehead. "As cut" leaves a style as it was made.
 * Left and right are the wearer's own.
 */
export const fringeStyles = ["As cut", "Parted", "Swept left", "Swept right", "Off the face"];
const WAYS = {
  // `part` places the parting between the temples (-1 the wearer's right, 1 the left); `open` is how much forehead shows at the temples.
  "Parted": { part: 0, open: 1, lean: .55 },
  "Swept left": { part: -.5, open: 1, lean: .65 },
  "Swept right": { part: .5, open: 1, lean: .65 },
  "Off the face": { part: 0, open: .2, lean: 0, flat: true, lie: .5 },
};
export const validFringe = name => fringeStyles.includes(name);

/**
 * Comb the fringe of any groom off the face. `positions` holds x, y, z per vertex in world
 * coordinates and is changed in place; vertices that are not over the face stay where they are.
 *
 * Hair is followed from the hairline down. Over the face it may only hang as far as an arch that
 * is shortest at the parting and reaches the brow at the temples, so the eyes and brows stay in view.
 * Each strand is shortened in proportion to fit under the arch, leans from the parting towards
 * the temple, and is laid close to the forehead. Nothing above the hairline moves, so the scalp
 * keeps its cover, and every point keeps a positive height over the measured skull.
 */
export function combFringe(positions, frame, fringe, { first = 0, count = positions.length / 3 - first } = {}) {
  const way = WAYS[fringe];
  if (!way) return 0;
  const k = frame.k, eyes = frame.eyes;
  // The window that must stay clear: out to a little beyond both eyes and up to the brow.
  const temple = clamp(Math.max(...eyes.map(e => Math.abs(e.phi) + e.wide)) + 12 * DEG, 30 * DEG, 56 * DEG);
  const brow = Math.max(...eyes.map(e => e.eps + e.tall)) + 3 * DEG;
  const part = way.part * temple, tail = 13 * DEG, soft = 10 * DEG, floor = .003 * k, lie = .011 * k * (way.lie ?? 1);
  // First find how far the hair hangs below the hairline in each direction.
  const limit = temple + Math.abs(part) + tail, step = 4 * DEG, bins = new Float32Array(Math.ceil(2 * limit / step) + 1), found = [];
  for (let v = first; v < first + count; v++) {
    const p = [positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]];
    // Only the front of the head can carry a fringe.
    if (p[2] < frame.centre[2] - .25 * frame.radii[2]) continue;
    const at = frame.over(p), depth = hairline(at.phi) - at.eps;
    if (depth <= 0 || Math.abs(at.phi) >= limit) continue;
    const bin = Math.floor((at.phi + limit) / step);
    if (depth > bins[bin]) bins[bin] = depth;
    found.push(v, at.phi, depth, at.h);
  }
  const longest = phi => { const x = (phi + limit) / step - .5, i = clamp(Math.floor(x), 0, bins.length - 2); return Math.max(bins[i], bins[i + 1], mix(bins[i], bins[i + 1], clamp(x - i))); };
  let moved = 0;
  for (let n = 0; n < found.length; n += 4) {
    const v = found[n], at = found[n + 1], depth = found[n + 2], height = found[n + 3];
    const x = at - part, side = x < 0 ? -1 : 1, reach = Math.abs(x), span = temple - side * part;
    if (reach >= span + tail) continue;
    // 0 at the hairline, 1 at the tips.
    const along = depth / Math.max(depth, longest(at));
    // Strands lean towards the temple; right at the parting they have nowhere to go.
    const out = reach < span ? reach + (span - reach) * way.lean * smooth(0, soft, reach) * along : reach;
    const phi = part + side * out, line = hairline(phi), room = Math.max(4 * DEG, line - brow) * way.open;
    // A short fringe is left at the parting itself, so the hair there is not pinched to nothing.
    const arch = way.flat ? 1 : mix(.25, 1, smooth(0, 1, clamp(out / span)) ** .75);
    let allowed = Math.max(.4 * DEG, room * arch);
    if (out > span) allowed /= Math.max(1e-4, 1 - smooth(span, span + tail, out));
    const kept = Math.min(depth, along * allowed), change = 1 - kept / depth;
    if (change < 1e-4 && out === reach) continue;
    // Shortened hair lies on the forehead and thins towards its tips, but never touches the skin.
    const low = floor + lie * (1 - Math.exp(-Math.max(0, height) / lie)) * (1 - .7 * along);
    // The measured skull is coarse, so the nearest skin has the last word.
    const q = frame.clear(frame.place(phi, line - kept, Math.max(floor, mix(height, low, smooth(0, .5, change)))), floor);
    positions[v * 3] = q[0]; positions[v * 3 + 1] = q[1]; positions[v * 3 + 2] = q[2];
    moved++;
  }
  return moved;
}

/**
 * Lift vertices over the forehead that ended up in the skin. A card that was combed flat can
 * still cut through the curve of the forehead between its corners; this checks the points
 * the cards are finally drawn with. Returns how many it moved.
 */
export function settleFringe(positions, frame, fringe) {
  if (!WAYS[fringe]) return 0;
  const gap = .003 * frame.k, reach = frame.size * 1.5;
  let moved = 0;
  for (let v = 0; v < positions.length / 3; v++) {
    const p = [positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]];
    if (p[2] < frame.centre[2] || p[1] < frame.eye[1] || Math.hypot(p[0] - frame.centre[0], p[1] - frame.centre[1], p[2] - frame.centre[2]) > reach) continue;
    const q = frame.clear(p, gap);
    if (q === p) continue;
    positions[v * 3] = q[0]; positions[v * 3 + 1] = q[1]; positions[v * 3 + 2] = q[2];
    moved++;
  }
  return moved;
}
