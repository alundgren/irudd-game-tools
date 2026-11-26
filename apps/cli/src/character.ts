import fs from "node:fs";
import path from "node:path";
import type { Diagnostic } from "@irudd/document";
import { WorkshopError } from "@irudd/workshop/client";
import { packageExtension } from "@irudd/workshop/contract";
import { exit, positional, show, UsageError, withClient, type Verb } from "./commands.js";
import * as format from "./format.js";

function safeName(label: string): string {
  const name = label
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._ -]+/g, "-")
    .replace(/^[-. ]+|[-. ]+$/g, "")
    .slice(0, 80);
  return name || "character";
}

const isDiagnostic = (value: unknown): value is Diagnostic =>
  typeof value === "object" &&
  value !== null &&
  "code" in value &&
  typeof value.code === "string" &&
  "message" in value &&
  typeof value.message === "string" &&
  "path" in value &&
  Array.isArray(value.path);

function rejected(error: unknown): ReadonlyArray<Diagnostic> | undefined {
  if (!(error instanceof WorkshopError) || error._tag !== "ArchiveRejected") return undefined;
  const list: unknown = error.detail["diagnostics"];
  return Array.isArray(list) ? list.filter(isDiagnostic) : [];
}

export const characterVerbs: ReadonlyArray<Verb> = [
  {
    name: "save",
    args: "<doc-id> <file|dir>",
    summary: "Save a character with its artwork, history and undo as an .irudd-character file",
    details: [
      "Writes a ZIP holding manifest.json, document.json, history.jsonl and one file per",
      "picture under assets/. A folder gets <label>.irudd-character; a save never overwrites.",
      'Open the file in another project with "irudd open <file>".',
    ].join("\n"),
    options: {},
    run: (context) =>
      withClient(context, async (c) => {
        const documentId = positional(context, 0, "doc-id");
        let file = path.resolve(positional(context, 1, "file"));
        if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
          const current = await c.call("current", { documentId });
          file = path.join(
            file,
            safeName(current.document?.label ?? documentId) + packageExtension,
          );
        } else if (!file.toLowerCase().endsWith(packageExtension)) file += packageExtension;
        const report = await c.call("document.save", { documentId, path: file });
        show(context, report, () =>
          [
            `Saved ${report.label} (revision ${report.revision}) to ${report.path}`,
            `  ${report.bytes} bytes, ${report.entries} history entries, ${report.assets} artwork file(s)`,
            `  sha256 ${report.sha256}`,
          ].join("\n"),
        );
        return exit.ok;
      }),
  },
  {
    name: "open",
    args: "<file>",
    summary:
      "Open a saved character (.irudd-character or a JSON document archive) into the project",
    details: [
      "Everything is checked before anything is written: the package, every picture's digest,",
      "the history, and the document against this build and project (features, part, pose and",
      "paint references, installed catalogs). A refusal lists the problems and exits with 4.",
    ].join("\n"),
    options: {},
    run: (context) =>
      withClient(context, async (c) => {
        const file = path.resolve(positional(context, 0, "file"));
        if (!fs.existsSync(file)) throw new UsageError(`No file at ${file}.`);
        try {
          const report = await c.call("document.open", { path: file });
          show(context, report, () =>
            [
              `Opened ${report.label} as ${report.documentId} at revision ${report.revision}`,
              `  ${report.journal.sequence} history entries; artwork ${report.blobs.added} added, ${report.blobs.existing} already here`,
              `  read as ${report.format}`,
            ].join("\n"),
          );
          return exit.ok;
        } catch (error) {
          const diagnostics = rejected(error);
          if (!diagnostics || !(error instanceof WorkshopError)) throw error;
          show(context, { rejected: error.detail }, () =>
            [
              `Not opened; nothing was written. ${error.message}`,
              format.diagnostics(diagnostics),
            ].join("\n"),
          );
          return exit.rejected;
        }
      }),
  },
];
