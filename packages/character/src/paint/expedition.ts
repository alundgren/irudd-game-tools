// The pressure suit's textile. Ported from expedition.js in character-view at
// 2761eb1: each suited region is traced once from the bundled expedition
// sheet and baked like a painted part, tinted white.

import type { OutfitRoleName } from "@irudd/document";
import { expeditionAtlas } from "../dress.js";
import type { Binding, PaintAtlases } from "./turnaround.js";
import { traceRegion, type TrackRow } from "./trace.js";

const tracks: ReadonlyArray<readonly [OutfitRoleName, ReadonlyArray<TrackRow>]> = [
  [
    "torso",
    [
      [0.455, -0.058, 0.058, -0.1, 0.12],
      [0.55, -0.132, 0.132, -0.165, 0.134],
      [0.66, -0.115, 0.115, -0.17, 0.15],
      [0.76, -0.124, 0.124, -0.16, 0.151],
      [0.815, -0.13, 0.13, -0.119, 0.12],
      [0.859, -0.085, 0.085, -0.081, 0.108],
    ],
  ],
  [
    "head",
    [
      [0.827, -0.11, 0.11, -0.085, 0.119],
      [0.862, -0.12, 0.12, -0.11, 0.14],
      [0.94, -0.12, 0.12, -0.1, 0.16],
      [0.998, -0.12, 0.12, -0.1, 0.16],
    ],
  ],
  [
    "upper arm",
    [
      [0.669, 0.145, 0.233, -0.057, 0.076],
      [0.74, 0.12, 0.215, -0.071, 0.083],
      [0.793, 0.095, 0.185, -0.068, 0.08],
      [0.829, 0.086, 0.146, -0.05, 0.075],
    ],
  ],
  [
    "forearm",
    [
      [0.539, 0.216, 0.31, 0.001, 0.085],
      [0.599, 0.18, 0.296, -0.004, 0.093],
      [0.66, 0.15, 0.241, -0.034, 0.082],
      [0.692, 0.143, 0.225, -0.051, 0.077],
    ],
  ],
  [
    "hand",
    [
      [0.444, 0.254, 0.321, 0.019, 0.084],
      [0.48, 0.235, 0.325, 0.01, 0.098],
      [0.532, 0.217, 0.3, 0.002, 0.091],
      [0.559, 0.213, 0.291, -0.008, 0.079],
    ],
  ],
  [
    "thigh",
    [
      [0.303, 0.023, 0.17, -0.073, 0.132],
      [0.389, 0.014, 0.17, -0.075, 0.13],
      [0.452, 0.005, 0.15, -0.074, 0.126],
      [0.534, 0.002, 0.14, -0.095, 0.115],
    ],
  ],
  [
    "shin",
    [
      [0.084, 0.05, 0.176, -0.073, 0.116],
      [0.177, 0.038, 0.174, -0.065, 0.111],
      [0.24, 0.026, 0.17, -0.062, 0.111],
      [0.336, 0.028, 0.163, -0.077, 0.112],
    ],
  ],
  [
    "foot",
    [
      [0.003, 0.032, 0.196, -0.073, 0.17],
      [0.038, 0.04, 0.19, -0.071, 0.174],
      [0.089, 0.056, 0.177, -0.064, 0.122],
      [0.12, 0.053, 0.172, -0.065, 0.105],
    ],
  ],
  [
    "pelvis",
    [
      [0.456, -0.085, 0.085, -0.06, 0.11],
      [0.514, -0.121, 0.121, -0.09, 0.1],
      [0.583, -0.119, 0.119, -0.107, 0.106],
    ],
  ],
];

const kits = new WeakMap<PaintAtlases, ReadonlyMap<OutfitRoleName, Binding> | undefined>();

/**
 * The traced suit regions, or nothing when the sheet is not loaded. G0
 * prepares no regional views for them (it hands preparePaintRegions the
 * traced parts, which carry no region of their own), so they bake unoccluded.
 */
export function expeditionKit(
  atlases: PaintAtlases,
): ReadonlyMap<OutfitRoleName, Binding> | undefined {
  if (kits.has(atlases)) return kits.get(atlases);
  const panels = atlases.panels(expeditionAtlas);
  const kit =
    panels &&
    new Map(
      tracks.map(([role, rows]) => [
        role,
        traceRegion(panels, expeditionAtlas, role, 1.84, rows, 30),
      ]),
    );
  kits.set(atlases, kit);
  return kit;
}
