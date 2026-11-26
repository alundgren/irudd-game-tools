import { domRaster, type RasterImage } from "@irudd/character";

function guide(image: RasterImage, quadrant: 0 | 1, size: number): HTMLCanvasElement {
  const canvas = domRaster().canvas(size, size);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This window has no 2D canvas.");
  ctx.drawImage(
    image,
    ((quadrant % 2) * image.width) / 2,
    (Math.floor(quadrant / 2) * image.height) / 2,
    image.width / 2,
    image.height / 2,
    0,
    0,
    size,
    size,
  );
  return canvas;
}

function grid(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.font = "bold 14px system-ui";
  ctx.textBaseline = "top";
  for (let j = 1; j < 10; j++) {
    const v = j * 76.8;
    ctx.strokeStyle = "#ffffff7a";
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 7]);
    ctx.beginPath();
    ctx.moveTo(v, 0);
    ctx.lineTo(v, 768);
    ctx.moveTo(0, v);
    ctx.lineTo(768, v);
    ctx.stroke();
    ctx.fillStyle = "#1f302cdf";
    ctx.fillRect(v - 13, 0, 31, 18);
    ctx.fillRect(0, v - 8, 31, 18);
    ctx.fillStyle = "white";
    ctx.fillText((j / 10).toFixed(1), v - 10, 1);
    ctx.fillText((j / 10).toFixed(1), 3, v - 7);
  }
}

const png = (canvas: HTMLCanvasElement): Promise<Uint8Array> =>
  new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) reject(new Error("The sheet view could not be drawn."));
      else blob.arrayBuffer().then((b) => resolve(new Uint8Array(b)), reject);
    }, "image/png");
  });

export async function sheetViews(
  sheet: { readonly bytes: Uint8Array; readonly mediaType: string },
  kind: "trace" | "depth",
): Promise<{ readonly front: Uint8Array; readonly side: Uint8Array }> {
  const image = await domRaster().image(sheet.bytes, sheet.mediaType);
  const size = kind === "trace" ? 768 : 640;
  const front = guide(image, 0, size);
  const side = guide(image, 1, size);
  if (kind === "trace") {
    grid(front);
    grid(side);
  }
  return { front: await png(front), side: await png(side) };
}
