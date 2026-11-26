import type { RecipientRoute } from "@irudd/workshop/wire";

export const person = { kind: "human", id: "tester", name: "Tester" } as const;

export const inbox: RecipientRoute = {
  transport: "inbox",
  host: "claude-code",
  environment: "local",
};
