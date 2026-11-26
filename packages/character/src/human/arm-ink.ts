import * as T from "three";
import { context2d, type Raster } from "../raster.js";
import { boneNames, type BoneName } from "./catalogue.js";
import { armInkStyles } from "./draw.js";
import { randomStream } from "./identity.js";
import type { SmoothSurface } from "./smooth.js";

export type ArmInkStyle = (typeof armInkStyles)[number];
const armSleeveStyles: ReadonlyArray<string> = [
  "Botanical sleeve",
  "Engraved sleeve",
  "Cartographic sleeve",
];
const isArmSleeve = (name: string) => armSleeveStyles.includes(name);
const isArmInk = (name: string | undefined): name is ArmInkStyle =>
  armInkStyles.some((style) => style === name);

export function armInkBones(name: string | undefined): ReadonlyArray<BoneName> {
  if (!isArmInk(name)) return [];
  return isArmSleeve(name) ? ["upperarm_l", "lowerarm_l"] : ["lowerarm_l"];
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const smooth = (v: number, a: number, b: number) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export type ArmInkChart = (vertex: number) => readonly [number, number];

const joint = (surface: SmoothSurface, name: BoneName) =>
  new T.Vector3().fromArray(surface.joints, 3 * boneNames.indexOf(name));

function forearmChart(surface: SmoothSurface, bone: BoneName): ArmInkChart {
  const sideTag = bone.endsWith("_r") ? "r" : "l";
  const sign = sideTag === "r" ? -1 : 1;
  const elbow = joint(surface, bone),
    axis = joint(surface, sideTag === "r" ? "hand_r" : "hand_l").sub(elbow);
  const length = axis.length();
  axis.normalize();
  const front = new T.Vector3(0.72 * sign, 0, 0.7);
  front.addScaledVector(axis, -axis.dot(front)).normalize();
  const side = new T.Vector3().crossVectors(axis, front).multiplyScalar(sign);
  const delta = new T.Vector3();
  return (vertex) => {
    delta.fromArray(surface.positions, vertex * 3).sub(elbow);
    return [
      0.5 + Math.atan2(delta.dot(side), delta.dot(front)) / (2 * Math.PI),
      1 - delta.dot(axis) / length,
    ];
  };
}

function sleeveChart(surface: SmoothSurface, sideTag: "l" | "r"): ArmInkChart {
  const sign = sideTag === "r" ? -1 : 1;
  const shoulder = joint(surface, sideTag === "r" ? "upperarm_r" : "upperarm_l");
  const elbow = joint(surface, sideTag === "r" ? "lowerarm_r" : "lowerarm_l");
  const wrist = joint(surface, sideTag === "r" ? "hand_r" : "hand_l");
  const uVec = elbow.clone().sub(shoulder),
    uLen = Math.max(uVec.length(), 1e-4);
  const uAxis = uVec.clone().divideScalar(uLen);
  const lVec = wrist.clone().sub(elbow),
    lLen = Math.max(lVec.length(), 1e-4);
  const lAxis = lVec.clone().divideScalar(lLen);
  const outFront = new T.Vector3(0.72 * sign, 0, 0.7);
  const p = new T.Vector3(),
    q1 = new T.Vector3(),
    q2 = new T.Vector3();
  const axis = new T.Vector3(),
    front = new T.Vector3(),
    side = new T.Vector3(),
    delta = new T.Vector3();
  return (vertex) => {
    p.fromArray(surface.positions, vertex * 3);
    const t1Raw = p.clone().sub(shoulder).dot(uAxis) / uLen;
    const t1Seg = clamp(t1Raw, 0, 1);
    q1.copy(shoulder).addScaledVector(uAxis, t1Seg * uLen);
    const d1 = p.distanceToSquared(q1);
    const t2Raw = p.clone().sub(elbow).dot(lAxis) / lLen;
    const t2Seg = clamp(t2Raw, 0, 1);
    q2.copy(elbow).addScaledVector(lAxis, t2Seg * lLen);
    const d2 = p.distanceToSquared(q2);
    let s: number;
    if (d1 <= d2) {
      s = 0.5 * clamp(t1Raw, -0.14, 1);
      delta.copy(p).sub(q1);
    } else {
      s = 0.5 + 0.5 * clamp(t2Raw, 0, 1.12);
      delta.copy(p).sub(q2);
    }
    const w = smooth(s, 0.4, 0.6);
    axis.copy(uAxis).lerp(lAxis, w).normalize();
    front.copy(outFront).addScaledVector(axis, -axis.dot(outFront)).normalize();
    side.crossVectors(axis, front).multiplyScalar(sign);
    const u = 0.5 + Math.atan2(delta.dot(side), delta.dot(front)) / (2 * Math.PI);
    const v = clamp(0.92 - 0.84 * s, 0.01, 0.99);
    return [u, v];
  };
}

export function armInkChart(surface: SmoothSurface, bone: BoneName, name: string): ArmInkChart {
  return isArmSleeve(name)
    ? sleeveChart(surface, bone.endsWith("_r") ? "r" : "l")
    : forearmChart(surface, bone);
}

function drawSwift(ctx: CanvasRenderingContext2D): void {
  const path = (outline: string) => ctx.fill(new Path2D(outline));
  path(
    "M 121 113 C 110 91 93 71 63 45 Q 78 71 83 89 Q 70 79 56 69 Q 73 97 88 114 L 74 104 Q 95 131 116 141 L 106 165 L 119 157 L 114 193 Q 130 175 137 149 Q 146 138 149 124 L 161 119 L 152 116 Q 151 108 142 109 Q 138 102 135 97 Q 149 62 175 30 Q 148 45 130 73 Q 138 48 155 28 Q 131 46 122 76 Q 119 91 121 113 Z",
  );
  ctx.lineWidth = 2;
  ctx.stroke(
    new Path2D("M 84 55 Q 98 64 107 78 M 91 54 Q 98 59 102 64 M 131 161 Q 128 178 119 192"),
  );
  ctx.fillStyle = "white";
  path("M 75 65 Q 105 96 116 125 Q 105 108 92 96 Q 97 96 99 98 Z");
  path("M 164 44 Q 140 78 131 104 Q 134 76 164 44 Z");
  ctx.beginPath();
  ctx.arc(146, 115, 1.8, 0, 2 * Math.PI);
  ctx.fill();
}

function drawFern(ctx: CanvasRenderingContext2D): void {
  ctx.lineCap = "round";
  ctx.lineWidth = 3.2;
  ctx.stroke(new Path2D("M 105 215 Q 135 143 145 49 Q 149 32 157 23"));
  for (let i = 0; i < 12; i++) {
    const y = 190 - i * 13,
      x = 114 + 3 * i - 0.04 * i * i;
    const spread = 13 + 23 * Math.sin(((i + 1) * Math.PI) / 14);
    for (const sign of [-1, 1]) {
      const base = y + (sign > 0 ? 4 : 0);
      ctx.beginPath();
      ctx.moveTo(x, base);
      ctx.bezierCurveTo(
        x + sign * 4,
        base - 12,
        x + sign * spread * 0.76,
        base - 12,
        x + sign * spread,
        base - 30,
      );
      ctx.quadraticCurveTo(x + sign * spread * 0.84, base - 6, x, base);
      ctx.fill();
    }
  }
}

function drawLeaf(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  length: number,
  width: number,
  dark: string,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(length * 0.28, -width * 0.62, length * 0.74, -width * 0.48, length, 0);
  ctx.bezierCurveTo(length * 0.74, width * 0.48, length * 0.28, width * 0.62, 0, 0);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "white";
  ctx.lineWidth = Math.max(2.2, width * 0.13);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(length * 0.06, 0);
  ctx.quadraticCurveTo(length * 0.48, -width * 0.05, length * 0.86, 0);
  ctx.stroke();
  ctx.lineWidth = Math.max(1.4, width * 0.07);
  for (const t of [0.32, 0.56]) {
    const px = length * t;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px + length * 0.14, -width * 0.28);
    ctx.moveTo(px, 0);
    ctx.lineTo(px + length * 0.14, width * 0.28);
    ctx.stroke();
  }
  ctx.restore();
}

function drawBotanicalSleeve(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  seed: number,
): void {
  const next = randomStream(seed ^ 0x4b07a11c);
  const phase = (next() - 0.5) * 0.36;
  const dark = "#1e2e2c",
    mid = "#415953";
  const cx = w * 0.5;
  const xMin = w * 0.09,
    xMax = w * 0.91;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const stem1X = (t: number) => cx + w * (0.18 * Math.sin(t * Math.PI * 2.0 + phase));
  const stem2X = (t: number) => cx - w * (0.17 * Math.sin(t * Math.PI * 2.0 + phase + 0.45));
  const stemY = (t: number) => h * (0.115 + 0.76 * t);

  for (let i = 0; i < 64; i++) {
    const t0 = i / 64,
      t1 = (i + 1) / 64;
    ctx.strokeStyle = mid;
    ctx.lineWidth = 7.6 - 2.6 * t0;
    ctx.beginPath();
    ctx.moveTo(stem2X(t0), stemY(t0));
    ctx.lineTo(stem2X(t1), stemY(t1));
    ctx.stroke();
  }

  for (let i = 0; i < 64; i++) {
    const t0 = i / 64,
      t1 = (i + 1) / 64;
    ctx.strokeStyle = dark;
    ctx.lineWidth = 12.2 - 5.0 * t0;
    ctx.beginPath();
    ctx.moveTo(stem1X(t0), stemY(t0));
    ctx.lineTo(stem1X(t1), stemY(t1));
    ctx.stroke();
  }

  const drawBranchLeaves = (
    stemFn: (t: number) => number,
    count: number,
    offset: number,
    scaleMult: number,
    primary: boolean,
  ) => {
    for (let i = 0; i < count; i++) {
      const t = 0.035 + ((i + offset) / (count - 1 + offset)) * 0.905;
      if (Math.abs(t - 0.5) < 0.072) continue;
      const x = stemFn(t),
        y = stemY(t);
      const dx = stemFn(t + 0.01) - stemFn(t - 0.01),
        dy = stemY(t + 0.01) - stemY(t - 0.01);
      const tangent = Math.atan2(dy, dx);
      const side = (i % 2 === 0 ? 1 : -1) * (primary ? 1 : -1);
      const env = (0.86 + 0.36 * Math.sin(t * Math.PI)) * (t > 0.52 ? 0.92 : 1.04) * scaleMult;
      const len = 82 * env,
        wid = 36 * env;
      const ang = tangent + side * (0.76 + 0.16 * Math.sin(i * 1.7));
      const tipX = x + Math.cos(ang) * len;
      const safeLen = tipX < xMin || tipX > xMax ? len * 0.7 : len;
      drawLeaf(ctx, x, y, ang, safeLen, wid, primary ? dark : mid);
      if (primary && i % 2 === 0) {
        drawLeaf(ctx, x, y, ang - side * 0.46, safeLen * 0.64, wid * 0.64, mid);
      } else if (primary) {
        ctx.strokeStyle = dark;
        ctx.lineWidth = 3.8;
        ctx.beginPath();
        const tx = x + Math.cos(ang + side * 0.48) * safeLen * 0.58;
        const ty = y + Math.sin(ang + side * 0.48) * safeLen * 0.58;
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(tx + side * 16, ty - 14, tx, ty + 9);
        ctx.stroke();
        ctx.fillStyle = dark;
        ctx.beginPath();
        ctx.arc(tx, ty + 9, 5.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "white";
        ctx.beginPath();
        ctx.arc(tx, ty + 9, 2.0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  };
  drawBranchLeaves(stem2X, 14, 0.25, 0.84, false);
  drawBranchLeaves(stem1X, 16, 0, 1.04, true);

  const ey = h * 0.5;
  ctx.fillStyle = "white";
  ctx.fillRect(xMin, ey - 28, xMax - xMin, 56);
  ctx.fillStyle = "white";
  ctx.beginPath();
  ctx.ellipse(cx, ey, 56, 36, 0, 0, Math.PI * 2);
  ctx.fill();
  for (const [dy, lw, col] of [
    [-24, 6.4, dark],
    [24, 6.4, dark],
  ] as const) {
    ctx.strokeStyle = col;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(xMin + 10, ey + dy);
    ctx.quadraticCurveTo(cx, ey + dy * 1.18, xMax - 10, ey + dy);
    ctx.stroke();
  }
  ctx.strokeStyle = dark;
  ctx.lineWidth = 6.2;
  ctx.beginPath();
  ctx.ellipse(cx, ey, 42, 26, -0.12, 0.25, Math.PI * 1.75);
  ctx.stroke();
  ctx.strokeStyle = mid;
  ctx.lineWidth = 3.2;
  ctx.beginPath();
  ctx.ellipse(cx, ey, 52, 33, 0.12, Math.PI * 0.75, Math.PI * 2.25);
  ctx.stroke();
  for (const sign of [-1, 1]) {
    drawLeaf(ctx, cx + sign * 62, ey, sign > 0 ? 0 : Math.PI, 44, 20, dark);
    drawLeaf(ctx, cx + sign * 116, ey, sign > 0 ? 0 : Math.PI, 36, 17, mid);
  }

  const capY = h * 0.115;
  ctx.strokeStyle = dark;
  ctx.lineWidth = 6.8;
  ctx.beginPath();
  ctx.ellipse(cx, capY, 96, 20, 0, Math.PI + 0.18, Math.PI * 2 - 0.18);
  ctx.stroke();

  const wrY = h * 0.875;
  ctx.fillStyle = "white";
  ctx.fillRect(xMin, wrY - 16, xMax - xMin, 34);
  ctx.strokeStyle = dark;
  ctx.lineWidth = 9.5;
  ctx.beginPath();
  ctx.moveTo(xMin + 10, wrY);
  ctx.lineTo(xMax - 10, wrY);
  ctx.stroke();
  ctx.strokeStyle = mid;
  ctx.lineWidth = 3.4;
  ctx.beginPath();
  ctx.moveTo(xMin + 20, wrY + 12);
  ctx.lineTo(xMax - 20, wrY + 12);
  ctx.stroke();
  for (let k = -3; k <= 3; k++) {
    const px = cx + k * 52;
    if (px < xMin + 24 || px > xMax - 24) continue;
    drawLeaf(ctx, px, wrY - 3, -Math.PI * 0.5 + k * 0.14, 34, 15, k % 2 === 0 ? dark : mid);
  }
}

function drawDiamond(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
): void {
  ctx.beginPath();
  ctx.moveTo(cx, cy - ry);
  ctx.lineTo(cx + rx, cy);
  ctx.lineTo(cx, cy + ry);
  ctx.lineTo(cx - rx, cy);
  ctx.closePath();
}

function drawHatchedDiamond(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  step: number,
  angle: number,
  strokeStyle: string,
  lineWidth: number,
): void {
  ctx.save();
  drawDiamond(ctx, cx, cy, rx, ry);
  ctx.clip();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = lineWidth;
  const span = Math.hypot(rx, ry) + step;
  for (let d = -span; d <= span; d += step) {
    ctx.beginPath();
    ctx.moveTo(d, -span);
    ctx.lineTo(d, span);
    ctx.stroke();
  }
  ctx.restore();
}

function drawEngravedSleeve(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  seed: number,
): void {
  const next = randomStream(seed ^ 0x6e8a4f21);
  const dark = "#1d2730",
    mid = "#445462";
  const cx = w * 0.5;
  const xMin = w * 0.085,
    xMax = w * 0.915;
  ctx.lineCap = "round";
  ctx.lineJoin = "miter";

  ctx.strokeStyle = mid;
  ctx.lineWidth = 3.0;
  ctx.beginPath();
  ctx.moveTo(cx, h * 0.11);
  ctx.lineTo(cx, h * 0.89);
  ctx.stroke();

  const capY = h * 0.17;
  for (let k = -5; k <= 5; k++) {
    const a = -Math.PI * 0.5 + k * 0.22;
    const r0 = 26,
      r1 = k % 2 === 0 ? 78 : 56;
    ctx.strokeStyle = k % 2 === 0 ? dark : mid;
    ctx.lineWidth = k % 2 === 0 ? 5.2 : 2.6;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r0, capY + Math.sin(a) * r0 * 0.55);
    ctx.lineTo(cx + Math.cos(a) * r1, capY + Math.sin(a) * r1 * 0.55);
    ctx.stroke();
  }
  ctx.strokeStyle = dark;
  ctx.lineWidth = 8.5;
  ctx.beginPath();
  ctx.moveTo(xMin + 24, h * 0.21);
  ctx.lineTo(cx, h * 0.145);
  ctx.lineTo(xMax - 24, h * 0.21);
  ctx.stroke();

  const upY = h * 0.335;
  drawHatchedDiamond(ctx, cx, upY, 112, 76, 8.5, Math.PI * 0.25, mid, 2.8);
  ctx.strokeStyle = dark;
  ctx.lineWidth = 8.0;
  drawDiamond(ctx, cx, upY, 112, 76);
  ctx.stroke();
  ctx.fillStyle = "white";
  drawDiamond(ctx, cx, upY, 76, 50);
  ctx.fill();
  ctx.fillStyle = dark;
  drawDiamond(ctx, cx, upY, 54, 34);
  ctx.fill();
  ctx.fillStyle = "white";
  drawDiamond(ctx, cx, upY, 26, 16);
  ctx.fill();
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.arc(cx, upY, 6, 0, Math.PI * 2);
  ctx.fill();
  for (const sign of [-1, 1]) {
    ctx.strokeStyle = dark;
    ctx.lineWidth = 5.5;
    ctx.beginPath();
    ctx.moveTo(cx + sign * 124, upY - 38);
    ctx.lineTo(cx + sign * 162, upY);
    ctx.lineTo(cx + sign * 124, upY + 38);
    ctx.stroke();
    ctx.strokeStyle = mid;
    ctx.lineWidth = 3.0;
    ctx.beginPath();
    ctx.moveTo(cx + sign * 144, upY - 46);
    ctx.lineTo(cx + sign * 182, upY);
    ctx.lineTo(cx + sign * 144, upY + 46);
    ctx.stroke();
  }

  const elY = h * 0.5;
  ctx.fillStyle = "white";
  ctx.fillRect(xMin, elY - 34, xMax - xMin, 68);
  for (const [dy, lw, col] of [
    [-28, 7.5, dark],
    [-17, 2.6, mid],
    [17, 2.6, mid],
    [28, 7.5, dark],
  ] as const) {
    ctx.strokeStyle = col;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(xMin + 6, elY + dy);
    ctx.lineTo(xMax - 6, elY + dy);
    ctx.stroke();
  }
  ctx.fillStyle = "white";
  drawDiamond(ctx, cx, elY, 54, 32);
  ctx.fill();
  ctx.strokeStyle = dark;
  ctx.lineWidth = 6.5;
  drawDiamond(ctx, cx, elY, 46, 26);
  ctx.stroke();
  for (const sign of [-1, 1]) {
    for (let k = 0; k < 5; k++) {
      const tx = cx + sign * (72 + k * 24);
      if (tx < xMin + 12 || tx > xMax - 12) continue;
      ctx.fillStyle = k % 2 === 0 ? dark : mid;
      drawDiamond(ctx, tx, elY, 7, 10);
      ctx.fill();
    }
  }

  const loY = h * 0.695;
  const shift = (next() - 0.5) * 6;
  drawHatchedDiamond(ctx, cx, loY, 96, 92, 8.0, -Math.PI * 0.25, mid, 2.6);
  ctx.strokeStyle = dark;
  ctx.lineWidth = 8.0;
  drawDiamond(ctx, cx, loY, 96, 92);
  ctx.stroke();
  ctx.fillStyle = "white";
  drawDiamond(ctx, cx, loY, 64, 62);
  ctx.fill();
  ctx.strokeStyle = dark;
  ctx.lineWidth = 5.5;
  drawDiamond(ctx, cx, loY, 48, 46);
  ctx.stroke();
  drawHatchedDiamond(ctx, cx, loY, 32, 30, 6.5, Math.PI * 0.25, dark, 2.6);
  for (const dy of [-48, 0, 48]) {
    for (const sign of [-1, 1]) {
      const bx = cx + sign * (108 + (dy === 0 ? 18 : 4));
      ctx.strokeStyle = dy === 0 ? dark : mid;
      ctx.lineWidth = dy === 0 ? 6.0 : 3.6;
      ctx.beginPath();
      ctx.moveTo(bx, loY + dy - 18 + shift);
      ctx.lineTo(bx + sign * 24, loY + dy + shift);
      ctx.lineTo(bx, loY + dy + 18 + shift);
      ctx.stroke();
    }
  }

  const wrY = h * 0.865;
  ctx.fillStyle = dark;
  ctx.fillRect(xMin + 8, wrY - 9, xMax - xMin - 16, 13);
  ctx.fillStyle = "white";
  ctx.fillRect(xMin + 8, wrY + 4, xMax - xMin - 16, 7);
  ctx.fillStyle = dark;
  ctx.fillRect(xMin + 14, wrY + 11, xMax - xMin - 28, 4.5);
  for (let px = xMin + 24; px <= xMax - 24; px += 22) {
    ctx.fillStyle = Math.abs(px - cx) < 12 ? dark : mid;
    ctx.beginPath();
    ctx.arc(px, wrY + 23, Math.abs(px - cx) < 12 ? 4.8 : 3.2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawCartographicSleeve(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  seed: number,
): void {
  const next = randomStream(seed ^ 0xca4706a1);
  const dark = "#1d2c37",
    mid = "#3d5668",
    accent = "#7a392e";
  const cx = w * 0.5;
  const xMin = w * 0.08,
    xMax = w * 0.92;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const peaks: ReadonlyArray<readonly [number, number, number, number, number]> = [
    [0.5 + (next() - 0.5) * 0.06, 0.26, 0.16, 0.11, 1.0],
    [0.36, 0.35, 0.11, 0.08, 0.55],
    [0.64, 0.34, 0.12, 0.08, 0.52],
    [0.48 + (next() - 0.5) * 0.06, 0.69, 0.15, 0.11, 0.96],
    [0.63, 0.63, 0.11, 0.08, 0.48],
    [0.37, 0.74, 0.1, 0.07, 0.44],
  ];
  const field = (u: number, v: number) => {
    let z = 0;
    for (const [pu, pv, su, sv, amp] of peaks) {
      const du = (u - pu) / su,
        dv = (v - pv) / sv;
      z += amp * Math.exp(-(du * du + dv * dv));
    }
    const elbowClear = 1 - 0.95 * Math.exp(-(((v - 0.5) / 0.055) ** 2));
    const marginClear =
      smooth(u, 0.08, 0.18) *
      (1 - smooth(u, 0.82, 0.92)) *
      smooth(v, 0.1, 0.17) *
      (1 - smooth(v, 0.84, 0.9));
    return z * elbowClear * marginClear;
  };
  const gx = 72,
    gy = 104;
  const grid = new Float32Array((gx + 1) * (gy + 1));
  for (let j = 0; j <= gy; j++) {
    const v = j / gy;
    for (let i = 0; i <= gx; i++) grid[j * (gx + 1) + i] = field(i / gx, v);
  }
  const levels = [0.14, 0.26, 0.39, 0.53, 0.68, 0.82];
  for (const [li, iso] of levels.entries()) {
    const major = li % 2 === 1;
    ctx.strokeStyle = major ? dark : mid;
    ctx.lineWidth = major ? 5.8 : 2.8;
    ctx.beginPath();
    for (let j = 0; j < gy; j++) {
      for (let i = 0; i < gx; i++) {
        const a = grid[j * (gx + 1) + i] ?? 0,
          b = grid[j * (gx + 1) + i + 1] ?? 0;
        const c = grid[(j + 1) * (gx + 1) + i + 1] ?? 0,
          d = grid[(j + 1) * (gx + 1) + i] ?? 0;
        const pts: Array<[number, number]> = [];
        const addEdge = (
          v0: number,
          v1: number,
          x0: number,
          y0: number,
          x1: number,
          y1: number,
        ) => {
          if (v0 < iso !== v1 < iso) {
            const t = (iso - v0) / (v1 - v0);
            pts.push([(x0 + (x1 - x0) * t) * w, (y0 + (y1 - y0) * t) * h]);
          }
        };
        const u0 = i / gx,
          u1 = (i + 1) / gx,
          v0 = j / gy,
          v1 = (j + 1) / gy;
        addEdge(a, b, u0, v0, u1, v0);
        addEdge(b, c, u1, v0, u1, v1);
        addEdge(c, d, u1, v1, u0, v1);
        addEdge(d, a, u0, v1, u0, v0);
        const [p0, p1, p2, p3] = pts;
        if (p0 && p1) {
          ctx.moveTo(p0[0], p0[1]);
          ctx.lineTo(p1[0], p1[1]);
        }
        if (p2 && p3) {
          ctx.moveTo(p2[0], p2[1]);
          ctx.lineTo(p3[0], p3[1]);
        }
      }
    }
    ctx.stroke();
  }

  const trackX = (t: number) =>
    cx + w * (0.16 * Math.sin(t * Math.PI * 1.85 - 0.35) - 0.04 * Math.cos(t * Math.PI * 3.1));
  const trackY = (t: number) => h * (0.11 + 0.77 * t);
  ctx.strokeStyle = "white";
  ctx.lineWidth = 24;
  ctx.beginPath();
  for (let i = 0; i <= 72; i++) {
    const t = i / 72;
    if (i) ctx.lineTo(trackX(t), trackY(t));
    else ctx.moveTo(trackX(t), trackY(t));
  }
  ctx.stroke();
  for (const [off, lw, col] of [
    [-5.5, 10.2, dark],
    [8.0, 4.8, dark],
    [16.5, 2.5, mid],
  ] as const) {
    ctx.strokeStyle = col;
    ctx.lineWidth = lw;
    ctx.beginPath();
    for (let i = 0; i <= 72; i++) {
      const t = i / 72;
      if (i) ctx.lineTo(trackX(t) + off, trackY(t));
      else ctx.moveTo(trackX(t) + off, trackY(t));
    }
    ctx.stroke();
  }
  ctx.strokeStyle = dark;
  ctx.lineWidth = 5.0;
  ctx.beginPath();
  ctx.moveTo(trackX(0.58) - 5, trackY(0.58));
  ctx.bezierCurveTo(cx + 95, h * 0.6, cx + 110, h * 0.73, trackX(0.86) + 8, trackY(0.86));
  ctx.stroke();

  const elY = h * 0.5;
  ctx.fillStyle = "white";
  ctx.fillRect(xMin, elY - 22, xMax - xMin, 44);
  for (const [dy, lw, col] of [
    [-17, 7.4, dark],
    [0, 2.8, mid],
    [17, 7.4, dark],
  ] as const) {
    ctx.strokeStyle = col;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(xMin + 6, elY + dy);
    ctx.lineTo(xMax - 6, elY + dy);
    ctx.stroke();
  }
  for (let px = xMin + 18; px <= xMax - 18; px += 16) {
    const major = Math.round((px - cx) / 16) % 3 === 0;
    ctx.strokeStyle = major ? dark : mid;
    ctx.lineWidth = major ? 3.4 : 2.0;
    ctx.beginPath();
    ctx.moveTo(px, elY - (major ? 14 : 8));
    ctx.lineTo(px, elY + (major ? 14 : 8));
    ctx.stroke();
  }

  const rx = cx - 4,
    ry = h * 0.655;
  ctx.fillStyle = "white";
  ctx.beginPath();
  ctx.arc(rx, ry, 42, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = dark;
  ctx.lineWidth = 5.0;
  ctx.beginPath();
  ctx.arc(rx, ry, 36, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = mid;
  ctx.lineWidth = 2.0;
  ctx.beginPath();
  ctx.arc(rx, ry, 43, 0, Math.PI * 2);
  ctx.stroke();
  for (let k = 0; k < 8; k++) {
    const a = -Math.PI * 0.5 + k * Math.PI * 0.25;
    const len = k % 2 === 0 ? 34 : 22;
    const wid = k % 2 === 0 ? 7.5 : 4.5;
    ctx.fillStyle = k === 0 ? accent : k % 2 === 0 ? dark : mid;
    ctx.beginPath();
    ctx.moveTo(rx + Math.cos(a) * len, ry + Math.sin(a) * len);
    ctx.lineTo(rx + Math.cos(a + Math.PI * 0.5) * wid, ry + Math.sin(a + Math.PI * 0.5) * wid);
    ctx.lineTo(rx + Math.cos(a - Math.PI * 0.5) * wid, ry + Math.sin(a - Math.PI * 0.5) * wid);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = "white";
  ctx.beginPath();
  ctx.arc(rx, ry, 8.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = dark;
  ctx.lineWidth = 3.2;
  ctx.stroke();

  for (const [t, isHub] of [
    [0.18, true],
    [0.35, false],
    [0.78, true],
  ] as const) {
    const sx = trackX(t) - 5.5,
      sy = trackY(t);
    ctx.fillStyle = isHub ? accent : dark;
    ctx.beginPath();
    ctx.arc(sx, sy, isHub ? 10.5 : 7.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "white";
    ctx.beginPath();
    ctx.arc(sx, sy, isHub ? 4.8 : 3.2, 0, Math.PI * 2);
    ctx.fill();
  }

  const capY = h * 0.115;
  ctx.strokeStyle = dark;
  ctx.lineWidth = 6.0;
  ctx.beginPath();
  ctx.moveTo(cx - 110, capY + 8);
  ctx.quadraticCurveTo(cx, capY - 14, cx + 110, capY + 8);
  ctx.stroke();

  const wrY = h * 0.88;
  ctx.strokeStyle = dark;
  ctx.lineWidth = 11.0;
  ctx.beginPath();
  ctx.moveTo(xMin + 12, wrY);
  ctx.lineTo(xMax - 12, wrY);
  ctx.stroke();
  ctx.strokeStyle = mid;
  ctx.lineWidth = 3.0;
  ctx.beginPath();
  ctx.moveTo(xMin + 22, wrY + 12);
  ctx.lineTo(xMax - 22, wrY + 12);
  ctx.stroke();
  for (let px = xMin + 26; px <= xMax - 26; px += 18) {
    ctx.strokeStyle = dark;
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.moveTo(px, wrY - 12);
    ctx.lineTo(px, wrY - 4);
    ctx.stroke();
  }
}

export function inkedSkin(
  skin: T.MeshStandardMaterial,
  raster: Raster,
  name: string | undefined,
  seed: number,
): T.MeshStandardMaterial {
  if (!isArmInk(name)) return skin;
  const sleeve = isArmSleeve(name);
  const canvas = raster.canvas(512, sleeve ? 768 : 512);
  const ctx = context2d(canvas);
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (sleeve) {
    if (name === "Botanical sleeve")
      drawBotanicalSleeve(ctx, canvas.width, canvas.height, seed >>> 0);
    else if (name === "Engraved sleeve")
      drawEngravedSleeve(ctx, canvas.width, canvas.height, seed >>> 0);
    else drawCartographicSleeve(ctx, canvas.width, canvas.height, seed >>> 0);
  } else {
    ctx.scale(2, 2);
    ctx.fillStyle = ctx.strokeStyle = "#42565c";
    if (name === "Diving swift") drawSwift(ctx);
    else drawFern(ctx);
  }
  const map = new T.CanvasTexture(canvas);
  map.colorSpace = T.SRGBColorSpace;
  map.anisotropy = 8;
  const result = skin.clone();
  result.name = name + (sleeve ? " arm ink" : " forearm ink");
  result.map = map;
  result.normalMap = result.roughnessMap = null;
  delete result.userData["bodySkin"];
  result.addEventListener("dispose", () => map.dispose());
  return result;
}
