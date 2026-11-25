import { MeshStandardMaterial, Vector3 } from "three";
import { evaluateHuman } from "./human-surface.js";
import { humanRegions } from "./human-mesh.js";
import { bakeNativePortrait, nativeHead, portraitLandmarks, setNativePortrait } from "./native-portrait.js";
export { setNativePortrait } from "./native-portrait.js";
import { storeArtworkBlob } from "./turnaround.js";

export function bakePortraitForForm(form, images, marks) {
  const head = nativeHead(form);
  if (!head) throw new Error("Choose an editable native human head.");
  const surface = evaluateHuman(form.human, form.humanFit, form.humanDetail);
  const origin = new Vector3().fromArray(surface.joints, 3 * surface.names.indexOf("head"));
  const group = humanRegions(form, color => new MeshStandardMaterial({ color }), false)(head);
  try {
    const mesh = group.children.find(node => node.userData.faceSurface);
    return bakeNativePortrait(mesh, surface, origin, images.front, images.side, marks);
  } finally {
    group.traverse(node => {
      node.geometry?.dispose();
      if (node.userData.ownedPortraitTexture) node.material.map?.dispose();
      node.material?.dispose();
    });
  }
}

function control(tag, label) {
  const button = document.createElement(tag);
  button.textContent = label;
  return button;
}

export function nativePortraitEditor(container, read, commit) {
  const dialog = document.createElement("dialog");
  dialog.style.cssText = "max-width:90vw;max-height:92dvh;overflow:auto";
  const title = control("h2", "Paint the native face");
  const hint = control("p", "Choose matching, evenly lit front and right-facing profile photos.");
  hint.setAttribute("aria-live", "polite");
  const close = control("button", "Close");
  close.onclick = () => dialog.close();
  const apply = control("button", "Bake portrait");
  const undo = control("button", "Undo last mark");
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:static;width:auto;height:auto;max-width:min(76vw,480px);max-height:53vh;cursor:crosshair";
  const images = {}, marks = { front: [], side: [] };
  const pick = document.createElement("select");
  pick.setAttribute("aria-label", "Portrait view");
  pick.replaceChildren(new Option("Front", "front"), new Option("Right-facing profile", "side"));
  const adjust = document.createElement("select");
  adjust.setAttribute("aria-label", "Landmark to adjust");
  const preview = () => {
    const view = pick.value, im = images[view], points = marks[view], names = portraitLandmarks[view];
    const selected = adjust.value;
    adjust.replaceChildren(new Option("Add next landmark", ""),
      ...points.map((_, index) => new Option(`Adjust ${names[index].toLowerCase()}`, String(index))));
    if (selected !== "" && Number(selected) < points.length) adjust.value = selected;
    adjust.disabled = !points.length;
    canvas.style.display = im ? "block" : "none";
    apply.disabled = !Object.keys(marks).every(k => marks[k].length === portraitLandmarks[k].length);
    undo.disabled = !points.length;
    if (!im) return;
    canvas.width = im.width;
    canvas.height = im.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(im, 0, 0);
    for (const [index, [x, y]] of points.entries()) {
      ctx.strokeStyle = String(index) === adjust.value ? "#93e0fc" : "#ffe075";
      ctx.lineWidth = Math.max(2, im.width * .0025);
      ctx.beginPath();
      ctx.arc(x * canvas.width, y * canvas.height, im.width * .009, 0, Math.PI * 2);
      ctx.stroke();
    }
    hint.textContent = adjust.value !== "" ? `Click the new position for ${names[Number(adjust.value)].toLowerCase()}.`
      : points.length < names.length ? `Mark ${names[points.length].toLowerCase()}.`
      : `All ${view} landmarks are marked. Select one to adjust it.`;
  };
  adjust.onchange = preview;
  pick.onchange = () => { adjust.value = ""; preview(); };
  canvas.onclick = event => {
    const view = pick.value, points = marks[view], box = canvas.getBoundingClientRect();
    const point = [(event.clientX - box.left) / box.width, (event.clientY - box.top) / box.height];
    if (adjust.value !== "") {
      points[Number(adjust.value)] = point;
      adjust.value = "";
    } else if (points.length < portraitLandmarks[view].length) points.push(point);
    preview();
  };
  undo.onclick = () => { marks[pick.value].pop(); preview(); };
  const files = ["front", "side"].map(view => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    const label = control("label", view === "front" ? "Front image" : "Profile image");
    label.className = "field";
    label.append(input);
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      const url = URL.createObjectURL(file);
      try {
        const image = new Image();
        image.src = url;
        await image.decode();
        const c = document.createElement("canvas"), scale = Math.min(1, 1400 / Math.max(image.width, image.height));
        c.width = Math.round(image.width * scale);
        c.height = Math.round(image.height * scale);
        c.getContext("2d").drawImage(image, 0, 0, c.width, c.height);
        images[view] = c;
        marks[view] = [];
        pick.value = view;
        adjust.value = "";
        preview();
      } catch {
        hint.textContent = "Could not open this picture.";
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    return label;
  });
  apply.onclick = async () => {
    apply.disabled = true;
    try {
      const form = read(), canvas = bakePortraitForForm(form, images, marks);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/webp", .94));
      const artwork = await storeArtworkBlob(blob, "nativeportrait");
      if (read() !== form || !dialog.open) return;
      commit(setNativePortrait(form, artwork), "Portrait paint applied.");
      dialog.close();
    } catch (error) {
      hint.textContent = error.message;
      apply.disabled = false;
    }
  };
  dialog.append(title, ...files, pick, adjust, hint, canvas, undo, apply, close);
  document.body.append(dialog);
  const open = control("button", "Paint from front and profile");
  open.onclick = () => { preview(); dialog.showModal(); };
  const clear = control("button", "Remove portrait paint");
  clear.onclick = () => commit(setNativePortrait(read(), null), "Portrait paint removed.");
  container.append(open, clear);
  return form => { clear.hidden = !nativeHead(form)?.nativePortrait; };
}
