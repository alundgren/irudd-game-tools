import { Player, mountControls } from "@irudd/player";
import "@irudd/player/player.css";
import "./style.css";

function element(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}.`);
  return node;
}

const stage = element("stage");
const file = element("file");
const player = new Player(stage);
const controls = mountControls(element("controls"), player);

async function open(selected: File | undefined): Promise<void> {
  if (!selected) return;
  await controls.load(new Uint8Array(await selected.arrayBuffer()), selected.name);
}

if (file instanceof HTMLInputElement)
  file.onchange = () => {
    void open(file.files?.[0]);
  };
stage.addEventListener("dragover", (event) => {
  event.preventDefault();
});
stage.addEventListener("drop", (event) => {
  event.preventDefault();
  void open(event.dataTransfer?.files[0]);
});
