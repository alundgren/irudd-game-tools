import type { PieceName, Vec3 } from "@irudd/document";
export const pieceAnchors: Readonly<Record<PieceName, Vec3>> = {
  torso: [0, 0.86, 0],
  head: [0, 1.42, 0],
  "left arm": [0.2, 1.32, 0],
  "right arm": [-0.2, 1.32, 0],
  "left leg": [0.104, 0.85, 0],
  "right leg": [-0.104, 0.85, 0],
};
