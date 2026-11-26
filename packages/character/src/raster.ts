export type RasterImage = HTMLImageElement | HTMLCanvasElement | ImageBitmap;

export interface Raster {
  canvas(width: number, height: number): HTMLCanvasElement;
  image(bytes: Uint8Array, mediaType: string): Promise<RasterImage>;
}

export function domRaster(doc: Document = document): Raster {
  return {
    canvas(width, height) {
      const c = doc.createElement("canvas");
      c.width = width;
      c.height = height;
      return c;
    },
    image(bytes, mediaType) {
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mediaType }));
      return new Promise<RasterImage>((resolve, reject) => {
        const img = doc.createElement("img");
        img.onload = () => {
          URL.revokeObjectURL(url);
          resolve(img);
        };
        img.onerror = () => {
          URL.revokeObjectURL(url);
          reject(new Error(`Could not decode a ${mediaType} image.`));
        };
        img.src = url;
      });
    },
  };
}

export function context2d(
  canvas: HTMLCanvasElement,
  settings?: CanvasRenderingContext2DSettings,
): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d", settings);
  if (!ctx) throw new Error("This raster has no 2D context.");
  return ctx;
}

export function drawable(image: unknown): RasterImage | undefined {
  return image instanceof HTMLCanvasElement ||
    image instanceof HTMLImageElement ||
    (typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap)
    ? image
    : undefined;
}
