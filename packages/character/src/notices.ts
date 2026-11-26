export interface CodeNotice {
  readonly name: string;
  readonly license: "MIT";
  readonly copyright: string;
  readonly licenseFile: string;
  readonly use: string;
}

export const codeNotices: ReadonlyArray<CodeNotice> = [
  {
    name: "three",
    license: "MIT",
    copyright: "Copyright © 2010-2026 three.js authors",
    licenseFile: "LICENSE",
    use: "Geometry, materials and glTF export.",
  },
  {
    name: "meshoptimizer",
    license: "MIT",
    copyright: "Copyright (c) 2016-2026 Arseny Kapoulkine",
    licenseFile: "LICENSE.md",
    use: "Mesh simplification for the Game and Portrait presets.",
  },
];
