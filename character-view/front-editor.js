import * as T from "three";
import { headFrame, registerFrontPairs } from "./front-fit.js";

// Keep the photograph local. The recipe records the artist's selected surface
// positions and the corresponding offsets at the scale of the current head.
export function frontEditor({
  getFace,
  getRenderer,
  restoreView,
  save,
  status,
}) {
  const byId = (id) => document.getElementById(id),
    dialog = byId("front-room"),
    picker = byId("front-file"),
    faceCanvas = byId("front-model"),
    photoCanvas = byId("front-photo"),
    apply = byId("front-apply"),
    reading = byId("front-reading");
  const modelPicture = document.createElement("canvas");
  modelPicture.width = modelPicture.height = 600;
  const ray = new T.Raycaster();
  let probe = null,
    camera = null,
    photo = null,
    half = 1,
    pairs = [],
    pending = null,
    token = 0;
  function draw(note) {
    function panel(canvas, im, pts) {
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!im) return;
      ctx.drawImage(im, 0, 0, canvas.width, canvas.height);
      const ratio =
        canvas.width / Math.max(1, canvas.getBoundingClientRect().width);
      for (const [[x, y], i] of pts.map((xy, i) => [xy, i])) {
        ctx.beginPath();
        ctx.arc(x * canvas.width, y * canvas.height, 3 * ratio, 0, 2 * Math.PI);
        ctx.fillStyle = i < 2 ? "#f7dc65" : "#39ecc1";
        ctx.fill();
        ctx.strokeStyle = "#183834";
        ctx.lineWidth = ratio;
        ctx.stroke();
        ctx.font = "bold " + Math.round(10 * ratio) + "px sans-serif";
        ctx.lineWidth = 2 * ratio;
        const tx = x * canvas.width + 4 * ratio,
          ty = y * canvas.height - 4 * ratio;
        ctx.strokeText(String(i + 1), tx, ty);
        ctx.fillText(String(i + 1), tx, ty);
      }
    }
    const norm = (at) => [0.5 + at[0] / (2 * half), 0.5 - at[1] / (2 * half)];
    panel(faceCanvas, modelPicture, [
      ...pairs.map((p) => norm(p.at)),
      ...(pending ? [norm(pending)] : []),
    ]);
    panel(
      photoCanvas,
      photo,
      pairs.map((p) => p.uv),
    );
    if (!photo) note ??= "Choose a cropped, front-facing portrait.";
    else if (pending) note ??= "Now mark the same point on the photograph.";
    else if (pairs.length < 2)
      note ??=
        "Mark alignment point " +
        (pairs.length + 1) +
        " on the model, then on the photograph. Use two widely separated points such as the nose bridge and chin.";
    else
      note ??=
        pairs.length +
        " pairs. Select another feature on the model, or apply the fit.";
    byId("front-undo").disabled = !pending && !pairs.length;
    apply.disabled = !!pending || pairs.length < 3;
    reading.textContent = note;
  }
  function xy(canvas, e) {
    const box = canvas.getBoundingClientRect();
    return [
      (e.clientX - box.left) / box.width,
      (e.clientY - box.top) / box.height,
    ];
  }
  faceCanvas.onclick = (e) => {
    if (!photo || !probe) return;
    if (pairs.length >= 32) return draw("This pass already has 32 pairs.");
    const [x, y] = xy(faceCanvas, e);
    ray.setFromCamera(new T.Vector2(2 * x - 1, 1 - 2 * y), camera);
    const hit = ray.intersectObject(probe, false)[0];
    if (!hit) return draw("Choose a visible point on the face.");
    pending = hit.point.toArray();
    draw();
  };
  photoCanvas.onclick = (e) => {
    if (!pending || !photo) return;
    const uv = xy(photoCanvas, e),
      p = {
        at: pending,
        uv,
        photo: [uv[0], (-uv[1] * photo.naturalHeight) / photo.naturalWidth],
      };
    const next = [...pairs, p];
    if (next.length >= 3)
      try {
        registerFrontPairs(next);
      } catch (error) {
        return draw(error.message);
      }
    if (
      next.length === 2 &&
      (Math.hypot(...next[0].at.slice(0, 2).map((n, k) => n - p.at[k])) <
        0.12 ||
        Math.hypot(...p.photo.map((n, k) => n - next[0].photo[k])) < 0.02)
    )
      return draw("Place the second alignment point farther from the first.");
    pairs = next;
    pending = null;
    draw();
  };
  byId("front-undo").onclick = () => {
    if (pending) pending = null;
    else pairs.pop();
    draw();
  };
  byId("front-close").onclick = () => dialog.close();
  apply.onclick = () => {
    try {
      save(registerFrontPairs(pairs, Number(byId("front-reach").value) / 100));
      dialog.close();
    } catch (e) {
      draw(e.message);
    }
  };
  picker.onchange = async () => {
    const current = ++token,
      file = picker.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    try {
      const im = new Image();
      im.src = url;
      await im.decode();
      if (current !== token) return;
      photo = im;
      pairs = [];
      pending = null;
      const ratio = 750 / Math.max(im.naturalWidth, im.naturalHeight);
      photoCanvas.width = Math.max(1, Math.round(im.naturalWidth * ratio));
      photoCanvas.height = Math.max(1, Math.round(im.naturalHeight * ratio));
      draw();
    } catch {
      if (current === token) draw("This photograph could not be opened.");
    } finally {
      URL.revokeObjectURL(url);
    }
  };
  dialog.addEventListener("close", () => {
    token++;
    photo = null;
    probe = null;
    camera = null;
    pairs = [];
    pending = null;
    picker.value = "";
    photoCanvas.width = photoCanvas.height = 1;
  });
  return () => {
    const face = getFace();
    if (!face) return status("Select a face first.");
    const f = headFrame(face);
    half = f.half;
    probe = new T.Mesh(face.geometry, face.material);
    probe.scale.copy(f.factor);
    probe.position.copy(f.center).multiply(f.factor).negate();
    const scene = new T.Scene();
    scene.background = new T.Color("#dce3df");
    scene.add(probe);
    scene.add(new T.HemisphereLight(0xfff7e9, 0x888d94, 1.8));
    const sun = new T.DirectionalLight(0xfff5df, 2.2);
    sun.position.set(-2, 2, 4);
    scene.add(sun);
    const renderer = getRenderer(),
      c = renderer.domElement,
      aspect = c.width / c.height,
      hh = half / Math.min(aspect, 1);
    const capture = new T.OrthographicCamera(
      -hh * aspect,
      hh * aspect,
      hh,
      -hh,
      0.01,
      16,
    );
    capture.position.z = 8;
    capture.updateMatrixWorld();
    try {
      renderer.render(scene, capture);
      const side = Math.min(c.width, c.height);
      modelPicture
        .getContext("2d")
        .drawImage(
          c,
          (c.width - side) / 2,
          (c.height - side) / 2,
          side,
          side,
          0,
          0,
          600,
          600,
        );
    } finally {
      restoreView();
    }
    camera = new T.OrthographicCamera(-half, half, half, -half, 0.01, 16);
    camera.position.z = 8;
    camera.updateMatrixWorld();
    dialog.showModal();
    draw();
  };
}
