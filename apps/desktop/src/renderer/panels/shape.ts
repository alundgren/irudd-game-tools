import {
  arrangePlates,
  branchKinds,
  cageFace,
  drawAppendage,
  faceAxes,
  drapeSweep,
  foldCloth,
  graftBranch,
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
  figureAnatomy,
  figureBuild,
  figureCage,
  figureDrape,
  figureMantle,
  figurePiece,
  figurePlateField,
  figureSculpt,
  figureSweep,
  plateFaces,
  type CharacterDocument,
  type Part,
  type Vec3,
} from "@irudd/document";
import { byId, el } from "../dom.js";
import type { EditorViewport } from "../viewport.js";
import { failure, type PanelContext } from "./context.js";
import { choices, field } from "./garment-fields.js";
import { surfaceFields } from "./surface-fields.js";

const modes = [
  "Select",
  "Face",
  "Build",
  "Cloth",
  "Spine",
  "Cage",
  "Pull",
  "Draw",
  "Mark",
] as const;
type Mode = (typeof modes)[number];

export function mountShape(
  ctx: PanelContext,
  viewport: EditorViewport,
  read: (id: string) => Promise<CharacterDocument>,
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
  let projectHandle: (() => void)[] = [];
  let startStroke: ((e: PointerEvent) => void) | undefined;
  let active:
    | { id: number; move: (e: PointerEvent) => void; finish: (e: PointerEvent) => void }
    | undefined;
  let trace: HTMLCanvasElement | undefined;
  function stop() {
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
        intercept(e);
        startStroke(e);
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
      }
    },
    true,
  );
  canvas.addEventListener(
    "pointerup",
    (e) => {
      if (active?.id === e.pointerId) {
        intercept(e);
        const finish = active.finish;
        stop();
        finish(e);
      }
    },
    true,
  );
  canvas.addEventListener("pointercancel", stop, true);
  let lastId: string | undefined;
  function render() {
    stop();
    startStroke = undefined;
    overlay.replaceChildren();
    projectHandle = [];
    const { doc, view } = ctx;
    if (lastId !== doc?.id) {
      request++;
      mode = "Select";
      donor = undefined;
      lastId = doc?.id;
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
    function edit(summary: string, make: () => readonly object[], select?: () => string) {
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
      m = choices(modes, mode);
    f.rows.append(field("Shape mode", m.input));
    m.input.onchange = () => {
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
    if (mode === "Draw" || mode === "Mark" || mode === "Pull") {
      const tool = mode;
      hint(
        tool === "Mark"
          ? "Click the model to place the named location."
          : "Drag from the model surface.",
      );
      const radius =
        tool !== "Mark"
          ? f.numeric("Radius (m)", tool === "Pull" ? 0.12 : 0.045, 0.005, 0.6)
          : () => 0.1;
      const branch = tool === "Draw" ? f.choose("Appendage", branchKinds, "Horn") : undefined;
      const colour = tool === "Draw" ? f.color("Branch colour", "#a68861") : undefined;
      const name = el("input");
      name.value = "Location";
      if (tool === "Mark") f.rows.append(field("Location name", name));
      startStroke = (e) => {
        const hit = viewport.surfaceHit(e.clientX, e.clientY),
          q = hit && ctx.part(hit.id);
        if (!hit || !q) {
          ctx.say("Start on a visible surface.");
          return;
        }
        const path: Vec3[] = [hit.world],
          at = viewport.partPoint(q.id, hit.world, "local");
        canvas.setPointerCapture(e.pointerId);
        const rect = canvas.getBoundingClientRect();
        if (tool !== "Mark") {
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
        const sample = (event: PointerEvent) => {
          path.push(viewport.planePoint(event.clientX, event.clientY, hit.world));
          if (line) {
            line.lineTo(event.clientX - rect.left, event.clientY - rect.top);
            line.stroke();
          }
        };
        active = {
          id: e.pointerId,
          move: sample,
          finish: (event) => {
            sample(event);
            if (tool === "Mark") {
              edit("Mark " + name.value, () => [markLocation(q, name.value, at)]);
              return;
            }
            const end = viewport.partPoint(q.id, path.at(-1) ?? hit.world, "local");
            const delta: Vec3 = [end[0] - at[0], end[1] - at[1], end[2] - at[2]];
            if (Math.hypot(...delta) < 0.0001) return;
            if (tool === "Pull")
              edit("Pull " + q.label, () => [
                pullPart(q, at, delta, viewport.brushReach(q.id, radius())),
              ]);
            else {
              let child: Part;
              edit(
                "Draw appendage",
                () => {
                  child = drawAppendage(
                    q,
                    path.map((pt) => viewport.partPoint(q.id, pt, "mount")),
                    branch?.() ?? "Horn",
                    radius(),
                    colour?.() ?? q.color,
                  );
                  return [{ op: "part.add", part: child }];
                },
                () => child.id,
              );
            }
          },
        };
      };
    }
    if (p && figureSweep.read(p.features)) {
      const plates = section("Spine plates"),
        settings = figurePlateField.read(p.features);
      const rows = plates.numeric("Plate rows", settings?.rows ?? 4, 2, 12, 1),
        cols = plates.choose(
          "Plate columns",
          ["1", "3", "5", "7"] as const,
          String(settings?.columns ?? 3),
        ),
        start = plates.numeric("Start along spine", settings?.start ?? 0.1, 0, 0.96),
        end = plates.numeric("End along spine", settings?.end ?? 0.9, 0.04, 1),
        wrap = plates.numeric("Wrap (degrees)", settings?.wrap ?? 95, 20, 165, 1),
        overlap = plates.numeric("Plate overlap", settings?.overlap ?? 0.25, 0, 0.8),
        crest = plates.numeric("Crest height", settings?.crest ?? 0.5, 0, 1),
        face = plates.choose("Plate face", plateFaces, settings?.face ?? "Front"),
        color = plates.color("Plate colour", settings?.color ?? "#bcaa84");
      for (const isField of [true, false]) {
        const title = isField ? "Grow plate field" : "Repeat plates";
        plates.action(title, () =>
          edit(title, () =>
            arrangePlates(
              doc,
              p.id,
              rows(),
              ([1, 3, 5, 7] as const).find((n) => String(n) === cols()) ?? 3,
              face(),
              color(),
              isField,
              { start: start(), end: end(), wrap: wrap(), overlap: overlap(), crest: crest() },
            ),
          ),
        );
      }
    }
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
    source.append(new Option("Choose a character", ""));
    for (const option of byId("document", HTMLSelectElement).options)
      if (option.value !== doc.id) source.append(new Option(option.text, option.value));
    source.value = donor?.id ?? "";
    graft.rows.append(field("Source character", source));
    source.onchange = () => {
      const seq = ++request;
      donor = undefined;
      if (!source.value) {
        render();
        return;
      }
      void read(source.value)
        .then((d) => {
          if (seq === request) {
            donor = d;
            render();
          }
        })
        .catch((e) => ctx.showBanner("error", failure(e)));
    };
    if (donor && p) {
      const selected = donor,
        parts = selected.parts.filter(
          (q) => !(selected.generation?.generator === "irudd.human-adult" && q.slot),
        ),
        list = el("select");
      for (const q of parts) list.append(new Option(q.label, q.id));
      graft.rows.append(field("Source part", list));
      graft.action(
        "Graft branch",
        () =>
          edit("Graft saved branch", () => {
            const root = parts.find((q) => q.id === list.value);
            if (!root) throw new Error("Choose a source part.");
            return graftBranch(selected, root, doc, p, viewport.graftPoint(p.id));
          }),
        !!parts.length,
      );
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
