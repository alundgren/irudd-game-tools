import type { MethodName } from "@irudd/workshop/wire";

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
  "recipient.list",
  "recipient.check",
  "recipient.bind",
  "recipient.unbind",
  "steer.send",
  "steer.list",
  "steer.get",
  "steer.cancel",
  "steer.retry",
  "review.capabilities",
  "review.export",
  "review.inspect",
  "review.read",
  "project.image",
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
  readonly mode: "host" | "attached";
}

export interface ProjectState {
  readonly project: OpenProject | null;
  readonly recent: ReadonlyArray<string>;
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
  readonly staticMesh?: boolean;
  readonly wardrobe?: boolean;
  readonly bytes: Uint8Array;
}

export interface InspectionImage {
  readonly view: string;
  readonly png: Uint8Array;
}

export interface InspectionSave {
  readonly model: string;
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
  readonly hidden: boolean;
}

export type UpdatePhase = "unmanaged" | "idle" | "checking" | "building" | "ready" | "error";

export interface UpdateStatus {
  readonly phase: UpdatePhase;
  readonly message: string;
  readonly current?: string;
  readonly next?: string;
  readonly previous?: string;
  readonly output?: string;
}

export const updateActions = ["status", "check", "cancel", "restart", "rollback"] as const;
export type UpdateAction = (typeof updateActions)[number];

export interface CharacterProblem {
  readonly code: string;
  readonly path: ReadonlyArray<string | number>;
  readonly message: string;
}

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
      readonly document?: unknown;
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

export interface DesktopApi {
  copyDirection(code: string): Promise<void>;
  app(): Promise<AppInfo>;
  projectState(): Promise<ProjectState>;
  openProject(directory?: string): Promise<ProjectState>;
  createProject(kind?: "untitled"): Promise<ProjectState>;
  call(method: WindowMethod, params: unknown): Promise<CallOutcome>;
  onCommit(listener: (notice: CommitNotice) => void): () => void;
  onSteer(listener: (notice: SteerNotice) => void): () => void;
  library(): Promise<ReadonlyArray<LibraryEntry>>;
  bundledImage(digest: string): Promise<Uint8Array>;
  referenceModels(): Promise<string[]>;
  referenceModel(id: string): Promise<Uint8Array>;
  humanPack(file: string): Promise<Uint8Array>;
  readLibrary(id: string): Promise<LibraryFile | null>;
  openGlb(): Promise<LibraryFile | null>;
  saveExport(request: ExportRequest): Promise<LibraryEntry>;
  saveInspection(request: InspectionSave): Promise<string>;
  saveCharacter(documentId: string): Promise<CharacterFileOutcome>;
  openCharacter(donor?: boolean): Promise<CharacterFileOutcome>;
  update(action: UpdateAction): Promise<UpdateStatus>;
  onUpdate(listener: (status: UpdateStatus) => void): () => void;
}

export type PreloadApi = {
  readonly [K in Exclude<keyof DesktopApi, "onCommit" | "onSteer" | "onUpdate">]: (
    ...args: Parameters<DesktopApi[K]>
  ) => Promise<unknown>;
} & {
  readonly onCommit: (listener: (notice: unknown) => void) => () => void;
  readonly onSteer: (listener: (notice: unknown) => void) => () => void;
  readonly onUpdate: (listener: (status: unknown) => void) => () => void;
};

export const channels = {
  copyDirection: "workshop:copy-direction",
  app: "workshop:app",
  projectState: "workshop:project-state",
  openProject: "workshop:open-project",
  createProject: "workshop:create-project",
  call: "workshop:call",
  commit: "workshop:commit",
  steer: "workshop:steer",
  library: "workshop:library",
  bundledImage: "workshop:bundled-image",
  referenceModels: "workshop:reference-models",
  referenceModel: "workshop:reference-model",
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
