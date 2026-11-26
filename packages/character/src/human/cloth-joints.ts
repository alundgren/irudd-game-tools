type V3 = readonly [number, number, number];

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
