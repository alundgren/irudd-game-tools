import { coverageMask } from "../packages/character/src/review/coverage.ts";
export { enclosedSkin, exposedSkinPixels, compareCoverage } from "../packages/character/src/review/coverage.ts";

export function garmentCoverage(form, model) {
  const native = Boolean(form.human);
  if (!native && (!form.parts.some((p) => p.bare) || !form.parts.some((p) => p.visibleIn))) return null;
  let names;
  model.traverse((o) => {
    if (!names && o.geometry?.attributes[native ? "_coverage" : "_region"])
      names = native ? o.userData.coverageNames : o.userData.regionNames;
  });
  if (!names) return null;
  const labels = native ? names.map((name, i) => ({ name, bare: i === 1, outer: i >= 2 })) : names.map((id) => {
    const p = form.parts.find((part) => part.id === id);
    return (
      p && {
        name: p.id,
        bare: Boolean(p.bare),
        outer: !p.bare && Boolean(p.visibleIn?.includes(form.outfit)),
      }
    );
  });
  return coverageMask(native ? "_coverage" : "_region", labels);
}
