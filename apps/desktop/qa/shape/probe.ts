import * as T from "three";

const events = new EventTarget();
Object.defineProperty(window, "__THREE_DEVTOOLS__", { value: events, configurable: true });
let live: { scene: T.Scene; camera: T.Camera; renderer: T.WebGLRenderer } | undefined;
const views = new Map<HTMLCanvasElement, { scene: T.Scene; camera: T.Camera }>();
events.addEventListener("observe", (event) => {
  const scene: unknown = event instanceof CustomEvent ? event.detail : null;
  const isScene = (value: unknown): value is T.Scene =>
    Reflect.get(Object(value), "isScene") === true;
  if (!isScene(scene)) return;
  const previous = scene.onAfterRender.bind(scene);
  scene.onAfterRender = function (...args) {
    previous.call(this, ...args);
    const [renderer, , camera] = args;
    if (!renderer.getRenderTarget()) views.set(renderer.domElement, { scene, camera });
    if (!renderer.getRenderTarget() && renderer.domElement.matches("#viewport,#viewport canvas"))
      live = { scene, camera, renderer };
  };
});
function visible() {
  if (!live) throw new Error("Wait for the workshop to render.");
  const meshes: T.Mesh[] = [];
  const isMesh = (node: T.Object3D): node is T.Mesh => "isMesh" in node && node.isMesh === true;
  live.scene.traverseVisible((node) => {
    if (isMesh(node)) meshes.push(node);
  });
  return { ...live, meshes };
}
function owner(o: T.Object3D | null): string | undefined {
  while (o) {
    const id: unknown = o.userData["partId"];
    if (typeof id === "string") return id;
    o = o.parent;
  }
  return undefined;
}
function view(selector: string) {
  const canvas = document.querySelector(selector);
  const found = canvas instanceof HTMLCanvasElement ? views.get(canvas) : undefined;
  if (!canvas || !found) throw new Error("No rendered view for " + selector);
  const rect = canvas.getBoundingClientRect();
  const screen = (world: T.Vector3) => {
    const v = world.clone().project(found.camera);
    return {
      x: rect.left + ((1 + v.x) * rect.width) / 2,
      y: rect.top + ((1 - v.y) * rect.height) / 2,
    };
  };
  return { ...found, screen };
}
const isMeshNode = (node: T.Object3D): node is T.Mesh => Reflect.get(node, "isMesh") === true;
const isSkinned = (node: T.Object3D): node is T.SkinnedMesh =>
  Reflect.get(node, "isSkinnedMesh") === true;
const isObject = (value: unknown): value is T.Object3D =>
  Reflect.get(Object(value), "isObject3D") === true;
function bone(scene: T.Scene, region: string, station: number) {
  let hit: T.Object3D | undefined;
  scene.traverse((node) => {
    if (
      !hit &&
      node.type === "Bone" &&
      node.userData["region"] === region &&
      node.userData["station"] === station &&
      node.userData["digit"] === undefined
    )
      hit = node;
  });
  if (!hit) throw new Error("No joint " + region + " " + station);
  return hit;
}
const probe = {
  handle(selector: string) {
    const { scene, screen } = view(selector);
    let attached: T.Object3D | undefined;
    scene.traverse((node) => {
      const controls: unknown = Reflect.get(node, "controls");
      if ("isTransformControlsRoot" in node && controls) {
        const object: unknown = Reflect.get(Object(controls), "object");
        if (isObject(object)) attached = object;
      }
    });
    if (!attached) throw new Error("No handle attached in " + selector);
    const world = attached.getWorldPosition(new T.Vector3());
    return { ...screen(world), world: world.toArray() };
  },
  joint(selector: string, region: string, station: number) {
    const { scene, screen } = view(selector);
    const world = bone(scene, region, station).getWorldPosition(new T.Vector3());
    return { ...screen(world), world: world.toArray() };
  },
  extent(selector: string) {
    const { scene, screen } = view(selector);
    const xs: number[] = [],
      ys: number[] = [];
    scene.traverseVisible((node) => {
      if (node.type !== "Bone" || typeof node.userData["region"] !== "string") return;
      const at = screen(node.getWorldPosition(new T.Vector3()));
      xs.push(at.x);
      ys.push(at.y);
    });
    if (!xs.length) throw new Error("No joints in " + selector);
    return {
      left: Math.min(...xs),
      right: Math.max(...xs),
      top: Math.min(...ys),
      bottom: Math.max(...ys),
    };
  },
  bones(selector: string) {
    const { scene } = view(selector);
    const found: string[] = [];
    scene.traverse((node) => {
      if (node.type === "Bone" && typeof node.userData["region"] === "string")
        found.push(node.userData["region"] + "#" + String(node.userData["station"]));
    });
    return [...new Set(found)];
  },
  corner(id: string, at: readonly [number, number, number], dx: number, dy: number) {
    const { scene, camera, renderer } = visible();
    let part = scene.getObjectByName(id);
    scene.traverseVisible((o) => {
      if (o.userData["partId"] === id) part = o;
    });
    if (!part) throw new Error("Missing cage.");
    const world = part.localToWorld(new T.Vector3(...at)),
      rect = renderer.domElement.getBoundingClientRect();
    function screen(v: T.Vector3) {
      v.project(camera);
      return {
        x: rect.left + ((1 + v.x) * rect.width) / 2,
        y: rect.top + ((1 - v.y) * rect.height) / 2,
      };
    }
    return {
      start: screen(world.clone()),
      end: screen(world.clone().add(new T.Vector3(dx, dy, 0).applyQuaternion(camera.quaternion))),
    };
  },
  centre(id: string) {
    const box = new T.Box3(),
      v = new T.Vector3();
    for (const m of visible().meshes.filter((m) => owner(m) === id)) {
      const p = m.geometry.getAttribute("position");
      for (let i = 0; i < p.count; i++)
        box.expandByPoint(v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld));
    }
    if (box.isEmpty()) throw new Error("Cannot frame " + id);
    return box.getCenter(v).toArray();
  },
  capture(center: readonly [number, number, number], height: number, yaw: number) {
    const { renderer, scene, camera } = visible(),
      canvas = renderer.domElement,
      aspect = canvas.width / canvas.height;
    const inspect = new T.OrthographicCamera(
      (-height * aspect) / 2,
      (height * aspect) / 2,
      height / 2,
      -height / 2,
      0.01,
      15,
    );
    inspect.position
      .set(...center)
      .add(new T.Vector3(Math.sin(yaw), 0.06, Math.cos(yaw)).multiplyScalar(4));
    inspect.lookAt(...center);
    const hidden: T.Object3D[] = [];
    scene.traverseVisible((node) => {
      if (
        node.type === "BoxHelper" ||
        "isTransformControlsRoot" in node ||
        node.type === "LineSegments" ||
        node.type === "Points"
      ) {
        hidden.push(node);
        node.visible = false;
      }
    });
    try {
      renderer.render(scene, inspect);
      return canvas.toDataURL().split(",")[1] ?? "";
    } finally {
      for (const node of hidden) node.visible = true;
      renderer.render(scene, camera);
    }
  },
  camera() {
    return visible().camera.quaternion.toArray();
  },
  names() {
    return [...new Set(visible().meshes.map(owner).filter(Boolean))];
  },
  point(wanted: string, u: number, v: number, dx: number, dy: number) {
    const { meshes, renderer, camera } = visible(),
      rect = renderer.domElement.getBoundingClientRect();
    const parts = meshes.filter((m) => owner(m) === wanted);
    if (!parts.length) throw new Error("No visible mesh for " + wanted);
    const box = new T.Box2(),
      pt = new T.Vector3();
    for (const mesh of parts) {
      const p = mesh.geometry.getAttribute("position");
      for (let i = 0; i < p.count; i++) {
        pt.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld).project(camera);
        box.expandByPoint(new T.Vector2(pt.x, pt.y));
      }
    }
    const centre = box.min.clone().lerp(box.max, u);
    centre.y = T.MathUtils.lerp(box.max.y, box.min.y, v);
    const ray = new T.Raycaster();
    const screen = (p: T.Vector3) => ({
      x: rect.left + ((1 + p.x) * rect.width) / 2,
      y: rect.top + ((1 - p.y) * rect.height) / 2,
    });
    for (let r = 0; r < 16; r++)
      for (let j = 0; j < (r ? 16 : 1); j++) {
        const ndc = centre
          .clone()
          .add(
            new T.Vector2(
              Math.cos((j * Math.PI) / 8) * r * 0.012,
              Math.sin((j * Math.PI) / 8) * r * 0.012,
            ),
          );
        if (Math.abs(ndc.x) > 0.97 || Math.abs(ndc.y) > 0.97) continue;
        ray.setFromCamera(ndc, camera);
        const hit = ray.intersectObjects(meshes, false).find((h) => h.face && owner(h.object));
        if (!hit || owner(hit.object) !== wanted) continue;
        const end = hit.point
          .clone()
          .add(new T.Vector3(dx, dy, 0).applyQuaternion(camera.quaternion));
        return {
          start: screen(hit.point.clone().project(camera)),
          end: screen(end.project(camera)),
          world: hit.point.toArray(),
        };
      }
    throw new Error("No exposed surface for " + wanted + " at " + u + "," + v);
  },
  uvSpan(id: string) {
    const min = new T.Vector2(Infinity, Infinity),
      max = new T.Vector2(-Infinity, -Infinity);
    for (const mesh of visible().meshes.filter((m) => owner(m) === id)) {
      const uv = mesh.geometry.getAttribute("uv");
      if (!uv) continue;
      for (let i = 0; i < uv.count; i++) {
        const p = new T.Vector2(uv.getX(i), uv.getY(i));
        min.min(p);
        max.max(p);
      }
    }
    return max.sub(min).toArray();
  },
  surface(id: string) {
    return visible()
      .meshes.filter((m) => owner(m) === id)
      .map((mesh) => {
        const g = mesh.geometry,
          p = g.getAttribute("position"),
          n = g.getAttribute("normal"),
          material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
        const index = g.index,
          a = new T.Vector3(),
          b = new T.Vector3(),
          c = new T.Vector3(),
          face = new T.Vector3(),
          normal = new T.Vector3();
        let bend = 0,
          count = 0;
        const triangles = (index?.count ?? p.count) / 3;
        for (let t = 0; t < triangles; t += Math.max(1, Math.floor(triangles / 4000))) {
          const ids = [0, 1, 2].map((k) => (index ? index.getX(3 * t + k) : 3 * t + k));
          a.fromBufferAttribute(p, ids[0] ?? 0);
          b.fromBufferAttribute(p, ids[1] ?? 0);
          c.fromBufferAttribute(p, ids[2] ?? 0);
          face.subVectors(c, b).cross(a.clone().sub(b));
          if (face.lengthSq() < 1e-16 || !n) continue;
          face.normalize();
          for (const i of ids) {
            normal.fromBufferAttribute(n, i ?? 0).normalize();
            bend += Math.abs(normal.dot(face));
            count++;
          }
        }
        return {
          name: mesh.name,
          type: mesh.type,
          vertices: p.count,
          triangles,
          indexed: Boolean(index),
          normals: Boolean(n),
          morphs: Object.keys(g.morphAttributes).length,
          material: material?.type,
          flat: Boolean(Reflect.get(Object(material), "flatShading")),
          faceAlignment: count ? bend / count : 1,
        };
      });
  },
  crown() {
    const box = new T.Box3();
    for (const m of visible().meshes) box.expandByObject(m, true);
    const top = box.max.y,
      head = new T.Box3(),
      v = new T.Vector3();
    for (const m of visible().meshes) {
      const p = m.geometry.getAttribute("position");
      for (let i = 0; i < p.count; i += 7) {
        v.fromBufferAttribute(p, i);
        if (isSkinned(m)) m.applyBoneTransform(i, v);
        v.applyMatrix4(m.matrixWorld);
        if (v.y > top - 0.24) head.expandByPoint(v);
      }
    }
    return head.getCenter(v).toArray();
  },
  influences() {
    const found: Record<string, number> = {};
    visible().scene.traverse((node) => {
      if (!isMeshNode(node)) return;
      const mesh = node;
      const names = mesh.morphTargetDictionary,
        weights = mesh.morphTargetInfluences;
      if (!names || !weights) return;
      for (const [name, index] of Object.entries(names))
        found[name] = Math.max(found[name] ?? 0, Math.abs(weights[index] ?? 0));
    });
    return found;
  },
  morphs() {
    const found: Record<string, number> = {};
    const v = new T.Vector3(),
      scale = new T.Vector3();
    visible().scene.traverse((node) => {
      if (!isMeshNode(node)) return;
      const mesh = node;
      const names = mesh.morphTargetDictionary,
        targets = mesh.geometry.morphAttributes["position"];
      if (!names || !targets) return;
      mesh.getWorldScale(scale);
      for (const [name, index] of Object.entries(names)) {
        const t = targets[index];
        if (!t) continue;
        let most = 0;
        for (let i = 0; i < t.count; i++)
          most = Math.max(most, v.fromBufferAttribute(t, i).multiply(scale).length());
        found[name] = Math.max(found[name] ?? 0, most);
      }
    });
    return found;
  },
  geometry(id: string) {
    const data: number[] = [];
    for (const mesh of visible().meshes.filter((m) => owner(m) === id)) {
      const p = mesh.geometry.getAttribute("position");
      for (let i = 0; i < p.count; i += Math.max(1, Math.floor(p.count / 2000))) {
        const v = new T.Vector3().fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld);
        data.push(v.x, v.y, v.z);
      }
    }
    return data;
  },
};
Object.defineProperty(window, "shapeProbe", { value: probe });
declare global {
  interface Window {
    shapeProbe: typeof probe;
  }
}
