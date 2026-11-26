// Command envelopes, format "irudd.command" version 1.
//
// Every write names the document, the revision it was prepared against, the
// actor and a stable request ID. Command and document formats are versioned
// independently of storage and of glTF exports.

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
  /** A whole replacement document. It is validated and stored as an explicit diff. */
  Schema.Struct({ kind: Schema.Literal("replace"), document: JsonValue }),
]);
export type ProposalContent = typeof ProposalContent.Type;

const command = <Tag extends string, F extends Schema.Struct.Fields>(type: Tag, fields: F) =>
  Schema.Struct({ type: Schema.Literal(type), ...fields });

export const Command = Schema.Union([
  /** Initialise from a complete document (manual creation or an imported bundle). */
  command("document.create", { document: JsonValue }),
  /** Initialise from a registered generator. */
  command("document.generate", {
    label: Label,
    generator: GeneratorId,
    version: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1000 })),
    params: JsonValue,
  }),
  /** A direct edit: one gesture or one agent change, committed as one revision. */
  command("edit", { ops: Operations, summary: Schema.optionalKey(Summary) }),
  /**
   * Append a revision holding the head after this build's feature upgrades.
   * Needed once after opening a journal written with older feature versions.
   */
  command("document.upgrade", {}),
  /** Append a revision that reverses one earlier revision, keeping later edits. */
  command("undo", { target: Revision }),
  /** Append a revision whose document equals an earlier revision's. */
  command("restore", { revision: Revision }),
  command("proposal.create", { proposal: ProposalId, summary: Summary, content: ProposalContent }),
  command("proposal.refine", {
    proposal: ProposalId,
    version: Revision,
    summary: Summary,
    content: ProposalContent,
  }),
  command("proposal.discard", { proposal: ProposalId }),
  command("proposal.accept", { proposal: ProposalId, version: Revision }),
  /** Per-document permission for agents to edit without a proposal. Humans only. */
  command("policy.set", { agentDirectEdit: Schema.Boolean }),
]);
export type Command = typeof Command.Type;

export const CommandEnvelope = Schema.Struct({
  format: Schema.Literal(commandFormat),
  version: Schema.Literal(commandVersion),
  requestId: RequestId,
  documentId: DocumentId,
  actor: Actor,
  /**
   * The head revision the command was prepared against. Document writes and
   * proposal acceptance require it to equal the head; proposal creation and
   * refinement name their base revision, which may be older.
   */
  expectedRevision: Revision,
  command: Command,
});
export type CommandEnvelope = typeof CommandEnvelope.Type;
/** The JSON shape a client sends. */
export type CommandEnvelopeInput = typeof CommandEnvelope.Encoded;
