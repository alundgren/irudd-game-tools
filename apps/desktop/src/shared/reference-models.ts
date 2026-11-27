export const referenceModels = [
  {
    id: "mhr-rest",
    label: "Momentum Human Rig · neutral, rest pose",
    file: "examples/mhr-reference.glb",
  },
  ...["f1", "f2", "f3", "m1", "m2", "m3"].map((key) => ({
    id: "mhr-" + key,
    label:
      "MHR benchmark adult · " +
      (key.startsWith("f") ? "female" : "male") +
      "-typical " +
      key.slice(1),
    file: "examples/human-targets/mhr-" + key + ".glb",
  })),
] as const;
