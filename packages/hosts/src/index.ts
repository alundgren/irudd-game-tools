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

export function defaultTransports(
  options: DefaultTransportOptions = {},
): ReadonlyArray<SteeringTransport> {
  return [t3ThreadTransport(options.t3), codexQueueTransport(options.codex)];
}
