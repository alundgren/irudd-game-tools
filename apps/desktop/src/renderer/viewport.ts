import * as T from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import {
  buildCharacter,
  clayMaterials,
  graftComponent,
  previewPull,
  mirrorCentre,
  startSkinStroke,
  skinMeshData,
  MotionPreview,
  type PoseSession,
  skinCharacter,
  fanDisplay,
  armChains,
  partBounds,
  portraitFrame,
  cutGarment,
  fitAccessory,
  fitPaintedEyes,
  fitSweptHand,
  domRaster,
  type BuildOptions,
  type BuiltCharacter,
  surfaceMaterials,
  type SurfaceKit,
} from "@irudd/character";
import { currentCreature, creatureEdits } from "@irudd/character/creature";
import type { HumanBody } from "@irudd/character/human";
import {
  applyOperations,
  decodeOperations,
  derivePartId,
  type CreaturePlan,
  figureLocations,
  humanCorrections,
  worldDeltaInParent,
  type CharacterDocument,
  type Registry,
  type Vec3,
  type Part,
} from "@irudd/document";

export const tools = ["select", "translate", "rotate", "scale"] as const;
export type Tool = (typeof tools)[number];

export type Transform =
  | { readonly kind: "translate"; readonly translate: [number, number, number] }
  | { readonly kind: "rotate"; readonly rotate: [number, number, number, number] }
  | { readonly kind: "scale"; readonly scale: [number, number, number] };

export interface ViewportEvents {
  readonly onPick: (partId: string | null) => void;
  readonly onDragStart: (partId: string) => void;
  readonly onDragEnd: (partId: string, transform: Transform | undefined) => void;
}

export const displayModes = ["studio", "clay", "silhouette"] as const;
export type DisplayMode = (typeof displayModes)[number];

const directions = {
  front: new T.Vector3(0, 0, 1),
  portrait: new T.Vector3(-2.06, 0, 4.33).normalize(),
  side: new T.Vector3(1, 0, 0),
  back: new T.Vector3(0, 0, -1),
  threequarter: new T.Vector3(0.62, 0.35, 1).normalize(),
};
export type CameraAngle = keyof typeof directions;

function isMesh(object: T.Object3D): object is T.Mesh {
  return object instanceof T.Mesh;
}

const clampScale = (value: number): number => Math.min(Math.max(value, 0.01), 100);

export class EditorViewport {
  readonly renderer: T.WebGLRenderer;
  private readonly scene = new T.Scene();
  private readonly locations = new T.Group();
  setLocations(visible: boolean) {
    this.locations.visible = visible;
    this.request();
  }
  private rebuildLocations(doc: CharacterDocument | undefined) {
    for (const node of this.locations.children.slice()) {
      if (node instanceof T.Sprite) {
        node.material.map?.dispose();
        node.material.dispose();
      }
      this.locations.remove(node);
    }
    if (!doc) return;
    this.scene.add(this.locations);
    for (const p of doc.parts)
      for (const m of figureLocations.read(p.features)?.marks ?? []) {
        const part = this.built?.parts.get(p.id);
        if (!part) continue;
        const canvas = document.createElement("canvas"),
          ctx = canvas.getContext("2d");
        if (!ctx) continue;
        ctx.font = "24px sans-serif";
        canvas.width = Math.ceil(ctx.measureText(m.name).width) + 18;
        canvas.height = 38;
        ctx.font = "24px sans-serif";
        ctx.fillStyle = "#242b30";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#ffbb56";
        ctx.fillRect(0, 0, 5, canvas.height);
        ctx.fillStyle = "white";
        ctx.fillText(m.name, 10, 27);
        const texture = new T.CanvasTexture(canvas);
        texture.colorSpace = T.SRGBColorSpace;
        const sprite = new T.Sprite(
          new T.SpriteMaterial({
            map: texture,
            sizeAttenuation: false,
            depthTest: false,
            depthWrite: false,
          }),
        );
        sprite.position.copy(part.object.localToWorld(new T.Vector3(...m.at)));
        sprite.center.set(0, 0);
        sprite.scale.set(canvas.width * 0.00055, canvas.height * 0.00055, 1);
        sprite.renderOrder = 1000;
        this.locations.add(sprite);
      }
  }
  private readonly camera = new T.PerspectiveCamera(34, 1, 0.01, 500);
  private readonly key = new T.DirectionalLight(0xfff0de, 2.4);
  private readonly keyDirection = new T.Vector3(-2.2, 4, 3.2);
  private fitShadow(camera: T.Camera, target: T.Vector3): void {
    let half = 3;
    if (camera instanceof T.PerspectiveCamera)
      half =
        2 *
        camera.position.distanceTo(target) *
        Math.tan(T.MathUtils.degToRad(camera.fov / 2)) *
        0.83;
    else if (camera instanceof T.OrthographicCamera)
      half = ((camera.top - camera.bottom) / camera.zoom) * 0.83;
    half = Math.max(0.3, half);
    const shadow = this.key.shadow.camera;
    if (
      Math.abs(shadow.top - half) < 0.001 &&
      this.key.target.position.distanceToSquared(target) < 1e-7
    )
      return;
    this.key.target.position.copy(target);
    this.key.position.copy(target).add(this.keyDirection);
    Object.assign(shadow, { left: -half, right: half, top: half, bottom: -half });
    shadow.updateProjectionMatrix();
  }
  private readonly orbit: OrbitControls;
  private readonly gizmo: TransformControls;
  private readonly highlight = new T.BoxHelper(new T.Object3D(), 0xe2a447);
  private readonly observer: ResizeObserver;
  private mode: DisplayMode = "studio";
  private readonly clay = new T.MeshStandardMaterial({
    color: "#adb4ad",
    roughness: 0.86,
    side: T.DoubleSide,
  });
  private readonly silhouette = new T.MeshBasicMaterial({ color: "#203733", side: T.DoubleSide });
  private readonly studio = new Map<T.Mesh, T.Material | T.Material[]>();

  private built: BuiltCharacter | undefined;
  private fan: ReturnType<typeof fanDisplay>;
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
    const key = this.key;
    key.position.copy(this.keyDirection);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.normalBias = 0.0015;
    key.shadow.bias = -0.00012;
    key.shadow.radius = 2;
    Object.assign(key.shadow.camera, {
      left: -3,
      right: 3,
      top: 3,
      bottom: -3,
      near: 0.5,
      far: 12,
    });
    this.scene.add(key, key.target);
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
    this.gizmo.addEventListener("objectChange", () => {
      this.highlight.update();
      if (this.motion && this.posing) {
        this.posing.guide();
        this.onPoseChange?.();
      }
    });
    this.gizmo.addEventListener("dragging-changed", (event) => {
      const dragging = event.value === true;
      this.orbit.enabled = !dragging;
      if (this.motion) {
        this.motion.playing = false;
        this.onMotionFrame?.(this.motion.time);
        if (dragging) this.posing?.beginDrag();
        else this.posing?.endDrag();
        this.onPoseChange?.();
        return;
      }
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
      if (!start || e.defaultPrevented || this.gizmo.dragging) return;
      if (Math.hypot(e.clientX - start[0], e.clientY - start[1]) > 4) return;
      if (this.motion) {
        if (this.pickingSurface && this.posing) {
          const rect = canvas.getBoundingClientRect();
          const ray = new T.Raycaster();
          ray.setFromCamera(
            new T.Vector2(
              ((e.clientX - rect.left) * 2) / rect.width - 1,
              1 - ((e.clientY - rect.top) * 2) / rect.height,
            ),
            this.camera,
          );
          if (this.posing.pickSurface(ray)) this.pickingSurface = false;
          this.attachGizmo();
          this.onPoseChange?.();
          this.request();
        } else if (this.joints?.visible && !this.gizmo.axis) this.pickJoint(e.clientX, e.clientY);
        return;
      }
      this.events.onPick(this.pick(e.clientX, e.clientY));
    });

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.resize();
  }

  cut(host: string, kind: Parameters<typeof cutGarment>[2], color: string) {
    if (!this.built) throw new Error("Wait for the character to load.");
    return cutGarment(this.built, host, kind, color);
  }

  fitHand(p: import("@irudd/document").Part) {
    if (!this.built) throw new Error("Wait for the character to load.");
    return fitSweptHand(this.built, p);
  }

  fitEyes(id: string) {
    const built = this.built,
      root = built?.parts.get(id)?.object;
    const face = built && [...built.faces.keys()].find((m) => m === root || m.parent === root);
    if (!face || !built) throw new Error("Select a registered face.");
    return fitPaintedEyes(
      face,
      built.faces.get(face),
      this.studio.get(face) ?? face.material,
      domRaster(),
    );
  }

  accessoryAnchor(face: string, pivot: string) {
    if (!this.built) throw new Error("Wait for the character to load.");
    return fitAccessory(this.built, face, pivot);
  }

  get dragging(): boolean {
    return this.dragStart !== undefined;
  }

  cancelDrag(): boolean {
    if (!this.dragStart) return false;
    this.dragStart = undefined;
    this.gizmo.detach();
    this.request();
    return true;
  }

  motion: MotionPreview | undefined;
  private joints: T.SkeletonHelper | undefined;
  private lastFrame = 0;
  onMotionFrame: ((time: number) => void) | undefined;

  arms() {
    return this.built ? armChains(this.built) : [];
  }

  preview() {
    if (!this.built || this.motion) return this.motion;
    const display = this.mode;
    this.setDisplay("studio");
    try {
      this.fan?.show(false);
      const rig = skinCharacter(this.built);
      this.motion = new MotionPreview(rig);
      this.scene.add(rig.actor);
      rig.actor.traverse((node) => {
        if (isMesh(node)) this.studio.set(node, node.material);
      });
      this.built.group.visible = false;
      this.highlight.visible = false;
      this.gizmo.detach();
      return this.motion;
    } finally {
      if (!this.motion) this.fan?.show(true);
      this.setDisplay(display);
    }
  }

  onJointPick: ((key: string) => void) | undefined;
  onPoseChange: (() => void) | undefined;
  private pickedBone: T.Bone | undefined;
  private jointMode: "rotate" | "translate" = "rotate";
  private posing: PoseSession | undefined;
  pickingSurface = false;

  poseJoint(key: string, mode: "rotate" | "translate", session?: PoseSession) {
    this.pickedBone = this.motion?.rig.bindings.get(key)?.bone;
    this.jointMode = mode;
    if (session !== this.posing) {
      this.posing?.target.removeFromParent();
      this.posing = session;
      if (session) this.scene.add(session.target);
    }
    this.attachGizmo();
    this.request();
  }

  private pickJoint(x: number, y: number) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    let distance = 12;
    let key: string | undefined;
    const at = new T.Vector3();
    for (const [id, b] of this.motion?.rig.bindings ?? []) {
      b.bone.getWorldPosition(at).project(this.camera);
      const d = Math.hypot(
        rect.left + ((1 + at.x) * rect.width) / 2 - x,
        rect.top + ((1 - at.y) * rect.height) / 2 - y,
      );
      if (d < distance) {
        key = id;
        distance = d;
      }
    }
    if (key) this.onJointPick?.(key);
  }

  showJoints(visible: boolean) {
    if (visible && this.motion && !this.joints) {
      this.joints = new T.SkeletonHelper(this.motion.rig.actor);
      this.scene.add(this.joints);
    }
    if (this.joints) this.joints.visible = visible;
    this.request();
  }

  closeMotion() {
    if (!this.motion) return;
    this.joints?.removeFromParent();
    this.joints?.dispose();
    this.joints = undefined;
    const actor = this.motion.rig.actor;
    actor.removeFromParent();
    actor.traverse((node) => {
      if (isMesh(node)) this.studio.delete(node);
    });
    this.gizmo.detach();
    this.pickedBone = undefined;
    this.posing?.target.removeFromParent();
    this.posing = undefined;
    this.pickingSurface = false;
    this.onPoseChange = undefined;
    this.onJointPick = undefined;
    this.onMotionFrame = undefined;
    this.motion.dispose();
    this.motion = undefined;
    this.fan?.show(true);
    if (this.built) this.built.group.visible = true;
    this.select(this.selected);
  }

  private planPreview: BuiltCharacter | undefined;
  private buildOptions: (() => BuildOptions) | undefined;
  private previewMaterials = new Map<T.Mesh, T.Material | T.Material[]>();
  handleAxes() {
    return {
      forward: this.camera.getWorldDirection(new T.Vector3()).toArray(),
      up: new T.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion).toArray(),
    };
  }
  previewPlan(next?: CreaturePlan) {
    if (this.planPreview) {
      this.planPreview.group.removeFromParent();
      for (const [mesh, material] of this.previewMaterials) mesh.material = material;
      this.previewMaterials.clear();
      this.planPreview.dispose();
      this.planPreview = undefined;
    }
    if (this.built) this.built.group.visible = true;
    this.request();
    const doc = this.doc,
      registry = this.registry;
    if (!next || !doc || !registry || !this.buildOptions || !this.built) return;
    const plan = currentCreature(doc);
    if (!plan) return;
    const ops = decodeOperations(creatureEdits(doc, plan, next));
    if (!ops.ok) throw new Error(ops.diagnostics.map((d) => d.message).join(" "));
    const result = applyOperations(doc, ops.value, {
      registry,
      retired: new Set(),
      idFor: (slot) => derivePartId(doc.id, "handle-preview", slot),
    });
    if (!result.ok) throw new Error(result.diagnostics.map((d) => d.message).join(" "));
    const preview = buildCharacter(result.value, this.buildOptions());
    if (this.mode !== "studio")
      preview.group.traverse((n) => {
        if (isMesh(n)) {
          this.previewMaterials.set(n, n.material);
          n.material = this.mode === "clay" ? this.clay : this.silhouette;
        }
      });
    this.built.group.visible = false;
    this.scene.add(preview.group);
    this.planPreview = preview;
  }

  human: HumanBody | undefined;

  show(
    doc: CharacterDocument | undefined,
    registry: Registry,
    studio?: { readonly kit: SurfaceKit; readonly finish: NonNullable<BuildOptions["finish"]> },
    humanPaint?: BuildOptions["humanPaint"],
  ): void {
    this.previewPlan();
    this.closeMotion();
    this.dragStart = undefined;
    this.gizmo.detach();
    if (this.built) {
      this.built.group.removeFromParent();
      for (const [mesh, original] of this.studio) mesh.material = original;
      this.studio.clear();
      this.fan?.dispose();
      this.fan = undefined;
      this.built.dispose();
      this.built = undefined;
    }
    this.doc = doc;
    this.registry = registry;
    if (doc && studio) {
      this.buildOptions = () => {
        const materials = surfaceMaterials(studio.kit);
        return {
          materials,
          groomMaterials: materials,
          wingMaterials: materials,
          human: this.human,
          humanPaint,
          finish: studio.finish,
        };
      };
      this.built = buildCharacter(doc, this.buildOptions());
      this.fan = fanDisplay(this.built);
      this.built.group.traverse((node) => {
        if (isMesh(node)) {
          node.castShadow = true;
          this.studio.set(node, node.material);
        }
      });
      this.setDisplay(this.mode);
      this.scene.add(this.built.group);
      if (!this.framed) {
        this.frame();
        this.framed = true;
      }
    }
    this.rebuildLocations(doc);
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
    if (part && !this.motion) {
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
    if (this.motion && this.joints?.visible && this.posing?.guiding && !this.pickingSurface) {
      this.gizmo.setSpace("world");
      this.gizmo.setMode("translate");
      this.gizmo.attach(this.posing.target);
      return;
    }
    if (this.motion && this.pickingSurface) {
      this.gizmo.detach();
      return;
    }
    if (this.motion && this.joints?.visible && this.pickedBone) {
      this.gizmo.setSpace("local");
      this.gizmo.setMode(this.jointMode);
      this.gizmo.attach(this.pickedBone);
      return;
    }
    if (this.motion || !part || this.tool === "select") {
      this.gizmo.detach();
      return;
    }
    this.gizmo.setMode(this.tool);
    this.gizmo.setSpace(this.tool === "translate" ? "world" : "local");
    this.gizmo.attach(part.object);
  }

  setDisplay(mode: DisplayMode): void {
    this.mode = mode;
    const material = mode === "clay" ? this.clay : this.silhouette;
    for (const [mesh, original] of this.studio)
      mesh.material =
        mode === "studio"
          ? original
          : Array.isArray(original)
            ? original.map(() => material)
            : material;
    this.scene.background = new T.Color(mode === "silhouette" ? 0xdce3de : 0x30383a);
    this.request();
  }

  setAngle(angle: CameraAngle): void {
    const target = this.orbit.target;
    const distance = this.camera.position.distanceTo(target);
    this.camera.position.copy(target).addScaledVector(directions[angle], distance);
    this.orbit.update();
    this.request();
  }

  focusSelection(): void {
    const part = this.selected === null ? undefined : this.built?.parts.get(this.selected);
    this.frame(
      part && partBounds(part.object),
      this.camera.position.clone().sub(this.orbit.target).normalize(),
    );
  }

  frame(bounds?: T.Box3, along = directions.threequarter): void {
    const box = bounds ?? new T.Box3();
    if (!bounds && this.built) box.setFromObject(this.built.group);
    if (box.isEmpty()) box.set(new T.Vector3(-0.5, 0, -0.5), new T.Vector3(0.5, 1.4, 0.5));
    const centre = box.getCenter(new T.Vector3());
    const size = Math.max(0.001, box.getSize(new T.Vector3()).length());
    const halfFov = Math.atan(
      Math.tan(T.MathUtils.degToRad(this.camera.fov / 2)) * Math.min(1, this.camera.aspect),
    );
    const distance = (0.53 * size) / Math.sin(halfFov);
    this.orbit.target.copy(centre);
    this.camera.position.copy(centre).addScaledVector(along, distance);
    this.camera.near = Math.max(size / 500, 0.001);
    this.camera.far = Math.max(size * 60, distance + size, 10);
    this.camera.updateProjectionMatrix();
    this.orbit.update();
    this.request();
  }

  private pointerRay(x: number, y: number) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ray = new T.Raycaster();
    ray.setFromCamera(
      new T.Vector2((2 * (x - rect.left)) / rect.width - 1, 1 - (2 * (y - rect.top)) / rect.height),
      this.camera,
    );
    return ray;
  }

  surfaceHit(x: number, y: number, blendedOwner = true) {
    if (!this.built || this.motion) return;
    const meshes: T.Mesh[] = [];
    this.built.group.traverseVisible((n) => {
      if (isMesh(n)) meshes.push(n);
    });
    for (const hit of this.pointerRay(x, y).intersectObjects(meshes, false)) {
      if (!hit.face) continue;
      const contact = {
        world: hit.point.toArray(),
        normal: hit.face.normal
          .clone()
          .applyNormalMatrix(new T.Matrix3().getNormalMatrix(hit.object.matrixWorld))
          .toArray(),
        mesh: hit.object,
        face: hit.faceIndex ?? 0,
        skin: skinMeshData.has(hit.object),
      };
      const owners = blendedOwner && isMesh(hit.object) && this.built.blendOwners.get(hit.object);
      if (owners && hit.face) {
        const scores = new Map<string, number>();
        for (const vertex of [hit.face.a, hit.face.b, hit.face.c]) {
          const w = owners.weight[vertex] ?? 1;
          for (const [idx, weight] of [
            [owners.first[vertex], w],
            [owners.second[vertex], 1 - w],
          ] as const) {
            const id = idx === undefined ? undefined : owners.ids[idx];
            if (id) scores.set(id, (scores.get(id) ?? 0) + weight);
          }
        }
        const id = [...scores].sort((a, b) => b[1] - a[1])[0]?.[0];
        if (id) return { id, ...contact };
      }
      for (let n: T.Object3D | null = hit.object; n; n = n.parent) {
        const id: unknown = n.userData["partId"];
        if (typeof id === "string") return { id, ...contact };
      }
    }
    return;
  }

  private pick(x: number, y: number) {
    return this.surfaceHit(x, y)?.id ?? null;
  }

  planePoint(x: number, y: number, anchor: Vec3): Vec3 {
    const plane = new T.Plane().setFromNormalAndCoplanarPoint(
      this.camera.getWorldDirection(new T.Vector3()),
      new T.Vector3(...anchor),
    );
    return (
      this.pointerRay(x, y).ray.intersectPlane(plane, new T.Vector3()) ?? new T.Vector3(...anchor)
    ).toArray();
  }

  partPoint(id: string, p: Vec3, direction: "world" | "local" | "mount"): Vec3 {
    const part = this.built?.parts.get(id);
    if (!part) throw new Error("Select a visible part.");
    const v = new T.Vector3(...p);
    return (
      direction === "world"
        ? part.object.localToWorld(v)
        : (direction === "mount" ? part.mount : part.object).worldToLocal(v)
    ).toArray();
  }

  branchMatrix(id: string, kind: "object" | "mount") {
    const node = this.built?.parts.get(id)?.[kind];
    if (!node) throw new Error("Choose a visible branch.");
    node.updateWorldMatrix(true, false);
    return node.matrixWorld.clone();
  }
  viewAxis() {
    return this.camera.getWorldDirection(new T.Vector3()).negate().toArray();
  }
  pixelSize(world: Vec3) {
    const cameraPoint = new T.Vector3(...world).applyMatrix4(this.camera.matrixWorldInverse);
    return (
      (-2 * cameraPoint.z * Math.tan(T.MathUtils.degToRad(this.camera.fov / 2))) /
      this.renderer.domElement.clientHeight
    );
  }
  skinBrush(
    hit: NonNullable<ReturnType<EditorViewport["surfaceHit"]>>,
    reach: number,
    mirror: boolean,
  ) {
    if (!this.built || !this.doc) throw new Error("Choose an adult body.");
    return startSkinStroke(
      this.built.group,
      hit.mesh,
      hit.face,
      hit.world,
      humanCorrections.read(this.doc.features),
      reach,
      mirror,
    );
  }
  partBrush(id: string, mirror: boolean) {
    const node = this.built?.parts.get(id)?.object;
    if (!node) throw new Error("Choose a visible part.");
    return { ...previewPull(node), mirrorX: mirror ? mirrorCentre(node) : undefined };
  }
  brushReach(id: string, metres: number): Vec3 {
    const s =
      this.built?.parts.get(id)?.object.getWorldScale(new T.Vector3()) ?? new T.Vector3(1, 1, 1);
    const radius = (axis: number) => T.MathUtils.clamp(metres / Math.abs(axis), 0.001, 20);
    return [radius(s.x), radius(s.y), radius(s.z)];
  }

  graft(
    donor: CharacterDocument,
    root: Part,
    target: Part,
    mode: Parameters<typeof graftComponent>[6],
    fit: boolean,
    shelfChildren?: boolean,
  ) {
    if (!this.doc || !this.built) throw new Error("Select a destination part.");
    const built = buildCharacter(donor, { materials: clayMaterials(), human: this.human });
    try {
      return graftComponent(
        donor,
        root,
        built,
        this.doc,
        target,
        this.built,
        mode,
        fit,
        this.human,
        shelfChildren,
      );
    } finally {
      built.dispose();
    }
  }

  private sizePreview: { doc: CharacterDocument; image: string } | undefined;
  private measured: { doc: CharacterDocument; box: T.Box3 } | undefined;

  private visibleBounds() {
    if (this.doc && this.measured?.doc === this.doc) return this.measured.box;
    const box = new T.Box3(),
      v = new T.Vector3();
    this.built?.group.updateWorldMatrix(true, true);
    this.built?.group.traverseVisible((n) => {
      if (!isMesh(n)) return;
      const pos = n.geometry.getAttribute("position");
      for (let i = 0; i < pos.count; i++)
        box.expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(n.matrixWorld));
    });
    if (this.doc) this.measured = { doc: this.doc, box };
    return box;
  }

  height() {
    return this.visibleBounds().getSize(new T.Vector3()).y;
  }

  comparisonImage() {
    if (!this.doc || !this.built) return "";
    if (this.sizePreview?.doc === this.doc) return this.sizePreview.image;
    const box = this.visibleBounds(),
      span = box.getSize(new T.Vector3()),
      centre = box.getCenter(new T.Vector3());
    const height = Math.max(0.01, span.y) * 1.04,
      width = Math.max(0.01, span.x) * 1.04;
    const camera = new T.OrthographicCamera(
      -width / 2,
      width / 2,
      height / 2,
      -height / 2,
      0.01,
      span.z * 2 + 4,
    );
    camera.position.copy(centre);
    camera.position.z += span.z + 1;
    camera.lookAt(centre);
    const canvas = document.createElement("canvas");
    canvas.height = 144;
    canvas.width = Math.max(1, Math.min(512, Math.round((144 * width) / height)));
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";
    const target = new T.WebGLRenderTarget(canvas.width, canvas.height);
    target.texture.colorSpace = T.SRGBColorSpace;
    const previous = this.renderer.getRenderTarget(),
      pixels = new Uint8Array(canvas.width * canvas.height * 4);
    const hidden = this.scene.children.filter(
      (node) => node.visible && node !== this.built?.group && !(node instanceof T.Light),
    );
    try {
      for (const node of hidden) node.visible = false;
      this.renderer.setRenderTarget(target);
      this.fitShadow(camera, centre);
      this.renderer.render(this.scene, camera);
      this.renderer.readRenderTargetPixels(target, 0, 0, canvas.width, canvas.height, pixels);
    } finally {
      this.renderer.setRenderTarget(previous);
      for (const node of hidden) node.visible = true;
      target.dispose();
    }
    const result = ctx.createImageData(canvas.width, canvas.height),
      stride = canvas.width * 4;
    for (let y = 0; y < canvas.height; y++)
      result.data.set(
        pixels.subarray(y * stride, (y + 1) * stride),
        (canvas.height - 1 - y) * stride,
      );
    ctx.putImageData(result, 0, 0);
    const image = canvas.toDataURL();
    this.sizePreview = { doc: this.doc, image };
    return image;
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

  get resolution(): { width: number; height: number; cssWidth: number; cssHeight: number } {
    const canvas = this.renderer.domElement;
    return {
      width: canvas.width,
      height: canvas.height,
      cssWidth: canvas.clientWidth,
      cssHeight: canvas.clientHeight,
    };
  }

  portraitGuide(id: string) {
    const object = this.built?.parts.get(id)?.object;
    const face = object?.userData["faceSurface"]
      ? object
      : object?.children.find((c) => c.userData["faceSurface"]);
    if (!face || !isMesh(face)) throw new Error("Choose a built-in head or traced face.");
    const { center, factor, half } = portraitFrame(face);
    const mesh = new T.Mesh(face.geometry, face.material);
    mesh.scale.copy(factor);
    mesh.position.copy(center).multiply(factor).negate();
    const scene = new T.Scene();
    scene.background = new T.Color(0x353b40);
    const light = new T.DirectionalLight(0xffffff, 2);
    light.position.set(2, 3, 4);
    scene.add(mesh, new T.AmbientLight(0xffffff, 1.8), light);
    const w = this.renderer.domElement.width,
      h = this.renderer.domElement.height;
    const vertical = half * Math.max(1, h / w),
      horizontal = (vertical * w) / h;
    const camera = new T.OrthographicCamera(-horizontal, horizontal, vertical, -vertical, 0.01, 10);
    camera.position.z = 3;
    this.renderer.render(scene, camera);
    const image = document.createElement("canvas");
    image.width = w;
    image.height = h;
    image.getContext("2d")?.drawImage(this.renderer.domElement, 0, 0);
    this.request();
    return {
      image,
      pick: (u: number, v: number): Vec3 => {
        const ray = new T.Raycaster();
        ray.setFromCamera(new T.Vector2(u * 2 - 1, 1 - v * 2), camera);
        const hit = ray.intersectObject(mesh, false)[0];
        if (!hit) throw new Error("Click a point on the face.");
        return hit.point.toArray();
      },
    };
  }

  proposalGuide() {
    const built = this.built;
    if (!built) throw new Error("Open the proposal before requesting a refinement.");
    const regions: { id: string; pivot: number[]; bounds: number[][] | null }[] = [];
    const surfaceMarks: { name: string; region: string; world: number[] }[] = [];
    const roots = new Map([...built.parts].map(([id, p]) => [p.object, id]));
    built.group.updateWorldMatrix(true, true);
    for (const [id, part] of built.parts) {
      const box = new T.Box3(),
        round = (v: T.Vector3) => v.toArray().map((n) => Number(n.toFixed(3)));
      function visit(node: T.Object3D) {
        if (!node.visible || (node !== part.object && roots.has(node))) return;
        if (isMesh(node)) {
          if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
          if (node.geometry.boundingBox)
            box.union(node.geometry.boundingBox.clone().applyMatrix4(node.matrixWorld));
        }
        for (const child of node.children) visit(child);
      }
      visit(part.object);
      regions.push({
        id,
        pivot: round(part.object.getWorldPosition(new T.Vector3())),
        bounds: box.isEmpty() ? null : [round(box.min), round(box.max)],
      });
      const original = this.doc?.parts.find((p) => p.id === id);
      if (original)
        for (const mark of figureLocations.read(original.features)?.marks ?? [])
          surfaceMarks.push({
            name: mark.name,
            region: id,
            world: round(part.object.localToWorld(new T.Vector3(...mark.at))),
          });
    }
    return {
      spatialGuide: {
        units:
          "Metres in standing world space, +X character left, +Y up, +Z front. Bounds exclude child parts.",
        regions,
      },
      surfaceMarks,
    };
  }

  async measuredView(target: string | null, rear = false) {
    const built = this.built;
    const subject = target ? built?.parts.get(target)?.object : built?.group;
    if (!built || !subject) throw new Error("Select the part to capture.");
    subject.updateWorldMatrix(true, true);
    const roots = new Set([...built.parts.values()].map((p) => p.object));
    const scene = new T.Scene();
    scene.background = this.scene.background;
    this.scene.traverse((light) => {
      if (light instanceof T.Light) scene.add(light.clone());
    });
    function collect(node: T.Object3D) {
      if ((!node.visible && node !== subject) || (target && node !== subject && roots.has(node)))
        return;
      if (isMesh(node)) {
        const clone = node.clone(false);
        clone.matrixAutoUpdate = false;
        clone.matrix.copy(node.matrixWorld);
        scene.add(clone);
      }
      for (const child of node.children) collect(child);
    }
    collect(subject);
    const box = new T.Box3().setFromObject(scene, true);
    if (box.isEmpty()) throw new Error("This part has no visible geometry to capture.");
    const size = box.getSize(new T.Vector3());
    const centre = box.getCenter(new T.Vector3());
    const radius = Math.max(0.035, size.length() * 0.56);
    const source = this.renderer.domElement;
    const aspect = source.width / source.height;
    const half = radius / Math.min(aspect, 1);
    const camera = new T.OrthographicCamera(
      -half * aspect,
      half * aspect,
      half,
      -half,
      0.01,
      8 * radius + 4,
    );
    const direction = rear
      ? new T.Vector3(-0.7, 0.16, -1)
      : target
        ? new T.Vector3(0.62, 0.1, 1)
        : new T.Vector3(0.45, 0.18, 1);
    camera.position.copy(centre).addScaledVector(direction.normalize(), radius * 3.5 + 2);
    camera.lookAt(centre);
    const image = document.createElement("canvas");
    image.width = image.height = 448;
    const ctx = image.getContext("2d");
    if (!ctx) throw new Error("Cannot capture a reference view.");
    try {
      this.renderer.render(scene, camera);
      const side = Math.min(source.width, source.height);
      ctx.drawImage(
        source,
        (source.width - side) / 2,
        (source.height - side) / 2,
        side,
        side,
        0,
        0,
        448,
        448,
      );
    } finally {
      this.request();
    }
    const blob = await new Promise<Blob>((resolve, reject) =>
      image.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Could not encode the reference view."))),
        "image/jpeg",
        0.84,
      ),
    );
    return { bytes: new Uint8Array(await blob.arrayBuffer()), height: size.y };
  }

  capture(view: "current" | "front" | "side" | "back", frameHead: boolean): Promise<Uint8Array> {
    let camera: T.Camera = this.camera;
    const target = this.orbit.target.clone();
    if (view !== "current") {
      const along = {
        front: new T.Vector3(0, 0, 1),
        portrait: new T.Vector3(-2.06, 0, 4.33).normalize(),
        side: new T.Vector3(1, 0, 0),
        back: new T.Vector3(0, 0, -1),
      }[view];
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
    this.fitShadow(camera, target);
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

  onFrame: (() => void) | undefined;
  project(point: readonly [number, number, number]): readonly [number, number] {
    const v = new T.Vector3(...point).project(this.camera);
    return [((v.x + 1) * this.host.clientWidth) / 2, ((1 - v.y) * this.host.clientHeight) / 2];
  }

  request(): void {
    if (this.pending === null) this.pending = requestAnimationFrame(() => this.draw());
  }

  private draw(): void {
    this.pending = null;
    const now = performance.now();
    if (this.motion?.playing) {
      this.motion.advance(Math.min(0.08, (now - this.lastFrame) / 1000));
      this.onMotionFrame?.(this.motion.time);
      this.request();
    }
    this.lastFrame = now;
    const moved = this.orbit.update();
    this.fitShadow(this.camera, this.orbit.target);
    this.renderer.render(this.scene, this.camera);
    this.onFrame?.();
    if (moved) this.request();
  }
}
