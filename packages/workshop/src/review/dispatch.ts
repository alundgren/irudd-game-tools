// The review verbs of the host's dispatcher. Agents may ask for capabilities,
// exports, inspections and artifact reads; serving as the renderer belongs to
// a person's connection (an attached desktop).

import { decodeWith } from "@irudd/document";
import { toWireError, type DecodedParams, type MethodName } from "../wire/protocol.js";
import { reviewParams } from "../wire/review.js";
import { RemoteRenderer, type ConnectionLink } from "./remote.js";
import { ReviewError, type Review } from "./service.js";

type Outcome =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: ReturnType<typeof toWireError> };

export interface ReviewCaller {
  readonly role: "human" | "agent";
  /** The wire connection, when the caller has one. */
  readonly connection?: ConnectionLink;
}

type ReviewParams = typeof reviewParams;

/** Parameters decoded again with the method's own schema, typed for that method. */
function typed<M extends keyof ReviewParams>(method: M, value: unknown): ReviewParams[M]["Type"] {
  const decoded = decodeWith(reviewParams[method], value, ["params"]);
  if (!decoded.ok)
    throw new ReviewError("InvalidArgument", `Invalid parameters for ${method}.`, {
      path: ["params"],
    });
  return decoded.value;
}

/** Remote renderers by connection ID, so a closed connection fails its jobs. */
export class ReviewRoutes {
  private readonly review: Review;
  private readonly remotes = new Map<
    string,
    { renderer: RemoteRenderer; unregister: () => void }
  >();

  constructor(review: Review) {
    this.review = review;
  }

  connectionClosed(connectionId: string): void {
    const remote = this.remotes.get(connectionId);
    if (!remote) return;
    this.remotes.delete(connectionId);
    remote.unregister();
    remote.renderer.close();
  }

  private remote(caller: ReviewCaller, method: string): RemoteRenderer {
    const connection = caller.connection;
    const remote = connection ? this.remotes.get(connection.id) : undefined;
    if (!remote)
      throw new ReviewError(
        "Forbidden",
        `${method} is for the connection that called review.serve.`,
      );
    return remote.renderer;
  }

  async call(
    caller: ReviewCaller,
    method: MethodName,
    decoded: DecodedParams[MethodName],
  ): Promise<Outcome> {
    try {
      return { ok: true, value: await this.route(caller, method, decoded) };
    } catch (thrown) {
      return { ok: false, error: toWireError(thrown) };
    }
  }

  private async route(
    caller: ReviewCaller,
    method: MethodName,
    decoded: DecodedParams[MethodName],
  ): Promise<unknown> {
    switch (method) {
      case "review.capabilities":
        return this.review.capabilities();
      case "review.export": {
        const d = typed("review.export", decoded);
        return this.review.export(d);
      }
      case "review.inspect": {
        const d = typed("review.inspect", decoded);
        return this.review.inspect(d);
      }
      case "review.read": {
        const d = typed("review.read", decoded);
        return this.review.read(d.sha256, d.offset ?? 0, d.length);
      }
      case "review.serve": {
        if (caller.role !== "human" || !caller.connection)
          throw new ReviewError(
            "Forbidden",
            "review.serve registers a person's desktop connection as the renderer. Desktop main owning the project registers in process.",
          );
        const d = typed("review.serve", decoded);
        this.connectionClosed(caller.connection.id);
        const renderer = new RemoteRenderer(caller.connection, d.renderer);
        const registered = this.review.register(renderer, "attached");
        this.remotes.set(caller.connection.id, { renderer, unregister: registered.unregister });
        const view = this.review.capabilities().renderer;
        if (!view) throw new ReviewError("HostFailed", "The renderer did not register.");
        return { serving: true, renderer: view };
      }
      case "review.put": {
        const d = typed("review.put", decoded);
        const received = this.remote(caller, method).put(
          d.jobId,
          d.name,
          d.offset,
          d.total,
          d.base64,
        );
        return { jobId: d.jobId, name: d.name, received };
      }
      case "review.complete": {
        const d = typed("review.complete", decoded);
        this.remote(caller, method).complete(
          d.jobId,
          d.ok
            ? { ok: true, result: d.result ?? null }
            : { ok: false, tag: d.error?.tag ?? "RenderFailed", message: d.error?.message ?? "" },
        );
        return { jobId: d.jobId, accepted: true };
      }
      default:
        throw new ReviewError("UnknownMethod", `The host has no method ${method}.`);
    }
  }
}

export const isReviewMethod = (method: string): boolean => method.startsWith("review.");
