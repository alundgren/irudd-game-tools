// Turnaround painting. Ported from character-view/turnaround.js at 2761eb1.
//
// An atlas is a two-by-two sheet of front, right, back and left views on a
// magenta key. A painted part carries a binding: the region it was traced as,
// the standing height of the sheet, its rest offset and rest cross sections.
// Its texture is four projections of those rest sections baked into ordinary
// UVs, so the paint stays attached when the part is moved or reshaped.
// Regional visibility comes from every binding of the same sheet, including
// occluders whose parts are gone, so a view past a moved sleeve still samples
// the garment that sleeve covered in the picture.

import * as T from "three";
import type { Digest, FigurePaint, PortraitDepth } from "@irudd/document";
import type { AssetResolver } from "../assets.js";
import { context2d, type Raster, type RasterImage } from "../raster.js";
import { sweepGeometry } from "../surfaces/sweep.js";
import { portraitSurface } from "../surfaces/face.js";
import { fitDepth } from "../surfaces/portrait-depth.js";
import { panelFromPixels, type Panel } from "./panel.js";

export { panelFromPixels, type Panel } from "./panel.js";

export type Panels = readonly [Panel, Panel, Panel, Panel];

/** A rest binding with the atlas it paints from: a painted part's or an occluder's. */
export interface Binding extends FigurePaint {
  readonly atlas: Digest;
  /** The traced front's depth, which the bake's rest takes as the part does. */
  readonly depth?: PortraitDepth;
}

// Dilation supplies the nearest foreground colour outside thin silhouettes.
// It keeps the chroma key out of texture filtering at the edge of a claw.
function preparePanel(raster: Raster, image: RasterImage, tile: number): Panel {
  const size = 640;
  const canvas = raster.canvas(size, size);
  const ctx = context2d(canvas, { willReadFrequently: true });
  ctx.drawImage(
    image,
    ((tile % 2) * image.width) / 2,
    (Math.floor(tile / 2) * image.height) / 2,
    image.width / 2,
    image.height / 2,
    0,
    0,
    size,
    size,
  );
  return panelFromPixels(ctx.getImageData(0, 0, size, size).data, size);
}

/** Prepare the four views of a decoded sheet. */
export function preparePanels(raster: Raster, image: RasterImage): Panels {
  if (image.width / image.height < 0.65 || image.width / image.height > 1.5)
    throw new Error("Use a two-by-two turnaround.");
  return [
    preparePanel(raster, image, 0),
    preparePanel(raster, image, 1),
    preparePanel(raster, image, 2),
    preparePanel(raster, image, 3),
  ];
}

/** Prepared sheets by digest, with the raster used for baking. */
export interface PaintAtlases {
  readonly raster: Raster;
  readonly panels: (atlas: Digest) => Panels | undefined;
  /** Atlases a binding named that did not resolve. */
  readonly missing: ReadonlyArray<Digest>;
}

/** Resolve and prepare every atlas `digests` names. Unresolvable atlases are listed, not thrown. */
export async function loadPaintAtlases(
  raster: Raster,
  assets: AssetResolver,
  digests: Iterable<Digest>,
): Promise<PaintAtlases> {
  const prepared = new Map<Digest, Panels>();
  const missing: Digest[] = [];
  for (const digest of new Set(digests)) {
    const resolved = assets.resolve(digest);
    if (!resolved) {
      missing.push(digest);
      continue;
    }
    prepared.set(
      digest,
      preparePanels(raster, await raster.image(resolved.bytes, resolved.mediaType)),
    );
  }
  return { raster, panels: (atlas) => prepared.get(atlas), missing };
}

function projected(panel: Panel, horizontal: number, height: number): number {
  const px = Math.max(0, Math.min(panel.size - 1, Math.round(panel.mid + horizontal * panel.span)));
  const py = Math.max(0, Math.min(panel.size - 1, Math.round(panel.feet - height * panel.span)));
  return py * panel.size + px;
}

interface RegionView {
  readonly nearest: Int32Array;
  readonly xmin: number;
  readonly ymin: number;
  readonly width: number;
  readonly height: number;
}

export type RegionViews = ReadonlyArray<RegionView | null>;

// Estimate visibility in the original standing pose. A camera looking past a
// sleeve must sample the adjacent garment, even after that sleeve is moved.
function regionalViews(
  panels: Panels,
  bindings: ReadonlyArray<Binding>,
): Map<string, (RegionView | null)[]> {
  const result = new Map<string, (RegionView | null)[]>(bindings.map((b) => [b.region ?? "", []]));
  for (const [view, panel] of panels.entries()) {
    const n = panel.size;
    const profile = view % 2 === 1;
    const depth = new Float32Array(n * n).fill(-Infinity);
    const owner = new Uint16Array(n * n);
    const boxes: [number, number, number, number][] = [];
    for (const [index, binding] of bindings.entries()) {
      const rows = binding.rest.map(([x, y, z, w, d]) => [
        (x + binding.offset[0]) / binding.height,
        (y + binding.offset[1]) / binding.height,
        (z + binding.offset[2]) / binding.height,
        w / binding.height,
        d / binding.height,
      ]);
      const last = rows[rows.length - 1] ?? [];
      const first = rows[0] ?? [];
      const minY = Math.max(0, Math.floor(panel.feet - (last[1] ?? 0) * panel.span));
      const maxY = Math.min(n - 1, Math.ceil(panel.feet - (first[1] ?? 0) * panel.span));
      let minX = n - 1;
      let maxX = 0;
      for (let py = minY; py <= maxY; py++) {
        const h = (panel.feet - py) / panel.span;
        let i = 1;
        while (i < rows.length - 1 && (rows[i]?.[1] ?? 0) < h) i++;
        const a = rows[i - 1] ?? [];
        const b = rows[i] ?? [];
        const v = T.MathUtils.clamp((h - (a[1] ?? 0)) / ((b[1] ?? 0) - (a[1] ?? 0)), 0, 1);
        const sample = (j: number) => T.MathUtils.lerp(a[j] ?? 0, b[j] ?? 0, v);
        const ax = sample(0);
        const az = sample(2);
        const rw = sample(3);
        const rd = sample(4);
        const centre = [ax, -az, -ax, az][view] ?? 0;
        const toward = [az, ax, -az, -ax][view] ?? 0;
        const radius = profile ? rd : rw;
        const thickness = profile ? rw : rd;
        const left = Math.max(0, Math.floor(panel.mid + (centre - radius) * panel.span));
        const right = Math.min(n - 1, Math.ceil(panel.mid + (centre + radius) * panel.span));
        minX = Math.min(minX, left);
        maxX = Math.max(maxX, right);
        for (let px = left; px <= right; px++) {
          const u = ((px - panel.mid) / panel.span - centre) / radius;
          const z = toward + thickness * Math.sqrt(Math.max(0, 1 - u * u));
          const off = py * n + px;
          if ((depth[off] ?? 0) < z) {
            depth[off] = z;
            owner[off] = index + 1;
          }
        }
      }
      boxes.push([minX, minY, maxX, maxY]);
    }
    for (const [index, binding] of bindings.entries()) {
      const views = result.get(binding.region ?? "");
      const box = boxes[index];
      if (!views || !box) continue;
      let [xmin, ymin, xmax, ymax] = box;
      xmin = Math.max(0, xmin - 5);
      ymin = Math.max(0, ymin - 5);
      xmax = Math.min(n - 1, xmax + 5);
      ymax = Math.min(n - 1, ymax + 5);
      const width = xmax - xmin + 1;
      const height = ymax - ymin + 1;
      if (width < 1 || height < 1) {
        views.push(null);
        continue;
      }
      const nearest = new Int32Array(width * height).fill(-1);
      const queue = new Int32Array(nearest.length);
      let tail = 0;
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const i = y * width + x;
          const source = (y + ymin) * n + x + xmin;
          // Trim a few boundary pixels of other regions, which often contain
          // antialiasing or imperfectly registered fingers on a garment.
          if (owner[source] !== index + 1 || !panel.mask[source]) continue;
          if (
            [source - 2, source + 2, source - 2 * n, source + 2 * n].some(
              (j) => owner[j] && owner[j] !== index + 1,
            )
          )
            continue;
          nearest[i] = source;
          queue[tail++] = i;
        }
      if (!tail) {
        views.push(null);
        continue;
      }
      for (let i = 0; i < tail; i++) {
        const at = queue[i] ?? 0;
        const x = at % width;
        for (const next of [x ? at - 1 : -1, x < width - 1 ? at + 1 : -1, at - width, at + width]) {
          if (next < 0 || next >= nearest.length || (nearest[next] ?? 0) >= 0) continue;
          nearest[next] = nearest[at] ?? -1;
          queue[tail++] = next;
        }
      }
      views.push({ nearest, xmin, ymin, width, height });
    }
  }
  return result;
}

function unobscured(index: number, panel: Panel, region: RegionView | null | undefined): number {
  if (!region) return index;
  const x = T.MathUtils.clamp((index % panel.size) - region.xmin, 0, region.width - 1);
  const y = T.MathUtils.clamp(Math.floor(index / panel.size) - region.ymin, 0, region.height - 1);
  return region.nearest[y * region.width + x] ?? -1;
}

/**
 * Regional views of every sheet, from the sources of one document: occluders
 * first, then painted parts, one binding per atlas and region (a later source
 * replaces an earlier one), regions sorted by name within each sheet.
 */
export function paintRegions(
  atlases: PaintAtlases,
  sources: ReadonlyArray<Binding>,
): ReadonlyMap<Digest, ReadonlyMap<string, RegionViews>> {
  const groups = new Map<Digest, Map<string, Binding>>();
  for (const source of sources) {
    if (source.region === undefined || !atlases.panels(source.atlas)) continue;
    let group = groups.get(source.atlas);
    if (!group) groups.set(source.atlas, (group = new Map<string, Binding>()));
    group.set(source.region, source);
  }
  const out = new Map<Digest, ReadonlyMap<string, RegionViews>>();
  for (const [atlas, group] of groups) {
    const panels = atlases.panels(atlas);
    if (!panels) continue;
    const ordered = [...group.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([, p]) => p);
    out.set(atlas, regionalViews(panels, ordered));
  }
  return out;
}

/** Bake a binding's four projections into a UV texture of its rest sweep. */
export function bakePaint(
  atlases: PaintAtlases,
  binding: Binding,
  region: RegionViews | undefined,
): T.CanvasTexture | undefined {
  const panels = atlases.panels(binding.atlas);
  if (!panels) return undefined;
  // A traced face bakes from a denser, sculpted rest so its features land on the texture.
  const sides = binding.portrait ? 80 : 20;
  const rest = portraitSurface(
    sweepGeometry(binding.rest, binding.frame !== "path", sides),
    binding,
    binding.depth?.field,
  );
  fitDepth(rest, binding.depth?.pins, binding.height);
  const positions = rest.getAttribute("position");
  const normals = rest.getAttribute("normal");
  const columns = sides + 1;
  const bands = positions.count / columns - 1;
  const canvas = atlases.raster.canvas(binding.portrait ? 1024 : 512, binding.portrait ? 640 : 512);
  const ctx = context2d(canvas);
  const out = ctx.createImageData(canvas.width, canvas.height);
  const corners = [0, 0, 0, 0];
  const weights = [0, 0, 0, 0];
  for (let y = 0; y < canvas.height; y++) {
    const row = (1 - (y + 0.5) / canvas.height) * bands;
    const r = Math.floor(row);
    const v = row - r;
    for (let x = 0; x < canvas.width; x++) {
      const col = ((x + 0.5) / canvas.width) * (columns - 1);
      const c = Math.floor(col);
      const u = col - c;
      corners[0] = r * columns + c;
      corners[1] = corners[0] + 1;
      corners[2] = corners[0] + columns;
      corners[3] = corners[2] + 1;
      weights[0] = (1 - u) * (1 - v);
      weights[1] = u * (1 - v);
      weights[2] = (1 - u) * v;
      weights[3] = u * v;
      let px = binding.offset[0];
      let py = binding.offset[1];
      let pz = binding.offset[2];
      let nx = 0;
      let nz = 0;
      for (let i = 0; i < 4; i++) {
        const j = corners[i] ?? 0;
        const w = weights[i] ?? 0;
        px += positions.getX(j) * w;
        py += positions.getY(j) * w;
        pz += positions.getZ(j) * w;
        nx += normals.getX(j) * w;
        nz += normals.getZ(j) * w;
      }
      if (binding.portrait) {
        // Faces choose views by the column's angle, not the sculpted normal.
        const a = ((x + 0.5) / canvas.width) * 2 * Math.PI;
        nx = Math.cos(a);
        nz = -Math.sin(a);
      }
      const face = nz >= 0 ? 0 : 2;
      const side = nx >= 0 ? 1 : 3;
      const f = panels[face];
      const s = panels[side];
      const height = py / binding.height;
      const fi =
        unobscured(
          projected(f, (face === 0 ? px : -px) / binding.height, height),
          f,
          region?.[face],
        ) * 4;
      const si =
        unobscured(
          projected(s, (side === 1 ? -pz : pz) / binding.height, height),
          s,
          region?.[side],
        ) * 4;
      const fw = Math.abs(nz) ** 4;
      const sw = Math.abs(nx) ** 4 * (binding.profile ?? 1);
      const mix = sw / (fw + sw + 1e-8);
      const off = (y * canvas.width + x) * 4;
      for (let k = 0; k < 3; k++)
        out.data[off + k] = T.MathUtils.lerp(f.pixels[fi + k] ?? 0, s.pixels[si + k] ?? 0, mix);
      out.data[off + 3] = 255;
    }
  }
  rest.dispose();
  ctx.putImageData(out, 0, 0);
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/**
 * The whole sheet as one texture, its four views in a 2 × 2 grid, for painted
 * volumes. Ported from volumeMaterial in character-view/turnaround.js.
 */
export function sheetTexture(atlases: PaintAtlases, atlas: Digest): T.Texture | undefined {
  const panels = atlases.panels(atlas);
  if (!panels) return undefined;
  const n = panels[0].size;
  const canvas = atlases.raster.canvas(n * 2, n * 2);
  const ctx = context2d(canvas);
  panels.forEach((p, i) =>
    ctx.putImageData(new ImageData(p.pixels, n, n), (i % 2) * n, Math.floor(i / 2) * n),
  );
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export function volumeMaterial(texture: T.Texture, color: string): T.MeshStandardMaterial {
  return new T.MeshStandardMaterial({ map: texture, color, roughness: 0.85 });
}

/** The painted material of a part: the baked texture, dimmed, and the same texture as glow. */
export function paintedMaterial(texture: T.Texture, color: string): T.MeshStandardMaterial {
  return new T.MeshStandardMaterial({
    color: new T.Color(color).multiplyScalar(0.46),
    map: texture,
    emissive: color,
    emissiveMap: texture,
    emissiveIntensity: 0.49,
    roughness: 1,
  });
}
