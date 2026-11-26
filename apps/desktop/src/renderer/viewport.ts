// The person's viewport: the built character at full resolution, orbit,
// picking and transform gizmos.
//
// The viewport renders only for the person. It never waits on or draws for
// an agent, and inspection images come from the player's own renderer. A
// drag previews on the built scene; the gesture is turned into one
// `part.transform` op when the drag ends, and the scene is rebuilt from the
// committed document (or restored if the commit is refused).

import * as T from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import {
  buildCharacter,
  type BuildOptions,
  type BuiltCharacter,
  type MaterialSource,
} from "@irudd/character";
import type { HumanBody } from "@irudd/character/human";
import {
  worldDeltaInParent,
  type CharacterDocument,
  type Finish,
  type Registry,
} from "@irudd/document";

export const tools = ["select", "translate", "rotate", "scale"] as const;
export type Tool = (typeof tools)[number];

export type Transform =
  | { readonly kind: "translate"; readonly translate: [number, number, number] }
  | { readonly kind: "rotate"; readonly rotate: [number, number, number, number] }
  | { readonly kind: "scale"; readonly scale: [number, number, number] };

export interface ViewportEvents {
  /** The person clicked a part, or empty space (null). */
  readonly onPick: (partId: string | null) => void;
  /** A drag on the gizmo began on this part. The page pins the document and revision it edits. */
  readonly onDragStart: (partId: string) => void;
  /** The drag ended: with the change it made, or undefined when nothing moved. */
  readonly onDragEnd: (partId: string, transform: Transform | undefined) => void;
}

const roughness: Record<Finish, number> = {
  plain: 0.82,
  canvas: 0.92,
  satin: 0.45,
  leather: 0.6,
  metal: 0.35,
  scales: 0.7,
  horn: 0.55,
  fur: 0.95,
  jacket: 0.88,
};
const metalness: Partial<Record<Finish, number>> = { metal: 0.85 };

/** Viewport materials: the part colour with a roughness per finish. Not an export preset. */
function viewportMaterials(): { source: MaterialSource; dispose(): void } {
  const cache = new Map<string, T.MeshStandardMaterial>();
  return {
    source(color, finish) {
      const key = `${color}|${finish}`;
      let material = cache.get(key);
      if (!material) {
        material = new T.MeshStandardMaterial({
          color,
          roughness: roughness[finish],
          metalness: metalness[finish] ?? 0,
        });
        cache.set(key, material);
      }
      return material;
    },
    dispose() {
      for (const material of cache.values()) material.dispose();
      cache.clear();
    },
  };
}

function isMesh(object: T.Object3D): object is T.Mesh {
  return object instanceof T.Mesh;
}

const clampScale = (value: number): number => Math.min(Math.max(value, 0.01), 100);

export class EditorViewport {
  readonly renderer: T.WebGLRenderer;
  private readonly scene = new T.Scene();
  private readonly camera = new T.PerspectiveCamera(34, 1, 0.01, 500);
  private readonly orbit: OrbitControls;
  private readonly gizmo: TransformControls;
  private readonly highlight = new T.BoxHelper(new T.Object3D(), 0xe2a447);
  private readonly observer: ResizeObserver;
  private materials = viewportMaterials();
  private built: BuiltCharacter | undefined;
  private doc: CharacterDocument | undefined;
  private registry: Registry | undefined;
  private selected: string | null = null;
  private tool: Tool = "select";
  private pending: number | null = null;
  private dragStart:
    | { position: T.Vector3; quaternion: T.Quaternion; scale: T.Vector3; part: string }
    | undefined;
  private framed = false;
  private readonly host: HTMLElement;
  private readonly events: ViewportEvents;

  constructor(host: HTMLElement, events: ViewportEvents) {
    this.host = host;
    this.events = events;
    this.renderer = new T.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(globalThis.devicePixelRatio || 1);
    this.renderer.toneMapping = T.NeutralToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFShadowMap;
    const canvas = this.renderer.domElement;
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    host.append(canvas);

    this.scene.background = new T.Color(0x30383a);
    const room = new RoomEnvironment();
    const pmrem = new T.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(room, 0.04).texture;
    this.scene.environmentIntensity = 0.45;
    room.dispose();
    pmrem.dispose();
    this.scene.add(new T.HemisphereLight(0xf4f6ff, 0x6f6258, 0.8));
    const key = new T.DirectionalLight(0xfff0de, 2.4);
    key.position.set(-2.2, 4, 3.2);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0002;
    Object.assign(key.shadow.camera, {
      left: -3,
      right: 3,
      top: 3,
      bottom: -3,
      near: 0.5,
      far: 12,
    });
    this.scene.add(key);
    const fill = new T.DirectionalLight(0xc8dcff, 1.2);
    fill.position.set(3, 2.5, -4);
    this.scene.add(fill);
    const floor = new T.Mesh(
      new T.PlaneGeometry(40, 40),
      new T.ShadowMaterial({ opacity: 0.25, depthWrite: false }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor, new T.GridHelper(20, 40, 0x6b7b75, 0x434d4a));
    this.highlight.visible = false;
    this.scene.add(this.highlight);

    this.orbit = new OrbitControls(this.camera, canvas);
    this.orbit.enableDamping = true;
    this.orbit.addEventListener("change", () => this.request());
    this.camera.position.set(2.4, 1.6, 3.2);
    this.orbit.target.set(0, 0.7, 0);

    this.gizmo = new TransformControls(this.camera, canvas);
    this.gizmo.setSize(0.9);
    this.gizmo.addEventListener("change", () => this.request());
    this.gizmo.addEventListener("objectChange", () => this.highlight.update());
    this.gizmo.addEventListener("dragging-changed", (event) => {
      const dragging = event.value === true;
      this.orbit.enabled = !dragging;
      if (dragging) this.beginDrag();
      else this.endDrag();
    });
    this.scene.add(this.gizmo.getHelper());

    let pressed: [number, number] | undefined;
    canvas.addEventListener("pointerdown", (e) => {
      pressed = [e.clientX, e.clientY];
    });
    canvas.addEventListener("pointerup", (e) => {
      const start = pressed;
      pressed = undefined;
      if (!start || this.gizmo.dragging) return;
      if (Math.hypot(e.clientX - start[0], e.clientY - start[1]) > 4) return;
      this.events.onPick(this.pick(e.clientX, e.clientY));
    });

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.resize();
  }

  /** Whether a gizmo drag is in progress. */
  get dragging(): boolean {
    return this.dragStart !== undefined;
  }

  /**
   * Abandon the drag in progress: nothing is reported when the pointer is
   * released, and the next `show` puts the part back where the document has
   * it. Returns whether a drag was cancelled.
   */
  cancelDrag(): boolean {
    if (!this.dragStart) return false;
    this.dragStart = undefined;
    // A detached gizmo ignores the rest of the held pointer; its release re-enables the orbit.
    this.gizmo.detach();
    this.request();
    return true;
  }

  /** Rebuild from a document. Keeps the camera and, if the part still exists, the selection. */
  /** The adult's body pack, once the window has read it; adults build only with it. */
  human: HumanBody | undefined;

  show(
    doc: CharacterDocument | undefined,
    registry: Registry,
    finish?: BuildOptions["finish"],
    humanPaint?: BuildOptions["humanPaint"],
  ): void {
    // A rebuild ends any drag: its object is about to be replaced.
    this.dragStart = undefined;
    this.gizmo.detach();
    if (this.built) {
      this.built.group.removeFromParent();
      this.built.dispose();
      this.built = undefined;
    }
    this.materials.dispose();
    this.materials = viewportMaterials();
    this.doc = doc;
    this.registry = registry;
    if (doc) {
      this.built = buildCharacter(doc, {
        materials: this.materials.source,
        human: this.human,
        humanPaint,
        ...(finish ? { finish } : {}),
      });
      this.built.group.traverse((node) => {
        if (isMesh(node)) node.castShadow = true;
      });
      this.scene.add(this.built.group);
      if (!this.framed) {
        this.frame();
        this.framed = true;
      }
    }
    this.select(this.selected && this.built?.parts.has(this.selected) ? this.selected : null);
    this.request();
  }

  shows(doc: CharacterDocument): boolean {
    return this.doc === doc && this.built !== undefined;
  }

  get selection(): string | null {
    return this.selected;
  }

  select(partId: string | null): void {
    this.selected = partId;
    const part = partId === null ? undefined : this.built?.parts.get(partId);
    if (part) {
      this.highlight.setFromObject(part.object);
      this.highlight.visible = true;
    } else {
      this.highlight.visible = false;
    }
    this.attachGizmo();
    this.request();
  }

  setTool(tool: Tool): void {
    this.tool = tool;
    this.attachGizmo();
    this.request();
  }

  private attachGizmo(): void {
    const part = this.selected === null ? undefined : this.built?.parts.get(this.selected);
    if (!part || this.tool === "select") {
      this.gizmo.detach();
      return;
    }
    this.gizmo.setMode(this.tool);
    this.gizmo.setSpace(this.tool === "translate" ? "world" : "local");
    this.gizmo.attach(part.object);
  }

  /** Aim at the whole character. */
  frame(): void {
    const box = new T.Box3();
    if (this.built) box.setFromObject(this.built.group);
    if (box.isEmpty()) box.set(new T.Vector3(-0.5, 0, -0.5), new T.Vector3(0.5, 1.4, 0.5));
    const centre = box.getCenter(new T.Vector3());
    const size = box.getSize(new T.Vector3()).length();
    this.orbit.target.copy(centre);
    this.camera.position
      .copy(centre)
      .add(new T.Vector3(0.62, 0.35, 1).normalize().multiplyScalar(size * 1.6));
    this.camera.near = Math.max(size / 500, 0.001);
    this.camera.far = Math.max(size * 60, 10);
    this.camera.updateProjectionMatrix();
    this.orbit.update();
    this.request();
  }

  private pick(x: number, y: number): string | null {
    if (!this.built) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ray = new T.Raycaster();
    ray.setFromCamera(
      new T.Vector2(((x - rect.left) * 2) / rect.width - 1, 1 - ((y - rect.top) * 2) / rect.height),
      this.camera,
    );
    const meshes: T.Mesh[] = [];
    this.built.group.traverse((node) => {
      if (isMesh(node) && node.visible) meshes.push(node);
    });
    for (const hit of ray.intersectObjects(meshes, false)) {
      let node: T.Object3D | null = hit.object;
      while (node) {
        const id: unknown = node.userData["partId"];
        if (typeof id === "string") return id;
        node = node.parent;
      }
    }
    return null;
  }

  private beginDrag(): void {
    const object = this.gizmo.object;
    if (!object || this.selected === null) return;
    object.updateWorldMatrix(true, false);
    this.dragStart = {
      position: object.getWorldPosition(new T.Vector3()),
      quaternion: object.quaternion.clone(),
      scale: object.scale.clone(),
      part: this.selected,
    };
    this.events.onDragStart(this.selected);
  }

  private endDrag(): void {
    const start = this.dragStart;
    this.dragStart = undefined;
    const object = this.gizmo.object;
    if (!start || !object || !this.doc) return;
    object.updateWorldMatrix(true, false);
    this.events.onDragEnd(start.part, this.transformOf(start, object));
  }

  private transformOf(
    start: { position: T.Vector3; quaternion: T.Quaternion; scale: T.Vector3; part: string },
    object: T.Object3D,
  ): Transform | undefined {
    const doc = this.doc;
    if (!doc) return undefined;
    switch (this.tool) {
      case "translate": {
        const delta = object.getWorldPosition(new T.Vector3()).sub(start.position);
        if (delta.length() < 1e-6) return undefined;
        const local = worldDeltaInParent(
          doc,
          start.part,
          [delta.x, delta.y, delta.z],
          this.registry,
        );
        return local ? { kind: "translate", translate: [local[0], local[1], local[2]] } : undefined;
      }
      case "rotate": {
        const r = start.quaternion.clone().invert().multiply(object.quaternion).normalize();
        if (Math.abs(r.w) > 1 - 1e-9) return undefined;
        return { kind: "rotate", rotate: [r.x, r.y, r.z, r.w] };
      }
      case "scale": {
        const s: [number, number, number] = [
          clampScale(object.scale.x / start.scale.x),
          clampScale(object.scale.y / start.scale.y),
          clampScale(object.scale.z / start.scale.z),
        ];
        if (s.every((v) => Math.abs(v - 1) < 1e-6)) return undefined;
        return { kind: "scale", scale: s };
      }
      case "select":
        return undefined;
    }
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

  /** Drawing-buffer size in device pixels and the CSS size it fills. */
  get resolution(): { width: number; height: number; cssWidth: number; cssHeight: number } {
    const canvas = this.renderer.domElement;
    return {
      width: canvas.width,
      height: canvas.height,
      cssWidth: canvas.clientWidth,
      cssHeight: canvas.clientHeight,
    };
  }

  /**
   * The view as a PNG, drawn now so the drawing buffer still holds it. `front`,
   * `side` and `back` square the camera to that side of the character at the
   * current distance; the selection box and gizmo are left out.
   */
  capture(view: "current" | "front" | "side" | "back", frameHead: boolean): Promise<Uint8Array> {
    let camera: T.Camera = this.camera;
    if (view !== "current") {
      const along = {
        front: new T.Vector3(0, 0, 1),
        side: new T.Vector3(1, 0, 0),
        back: new T.Vector3(0, 0, -1),
      }[view];
      const target = this.orbit.target.clone();
      let distance = this.camera.position.distanceTo(target);
      if (frameHead) {
        const bounds = new T.Box3();
        for (const face of this.built?.faces.keys() ?? []) bounds.expandByObject(face, true);
        if (bounds.isEmpty()) {
          for (const bp of this.built?.parts.values() ?? []) {
            if (bp.part.motion === "head") bounds.expandByObject(bp.object, true);
          }
        }
        const selected = this.selected && this.built?.parts.get(this.selected);
        if (bounds.isEmpty() && selected) bounds.expandByObject(selected.object, true);
        if (bounds.isEmpty())
          throw new Error("Select the head to capture a portrait depth reference.");
        bounds.getCenter(target);
        const size = bounds.getSize(new T.Vector3());
        const aspect = this.camera.aspect;
        const halfHeight = 0.55 * Math.max(size.y, size.x / aspect, size.z / aspect, 0.001);
        const halfWidth = halfHeight * aspect;
        distance = Math.max(1, size.length() * 2);
        camera = new T.OrthographicCamera(
          -halfWidth,
          halfWidth,
          halfHeight,
          -halfHeight,
          0.001,
          2 * distance,
        );
      } else {
        camera = this.camera.clone();
      }
      camera.position.copy(target).addScaledVector(along, distance);
      camera.lookAt(target);
    }
    const helper = this.gizmo.getHelper();
    const shown = [this.highlight.visible, helper.visible] as const;
    this.highlight.visible = false;
    helper.visible = false;
    this.renderer.render(this.scene, camera);
    const canvas = this.renderer.domElement;
    const done = new Promise<Uint8Array>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) reject(new Error("The view could not be captured."));
        else blob.arrayBuffer().then((b) => resolve(new Uint8Array(b)), reject);
      }, "image/png");
    });
    [this.highlight.visible, helper.visible] = shown;
    this.request();
    return done;
  }

  request(): void {
    if (this.pending === null) this.pending = requestAnimationFrame(() => this.draw());
  }

  private draw(): void {
    this.pending = null;
    const moved = this.orbit.update();
    this.renderer.render(this.scene, this.camera);
    if (moved) this.request();
  }
}
