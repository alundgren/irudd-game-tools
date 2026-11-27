export function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("The reference data is incomplete.");
  return value;
}
