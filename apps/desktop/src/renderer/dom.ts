// Small DOM helpers. Every string is set as text, never parsed as HTML.

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: {
    readonly className?: string;
    readonly text?: string;
    readonly title?: string;
  } = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.className) node.className = props.className;
  if (props.text !== undefined) node.textContent = props.text;
  if (props.title) node.title = props.title;
  for (const child of children) if (child) node.append(child);
  return node;
}

export function byId<T extends HTMLElement>(id: string, type: { new (): T }): T {
  const node = document.getElementById(id);
  if (!(node instanceof type)) throw new Error(`#${id} is missing.`);
  return node;
}

export function button(text: string, onClick: () => void, title?: string): HTMLButtonElement {
  const b = el("button", { text, ...(title ? { title } : {}) });
  b.type = "button";
  b.onclick = onClick;
  return b;
}

export function numberInput(value: number, onCommit: (value: number) => void): HTMLInputElement {
  const input = el("input");
  input.type = "number";
  input.step = "0.01";
  input.value = String(Number(value.toFixed(4)));
  input.onchange = () => {
    const next = Number(input.value);
    if (Number.isFinite(next)) onCommit(next);
  };
  return input;
}
