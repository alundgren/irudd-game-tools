import * as T from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { summarizeGlb, type GlbSummary } from "./glb.js";
import { isMesh, isSkinnedMesh, isTexture } from "./guards.js";

export const surfaces = ["source", "clay", "ink"] as const;
export type Surface = (typeof surfaces)[number];

export const bodyViews = ["threequarter", "front", "side", "back", "overhead"] as const;
export const portraitViews = [
  "portrait",
  "portrait-side",
  "portrait-oblique",
  "portrait-angle",
] as const;
export const views = [...bodyViews, ...portraitViews] as const;
export type View = (typeof views)[number];
export type PortraitView = (typeof portraitViews)[number];

const directions: Record<View, readonly [number, number, number]> = {
  threequarter: [1.85, 0.56, 3],
  front: [0, 0, 1],
  side: [1, 0, 0],
  back: [0, 0, -1],
  overhead: [0, 1, 0.001],
  portrait: [0, 0, 1],
  "portrait-side": [-1, 0, 0],
  "portrait-oblique": [-0.74, 0, 1],
  "portrait-angle": [0, 0, 1],
};

export const viewLabels: Record<View, string> = {
  threequarter: "Three-quarter",
  front: "Front",
  side: "Side",
  back: "Back",
  overhead: "Overhead",
  portrait: "Face close-up",
  "portrait-side": "Face in profile",
  "portrait-oblique": "Face at three-quarter",
  "portrait-angle": "Face at measured angles",
};

export interface Angle {
  readonly yaw: number;
  readonly pitch: number;
}

export const defaultAngle: Angle = { yaw: -30, pitch: 0 };

export function clampAngle(angle: Angle): Angle {
  const clamp = (v: number, lo: number, hi: number): number =>
    Math.min(Math.max(Number.isFinite(v) ? v : 0, lo), hi);
  return { yaw: clamp(angle.yaw, -180, 180), pitch: clamp(angle.pitch, -80, 80) };
}

export const gazeNames = ["LookLeft", "LookRight", "LookUp", "LookDown"] as const;

const isGazeName = (name: string): boolean => gazeNames.some((g) => g === name);

export function isView(value: string): value is View {
  return views.some((v) => v === value);
}

export function isPortrait(view: View): view is PortraitView {
  return portraitViews.some((v) => v === view);
}

export function isSurface(value: string): value is Surface {
  return surfaces.some((s) => s === value);
}

export interface ClipInfo {
  readonly name: string;
  readonly duration: number;
}

export interface ModelInfo {
  readonly name: string;
  readonly summary: GlbSummary;
  readonly scene: number;
  readonly heightMetres: number;
  readonly bounds: { readonly min: readonly number[]; readonly max: readonly number[] };
  readonly triangles: number;
  readonly meshes: number;
  readonly drawnMaterials: number;
  readonly skeletons: number;
  readonly morphTargets: ReadonlyArray<string>;
  readonly expressions: ReadonlyArray<string>;
  readonly gaze: boolean;
  readonly face: { readonly min: readonly number[]; readonly max: readonly number[] } | null;
  readonly clips: ReadonlyArray<ClipInfo>;
}

export interface ClipMeasure {
  readonly clip: string;
  readonly movement: number;
  readonly lowest: number;
}

function meshesOf(root: T.Object3D): T.Mesh[] {
  const found: T.Mesh[] = [];
  root.traverse((node) => {
    if (isMesh(node)) found.push(node);
  });
  return found;
}

function materialsOf(mesh: T.Mesh): T.Material[] {
  const material: T.Material | T.Material[] = mesh.material;
  return Array.isArray(material) ? material : [material];
}

function release(root: T.Object3D): void {
  const geometries = new Set<T.BufferGeometry>();
  const materials = new Set<T.Material>();
  const textures = new Set<T.Texture>();
  const skeletons = new Set<T.Skeleton>();
  root.traverse((node) => {
    if (!isMesh(node)) return;
    geometries.add(node.geometry);
    if (isSkinnedMesh(node)) skeletons.add(node.skeleton);
    for (const material of materialsOf(node)) {
      materials.add(material);
      for (const value of Object.values(material)) if (isTexture(value)) textures.add(value);
    }
  });
  for (const item of [...geometries, ...materials, ...textures, ...skeletons]) item.dispose();
  root.removeFromParent();
}

function trackNode(track: T.KeyframeTrack): string {
  return T.PropertyBinding.parseTrackName(track.name).nodeName;
}

export class Stage {
  readonly scene = new T.Scene();
  private readonly key = new T.DirectionalLight(0xfff0de, 2.65);
  private readonly keyDirection = new T.Vector3(-0.75, 1.0, 1.15).normalize();
  private readonly floor = new T.Mesh(
    new T.PlaneGeometry(1, 1),
    new T.ShadowMaterial({ opacity: 0.11, depthWrite: false }),
  );
  private readonly grid = new T.GridHelper(18, 36, 0x71857c, 0xc3ccc6);
  private readonly clay = new T.MeshStandardMaterial({ color: 0xb6bdb8, roughness: 0.9 });
  private readonly ink = new T.MeshBasicMaterial({ color: 0x203733 });
  private readonly environments = new Map<T.WebGLRenderer, T.Texture>();
  private gltf: GLTF | undefined;
  private model: T.Object3D | undefined;
  private meshes: T.Mesh[] = [];
  private readonly sourceMaterials = new Map<T.Mesh, T.Material | T.Material[]>();
  private mixer: T.AnimationMixer | undefined;
  private action: T.AnimationAction | undefined;
  private clipList: T.AnimationClip[] = [];
  private rest: Float32Array[] = [];
  private surface: Surface = "source";
  private generation = 0;
  private expression: string | null = null;
  private look = { x: 0, y: 0 };
  private held = false;
  readonly bounds = new T.Box3();
  readonly faceBounds = new T.Box3();
  info: ModelInfo | undefined;

  constructor() {
    this.scene.background = new T.Color(0xe8eae6);
    this.scene.environmentIntensity = 0.42;
    this.scene.add(new T.HemisphereLight(0xf4f6ff, 0xae9f93, 0.76));
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.bias = -0.00015;
    this.scene.add(this.key, this.key.target);
    const fill = new T.DirectionalLight(0xc8dcff, 1.35);
    fill.position.set(3, 3, -4);
    this.scene.add(fill);
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.receiveShadow = true;
    this.scene.add(this.floor, this.grid);
  }

  prepare(renderer: T.WebGLRenderer): void {
    let texture = this.environments.get(renderer);
    if (!texture) {
      const room = new RoomEnvironment();
      const pmrem = new T.PMREMGenerator(renderer);
      texture = pmrem.fromScene(room, 0.04).texture;
      room.dispose();
      pmrem.dispose();
      this.environments.set(renderer, texture);
    }
    this.scene.environment = texture;
  }

  forget(renderer: T.WebGLRenderer): void {
    this.environments.get(renderer)?.dispose();
    this.environments.delete(renderer);
  }

  get loaded(): boolean {
    return this.model !== undefined;
  }

  get clips(): ReadonlyArray<ClipInfo> {
    return this.clipList.map((c) => ({ name: c.name, duration: c.duration }));
  }

  get clip(): string | null {
    return this.action?.getClip().name ?? null;
  }

  get time(): number {
    const action = this.action;
    if (!action) return 0;
    const duration = action.getClip().duration;
    return duration > 0 ? action.time / duration : 0;
  }

  async load(bytes: Uint8Array, name: string): Promise<ModelInfo> {
    const ticket = ++this.generation;
    const summary = summarizeGlb(bytes);
    const unsupported = summary.extensionsRequired.filter(
      (e) =>
        e !== "EXT_meshopt_compression" &&
        e !== "KHR_mesh_quantization" &&
        e !== "KHR_texture_transform" &&
        e !== "KHR_materials_emissive_strength",
    );
    if (unsupported.length)
      throw new Error(`This GLB requires extensions the player lacks: ${unsupported.join(", ")}.`);
    const copy = bytes.slice();
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.parseAsync(copy.buffer, "");
    if (ticket !== this.generation) {
      for (const scene of gltf.scenes) release(scene);
      throw new Error("A newer file replaced this one while it loaded.");
    }
    this.clear();
    this.gltf = gltf;
    this.expression = null;
    this.look = { x: 0, y: 0 };
    this.held = false;
    const index = Math.max(0, gltf.scenes.indexOf(gltf.scene));
    return this.show(index, name, summary);
  }

  showScene(index: number): ModelInfo | undefined {
    const gltf = this.gltf;
    const info = this.info;
    if (!gltf || !info || !gltf.scenes[index]) return undefined;
    const clip = this.clip;
    const phase = this.time;
    const expression = this.expression;
    this.detach();
    const shown = this.show(index, info.name, info.summary);
    this.expression =
      expression !== null && shown.expressions.includes(expression) ? expression : null;
    if (clip !== null && shown.clips.some((c) => c.name === clip)) {
      this.setClip(clip);
      this.setTime(phase);
    } else this.settle();
    return shown;
  }

  private show(index: number, name: string, summary: GlbSummary): ModelInfo {
    const gltf = this.gltf;
    const model = gltf?.scenes[index];
    if (!gltf || !model) throw new Error("The file has no scene to show.");
    this.model = model;
    this.scene.add(model);
    this.meshes = meshesOf(model);
    if (!this.meshes.length) {
      this.detach();
      throw new Error("This file contains no mesh.");
    }
    for (const mesh of this.meshes) {
      this.sourceMaterials.set(mesh, mesh.material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
    const names = new Set<string>();
    model.traverse((node) => names.add(node.name));
    this.clipList =
      gltf.scenes.length === 1
        ? [...gltf.animations]
        : gltf.animations.filter((clip) => clip.tracks.every((t) => names.has(trackNode(t))));
    this.mixer = new T.AnimationMixer(model);
    this.action = undefined;
    const restPose = this.pose();
    this.rest = restPose.vertices;
    this.bounds.copy(restPose.box);
    this.faceBounds.makeEmpty();
    const point = new T.Vector3();
    this.meshes.forEach((mesh, m) => {
      const vertices = restPose.vertices[m];
      if (!mesh.userData["faceSurface"] || !vertices) return;
      for (let i = 0; i < vertices.length; i += 3)
        this.faceBounds.expandByPoint(point.fromArray(vertices, i));
    });
    this.placeLights();
    const size = this.bounds.getSize(new T.Vector3());
    const triangles = this.meshes.reduce(
      (n, m) => n + (m.geometry.index?.count ?? m.geometry.getAttribute("position").count) / 3,
      0,
    );
    const skeletons = new Set(
      this.meshes.flatMap((m) =>
        isSkinnedMesh(m) && m.skeleton.bones[0] ? [m.skeleton.bones[0]] : [],
      ),
    );
    const morphs = new Set(this.meshes.flatMap((m) => Object.keys(m.morphTargetDictionary ?? {})));
    this.info = {
      name,
      summary,
      scene: index,
      heightMetres: size.y,
      bounds: { min: this.bounds.min.toArray(), max: this.bounds.max.toArray() },
      triangles,
      meshes: this.meshes.length,
      drawnMaterials: new Set(this.meshes.flatMap(materialsOf)).size,
      skeletons: skeletons.size,
      morphTargets: [...morphs],
      expressions: [...morphs].filter((k) => !isGazeName(k)),
      gaze: morphs.has("LookLeft"),
      face: this.faceBounds.isEmpty()
        ? null
        : { min: this.faceBounds.min.toArray(), max: this.faceBounds.max.toArray() },
      clips: this.clips,
    };
    this.setSurface(this.surface);
    return this.info;
  }

  private detach(): void {
    this.mixer?.stopAllAction();
    if (this.model) this.mixer?.uncacheRoot(this.model);
    this.writeExpression(null);
    this.writeGaze(0, 0);
    for (const [mesh, material] of this.sourceMaterials) mesh.material = material;
    this.sourceMaterials.clear();
    this.model?.removeFromParent();
    this.model = undefined;
    this.meshes = [];
    this.mixer = undefined;
    this.action = undefined;
    this.clipList = [];
    this.rest = [];
    this.bounds.makeEmpty();
    this.faceBounds.makeEmpty();
    this.info = undefined;
  }

  clear(): void {
    this.detach();
    for (const scene of this.gltf?.scenes ?? []) release(scene);
    this.gltf = undefined;
  }

  private placeLights(): void {
    const size = this.bounds.getSize(new T.Vector3());
    const radius = Math.max(size.length() * 0.61, 0.01);
    const centre = this.bounds.getCenter(new T.Vector3());
    this.key.target.position.copy(centre);
    this.key.position.copy(centre).addScaledVector(this.keyDirection, 3 * radius);
    const shadow = this.key.shadow.camera;
    shadow.left = -radius;
    shadow.right = radius;
    shadow.top = radius;
    shadow.bottom = -radius;
    shadow.near = radius * 0.5;
    shadow.far = radius * 5;
    shadow.updateProjectionMatrix();
    this.key.shadow.normalBias = radius * 0.0008;
    this.floor.scale.setScalar(radius * 8);
    this.floor.position.set(centre.x, this.bounds.min.y - 0.001 * radius, centre.z);
  }

  private pose(): { box: T.Box3; vertices: Float32Array[] } {
    this.model?.updateMatrixWorld(true);
    const box = new T.Box3();
    const point = new T.Vector3();
    const vertices: Float32Array[] = [];
    for (const mesh of this.meshes) {
      if (isSkinnedMesh(mesh)) mesh.skeleton.update();
      const count = mesh.geometry.getAttribute("position").count;
      const values = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        mesh.getVertexPosition(i, point).applyMatrix4(mesh.matrixWorld);
        box.expandByPoint(point);
        point.toArray(values, i * 3);
      }
      vertices.push(values);
    }
    return { box, vertices };
  }

  setSurface(surface: Surface): void {
    this.surface = surface;
    for (const mesh of this.meshes) {
      const source = this.sourceMaterials.get(mesh);
      if (!source) continue;
      const replacement = surface === "clay" ? this.clay : surface === "ink" ? this.ink : null;
      mesh.material = replacement
        ? Array.isArray(source)
          ? source.map(() => replacement)
          : replacement
        : source;
    }
  }

  setClip(name: string | null): void {
    const mixer = this.mixer;
    if (!mixer) return;
    mixer.stopAllAction();
    this.action = undefined;
    if (this.held) this.writeGaze(0, 0);
    const clip = name === null ? undefined : this.clipList.find((c) => c.name === name);
    if (clip) this.action = mixer.clipAction(clip).reset().play();
    mixer.update(0);
    this.settle();
  }

  setTime(fraction: number): void {
    const action = this.action;
    if (!action || !this.mixer) return;
    action.time = Math.min(Math.max(fraction, 0), 1) * action.getClip().duration;
    this.mixer.update(0);
    this.settle();
  }

  advance(seconds: number): void {
    if (!this.action) return;
    this.mixer?.update(seconds);
    this.settle();
  }

  get morph(): string | null {
    return this.expression;
  }

  setMorph(name: string | null): void {
    this.expression = name !== null && this.info?.expressions.includes(name) ? name : null;
    this.writeExpression(this.expression);
  }

  get gaze(): { readonly x: number; readonly y: number } {
    return { ...this.look };
  }

  setGaze(x: number, y: number): void {
    const clamp = (v: number): number => Math.min(Math.max(Number.isFinite(v) ? v : 0, -1), 1);
    this.look = { x: clamp(x), y: clamp(y) };
    if (this.look.x || this.look.y) {
      this.held = true;
      this.writeGaze(this.look.x, this.look.y);
    } else if (this.held) this.releaseGaze();
  }

  private releaseGaze(): void {
    this.held = false;
    const action = this.action;
    const time = action?.time ?? 0;
    action?.stop();
    this.writeGaze(0, 0);
    if (action && this.mixer) {
      action.play().time = time;
      this.mixer.update(0);
      this.writeExpression(this.expression);
    }
  }

  private settle(): void {
    if (this.expression !== null) this.writeExpression(this.expression);
    if (this.held) this.writeGaze(this.look.x, this.look.y);
  }

  private writeExpression(name: string | null): void {
    for (const mesh of this.meshes) {
      const dictionary = mesh.morphTargetDictionary;
      const influences = mesh.morphTargetInfluences;
      if (!dictionary || !influences) continue;
      for (const [key, id] of Object.entries(dictionary))
        if (!isGazeName(key)) influences[id] = key === name ? 1 : 0;
    }
  }

  private writeGaze(x: number, y: number): void {
    const values = [Math.max(0, x), Math.max(0, -x), Math.max(0, y), Math.max(0, -y)];
    this.model?.traverse((node) => {
      if (!isMesh(node)) return;
      const dictionary = node.morphTargetDictionary;
      const influences = node.morphTargetInfluences;
      if (!dictionary || !influences) return;
      gazeNames.forEach((name, i) => {
        const id = dictionary[name];
        if (id !== undefined) influences[id] = Math.min(1, values[i] ?? 0);
      });
    });
  }

  frame(
    camera: T.PerspectiveCamera,
    view: View,
    target?: T.Vector3,
    angle: Angle = defaultAngle,
  ): View {
    const portrait = isPortrait(view);
    if (portrait && this.faceBounds.isEmpty()) return this.frame(camera, "threequarter", target);
    const bounds = portrait
      ? this.faceBounds
      : this.bounds.isEmpty()
        ? new T.Box3(new T.Vector3(-0.5, 0, -0.5), new T.Vector3(0.5, 1.4, 0.5))
        : this.bounds;
    const centre = bounds.getCenter(new T.Vector3());
    const size = bounds.getSize(new T.Vector3());
    const aim = new T.Vector3(...directions[view]);
    if (view === "portrait-angle") {
      const { yaw, pitch } = clampAngle(angle);
      aim.setFromSphericalCoords(1, T.MathUtils.degToRad(90 - pitch), T.MathUtils.degToRad(yaw));
    }
    aim.normalize();
    const fit = Math.max(size.x, size.y, size.z) * 2.55;
    camera.position.copy(centre).addScaledVector(aim, Math.max(fit, 0.05));
    const legacy = fit >= 0.05 && fit <= 50;
    camera.near = legacy ? 0.01 : Math.max(fit / 500, 1e-4);
    camera.far = legacy ? 250 : Math.max(fit * 50, 10);
    camera.lookAt(centre);
    camera.updateProjectionMatrix();
    target?.copy(centre);
    return view;
  }

  measureClips(): ClipMeasure[] {
    const previous = this.clip;
    const time = this.time;
    const results: ClipMeasure[] = [];
    const mixer = this.mixer;
    for (const clip of this.clipList) {
      if (!mixer) break;
      this.setClip(clip.name);
      const action = this.action;
      let lowest = Infinity;
      let peak = 0;
      for (let i = 0; i < 8; i++) {
        if (action) action.time = (clip.duration * i) / 8;
        mixer.update(0);
        const { box, vertices } = this.pose();
        lowest = Math.min(lowest, box.min.y);
        vertices.forEach((values, m) => {
          const rest = this.rest[m];
          if (!rest) return;
          for (let k = 0; k < values.length; k += 3) {
            const dx = (values[k] ?? 0) - (rest[k] ?? 0);
            const dy = (values[k + 1] ?? 0) - (rest[k + 1] ?? 0);
            const dz = (values[k + 2] ?? 0) - (rest[k + 2] ?? 0);
            peak = Math.max(peak, dx * dx + dy * dy + dz * dz);
          }
        });
      }
      results.push({ clip: clip.name, movement: Math.sqrt(peak), lowest });
    }
    this.setClip(previous);
    this.setTime(time);
    return results;
  }

  dispose(): void {
    this.clear();
    for (const texture of this.environments.values()) texture.dispose();
    this.environments.clear();
    this.floor.geometry.dispose();
    for (const material of materialsOf(this.floor)) material.dispose();
    this.grid.dispose();
    this.clay.dispose();
    this.ink.dispose();
  }
}
