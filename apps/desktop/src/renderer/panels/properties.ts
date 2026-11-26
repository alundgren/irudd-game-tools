import { button, byId, el, numberInput } from "../dom.js";
import type { PanelContext } from "./context.js";

export function mountProperties(ctx: PanelContext) {
  async function setPart(id: string, set: Record<string, unknown>, what: string): Promise<void> {
    await ctx.commit(
      { type: "edit", ops: [{ op: "part.set", part: id, set }], summary: what },
      what,
    );
  }

  const properties = byId("properties", HTMLDivElement);

  function triple(
    values: ReadonlyArray<number>,
    onCommit: (next: [number, number, number]) => void,
  ): HTMLElement {
    const current: [number, number, number] = [values[0] ?? 0, values[1] ?? 0, values[2] ?? 0];
    return el(
      "div",
      { className: "triple" },
      ...current.map((v, i) =>
        numberInput(v, (next) => {
          const copy: [number, number, number] = [...current];
          copy[i] = next;
          onCommit(copy);
        }),
      ),
    );
  }

  let nudge:
    | { id: string; documentId: string; revision: number; axis: number; percent: number }
    | undefined;
  function renderProperties(): void {
    const { doc, view, part, rename, commit } = ctx;
    properties.replaceChildren();
    if (!doc || !view) {
      properties.append(el("p", { className: "muted", text: "Start or open a character." }));
      return;
    }
    const docLabel = el("input");
    docLabel.value = doc.label;
    docLabel.onchange = () => {
      const label = docLabel.value.trim();
      if (label && label !== ctx.doc?.label)
        void commit(
          {
            type: "edit",
            ops: [{ op: "document.label", label }],
            summary: `Name the character ${label}`,
          },
          `Name the character ${label}`,
        );
    };
    const policy = el("input");
    policy.type = "checkbox";
    policy.checked = view.policy.agentDirectEdit;
    policy.onchange = () =>
      void commit({ type: "policy.set", agentDirectEdit: policy.checked }, "Agent policy");
    const grid = el(
      "div",
      { className: "props" },
      el("span", { text: "Character" }),
      docLabel,
      el("span", { text: "Agents" }),
      el("label", {}, policy, " may edit directly"),
    );
    properties.append(grid);
    const id = ctx.selection;
    const p = id === null ? undefined : part(id);
    if (!p) {
      properties.append(
        el("p", { className: "muted", text: "Select a part in the outliner or viewport." }),
      );
      return;
    }
    if (
      nudge &&
      (nudge.documentId !== doc.id || nudge.id !== p.id || nudge.revision !== view.revision)
    )
      nudge = undefined;
    const label = el("input");
    label.value = p.label;
    label.onchange = () => void rename(p.id, label.value);
    const color = el("input");
    color.type = "color";
    color.value = p.color;
    color.onchange = () => void setPart(p.id, { color: color.value }, `Colour ${p.label}`);
    properties.append(
      el(
        "div",
        { className: "props" },
        el("span", { text: "Name" }),
        label,
        el("span", { text: "Shape" }),
        el("span", { text: p.shape }),
        el("span", { text: "Size (m)" }),
        triple(p.size, (size) => void setPart(p.id, { size }, `Resize ${p.label}`)),
        el("span", { text: "Position" }),
        triple(p.position, (position) => void setPart(p.id, { position }, `Move ${p.label}`)),
        el("span", { text: "Colour" }),
        color,
        el("span", { text: "Parent" }),
        el("span", { text: p.parent === null ? "none" : (part(p.parent)?.label ?? p.parent) }),
      ),
    );
    const pending = nudge;
    const roll = button("Small reroll", () => {
      const values = crypto.getRandomValues(new Uint32Array(2));
      const axis = (values[0] ?? 0) % 3;
      const size = p.size[axis] ?? 1;
      const drawn = (values[1] ?? 0) % 20;
      const amount = 3 + (drawn % 10);
      const shrinking =
        size > 100 / (1 + amount / 100) || (drawn >= 10 && size * (1 - amount / 100) >= 0.0005);
      nudge = {
        id: p.id,
        documentId: doc.id,
        revision: view.revision,
        axis,
        percent: shrinking ? -amount : amount,
      };
      renderProperties();
    });
    const reset = button("Reset", () => {
      nudge = undefined;
      renderProperties();
    });
    const apply = button("Apply nudge", () => {
      if (!pending) return;
      const size = p.size.map((len, i) =>
        i === pending.axis ? len * (1 + pending.percent / 100) : len,
      );
      const summary = "Nudge " + p.label;
      void commit(
        { type: "edit", ops: [{ op: "part.set", part: p.id, set: { size } }], summary },
        summary,
        { documentId: doc.id, revision: view.revision },
      );
    });
    reset.disabled = apply.disabled = !pending;
    properties.append(el("div", { className: "row-actions" }, roll, reset, apply));
    if (pending)
      properties.append(
        el("output", {
          text:
            p.label +
            " · " +
            ["width", "height", "depth"][pending.axis] +
            " " +
            (pending.percent > 0 ? "+" : "") +
            pending.percent +
            "%",
        }),
      );
  }
  return { render: renderProperties };
}
