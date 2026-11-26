import type { CharacterDocument, Diagnostic, Part } from "@irudd/document";
import type { InspectView } from "@irudd/workshop/contract";
import type { DesktopApi, ProjectState } from "../../shared/api.js";
import { CallFailed, type Workshop } from "../bridge.js";

export interface PanelContext {
  readonly api: DesktopApi;
  readonly host: Workshop;
  readonly project: ProjectState["project"];
  readonly doc: CharacterDocument | undefined;
  readonly documentId: string | undefined;
  readonly view: InspectView | undefined;
  readonly selection: string | null;
  readonly part: (id: string) => Part | undefined;
  readonly selectPart: (id: string | null) => void;
  readonly rename: (id: string, label: string) => Promise<void>;
  readonly commit: (command: Record<string, unknown>, what: string) => Promise<boolean>;
  readonly say: (text: string) => void;
  readonly showBanner: (kind: "info" | "error", ...content: (Node | string)[]) => void;
}

export function describe(diagnostics: ReadonlyArray<Diagnostic>): string {
  return diagnostics
    .map((d) => `${d.message}${d.path.length ? ` (${d.path.join(".")})` : ""}`)
    .join(" ");
}

export function failure(error: unknown): string {
  if (error instanceof CallFailed) return `${error.tag}: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}
