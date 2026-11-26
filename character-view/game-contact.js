import { Box3, Float32BufferAttribute, Matrix3, Vector3 } from "three";
import { raycaster } from "./human-style-kit.js";

const directions = Array.from({ length: 32 }, (_, i) => {
  const y = 1 - 2 * (i + 0.5) / 32;
  const r = Math.sqrt(1 - y * y);
  const angle = Math.PI * (3 - Math.sqrt(5)) * i;
  return [r * Math.cos(angle), y, r * Math.sin(angle)];
});

export function contactRampRows(size) {
  return Math.min(16, Math.floor(size / 8));
}

export function drawContactRamp(context, size) {
  const rows = contactRampRows(size);
  for (let x = 0; x < size; x++) {
    const shade = Math.round(255 * x / (size - 1));
    context.fillStyle = "rgb(" + shade + ",255,0)";
    context.fillRect(x, size - rows, 1, rows);
  }
}

function casts(material) {
  return !(material.alphaTest || material.transparent || material.userData.fibreLOD);
}

export function bakeContact(work, size) {
  const positions = [], triangles = [];
  const bounds = new Box3(), p = new Vector3(), n = new Vector3();
  for (const { mesh, groups } of work) {
    const geometry = mesh.geometry, offset = positions.length / 3;
    for (let i = 0; i < geometry.attributes.position.count; i++) {
      p.fromBufferAttribute(geometry.attributes.position, i).applyMatrix4(mesh.matrixWorld);
      positions.push(p.x, p.y, p.z);
      bounds.expandByPoint(p);
    }
    let start = 0;
    for (const group of groups) {
      const end = start + group.result.length;
      if (casts(group.material))
        for (let j = start; j < end; j++) triangles.push(offset + geometry.index.getX(j));
      start = end;
    }
  }
  const span = bounds.getSize(p);
  const radius = 0.033 * Math.max(span.x, span.y, span.z);
  const query = raycaster(positions, triangles, Math.max(radius * 0.65, 0.0001));
  const origin = [0, 0, 0], rampV = contactRampRows(size) / (2 * size);
  for (const { mesh, groups } of work) {
    const g = mesh.geometry, attributes = g.attributes;
    const normalTransform = new Matrix3().getNormalMatrix(mesh.matrixWorld);
    const values = new Float32Array(attributes.position.count * 2);
    const visited = new Uint8Array(attributes.position.count);
    let offset = 0;
    for (const { material, result } of groups) {
      const end = offset + result.length;
      for (; offset < end; offset++) {
        const i = g.index.getX(offset);
        if (visited[i]) continue;
        visited[i] = 1;
        if (material.aoMap?.image) {
          values[2*i] = attributes.uv.getX(i);
          values[2*i+1] = attributes.uv.getY(i);
          continue;
        }
        let visibility = 1;
        if (radius > 0 && casts(material) && !mesh.userData.eyePiece && !mesh.userData.fittedEyes) {
          p.fromBufferAttribute(attributes.position, i).applyMatrix4(mesh.matrixWorld);
          n.fromBufferAttribute(attributes.normal, i).applyNormalMatrix(normalTransform);
          p.addScaledVector(n, radius * 0.025).toArray(origin);
          let blocked = 0, total = 0;
          for (const dir of directions) {
            const weight = n.x * dir[0] + n.y * dir[1] + n.z * dir[2];
            if (weight <= 0) continue;
            total += weight;
            const hit = query(origin, dir, radius);
            if (hit < radius) blocked += weight * (1 - hit / radius) ** 2;
          }
          if (total) visibility -= 0.82 * blocked / total;
        }
        values[2*i] = (0.5 + (size - 1) * visibility) / size;
        values[2*i+1] = rampV;
      }
    }
    g.setAttribute("uv1", new Float32BufferAttribute(values, 2));
  }
}
