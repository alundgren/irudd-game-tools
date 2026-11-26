# Steering a paired agent

A person steers an agent that is already working. The project host routes
the instruction to the paired conversation. The provider determines how much
of the conversation history is available to the responding agent. The host
never starts a conversation or a model session, never
picks another conversation when a route is down, and never falls back to
another provider. Every message also waits in the agent's inbox, so the paired
agent can always read it in its own session.

## The four separate facts

| Fact | Who establishes it | Recorded as |
| --- | --- | --- |
| Pairing | The person: `irudd pair <agent>` | credential file, `pairingId` |
| Recipient | The person binds the pairing to one conversation | `recipient.bind` route |
| Host accepted | The conversation's host took the message | `host-accepted` and the host's receipt |
| Acknowledged | The agent, on a connection authenticated with that pairing | `acknowledged {agent, pairingId}` |
| Reported | The agent links a request it committed after the message | `report`, plus `review` for a proposal |
| Applied | A revision changed the character for the message | `applied {revision, via}` |

`applied` is set only when the agent's own request appended a revision
(`via: "direct"`) or when the person accepts exactly the linked proposal version
(`via: "proposal-accepted"`, at the accepting revision). A linked proposal is
`proposed` until then, and may end `proposal-discarded` or `proposal-superseded`
(refined, or a different version accepted). The agent may link a later request
of its own, such as its refinement. Each message stores every document's journal
position at send, so a request committed before the person sent it is refused.

## Routes

| Route | Host | Mechanism | Push into the open conversation |
| --- | --- | --- | --- |
| `t3-thread` | T3 Code | `t3 thread send <thread> -` (message on stdin) | Yes: a busy thread gets it as its next turn, an idle one starts a turn |
| `t3-thread --mid-turn` | T3 Code | `t3_thread_send` over T3's MCP endpoint, with irudd's own grant | Yes: into the running turn where the provider supports steering; otherwise as above |
| `claude-channel` | Claude Code | the agent's own `irudd mcp --channel` sends `notifications/claude/channel` | Yes, in a session started with `--dangerously-load-development-channels server:<name>` (or `--channels` for an approved server) |
| `codex-queue` | Codex | `codex queue --thread <uuid> --message <text>` | Queued for that saved session; pickup by an already running TUI is not verified |
| `inbox` | any | none | No: the agent reads `irudd inbox` or `read_inbox` in the same paired session |

- **T3 threads.** The adapter reads T3's own launcher (`~/.t3/bin/t3.cmd` or
  `t3`) as text and runs the app executable with T3's CLI script and fixed
  verbs: no shell, an allowlisted environment, the message on stdin. It checks
  a thread with `t3 thread show <thread> --messages 0 --json` and keeps only
  state fields. It reaches only this machine's T3 server, so a route's
  environment must be `local`. A mid-turn route is described below.
- **Claude Code.** A channel server's name is not a recipient. Each
  `irudd mcp --channel` process has a random instance ID (`chn-…`). The person
  binds that exact instance, and only while it is connected. After a restart
  the old instance is gone: the route shows `inbox-only` until the person
  binds the new one. A push counts as host-accepted when the MCP server confirms
  it wrote the notification. The agent's acknowledgement shows the session saw it.
- **Codex.** The adapter never passes `--resume`, so it only queues. It never
  starts or resumes a turn.

## Mid-turn delivery into T3

`t3 thread send` always queues: a message sent while the agent works waits
for the end of the turn, which can take many minutes. T3 Code's supported way
for an outside client to reach a running turn is its MCP endpoint, which takes
the same `t3_thread_send` tool T3's own agents use. irudd signs in there as
an ordinary MCP OAuth client:

1. **Setup, once per OS account.** The person runs `irudd t3 connect` while T3
   Code is running. irudd registers itself (RFC 7591), prints T3's approval
   page and waits on a loopback callback (PKCE S256, state, issuer check).
   The person approves in T3 and picks an access level. The grant is stored
   in `<state>/t3/mcp-grant.json`, readable only by the account. It lasts 30
   days and has no refresh token: connect again when it expires, after
   `irudd t3 disconnect`, or when T3's origin or install changes.
2. **Access level.** T3 refuses a send into a thread that runs with broader
   modes than the grant (approval-required < auto-accept-edits < auto <
   full access). Approve with at least the level of the threads you steer.
3. **Route.** `irudd route <agent> --t3-thread <id> --mid-turn`. Without a
   usable grant the route still works and queues, and `irudd recipients` says
   "needs irudd t3 connect".

With a grant, the host sends `{threadId, message, mode: "auto", clientRequestId:
<message ID>}` to exactly the routed thread. In `auto`, T3 steers the active
run when its provider supports it, queues while a run is still starting, and
interrupts and restarts the run only for providers that can only be steered
that way. The receipt records what happened:

| `receipt.turn` | T3 delivery | Meaning |
| --- | --- | --- |
| `mid-turn` | `steered` | Added to the running turn |
| `next-turn` | `queued` | Waits for the current turn to end |
| `new-turn` | `started` | The thread was idle; it started a turn |
| `restarted` | `restarted` | T3 interrupted the run and restarted it with the message |

`receipt.via` names the path: `t3-mcp`, `t3-cli`, `codex-cli` or
`claude-channel`. Host-accepted is still not the agent's acknowledgement.

If T3 refuses authorization, the delivery fails and the person can reconnect.
An expired grant uses the next-turn queue. An unavailable server is retried when
the call has not yet been sent. A lost answer is
`delivery-unknown`. Because T3 deduplicates on `clientRequestId`, resending
that message is safe on this path. An answer naming another thread is treated
as unknown, never as delivered.

## Commands

As the person:

```
irudd route claude --t3-thread <thread-id> [--t3-project <id>] [--doc <doc>] [--mid-turn]
irudd t3 connect | irudd t3 status | irudd t3 disconnect
irudd route claude --claude-channel <chn-instance> [--server irudd]
irudd route codex --codex-session <uuid>
irudd route codex --inbox codex [--conversation <id>]
irudd recipients [agent]        # route, live check, connected channel instances
irudd send claude "<text>" [--doc <doc>] [--request-id <id>]
irudd outbox | irudd message <id> | irudd cancel <id> | irudd resend <id>
```

As the agent, with its own credential:

```
irudd inbox --credential <file>
irudd ack <message-id> --credential <file>
irudd changes <doc> --since <n> --by human --credential <file>
irudd propose <doc> <prop-id> --base head --summary "…" --op '<json>' --credential <file>
irudd applied <message-id> --doc <doc> --request-id <id> --credential <file>
```

Over MCP the same steps are `read_inbox`, `ack_steering`, `read_changes`,
`propose_change` and `report_applied`.

## Durability and identity

- **Outbox location.** The outbox is `steering.sqlite` in the host's state directory for the project
  and OS account. It is never in the project directory, so a copy or backup of a
  project never carries routes. The file records the project ID. A different
  project at the same path gets a fresh outbox, and the old file is set aside.
- **Stable IDs.** A message ID is a hash of project, agent and request ID, so a retried send
  is the same message, and different text under the same request ID is refused.
- **Retries.** Offline routes retry with backoff. A crash or timeout during a send leaves
  `delivery-unknown`, and the host never resends automatically. T3's CLI has no
  client request ID, so the person checks the conversation before `resend`. On
  the mid-turn path the message ID is T3's `clientRequestId`, so `resend` is safe.
- **Route and pairing changes.** Re-pairing, unpairing or rebinding revokes or fails open messages. They
  are never retargeted to another conversation.
- **Cursor.** Acknowledging a message moves the agent's manual-change cursor to the head
  the message was about. The next message's `--since` starts there.

## Evidence

Measured 2026-11-25/26 on the Windows 11 gaming PC, Node 26.13.1, T3 Code
v0.1.12, Claude Code 2.1.332, codex-cli 0.172.0.

- `pnpm --filter @irudd/workshop test`: 26 pass, including 8 steering tests.
  They use a clearly labelled fake T3 transport and prove the host's state
  machine, not delivery.
- `pnpm --filter @irudd/hosts test`: 11 pass in about 1 s. Stand-in CLIs record
  the exact argv, stdin and environment the adapters use. Six of them run a
  fake T3 OAuth and MCP server: connect with PKCE, mid-turn `auto` with the
  message ID as `clientRequestId`, exactly the routed thread, CLI fallback
  without a grant or with one for another server or owner, refusal on revocation,
  and revoke on disconnect. They prove what irudd sends, not live steering.
- `pnpm --filter @irudd/mcp gate:steering`: a real host, CLI processes and an
  MCP SDK client in place of Claude Code. It covers the channel push, ack,
  cursor, a proposal awaiting review then accepted, a discard, an inbox-only
  route and a host restart. About 12.7 s. Timings in ms: host start 442,
  channel visible 377, send to notification 381, restart to second push 1154.
- `IRUDD_T3_GATE_THREAD=<thread> pnpm --filter @irudd/hosts gate:t3`: a
  read-only check of one authorized thread through the real adapter. It
  reported ready, running, busy, claudeAgent/claude-opus-5-5, in 457 ms.
- The live T3 queue check (`pnpm --filter @irudd/mcp canary:t3` with
  `IRUDD_CANARY_LIVE=1`) delivered one instruction to the paired thread.
  The agent acknowledged it and read the person's revision-2 jaw edit.
  An earlier message in the same thread contained the brow choice. The
  agent reported that it could not recover that choice and left the project
  at revision 2. The project contained zero proposals. The context-dependent
  edit check failed. This run exercised next-turn delivery.

## Proving a host independently

A fake adapter proves only what irudd sends. To prove delivery into a live
conversation, the check must be made by someone other than the sender:

1. The coordinator names one authorized conversation and a control
   conversation, and never gives the sender the expected answer.
2. The sender runs the canary in a temporary project, pairs only the authorized
   agent, and sends one tagged message whose instruction depends on that
   conversation's earlier context.
3. The receiving agent acts with its own credential. Only its authenticated
   acknowledgement and linked request move the message past host-accepted.
4. The coordinator checks the result independently: the conversation's
   transcript, the project's journal and proposals, and zero product messages
   in the control conversation. The canary's evidence file keeps the send
   result, host receipt and agent steps apart for comparison.

For Claude Code, the same check needs a session started with the development
channel flag and the person binding that session's channel instance. For Codex,
it needs a TUI attached to the same app server, to show live pickup of a queued
message.

## Gaps

- **Live mid-turn steering is not proven yet.** It needs the person's
  `irudd t3 connect` approval and a fresh, authorized recipient thread.
- **Not idempotent through the CLI.** `t3 thread send` takes no client request
  ID. A crash during the call becomes `delivery-unknown` and is never resent
  blindly.
- **No refresh token.** The T3 grant ends after 30 days and the person connects
  again.
- **Linked T3 environments.** irudd reaches only the local server, so other
  environments are refused, although `t3_thread_send` takes an environment ID.
- **Claude Code sessions without the channel flag** cannot be pushed into. They
  are inbox-only: the agent reads its inbox in the same session.
- **Codex live pickup** by an already running TUI is not verified. The queue
  call and its error handling are.
- **Same-user trust.** Any process running as the OS account can read the
  credential files, as in [workshop-clients.md](workshop-clients.md).
