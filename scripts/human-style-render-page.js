import * as T from "three";

const canvas = document.createElement("canvas"), small = document.createElement("canvas"), pen = small.getContext("2d", { willReadFrequently: true });
const renderer = new T.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
const scene = new T.Scene(), camera = new T.OrthographicCamera(), figure = new T.Group();
const inside = new T.MeshBasicMaterial({ color: new T.Color().setRGB(1, .25, .25, T.SRGBColorSpace), side: T.BackSide });
scene.add(camera, figure);
camera.add(new T.AmbientLight(0xffffff, .2 * Math.PI));
for (const [direction, strength] of [[[-.45, .62, .64], .78], [[.7, .15, .5], .2], [[.2, .5, -.85], .1]]) {
  const light = new T.DirectionalLight(0xffffff, strength * Math.PI), aim = new T.Object3D();
  light.position.fromArray(direction);
  light.target = aim;
  camera.add(light, aim);
}

const bytes = async text => (await fetch("data:application/octet-stream;base64," + text)).arrayBuffer();

globalThis.styleRenderer = {
  info() {
    const gl = renderer.getContext(), info = gl.getExtension("WEBGL_debug_renderer_info");
    return String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
  },
  async load({ buffers, meshes }) {
    for (const mesh of figure.children) { mesh.geometry.dispose(); if (mesh.material !== inside) mesh.material.dispose(); }
    figure.clear();
    const data = await Promise.all(buffers.map(bytes));
    for (const { positions, indices, normals, color } of meshes) {
      const geometry = new T.BufferGeometry();
      geometry.setAttribute("position", new T.BufferAttribute(new Float32Array(data[positions]), 3));
      geometry.setIndex(new T.BufferAttribute(new Uint32Array(data[indices]), 1));
      if (normals === null) geometry.computeVertexNormals();
      else geometry.setAttribute("normal", new T.BufferAttribute(new Float32Array(data[normals]), 3));
      const material = new T.MeshStandardMaterial({ color: new T.Color().setRGB(...color, T.SRGBColorSpace), roughness: .85, metalness: 0 });
      figure.add(new T.Mesh(geometry, material), new T.Mesh(geometry, inside));
    }
    return figure.children.length / 2;
  },
  draw({ yaw = 0, pitch = 0, center = [0, .9, 0], span = 2, width = 400, height = 800, background = [.93, .93, .92], supersample = 2 }) {
    const wide = span * width / height;
    renderer.setPixelRatio(1);
    renderer.setSize(width * supersample, height * supersample, false);
    renderer.setClearColor(new T.Color().setRGB(...background, T.SRGBColorSpace));
    Object.assign(camera, { left: -wide / 2, right: wide / 2, top: span / 2, bottom: -span / 2, near: .1, far: 40 });
    camera.updateProjectionMatrix();
    camera.position.set(center[0] + Math.sin(yaw) * Math.cos(pitch) * 20, center[1] + Math.sin(pitch) * 20, center[2] + Math.cos(yaw) * Math.cos(pitch) * 20);
    camera.lookAt(center[0], center[1], center[2]);
    renderer.render(scene, camera);
    small.width = width;
    small.height = height;
    pen.imageSmoothingQuality = "high";
    pen.drawImage(canvas, 0, 0, width, height);
    const pixels = pen.getImageData(0, 0, width, height).data;
    let text = "";
    for (let i = 0; i < pixels.length; i += 0x8000) text += String.fromCharCode.apply(null, pixels.subarray(i, i + 0x8000));
    return btoa(text);
  },
};
