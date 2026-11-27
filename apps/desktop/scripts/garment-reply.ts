import type { Page } from "@playwright/test";
export async function garmentReply(page: Page, jacket: Buffer, open: boolean) {
  const data = await page.evaluate(
    async ({ base64, open }) => {
      const image = await createImageBitmap(
        new Blob([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))]),
      );
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1024;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Cannot isolate the garment");
      ctx.fillStyle = "#ff00ff";
      ctx.fillRect(0, 0, 1024, 1024);
      const paths = [
        [
          [80, 52],
          [97, 42],
          [111, 51],
          [130, 52],
          [143, 43],
          [160, 53],
          [157, 83],
          [168, 132],
          [159, 143],
          [81, 143],
          [76, 131],
          [83, 84],
        ],
        [
          [93, 47],
          [105, 39],
          [134, 41],
          [147, 52],
          [151, 83],
          [153, 135],
          [88, 141],
          [79, 125],
          [82, 93],
        ],
        [
          [82, 54],
          [100, 40],
          [141, 40],
          [159, 54],
          [158, 79],
          [165, 128],
          [161, 141],
          [80, 138],
          [79, 110],
          [84, 76],
        ],
        [
          [93, 49],
          [111, 40],
          [134, 41],
          [149, 53],
          [151, 85],
          [161, 127],
          [148, 143],
          [86, 137],
          [86, 90],
        ],
      ];
      for (const [i, points] of paths.entries()) {
        const size = image.width / 2;
        const x = i % 2,
          y = Math.floor(i / 2);
        ctx.save();
        ctx.translate(x * 512 + 256, y * 512 + 256);
        ctx.scale(4, 4);
        ctx.translate(-120, -91);
        ctx.beginPath();
        for (const [j, point] of points.entries()) {
          const [u = 0, v = 0] = point;
          if (j) ctx.lineTo(u, v);
          else ctx.moveTo(u, v);
        }
        ctx.closePath();
        ctx.clip();
        ctx.drawImage(image, x * size, y * size, size, size, 0, 0, 240, 240);
        if (open && i === 0) {
          ctx.fillStyle = "#ff00ff";
          ctx.beginPath();
          ctx.moveTo(112, 42);
          ctx.lineTo(138, 42);
          ctx.lineTo(145, 144);
          ctx.lineTo(99, 144);
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
      }
      image.close();
      return canvas.toDataURL("image/webp", 0.98).split(",")[1] ?? "";
    },
    { base64: jacket.toString("base64"), open },
  );
  return Buffer.from(data, "base64");
}
