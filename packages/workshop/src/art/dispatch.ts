import { decodeWith } from "@irudd/document";
import { toWireError, type DecodedParams, type MethodName } from "../wire/protocol.js";
import { artParams } from "../wire/art.js";
import { ArtError, type Art, type ArtCaller } from "./service.js";

type Outcome =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: ReturnType<typeof toWireError> };

type ArtParams = typeof artParams;

function typed<M extends keyof ArtParams>(method: M, value: unknown): ArtParams[M]["Type"] {
  const decoded = decodeWith(artParams[method], value, ["params"]);
  if (!decoded.ok)
    throw new ArtError("InvalidArgument", `Invalid parameters for ${method}.`, {
      path: ["params"],
      diagnostics: decoded.diagnostics,
    });
  return decoded.value;
}

const person = (caller: ArtCaller, method: string) => {
  if (caller.role !== "human")
    throw new ArtError(
      "Forbidden",
      `${method} needs a person. The paired agent answers with art.submit.`,
    );
};

export class ArtRoutes {
  private readonly art: Art;
  constructor(art: Art) {
    this.art = art;
  }

  connectionClosed(key: string): void {
    this.art.disconnected(key);
  }

  async call(
    caller: ArtCaller,
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
    caller: ArtCaller,
    method: MethodName,
    decoded: DecodedParams[MethodName],
  ): Promise<unknown> {
    switch (method) {
      case "art.capabilities":
        return this.art.capabilities();
      case "art.put":
        return this.art.put(caller, typed("art.put", decoded));
      case "art.request": {
        person(caller, method);
        return this.art.request(caller.actor, typed("art.request", decoded));
      }
      case "art.list":
        return this.art.list(caller, typed("art.list", decoded));
      case "art.get":
        return this.art.get(caller, typed("art.get", decoded).artId);
      case "art.read":
        return this.art.read(caller, typed("art.read", decoded));
      case "art.submit":
        return this.art.submit(caller, typed("art.submit", decoded));
      case "art.cancel": {
        person(caller, method);
        return this.art.cancel(typed("art.cancel", decoded).artId);
      }
      default:
        throw new ArtError("UnknownMethod", `The host has no method ${method}.`);
    }
  }
}

export const isArtMethod = (method: string): boolean => method.startsWith("art.");
