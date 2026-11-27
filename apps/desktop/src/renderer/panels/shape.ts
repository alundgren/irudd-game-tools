import {
  branchKinds,
  branchStroke,
  cageFace,
  drawBranches,
  placeBranch,
  faceAxes,
  drapeSweep,
  foldCloth,
  graftModes,
  markLocation,
  moveControl,
  moveSpine,
  pullPart,
  resizeCharacter,
  shapeBuild,
  shapeFace,
} from "@irudd/character";
import {
  buildAxes,
  descendants,
  humanCorrections,
  jsonEqual,
  isJson,
  isJsonObject,
  isJsonArray,
  readDocument,
  type Registry,
  figureAnatomy,
  figureBuild,
  figureCage,
  figureDrape,
  figureMantle,
  figurePiece,
  figureSculpt,
  figureSweep,
  type CharacterDocument,
  type Vec3,
} from "@irudd/document";
import { byId, el } from "../dom.js";
import type { EditorViewport } from "../viewport.js";
import { stagePicture } from "../art-files.js";
import { failure, type PanelContext } from "./context.js";
import { choices, field } from "./garment-fields.js";
import { spinePlates } from "./spine-plates.js";
import { surfaceFields } from "./surface-fields.js";

const modes = [
  "Select",
  "Face",
  "Build",
  "Cloth",
  "Spine",
  "Cage",
  "Pull",
  "Sculpt skin",
  "Place branch",
  "Draw",
  "Mark",
] as const;
type Mode = (typeof modes)[number];

export function mountShape(
  ctx: PanelContext,
  viewport: EditorViewport,
  read: (id: string) => Promise<CharacterDocument>,
  registry: () => Registry,
) {
  const panel = byId("shape-editor", HTMLDetailsElement),
    body = panel.querySelector("div");
  const host = byId("viewport", HTMLDivElement),
    canvas = viewport.renderer.domElement;
  const overlay = el("div", { className: "shape-overlay" });
  host.append(overlay);
  const opened = new Set(["Edit mode"]);
  let mode: Mode = "Select",
    donor: CharacterDocument | undefined,
    request = 0,
    pending = false;
  let pinned: { label: string; height: number; image: string } | undefined;
  let graftMode: (typeof graftModes)[number] = graftModes[0],
    matchHeight = true;
  let sourcePart = "",
    shelfKey = "";
  const shelf = new Map<
    string,
    { label: string; doc: CharacterDocument; root: string; children: boolean }
  >();
  let loadingShelf: Promise<void> | undefined;
  function loadShelf() {
    loadingShelf ??= fetch(new URL("../graft-shelf.json", import.meta.url))
      .then((r) => r.json())
      .then((raw: unknown) => {
        if (!isJson(raw) || !isJsonArray(raw)) throw new Error("Invalid graft shelf.");
        for (const row of raw) {
          if (
            !isJsonObject(row) ||
            typeof row["key"] !== "string" ||
            typeof row["label"] !== "string" ||
            typeof row["root"] !== "string" ||
            typeof row["children"] !== "boolean"
          )
            throw new Error("Invalid shelf component.");
          const doc = readDocument(row["document"], { registry: registry() });
          if (!doc.ok) throw new Error("Invalid shelf donor " + row["label"]);
          shelf.set(row["key"], {
            label: row["label"],
            doc: doc.value,
            root: row["root"],
            children: row["children"],
          });
        }
        render();
      })
      .catch((e) => ctx.showBanner("error", failure(e)));
  }
  let projectHandle: (() => void)[] = [];
  let startStroke: ((e: PointerEvent) => void) | undefined;
  let active:
    | { id: number; move: (e: PointerEvent) => void; finish: (e: PointerEvent) => void }
    | undefined;
  let brushFrame = 0;
  let trace: HTMLCanvasElement | undefined;
  let restore: (() => void) | undefined, hover: ((e: PointerEvent) => void) | undefined;
  let placementClick: ((e: PointerEvent) => void) | undefined;
  let placementDown: { id: number; x: number; y: number } | undefined;
  let pin: { source: string; world: Vec3; revision: number } | undefined;
  const settings = new Map<string, string>();
  const ring = el("div", { className: "skin-brush-ring" });
  canvas.addEventListener("pointerleave", () => {
    if (!active) ring.hidden = true;
  });
  canvas.addEventListener(
    "pointerdown",
    (e) => {
      if (placementClick && e.isPrimary && e.button === 0)
        placementDown = { id: e.pointerId, x: e.clientX, y: e.clientY };
    },
    true,
  );
  canvas.addEventListener(
    "pointerup",
    (e) => {
      const down = placementDown;
      placementDown = undefined;
      if (
        placementClick &&
        down?.id === e.pointerId &&
        Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5
      ) {
        e.preventDefault();
        try {
          placementClick(e);
        } catch (err) {
          ctx.showBanner("error", failure(err));
        }
      }
    },
    true,
  );
  function stop() {
    cancelAnimationFrame(brushFrame);
    brushFrame = 0;
    restore?.();
    restore = undefined;
    viewport.request();
    ring.hidden = true;
    trace?.remove();
    trace = undefined;
    if (active && canvas.hasPointerCapture(active.id)) canvas.releasePointerCapture(active.id);
    active = undefined;
  }
  function intercept(e: PointerEvent) {
    e.preventDefault();
    e.stopImmediatePropagation();
  }
  canvas.addEventListener(
    "pointerdown",
    (e) => {
      if (e.button === 0 && !pending && !active && startStroke && !viewport.motion) {
        try {
          startStroke(e);
        } catch (err) {
          stop();
          ctx.showBanner("error", failure(err));
        }
        if (active) intercept(e);
      }
    },
    true,
  );
  canvas.addEventListener(
    "pointermove",
    (e) => {
      if (active?.id === e.pointerId) {
        intercept(e);
        active.move(e);
      } else hover?.(e);
    },
    true,
  );
  canvas.addEventListener(
    "pointerup",
    (e) => {
      if (active?.id === e.pointerId) {
        intercept(e);
        const finish = active.finish;
        try {
          finish(e);
        } catch (err) {
          ctx.showBanner("error", failure(err));
        } finally {
          stop();
        }
      }
    },
    true,
  );
  canvas.addEventListener(
    "pointercancel",
    (e) => {
      if (placementDown?.id === e.pointerId) placementDown = undefined;
      if (active?.id === e.pointerId) stop();
    },
    true,
  );
  let lastId: string | undefined;
  function render() {
    stop();
    if (placementDown) placementDown = undefined;
    hover = undefined;
    placementClick = undefined;
    startStroke = undefined;
    overlay.replaceChildren();
    projectHandle = [];
    const { doc, view } = ctx;
    if (lastId !== doc?.id) {
      request++;
      mode = "Select";
      donor = undefined;
      shelfKey = "";
      pin = undefined;
      lastId = doc?.id;
    }
    if ((!panel.open || viewport.motion) && (mode === "Place branch" || mode === "Sculpt skin")) {
      pin = undefined;
      mode = "Select";
    }
    panel.hidden = !doc || Boolean(viewport.motion);
    viewport.setLocations(panel.open && !viewport.motion);
    if (!doc || !body || !view || viewport.motion || !viewport.shows(doc)) return;
    const p = ctx.part(ctx.selection ?? ""),
      base = { documentId: doc.id, revision: view.revision };
    function marker(
      id: string,
      at: Vec3,
      label: string,
      control: { kind: "Cage" | "Spine"; index: number },
    ) {
      const node = el("button", { className: "shape-point", title: label });
      node.setAttribute("aria-label", label);
      overlay.append(node);
      let world = viewport.partPoint(id, at, "world");
      const place = () => {
        const [x, y] = viewport.project(world);
        node.style.left = x + "px";
        node.style.top = y + "px";
      };
      projectHandle.push(place);
      place();
      if (!p) return;
      const selected = p,
        origin = world;
      node.onpointerdown = (e) => {
        if (e.button !== 0 || pending) return;
        intercept(e);
        node.setPointerCapture(e.pointerId);
      };
      node.onpointermove = (e) => {
        if (!node.hasPointerCapture(e.pointerId)) return;
        world = viewport.planePoint(e.clientX, e.clientY, origin);
        place();
      };
      node.onpointercancel = () => {
        world = origin;
        place();
      };
      node.onpointerup = (e) => {
        if (!node.hasPointerCapture(e.pointerId)) return;
        node.releasePointerCapture(e.pointerId);
        world = viewport.planePoint(e.clientX, e.clientY, origin);
        place();
        if (Math.hypot(world[0] - origin[0], world[1] - origin[1], world[2] - origin[2]) > 0.00001)
          edit("Move " + label, () => {
            const to = viewport.partPoint(id, world, "local");
            if (control.kind === "Spine" && doc) return moveSpine(doc, selected, control.index, to);
            return [moveControl(selected, control.kind, control.index, to)];
          });
      };
    }
    if (!panel.open) return;
    function edit(summary: string, make: () => readonly object[], select?: () => string | null) {
      if (pending) return;
      try {
        const ops = make();
        pending = true;
        panel.inert = true;
        void ctx
          .commit({ type: "edit", summary, ops }, summary, base)
          .then((ok) => {
            if (ok && select) ctx.selectPart(select());
          })
          .finally(() => {
            pending = false;
            panel.inert = false;
          });
      } catch (e) {
        ctx.showBanner("error", failure(e));
      }
    }
    for (const box of body.querySelectorAll<HTMLDetailsElement>(":scope > details")) {
      const title = box.querySelector("summary")?.textContent;
      if (!title) continue;
      if (box.open) opened.add(title);
      else opened.delete(title);
    }
    body.replaceChildren();
    const section = (name: string) => {
      const f = surfaceFields(name, opened);
      body.append(f.box);
      return f;
    };
    const f = section("Edit mode"),
      m = choices(
        doc.generation?.generator === "irudd.human-adult"
          ? modes
          : modes.filter((v) => v !== "Sculpt skin"),
        mode,
      );
    f.rows.append(field("Shape mode", m.input));
    m.input.onchange = () => {
      pin = undefined;
      mode = m.read();
      render();
    };
    function hint(text: string) {
      f.rows.append(el("p", { className: "muted", text }));
    }
    if (mode === "Face") {
      if (
        p &&
        (figurePiece.read(p.features)?.piece === "head" ||
          figureSculpt.read(p.features) ||
          figureAnatomy.read(p.features)?.region === "face")
      ) {
        const axis = f.choose("Face feature", faceAxes, "jaw"),
          v = f.numeric("Face multiplier", 1, 0.35, 2);
        f.action("Shape face", () => edit("Shape " + axis(), () => [shapeFace(p, axis(), v())]));
      } else hint("Select a figure head or traced face.");
    }
    if (mode === "Build") {
      const axis = f.choose("Build feature", buildAxes, "mass"),
        v = f.numeric("Build multiplier", figureBuild.read(doc.features)?.mass ?? 1, 0.4, 2.4);
      if (doc.generation?.generator === "irudd.human-adult")
        hint("Use the adult measurements in Appearance.");
      else
        f.action("Shape build", () =>
          edit("Adjust " + axis(), () => [shapeBuild(doc, axis(), v())]),
        );
    }
    if (mode === "Cloth") {
      const mantle = p && figureMantle.read(p.features);
      if (p && mantle) {
        const folds = f.numeric("Fold count", mantle.cut.folds, 0, 24, 1),
          flare = f.numeric("Hem flare", mantle.cut.flare, 0.65, 2.2);
        f.action("Shape cloth", () =>
          edit("Adjust garment folds", () => [foldCloth(p, folds(), flare())]),
        );
      } else if (p && figureSweep.read(p.features)) {
        const current = figureDrape.read(p.features),
          folds = f.numeric("Fold count", current?.folds ?? 10, 2, 32, 1),
          depth = f.numeric("Fold depth", current?.depth ?? 0.09, 0, 0.3),
          slit = f.numeric("Hem opening", current?.slit ?? 0, 0, 0.35),
          slitHeight = f.numeric("Slit height", current?.slitHeight ?? 0.6, 0.05, 1);
        f.action("Drape cloth", () =>
          edit("Drape swept cloth", () => [
            drapeSweep(p, {
              folds: folds(),
              depth: depth(),
              slit: slit(),
              slitHeight: slitHeight(),
              twist: current?.twist ?? 0.25,
            }),
          ]),
        );
      } else hint("Select a swept part or cut garment to adjust its folds and hem.");
    }
    if (mode === "Spine" || mode === "Cage") {
      const cage = p && figureCage.read(p.features),
        sweep = p && figureSweep.read(p.features);
      const pts = mode === "Cage" ? cage?.vertices : sweep?.knots;
      if (p && pts) {
        for (const [index, pt] of pts.entries())
          marker(p.id, [pt[0], pt[1], pt[2]], mode + " point " + (index + 1), {
            kind: mode,
            index,
          });
        hint("Drag a point on the model.");
        if (mode === "Cage" && cage) {
          const index = f.numeric("Face number", 1, 1, cage.faces.length, 1),
            op = f.choose(
              "Face operation",
              ["Inset", "Extrude", "Crease", "Tunnel"] as const,
              "Extrude",
            ),
            other = f.numeric(
              "Tunnel to face",
              Math.min(2, cage.faces.length),
              1,
              cage.faces.length,
              1,
            ),
            amount = f.numeric("Face amount", 0.2, 0.01, 0.94);
          f.action("Edit cage face", () =>
            edit(op() + " cage face", () => [
              cageFace(p, index() - 1, op(), amount(), other() - 1),
            ]),
          );
        }
      } else hint(mode === "Cage" ? "Select a cage part." : "Select a swept part.");
    }
    function remember() {
      for (const control of f.rows.querySelectorAll("input,select")) {
        if (
          !(control instanceof HTMLInputElement || control instanceof HTMLSelectElement) ||
          control === m.input
        )
          continue;
        const key = mode + " " + control.getAttribute("aria-label");
        const value = settings.get(key),
          check = control instanceof HTMLInputElement && control.type === "checkbox";
        if (value !== undefined) {
          if (check) control.checked = value === "true";
          else control.value = value;
        }
        const update = () => settings.set(key, check ? String(control.checked) : control.value);
        control.addEventListener("change", update);
        control.addEventListener("input", update);
      }
    }
    const shifted = (v: Vec3, n: Vec3, amount: number): Vec3 => [
      v[0] + n[0] * amount,
      v[1] + n[1] * amount,
      v[2] + n[2] * amount,
    ];
    if (mode === "Place branch") {
      const operation = f.choose(
          "Placement",
          ["Copy branch", "Move branch"] as const,
          "Copy branch",
        ),
        scale = f.numeric("Branch size (%)", 100, 10, 400),
        axis = f.choose("Turn around", ["Surface normal", "View axis"] as const, "Surface normal"),
        twist = f.numeric("Turn (degrees)", 0, -360, 360),
        depth = f.numeric("Seat inside surface (mm)", 8, 0, 100);
      remember();
      if (pin?.revision !== base.revision) pin = undefined;
      hint(
        pin
          ? "Click the receiving surface. Drag to orbit."
          : p
            ? "Pick an anchor on " + p.label + " or one of its children."
            : "Pick an anchor on the branch to place.",
      );
      if (pin) {
        const dot = el("div", { className: "branch-anchor" }),
          at = pin.world;
        overlay.append(dot);
        const project = () => {
          const [x, y] = viewport.project(at);
          dot.style.left = x + "px";
          dot.style.top = y + "px";
        };
        projectHandle.push(project);
        project();
      }
      placementClick = (e) => {
        if (pending) return;
        const hit = viewport.surfaceHit(e.clientX, e.clientY);
        const target = hit && ctx.part(hit.id);
        if (!target || !hit) return ctx.say("Pick a visible surface. Drag empty space to orbit.");
        if (!pin) {
          const source = p ?? target;
          if (!descendants(doc, source.id).has(target.id))
            return ctx.say("Pick a point on " + source.label + " or a child.");
          pin = { source: source.id, world: hit.world, revision: base.revision };
          render();
          return;
        }
        const source = ctx.part(pin.source);
        if (!source) return;
        const result = placeBranch(
          doc,
          source,
          target,
          viewport.branchMatrix(source.id, "object"),
          viewport.branchMatrix(target.id, "mount"),
          {
            anchor: pin.world,
            point: hit.world,
            normal: hit.normal,
            axis: axis() === "View axis" ? viewport.viewAxis() : hit.normal,
            depth: depth() / 1000,
            twist: twist(),
            scale: scale() / 100,
            copy: operation() === "Copy branch",
          },
        );
        edit(
          operation(),
          () => result.ops,
          () => {
            pin = undefined;
            mode = "Select";
            return result.id;
          },
        );
      };
    }
    if (mode === "Draw" || mode === "Mark" || mode === "Pull" || mode === "Sculpt skin") {
      const tool = mode,
        skin = tool === "Sculpt skin",
        pull = tool === "Pull",
        draw = tool === "Draw";
      const radius = skin
        ? f.numeric("Reach (cm)", 6, 2, 16, 1)
        : pull
          ? f.numeric("Reach (cm)", 7, 1, 150)
          : draw
            ? f.numeric("Radius (m)", 0.06, 0.005, 0.6)
            : () => 0;
      const direction = skin
        ? f.choose(
            "Drag direction",
            ["Screen plane", "Normal", "Soften corrections"] as const,
            "Screen plane",
          )
        : pull
          ? f.choose("Drag direction", ["Screen plane", "Normal"] as const, "Screen plane")
          : () => "Screen plane";
      const mirror =
        tool === "Mark"
          ? () => false
          : f.check(pull ? "Mirror across this part" : "Mirror across the character", skin);
      const branch = draw ? f.choose("Appendage", branchKinds, "Horn") : undefined,
        colour = draw ? f.color("Branch colour", "#987453") : undefined;
      const name = el("input");
      name.value = "Location";
      if (tool === "Mark") f.rows.append(field("Location name", name));
      if (skin) {
        hint("Drag on bare skin. Drag up to raise, down to sink, or across to soften.");
        f.action("Remove surface corrections", () => {
          if (!humanCorrections.read(doc.features))
            return ctx.say("This body has no surface corrections.");
          edit("Remove surface corrections", () => [
            { op: "feature.set", feature: humanCorrections.id, value: null },
          ]);
        });
        overlay.append(ring);
        ring.hidden = true;
      } else
        hint(
          draw
            ? "Drag from the surface to draw an appendage."
            : pull
              ? "Drag the surface. In Normal mode, drag up to raise or down to indent."
              : "Click the model to place the named location.",
        );
      remember();
      const mark = (world: Vec3, size: number) => {
        const [x, y] = viewport.project(world);
        ring.style.left = x + "px";
        ring.style.top = y + "px";
        ring.style.width = ring.style.height = (2 * size) / viewport.pixelSize(world) + "px";
        ring.hidden = false;
      };
      if (skin)
        hover = (e) => {
          const h = viewport.surfaceHit(e.clientX, e.clientY);
          if (h?.skin) {
            try {
              mark(h.world, radius() / 100);
            } catch {
              ring.hidden = true;
            }
          } else ring.hidden = true;
        };
      startStroke = (e) => {
        const hit = viewport.surfaceHit(e.clientX, e.clientY, tool === "Mark"),
          q = hit && ctx.part(hit.id);
        if (!hit || !q || (skin && !hit.skin)) return;
        const reach = radius() / (draw ? 1 : 100),
          sym = mirror(),
          dragMode = direction();
        const at = viewport.partPoint(q.id, hit.world, "local"),
          fieldReach = pull ? viewport.brushReach(q.id, reach) : undefined;
        const brush = pull ? viewport.partBrush(q.id, sym) : undefined,
          adult = skin ? viewport.skinBrush(hit, reach, sym) : undefined;
        restore = () => {
          brush?.restore();
          adult?.restore();
        };
        if (adult) mark(hit.world, adult.radius);
        canvas.setPointerCapture(e.pointerId);
        const stroke = draw ? branchStroke(hit.world, hit.normal, reach) : undefined;
        const rect = canvas.getBoundingClientRect();
        if (draw) {
          trace = el("canvas");
          trace.className = "shape-trace";
          trace.width = canvas.clientWidth;
          trace.height = canvas.clientHeight;
          overlay.append(trace);
        }
        const line = trace?.getContext("2d");
        if (line) {
          line.strokeStyle = "#ffd596";
          line.lineWidth = 2;
          line.beginPath();
          line.moveTo(e.clientX - rect.left, e.clientY - rect.top);
        }
        let delta: Vec3 = [0, 0, 0],
          fit: ReturnType<typeof humanCorrections.read>;
        const sample = (event: PointerEvent) => {
          const plane = viewport.planePoint(event.clientX, event.clientY, hit.world);
          const end =
            dragMode === "Normal"
              ? shifted(
                  hit.world,
                  hit.normal,
                  (e.clientY - event.clientY) * viewport.pixelSize(hit.world),
                )
              : plane;
          const local = viewport.partPoint(q.id, end, "local");
          if (stroke) {
            if (stroke.sample(plane)) {
              line?.lineTo(event.clientX - rect.left, event.clientY - rect.top);
              line?.stroke();
            }
          } else if (brush && fieldReach) {
            const clamp = (n: number) => Math.min(4, Math.max(-4, n));
            delta = [clamp(local[0] - at[0]), clamp(local[1] - at[1]), clamp(local[2] - at[2])];
            brush.apply({
              at,
              offset: delta,
              reach: fieldReach,
              ...(brush.mirrorX === undefined ? {} : { mirrorX: brush.mirrorX }),
            });
          } else if (adult) {
            delta = [end[0] - hit.world[0], end[1] - hit.world[1], end[2] - hit.world[2]];
            const share = Math.min(
              1,
              Math.hypot(event.clientX - e.clientX, event.clientY - e.clientY) / 140,
            );
            fit = adult.apply(
              dragMode === "Soften corrections"
                ? share > 0.02
                  ? share
                  : 0
                : Math.hypot(...delta) > 0.0005
                  ? delta
                  : [0, 0, 0],
            );
          }
          viewport.request();
        };
        let latest = e;
        active = {
          id: e.pointerId,
          move: (event) => {
            if (!adult) return sample(event);
            latest = event;
            brushFrame ||= requestAnimationFrame(() => {
              brushFrame = 0;
              sample(latest);
            });
          },
          finish: (event) => {
            sample(event);
            if (tool === "Mark")
              return edit("Mark " + name.value, () => [markLocation(q, name.value, at)]);
            if (stroke && branch && colour && stroke.points.length > 1) {
              const parts = drawBranches(
                doc,
                q,
                stroke.points,
                branch(),
                reach,
                colour(),
                sym,
                (id) => viewport.branchMatrix(id, "mount"),
              );
              const first = parts[0];
              if (first)
                edit(
                  "Draw appendage",
                  () => parts.map((part) => ({ op: "part.add", part })),
                  () => first.id,
                );
            } else if (brush && fieldReach && Math.hypot(...delta) > 0.0001)
              edit(
                "Pull " + q.label,
                () => [pullPart(q, at, delta, fieldReach, brush.mirrorX)],
                () => q.id,
              );
            else if (adult && fit) {
              const value = fit.controls.length ? humanCorrections.json(fit) : null;
              if (jsonEqual(doc.features[humanCorrections.id] ?? null, value))
                return ctx.say("No surface correction changed.");
              edit("Sculpt " + q.label, () => [
                { op: "feature.set", feature: humanCorrections.id, value },
              ]);
            }
          },
        };
      };
    }
    if (p) spinePlates(doc, p, section, edit);
    const scale = section("World scale"),
      height = viewport.height();
    scale.rows.append(el("p", { text: "Height " + height.toFixed(3) + " m" }));
    if (pinned)
      scale.rows.append(
        el("p", {
          text:
            pinned.label +
            ", " +
            pinned.height.toFixed(3) +
            " m. Current character " +
            (height / pinned.height).toFixed(2) +
            " times as tall",
        }),
      );
    if (pinned) {
      const display = el("div", { className: "size-comparison" }),
        largest = Math.max(height, pinned.height);
      for (const item of [
        pinned,
        { label: doc.label, height, image: viewport.comparisonImage() },
      ]) {
        const img = el("img");
        img.src = item.image;
        img.alt = item.label;
        img.style.height = (96 * item.height) / largest + "px";
        display.append(img);
      }
      scale.rows.append(display);
    }
    scale.action("Pin height for comparison", () => {
      pinned = { label: doc.label, height, image: viewport.comparisonImage() };
      render();
    });
    const target = scale.numeric("Target height (m)", Number(height.toFixed(3)), 0.01, 100);
    scale.action("Set height", () =>
      edit("Set world height", () => resizeCharacter(doc, height, target())),
    );
    const graft = section("Graft a saved part"),
      source = el("select");
    loadShelf();
    source.append(new Option("Choose a character", ""));
    for (const [key, entry] of shelf) source.append(new Option(entry.label, "shelf-" + key));
    for (const option of byId("document", HTMLSelectElement).options)
      if (option.value !== doc.id) source.append(new Option(option.text, option.value));
    if (donor && !shelfKey && !Array.from(source.options).some((o) => o.value === donor?.id))
      source.add(new Option(donor.label, donor.id));
    source.value = shelfKey ? "shelf-" + shelfKey : (donor?.id ?? "");
    graft.rows.append(field("Source character", source));
    source.onchange = () => {
      const seq = ++request;
      donor = undefined;
      sourcePart = "";
      shelfKey = source.value.startsWith("shelf-") ? source.value.slice(6) : "";
      const entry = shelf.get(shelfKey);
      render();
      if (entry) {
        void Promise.all(
          entry.doc.assets.map(async (a) =>
            stagePicture(ctx.host, await ctx.api.bundledImage(a.digest)),
          ),
        )
          .then(() => {
            if (seq === request) {
              donor = entry.doc;
              sourcePart = entry.root;
              render();
            }
          })
          .catch((e) => ctx.showBanner("error", failure(e)));
        return;
      }
      if (!source.value) return;
      void read(source.value)
        .then((d) => {
          if (seq === request) {
            donor = d;
            render();
          }
        })
        .catch((e) => ctx.showBanner("error", failure(e)));
    };
    graft.action("Use a saved form", () => {
      const seq = ++request;
      void ctx.api
        .openCharacter(true)
        .then((opened) => {
          if (!opened.ok) {
            if (!opened.canceled) throw new Error(opened.error.message);
            return;
          }
          if (opened.action !== "opened") throw new Error("Expected a donor character.");
          const result = readDocument(opened.document, { registry: registry() });
          if (!result.ok) throw new Error("The donor character is invalid.");
          const d = result.value;
          if (seq === request) {
            donor = d;
            sourcePart = "";
            shelfKey = "";
            render();
          }
        })
        .catch((e) => ctx.showBanner("error", failure(e)));
    });
    if (donor && p) {
      const selected = donor,
        list = el("select");
      for (const q of selected.parts) list.append(new Option(q.label, q.id));
      if (selected.parts.some((q) => q.id === sourcePart)) list.value = sourcePart;
      list.onchange = () => {
        sourcePart = list.value;
      };
      if (!shelfKey) graft.rows.append(field("Source part", list));
      const which = choices(graftModes, graftMode);
      graft.rows.append(field("Attachment", which.input));
      which.input.onchange = () => {
        sourcePart = list.value;
        graftMode = which.read();
        render();
      };
      const fit =
        graftMode === "Recut garment pattern"
          ? undefined
          : graft.check("Match destination height", matchHeight);
      graft.action("Graft branch", () => {
        let id: string | null = null;
        edit(
          "Graft saved branch",
          () => {
            const root = selected.parts.find((q) => q.id === list.value);
            if (!root) throw new Error("Choose a source part.");
            matchHeight = fit?.() ?? matchHeight;
            const result = viewport.graft(
              selected,
              root,
              p,
              graftMode,
              matchHeight,
              shelf.get(shelfKey)?.children,
            );
            id = result.id;
            return result.ops;
          },
          () => {
            viewport.setAngle("threequarter");
            return id;
          },
        );
      });
    } else
      graft.rows.append(
        el("p", {
          className: "muted",
          text: "Open the saved source in this project, then select a destination part.",
        }),
      );
  }
  byId("motion-editor", HTMLDetailsElement).addEventListener("toggle", render);
  panel.ontoggle = render;
  return {
    render,
    place: () => {
      for (const f of projectHandle) f();
    },
  };
}
