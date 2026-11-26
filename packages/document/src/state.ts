import type { Change } from "./changes.js";
import type { Actor, Command } from "./commands.js";
import { digestBrand } from "./document.js";
import { isJsonArray, type Json } from "./json.js";
import { digestJson } from "./sha256.js";
import type { CharacterDocument, Digest, DocumentId } from "./schema.js";

export type RevisionKind = "create" | "edit" | "undo" | "restore" | "proposal" | "upgrade";

export interface RevisionRecord {
  readonly revision: number;
  readonly kind: RevisionKind;
  readonly actor: Actor;
  readonly author: Actor;
  readonly requestId: string;
  readonly changes: ReadonlyArray<Change>;
  readonly document: CharacterDocument;
  readonly digest: Digest;
  readonly undoes?: number;
  readonly restores?: number;
  readonly proposal?: { readonly id: string; readonly version: number };
  readonly summary?: string;
}

export type ProposalStatus = "draft" | "discarded" | "accepted";

export type Receipt = {
  readonly requestId: string;
  readonly payload: Digest;
  readonly documentId: DocumentId;
  readonly command: Command["type"];
  readonly revision: number;
  readonly documentDigest: Digest;
  readonly appended: boolean;
  readonly proposal?: {
    readonly id: string;
    readonly version: number;
    readonly status: ProposalStatus;
  };
};

export type Proposal = {
  readonly id: string;
  readonly author: Actor;
  readonly lastEditor: Actor;
  readonly baseRevision: number;
  readonly version: number;
  readonly summary: string;
  readonly changes: ReadonlyArray<Change>;
  readonly status: ProposalStatus;
  readonly acceptedRevision?: number;
};

export type JournalEffect = {
  readonly revision?: {
    readonly kind: RevisionKind;
    readonly author: Actor;
    readonly changes: ReadonlyArray<Change>;
    readonly document?: CharacterDocument;
    readonly digest: Digest;
    readonly undoes?: number;
    readonly restores?: number;
    readonly proposal?: { readonly id: string; readonly version: number };
    readonly summary?: string;
  };
  readonly proposal?: Proposal;
  readonly policy?: { readonly agentDirectEdit: boolean };
};

export const journalFormat = "irudd.journal";
export const journalVersion = 1;

export type JournalEntry = {
  readonly format: typeof journalFormat;
  readonly version: typeof journalVersion;
  readonly sequence: number;
  readonly previous: Digest | null;
  readonly envelope: Json;
  readonly receipt: Receipt;
  readonly effect: JournalEffect;
  readonly digest: Digest;
};

export type UnsealedEntry = Omit<JournalEntry, "digest">;

export function entryDigest(body: UnsealedEntry): Digest {
  return digestBrand(digestJson(body));
}

export function sealEntry(
  previous: JournalEntry | undefined,
  envelope: Json,
  receipt: Receipt,
  effect: JournalEffect,
): JournalEntry {
  const body: UnsealedEntry = {
    format: journalFormat,
    version: journalVersion,
    sequence: (previous?.sequence ?? 0) + 1,
    previous: previous?.digest ?? null,
    envelope,
    receipt,
    effect,
  };
  return own({ ...body, digest: entryDigest(body) });
}

const stateBrand: unique symbol = Symbol("irudd.document-state");

export interface DocumentState {
  readonly [stateBrand]: true;
  readonly documentId: DocumentId;
  readonly head: number;
  readonly document: CharacterDocument | undefined;
  readonly history: ReadonlyArray<RevisionRecord>;
  readonly receipts: ReadonlyMap<string, Receipt>;
  readonly proposals: ReadonlyMap<string, Proposal>;
  readonly policy: { readonly agentDirectEdit: boolean };
  readonly retired: ReadonlySet<string>;
  readonly undone: ReadonlySet<number>;
  readonly undos: ReadonlyMap<number, ReadonlyArray<number>>;
  readonly journal: ReadonlyArray<JournalEntry>;
}

export type StateFields = Omit<DocumentState, typeof stateBrand>;

export function makeState(fields: StateFields): DocumentState {
  return Object.freeze({ ...fields, [stateBrand]: true as const });
}

const owned = new WeakSet<object>();

export function own<T>(value: T): T {
  if (typeof value === "object" && value !== null && !owned.has(value)) {
    Object.freeze(value);
    owned.add(value);
    for (const item of Object.values(value)) own(item);
  }
  return value;
}

export function detach(value: Json): Json {
  if (typeof value !== "object" || value === null) return value;
  if (isJsonArray(value)) return value.map(detach);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, detach(item)]));
}

export class FrozenMap<K, V> implements ReadonlyMap<K, V> {
  readonly #map: Map<K, V>;
  constructor(entries: Iterable<readonly [K, V]> = []) {
    this.#map = new Map(entries);
    Object.freeze(this);
  }
  get size(): number {
    return this.#map.size;
  }
  get(key: K): V | undefined {
    return this.#map.get(key);
  }
  has(key: K): boolean {
    return this.#map.has(key);
  }
  forEach(callback: (value: V, key: K, map: ReadonlyMap<K, V>) => void): void {
    this.#map.forEach((value, key) => callback(value, key, this));
  }
  keys(): MapIterator<K> {
    return this.#map.keys();
  }
  values(): MapIterator<V> {
    return this.#map.values();
  }
  entries(): MapIterator<[K, V]> {
    return this.#map.entries();
  }
  [Symbol.iterator](): MapIterator<[K, V]> {
    return this.#map.entries();
  }
  with(key: K, value: V): FrozenMap<K, V> {
    const next = new Map(this.#map);
    next.set(key, value);
    return new FrozenMap(next);
  }
}

export class FrozenSet<T> implements ReadonlySet<T> {
  readonly #set: Set<T>;
  constructor(items: Iterable<T> = []) {
    this.#set = new Set(items);
    Object.freeze(this);
  }
  get size(): number {
    return this.#set.size;
  }
  has(value: T): boolean {
    return this.#set.has(value);
  }
  forEach(callback: (value: T, key: T, set: ReadonlySet<T>) => void): void {
    this.#set.forEach((value) => callback(value, value, this));
  }
  keys(): SetIterator<T> {
    return this.#set.values();
  }
  values(): SetIterator<T> {
    return this.#set.values();
  }
  entries(): SetIterator<[T, T]> {
    return this.#set.entries();
  }
  [Symbol.iterator](): SetIterator<T> {
    return this.#set.values();
  }
}

export function undoStatus(
  head: number,
  undos: ReadonlyMap<number, ReadonlyArray<number>>,
): { readonly undone: Set<number>; readonly inForce: Map<number, number[]> } {
  const undone = new Set<number>();
  const inForce = new Map<number, number[]>();
  for (let r = head; r >= 1; r--) {
    const by = undos.get(r);
    if (!by) continue;
    const active = by.filter((u) => !undone.has(u));
    if (active.length) {
      undone.add(r);
      inForce.set(r, active);
    }
  }
  return { undone, inForce };
}

export function isUndone(state: DocumentState, target: number): boolean {
  return state.undone.has(target);
}

export function undoneBy(state: DocumentState, target: number): number | undefined {
  return state.undos.get(target)?.find((u) => !state.undone.has(u));
}
