// The person and the inbox route the art crash test and its host child share.
import type { RecipientRoute } from "@irudd/workshop/wire";

export const person = { kind: "human", id: "tester", name: "Tester" } as const;

/** An inbox route: the host never pushes, so no conversation host is called. */
export const inbox: RecipientRoute = {
  transport: "inbox",
  host: "claude-code",
  environment: "local",
};
