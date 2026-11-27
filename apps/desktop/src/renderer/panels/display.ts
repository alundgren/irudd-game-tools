import { byId } from "../dom.js";
import { displayModes, type EditorViewport } from "../viewport.js";

export function mountDisplay(viewport: EditorViewport): void {
  const shading = byId("display-mode", HTMLSelectElement);
  shading.onchange = () => {
    const mode = displayModes.find((value) => value === shading.value);
    if (mode) viewport.setDisplay(mode);
  };
  for (const angle of ["front", "portrait", "side", "back", "threequarter"] as const)
    byId("camera-" + angle, HTMLButtonElement).onclick = () => viewport.setAngle(angle);
  byId("focus-selection", HTMLButtonElement).onclick = () => viewport.focusSelection();
}
