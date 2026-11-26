// @irudd/hosts: named steering transports for the agent hosts this machine runs.
//
// Each adapter reaches one existing conversation through that host's own,
// documented mechanism, with fixed verbs and no shell:
//
//   t3ThreadTransport    T3 Code   `t3 thread send <thread> -`  (exact thread, queued as next turn)
//   codexQueueTransport  Codex     `codex queue --thread <uuid>` (queued for that saved session)
//
// Claude Code's channel route lives in the workshop host itself, because it
// travels over the agent's own authenticated MCP connection. No adapter ever
// starts a conversation, picks another one or falls back to another provider.

import { codexQueueTransport, type CodexOptions } from "./codex.js";
import { t3ThreadTransport, type T3Options } from "./t3.js";
import type { SteeringTransport } from "./types.js";

export { codexQueueTransport, codexSessionExists, type CodexOptions } from "./codex.js";
export { findT3Launcher, t3ThreadTransport, type T3Launcher, type T3Options } from "./t3.js";
export {
  connectT3,
  disconnectT3,
  findT3Server,
  grantInfo,
  readT3Grant,
  usableGrant,
  type ConnectT3Options,
  type T3Grant,
  type T3GrantInfo,
  type T3Server,
} from "./t3-mcp.js";
export type * from "./types.js";

export interface DefaultTransportOptions {
  readonly t3?: T3Options;
  readonly codex?: CodexOptions;
}

/** The T3 and Codex adapters with their default discovery. */
export function defaultTransports(
  options: DefaultTransportOptions = {},
): ReadonlyArray<SteeringTransport> {
  return [t3ThreadTransport(options.t3), codexQueueTransport(options.codex)];
}
