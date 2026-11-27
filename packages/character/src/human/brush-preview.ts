import { isMesh } from "../mesh.js";
import * as T from "three";
import { applyHeadLayer } from "./fine-head.js";
import type { FineHeadLayer, SkinCorrections, Vec3 } from "@irudd/document";
import type { HumanBody } from "./body.js";
import { skinStroke, correctedSurface } from "./brush.js";
import { smoothHumanSurface, type SmoothSurface } from "./smooth.js";
import type { HumanSurface } from "./surface.js";
import { refineFaceForm } from "./anatomy.js";

interface SkinMesh {
  body: HumanBody;
  bare: HumanSurface;
  fineHead: FineHeadLayer | undefined;
  cage: HumanSurface;
  surface: SmoothSurface;
  origin: Vec3;
  corners: readonly number[];
  vertices: readonly number[];
}
export const skinMeshData = new WeakMap<T.Object3D, SkinMesh>();
export function startSkinStroke(
  root: T.Object3D,
  mesh: T.Object3D,
  face: number,
  world: Vec3,
  fit: SkinCorrections | undefined,
  reach: number,
  mirror: boolean,
) {
  const data = skinMeshData.get(mesh);
  if (!data) throw new Error("Start on bare adult skin.");
  const { surface, bare, cage, body } = data;
  const corner = data.corners[face * 3];
  const quad = corner === undefined ? undefined : surface.parentFaces[corner / 3];
  if (quad === undefined) throw new Error("Choose a point on the adult body.");
  const seed = surface.quadIds.slice(quad * 4, quad * 4 + 4);
  const local = mesh.worldToLocal(new T.Vector3(...world)).add(new T.Vector3(...data.origin));
  const work = skinStroke(body, cage, fit, Array.from(seed), local.toArray(), reach, mirror);
  const targets: { mesh: T.Mesh; ids: readonly number[]; pos: Float32Array; norm: Float32Array }[] =
    [];
  root.traverse((o) => {
    const tag = skinMeshData.get(o);
    if (isMesh(o) && tag?.surface === surface)
      targets.push({
        mesh: o,
        ids: tag.vertices,
        pos: new Float32Array(o.geometry.getAttribute("position").array),
        norm: new Float32Array(o.geometry.getAttribute("normal").array),
      });
  });
  const inverse = new T.Matrix3().setFromMatrix4(mesh.matrixWorld).invert();
  const whole = new T.BufferGeometry();
  whole.setIndex(new T.BufferAttribute(surface.indices, 1));
  return {
    radius: work.radius,
    apply(delta: Vec3 | number) {
      const next = work.apply(
        typeof delta === "number" ? delta : new T.Vector3(...delta).applyMatrix3(inverse).toArray(),
      );
      const fitted = refineFaceForm(
        body,
        smoothHumanSurface(
          body,
          applyHeadLayer(body, correctedSurface(body, bare, next), data.fineHead),
        ),
      );
      whole.setAttribute("position", new T.BufferAttribute(fitted.positions, 3));
      whole.computeVertexNormals();
      const normals = whole.getAttribute("normal");
      const displacement = new T.Vector3(),
        rest = new T.Vector3(),
        normal = new T.Vector3();
      for (const target of targets) {
        const pos = target.mesh.geometry.getAttribute("position"),
          norm = target.mesh.geometry.getAttribute("normal");
        target.ids.forEach((v, i) => {
          displacement
            .fromArray(fitted.positions, v * 3)
            .sub(rest.fromArray(surface.positions, v * 3));
          if (displacement.lengthSq()) normal.fromBufferAttribute(normals, v);
          else normal.fromArray(target.norm, i * 3);
          displacement.add(rest.fromArray(target.pos, i * 3));
          pos.setXYZ(i, displacement.x, displacement.y, displacement.z);
          norm.setXYZ(i, normal.x, normal.y, normal.z);
        });
        pos.needsUpdate = norm.needsUpdate = true;
      }
      return next;
    },
    restore() {
      for (const t of targets) {
        const p = t.mesh.geometry.getAttribute("position"),
          n = t.mesh.geometry.getAttribute("normal");
        p.array.set(t.pos);
        n.array.set(t.norm);
        p.needsUpdate = n.needsUpdate = true;
      }
      whole.dispose();
    },
  };
}
