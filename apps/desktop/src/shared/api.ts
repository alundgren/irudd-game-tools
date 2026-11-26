// The desktop bridge: what the sandboxed renderer may ask of the main process.
//
// Types and channel names only. Main, preload and renderer each import this
// module; it has no behaviour. Every value crossing the bridge is structured-clone
// data. The renderer is untrusted: main validates every argument and keeps
// file paths to itself, handing out library entry IDs instead.

import type { MethodName } from "@irudd/workshop/wire";

/** Methods of the workshop host a window may call as its person; never an agent inbox verb. */
export const windowMethods = [
  "project.info",
  "starters",
  "documents",
  "current",
  "inspect",
  "changes",
  "diff",
  "draft",
  "apply",
  "start",
  "pair.agent",
  "pair.list",
  "pair.revoke",
  "verify",
  // Steering: the person binds a paired agent to its conversation and sends it messages.
  "recipient.list",
  "recipient.check",
  "recipient.bind",
  "recipient.unbind",
  "steer.send",
  "steer.list",
  "steer.get",
  "steer.cancel",
  "steer.retry",
  // Review: export a named revision and inspect the GLB, rendered by the isolated review worker.
  "review.capabilities",
  "review.export",
  "review.inspect",
  "review.read",
  "project.image",
  // Art: the person briefs the paired agent for artwork, reviews its replies and imports files.
  "art.capabilities",
  "art.put",
  "art.request",
  "art.list",
  "art.get",
  "art.read",
  "art.submit",
  "art.cancel",
] as const satisfies ReadonlyArray<Exclude<MethodName, `inbox.${string}`>>;
export type WindowMethod = (typeof windowMethods)[number];

export interface OpenProject {
  readonly untitled?: boolean;
  readonly directory: string;
  readonly label: string;
  /** `host`: this window's process owns the project. `attached`: another process does. */
  readonly mode: "host" | "attached";
}

export interface ProjectState {
  readonly project: OpenProject | null;
  readonly recent: ReadonlyArray<string>;
  /** Set when the last open or create failed. */
  readonly error?: string;
}

export interface LibraryEntry {
  readonly id: string;
  readonly name: string;
  readonly origin: "export" | "opened";
  readonly byteLength: number;
  readonly modifiedAt: number;
}

export interface LibraryFile {
  readonly entry: LibraryEntry;
  readonly bytes: Uint8Array;
}

export interface ExportRequest {
  readonly documentId: string;
  readonly label: string;
  readonly revision: number;
  readonly preset: string;
  /** A wardrobe export: every saved outfit as its own scene. Saved as `…-<preset>-outfits.glb`. */
  readonly wardrobe?: boolean;
  readonly bytes: Uint8Array;
}

export interface InspectionImage {
  readonly view: string;
  readonly png: Uint8Array;
}

export interface InspectionSave {
  readonly model: string;
  /** JSON metadata for the sheet, without image bytes. */
  readonly metadata: unknown;
  readonly images: ReadonlyArray<InspectionImage>;
}

export interface CommitNotice {
  readonly documentId: string;
  readonly revision: number;
  readonly sequence: number;
  readonly command: string;
  readonly actor: { readonly kind: "human" | "agent"; readonly id: string; readonly name?: string };
}

/** A steering message changed state; read it with `steer.get`. */
export interface SteerNotice {
  readonly messageId: string;
  readonly agent: string;
  readonly seq: number;
  readonly status: string;
}

export type CallOutcome =
  | { readonly ok: true; readonly value: unknown }
  | {
      readonly ok: false;
      readonly error: { readonly _tag: string; readonly message: string };
    };

export interface AppInfo {
  readonly build: string;
  readonly versions: {
    readonly electron: string;
    readonly chrome: string;
    readonly node: string;
  };
  /** True when the window runs without being shown (verification runs). */
  readonly hidden: boolean;
}

/**
 * The installed app's source update. `unmanaged`: a development or unpacked
 * build that the installer does not own. A failed or canceled build leaves the
 * running version in use; `ready` waits for the person to restart.
 */
export type UpdatePhase = "unmanaged" | "idle" | "checking" | "building" | "ready" | "error";

export interface UpdateStatus {
  readonly phase: UpdatePhase;
  readonly message: string;
  /** The running build's commit. */
  readonly current?: string;
  /** The commit being built, or ready to start. */
  readonly next?: string;
  /** The build a rollback returns to. */
  readonly previous?: string;
  /** The tail of the build log while building or after a failure. */
  readonly output?: string;
}

/** What the window may ask of the updater. Restart and rollback quit and reopen the app. */
export const updateActions = ["status", "check", "cancel", "restart", "rollback"] as const;
export type UpdateAction = (typeof updateActions)[number];

/** A problem that kept a character file from opening, as the host reported it. */
export interface CharacterProblem {
  readonly code: string;
  readonly path: ReadonlyArray<string | number>;
  readonly message: string;
}

/**
 * What saving or opening a character file tells the window. Main keeps the
 * path; the window sees the file name only.
 */
export type CharacterFileOutcome =
  | {
      readonly ok: true;
      readonly action: "saved";
      readonly name: string;
      readonly documentId: string;
      readonly label: string;
      readonly revision: number;
      readonly entries: number;
      readonly assets: number;
      readonly bytes: number;
    }
  | {
      readonly ok: true;
      readonly action: "opened";
      readonly name: string;
      readonly documentId: string;
      readonly label: string;
      readonly revision: number;
      readonly entries: number;
      readonly assets: number;
    }
  | { readonly ok: false; readonly canceled: true }
  | {
      readonly ok: false;
      readonly canceled: false;
      readonly error: { readonly _tag: string; readonly message: string };
      readonly problems: ReadonlyArray<CharacterProblem>;
    };

/** `window.workshop` in the renderer. */
export interface DesktopApi {
  app(): Promise<AppInfo>;
  projectState(): Promise<ProjectState>;
  openProject(directory?: string): Promise<ProjectState>;
  createProject(kind?: "untitled"): Promise<ProjectState>;
  call(method: WindowMethod, params: unknown): Promise<CallOutcome>;
  onCommit(listener: (notice: CommitNotice) => void): () => void;
  onSteer(listener: (notice: SteerNotice) => void): () => void;
  library(): Promise<ReadonlyArray<LibraryEntry>>;
  /** One of the adult's body packs, by file name, for the window's preview. */
  humanPack(file: string): Promise<Uint8Array>;
  readLibrary(id: string): Promise<LibraryFile | null>;
  openGlb(): Promise<LibraryFile | null>;
  saveExport(request: ExportRequest): Promise<LibraryEntry>;
  saveInspection(request: InspectionSave): Promise<string>;
  /** Save a character with its artwork and history as an `.irudd-character` file the person picks. */
  saveCharacter(documentId: string): Promise<CharacterFileOutcome>;
  /** Open a character file the person picks into the open project. */
  openCharacter(): Promise<CharacterFileOutcome>;
  update(action: UpdateAction): Promise<UpdateStatus>;
  onUpdate(listener: (status: UpdateStatus) => void): () => void;
}

/**
 * What the preload exposes as `window.workshop`: the same methods, but every
 * reply is `unknown` until the renderer has checked its shape.
 */
export type PreloadApi = {
  readonly [K in Exclude<keyof DesktopApi, "onCommit" | "onSteer" | "onUpdate">]: (
    ...args: Parameters<DesktopApi[K]>
  ) => Promise<unknown>;
} & {
  readonly onCommit: (listener: (notice: unknown) => void) => () => void;
  readonly onSteer: (listener: (notice: unknown) => void) => () => void;
  readonly onUpdate: (listener: (status: unknown) => void) => () => void;
};

/** IPC channel names. The preload maps each DesktopApi method to one. */
export const channels = {
  app: "workshop:app",
  projectState: "workshop:project-state",
  openProject: "workshop:open-project",
  createProject: "workshop:create-project",
  call: "workshop:call",
  commit: "workshop:commit",
  steer: "workshop:steer",
  library: "workshop:library",
  humanPack: "workshop:human-pack",
  readLibrary: "workshop:read-library",
  openGlb: "workshop:open-glb",
  saveExport: "workshop:save-export",
  saveInspection: "workshop:save-inspection",
  saveCharacter: "workshop:save-character",
  openCharacter: "workshop:open-character",
  update: "workshop:update",
  updateStatus: "workshop:update-status",
} as const;
