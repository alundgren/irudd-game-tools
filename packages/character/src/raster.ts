// The 2D raster the textured presets paint with.
//
// Paint baking, surface swatches and the game atlas resample images with
// canvas `drawImage`, as the reference workshop does in Chromium. Those
// resamples are the browser's own (hardware accelerated where available), so
// textured output is defined by the raster a host supplies: the renderer's
// DOM canvas in the desktop app, or Chrome in the verification gate. Node has
// no raster; uniform presets need none.

export type RasterImage = HTMLImageElement | HTMLCanvasElement | ImageBitmap;

export interface Raster {
  canvas(width: number, height: number): HTMLCanvasElement;
  /** Decode an encoded image, as an `<img>` element loading it would. */
  image(bytes: Uint8Array, mediaType: string): Promise<RasterImage>;
}

/** The raster of a DOM document: canvases from `createElement`, images decoded by `<img>`. */
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

/** A texture's image when a canvas can draw it. */
export function drawable(image: unknown): RasterImage | undefined {
  return image instanceof HTMLCanvasElement ||
    image instanceof HTMLImageElement ||
    (typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap)
    ? image
    : undefined;
}
