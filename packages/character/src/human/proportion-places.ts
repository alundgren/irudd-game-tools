const places: Record<string, number[]> = {
  eyeOuter: [13377],
  eyeInner: [13365],
  lidUpper: [13352],
  lidLower: [13370],
  eyeOuterRight: [6781],
  eyeInnerRight: [6769],
  mouthLeft: [7272],
  mouthRight: [527],
  nostrilLeft: [11673],
  nostrilRight: [5056],
  noseRoot: [132],
  noseBase: [5072],
  lipTop: [455],
  mouthLine: [474, 523],
  lipBottom: [492, 5337],
  chinBase: [732],
};
export const proportionPlaces = places;

export const proportions: readonly {
  id: string;
  name: string;
  from: string;
  to: string;
  ends: readonly string[];
  kind?: string;
}[] = [
  {
    id: "mouthWidth",
    name: "Mouth width",
    from: "mouthLeft",
    to: "mouthRight",
    ends: ["one corner of the mouth", "the other corner of the mouth"],
  },
  {
    id: "noseWidth",
    name: "Nose width",
    from: "nostrilLeft",
    to: "nostrilRight",
    ends: ["the widest point of one nostril wing", "the widest point of the other wing"],
  },
  {
    id: "eyeLength",
    name: "Eye length",
    from: "eyeInner",
    to: "eyeOuter",
    ends: [
      "the inner corner of one eye, where the lid edges meet",
      "the outer corner of the same eye",
    ],
  },
  {
    id: "eyeOpening",
    name: "Eye opening height",
    from: "lidUpper",
    to: "lidLower",
    ends: [
      "the edge of the upper lid above the middle of the eye",
      "the edge of the lower lid below it",
    ],
  },
  {
    id: "innerEyes",
    name: "Between the inner eye corners",
    from: "eyeInner",
    to: "eyeInnerRight",
    ends: [
      "the inner corner of one eye, where the lid edges meet",
      "the inner corner of the other eye",
    ],
  },
  {
    id: "outerEyes",
    name: "Between the outer eye corners",
    from: "eyeOuter",
    to: "eyeOuterRight",
    ends: ["the outer corner of one eye", "the outer corner of the other eye"],
  },
  {
    id: "eyeSlant",
    name: "Outer eye corner above the inner",
    kind: "rise",
    from: "eyeInner",
    to: "eyeOuter",
    ends: [
      "the inner corner of one eye, where the lid edges meet",
      "the outer corner of the same eye",
    ],
  },
  {
    id: "noseLength",
    name: "Nose length",
    kind: "height",
    from: "noseRoot",
    to: "noseBase",
    ends: [
      "the bridge of the nose between the eyes, level with the upper lids",
      "where the nose meets the upper lip",
    ],
  },
  {
    id: "noseToMouth",
    name: "Nose to mouth line",
    kind: "height",
    from: "noseBase",
    to: "mouthLine",
    ends: ["where the nose meets the upper lip", "the line between the lips at the middle"],
  },
  {
    id: "upperLip",
    name: "Upper lip height",
    kind: "height",
    from: "lipTop",
    to: "mouthLine",
    ends: ["the top edge of the upper lip at the middle", "the line between the lips below it"],
  },
  {
    id: "lowerLip",
    name: "Lower lip height",
    kind: "height",
    from: "mouthLine",
    to: "lipBottom",
    ends: ["the line between the lips at the middle", "the bottom edge of the lower lip below it"],
  },
  {
    id: "mouthToChin",
    name: "Mouth line to chin",
    kind: "height",
    from: "mouthLine",
    to: "chinBase",
    ends: ["the line between the lips at the middle", "the underside of the chin at the middle"],
  },
];
