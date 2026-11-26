// Shape checks for host replies. The host is authenticated before any reply
// arrives, so these are not a second validator of document contents: they
// catch a host from another build that answers with a different shape, and
// they give each reply its contract type without an unchecked assertion.

import type { MethodName, MethodResults } from "../wire/protocol.js";

type Guard<T> = (value: unknown) => value is T;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function has<T>(...keys: ReadonlyArray<string>): Guard<T> {
  return (value: unknown): value is T => isRecord(value) && keys.every((key) => key in value);
}

function list<T>(): Guard<T> {
  return (value: unknown): value is T => Array.isArray(value);
}

function oneOf<T>(key: string, tags: ReadonlyArray<unknown>): Guard<T> {
  return (value: unknown): value is T => isRecord(value) && tags.includes(value[key]);
}

const receiptOrNull = (value: unknown): value is MethodResults["receipt"] =>
  value === null || (isRecord(value) && "requestId" in value && "revision" in value);

export const resultGuards: { readonly [M in MethodName]: Guard<MethodResults[M]> } = {
  "project.info": has("projectId", "host", "directory"),
  whoami: has("actor", "role"),
  starters: has("starters", "families"),
  documents: list(),
  current: has("documentId", "revision", "access", "policy"),
  inspect: has("documentId", "revision", "history", "proposals"),
  "project.image": has("digest", "mediaType", "byteLength", "offset", "base64", "done"),
  changes: has("documentId", "since", "deltas"),
  diff: oneOf("ok", [true, false]),
  draft: oneOf("ok", [true, false]),
  receipt: receiptOrNull,
  apply: oneOf("kind", ["committed", "replayed", "rejected"]),
  start: has("starter", "params", "result"),
  subscribe: has("subscribed"),
  "pair.agent": has("agent", "credentialFile"),
  "pair.list": list(),
  "pair.revoke": has("agent", "revoked"),
  verify: has("ok", "documents", "blobs"),
  "document.save": has("path", "bytes", "sha256", "documentId", "revision"),
  "document.open": has("documentId", "revision", "journal", "blobs"),
  "recipient.bind": has("agent", "pairingId", "route"),
  "recipient.unbind": has("agent", "unbound"),
  "recipient.list": list(),
  "recipient.check": has("agent", "availability"),
  "steer.send": has("messageId", "status", "delivery"),
  "steer.list": has("messages", "last"),
  "steer.get": has("messageId", "status", "delivery"),
  "steer.cancel": has("messageId", "status", "delivery"),
  "steer.retry": has("messageId", "status", "delivery"),
  "inbox.read": has("agent", "pairingId", "messages", "last"),
  "inbox.ack": has("messageId", "status", "acknowledged"),
  "inbox.applied": has("messageId", "status", "applied"),
  "inbox.watch": has("watching", "push"),
  "inbox.pushed": has("messageId", "status"),
  "review.capabilities": has("available", "renderer", "presets"),
  "review.export": has("source", "glb", "provenance", "renderer"),
  "review.inspect": has("source", "glb", "images", "metrics", "renderer"),
  "review.read": has("sha256", "offset", "base64", "done"),
  "review.serve": has("serving", "renderer"),
  "review.put": has("jobId", "name", "received"),
  "review.complete": has("jobId", "accepted"),
  "art.capabilities": has("kinds", "producer", "limits"),
  "art.put": has("digest", "received", "total", "stored"),
  "art.request": has("artId", "messageId", "brief", "submissions"),
  "art.list": has("requests"),
  "art.get": has("artId", "messageId", "brief", "submissions"),
  "art.read": has("digest", "offset", "base64", "done"),
  "art.submit": has("outcome", "submission", "request"),
  "art.cancel": has("artId", "state", "closed"),
};
