import { Schema } from "effect";
import { DocumentId, GeneratorId, JsonValue, Label, ProposalId } from "./schema.js";
import { Operations } from "./ops.js";

export const commandFormat = "irudd.command";
export const commandVersion = 1;

export const RequestId = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/, {
    message: "Use a request ID of 8 to 128 characters, such as a UUID.",
  }),
).pipe(Schema.brand("RequestId"));
export type RequestId = typeof RequestId.Type;

export const Actor = Schema.Struct({
  kind: Schema.Literals(["human", "agent"]),
  id: Schema.String.check(
    Schema.isPattern(/^[a-z0-9][a-z0-9._-]{0,63}$/, { message: "Use a short lowercase actor ID." }),
  ),
  name: Schema.optionalKey(Label),
});
export type Actor = typeof Actor.Type;

const Revision = Schema.Int.check(
  Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
);
const Summary = Schema.String.check(Schema.isMaxLength(500));

export const ProposalContent = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("ops"), ops: Operations }),
  Schema.Struct({ kind: Schema.Literal("replace"), document: JsonValue }),
]);
export type ProposalContent = typeof ProposalContent.Type;

const command = <Tag extends string, F extends Schema.Struct.Fields>(type: Tag, fields: F) =>
  Schema.Struct({ type: Schema.Literal(type), ...fields });

export const Command = Schema.Union([
  command("document.create", { document: JsonValue }),
  command("document.generate", {
    label: Label,
    generator: GeneratorId,
    version: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1000 })),
    params: JsonValue,
  }),
  command("edit", { ops: Operations, summary: Schema.optionalKey(Summary) }),
  command("document.upgrade", {}),
  command("undo", { target: Revision }),
  command("restore", { revision: Revision }),
  command("proposal.create", { proposal: ProposalId, summary: Summary, content: ProposalContent }),
  command("proposal.refine", {
    proposal: ProposalId,
    version: Revision,
    summary: Summary,
    content: Schema.Union([
      ProposalContent,
      Schema.Struct({
        kind: Schema.Literal("draft-ops"),
        ops: Schema.Union([Operations, Schema.Tuple([])]),
      }),
    ]),
  }),
  command("proposal.discard", { proposal: ProposalId }),
  command("proposal.accept", { proposal: ProposalId, version: Revision }),
  command("policy.set", { agentDirectEdit: Schema.Boolean }),
]);
export type Command = typeof Command.Type;

export const CommandEnvelope = Schema.Struct({
  format: Schema.Literal(commandFormat),
  version: Schema.Literal(commandVersion),
  requestId: RequestId,
  documentId: DocumentId,
  actor: Actor,
  expectedRevision: Revision,
  command: Command,
});
export type CommandEnvelope = typeof CommandEnvelope.Type;
export type CommandEnvelopeInput = typeof CommandEnvelope.Encoded;
