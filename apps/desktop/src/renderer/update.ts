import type { DesktopApi, UpdateAction, UpdateStatus } from "../shared/api.js";
import { button, byId, el } from "./dom.js";

export function mountUpdates(api: DesktopApi): void {
  const root = byId("update", HTMLElement);
  let busy = false;

  const act = (action: UpdateAction, confirmText?: string) => async () => {
    if (busy || (confirmText !== undefined && !window.confirm(confirmText))) return;
    busy = true;
    try {
      render(await api.update(action));
    } catch (error) {
      root.title = error instanceof Error ? error.message : String(error);
    } finally {
      busy = false;
    }
  };

  function render(status: UpdateStatus): void {
    root.dataset["phase"] = status.phase;
    root.replaceChildren();
    root.hidden = false;
    const message = el("span", { className: "update-message", text: status.message });
    if (status.output) message.title = status.output;
    root.append(message);
    switch (status.phase) {
      case "checking":
      case "building":
        root.append(button("Cancel", act("cancel"), "Stop the build; this version stays in use"));
        break;
      case "ready":
        root.append(
          button(
            "Restart to update",
            act("restart"),
            "Close and reopen on the new version; the project stays open",
          ),
        );
        break;
      case "error":
        root.append(button("Retry", act("check"), "Fetch and build the latest version again"));
        break;
      case "idle":
        root.append(button("Check for updates", act("check")));
        break;
      case "unmanaged":
        message.title =
          "This copy was not installed by install.ps1, so it does not update itself. Pull and rebuild the checkout, or install the app to get updates.";
        break;
    }
    if (status.previous && status.phase !== "building" && status.phase !== "checking")
      root.append(
        button(
          "Previous version",
          act("rollback", "Reopen the app on the previous version? The project stays open."),
          `Return to ${status.previous.slice(0, 12)}`,
        ),
      );
  }

  api.onUpdate(render);
  void api.update("status").then(render);
}
