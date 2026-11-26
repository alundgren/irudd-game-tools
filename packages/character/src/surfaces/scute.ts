import * as T from "three";

export function scuteGeometry(): T.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const rows = 24;
  const cols = 40;
  for (let r = 0; r <= rows; r++) {
    const t = r / rows;
    const width = 0.5 * Math.max(0.012, Math.sin(Math.PI * t) ** 0.66 * (1.3 - 0.85 * t));
    for (let c = 0; c <= cols; c++) {
      const a = (c / cols) * Math.PI * 2;
      const side = Math.sin(a);
      const front = Math.cos(a);
      const x = side * width;
      const lip = Math.sin(t * Math.PI) ** 0.75;
      const crown =
        front > 0 ? (0.22 + 0.28 * (1 - Math.abs(side)) ** 2) * front : -0.19 * Math.abs(front);
      const z = lip * crown + 0.23 * t * t + 0.028 * Math.cos(3 * Math.PI * t) * lip;
      pos.push(x, 0.5 - t, z);
      uv.push(c / cols, 1 - t);
      if (r < rows && c < cols) {
        const i = r * (cols + 1) + c;
        const j = i + cols + 1;
        idx.push(i, j, i + 1, i + 1, j, j + 1);
      }
    }
  }
  for (let i = 1; i < cols - 1; i++) {
    idx.push(0, i + 1, i);
    const end = rows * (cols + 1);
    idx.push(end, end + i, end + i + 1);
  }
  const g = new T.BufferGeometry();
  g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
