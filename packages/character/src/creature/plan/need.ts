export function need<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("A creature build read past the end of a table.");
  return value;
}
