import { surfaceMarkEditor, validSurfaceMarks } from "./surface-marks.js";
import { branchPlacement } from "./branch-placement.js";
import { fitEyeSettings } from "./ocular.js";
import { spatialGuide } from "./spatial-guide.js";
import { poseEditor } from "./pose-editor.js";
import { scaleRoom } from "./scale-room.js";
import { visibleBounds } from "./dimensions.js";
import { editCage } from "./control-cage.js";
import { spineHandles } from "./spine-handles.js";
import { acceptsDepth } from "./portrait-depth.js";
import { reshapeSpine } from "./spine-edit.js";
import { plateGrowthEditor } from "./plate-growth-editor.js";
import { fibreEditor } from "./fibre-editor.js";
import { reusePaintEditor } from "./reuse-paint-editor.js";
import { wardrobeEditor } from "./wardrobe-editor.js";
import { readReference, validReferences } from "./visual-references.js";
import { acceptsMarkings, validMarkings } from "./markings.js";
import { armChain, bendElbow, recutArmSleeves, fitHand } from "./graft.js";
import { movementRoles } from "./skin.js";
import { palmColor } from "./turnaround.js";
import {
  listAlternates,
  saveAlternate,
  loadAlternate,
  removeAlternate,
} from "./alternates.js";
import { parseDecks, drawDecks, deckText } from "./choice-decks.js";
import { groomDefaults } from "./groom.js";
import * as T from "three";
import { inspectGameExport, compareExportViews } from "./export-review.js";
import { exportForm } from "./export-form.js";
import { paintWithAgent } from "./art-variation.js";
import { canBlend, bodyRegion } from "./blended-skin.js";
import { drawTool } from "./draw-tool.js";
import { drawBranch, branchTypes } from "./branch-stroke.js";
import { pullTool } from "./pull-tool.js";
import { readSession, saveSession } from "./session.js";
import { motionPreview } from "./motion-preview.js";
import {
  drawVariation,
  agentDesign,
  redrawDirection,
  directionCode,
  replayDirection,
} from "./variations.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { manipulator, findPart } from "./manipulator.js";
import { appendPart, copyBranch, removePart } from "./parts.js";
import { componentShelf, generateWorkshopForm } from "./components.js";
import { extractComponent, placeComponent } from "./graft.js";
import { generateForm } from "./generator.js";
import { buildTraceMap } from "./trace-map.js";
import tidebellMap from "../examples/tidebell.trace.json";
import glider from "../examples/estuary-glider.form.json";
import beetle from "../examples/accepted-beetle.form.json";
import { studies as proceduralStudies } from "../examples/studies.js";
import { paintedStudies } from "../examples/painted-studies.js";
import { equipPlateRows, repeatOnSpine } from "./scutes.js";
import { outfitRoles } from "./wardrobe.js";
import { faceHandles } from "./face-handles.js";
import { frontEditor } from "./front-editor.js";
import { headFrame } from "./front-fit.js";
import { profileEditor } from "./profile-editor.js";
import { isFace } from "./facial-sculpt.js";
import { bindTraceEditor } from "./trace-editor.js";
import { loadTurnarounds, restoreArtwork } from "./turnaround.js";
const studies = [
  ...proceduralStudies,
  ...paintedStudies,
  {
    id: "tidebell",
    title: "Tidebell · open carapace",
    game: "Artwork fit",
    make: () => buildTraceMap(tidebellMap, "tidebell"),
  },
  {
    id: "glider",
    title: "Estuary glider",
    game: "AI trial",
    make: () => structuredClone(glider.form),
  },
  {
    id: "beetle",
    title: "Beetle hybrid",
    game: "AI trial",
    make: () => structuredClone(beetle.form),
  },
];
import { loadSurfaces } from "./materials.js";
import { loadFacePaint } from "./face.js";
import { createCharacter, disposeCharacter } from "./model.js";
import {
  startingForm,
  motionRoles,
  nudge,
  neutral,
  outfits,
  entropy,
  makeBrief,
  readProposal,
  validateForm,
  anchors,
  modes,
} from "./recipe.js";

const $ = (selector) => document.querySelector(selector);
let form = generateForm(),
  revision = crypto.randomUUID(),
  amounts = neutral(),
  target = null,
  instructions = "",
  request = null;
let references = [],
  surfaceMarks = [],
  markOwner = null,
  markTool;
let restored = false,
  customDonor = null,
  assetsReady = false;
let variation = drawVariation(),
  protectedIds = new Set();
const history = [];
function restoreSessionState(saved) {
  try {
    if (saved && typeof saved.revision === "string") {
      form = validateForm(saved.form);
      restored = true;
      if (validReferences(saved.references)) references = saved.references;
      revision = saved.revision;
      protectedIds = new Set(
        (Array.isArray(saved.protectedIds) ? saved.protectedIds : []).filter(
          (id) => form.parts.some((p) => p.id === id),
        ),
      );
      if (saved.variation?.seed !== undefined)
        variation = replayDirection(directionCode(saved.variation));
      if (saved.target && form.parts.some((p) => p.id === saved.target))
        target = saved.target;
      if (saved.amounts)
        for (const key of Object.values(modes).flat())
          if (Number.isFinite(saved.amounts[key]))
            amounts[key] = Math.max(-40, Math.min(40, saved.amounts[key]));
      instructions =
        typeof saved.instructions === "string" ? saved.instructions : "";
      const savedRequest = saved.request;
      if (
        savedRequest?.revision === revision &&
        savedRequest.format === "irudd.form-request.v1"
      ) {
        validateForm(savedRequest.preview);
        request = savedRequest;
        amounts = { ...(request.nudge.amounts ?? request.nudge.percent) };
        target = request.nudge.target;
        instructions = request.instructions;
      }
      const review = saved.review;
      if (review?.proposal?.form) {
        restoredReviewAtLink = review.hash === location.hash;
        validateForm(review.proposal.form);
        proposal = review.proposal;
        const earlier = Array.isArray(review.history)
          ? review.history.slice(-8)
          : [];
        for (const p of earlier) validateForm(p.form);
        reviewHistory = earlier;
        if (
          review.pending?.revision === revision &&
          review.pending.format === "irudd.form-request.v1"
        ) {
          validateForm(review.pending.preview);
          refineRequest = review.pending;
        }
        $("#refine-note").value = review.notes ?? "";
      }
      if (validSurfaceMarks(saved.surfaceMarks)) {
        surfaceMarks = saved.surfaceMarks;
        markOwner = proposal ?? form;
      }
    }
  } catch {
    status("The previous session could not be restored.");
  }
}
let generationController,
  updateWardrobe,
  updateFibres,
  updateReusePaint,
  updatePlateGrowth;
const inspectedProposals = new WeakMap();
let exportReview = null,
  inspecting = false,
  compareExport = false,
  shownReview = null;
let reviewHistory = [],
  refineRequest = null,
  restoredReviewAtLink = false;
let clay = false,
  worldScale = false,
  silhouette = false,
  proposal = null,
  showCurrent = false,
  busy = false;
const connected =
  document.querySelector('meta[name="workshop-agent"]')?.content === "local";
const scene = new T.Scene();
scene.background = new T.Color("#dce4e1");
const camera = new T.OrthographicCamera(-1, 1, 1, -1, 0.05, 50);
let figure,
  displayedForm = null,
  displayedInk = null;
const stage = $("#stage");
const canvas = $("#viewport");

const views = {
  "3/4": [2.1, 1.36, 4.25],
  Front: [0, 0, 4.8],
  Portrait: [-2.06, 0, 4.33],
  Side: [4.8, 0, 0],
  Back: [0, 0, -4.8],
};
const axes = Object.values(modes).flat();
let operation = "shape",
  pulling = false,
  drawing = false;
let renderer,
  controls,
  gizmo,
  placeHandles,
  placement,
  placeSpine,
  spinePreview,
  playback,
  direct = false,
  cageFace = 0,
  knot = null;

function button(label, handler) {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = label;
  element.addEventListener("click", handler);
  return element;
}
function pressed(element, state) {
  element.setAttribute("aria-pressed", String(state));
}
function status(text) {
  $("#status").textContent = text;
}
function persist() {
  saveSession({
    review: proposal
      ? {
          proposal,
          hash: location.hash,
          history: reviewHistory,
          pending: refineRequest,
          notes: $("#refine-note").value,
        }
      : null,
    form,
    revision,
    request,
    variation,
    protectedIds: [...protectedIds],
    target,
    amounts: { ...amounts },
    instructions,
    references,
    surfaceMarks: markOwner === (proposal ?? form) ? surfaceMarks : [],
  }).catch(() =>
    status(
      "Browser storage is unavailable. Use Save form to keep this revision.",
    ),
  );
}
function clearReview() {
  reviewHistory = [];
  refineRequest = null;
  $("#refine-note").value = "";
}
function clearDraft() {
  placement?.cancel();
  clearReview();
  knot = null;
  amounts = neutral();
  request = null;
  proposal = null;
  showCurrent = false;
}
function commit(next, message, keepKnot = false) {
  const selectedKnot = knot;
  if (
    next.artwork &&
    Object.keys(next.artwork).some((id) => !id.startsWith("art-"))
  ) {
    const keep = new Set(
      next.parts.flatMap((p) => [
        p.profileFit?.paint?.atlas,
        ...(p.frontFits ?? []).map((f) => f.overlay),
      ]),
    );
    next = {
      ...next,
      artwork: Object.fromEntries(
        Object.entries(next.artwork).filter(
          ([id]) => id.startsWith("art-") || keep.has(id),
        ),
      ),
    };
  }
  validateForm(next);
  history.push(form);
  if (history.length > 64) history.shift();
  form = next;
  protectedIds = new Set(
    [...protectedIds].filter((id) => form.parts.some((p) => p.id === id)),
  );
  revision = crypto.randomUUID();
  clearDraft();
  if (keepKnot) knot = selectedKnot;
  if (!form.parts.some((p) => p.id === target)) target = null;
  if (
    (operation === "face" && !form.parts.some(isFace)) ||
    (!target && operation === "turn")
  )
    operation = "shape";
  persist();
  update();
  status(message);
}
function chooseAngle(name, resetZoom = false) {
  if (worldScale && resetZoom) {
    controls.target.set(0, 1.05, 0);
    camera.zoom = (camera.top - camera.bottom) / 2.65;
    camera.updateProjectionMatrix();
  } else if (resetZoom && figure) {
    const bounds = visibleBounds(figure);
    bounds.getCenter(controls.target);
    const ext = bounds.getSize(new T.Vector3());
    camera.zoom = Math.min(
      3,
      (camera.top - camera.bottom) / Math.max(ext.y * 1.32, ext.z * 0.55, 0.35),
      (camera.right - camera.left) / (Math.max(ext.x, ext.z) * 1.45 + 0.06),
    );
    camera.updateProjectionMatrix();
  } else if (!figure) controls.target.set(0, 0.9, 0);
  camera.position.copy(controls.target).add(new T.Vector3(...views[name]));
  controls.update();
  for (const el of $("#angles").children)
    pressed(el, el.dataset.angle === name);
  render();
}
function selectTarget(id) {
  if (busy || proposal) return;
  if (axes.some((k) => Boolean(amounts[k]))) {
    $("#target").value = target ?? "";
    status("Apply or reset the current nudge before selecting another part.");
    return;
  }
  placement?.cancel();
  target = id;
  knot = null;
  cageFace = 0;
  request = null;
  if (
    (operation === "build" && id) ||
    (operation === "turn" && !id) ||
    (operation === "face" && id && !isFace(form.parts.find((p) => p.id === id)))
  )
    operation = "shape";
  persist();
  update();
  status("");
}
function editPart(change, artwork) {
  try {
    const preview = nudge(form, target, amounts),
      part = preview.parts.find((p) => p.id === target);
    if (!part) return;
    const updated = change(part);
    let next = preview;
    if (
      part.shape === "sweep" &&
      updated.shape === "sweep" &&
      updated.knots !== part.knots
    )
      next = reshapeSpine(preview, target, updated.knots);
    next = {
      ...next,
      parts: next.parts.map((p) => (p.id === target ? updated : p)),
    };
    if (artwork) next.artwork = { ...next.artwork, [artwork.id]: artwork.url };
    commit(next, "Updated " + target + ".", true);
  } catch (e) {
    status(e.message);
    update();
    return e.message;
  }
}
function download(blob, name) {
  const url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}
function switchTab(name) {
  markTool?.cancel();
  if (
    name !== "sculpt" &&
    (placement?.active || direct || drawing || pulling)
  ) {
    placement?.cancel();
    direct = false;
    drawing = false;
    pulling = false;
    update();
  }
  for (const el of document.querySelectorAll("[data-tab]"))
    pressed(el, el.dataset.tab === name);
  for (const panel of document.querySelectorAll("[data-panel]"))
    panel.hidden = panel.dataset.panel !== name;
  markTool?.sync();
  markTool?.draw();
}
function focusFace() {
  if (!isFace(form.parts.find((p) => p.id === target)))
    target = form.parts.find(isFace)?.id ?? null;
  update();
  chooseAngle("Front");
  $("#focus").click();
}
function candidateForm(candidate = proposal) {
  return form.artwork && !candidate.painted && !candidate.alternate
    ? {
        ...candidate.form,
        artwork: { ...form.artwork, ...candidate.form.artwork },
      }
    : candidate.form;
}
function returnToDraft(message) {
  clearReview();
  variation = redrawDirection(variation, variation.strength);
  proposal = null;
  request = null;
  showCurrent = false;
  persist();
  update();
  status(message);
}
function bindAlternates() {
  const list = $("#alternate-list");
  let saving = false,
    version = 0;
  async function refresh() {
    const ticket = ++version,
      items = await listAlternates();
    if (ticket !== version) return;
    list.replaceChildren();
    for (const item of items) {
      const row = document.createElement("div"),
        open = document.createElement("button"),
        img = document.createElement("img"),
        label = document.createElement("span");
      row.className = "alternate";
      img.src = item.thumbnail;
      img.alt = "";
      label.textContent = item.title;
      open.append(img, label);
      open.onclick = async () => {
        if (busy || proposal) return;
        const before = revision;
        try {
          const stored = await loadAlternate(item.id);
          if (!stored)
            throw new Error("This variation is no longer on the shelf.");
          validateForm(stored);
          await restoreArtwork(stored);
          if (before !== revision || busy || proposal) return;
          proposal = { alternate: true, summary: item.title, form: stored };
          showCurrent = false;
          switchTab("ai");
          persist();
          update();
          status("Compare the saved variation with your current form.");
        } catch (e) {
          status(e.message);
        }
      };
      const remove = button("×", async () => {
        try {
          await removeAlternate(item.id);
          await refresh();
          status("Removed the saved variation.");
        } catch (e) {
          status(e.message);
        }
      });
      remove.className = "remove-alternate";
      remove.setAttribute("aria-label", "Remove " + item.title);
      row.append(open, remove);
      list.append(row);
    }
  }
  async function keep(candidate) {
    if (saving || busy || (candidate && !proposal)) return;
    saving = true;
    try {
      const saved = candidate ? candidateForm() : nudge(form, target, amounts);
      if (candidate && showCurrent) {
        showCurrent = false;
        update();
      }
      const thumbnail = document.createElement("canvas");
      thumbnail.width = 220;
      thumbnail.height = 180;
      render();
      const edge = Math.min(canvas.width, canvas.height),
        cropWidth = Math.min(canvas.width, (edge * 220) / 180);
      thumbnail
        .getContext("2d")
        .drawImage(
          canvas,
          (canvas.width - cropWidth) / 2,
          (canvas.height - edge) / 2,
          cropWidth,
          edge,
          0,
          0,
          220,
          180,
        );
      const entered = candidate ? "" : $("#alternate-name").value.trim();
      const title =
        entered ||
        (candidate
          ? proposal.summary
          : "Form · " + new Date().toLocaleString());
      const cover = {
        id: crypto.randomUUID(),
        title,
        savedAt: Date.now(),
        thumbnail: thumbnail.toDataURL("image/webp", 0.82),
      };
      const active = proposal;
      await saveAlternate(cover, saved);
      await refresh();
      if (candidate && proposal === active)
        returnToDraft(
          "Kept the alternate. The original is ready for another draw.",
        );
      else {
        if (!candidate) $("#alternate-name").value = "";
        status("Kept this form in Saved variations.");
      }
    } catch (e) {
      status("Could not keep this variation. " + e.message);
    } finally {
      saving = false;
    }
  }
  $("#keep-candidate").onclick = () => keep(true);
  $("#keep-current").onclick = () => keep(false);
  refresh().catch(() => {});
}
let renderedReferences, referencesLocked;
function refreshReferences(locked = false) {
  if (renderedReferences === references && referencesLocked === locked) return;
  renderedReferences = references;
  referencesLocked = locked;
  const list = $("#reference-list");
  list.replaceChildren(
    ...references.map((ref, i) => {
      const row = document.createElement("div"),
        image = document.createElement("img"),
        label = document.createElement("span");
      row.className = "alternate";
      image.src = "data:image/jpeg;base64," + ref.jpeg;
      image.alt = ref.label;
      label.textContent = ref.role + " · " + ref.label;
      const remove = button("Remove", () => {
        references = references.filter((_, j) => i !== j);
        request = null;
        persist();
        refreshReferences();
      });
      remove.setAttribute("aria-label", "Remove " + ref.label);
      remove.disabled = locked;
      row.append(image, label, remove);
      return row;
    }),
  );
  $("#reference-add").disabled = locked || references.length >= 2;
  $("#reference-role").disabled = locked;
}
function bindControls() {
  bindAlternates();
  const traceOutline = profileEditor((profileFit, artwork) =>
    editPart((p) => ({ ...p, profileFit }), artwork),
  );
  updateReusePaint = reusePaintEditor(
    () => nudge(form, target, amounts),
    commit,
    status,
  );
  updatePlateGrowth = plateGrowthEditor({
    current: () => nudge(form, target, amounts),
    selected: () => target,
    commit,
    status,
  });
  updateFibres = fibreEditor(
    () => nudge(form, target, amounts),
    commit,
    status,
  );
  updateWardrobe = wardrobeEditor({
    traceOutline,
    getForm: () => nudge(form, target, amounts),
    getTarget: () => target,
    commit,
    status,
  });
  $("#reference-add").onclick = () => $("#reference-file").click();
  $("#reference-file").onchange = async (e) => {
    const file = e.target.files[0],
      role = $("#reference-role").value;
    e.target.value = "";
    if (!file) return;
    try {
      const ref = await readReference(file, role);
      if (busy || proposal || references.length >= 2) return;
      references = [...references, ref];
      request = null;
      persist();
      refreshReferences();
      status("Attached " + ref.label + " for " + role.toLowerCase() + ".");
    } catch (error) {
      status(error.message);
    }
  };
  bindTraceEditor({
    getForm: () => form,
    getTarget: () => target,
    figurePart: (id) => findPart(figure, id),
    accept: (next, id) => {
      target = id;
      commit(next, "Volume created.");
      switchTab("sculpt");
      chooseAngle("3/4", true);
    },
    status,
  });
  function redraw() {
    variation = redrawDirection(variation, $("#variation-range").value);
    request = null;
    persist();
    update();
  }
  $("#variation-range").value = variation.strength;
  $("#variation-range").onchange = redraw;
  $("#draw-cue").onclick = redraw;
  $("#deck-input").value = deckText(variation.decks);
  $("#apply-decks").onclick = () => {
    try {
      const decks = drawDecks(
        parseDecks($("#deck-input").value),
        variation.seed,
        variation.decks,
      );
      const { decks: old, ...rest } = variation;
      variation = decks.length ? { ...rest, decks } : rest;
      request = null;
      persist();
      update();
      status(
        decks.length ? "Drew from your choices." : "Removed custom choices.",
      );
    } catch (e) {
      status(e.message);
    }
  };
  for (let i = 0; i < 2; i++)
    $("#pin-" + i).onchange = () => {
      const pins = [...(variation.pins ?? [null, null])];
      pins[i] = $("#pin-" + i).checked ? (pins[i] ?? variation.seed) : null;
      variation = { ...variation, pins };
      request = null;
      persist();
      update();
    };
  $("#direction-replay").onclick = () => {
    try {
      variation = replayDirection($("#direction-code").value);
      $("#variation-range").value = variation.strength;
      $("#deck-input").value = deckText(variation.decks);
      request = null;
      persist();
      update();
      status("Direction restored.");
    } catch (error) {
      status(error.message);
    }
  };
  function changeMarkings(action) {
    try {
      const base = nudge(form, target, amounts);
      const selected = base.parts.filter((p) =>
        target ? p.id === target && acceptsMarkings(p) : bodyRegion(p),
      );
      const seed = selected.find((p) => p.markings)?.markings.seed;
      const markings = {
        kind: $("#mark-kind").value,
        color: $("#mark-color").value,
        spacing: Number($("#mark-spacing").value) / 100,
        coverage: Number($("#mark-coverage").value) / 100,
        angle: Number($("#mark-angle").value),
        seed:
          action === "roll" || seed === undefined
            ? crypto.getRandomValues(new Uint32Array(1))[0]
            : seed,
      };
      if (action !== "clear" && !validMarkings(markings))
        throw new Error("Check the spacing, coverage and direction ranges.");
      const chosen = new Set(selected.map((p) => p.id));
      const parts = base.parts.map((p) => {
        if (!chosen.has(p.id)) return p;
        const edited = { ...p };
        if (action === "clear") delete edited.markings;
        else edited.markings = markings;
        return edited;
      });
      commit(
        { ...base, parts },
        action === "clear"
          ? "Removed surface markings."
          : "Applied " +
              markings.kind.toLowerCase() +
              " to " +
              chosen.size +
              " regions.",
      );
    } catch (error) {
      status(error.message);
    }
  }
  for (const action of ["apply", "roll", "clear"])
    $("#mark-" + action).onclick = () => changeMarkings(action);
  function skinChange(kind) {
    try {
      const base = nudge(form, target, amounts);
      const next = base.parts.map((p) => {
        const change =
          kind === "body"
            ? bodyRegion(p)
            : kind === "part"
              ? p.id === target && canBlend(p)
              : kind === "clear"
                ? p.blendSkin
                : false;
        if (!change) return p;
        return {
          ...p,
          blendSkin:
            kind === "clear" ? false : kind === "part" ? !p.blendSkin : true,
        };
      });
      commit(
        {
          ...base,
          parts: next,
          skinSoftness: Number($("#skin-softness").value),
          skinTint: $("#skin-color").value,
        },
        "Updated the shared skin.",
      );
    } catch (error) {
      status(error.message);
    }
  }
  for (const action of ["body", "part", "clear"])
    $("#skin-" + action).onclick = () => skinChange(action);
  $("#skin-color").onchange = () => skinChange("appearance");
  $("#skin-softness").onchange = () => skinChange("appearance");
  $("#branch-type").replaceChildren(
    ...branchTypes.map((k) => new Option(k, k)),
  );
  $("#place-branch").onclick = () => {
    if (placement.active) placement.cancel();
    else {
      drawing = false;
      pulling = false;
      direct = false;
      playback.bind();
      placement.start(target);
    }
    update();
  };
  $("#branch-tool").onclick = () => {
    placement?.cancel();
    drawing = !drawing;
    pulling = false;
    direct = false;
    playback.bind();
    update();
  };
  $("#pull-tool").onclick = () => {
    placement?.cancel();
    drawing = false;
    pulling = !pulling;
    if (pulling) {
      direct = false;
      playback.bind();
    }
    update();
  };
  $("#protect").onclick = () => {
    if (target) {
      if (protectedIds.has(target)) protectedIds.delete(target);
      else protectedIds.add(target);
      request = null;
      persist();
      update();
    }
  };
  $("#donor-open").onclick = () => $("#donor-file").click();
  $("#donor-file").onchange = async () => {
    try {
      const file = $("#donor-file").files[0];
      $("#donor-file").value = "";
      if (!file) return;
      if (file.size > 8000000) throw new Error("Form exceeds 8 MB.");
      const source = JSON.parse(await file.text());
      if (source.format !== "irudd.form.v1")
        throw new Error("Choose a saved form.");
      customDonor = validateForm(source.form);
      await restoreArtwork(customDonor);
      if (!$("#donor-component").querySelector('[value="custom"]'))
        $("#donor-component").add(new Option("Opened form", "custom"));
      $("#donor-component").value = "custom";
      $("#donor-region").replaceChildren(
        ...customDonor.parts.map((p) => new Option(p.id, p.id)),
      );
      $("#donor-region-field").hidden = false;
      status("Choose a branch from " + file.name + ".");
    } catch (e) {
      status(e.message);
    }
  };
  $("#donor-component").onchange = () => {
    $("#donor-region-field").hidden = $("#donor-component").value !== "custom";
  };
  $("#graft-mode").onchange = () => {
    $("#graft-fit-field").hidden = $("#graft-mode").value === "pattern";
  };
  // Measure the geometry that will actually leave and enter the scene, including
  // attached necks, hair and hardware on a whole-branch replacement.
  function graftBounds(source, id, relative) {
    const model = createCharacter(source, false, true);
    try {
      const part = findPart(model, id);
      const box = visibleBounds(part);
      if (box.isEmpty())
        throw new Error("The selected branch has no visible geometry.");
      if (relative)
        box.translate(part.getWorldPosition(new T.Vector3()).negate());
      return [box.min.toArray(), box.max.toArray()];
    } finally {
      disposeCharacter(model);
    }
  }
  $("#graft").onclick = () => {
    try {
      const key = $("#donor-component").value,
        component =
          key === "custom"
            ? extractComponent(customDonor, $("#donor-region").value)
            : componentShelf()[key];
      const current = nudge(form, target, amounts);
      const destination = $("#graft-target").value,
        mode = $("#graft-mode").value;
      const fit = $("#graft-fit").checked;
      const measured = key === "custom" && mode === "replaceBranch" && fit;
      const next = placeComponent(current, component, {
        target: destination,
        mode,
        fit,
        ...(measured
          ? {
              sourceBounds: graftBounds(customDonor, component.root, true),
              destinationBounds: graftBounds(current, destination, false),
            }
          : {}),
      });
      validateForm(next.form);
      target = next.id;
      commit(
        next.form,
        $("#graft-mode").value === "pattern"
          ? "Pattern fitted to this body."
          : "Component grafted.",
      );
      switchTab("sculpt");
      chooseAngle("3/4", true);
    } catch (e) {
      status(e.message);
    }
  };
  const input = $("#steering");
  input.value = instructions;
  input.oninput = () => {
    request = null;
    persist();
    status("");
  };
  $("#target").onchange = () => selectTarget($("#target").value || null);
  $("#direct").onclick = () => {
    placement?.cancel();
    drawing = false;
    pulling = false;
    playback?.bind();
    direct = !direct;
    if (direct && operation === "face") {
      focusFace();
      status("Drag a facial landmark. Hover over a point to see its control.");
      return;
    }
    update();
    status(
      direct ? "Select a part on the model, then drag an axis." : "Orbit view.",
    );
  };
  $("#focus").onclick = () => {
    const object = findPart(figure, target) ?? figure,
      bounds = visibleBounds(object);
    const size = bounds.getSize(new T.Vector3());
    const offset = camera.position.clone().sub(controls.target);
    bounds.getCenter(controls.target);
    camera.position.copy(controls.target).add(offset);
    camera.zoom = Math.min(
      15,
      (camera.top - camera.bottom) / Math.max(size.y * 1.5, 0.12),
      (camera.right - camera.left) / (Math.max(size.x, size.z) * 1.65 + 0.03),
    );
    camera.updateProjectionMatrix();
    controls.update();
    render();
  };
  $("#knot").onchange = () => {
    knot = $("#knot").value === "" ? null : Number($("#knot").value);
    direct = true;
    update();
  };
  for (const [id, mul] of [
    ["thinner", 0.89],
    ["thicker", 1.12],
  ])
    $("#" + id).onclick = () =>
      editPart((p) => ({
        ...p,
        knots: p.knots.map((r, i) =>
          i === knot ? [...r.slice(0, 3), r[3] * mul, r[4] * mul] : r,
        ),
      }));
  $("#insert-knot").onclick = () =>
    editPart((p) => {
      const i = Math.min(knot, p.knots.length - 2),
        a = p.knots[i],
        b = p.knots[i + 1];
      return {
        ...p,
        knots: [
          ...p.knots.slice(0, i + 1),
          a.map((v, k) => (v + b[k]) * 0.5),
          ...p.knots.slice(i + 1),
        ],
      };
    });
  $("#outfit-role").replaceChildren(
    new Option("Unassigned", ""),
    ...outfitRoles.map((r) => new Option(r, r)),
  );
  $("#outfit-role").onchange = () =>
    editPart((p) => {
      const q = { ...p };
      if ($("#outfit-role").value) q.outfitRole = $("#outfit-role").value;
      else delete q.outfitRole;
      return q;
    });
  $("#motion-role").replaceChildren(
    new Option("Infer from anatomy", ""),
    ...motionRoles.map((r) => new Option(r, r)),
  );
  $("#motion-role").onchange = () =>
    editPart((p) => {
      const next = { ...p };
      if ($("#motion-role").value) next.motionRole = $("#motion-role").value;
      else delete next.motionRole;
      return next;
    });
  const newHairSeed = () => crypto.getRandomValues(new Uint32Array(1))[0];
  $("#depth-mix").onchange = () =>
    editPart((p) => ({
      ...p,
      paint: {
        ...p.paint,
        depthField: {
          ...p.paint.depthField,
          mix: Number($("#depth-mix").value) / 100,
        },
      },
    }));
  $("#hair-source").onclick = () =>
    editPart((p) => ({ ...p, hideSourceHair: !p.hideSourceHair }));
  const selectedFace = (group, id) => {
    const owner = findPart(group, id);
    return owner?.userData.faceSurface
      ? owner
      : owner?.children.find((c) => c.userData.faceSurface);
  };
  $("#front-open").onclick = frontEditor({
    getFace: () => selectedFace(figure, target),
    getRenderer: () => renderer,
    restoreView: render,
    status,
    save: (pass, artwork) =>
      editPart(
        (p) => ({ ...p, frontFits: [...(p.frontFits ?? []), pass] }),
        artwork,
      ),
  });
  function mountAccessories(rigid) {
    const selected = new Set(
      Array.from($("#rigid-fit-parts").selectedOptions, (o) => o.value),
    );
    if (!selected.size) return status("Select the pieces to fit together.");
    const face = selectedFace(figure, target),
      pivot = findPart(figure, $("#rigid-fit-pivot").value);
    if (!face || !pivot) return;
    const frame = headFrame(face),
      anchor = face
        .worldToLocal(pivot.getWorldPosition(new T.Vector3()))
        .sub(frame.center)
        .multiply(frame.factor)
        .toArray();
    const base = nudge(form, target, amounts);
    commit(
      {
        ...base,
        parts: base.parts.map((p) => {
          if (!selected.has(p.id)) return p;
          const { rigidFaceAnchor, faceClearance, ...rest } = p;
          return rigid ? { ...rest, rigidFaceAnchor: anchor } : rest;
        }),
      },
      rigid
        ? "Fitted the selected pieces as one rigid accessory."
        : "Released the rigid fit.",
    );
  }
  $("#rigid-fit-apply").onclick = () => mountAccessories(true);
  $("#rigid-fit-release").onclick = () => mountAccessories(false);
  $("#rigid-clear").onclick = () => {
    const ids = new Set(
      Array.from($("#rigid-fit-parts").selectedOptions, (o) => o.value),
    );
    if (
      !ids.size ||
      form.parts.some((p) => ids.has(p.id) && !p.rigidFaceAnchor)
    )
      return status("First fit these pieces together as a rigid accessory.");
    const clearance =
      T.MathUtils.clamp(Number($("#rigid-clear-mm").value), 1, 25) / 1000;
    const base = nudge(form, target, amounts);
    commit(
      {
        ...base,
        parts: base.parts.map((p) =>
          ids.has(p.id) ? { ...p, faceClearance: clearance } : p,
        ),
      },
      "Cleared the selected front pieces. The other supports follow at the front.",
    );
  };
  $("#fit-last-mirror").onchange = () =>
    editPart((p) => ({
      ...p,
      frontFits: p.frontFits.map((fit, i) =>
        i === p.frontFits.length - 1
          ? {
              ...fit,
              view: { ...fit.view, symmetric: $("#fit-last-mirror").checked },
            }
          : fit,
      ),
    }));
  $("#fit-last").onchange = () =>
    editPart((p) => ({
      ...p,
      frontFits: p.frontFits.map((fit, i) =>
        i === p.frontFits.length - 1
          ? { ...fit, amount: Number($("#fit-last").value) / 100 }
          : fit,
      ),
    }));
  $("#front-remove").onclick = () =>
    editPart((p) => {
      const { frontFits, ...rest } = p;
      return frontFits.length > 1
        ? { ...rest, frontFits: frontFits.slice(0, -1) }
        : rest;
    });
  $("#profile-open").onclick = () => traceOutline();
  $("#profile-mix").onchange = () =>
    editPart((p) => ({
      ...p,
      profileFit: {
        ...p.profileFit,
        amount: Number($("#profile-mix").value) / 100,
      },
    }));
  $("#profile-relief").onchange = () =>
    editPart((p) => ({
      ...p,
      profileFit: {
        ...p.profileFit,
        relief: Number($("#profile-relief").value) / 100,
      },
    }));
  $("#profile-remove").onclick = () =>
    editPart((p) => {
      const { profileFit, ...rest } = p;
      return rest;
    });
  $("#eye-fit").onclick = () =>
    editPart((p) => {
      let original;
      const finish =
        p.profileFit?.stage === "finish" ||
        p.frontFits?.some((pass) => pass.overlay);
      try {
        if (finish || p.frontFits?.length) {
          const preview = nudge(form, target, amounts);
          original = createCharacter(
            {
              ...preview,
              parts: preview.parts.map((q) =>
                q.id === p.id && !finish ? { ...q, frontFits: [] } : q,
              ),
            },
            false,
          );
        }
        const face = selectedFace(original ?? figure, p.id);
        if (!face) throw new Error("Select a registered face.");
        const eyesRig = fitEyeSettings(face);
        if (finish) eyesRig.stage = "finish";
        return { ...p, eyesRig };
      } finally {
        if (original) disposeCharacter(original);
      }
    });
  $("#eye-remove").onclick = () =>
    editPart((p) => {
      const { eyesRig, ...source } = p;
      return source;
    });
  $("#eye-color").onchange = () =>
    editPart((p) => ({
      ...p,
      eyesRig: { ...p.eyesRig, source: false, color: $("#eye-color").value },
    }));
  for (const [id, sign] of [
    ["eye-less", -1],
    ["eye-more", 1],
  ])
    $("#" + id).onclick = () =>
      editPart((p) => {
        const settings = structuredClone(p.eyesRig),
          k = $("#eye-axis").value;
        if (/^[xy][01]$/.test(k)) {
          settings.offsets ??= [
            [0, 0],
            [0, 0],
          ];
          const eye = Number(k[1]),
            axis = k[0] === "x" ? 0 : 1;
          settings.offsets[eye][axis] = T.MathUtils.clamp(
            settings.offsets[eye][axis] + sign * 0.004,
            -0.09,
            0.09,
          );
        } else {
          const [low, high, step] = {
            opening: [0.42, 1.8, 0.09],
            width: [0.62, 1.6, 0.06],
            spacing: [0.7, 1.3, 0.04],
            lift: [-0.1, 0.1, 0.004],
            iris: [0.55, 1.45, 0.06],
          }[k];
          settings[k] = T.MathUtils.clamp(settings[k] + sign * step, low, high);
        }
        return { ...p, eyesRig: settings };
      });
  $("#hair-add").onclick = () =>
    editPart((p) => ({
      ...p,
      groom: {
        ...groomDefaults,
        color: (p.look ?? form.appearance).hairColor,
        seed: newHairSeed(),
      },
    }));
  $("#hair-remove").onclick = () =>
    editPart((p) => {
      const { groom, ...bare } = p;
      return bare;
    });
  for (const [button, sign] of [
    ["hair-less", -1],
    ["hair-more", 1],
  ]) {
    $("#" + button).onclick = () =>
      editPart((p) => {
        const k = $("#hair-axis").value;
        const value = Math.min(
          k === "length" ? 2 : 1,
          Math.max(
            ["sweep", "part"].includes(k) ? -1 : 0,
            (p.groom[k] ?? 0) + sign * (k === "length" ? 0.18 : 0.15),
          ),
        );
        return { ...p, groom: { ...p.groom, [k]: Number(value.toFixed(3)) } };
      });
  }
  $("#hair-pattern").onchange = () =>
    editPart((p) => ({
      ...p,
      groom: { ...p.groom, pattern: $("#hair-pattern").value },
    }));
  $("#hair-color").onchange = () =>
    editPart((p) => ({
      ...p,
      groom: { ...p.groom, color: $("#hair-color").value },
    }));
  $("#hair-roll").onclick = () =>
    editPart((p) => ({ ...p, groom: { ...p.groom, seed: newHairSeed() } }));
  $("#join-seat").onclick = () =>
    editPart((p) => {
      const depth = Number($("#join-depth").value) / 1000;
      const join =
        p.shape === "cage"
          ? {
              faces: [
                ...new Set([
                  ...(p.surfaceJoin?.faces ?? []),
                  Number($("#join-patch").value),
                ]),
              ],
              depth,
            }
          : { end: $("#join-patch").value, depth };
      return { ...p, surfaceJoin: join };
    });
  $("#join-release").onclick = () =>
    editPart((p) => {
      const { surfaceJoin, ...free } = p;
      return free;
    });
  $("#cage-face").onchange = () => {
    cageFace = Number($("#cage-face").value);
    direct = true;
    knot = null;
    update();
  };
  $("#cage-corner").onchange = () => {
    knot =
      $("#cage-corner").value === "" ? null : Number($("#cage-corner").value);
    direct = true;
    update();
  };
  $("#cage-level").onchange = () =>
    editPart((p) => ({
      ...p,
      cage: { ...p.cage, levels: Number($("#cage-level").value) },
    }));
  for (const kind of ["extrude", "inset", "crease", "tunnel"])
    $("#cage-" + kind).onclick = () =>
      editPart((p) => ({
        ...p,
        cage: editCage(p.cage, {
          kind,
          face: cageFace,
          to: Number($("#cage-to").value),
        }),
      }));
  for (const [button, angle] of [
    ["#bend-elbow", 15],
    ["#open-elbow", -15],
  ]) {
    $(button).onclick = () => {
      try {
        commit(
          bendElbow(nudge(form, target, amounts), target, angle),
          "Elbow adjusted.",
        );
      } catch (error) {
        status(error.message);
      }
    };
  }
  $("#carry-pose").onchange = () => {
    editPart((p) => ({ ...p, holdArmPose: $("#carry-pose").checked }));
  };
  $("#recut-arm").onclick = () => {
    try {
      commit(
        recutArmSleeves(
          nudge(form, target, amounts),
          target,
          $("#sleeve-color").value,
        ),
        "Sleeves recut.",
      );
    } catch (error) {
      status(error.message);
    }
  };
  $("#fit-hand").onclick = () => {
    try {
      const preview = nudge(form, target, amounts),
        part = preview.parts.find((p) => p.id === target);
      commit(
        fitHand(preview, target, palmColor(part, preview.appearance.skin)),
        "Fitted a palm, thumb and fingers.",
      );
    } catch (e) {
      status(e.message);
    }
  };
  $("#surface").onchange = () =>
    editPart((p) => ({ ...p, surface: $("#surface").value }));
  $("#part-color").onchange = () =>
    editPart((p) => ({ ...p, color: $("#part-color").value }));
  for (const [id, action] of [
    ["attach", (f) => appendPart(f, target, $("#shape").value)],
    ["duplicate", (f) => copyBranch(f, target, false)],
    ["mirror", (f) => copyBranch(f, target, true)],
  ])
    $("#" + id).onclick = () => {
      try {
        const next = action(nudge(form, target, amounts));
        validateForm(next.form);
        target = next.id;
        if (next.form.parts.find((p) => p.id === target)?.shape === "cage") {
          cageFace = 0;
          direct = true;
        }
        commit(next.form, "Created " + next.id + ".");
      } catch (e) {
        status(e.message);
      }
    };
  $("#repeat").onclick = () => {
    try {
      const width = Number($("#repeat-width").value) / 100;
      if (width < 0.01 || width > 1)
        throw new Error("Use a width from 1 to 100 cm.");
      const equipped = $("#repeat-outfit").checked;
      const addPlates = equipped ? equipPlateRows : repeatOnSpine;
      const added = addPlates(nudge(form, target, amounts), target, {
        ...(equipped ? { color: $("#repeat-color").value } : {}),
        count: Number($("#repeat-count").value),
        columns: Number($("#repeat-cols").value),
        width,
        length: width * 1.18,
        depth: width * 0.34,
        face: $("#repeat-side").value,
      });
      target = added.id;
      commit(added.form, "Plate array added. Each plate is editable.");
    } catch (e) {
      status(e.message);
    }
  };
  for (const [id, key] of [
    ["finger-count", "fingers"],
    ["finger-curl", "curl"],
    ["finger-spread", "spread"],
  ]) {
    $("#" + id).onchange = () =>
      editPart((p) => ({
        ...p,
        grip: {
          fingers: 4,
          spread: 0.2,
          curl: 0.15,
          side: 1,
          ...p.grip,
          [key]: Number($("#" + id).value) / (key === "fingers" ? 1 : 100),
        },
      }));
  }
  $("#remove").onclick = () => {
    try {
      commit(
        removePart(nudge(form, target, amounts), target),
        "Removed the selected branch.",
      );
    } catch (e) {
      status(e.message);
    }
  };
  for (const tab of document.querySelectorAll("[data-tab]"))
    tab.onclick = () => switchTab(tab.dataset.tab);
  for (const el of $("#operations").children)
    el.onclick = () => {
      operation = el.dataset.op;
      if (operation === "face" && direct) focusFace();
      else update();
    };
  $("#clear").onclick = () => {
    amounts = neutral();
    request = null;
    persist();
    update();
    status("Nudges cleared.");
  };
  $("#studies").replaceChildren(
    ...studies.map((s) => new Option(s.title + " · " + s.game, s.id)),
  );
  $("#study").onclick = () => {
    const study = studies.find((s) => s.id === $("#studies").value);
    let next;
    try {
      next = study.make();
    } catch (e) {
      status(e.message);
      return;
    }
    commit(next, "Loaded " + study.title + ".");
    switchTab("sculpt");
    chooseAngle("3/4", true);
  };
  $("#save").onclick = () =>
    download(
      new Blob([JSON.stringify({ format: "irudd.form.v1", form }, null, 2)], {
        type: "application/json",
      }),
      "character.form.json",
    );
  $("#open").onclick = () => $("#openfile").click();
  $("#openfile").onchange = async () => {
    const f = $("#openfile").files[0];
    $("#openfile").value = "";
    if (!f) return;
    try {
      await openForm(f);
    } catch (e) {
      status(e.message);
    }
  };
  $("#glb").onclick = async () => {
    const wardrobe =
      $("#all-outfits").checked && Boolean(form.outfitSets?.length);
    $("#glb").disabled = true;
    try {
      const result = await exportForm(form, {
        motion: $("#with-motion").checked,
        game: $("#export-detail").value !== "full",
        atlasSize: $("#export-detail").value === "portrait" ? 2048 : 1024,
        wardrobe,
        progress: async (name, index, count) => {
          status(
            name
              ? `Preparing outfit ${index + 1}/${count} · ${name}`
              : "Preparing GLB…",
          );
          await new Promise((resolve) => setTimeout(resolve, 0));
        },
      });
      download(
        new Blob([result.bytes], { type: "model/gltf-binary" }),
        wardrobe ? "character-wardrobe.glb" : "character.glb",
      );
      const exported = wardrobe
        ? result.looks + " saved outfits"
        : result.triangles
          ? result.triangles.toLocaleString() + " triangles with one material"
          : "the accepted 3D form";
      status(
        "Exported " +
          exported +
          " · " +
          (result.bytes.byteLength / 1e6).toFixed(2) +
          " MB.",
      );
    } catch (e) {
      status(e.message);
    } finally {
      $("#glb").disabled = false;
    }
  };
  for (const key of axes) {
    const row = document.createElement("label");
    row.className = "nudge";
    const label = document.createElement("span");
    label.textContent = key[0].toUpperCase() + key.slice(1);
    const slider = document.createElement("input");
    row.dataset.axis = key;
    slider.type = "range";
    slider.min =
      modes.face.includes(key) || modes.build.includes(key) ? -40 : -15;
    slider.max = -slider.min;
    slider.step = 1;
    slider.id = key.replaceAll(" ", "-");
    slider.setAttribute("aria-label", key + " nudge");
    const out = document.createElement("output");
    out.id = "value-" + slider.id;
    slider.oninput = () => {
      amounts[key] = Number(slider.value);
      request = null;
      persist();
      update();
      status("");
    };
    row.append(label, slider, out);
    $("#features").append(row);
  }
  $("#roll").onclick = () => {
    const choices = modes[operation];
    const key = choices[Math.floor(entropy() * choices.length)];
    amounts[key] =
      (entropy() < 0.5 ? -1 : 1) * (3 + Math.floor(entropy() * 10));
    request = null;
    persist();
    update();
    status("Small variation ready to apply or use as AI direction.");
  };
  $("#apply").onclick = () => {
    try {
      commit(nudge(form, target, amounts), "Nudge applied.");
    } catch (e) {
      status(e.message);
    }
  };
  $("#fresh").onclick = () => {
    target = null;
    commit(
      generateWorkshopForm($("#body-plan").value),
      "Generated a new starting form.",
    );
    chooseAngle("3/4", true);
    switchTab("sculpt");
  };
  $("#undo").onclick = () => {
    if (!history.length) return;
    form = history.pop();
    revision = crypto.randomUUID();
    clearDraft();
    target = null;
    persist();
    update();
    status("Restored the previous form.");
  };
  for (const outfit of outfits) {
    const el = button(outfit, () =>
      commit(
        { ...nudge(form, target, amounts), outfit, layerStyles: {} },
        "Wardrobe updated.",
      ),
    );
    el.className = "outfit";
    $("#outfits").append(el);
  }
  $("#generate").textContent = connected
    ? "Generate variation"
    : "Export AI request";
  $("#agent-help").textContent = connected
    ? "Sends the current form, nudges and direction to your local Codex CLI."
    : "Give the exported JSON to your agent, then load its proposal here.";
  $("#inspect-export").onclick = inspectProposal;
  $("#export-review-compare").onclick = () => {
    compareExport = !compareExport;
    update();
  };
  $("#refine-note").oninput = () => {
    $("#refine-send").disabled =
      busy || inspecting || (!exportReview && !$("#refine-note").value.trim());
    persist();
  };
  $("#refine-send").onclick = refineProposal;
  $("#refine-load").onclick = () => $("#file").click();
  $("#refine-back").onclick = () => {
    if (busy || !reviewHistory.length) return;
    proposal = reviewHistory.pop();
    refineRequest = null;
    showCurrent = false;
    $("#refine-note").value = "";
    persist();
    update();
    status("Restored the previous proposal.");
  };
  $("#generate").onclick = generate;
  $("#paint-generate").hidden = !connected;
  $("#paint-action").onchange = () => {
    $("#repaint-branch-field").hidden = $("#paint-action").value !== "repaint";
  };
  $("#paint-generate").onclick = () => generate("paint");
  $("#cancel-generation").onclick = () => generationController?.abort();
  $("#save-turnaround").onclick = async () => {
    if (proposal?.art)
      download(await (await fetch(proposal.art.url)).blob(), "turnaround.webp");
  };
  $("#save-map").onclick = () => {
    if (proposal?.art?.map)
      download(
        new Blob([JSON.stringify(proposal.art.map, null, 2)], {
          type: "application/json",
        }),
        "regions.trace.json",
      );
  };
  $("#import").onclick = () => $("#file").click();
  $("#file").onchange = async () => {
    const file = $("#file").files[0];
    $("#file").value = "";
    if (!file) return;
    try {
      if (file.size > 8_000_000) throw new Error("Proposal exceeds 8 MB.");
      const raw = JSON.parse(await file.text());
      if (proposal && refineRequest)
        await receiveRefinement(raw, refineRequest, proposal);
      else {
        const pendingRequest = request,
          candidate = readProposal(raw, request, revision);
        await restoreArtwork(candidateForm(candidate));
        if (request !== pendingRequest || revision !== pendingRequest.revision)
          return;
        proposal = candidate;
      }
      showCurrent = false;
      persist();
      update();
      status("Review the proposed form.");
    } catch (e) {
      status(e.message);
    }
  };
  $("#compare").onclick = () => {
    showCurrent = !showCurrent;
    update();
  };
  $("#accept").onclick = () =>
    commit(
      candidateForm(),
      proposal.alternate ? "Saved variation opened." : "AI variation accepted.",
    );
  $("#discard").onclick = () =>
    returnToDraft(
      "Returned to the current form. Your nudge is still editable.",
    );
  for (const el of $("#angles").children)
    el.onclick = () => chooseAngle(el.dataset.angle);
  scaleRoom(
    () => displayedForm,
    (next) => commit(next, "Resized current form."),
    () => Boolean(busy || proposal),
  );
  $("#scale-lock").onclick = () => {
    worldScale = !worldScale;
    pressed($("#scale-lock"), worldScale);
    chooseAngle("3/4", true);
  };
  $("#reset").onclick = () => chooseAngle("3/4", true);
  for (const el of $("#display").children)
    el.onclick = () => {
      clay = el.dataset.mode === "Clay";
      silhouette = el.dataset.mode === "Silhouette";
      update();
    };
}
function referenceViews(selectedId = null) {
  const selected = selectedId && findPart(figure, selectedId);
  let isolated;
  if (selected) {
    selected.updateWorldMatrix(true, true);
    isolated = selected.clone(true);
    const children = [];
    isolated.traverse((child) => {
      if (child !== isolated && child.userData.partId) children.push(child);
    });
    for (const child of children) child.removeFromParent();
    isolated.matrixAutoUpdate = false;
    isolated.matrix.copy(selected.matrixWorld);
    isolated.updateMatrixWorld(true);
  }
  const detailScene = new T.Scene();
  detailScene.background = scene.background;
  if (isolated) {
    detailScene.add(isolated);
    scene.traverse((o) => {
      if (o.isLight) detailScene.add(o.clone());
    });
  }
  const shot = document.createElement("canvas");
  shot.width = shot.height = 448;
  const ctx = shot.getContext("2d"),
    side = Math.min(canvas.width, canvas.height),
    aspect = canvas.width / canvas.height;
  const views = [];
  try {
    for (const [name, subject, environment, dir] of [
      ["whole character", figure, scene, [0.45, 0.18, 1]],
      isolated
        ? ["selected part alone", isolated, detailScene, [0.62, 0.1, 1]]
        : ["rear-quarter", figure, scene, [-0.7, 0.16, -1]],
    ]) {
      const bounds = visibleBounds(subject),
        center = bounds.getCenter(new T.Vector3());
      const radius = Math.max(
        bounds.getSize(new T.Vector3()).length() * 0.56,
        0.035,
      );
      const half = radius / Math.min(1, aspect);
      const cam = new T.OrthographicCamera(
        -half * aspect,
        half * aspect,
        half,
        -half,
        0.01,
        100,
      );
      cam.position
        .copy(center)
        .addScaledVector(new T.Vector3(...dir).normalize(), radius * 3.5 + 2);
      cam.lookAt(center);
      cam.updateMatrixWorld();
      renderer.render(environment, cam);
      ctx.drawImage(
        canvas,
        (canvas.width - side) / 2,
        (canvas.height - side) / 2,
        side,
        side,
        0,
        0,
        448,
        448,
      );
      views.push({
        name,
        height: bounds.getSize(new T.Vector3()).y,
        jpeg: shot.toDataURL("image/jpeg", 0.76).split(",")[1],
      });
    }
  } finally {
    render();
  }
  return views;
}
function exportBrief(brief, images, filename) {
  const data = {
    ...agentDesign(brief),
    views: images,
    ...(brief.references?.length ? { references: brief.references } : {}),
  };
  download(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    filename,
  );
}
async function requestGeometry(brief, images, signal) {
  const response = await fetch("/variation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...brief, views: images }),
    signal,
  });
  const raw = await response.json();
  if (!response.ok) throw new Error(raw.error || "Generation failed.");
  return raw;
}
async function receiveRefinement(raw, brief, parent) {
  const next = readProposal(raw, brief, revision);
  const artwork = { ...candidateForm().artwork, ...next.form.artwork };
  if (Object.keys(artwork).length) next.form = { ...next.form, artwork };
  await restoreArtwork(next.form);
  if (
    parent !== proposal ||
    brief !== refineRequest ||
    revision !== brief.revision
  )
    throw new Error("The proposal changed while the refinement was loading.");
  reviewHistory.push(parent);
  if (reviewHistory.length > 8) reviewHistory.shift();
  proposal = { ...next, refinementRound: brief.refinement.round };
  showCurrent = false;
  refineRequest = null;
  $("#refine-note").value = "";
}
async function inspectProposal() {
  const parent = proposal;
  if (!parent || busy || inspecting) return;
  inspecting = true;
  update();
  try {
    status("Exporting and reloading the proposed game mesh...");
    const previous = inspectedProposals.get(reviewHistory.at(-1));
    const result = await inspectGameExport(candidateForm(), renderer, previous);
    if (parent !== proposal) return;
    inspectedProposals.set(parent, result);
    compareExport = false;
    status("Inspect the pose and silhouette, then refine the proposal.");
  } catch (err) {
    if (parent === proposal) status(err.message);
  } finally {
    inspecting = false;
    update();
    render();
  }
}
async function refineProposal() {
  const parent = proposal,
    review = parent && inspectedProposals.get(parent);
  const direction =
    $("#refine-note").value.trim() ||
    (review
      ? "Inspect the attached game-export views. Identify and correct one visible defect that matters to the original direction. Describe the defect and change in the summary. Preserve unrelated work. If no defect is visible, return an empty operations list."
      : "");
  if (busy || !parent || !direction) return;
  try {
    // The accepted form stays available for comparison through every round.
    showCurrent = false;
    update();
    const base = candidateForm(),
      ids = new Set(base.parts.map((p) => p.id));
    const brief = makeBrief(
      base,
      revision,
      null,
      neutral(),
      direction,
      variation,
      [...protectedIds].filter((id) => ids.has(id)),
      componentShelf(),
    );
    if (references.length) brief.references = references;
    brief.refinement = {
      previousSummary: parent.summary,
      earlierDirection: request?.instructions ?? "",
      round: (parent.refinementRound ?? 0) + 1,
    };
    brief.spatialGuide = spatialGuide(figure);
    if (surfaceMarks.length) brief.surfaceMarks = markTool.resolved();
    let images = review?.views ?? referenceViews();
    if (review) {
      brief.refinement.exportReview = review.detail;
      const preceding = inspectedProposals.get(reviewHistory.at(-1));
      if (preceding) {
        images = await compareExportViews(preceding.views, review.views);
        if (parent !== proposal || busy) return;
        brief.refinement.exportReview = {
          ...review.detail,
          previous: preceding.detail,
          attachments: images.map((v) => v.name),
        };
      }
    }
    refineRequest = brief;
    persist();
    if (!connected) {
      exportBrief(brief, images, "form-refinement-request.json");
      status(
        "Refinement request exported. Load its reply to compare both proposals.",
      );
      return;
    }
    generationController = new AbortController();
    busy = true;
    update();
    status("Refining the visible proposal…");
    const raw = await requestGeometry(
      brief,
      images,
      generationController.signal,
    );
    await receiveRefinement(raw, brief, parent);
    status("Review the refinement or return to the previous proposal.");
  } catch (e) {
    status(
      generationController?.signal.aborted
        ? "Refinement cancelled. The previous proposal is still available."
        : e.message,
    );
  } finally {
    generationController = null;
    busy = false;
    persist();
    update();
  }
}
async function generate(kind) {
  if (busy || proposal) return;
  const direction = $("#steering").value.trim();

  try {
    request = makeBrief(
      form,
      revision,
      target,
      amounts,
      direction,
      variation,
      [...protectedIds],
      componentShelf(),
    );
    if (references.length) request.references = references;
    request.spatialGuide = spatialGuide(figure);
    if (kind !== "paint" && surfaceMarks.length)
      request.surfaceMarks = markTool.resolved();
    persist();
    if (!connected) {
      exportBrief(request, referenceViews(), "form-request.json");
      status(
        "Request exported. Ask your agent to return the proposal as JSON.",
      );
      return;
    }
    const views = referenceViews(kind === "paint" ? target : null);
    generationController = new AbortController();
    busy = true;
    update();
    status("Generating a variation…");
    if (kind === "paint") {
      const height = T.MathUtils.clamp(
        (target ? views[1] : views[0]).height,
        0.15,
        6,
      );
      const preview = nudge(form, target, amounts);
      const candidate = await paintWithAgent(request, preview, {
        views,
        height,
        target,
        signal: generationController.signal,
        paintBranch: $("#repaint-branch").checked,
        resurface: Boolean(target) && $("#paint-action").value === "repaint",
        sourceRevision:
          Boolean(target) && $("#paint-action").value === "revise",
        depth: Boolean(target) && $("#paint-action").value === "depth",
        scalp: Boolean(target) && $("#paint-action").value === "scalp",
        wearable: Boolean(target) && $("#paint-action").value === "wear",
        status,
      });
      proposal = readProposal(candidate, request, revision);
      showCurrent = false;
      status("Review the painted 3D proposal.");
      return;
    }
    const raw = await requestGeometry(
      request,
      views,
      generationController.signal,
    );
    proposal = readProposal(raw, request, revision);
    showCurrent = false;
    status("Review the proposed form.");
  } catch (e) {
    status(
      generationController?.signal.aborted
        ? "Generation cancelled. You can keep editing this form."
        : e.message,
    );
  } finally {
    generationController = null;
    busy = false;
    persist();
    update();
  }
}
function update() {
  if (markOwner !== (proposal ?? form)) {
    markOwner = proposal ?? form;
    surfaceMarks = [];
    markTool?.cancel();
  }
  markTool?.sync();
  const preview =
    spinePreview ??
    (proposal
      ? showCurrent
        ? form
        : proposal.form
      : nudge(form, target, amounts));
  gizmo?.detach();
  const shader = silhouette ? "Silhouette" : clay ? "Clay" : "Color";
  if (displayedForm !== preview || displayedInk !== shader) {
    if (figure) {
      scene.remove(figure);
      disposeCharacter(figure);
    }
    figure = createCharacter(preview, silhouette, clay);
    scene.add(figure);
    playback?.update(preview, figure);
    displayedForm = preview;
    displayedInk = shader;
    const height = visibleBounds(figure).getSize(new T.Vector3()).y;
    $("#size").textContent = height.toFixed(2) + " m overall";
  }
  const changed = axes.some((key) => Boolean(amounts[key])),
    locked = busy || Boolean(proposal);
  $("#export-outfit-field").hidden = !form.outfitSets?.length;
  $("#pose-open").disabled = locked;
  $("#revision").textContent = proposal
    ? showCurrent
      ? "Current form"
      : "AI proposal"
    : changed
      ? "Nudge preview"
      : "Current form";
  $("#name").textContent = target ?? "Whole form";
  $("#look").textContent = preview.parts.length + " parts";
  $("#candidate").hidden = !proposal;
  const inspection = proposal && inspectedProposals.get(proposal);
  if (inspection !== exportReview) compareExport = false;
  exportReview = inspection;
  const earlier = inspectedProposals.get(reviewHistory.at(-1));
  $("#inspect-export").disabled = busy || inspecting;
  $("#inspect-export").hidden = Boolean(exportReview);
  $("#export-review").hidden = !exportReview;
  $("#export-review-compare").hidden = !earlier || !exportReview;
  $("#export-review-compare").textContent = compareExport
    ? "Show this export"
    : "Show earlier export";
  pressed($("#export-review-compare"), compareExport);
  const shown = compareExport && earlier ? earlier : inspection;
  if (shown !== shownReview) {
    shownReview = shown;
    const images = $("#export-review").querySelectorAll("img");
    images.forEach((img, i) => {
      if (shown) img.src = "data:image/jpeg;base64," + shown.views[i].jpeg;
      else img.removeAttribute("src");
    });
    if (shown)
      $("#export-review-caption").textContent =
        (compareExport ? "Earlier proposal. " : "This proposal. ") +
        shown.detail.triangles.toLocaleString() +
        " triangles. Refinements use this proposal's own export.";
    const change = shown?.detail.coverage?.changes[0];
    if (change)
      $("#export-review-caption").textContent +=
        " In the " +
        change.view +
        " view, " +
        change.pixels +
        " of the 256 x 256 sampled pixels switched from " +
        change.garment +
        " to bare " +
        change.body +
        ".";
  }
  $("#refine-send").disabled =
    busy || inspecting || (!exportReview && !$("#refine-note").value.trim());
  $("#refine-send").textContent = connected
    ? "Refine proposal"
    : "Export refinement request";
  $("#refine-note").disabled = busy;
  $("#refine-load").hidden = !refineRequest || connected;
  $("#refine-back").hidden = !reviewHistory.length;
  for (const id of [
    "refine-load",
    "refine-back",
    "accept",
    "discard",
    "compare",
    "keep-candidate",
  ])
    $("#" + id).disabled = busy;
  refreshReferences(locked);
  $("#keep-current").disabled = locked;
  $("#keep-candidate").hidden = Boolean(proposal?.alternate);
  for (const b of $("#alternate-list").querySelectorAll("button"))
    b.disabled = locked;
  $("#cancel-generation").hidden = !generationController;
  $("#save-turnaround").hidden = !proposal?.art;
  $("#save-map").hidden = !proposal?.art?.map;
  let proposalSummary = proposal?.summary ?? "";
  if (proposal && !showCurrent) {
    const existing = new Set(form.parts.map((p) => p.id)),
      visible = new Set();
    figure.traverseVisible((node) => {
      if (node.userData.partId) visible.add(node.userData.partId);
    });
    const hidden = preview.parts
      .filter((p) => !existing.has(p.id) && !visible.has(p.id))
      .map((p) => p.id);
    if (hidden.length)
      proposalSummary +=
        " Hidden in " + preview.outfit + ": " + hidden.join(", ") + ".";
  }
  $("#summary").textContent = proposalSummary;
  $("#compare").textContent = showCurrent ? "Show proposal" : "Show current";
  pressed($("#compare"), showCurrent);
  const list = $("#target");
  const options = [["", "Whole form"], ...form.parts.map((p) => [p.id, p.id])];
  if (
    list.length !== options.length ||
    options.some(([id], i) => list.options[i]?.value !== id)
  )
    list.replaceChildren(
      ...options.map(([id, label]) => new Option(label, id)),
    );
  list.value = target || "";
  const dest = $("#graft-target");
  if (
    dest.length !== form.parts.length ||
    form.parts.some((p, i) => dest.options[i]?.value !== p.id)
  ) {
    dest.replaceChildren(...form.parts.map((p) => new Option(p.id, p.id)));
    dest.value = target ?? form.parts.find(isFace)?.id ?? form.parts[0].id;
  }
  const part = form.parts.find((p) => p.id === target);
  if (["cloth", "spine"].includes(operation) && part?.shape !== "sweep")
    operation = "shape";
  $("#paint-action-field").hidden = !connected || !part;
  $("#repaint-action").hidden = !(part?.paint || part?.hull);
  $("#revise-action").hidden = !acceptsDepth(part);
  if (
    ["revise", "repaint"].includes($("#paint-action").value) &&
    $("#" + $("#paint-action").value + "-action").hidden
  )
    $("#paint-action").value = "replace";
  $("#depth-action").hidden = !acceptsDepth(part);
  if ($("#depth-action").hidden && $("#paint-action").value === "depth")
    $("#paint-action").value = "replace";
  $("#depth-mix-field").hidden = !part?.paint?.depthField;
  if (part?.paint?.depthField)
    $("#depth-mix").value = Math.round(part.paint.depthField.mix * 100);
  $("#scalp-action").hidden = !part?.hairCap || !!part?.sourceHairOnly;
  if ($("#scalp-action").hidden && $("#paint-action").value === "scalp")
    $("#paint-action").value = "replace";
  $("#repaint-branch-field").hidden =
    $("#paint-action-field").hidden || $("#paint-action").value !== "repaint";
  $("#paint-action").disabled = locked;
  for (const el of $("#operations").children) {
    pressed(el, operation === el.dataset.op);
    el.disabled =
      locked ||
      (el.dataset.op === "build" && Boolean(target)) ||
      (["cloth", "spine"].includes(el.dataset.op) && part?.shape !== "sweep") ||
      (el.dataset.op === "face" &&
        (part ? !isFace(part) : !form.parts.some(isFace))) ||
      (el.dataset.op === "turn" && !target);
  }
  for (const key of axes) {
    const value = amounts[key] ?? 0,
      controlId = key.replaceAll(" ", "-");
    $("#" + controlId).parentElement.hidden = !modes[operation].includes(key);
    $("#" + controlId).value = value;
    $("#value-" + controlId).textContent =
      (value > 0 ? "+" : "") +
      value +
      (modes.turn.includes(key)
        ? "°"
        : modes.move.includes(key)
          ? " cm"
          : key === "fold count"
            ? " folds"
            : "%");
    $("#" + controlId).disabled = locked;
  }
  for (const id of [
    "target",
    "roll",
    "generate",
    "paint-generate",
    "fresh",
    "import",
    "steering",
    "study",
    "open",
    "clear",
    "trace-open",
    "draw-cue",
    "variation-range",
    "graft",
    "donor-open",
  ])
    $("#" + id).disabled = locked;
  $("#graft").disabled = locked || !assetsReady;
  $("#fresh").disabled = locked || !assetsReady;
  $("#undo").disabled = !history.length || locked;
  $("#apply").disabled = !changed || locked;
  $("#pull-tool").disabled = locked;
  if (locked || playback?.active) placement?.cancel();
  pressed($("#place-branch"), !!placement?.active);
  $("#place-settings").hidden = !placement?.active;
  $("#place-branch").disabled = locked;
  pressed($("#branch-tool"), drawing);
  $("#branch-settings").hidden = !drawing;
  const markTargets = part
    ? acceptsMarkings(part)
      ? [part]
      : []
    : form.parts.filter(bodyRegion);
  const marked = markTargets.find((p) => p.markings)?.markings;
  const markTools = $("#marking-tools");
  markTools.hidden = !markTargets.length;
  if (markTools.dataset.context !== revision + ":" + target) {
    markTools.dataset.context = revision + ":" + target;
    if (marked) {
      $("#mark-kind").value = marked.kind;
      $("#mark-color").value = marked.color;
      $("#mark-spacing").value = Math.round(marked.spacing * 100);
      $("#mark-coverage").value = Math.round(marked.coverage * 100);
      $("#mark-angle").value = marked.angle;
    }
  }
  $("#mark-apply").textContent = part
    ? "Apply to selected region"
    : "Apply to body";
  $("#mark-apply").disabled = $("#mark-roll").disabled = locked;
  $("#mark-clear").disabled = locked || !marked;
  const joined = form.parts.filter((p) => p.blendSkin);
  $("#eye-tools").hidden =
    locked ||
    !(
      part?.shape === "head" ||
      (part?.anatomy === "face" && part.paint?.portrait)
    );
  $("#front-tools").hidden = $("#eye-tools").hidden;
  const attachments = !$("#front-tools").hidden
    ? form.parts.filter((p) => p.parent === part?.id)
    : [];
  $("#rigid-fit-tools").hidden = !attachments.length;
  const partList = $("#rigid-fit-parts");
  if (
    attachments.length &&
    (partList.options.length !== attachments.length ||
      attachments.some((p, i) => partList.options[i]?.value !== p.id))
  ) {
    partList.replaceChildren(...attachments.map((p) => new Option(p.id, p.id)));
    $("#rigid-fit-pivot").replaceChildren(
      ...attachments.map((p) => new Option(p.id, p.id)),
    );
  }
  $("#front-open").disabled = (part?.frontFits?.length ?? 0) >= 6;
  $("#front-remove").hidden = $("#fit-last-field").hidden =
    !part?.frontFits?.length;
  const latestFit = part?.frontFits?.at(-1);
  $("#fit-last-mirror-label").hidden = latestFit?.view?.mode !== "depth";
  $("#fit-last-mirror").checked = !!latestFit?.view?.symmetric;
  if (part?.frontFits?.length) {
    $("#fit-last").value = Math.round(100 * part.frontFits.at(-1).amount);
    $("#fit-last-value").textContent = $("#fit-last").value + "%";
  }
  $("#profile-tools").hidden = $("#eye-tools").hidden;
  $("#profile-settings").hidden = !part?.profileFit;
  $("#profile-relief-field").hidden = part?.profileFit?.stage !== "finish";
  if (part?.profileFit)
    $("#profile-relief").value = Math.round(
      100 * (part.profileFit.relief ?? 0),
    );
  if (part?.profileFit)
    $("#profile-mix").value = Math.round(part.profileFit.amount * 100);
  $("#eye-settings").hidden = !part?.eyesRig;
  $("#eye-fit").hidden = !!part?.eyesRig;
  if (part?.eyesRig) $("#eye-color").value = part.eyesRig.color;
  $("#hair-tools").hidden =
    locked ||
    !(
      part?.shape === "head" ||
      part?.anatomy === "face" ||
      part?.outfitRole === "head"
    );
  $("#hair-source").hidden =
    !(
      part?.hairCap ||
      form.parts.some((p) => p.parent === part?.id && p.sourceHairOnly)
    ) || !!part?.groom;
  $("#hair-source").textContent = part?.hideSourceHair
    ? "Wear source hair"
    : "Take off source hair";
  $("#hair-add").hidden = !!part?.groom;
  $("#hair-remove").hidden = !part?.groom;
  $("#hair-settings").hidden = !part?.groom;
  if (part?.groom) {
    $("#hair-color").value = part.groom.color;
    $("#hair-pattern").value = part.groom.pattern ?? "Locks";
    $("#hair-axis").querySelector('[value="part"]').disabled =
      part.groom.pattern !== "Side part";
    if ($("#hair-axis").selectedOptions[0]?.disabled)
      $("#hair-axis").value = "sweep";
  }
  $("#skin-tools").hidden = !form.parts.some(canBlend);
  $("#skin-part").disabled = locked || !canBlend(part);
  $("#skin-part").textContent = part?.blendSkin
    ? "Separate selected region"
    : "Join selected region";
  $("#skin-body").disabled = locked || form.parts.filter(bodyRegion).length < 2;
  $("#skin-clear").disabled = locked || !joined.length;
  $("#skin-softness").disabled = locked;
  $("#skin-color").disabled = locked;
  $("#skin-color").value =
    form.skinTint ??
    joined[0]?.color ??
    form.parts.find(bodyRegion)?.color ??
    "#82715b";
  $("#skin-softness").value = String(form.skinSoftness ?? 0.015).replace(
    /^0\./,
    ".",
  );
  $("#branch-tool").disabled = locked;
  pressed($("#pull-tool"), pulling);
  $("#pull-settings").hidden = !pulling;
  canvas.classList.toggle(
    "pulling",
    (pulling || drawing || placement?.active) && !locked,
  );
  $("#direct").disabled = locked;
  pressed($("#direct"), direct);
  $("#focus").disabled = !target;
  $("#protect").disabled = locked || !target;
  pressed($("#protect"), protectedIds.has(target));
  variation.cues.forEach((cue, i) => {
    $("#cue-" + i).textContent = "Keep “" + cue + "”";
    $("#pin-" + i).checked = variation.pins?.[i] != null;
    $("#pin-" + i).disabled = locked;
  });
  const choices = $("#chosen-decks");
  choices.replaceChildren();
  for (const entry of variation.decks ?? []) {
    const label = document.createElement("label"),
      pin = document.createElement("input");
    label.className = "check";
    pin.type = "checkbox";
    pin.checked = entry.pin !== null;
    pin.disabled = locked;
    pin.onchange = () => {
      const decks = variation.decks.map((d) =>
        d.label === entry.label
          ? { ...d, pin: pin.checked ? variation.seed : null }
          : d,
      );
      variation = {
        ...variation,
        decks: drawDecks(decks, variation.seed, decks),
      };
      request = null;
      persist();
      update();
    };
    label.append(
      pin,
      document.createTextNode("Keep " + entry.label + " · " + entry.value),
    );
    choices.append(label);
  }
  $("#apply-decks").disabled = locked;
  $("#deck-input").disabled = locked;
  if (document.activeElement !== $("#direction-code"))
    $("#direction-code").value = directionCode(variation);
  $("#direction-replay").disabled = locked;
  $("#protected-list").textContent = protectedIds.size
    ? "Keep shape: " + [...protectedIds].join(", ")
    : "";
  $("#protected-list").hidden = !protectedIds.size;
  const arm = armChain(preview.parts, target);
  $("#elbow-tools").hidden = locked || !arm;
  $("#carry-pose-control").hidden = locked || !part || movementRoles(preview.parts).get(part.id) !== "upper arm";
  $("#carry-pose").checked = part?.holdArmPose === true;
  $("#recut-arm").disabled =
    !arm || arm.upper.shape !== "sweep" || arm.lower.shape !== "sweep";
  $("#fit-hand").hidden =
    locked || part?.shape !== "sweep" || part?.outfitRole !== "hand";
  $("#join-tools").hidden =
    locked ||
    !part?.parent ||
    !["cage", "sweep", "scute"].includes(part.shape) ||
    Boolean(part.paint);
  if (!$("#join-tools").hidden) {
    const patch = $("#join-patch"),
      last = patch.value,
      same = patch.dataset.owner === part.id;
    const choices =
      part.shape === "cage"
        ? part.cage.faces.map((_, i) => [String(i), "Face " + (i + 1)])
        : part.shape === "scute"
          ? [["base", "Upper inside surface"]]
          : [
              ["first", "First end"],
              ["last", "Last end"],
              ["both", "Both ends across an opening"],
              ["along", "Full strip along surface"],
            ];
    patch.replaceChildren(...choices.map(([v, label]) => new Option(label, v)));
    patch.dataset.owner = part.id;
    patch.value =
      same && choices.some(([v]) => v === last)
        ? last
        : part.shape === "cage"
          ? String(cageFace)
          : (part.surfaceJoin?.end ??
            (part.shape === "scute" ? "base" : "first"));
    $("#join-depth").value = Math.round(
      1000 * (part.surfaceJoin?.depth ?? 0.008),
    );
    $("#join-release").hidden = !part.surfaceJoin;
    $("#join-reading").textContent = part.surfaceJoin
      ? "Fitted to " +
        part.parent +
        " · " +
        (part.surfaceJoin.faces
          ? "faces " + part.surfaceJoin.faces.map((i) => i + 1).join(", ")
          : part.surfaceJoin.end === "along"
            ? "entire strip"
            : part.surfaceJoin.end + " end")
      : "";
  }
  $("#cage-tools").hidden = part?.shape !== "cage" || locked;
  if (!$("#cage-tools").hidden) {
    const cage = part.cage;
    cageFace = Math.min(cageFace, cage.faces.length - 1);
    const selected = cage.faces[cageFace],
      faceOptions = cage.faces.map((_, i) => new Option("Face " + (i + 1), i));
    $("#cage-face").replaceChildren(...faceOptions);
    $("#cage-face").value = cageFace;
    const other = Array.from(cage.faces.entries()).filter(
      ([i, face]) =>
        i !== cageFace &&
        face.length === selected.length &&
        face.every((v) => !selected.includes(v)),
    );
    const chosen = $("#cage-to").value;
    $("#cage-to").replaceChildren(
      ...other.map(([i]) => new Option("Face " + (i + 1), i)),
    );
    if (other.some(([i]) => String(i) === chosen)) $("#cage-to").value = chosen;
    $("#cage-tunnel").disabled = other.length === 0;
    $("#cage-level").value = cage.levels ?? 1;
    $("#cage-corner").replaceChildren(
      new Option("Whole part", ""),
      ...selected.map((i) => new Option("Corner " + (i + 1), i)),
    );
    $("#cage-corner").value = knot ?? "";
  }
  $("#grip-tools").hidden = part?.shape !== "hand" || locked;
  if (!$("#grip-tools").hidden) {
    $("#finger-count").value = part.grip?.fingers ?? 4;
    $("#finger-curl").value = (part.grip?.curl ?? 0.15) * 100;
    $("#finger-spread").value = (part.grip?.spread ?? 0.2) * 100;
  }
  updatePlateGrowth?.(preview, part, locked);
  $("#repeat-tools").hidden = part?.shape !== "sweep" || locked;
  $("#paintpart").hidden = !part || Object.hasOwn(anchors, part.shape);
  if (!$("#paintpart").hidden) {
    $("#outfit-role").value = part.outfitRole ?? "";
    $("#motion-role").value = part.motionRole ?? "";
    $("#surface").value = part.surface ?? "plain";
    $("#part-color").value = part.color;
  }
  $("#knot-tools").hidden = part?.shape !== "sweep" || !direct || locked;
  if (!$("#knot-tools").hidden) {
    $("#knot").replaceChildren(
      new Option("Whole part", ""),
      ...part.knots.map((_, i) => new Option("Point " + (i + 1), i)),
    );
    $("#knot").value = knot ?? "";
  }
  for (const id of ["thinner", "thicker", "insert-knot"])
    $("#" + id).disabled = knot === null || locked;
  for (const id of ["duplicate", "mirror", "remove"])
    $("#" + id).disabled = !part || locked;
  for (const id of ["attach", "part-color", "surface", "outfit-role"])
    $("#" + id).disabled = locked;
  gizmo?.attach(
    figure,
    preview,
    target,
    operation,
    direct &&
      !playback?.active &&
      !pulling &&
      operation !== "face" &&
      operation !== "cloth" &&
      operation !== "spine" &&
      !locked,
    knot,
    cageFace,
  );
  const hasBody = preview.parts.some(
    (p) => Object.hasOwn(anchors, p.shape) || p.outfitRole || p.visibleIn,
  );
  updateReusePaint?.(form, locked);
  updateWardrobe?.(form, target, locked);
  updateFibres?.(form, target, locked);
  for (const el of $("#outfits").children) {
    pressed(el, hasBody && el.textContent === preview.outfit);
    el.disabled =
      locked ||
      !hasBody ||
      (el.textContent === form.outfit &&
        !Object.keys(form.layerStyles ?? {}).length);
  }
  for (const el of $("#display").children)
    pressed(el, el.dataset.mode === shader);
  render();
}
function render() {
  if (!renderer) return;
  renderer.render(scene, camera);
  markTool?.draw();
  if (placeSpine) {
    const part = displayedForm?.parts.find((p) => p.id === target);
    placeSpine(
      displayedForm,
      part,
      findPart(figure, target),
      knot,
      operation === "spine" &&
        direct &&
        !pulling &&
        !drawing &&
        !proposal &&
        !busy &&
        !playback?.active,
    );
  }
  if (placeHandles) {
    const part = form.parts.find((p) => p.id === target);
    placeHandles(
      operation === "face" && direct ? findPart(figure, target) : null,
      part?.anatomy === "face",
      camera,
      direct &&
        !playback?.active &&
        !pulling &&
        operation === "face" &&
        !proposal &&
        !busy,
      part?.paint,
    );
  }

  for (let h = 0; h <= 2; h++) {
    const pos = new T.Vector3(0, h, 0).project(camera);
    $("#tick" + h).style.top = (1 - pos.y) * 50 + "%";
  }
}
function resize() {
  const width = stage.clientWidth,
    height = stage.clientHeight,
    aspect = width / height;
  const frame = Math.max(2.65, 1.65 / aspect);
  Object.assign(camera, {
    top: frame / 2,
    bottom: -frame / 2,
    left: (-frame * aspect) / 2,
    right: (frame * aspect) / 2,
  });
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
  render();
}
function setup() {
  renderer = new T.WebGLRenderer({
    canvas,
    antialias: true,
    preserveDrawingBuffer: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFShadowMap;
  scene.fog = new T.FogExp2("#dce4e1", 0.035);
  const ground = new T.Mesh(
    new T.PlaneGeometry(80, 80),
    new T.MeshStandardMaterial({ color: "#becdbf", roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.015;
  ground.receiveShadow = true;
  scene.add(ground);
  const grid = new T.GridHelper(10, 40, "#9aafa2", "#aabbaf");
  grid.position.y = -0.011;
  grid.material.transparent = true;
  grid.material.opacity = 0.54;
  scene.add(grid);
  const rim = new T.Mesh(
    new T.RingGeometry(1.27, 1.278, 96),
    new T.MeshBasicMaterial({ color: "#8da195" }),
  );
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = -0.008;
  scene.add(rim);
  scene.add(new T.HemisphereLight("#f2f6ff", "#a5aaa5", 1.35));
  const key = new T.DirectionalLight("#fff3dd", 2.8);
  key.position.set(-3.2, 5, 4.5);
  key.castShadow = true;
  Object.assign(key.shadow.camera, {
    left: -2.4,
    right: 2.4,
    top: 2.5,
    bottom: -2.5,
    near: 0.1,
    far: 12,
  });
  key.shadow.camera.updateProjectionMatrix();
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.normalBias = 0.009;
  key.shadow.bias = -0.0003;
  scene.add(key);
  const back = new T.DirectionalLight("#d8e9ff", 2.1);
  back.position.set(2.5, 3, -3);
  scene.add(back);
  controls = new OrbitControls(camera, canvas);
  controls.enablePan = false;
  controls.minZoom = 0.65;
  controls.maxZoom = 15;
  controls.minPolarAngle = 0.35;
  controls.maxPolarAngle = Math.PI / 2;
  controls.rotateSpeed = 0.75;
  controls.addEventListener("change", () => {
    for (const el of $("#angles").children) pressed(el, false);
    render();
  });
  gizmo = manipulator(scene, camera, canvas, controls, {
    pick: selectTarget,
    pickFace: (i) => {
      cageFace = i;
      knot = null;
      update();
    },
    finish: (p) => editPart(() => p),
    render,
  });
  placeSpine = spineHandles(stage, camera, {
    preview: (next) => {
      spinePreview = next;
      update();
    },
    finish: (next, index) => {
      spinePreview = null;
      knot = index;
      try {
        commit(
          next,
          "Moved spine point " + (index + 1) + " and its attachments.",
          true,
        );
      } catch (error) {
        status(error.message);
        update();
      }
    },
    cancel: () => {
      spinePreview = null;
      update();
    },
    choose: (index) => {
      knot = index;
      update();
    },
  });
  placeHandles = faceHandles(stage, {
    start: () => ({ ...amounts }),
    move: (delta) => {
      amounts = delta;
      request = null;
      update();
    },
    finish: () => commit(nudge(form, target, amounts), "Face sculpt applied."),
    cancel: (base) => {
      amounts = base;
      update();
    },
  });
  playback = motionPreview(scene, render, update);
  poseEditor(
    () =>
      busy || proposal
        ? null
        : {
            form: displayedForm,
            figure,
            target,
            capture: () => playback.capture(),
            error: status,
          },
    (next, name) => {
      commit(next, "Saved joint pose “" + name + "”.");
      playback.showPose(name);
    },
  );
  markTool = surfaceMarkEditor(stage, canvas, camera, {
    figure: () => figure,
    read: () => surfaceMarks,
    write: (next) => {
      surfaceMarks = next;
      request = proposal ? request : null;
      refineRequest = null;
      persist();
      update();
    },
    available: () =>
      !busy &&
      !showCurrent &&
      !playback?.active &&
      !document.querySelector('[data-panel="ai"]').hidden,
    note: status,
  });
  placement = branchPlacement(canvas, camera, scene, {
    figure: () => figure,
    current: () =>
      busy || proposal || playback.active ? null : nudge(form, target, amounts),
    settings: () => ({
      copy: $("#place-mode").value === "copy",
      scale: $("#place-scale").valueAsNumber / 100,
      axis: $("#place-axis").value,
      twist: $("#place-twist").valueAsNumber,
      depth: $("#place-depth").valueAsNumber / 1000,
    }),
    accept: (result, parent, copy) => {
      validateForm(result.form);
      target = result.id;
      commit(
        result.form,
        (copy ? "Copied " : "Moved ") + result.id + " onto " + parent + ".",
      );
    },
    note: status,
    render,
  });
  drawTool(canvas, camera, controls, scene, {
    active: () =>
      drawing && !busy && !proposal && !playback.active && Boolean(figure),
    figure: () => figure,
    render,
    settings: () => ({
      kind: $("#branch-type").value,
      radius:
        Math.max(0.5, Math.min(60, Number($("#branch-radius").value) || 6)) /
        100,
      mirror: $("#branch-mirror").checked,
      color: $("#branch-color").value,
    }),
    finish: (parent, points, options) => {
      try {
        const next = drawBranch(
          nudge(form, target, amounts),
          parent,
          points,
          options,
        );
        target = next.id;
        commit(next.form, "Drew " + next.id + ".");
      } catch (error) {
        status(error.message);
      }
    },
  });
  pullTool(canvas, camera, controls, {
    active: () => pulling && !busy && !proposal && !playback.active,
    figure: () => figure,
    render,
    settings: () => ({
      radius: Math.max(
        0.01,
        Math.min(1.5, Number($("#pull-size").value) / 100 || 0.07),
      ),
      mirror: $("#pull-mirror").checked,
      direction: $("#pull-direction").value,
    }),
    finish: (id, field) => {
      const base = nudge(form, target, amounts),
        p = base.parts.find((x) => x.id === id);
      if ((p.pulls?.length ?? 0) >= 64) {
        status("This part already has 64 surface pulls.");
        return;
      }
      target = id;
      commit(
        {
          ...base,
          parts: base.parts.map((x) =>
            x === p ? { ...p, pulls: [...(p.pulls ?? []), field] } : x,
          ),
        },
        "Sculpted " + id + ".",
      );
    },
  });
  bindControls();
  chooseAngle("3/4");
  resize();
  update();
  chooseAngle("3/4", true);
  new ResizeObserver(resize).observe(stage);
}
let openTicket = 0;
async function openForm(blob, ticket = ++openTicket, fromRevision = revision) {
  if (blob.size > 8000000) throw new Error("Form exceeds 8 MB.");
  const data = JSON.parse(await blob.text());
  if (data.format !== "irudd.form.v1") throw new Error("Choose a saved form.");
  validateForm(data.form);
  await restoreArtwork(data.form);
  if (ticket !== openTicket || revision !== fromRevision || busy || proposal)
    return;
  target = null;
  commit(data.form, "Form opened.");
  switchTab("sculpt");
  chooseAngle("3/4", true);
}
async function openExample() {
  const slug = new URLSearchParams(location.hash.slice(1)).get("form");
  if (!slug || !connected) return;
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) {
    status("Unknown workshop example.");
    return;
  }
  const initialRevision = revision,
    ticket = ++openTicket;
  try {
    const res = await fetch("/examples/" + slug + ".form.json");
    if (!res.ok) throw new Error("This example is unavailable.");
    await openForm(await res.blob(), ticket, initialRevision);
  } catch (error) {
    status(error.message);
  }
}
async function startWorkshop() {
  try {
    restoreSessionState(await readSession());
    setup();
    Promise.all([
      loadFacePaint(),
      loadSurfaces(),
      loadTurnarounds(),
      restoreArtwork(form),
      ...[proposal, ...reviewHistory]
        .filter(Boolean)
        .map((p) => restoreArtwork(candidateForm(p))),
    ])
      .then(() => {
        assetsReady = true;
        $("#donor-component").replaceChildren(
          ...Object.values(componentShelf()).map(
            (x) => new Option(x.title, x.key),
          ),
        );
        const initial =
          !restored &&
          !history.length &&
          !request &&
          !Object.values(amounts).some(Boolean);
        if (initial) {
          form = generateWorkshopForm("any", form.origin.seed);
          validateForm(form);
          persist();
        }
        displayedForm = null;
        update();
        if (initial) chooseAngle("3/4", true);
        if (!restoredReviewAtLink) openExample();
        window.addEventListener("hashchange", openExample);
      })
      .catch((e) => {
        console.error(e);
        status("Some surface paint is unavailable. " + e.message);
      });
  } catch (error) {
    console.error(error);
    $("#failure").hidden = false;
    $("#failure").textContent =
      "The 3D view could not start. Open this file in a browser with WebGL 2 hardware acceleration enabled.";
    document
      .querySelectorAll("button,input")
      .forEach((el) => (el.disabled = true));
  }
}
startWorkshop();
