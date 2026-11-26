// The joints a hanging garment measures where it is fitted, which human/drape.ts
// turns into bones and moves. Kept apart from the rig so the garments that
// describe them depend on nothing above them.

type V3 = readonly [number, number, number];

/** The joints a hanging garment hangs from, as the garment measured them where it was fitted. */
export interface ClothJoints {
  readonly name: string;
  readonly columns: number;
  readonly joints: ReadonlyArray<{
    readonly name: string;
    readonly level: number;
    readonly column: number;
    readonly at: V3;
    readonly from: V3;
    readonly dir: readonly [number, number];
    readonly free: number;
  }>;
  readonly legs: ReadonlyArray<{
    readonly from: string;
    readonly to: string;
    readonly radii: ReadonlyArray<number>;
  }>;
  readonly axis: readonly [number, number];
  readonly pelvis: V3;
  readonly floor: number;
  readonly scale: number;
  readonly low: number;
  readonly high: number;
}
