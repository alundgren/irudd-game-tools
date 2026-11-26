import * as T from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { gpuInfo, type GpuInfo } from "./gpu.js";
import { isMesh, isSkinnedMesh } from "./guards.js";
import {
  Stage,
  defaultAngle,
  type Angle,
  type ModelInfo,
  type Surface,
  type View,
} from "./stage.js";

export interface PlayerState {
  readonly info: ModelInfo | undefined;
  readonly clip: string | null;
  readonly time: number;
  readonly playing: boolean;
  readonly view: View | null;
  readonly angle: Angle;
  readonly gaze: { readonly x: number; readonly y: number };
  readonly morph: string | null;
}

export interface Pick {
  readonly node: string;
  readonly partId: string | undefined;
  readonly point: readonly [number, number, number];
}

export class Player {
  readonly stage = new Stage();
  readonly canvas: HTMLCanvasElement;
  readonly gpu: GpuInfo;
  private readonly renderer: T.WebGLRenderer;
  private readonly camera = new T.PerspectiveCamera(34, 1, 0.01, 250);
  private readonly orbit: OrbitControls;
  private readonly observer: ResizeObserver;
  private pending: number | null = null;
  private previous: number | null = null;
  private playing = true;
  private framed: View | null = "threequarter";
  private angle: Angle = defaultAngle;
  private listeners = new Set<(state: PlayerState) => void>();

  private readonly host: HTMLElement;

  constructor(host: HTMLElement) {
    this.host = host;
    this.renderer = new T.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(globalThis.devicePixelRatio || 1);
    this.renderer.toneMapping = T.NeutralToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFShadowMap;
    this.canvas = this.renderer.domElement;
    this.canvas.style.display = "block";
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    host.append(this.canvas);
    this.gpu = gpuInfo(this.renderer);
    this.orbit = new OrbitControls(this.camera, this.canvas);
    this.orbit.enableDamping = true;
    this.orbit.addEventListener("change", () => this.request());
    this.orbit.addEventListener("start", () => {
      this.framed = null;
      this.emit();
    });
    this.camera.position.set(2, 1.5, 3);
    this.orbit.target.set(0, 0.7, 0);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.resize();
  }

  get state(): PlayerState {
    return {
      info: this.stage.info,
      clip: this.stage.clip,
      time: this.stage.time,
      playing: this.playing,
      view: this.framed,
      angle: this.angle,
      gaze: this.stage.gaze,
      morph: this.stage.morph,
    };
  }

  subscribe(listener: (state: PlayerState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    const state = this.state;
    for (const listener of this.listeners) listener(state);
  }

  async load(bytes: Uint8Array, name: string): Promise<ModelInfo> {
    const info = await this.stage.load(bytes, name);
    this.view(this.framed ?? "threequarter");
    const first = info.clips[0];
    this.stage.setClip(first ? first.name : null);
    this.emit();
    this.request();
    return info;
  }

  clear(): void {
    this.stage.clear();
    this.emit();
    this.request();
  }

  showScene(index: number): void {
    this.stage.showScene(index);
    this.emit();
    this.request();
  }

  setClip(name: string | null): void {
    this.stage.setClip(name);
    this.emit();
    this.request();
  }

  setPlaying(playing: boolean): void {
    this.playing = playing;
    this.emit();
    this.request();
  }

  setTime(fraction: number): void {
    this.playing = false;
    this.stage.setTime(fraction);
    this.emit();
    this.request();
  }

  setSurface(surface: Surface): void {
    this.stage.setSurface(surface);
    this.request();
  }

  setMorph(name: string | null): void {
    this.stage.setMorph(name);
    this.emit();
    this.request();
  }

  setGaze(x: number, y: number): void {
    this.stage.setGaze(x, y);
    this.emit();
    this.request();
  }

  view(view: View, angle: Angle = this.angle): void {
    this.angle = angle;
    this.framed = this.stage.frame(this.camera, view, this.orbit.target, angle);
    this.orbit.update();
    this.emit();
    this.request();
  }

  pick(x: number, y: number): Pick | undefined {
    const rect = this.canvas.getBoundingClientRect();
    const ray = new T.Raycaster();
    ray.setFromCamera(
      new T.Vector2(((x - rect.left) * 2) / rect.width - 1, 1 - ((y - rect.top) * 2) / rect.height),
      this.camera,
    );
    const meshes: T.Mesh[] = [];
    this.stage.scene.traverse((node) => {
      if (isMesh(node) && node.visible) {
        if (isSkinnedMesh(node)) node.computeBoundingSphere();
        meshes.push(node);
      }
    });
    const hit = ray.intersectObjects(meshes, false)[0];
    if (!hit) return undefined;
    let node: T.Object3D | null = hit.object;
    let partId: string | undefined;
    while (node && partId === undefined) {
      const value: unknown = node.userData["partId"];
      if (typeof value === "string") partId = value;
      node = node.parent;
    }
    return { node: hit.object.name, partId, point: [hit.point.x, hit.point.y, hit.point.z] };
  }

  private resize(): void {
    const rect = this.host.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    this.renderer.setPixelRatio(globalThis.devicePixelRatio || 1);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.request();
  }

  get drawingSize(): { width: number; height: number } {
    return { width: this.canvas.width, height: this.canvas.height };
  }

  request(): void {
    if (this.pending === null) this.pending = requestAnimationFrame((t) => this.draw(t));
  }

  private draw(t: number): void {
    this.pending = null;
    const animating = this.playing && this.stage.clip !== null;
    if (animating) {
      this.stage.advance(this.previous === null ? 0 : Math.min((t - this.previous) / 1000, 0.08));
      this.emit();
    }
    this.previous = animating ? t : null;
    const moved = this.orbit.update();
    this.stage.prepare(this.renderer);
    this.renderer.render(this.stage.scene, this.camera);
    if (animating || moved) this.request();
  }

  dispose(): void {
    if (this.pending !== null) cancelAnimationFrame(this.pending);
    this.observer.disconnect();
    this.orbit.dispose();
    this.stage.forget(this.renderer);
    this.stage.dispose();
    this.renderer.dispose();
    this.canvas.remove();
    this.listeners.clear();
  }
}
