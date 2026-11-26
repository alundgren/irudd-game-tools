import { Schema } from "effect";

export const AgentId = Schema.String.check(
  Schema.isPattern(/^[a-z0-9][a-z0-9._-]{0,63}$/, {
    message: "Use a short lowercase agent ID such as claude or codex.",
  }),
);
export type AgentId = typeof AgentId.Type;

export const PairingId = Schema.String.check(
  Schema.isPattern(/^pair-[0-9a-f]{16}$/, { message: "Use a pairing ID from pair.list." }),
);
export type PairingId = typeof PairingId.Type;

export const SteeringMessageId = Schema.String.check(
  Schema.isPattern(/^stm-[0-9a-z]{26}$/, { message: "Use a steering message ID like stm-…" }),
);
export type SteeringMessageId = typeof SteeringMessageId.Type;
