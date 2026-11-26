// Document state, revision records, receipts and the journal entry type, with
// the helpers that keep them immutable at runtime.
//
// Internal module: the entry re-exports the types and the read-only helpers,
// never `makeState`, so only the reducer and recovery build a DocumentState.
//
// Ownership: every value reachable from a DocumentState is deeply frozen and
// was created by this package. Caller and storage input is copied before it
// is decoded, so a caller's objects are never frozen or retained, and nothing
// a consumer receives can be mutated to rewrite history. Frozen subtrees are
// shared between revisions.

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
  /** Who issued the command that produced this revision. */
  readonly actor: Actor;
  /** Who wrote the change: the accepted draft version's editor for a proposal, else the actor. */
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
  /** Digest of the canonical envelope; a retry must match it exactly. */
  readonly payload: Digest;
  readonly documentId: DocumentId;
  readonly command: Command["type"];
  /** Head revision after the command. */
  readonly revision: number;
  readonly documentDigest: Digest;
  /** True when the command appended a revision. */
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
  /** Author of the current draft content, including after acceptance or discard. */
  readonly lastEditor: Actor;
  readonly baseRevision: number;
  readonly version: number;
  readonly summary: string;
  /** Explicit diff against the base revision's document. */
  readonly changes: ReadonlyArray<Change>;
  readonly status: ProposalStatus;
  readonly acceptedRevision?: number;
};

/** What a committed command did, recorded so recovery never re-runs it. */
export type JournalEffect = {
  readonly revision?: {
    readonly kind: RevisionKind;
    readonly author: Actor;
    /** Field changes from the previous head. Empty for creation, which stores `document`. */
    readonly changes: ReadonlyArray<Change>;
    /** The materialised document, stored for the creating revision only. */
    readonly document?: CharacterDocument;
    readonly digest: Digest;
    readonly undoes?: number;
    readonly restores?: number;
    readonly proposal?: { readonly id: string; readonly version: number };
    readonly summary?: string;
  };
  /** The proposal as the command left it. */
  readonly proposal?: Proposal;
  readonly policy?: { readonly agentDirectEdit: boolean };
};

export const journalFormat = "irudd.journal";
export const journalVersion = 1;

/**
 * One durable record: the request, its receipt and its materialised effect,
 * chained to the previous entry by digest.
 */
export type JournalEntry = {
  readonly format: typeof journalFormat;
  readonly version: typeof journalVersion;
  /** 1 for the first entry, then consecutive. */
  readonly sequence: number;
  /** Digest of the previous entry, or null for the first. */
  readonly previous: Digest | null;
  /** The decoded envelope exactly as accepted; `receipt.payload` is its digest. */
  readonly envelope: Json;
  readonly receipt: Receipt;
  readonly effect: JournalEffect;
  /** Digest of the canonical entry without this field. */
  readonly digest: Digest;
};

export type UnsealedEntry = Omit<JournalEntry, "digest">;

/** The digest an entry carries: over its canonical JSON without the digest field. */
export function entryDigest(body: UnsealedEntry): Digest {
  return digestBrand(digestJson(body));
}

/** Chain a new owned entry after `previous`. */
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

// Not exported from the entry: code outside the package cannot write a DocumentState literal.
const stateBrand: unique symbol = Symbol("irudd.document-state");

/**
 * The complete state of one document. Only the reducer and journal recovery
 * create values of this type. Everything reachable from it is frozen.
 */
export interface DocumentState {
  readonly [stateBrand]: true;
  readonly documentId: DocumentId;
  readonly head: number;
  /** Absent before the document is created. */
  readonly document: CharacterDocument | undefined;
  readonly history: ReadonlyArray<RevisionRecord>;
  readonly receipts: ReadonlyMap<string, Receipt>;
  readonly proposals: ReadonlyMap<string, Proposal>;
  readonly policy: { readonly agentDirectEdit: boolean };
  /** Part IDs that named a part in some revision and are absent from the head. */
  readonly retired: ReadonlySet<string>;
  /** Revisions whose effect is currently reversed by an undo in force. */
  readonly undone: ReadonlySet<number>;
  /** target revision → every undo revision that targets it, oldest first */
  readonly undos: ReadonlyMap<number, ReadonlyArray<number>>;
  /** Durable record, in order. Storage persists these entries. */
  readonly journal: ReadonlyArray<JournalEntry>;
}

export type StateFields = Omit<DocumentState, typeof stateBrand>;

/** The single construction site for DocumentState. */
export function makeState(fields: StateFields): DocumentState {
  return Object.freeze({ ...fields, [stateBrand]: true as const });
}

// ── Ownership ──────────────────────────────────────────────────────────────

const owned = new WeakSet<object>();

/**
 * Deeply freeze a value this package created, in place, and return it.
 * Subtrees frozen earlier are shared as they are. Only call it on fresh
 * values: input from callers and storage is first copied with `detach`, and
 * documents are validated from a detached copy, so a caller's or a plugin's
 * objects are never frozen or retained.
 */
export function own<T>(value: T): T {
  if (typeof value === "object" && value !== null && !owned.has(value)) {
    Object.freeze(value);
    owned.add(value);
    for (const item of Object.values(value)) own(item);
  }
  return value;
}

/** A fresh, unshared copy of a JSON value. Values, including -0, and key order are kept. */
export function detach(value: Json): Json {
  if (typeof value !== "object" || value === null) return value;
  if (isJsonArray(value)) return value.map(detach);
  // fromEntries defines own properties, so a "__proto__" key stays a plain key.
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, detach(item)]));
}

/** A Map that cannot be changed after construction, even through Map.prototype. */
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
  /** A new map with one key set. */
  with(key: K, value: V): FrozenMap<K, V> {
    const next = new Map(this.#map);
    next.set(key, value);
    return new FrozenMap(next);
  }
}

/** A Set that cannot be changed after construction. */
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

// ── Undo status ────────────────────────────────────────────────────────────

/**
 * Which revisions are undone, given every undo relation. A revision is undone
 * when some undo targeting it is itself not undone. Undo revisions always
 * come after their target, so one pass from the newest revision down settles
 * every status. `inForce` lists, per target, the undos currently in force.
 */
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

/** Whether `target`'s effect is currently reversed by an undo that is itself in force. */
export function isUndone(state: DocumentState, target: number): boolean {
  return state.undone.has(target);
}

/** The undo currently reversing `target`, if any. */
export function undoneBy(state: DocumentState, target: number): number | undefined {
  return state.undos.get(target)?.find((u) => !state.undone.has(u));
}
