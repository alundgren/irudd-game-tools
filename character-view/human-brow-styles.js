const artwork = {
  "Soft taper": "eyebrow001", "Lifted arch": "eyebrow003", "Straight": "eyebrow005",
  "Fine arch": "eyebrow006", "Full and brushed": "eyebrow009",
  "Feathered": "eyebrow011", "Untrimmed": "eyebrow012",
};
export const browStyles = ["As drawn", ...Object.keys(artwork)];
export function fittedBrow(form) {
  return artwork[form.humanStyle?.browStyle] ?? ((form.human?.brow ?? 0) > .18 ? "eyebrow003" : "eyebrow001");
}
