// Steering: tell one paired agent what to do next, in the conversation it is
// already in.
//
// The panel shows who receives a message before it is sent: the agent, its
// current pairing and the exact conversation its route reaches, with the
// host's last word on whether that route is up. Each sent message then shows
// three separate facts as they become true: the host accepted it for that
// conversation, the agent acknowledged it with its pairing, and the agent
// linked the revision it applied. Waiting states (queued for an offline
// route, inbox only, delivery unknown, refused) are shown as such; nothing
// here starts a conversation or picks another one.
//
// With no paired agent the panel only says how to pair one; the editor and
// project flows do not depend on it.

import type {
  RecipientRoute,
  RecipientView,
  SteeringMessage,
  SteeringStatus,
} from "@irudd/workshop/wire";
import type { SteerNotice } from "../shared/api.js";
import type { Workshop } from "./bridge.js";
import { button, el } from "./dom.js";

export interface SteeringOptions {
  readonly host: Workshop;
  /** The document on screen, which a message refers to unless the person unticks it. */
  readonly documentId: () => string | undefined;
  readonly failure: (error: unknown) => string;
}

export interface Steering {
  /** Reload recipients and the active agent's messages. */
  refresh(): Promise<void>;
  /** A project closed or changed: forget everything shown. */
  reset(): void;
  notice(notice: SteerNotice): void;
}

/** The exact conversation a route reaches, in the host's own identifiers. */
export function describeRoute(route: RecipientRoute): string {
  switch (route.transport) {
    case "claude-channel":
      return `Claude Code session ${route.conversation ?? "(session ID not reported)"} through its MCP server ${route.server}, instance ${route.instance}`;
    case "inbox":
      return `${hostNames[route.host]} inbox${route.conversation ? ` for ${route.conversation}` : ""} on this machine; the agent reads it itself`;
  }
}

const hostNames = { agent: "Agent", "claude-code": "Claude Code", codex: "Codex" } as const;

const statusText: Record<SteeringStatus, string> = {
  queued: "Queued",
  dispatching: "Handing to the host",
  "host-accepted": "Host accepted",
  "inbox-only": "Waiting in the inbox",
  "delivery-unknown": "Delivery unknown",
  failed: "Refused by the host",
  acknowledged: "Agent acknowledged",
  proposed: "Awaiting review",
  "proposal-discarded": "Proposal discarded",
  "proposal-superseded": "Proposal superseded",
  applied: "Applied",
  revoked: "Revoked",
  cancelled: "Cancelled",
};

function time(ms: number | null | undefined): string {
  return ms ? new Date(ms).toLocaleTimeString() : "";
}

function isStatus(value: string): value is SteeringStatus {
  return Object.hasOwn(statusText, value);
}

/** Field rows of the bind form, per transport. */
type Transport = RecipientRoute["transport"];

export function mountSteering(root: HTMLElement, options: SteeringOptions): Steering {
  const { host, failure } = options;
  let recipients: RecipientView[] = [];
  let active: string | undefined;
  const messages = new Map<string, SteeringMessage>();
  let note = "";
  let binding = false;
  let generation = 0;
  /** Draft text survives re-renders. */
  let draft = "";

  function current(): RecipientView | undefined {
    return recipients.find((r) => r.agent === active);
  }

  async function loadMessages(): Promise<void> {
    messages.clear();
    if (!active) return;
    const list = await host.call("steer.list", { agent: active, limit: 50 });
    for (const m of list.messages) messages.set(m.messageId, m);
  }

  async function refresh(): Promise<void> {
    const ticket = ++generation;
    try {
      const list = await host.call("recipient.list", {});
      if (ticket !== generation) return;
      recipients = [...list];
      if (!recipients.some((r) => r.agent === active)) active = recipients[0]?.agent;
      await loadMessages();
    } catch (error) {
      note = failure(error);
    }
    if (ticket === generation) render();
  }

  function reset(): void {
    generation++;
    recipients = [];
    active = undefined;
    messages.clear();
    note = "";
    binding = false;
    render();
  }

  async function act(what: () => Promise<unknown>, done?: string): Promise<void> {
    try {
      await what();
      note = done ?? "";
    } catch (error) {
      note = failure(error);
    }
    await refresh();
  }

  function notice(event: SteerNotice): void {
    if (event.status === "revoked") {
      void refresh();
      return;
    }
    if (event.agent !== active) return;
    const ticket = generation;
    void host
      .call("steer.get", { messageId: event.messageId })
      .then((message) => {
        if (ticket !== generation || message.agent !== active) return;
        messages.set(message.messageId, message);
        renderMessages();
      })
      .catch((error: unknown) => {
        note = failure(error);
        render();
      });
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  const list = el("ol", { className: "steer-messages" });

  function render(): void {
    root.replaceChildren();
    if (!recipients.length) {
      root.append(
        el("p", {
          className: "muted",
          text: "Pair an agent under Agents to steer it. Editing works the same without one.",
        }),
      );
      if (note) root.append(el("p", { className: "muted", text: note }));
      return;
    }
    const picker = el("select");
    picker.setAttribute("aria-label", "Agent to steer");
    for (const r of recipients)
      picker.append(new Option(r.name ? `${r.name} (${r.agent})` : r.agent, r.agent));
    picker.value = active ?? "";
    picker.onchange = () => {
      active = picker.value;
      binding = false;
      void loadMessages().then(render);
    };
    const r = current();
    root.append(el("div", { className: "props" }, el("label", { text: "Agent" }), picker));
    if (r) root.append(identity(r));
    if (r && (binding || !r.recipient)) root.append(bindForm(r));
    if (r) root.append(composer(r));
    if (note) root.append(el("p", { className: "muted steer-note", text: note }));
    root.append(list);
    renderMessages();
  }

  /** Who exactly receives a message: agent, pairing, conversation and route state. */
  function identity(r: RecipientView): HTMLElement {
    const a = r.availability;
    const box = el("div", { className: "steer-identity" });
    box.dataset["state"] = a.state;
    box.append(
      el(
        "p",
        {},
        el("strong", { text: r.name ?? r.agent }),
        ` · agent ${r.agent} · pairing ${r.pairingId}, paired ${new Date(r.pairedAt).toLocaleString()}`,
      ),
    );
    if (r.recipient) {
      box.append(
        el("p", { className: "steer-route", text: `Steers ${describeRoute(r.recipient.route)}` }),
        el("p", {
          className: "muted",
          text: r.recipient.documents.length
            ? `Documents: ${r.recipient.documents.join(", ")}`
            : "Whole project",
        }),
      );
    }
    const conversation = a.conversation;
    const facts = conversation
      ? [
          conversation.status,
          conversation.busy ? "busy, takes it as its next turn" : undefined,
          conversation.provider,
          conversation.model,
          conversation.project,
        ].filter(Boolean)
      : [];
    box.append(
      el(
        "p",
        { className: "steer-availability" },
        el("span", { className: `badge state-${a.state}`, text: a.state }),
        ` ${a.summary}${a.push || a.state === "inbox-only" ? "" : " No push: the agent must read its inbox."}`,
        facts.length ? ` (${facts.join(", ")})` : "",
        a.checkedAt ? ` · checked ${time(a.checkedAt)}` : "",
      ),
    );
    const actions = el("div", { className: "row-actions" });
    if (r.recipient) {
      actions.append(
        button(
          "Check route",
          () => void act(() => host.call("recipient.check", { agent: r.agent })),
        ),
        button("Change conversation", () => {
          binding = !binding;
          render();
        }),
        button(
          "Unbind",
          () =>
            void act(
              () => host.call("recipient.unbind", { agent: r.agent }),
              `Unbound ${r.agent}. Its messages wait until it is bound again.`,
            ),
        ),
      );
    }
    box.append(actions);
    return box;
  }

  function field(label: string, input: HTMLElement): HTMLElement {
    return el("label", { className: "steer-field" }, el("span", { text: label }), input);
  }

  function text(placeholder: string, value = ""): HTMLInputElement {
    const input = el("input");
    input.placeholder = placeholder;
    input.value = value;
    input.spellcheck = false;
    return input;
  }

  /** Bind the agent's current pairing to one exact conversation. */
  function bindForm(r: RecipientView): HTMLElement {
    const form = el("div", { className: "steer-bind" });
    const transport = el("select");
    transport.setAttribute("aria-label", "How to reach the conversation");
    const choices: [Transport, string][] = [
      ["claude-channel", "Claude Code session (channel)"],
      ["inbox", "Inbox only (no push)"],
    ];
    for (const [value, label] of choices) transport.append(new Option(label, value));
    const previous = r.recipient?.route;
    transport.value = previous?.transport ?? (r.channels.length ? "claude-channel" : "inbox");
    const fields = el("div");
    const conversation = text("conversation ID exactly as the host shows it");
    const channel = el("select");
    channel.setAttribute("aria-label", "Connected Claude Code session");
    const inboxHost = el("select");
    inboxHost.setAttribute("aria-label", "Host");
    for (const [value, label] of Object.entries(hostNames))
      inboxHost.append(new Option(label, value));
    if (previous) {
      if (previous.conversation) conversation.value = previous.conversation;
      if (previous.transport === "inbox") inboxHost.value = previous.host;
    }

    function show(): void {
      fields.replaceChildren();
      switch (transport.value) {
        case "claude-channel":
          channel.replaceChildren(
            ...r.channels.map(
              (c) =>
                new Option(
                  `${c.server ?? "irudd"} · ${c.instance}${c.client ? ` · ${c.client.name} ${c.client.version}` : ""} · since ${time(c.since)}`,
                  c.instance,
                ),
            ),
          );
          fields.append(
            r.channels.length
              ? field("Session", channel)
              : el("p", {
                  className: "muted",
                  text: "No Claude Code session of this agent is connected with a channel. Start it with the irudd MCP server in --channels, then check again.",
                }),
            field("Session ID", conversation),
          );
          break;
        default:
          fields.append(field("Host", inboxHost), field("Conversation", conversation));
      }
    }
    transport.onchange = show;
    show();

    function route(): RecipientRoute | string {
      const id = conversation.value.trim();
      switch (transport.value) {
        case "claude-channel": {
          const live = r.channels.find((c) => c.instance === channel.value);
          if (!live) return "Choose a connected Claude Code session.";
          return {
            transport: "claude-channel",
            host: "claude-code",
            environment: "local",
            server: live.server ?? "irudd",
            instance: live.instance,
            ...(id ? { conversation: id } : {}),
          };
        }
        default: {
          const h = inboxHost.value;
          const which = h === "claude-code" ? "claude-code" : h === "codex" ? "codex" : "agent";
          return {
            transport: "inbox",
            host: which,
            environment: "local",
            ...(id ? { conversation: id } : {}),
          };
        }
      }
    }

    form.append(
      field("Reach it by", transport),
      fields,
      el(
        "div",
        { className: "row-actions" },
        button("Bind", () => {
          const chosen = route();
          if (typeof chosen === "string") {
            note = chosen;
            render();
            return;
          }
          binding = false;
          void act(
            async () => {
              await host.call("recipient.bind", { agent: r.agent, route: chosen });
              await host.call("recipient.check", { agent: r.agent });
            },
            `Bound ${r.agent} to ${describeRoute(chosen)}.`,
          );
        }),
        r.recipient
          ? button("Keep the current conversation", () => {
              binding = false;
              render();
            })
          : null,
      ),
    );
    return form;
  }

  function composer(r: RecipientView): HTMLElement {
    const area = el("textarea");
    area.rows = 3;
    area.maxLength = 8000;
    area.value = draft;
    area.placeholder = r.recipient
      ? `Tell ${r.name ?? r.agent} what to do next`
      : "Bind a conversation first; messages wait until then";
    area.setAttribute("aria-label", "Steering message");
    area.oninput = () => {
      draft = area.value;
    };
    const about = el("input");
    about.type = "checkbox";
    const documentId = options.documentId();
    about.checked = documentId !== undefined;
    about.disabled = documentId === undefined;
    const send = button(`Send to ${r.name ?? r.agent}`, () => {
      const message = area.value.trim();
      if (!message) return;
      const doc = about.checked ? options.documentId() : undefined;
      send.disabled = true;
      void act(async () => {
        await host.call("steer.send", {
          agent: r.agent,
          requestId: `steer-${crypto.randomUUID()}`,
          text: message,
          ...(doc ? { documentId: doc } : {}),
        });
        draft = "";
      });
    });
    send.disabled = !r.recipient || r.availability.state === "offline";
    return el(
      "div",
      { className: "steer-compose" },
      area,
      el(
        "div",
        { className: "row-actions" },
        el("label", {}, about, " About this character"),
        send,
      ),
    );
  }

  function step(label: string, on: boolean, detail?: string): HTMLElement {
    const s = el("span", { className: on ? "step on" : "step", text: label });
    if (detail) s.title = detail;
    return s;
  }

  /**
   * The last fact: a revision that changed the character, or where the
   * person's review of the agent's proposal stands. A proposal is never shown
   * as applied before the person accepts that exact version.
   */
  function outcome(m: SteeringMessage): HTMLElement {
    const applied = m.applied;
    if (applied) {
      const by = applied.acceptedBy
        ? ` by ${applied.acceptedBy.name ?? applied.acceptedBy.id}`
        : "";
      return applied.via === "proposal-accepted"
        ? step(
            `Accepted in revision ${applied.revision}`,
            true,
            `proposal ${applied.proposal?.id ?? "?"} v${applied.proposal?.version ?? "?"} accepted${by} · ${applied.requestId}`,
          )
        : step(
            `Applied in revision ${applied.revision}`,
            true,
            `${applied.documentId} · ${applied.requestId}`,
          );
    }
    const review = m.review;
    if (review) {
      const which = `proposal ${review.proposalId} v${review.version}`;
      const decided = review.decidedBy
        ? ` by ${review.decidedBy.name ?? review.decidedBy.id} at ${time(review.decidedAt)}`
        : "";
      switch (review.state) {
        case "pending":
          return waitingStep(
            `Awaiting review (${which})`,
            "The person has not accepted or discarded it yet.",
          );
        case "discarded":
          return waitingStep(`Discarded (${which})`, `Discarded${decided}`);
        case "superseded":
          return waitingStep(
            `Superseded by v${review.latestVersion} (${which})`,
            "The linked version was refined or another version was accepted.",
          );
        case "accepted":
          return step(
            `Accepted in revision ${review.acceptedRevision ?? "?"}`,
            true,
            `${which} accepted${decided}`,
          );
      }
    }
    return step("Applied", false);
  }

  function waitingStep(label: string, detail: string): HTMLElement {
    const s = step(label, false, detail);
    s.classList.add("review");
    return s;
  }

  function renderMessages(): void {
    const sorted = [...messages.values()].sort((a, b) => b.seq - a.seq);
    list.replaceChildren(
      ...sorted.map((m) => {
        const status = isStatus(m.status) ? m.status : "queued";
        const receipt = m.delivery.receipt;
        const inbox = m.route.transport === "inbox" || m.delivery.state === "inbox-only";
        const accepted = receipt !== null || m.delivery.state === "accepted";
        const track = el(
          "div",
          { className: "steer-track" },
          inbox
            ? step("In inbox (no push)", true, "The agent reads its inbox in the paired session.")
            : step(
                "Host accepted",
                accepted,
                receipt
                  ? `${receipt.via ?? receipt.transport}${receipt.delivery ? ` ${receipt.delivery}` : ""}${receipt.hostMessageId ? ` · ${receipt.hostMessageId}` : ""} at ${time(receipt.at)}`
                  : undefined,
              ),
          step(
            "Agent acknowledged",
            m.acknowledged !== null,
            m.acknowledged
              ? `${m.acknowledged.agent} with ${m.acknowledged.pairingId} at ${time(m.acknowledged.at)}`
              : undefined,
          ),
          outcome(m),
        );
        const waiting: string[] = [];
        if (status === "queued")
          waiting.push(
            m.delivery.nextAttemptAt
              ? `Route offline; trying again at ${time(m.delivery.nextAttemptAt)}`
              : "Waiting for its turn or its route",
          );
        if (status === "delivery-unknown")
          waiting.push(
            "The host may already have it. Retry only if the conversation does not show it.",
          );
        if (m.delivery.detail) waiting.push(m.delivery.detail);
        if (m.closed) waiting.push(m.closed.detail);
        const actions = el("div", { className: "row-actions" });
        const open = !m.acknowledged && !m.closed && !m.applied;
        if (open)
          actions.append(
            button(
              "Cancel",
              () => void act(() => host.call("steer.cancel", { messageId: m.messageId })),
            ),
          );
        if (
          open &&
          (m.delivery.state === "unknown" ||
            m.delivery.state === "failed" ||
            (m.delivery.state === "pending" && m.delivery.attempts > 0))
        )
          actions.append(
            button(
              "Retry",
              () => void act(() => host.call("steer.retry", { messageId: m.messageId })),
            ),
          );
        const item = el(
          "li",
          {},
          el(
            "p",
            { className: "steer-head" },
            el("span", { className: `badge status-${status}`, text: statusText[status] }),
            ` ${time(m.createdAt)}${m.documentId ? ` · ${m.documentId}` : ""} · ${m.messageId}`,
          ),
          el("p", { className: "steer-text", text: m.text }),
          el("p", { className: "muted", text: `To ${describeRoute(m.route)}` }),
          track,
          waiting.length ? el("p", { className: "muted", text: waiting.join(" ") }) : null,
          actions.childElementCount ? actions : null,
        );
        item.dataset["status"] = status;
        item.dataset["message"] = m.messageId;
        return item;
      }),
    );
  }

  render();
  return { refresh, reset, notice };
}
