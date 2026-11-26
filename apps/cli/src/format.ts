// Plain-text rendering of host replies for a person at a terminal.

import { isJsonObject, type Diagnostic } from "@irudd/document";
import type {
  ApplyResult,
  ChangesView,
  CurrentView,
  DocumentSummary,
  DraftView,
  InspectView,
  RevisionDelta,
} from "@irudd/workshop/contract";
import type { Pairing, StartersView } from "@irudd/workshop/wire";

export function diagnostics(list: ReadonlyArray<Diagnostic>): string {
  return list
    .map((d) => `  - [${d.code}] ${d.path.length > 0 ? `${d.path.join(".")}: ` : ""}${d.message}`)
    .join("\n");
}

export function applied(result: ApplyResult, documentId: string, requestId: string): string {
  switch (result.kind) {
    case "committed": {
      const r = result.receipt;
      const what = r.appended
        ? `revision ${r.revision}`
        : `${r.command} (head stays at revision ${r.revision})`;
      const proposal = r.proposal
        ? ` Proposal ${r.proposal.id} v${r.proposal.version} is ${r.proposal.status}.`
        : "";
      return `Committed ${what} of ${documentId} (request ${requestId}, journal entry ${result.entry.sequence}).${proposal}`;
    }
    case "replayed":
      return `Already applied: request ${requestId} committed ${result.receipt.command} at revision ${result.receipt.revision} earlier. Nothing new was written.`;
    case "rejected":
      return `Rejected; nothing was written (request ${requestId}):\n${diagnostics(result.diagnostics)}${hint(result.diagnostics, documentId)}`;
  }
}

function hint(list: ReadonlyArray<Diagnostic>, documentId: string): string {
  const stale = list.find((d) => d.code === "stale-revision");
  if (stale) {
    const detail = stale.detail;
    const head =
      isJsonObject(detail) && typeof detail["head"] === "number"
        ? `revision ${detail["head"]}`
        : "the current head";
    return `\nReview what changed with "irudd changes ${documentId} --since <your base>", then retry against ${head} with --base.`;
  }
  if (list.some((d) => d.code === "request-reused"))
    return "\nThat request ID was used for a different command. Leave --request-id out to get a fresh one.";
  return "";
}

export function documents(list: ReadonlyArray<DocumentSummary>): string {
  if (list.length === 0)
    return 'No documents yet. Create one with "irudd new <doc-id>" (see "irudd starters").';
  const rows = list.map((d) => [
    d.documentId,
    String(d.revision),
    d.label ?? "",
    new Date(d.updatedAt).toISOString(),
  ]);
  return table(["DOCUMENT", "REV", "LABEL", "UPDATED"], rows);
}

export function starters(view: StartersView): string {
  const lines: string[] = [];
  for (const s of view.starters) {
    const source = s.generator ? `${s.generator.id}@${s.generator.version}` : "prepared form";
    lines.push(`${s.id}  ${source}${s.reference ? "  [reference generator]" : ""}`);
    lines.push(`  ${s.description}`);
    if (s.presets.length > 0)
      lines.push(`  presets: ${s.presets.map((p) => `${p.id} (${p.label})`).join(", ")}`);
    if (s.features.length > 0) lines.push(`  features: ${s.features.join(", ")}`);
    if (s.seeded)
      lines.push("  seeded: --seed <0-4294967295> gives the same form for the same seed");
  }
  if (view.starters.length === 0) lines.push("This host registers no generators.");
  lines.push("");
  lines.push(
    `Registered families (no generator yet; start from a form starter or "irudd new <doc-id> --from <file.json>"):`,
  );
  lines.push(`  ${view.families.map((f) => `${f.id}@${f.version}`).join(", ")}`);
  return lines.join("\n");
}

export function current(view: CurrentView): string {
  const doc = view.document;
  const lines = [
    `${view.documentId}  revision ${view.revision}  ${doc ? `"${doc.label}"` : "(not created)"}`,
    `digest ${view.documentDigest ?? "-"}  access ${view.access.mode}  agents edit directly: ${view.policy.agentDirectEdit ? "on" : "off"}`,
  ];
  if (view.access.diagnostics.length > 0) lines.push(diagnostics(view.access.diagnostics));
  if (doc) {
    if (doc.generation)
      lines.push(
        `generator ${doc.generation.generator}@${doc.generation.version} params ${JSON.stringify(doc.generation.params)}`,
      );
    lines.push("");
    lines.push(
      table(
        ["PART", "LABEL", "PARENT", "SHAPE", "SIZE"],
        doc.parts.map((p) => [
          p.id,
          p.label,
          p.parent ?? "",
          p.shape,
          p.size.map((n) => n.toFixed(3)).join(" "),
        ]),
      ),
    );
  }
  return lines.join("\n");
}

function deltaLine(d: RevisionDelta | InspectView["history"][number]): string {
  const extra = [
    d.undone ? "undone" : "",
    d.undoes === undefined ? "" : `undoes ${d.undoes}`,
    d.proposal ? `from ${d.proposal.id} v${d.proposal.version}` : "",
  ]
    .filter(Boolean)
    .join(", ");
  return `  r${d.revision}  ${d.kind}  by ${d.actor.kind} ${d.actor.id}  ${d.changeCount} change(s)${d.summary ? `  "${d.summary}"` : ""}${extra ? `  (${extra})` : ""}`;
}

export function inspect(view: InspectView): string {
  const lines = [current({ ...view, document: null }).split("\n")[1] ?? "", "", "History:"];
  for (const item of view.history) lines.push(deltaLine(item));
  lines.push("", proposals(view));
  return lines.join("\n");
}

export function proposals(view: InspectView): string {
  if (view.proposals.length === 0) return "No proposals.";
  return (
    "Proposals:\n" +
    view.proposals
      .map(
        (p) =>
          `  ${p.id}  v${p.version}  ${p.status}  base r${p.baseRevision}  by ${p.author.kind} ${p.author.id}  ${p.changes.length} change(s)  "${p.summary}"`,
      )
      .join("\n")
  );
}

export function changes(view: ChangesView): string {
  if (view.deltas.length === 0)
    return `No changes to ${view.documentId} after revision ${view.since} (head ${view.revision}).`;
  const lines = [
    `${view.documentId}: ${view.deltas.length} revision(s) after ${view.since}, head ${view.revision}`,
  ];
  for (const d of view.deltas) {
    lines.push(deltaLine(d));
    for (const c of d.changes) lines.push(`      ${change(c)}`);
  }
  return lines.join("\n");
}

function change(c: unknown): string {
  if (typeof c !== "object" || c === null) return JSON.stringify(c);
  const path: unknown = Reflect.get(c, "path");
  const rest = Object.fromEntries(Object.entries(c).filter(([k]) => k !== "path"));
  return `${Array.isArray(path) ? path.join(".") : ""} ${JSON.stringify(rest)}`.slice(0, 240);
}

export function draft(view: DraftView, documentId: string): string {
  if (!view.ok) return `Cannot preview:\n${diagnostics(view.diagnostics)}`;
  const p = view.proposal;
  const lines = [
    `${p.id} v${p.version} on ${documentId}: "${p.summary}" by ${p.author.kind} ${p.author.id}, ${p.status}`,
    `base revision ${p.baseRevision}${view.stale ? " (the head has moved since; the changes below are rebased onto it)" : ""}`,
    "",
    "Changes against its base:",
    ...view.changes.map((c) => `  ${change(c)}`),
  ];
  if (view.stale) {
    lines.push("", view.rebased.ok ? "Rebased onto the head:" : "Does not rebase onto the head:");
    lines.push(
      ...(view.rebased.ok
        ? view.rebased.changes.map((c) => `  ${change(c)}`)
        : [diagnostics(view.rebased.diagnostics)]),
    );
  }
  return lines.join("\n");
}

export function pairings(list: ReadonlyArray<Pairing>): string {
  if (list.length === 0) return 'No agents are paired. Pair one with "irudd pair <agent-id>".';
  return table(
    ["AGENT", "NAME", "PAIRED"],
    list.map((p) => [p.agent, p.name ?? "", new Date(p.createdAt).toISOString()]),
  );
}

export function table(
  header: ReadonlyArray<string>,
  rows: ReadonlyArray<ReadonlyArray<string>>,
): string {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (cells: ReadonlyArray<string>) =>
    cells
      .map((c, i) => (i === cells.length - 1 ? c : c.padEnd(widths[i] ?? 0)))
      .join("  ")
      .trimEnd();
  return [line(header), ...rows.map(line)].join("\n");
}
