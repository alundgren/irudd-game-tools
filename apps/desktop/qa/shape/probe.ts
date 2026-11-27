import * as T from "three";

const events = new EventTarget();
Object.defineProperty(window, "__THREE_DEVTOOLS__", { value: events, configurable: true });
let live: { scene: T.Scene; camera: T.Camera; renderer: T.WebGLRenderer } | undefined;
events.addEventListener("observe", (event) => {
  const scene: unknown = event instanceof CustomEvent ? event.detail : null;
  const isScene = (value: unknown): value is T.Scene =>
    Reflect.get(Object(value), "isScene") === true;
  if (!isScene(scene)) return;
  const previous = scene.onAfterRender.bind(scene);
  scene.onAfterRender = function (...args) {
    previous.call(this, ...args);
    const [renderer, , camera] = args;
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
const probe = {
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
