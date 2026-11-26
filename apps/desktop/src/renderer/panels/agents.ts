import { failure } from "./context.js";
import { byId, button, el } from "../dom.js";
import type { PanelContext } from "./context.js";

export function mountAgents(ctx: PanelContext, refreshRecipients: () => Promise<unknown>) {
  const { host } = ctx;
  const agents = byId("agents", HTMLDivElement);
  let pairingNote = "";

  async function renderAgents(): Promise<void> {
    agents.replaceChildren();
    if (!ctx.project) return;
    try {
      const paired = await host.call("pair.list", {});
      const id = el("input");
      id.placeholder = "agent id, e.g. claude";
      id.setAttribute("aria-label", "Agent ID");
      const result = el("p", { className: "muted", text: pairingNote });
      const manual = el("details", {}, el("summary", { text: "Pair another agent by hand" }));
      manual.open = pairingNote !== "";
      agents.append(
        paired.length
          ? el(
              "ul",
              { className: "entries" },
              ...paired.map((p) =>
                el(
                  "li",
                  {},
                  el("span", { text: p.name ?? p.agent }),
                  button(
                    "Disconnect",
                    () => {
                      void host
                        .call("pair.revoke", { agent: p.agent })
                        .then(renderAgents)
                        .then(refreshRecipients);
                    },
                    "Stops this agent and keeps it from reconnecting on its own until you pair it again.",
                  ),
                ),
              ),
            )
          : el("p", {
              className: "muted",
              text: "Claude Code and Codex on this computer connect on their own. Ask one to look at the workshop and it shows up here.",
            }),
        manual,
      );
      manual.append(
        el(
          "div",
          { className: "props" },
          id,
          button("Pair", () => {
            void host
              .call("pair.agent", { agent: id.value.trim() })
              .then((pair) => {
                pairingNote = `Paired ${pair.agent}. Its MCP server reads ${pair.credentialFile}.`;
                void renderAgents();
                void refreshRecipients();
              })
              .catch((error: unknown) => {
                pairingNote = failure(error);
                result.textContent = pairingNote;
              });
          }),
        ),
        result,
      );
    } catch (error) {
      agents.append(el("p", { className: "muted", text: failure(error) }));
    }
  }
  return { render: renderAgents };
}
