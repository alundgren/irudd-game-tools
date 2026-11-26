import * as T from "three";
import { gpuInfo, type GpuInfo } from "./gpu.js";
import {
  Stage,
  bodyViews,
  clampAngle,
  defaultAngle,
  portraitViews,
  type Angle,
  type ClipMeasure,
  type ModelInfo,
  type Surface,
  type View,
} from "./stage.js";

export interface ShotRequest {
  readonly view: View;
  readonly clip?: string | null;
  readonly time?: number;
  readonly surface?: Surface;
  readonly morph?: string | null;
  readonly angle?: Angle;
  readonly gaze?: { readonly x: number; readonly y: number };
}

export interface Shot {
  readonly view: View;
  readonly requested: View;
  readonly angle: Angle | null;
  readonly clip: string | null;
  readonly time: number;
  readonly surface: Surface;
  readonly morph: string | null;
  readonly gaze: { readonly x: number; readonly y: number };
  readonly width: number;
  readonly height: number;
  readonly png: Uint8Array;
  readonly camera: { readonly position: number[]; readonly target: number[]; readonly fov: number };
  readonly render: { readonly calls: number; readonly triangles: number };
}

export interface InspectionSheet {
  readonly model: string;
  readonly width: number;
  readonly height: number;
  readonly gpu: GpuInfo;
  readonly shots: ReadonlyArray<Shot>;
}

export const defaultShots: ReadonlyArray<ShotRequest> = bodyViews.map((view) => ({ view }));

export function reviewShots(
  info: ModelInfo | undefined,
  base: Omit<ShotRequest, "view"> = {},
): ShotRequest[] {
  const chosen: View[] = [...bodyViews, ...(info?.face ? portraitViews : [])];
  return chosen.map((view) => ({ ...base, view }));
}

export class Inspector {
  private readonly canvas: OffscreenCanvas;
  private readonly renderer: T.WebGLRenderer;
  private readonly camera = new T.PerspectiveCamera(34, 1, 0.01, 250);
  private readonly stage = new Stage();
  readonly gpu: GpuInfo;

  readonly width: number;
  readonly height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 16 || height < 16)
      throw new Error("Inspection images need integer sizes of at least 16 pixels.");
    this.canvas = new OffscreenCanvas(width, height);
    this.renderer = new T.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      preserveDrawingBuffer: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width, height, false);
    this.renderer.toneMapping = T.NeutralToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFShadowMap;
    this.camera.aspect = width / height;
    this.gpu = gpuInfo(this.renderer);
  }

  async load(bytes: Uint8Array, name: string, scene = 0): Promise<void> {
    await this.stage.load(bytes, name);
    if (scene !== (this.stage.info?.scene ?? 0) && !this.stage.showScene(scene))
      throw new Error(`The file has no scene ${scene + 1}.`);
  }

  async shoot(request: ShotRequest): Promise<Shot> {
    const stage = this.stage;
    if (!stage.loaded) throw new Error("Load a model before inspecting it.");
    const surface = request.surface ?? "source";
    const clip = request.clip ?? null;
    const time = request.time ?? 0;
    if (clip !== null && !stage.clips.some((c) => c.name === clip))
      throw new Error(`The file has no clip named ${clip}.`);
    stage.setClip(clip);
    stage.setTime(time);
    stage.setSurface(surface);
    stage.setMorph(request.morph ?? null);
    const gaze = request.gaze ?? { x: 0, y: 0 };
    stage.setGaze(gaze.x, gaze.y);
    stage.prepare(this.renderer);
    const target = new T.Vector3();
    const angle = clampAngle(request.angle ?? defaultAngle);
    const view = stage.frame(this.camera, request.view, target, angle);
    this.renderer.info.reset();
    this.renderer.render(stage.scene, this.camera);
    const render = {
      calls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
    };
    const blob = await this.canvas.convertToBlob({ type: "image/png" });
    return {
      view,
      requested: request.view,
      angle: view === "portrait-angle" ? angle : null,
      clip,
      time,
      surface,
      morph: stage.morph,
      gaze: stage.gaze,
      width: this.width,
      height: this.height,
      png: new Uint8Array(await blob.arrayBuffer()),
      camera: {
        position: this.camera.position.toArray(),
        target: target.toArray(),
        fov: this.camera.fov,
      },
      render,
    };
  }

  get info(): ModelInfo | undefined {
    return this.stage.info;
  }

  measure(): ClipMeasure[] {
    return this.stage.measureClips();
  }

  async sheet(
    bytes: Uint8Array,
    name: string,
    options: { readonly scene?: number; readonly shots?: ReadonlyArray<ShotRequest> } = {},
  ): Promise<InspectionSheet> {
    await this.load(bytes, name, options.scene ?? 0);
    const taken: Shot[] = [];
    for (const shot of options.shots ?? reviewShots(this.stage.info))
      taken.push(await this.shoot(shot));
    return { model: name, width: this.width, height: this.height, gpu: this.gpu, shots: taken };
  }

  dispose(): void {
    this.stage.forget(this.renderer);
    this.stage.dispose();
    this.renderer.dispose();
  }
}
