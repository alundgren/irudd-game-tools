import {
  armEnds,
  legEnds,
  legStyles,
  limbSides,
  wingPatterns,
  wingRibCounts,
  wingSurfaceStructures,
  type CreatureLimb,
} from "@irudd/document";
import type { Fields } from "./surface-fields.js";
import { seed } from "./surface-fields.js";

export function limbFields(f: Fields, l: CreatureLimb): () => CreatureLimb {
  const pairs = f.numeric("Pairs", l.pairs, 1, 6, 1),
    side = f.choose("Sides", limbSides, l.side),
    from = f.numeric("First station", l.from, 0, 1),
    to = f.numeric("Last station", l.to, 0, 1),
    girth = f.numeric("Limb thickness", l.girth, 0.3, 3),
    muscle = f.numeric("Muscle", l.muscle, 0, 1.6);
  const placement = () => ({
    pairs: pairs(),
    side: side(),
    from: from(),
    to: to(),
    girth: girth(),
    muscle: muscle(),
  });
  switch (l.kind) {
    case "leg": {
      const style = f.choose("Leg joints", legStyles, l.style),
        end = f.choose("Foot", legEnds, l.end),
        digits = f.numeric("Toes", l.digits, 0, 5, 1),
        splay = f.numeric("Leg splay", l.splay, 0, 78);
      return () => ({
        ...placement(),
        kind: l.kind,
        style: style(),
        end: end(),
        digits: digits(),
        splay: splay(),
        fan: l.fan,
        ...(style() === "insect" && l.sockets ? { sockets: true } : {}),
      });
    }
    case "arm": {
      const end = f.choose("Hand", armEnds, l.end),
        length = f.numeric("Limb length", l.length, 0.08, 3),
        drop = f.numeric("Arm drop", l.drop, -80, 90),
        forward = f.numeric("Arm reach", l.forward, -80, 90),
        elbow = f.numeric("Elbow bend", l.elbow, 0, 150),
        digits = f.numeric("Fingers", l.digits, 1, 6, 1);
      return () => ({
        ...l,
        ...placement(),
        end: end(),
        length: length(),
        drop: drop(),
        forward: forward(),
        digits: digits(),
        elbow: elbow(),
      });
    }
    case "wing": {
      const struct = f.choose(
          "Wing structure",
          ["plain", ...wingSurfaceStructures] as const,
          l.structure,
        ),
        length = f.numeric("Limb length", l.length, 0.1, 4),
        rise = f.numeric("Wing rise", l.rise, -30, 85),
        sweep = f.numeric("Wing sweep", l.sweep, -40, 70),
        chord = f.numeric("Wing chord", l.chord, 0.03, 1.5),
        pattern = f.choose(
          "Wing pattern",
          wingPatterns,
          l.structure === "plain" ? "none" : l.pattern,
        ),
        ribs = f.numeric("Ribs or feathers", l.structure === "plain" ? 5 : l.ribs, 2, 12, 1);
      return () => {
        const base = {
            ...placement(),
            kind: l.kind,
            length: length(),
            rise: rise(),
            sweep: sweep(),
            chord: chord(),
          },
          structure = struct();
        if (structure === "plain") return { ...base, structure };
        const [min, max] = wingRibCounts[structure];
        return {
          ...base,
          structure,
          ribs: Math.max(min, Math.min(max, ribs())),
          bend: l.structure === "plain" ? 0.4 : l.bend,
          notch: l.structure === "plain" ? 0.42 : l.notch,
          point: l.structure === "plain" ? 0.6 : l.point,
          pattern: pattern(),
          seed: l.structure === "plain" ? seed() : l.seed,
        };
      };
    }
    case "fin": {
      const length = f.numeric("Limb length", l.length, 0.05, 2),
        chord = f.numeric("Fin chord", l.chord, 0.03, 1),
        sweep = f.numeric("Fin sweep", l.sweep, -40, 80);
      return () => ({ ...l, ...placement(), length: length(), chord: chord(), sweep: sweep() });
    }
    case "tentacle": {
      const length = f.numeric("Limb length", l.length, 0.1, 3),
        curl = f.numeric("Curl", l.curl, -1, 1),
        droop = f.numeric("Droop", l.droop, -60, 90),
        forward = f.numeric("Reach forward", l.forward, -80, 90),
        fan = f.numeric("Fan angle", l.fan, 0, 240);
      return () => ({
        ...l,
        ...placement(),
        length: length(),
        curl: curl(),
        droop: droop(),
        forward: forward(),
        fan: fan(),
      });
    }
  }
}
