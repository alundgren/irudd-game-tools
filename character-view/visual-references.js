// Artist references travel with a direction request. The accepted form contains
// only the geometry and surface art needed to render it.
export const referenceRoles = [
  "Face",
  "Body silhouette",
  "Garment",
  "Color and surface",
];
export function validReferences(list) {
  return (
    Array.isArray(list) &&
    list.length <= 2 &&
    list.every(
      (r) =>
        r &&
        referenceRoles.includes(r.role) &&
        typeof r.label === "string" &&
        r.label.length <= 96 &&
        typeof r.jpeg === "string" &&
        r.jpeg.startsWith("/9j/") &&
        r.jpeg.length <= 340000,
    )
  );
}
export async function readReference(file, role) {
  if (!referenceRoles.includes(role))
    throw new Error("Choose how to use the reference.");
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw new Error("Choose a PNG, JPEG or WebP image.");
  const bitmap = await createImageBitmap(file);
  try {
    const ratio = Math.min(1, 800 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
    canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#eeeae2";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.84, 0.72, 0.56, 0.4]) {
      const ref = {
        role,
        label: file.name.slice(0, 96),
        jpeg: canvas.toDataURL("image/jpeg", quality).split(",")[1],
      };
      if (validReferences([ref])) return ref;
    }
    throw new Error(
      "This image has too much detail. Crop the area you want to use.",
    );
  } finally {
    bitmap.close();
  }
}
export function referenceInstructions(references = []) {
  return references
    .map(
      (r, i) =>
        "Attachment " +
        (i + 3) +
        " is the artist's " +
        r.role.toLowerCase() +
        " reference. Use its visible features for that aspect. Keep the other aspects directed by the editor and the written brief.",
    )
    .join("\n");
}
