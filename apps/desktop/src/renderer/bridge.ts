import type { MethodParams, MethodResults } from "@irudd/workshop/wire";
import type {
  AppInfo,
  CallOutcome,
  CharacterFileOutcome,
  CommitNotice,
  DesktopApi,
  LibraryEntry,
  LibraryFile,
  PreloadApi,
  ProjectState,
  SteerNotice,
  UpdateStatus,
  WindowMethod,
} from "../shared/api.js";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function isPreload(value: unknown): value is PreloadApi {
  if (!isRecord(value)) return false;
  return ["app", "projectState", "call", "onCommit", "onSteer", "library", "saveExport"].every(
    (key) => typeof value[key] === "function",
  );
}

const isAppInfo = (v: unknown): v is AppInfo =>
  isRecord(v) && typeof v["build"] === "string" && isRecord(v["versions"]);

const isState = (v: unknown): v is ProjectState =>
  isRecord(v) && "project" in v && Array.isArray(v["recent"]);

const isEntry = (v: unknown): v is LibraryEntry =>
  isRecord(v) && typeof v["id"] === "string" && typeof v["name"] === "string";

const isFile = (v: unknown): v is LibraryFile =>
  isRecord(v) && isEntry(v["entry"]) && v["bytes"] instanceof Uint8Array;

const isOutcome = (v: unknown): v is CallOutcome =>
  isRecord(v) && (v["ok"] === true || (v["ok"] === false && isRecord(v["error"])));

const isNotice = (v: unknown): v is CommitNotice =>
  isRecord(v) &&
  typeof v["documentId"] === "string" &&
  typeof v["revision"] === "number" &&
  typeof v["command"] === "string" &&
  isRecord(v["actor"]);

const isSteer = (v: unknown): v is SteerNotice =>
  isRecord(v) &&
  typeof v["messageId"] === "string" &&
  typeof v["agent"] === "string" &&
  typeof v["seq"] === "number" &&
  typeof v["status"] === "string";

const isCharacterOutcome = (v: unknown): v is CharacterFileOutcome =>
  isRecord(v) &&
  ((v["ok"] === true &&
    (v["action"] === "saved" || v["action"] === "opened") &&
    typeof v["name"] === "string" &&
    typeof v["documentId"] === "string" &&
    typeof v["revision"] === "number") ||
    (v["ok"] === false && v["canceled"] === true) ||
    (v["ok"] === false && isRecord(v["error"]) && Array.isArray(v["problems"])));

const updatePhases = new Set(["unmanaged", "idle", "checking", "building", "ready", "error"]);
const isUpdate = (v: unknown): v is UpdateStatus =>
  isRecord(v) &&
  typeof v["phase"] === "string" &&
  updatePhases.has(v["phase"]) &&
  typeof v["message"] === "string";

function check<T>(value: unknown, guard: (v: unknown) => v is T, what: string): T {
  if (!guard(value)) throw new Error(`The desktop bridge returned an unexpected ${what}.`);
  return value;
}

export function bridge(): DesktopApi {
  const raw: unknown = Reflect.get(globalThis, "workshop");
  if (!isPreload(raw))
    throw new Error("The workshop bridge is missing; this page runs only in the desktop app.");
  const api = raw;
  return {
    copyDirection: async (code) => {
      await api.copyDirection(code);
    },
    app: async () => check(await api.app(), isAppInfo, "app"),
    projectState: async () => check(await api.projectState(), isState, "project state"),
    openProject: async (directory) =>
      check(await api.openProject(directory), isState, "project state"),
    createProject: async (kind) => check(await api.createProject(kind), isState, "project state"),
    call: async (method, params) => check(await api.call(method, params), isOutcome, "reply"),
    onCommit: (listener) =>
      api.onCommit((notice) => {
        if (isNotice(notice)) listener(notice);
      }),
    onSteer: (listener) =>
      api.onSteer((notice) => {
        if (isSteer(notice)) listener(notice);
      }),
    library: async () =>
      check(
        await api.library(),
        (v): v is LibraryEntry[] => Array.isArray(v) && v.every(isEntry),
        "library",
      ),
    bundledImage: async (digest) =>
      check(
        await api.bundledImage(digest),
        (v): v is Uint8Array => v instanceof Uint8Array,
        "bundled image",
      ),
    referenceModels: async () =>
      check(
        await api.referenceModels(),
        (v): v is string[] => Array.isArray(v) && v.every((id) => typeof id === "string"),
        "reference catalogue",
      ),
    referenceModel: async (id) =>
      check(
        await api.referenceModel(id),
        (v): v is Uint8Array => v instanceof Uint8Array,
        "reference mesh",
      ),
    humanPack: async (file) =>
      check(await api.humanPack(file), (v): v is Uint8Array => v instanceof Uint8Array, "pack"),
    readLibrary: async (id) =>
      check(
        await api.readLibrary(id),
        (v): v is LibraryFile | null => v === null || isFile(v),
        "file",
      ),
    openGlb: async () =>
      check(await api.openGlb(), (v): v is LibraryFile | null => v === null || isFile(v), "file"),
    saveExport: async (request) => check(await api.saveExport(request), isEntry, "export"),
    saveInspection: async (request) =>
      check(await api.saveInspection(request), (v): v is string => typeof v === "string", "path"),
    saveCharacter: async (documentId) =>
      check(await api.saveCharacter(documentId), isCharacterOutcome, "character save"),
    openCharacter: async (donor) =>
      check(await api.openCharacter(donor), isCharacterOutcome, "character open"),
    update: async (action) => check(await api.update(action), isUpdate, "update status"),
    onUpdate: (listener) =>
      api.onUpdate((status) => {
        if (isUpdate(status)) listener(status);
      }),
  };
}

export class CallFailed extends Error {
  readonly tag: string;
  constructor(tag: string, message: string) {
    super(message);
    this.tag = tag;
  }
}

function shaped<M extends WindowMethod>(method: M, value: unknown): value is MethodResults[M] {
  switch (method) {
    case "documents":
    case "pair.list":
    case "recipient.list":
      return Array.isArray(value);
    default:
      return isRecord(value);
  }
}

export interface Workshop {
  call<M extends WindowMethod>(method: M, params: MethodParams[M]): Promise<MethodResults[M]>;
}

export function workshop(api: Pick<DesktopApi, "call">): Workshop {
  return {
    async call(method, params) {
      const outcome = await api.call(method, params);
      if (!outcome.ok) throw new CallFailed(outcome.error._tag, outcome.error.message);
      if (!shaped(method, outcome.value))
        throw new CallFailed("ProtocolError", `${method} returned an unexpected shape.`);
      return outcome.value;
    },
  };
}
