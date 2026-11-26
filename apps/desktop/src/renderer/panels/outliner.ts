import type { Part } from "@irudd/document";
import { byId, el } from "../dom.js";
import type { PanelContext } from "./context.js";

export function mountOutliner(ctx: PanelContext) {
  const outliner = byId("outliner", HTMLUListElement);

  function renderOutliner(): void {
    outliner.replaceChildren();
    const { doc, selection: selected, selectPart, rename } = ctx;
    if (!doc) return;
    const children = new Map<string | null, Part[]>();
    for (const p of doc.parts) {
      const list = children.get(p.parent) ?? [];
      list.push(p);
      children.set(p.parent, list);
    }
    const branch = (parent: string | null): HTMLLIElement[] =>
      (children.get(parent) ?? []).map((p) => {
        const name = el("span", { text: p.label });
        const row = el(
          "div",
          { className: p.id === selected ? "row selected" : "row" },
          name,
          el("span", { className: "shape", text: p.shape }),
        );
        row.setAttribute("role", "treeitem");
        row.dataset["part"] = p.id;
        row.onclick = () => selectPart(p.id);
        row.ondblclick = () => {
          const input = el("input");
          input.value = p.label;
          input.setAttribute("aria-label", "Part name");
          let done = false;
          const finish = (save: boolean): void => {
            if (done) return;
            done = true;
            if (save) void rename(p.id, input.value);
            else renderOutliner();
          };
          input.onkeydown = (e) => {
            if (e.key === "Enter") finish(true);
            if (e.key === "Escape") finish(false);
            e.stopPropagation();
          };
          input.onblur = () => finish(true);
          name.replaceWith(input);
          input.select();
          input.focus();
        };
        const kids = branch(p.id);
        return el("li", {}, row, kids.length ? el("ul", {}, ...kids) : null);
      });
    outliner.append(...branch(null));
  }

  function select(part: string | null): void {
    for (const row of outliner.querySelectorAll<HTMLElement>(".row"))
      row.classList.toggle("selected", row.dataset["part"] === part);
  }
  return { render: renderOutliner, select };
}
