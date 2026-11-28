import type { Vector3 } from "three";
import type {
  CreaturePlan,
  FigureJoin,
  FigureWing,
  PlateField,
  PlateFieldRest,
} from "@irudd/document";

export type Draft<T> = T extends object ? { -readonly [K in keyof T]: Draft<T[K]> } : T;
export type Plan = Draft<CreaturePlan>;
export type Limb = Plan["limbs"][number];
export type Leg = Extract<Limb, { kind: "leg" }>;
export type Arm = Extract<Limb, { kind: "arm" }>;
export type Wing = Extract<Limb, { kind: "wing" }>;
export type Fin = Extract<Limb, { kind: "fin" }>;
export type Tentacle = Extract<Limb, { kind: "tentacle" }>;
export type Head = Plan["head"];
export type Skin = Plan["skin"];
export type Triple = [number, number, number];

export interface Cage {
  vertices: number[][];
  faces: number[][];
  levels?: number;
  creases?: number[][];
}
export interface Marks {
  kind: string;
  color: string;
  spacing: number;
  coverage: number;
  angle: number;
  seed: number;
}
export interface PlateSite {
  row: number;
  column: number;
  tipSeed?: number;
}
export interface Fibres {
  count: number;
  wave: number;
  fall: number;
  grey: number;
  rooted: boolean;
  seed: number;
}
export interface Grip {
  side?: number;
  fingers?: number;
  curl?: number;
  spread?: number;
  relaxed?: boolean;
  cylindrical?: boolean;
  pad?: string;
}
export interface FormPart {
  id: string;
  shape: string;
  position: number[];
  size: number[];
  rotation: number[];
  color: string;
  parent?: string;
  frameSize?: number[];
  knots?: number[][];
  cage?: Cage;
  surface?: string;
  motionRole?: string;
  blendSkin?: boolean;
  markings?: Marks;
  undercoat?: Marks;
  coatZone?: string;
  eyeSurface?: string;
  pinna?: boolean;
  nasalWing?: boolean;
  suckerRows?: number;
  hornSwatch?: number;
  contourFeather?: boolean;
  plateSite?: PlateSite;
  plateGrowth?: PlateField;
  plateGrowthRest?: PlateFieldRest;
  surfaceJoin?: Draft<FigureJoin>;
  fibres?: Fibres;
  shellFinish?: { ribs: number; seed: number };
  grip?: Grip;
  wing?: FigureWing;
}
export interface PoseJoint {
  part: string;
  station: number;
  digit?: string;
  turn?: number[];
  shift?: number[];
}
export interface FormPose {
  name: string;
  joints: PoseJoint[];
}
export interface Form {
  outfit: string;
  appearance: { palette: string; face: number; skin: string; hairColor: string; hair: string };
  parts: FormPart[];
  skinTint: string;
  skinSurface?: string;
  origin: { generator: number; kind: string; plan: Plan };
  poses?: FormPose[];
}
export const isLeg = (l: Limb): l is Leg => l.kind === "leg";
export const isArm = (l: Limb): l is Arm => l.kind === "arm";
export const isWing = (l: Limb): l is Wing => l.kind === "wing";
export const isFin = (l: Limb): l is Fin => l.kind === "fin";
export const isTentacle = (l: Limb): l is Tentacle => l.kind === "tentacle";

export interface RawLimb {
  kind: string;
  pairs?: number;
  side?: string;
  from?: number;
  to?: number;
  girth?: number;
  muscle?: number;
  style?: string;
  sockets?: boolean;
  splay?: number;
  fan?: number;
  end?: string;
  digits?: number;
  length?: number;
  drop?: number;
  forward?: number;
  elbow?: number;
  hand?: number;
  raise?: number;
  rise?: number;
  sweep?: number;
  chord?: number;
  structure?: string;
  ribs?: number;
  bend?: number;
  notch?: number;
  point?: number;
  pattern?: string;
  seed?: number;
  droop?: number;
  curl?: number;
}
export interface RawMarks {
  kind?: string;
  color?: string;
  spacing?: number;
  coverage?: number;
  angle?: number;
  seed?: number;
}
export interface RawSkin {
  base?: string;
  accent?: string;
  pale?: string;
  eye?: string;
  surface?: string;
  blend?: boolean;
  belly?: number;
  socks?: number;
  faceMarking?: string;
  flankMarking?: string;
  limbFade?: boolean;
  coat?: RawCoat | undefined;
  markings?: RawMarks | null;
}
export interface RawCoat {
  family?: string;
  graded?: boolean;
  contrast?: number;
  density?: number;
  seed?: number;
}
export interface RawHead {
  count?: number;
  neck?: number;
  neckPitch?: number;
  neckGirth?: number;
  size?: number;
  shape?: string;
  snout?: string;
  snoutLength?: number;
  billProfile?: string;
  muzzleProfile?: string;
  mouth?: boolean;
  eyes?: number;
  eyeSize?: number;
  eyePlace?: string;
  stalks?: number;
  lids?: number;
  crest?: string;
  crestSize?: number;
  ear?: string;
  jaw?: number;
  teeth?: number;
  brow?: number;
  nostrils?: boolean;
  whiskers?: boolean;
  turn?: number;
}
export interface RawSpine {
  length?: number;
  girth?: number;
  flat?: number;
  rear?: number;
  front?: number;
  arch?: number;
  profile?: string;
  stance?: number;
  bulge?: readonly number[];
}
export interface RawTail {
  kind?: string;
  length?: number;
  girth?: number;
  lift?: number;
  sway?: number;
}
export interface RawBack {
  kind?: string;
  count?: number;
  height?: number;
  spread?: number;
  seed?: number;
}
export interface RawEquipment {
  kind?: string;
  handling?: string;
  station?: number;
  hang?: number;
  size?: number;
  side?: string;
  mount?: string;
  color?: string;
  seed?: number;
}
export interface RawDress {
  kind?: string;
  device?: string;
  color?: string;
  trim?: string;
  layers?: number;
  size?: number;
  clear?: number;
  cut?: number;
  seed?: number;
}
export interface RawPlan {
  anatomyRevision?: number;
  family?: string;
  equipment?: RawEquipment | undefined;
  dress?: RawDress | undefined;
  scale?: number;
  spine?: RawSpine;
  head?: RawHead;
  limbs?: readonly RawLimb[];
  details?: readonly string[];
  tail?: RawTail;
  back?: RawBack;
  skin?: RawSkin;
}
export interface SpineStation {
  centre: Vector3;
  tangent: Vector3;
  dorsal: Vector3;
  pitch: number;
  radius: [number, number];
}
export interface Spine {
  at(t: number): SpineStation;
  radius(t: number): [number, number];
}
export interface Anchor {
  id: string;
  kind: "leg" | "arm";
  station: number;
  upper: string;
  lower: string;
  root: Vector3;
  mid: Vector3;
  end: Vector3;
  r0: number;
  r1: number;
  r2: number;
  side: number;
}
export interface HeadFrame {
  headId: string;
  neckId: string;
  centre: Vector3;
  axes: number[];
  across: Vector3;
  up: Vector3;
  facing: Vector3;
  onHead(az: number, el: number, scale?: number): Vector3;
  outward(az: number, el: number): Vector3;
  neckRoot: Vector3;
  neckEnd: Vector3;
  nr0: number;
  nr1: number;
  hs: number;
}
export interface Shell {
  vertices: Vector3[];
  faces: number[][];
}
export interface DressContext {
  plan: Plan;
  spine: Spine;
  anchors: Anchor[];
  heads: HeadFrame[];
  supports?: FormPart[];
  room: () => boolean;
  emit: (id: string, parent: string, shells: Shell[], color: string, surface: string) => void;
}
