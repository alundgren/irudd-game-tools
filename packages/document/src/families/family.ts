// Shared machinery for character family features.
//
// A family feature is a versioned, schema-checked payload on a part or on the
// document. `family()` registers its definition and gives builders a typed
// reader, so no consumer handles a payload as untyped JSON.

import { Schema } from "effect";
import type { Vec3 } from "../geometry.js";
import type { Json, JsonObject } from "../json.js";
import {
  decodeWith,
  defineFeature,
  type FeatureDefinition,
  type FeatureReference,
} from "../registry.js";

export interface Family<S extends Schema.Decoder<unknown>> {
  readonly id: string;
  readonly version: number;
  readonly scope: "document" | "part";
  readonly definition: FeatureDefinition;
  readonly schema: S;
  /** The typed payload in `payloads`, or undefined when absent. Throws on an invalid payload. */
  readonly read: (payloads: JsonObject) => S["Type"] | undefined;
  /** The JSON payload for a typed value. */
  readonly json: (value: S["Type"]) => Json;
}

export function family<S extends Schema.Decoder<unknown>>(spec: {
  readonly id: string;
  readonly version: number;
  readonly scope: "document" | "part";
  readonly schema: S;
  readonly toJson: (value: S["Type"]) => Json;
  readonly upgrades?: ReadonlyArray<(payload: Json) => Json>;
  readonly childBasis?: (value: S["Type"], size: Vec3) => Vec3 | undefined;
  readonly references?: (value: S["Type"]) => ReadonlyArray<FeatureReference>;
}): Family<S> {
  const definition = defineFeature(spec);
  return {
    id: spec.id,
    version: spec.version,
    scope: spec.scope,
    definition,
    schema: spec.schema,
    read: (payloads) => {
      const payload = payloads[spec.id];
      if (payload === undefined) return undefined;
      const decoded = decodeWith(spec.schema, payload, [spec.id]);
      if (!decoded.ok)
        throw new Error(
          `Invalid ${spec.id} payload: ` + decoded.diagnostics.map((d) => d.message).join(" "),
        );
      return decoded.value;
    },
    json: spec.toJson,
  };
}

/** A finite number within the legacy editor's own bounds. */
export const bounded = (minimum: number, maximum: number) =>
  Schema.Finite.check(Schema.isBetween({ minimum, maximum }));

export const Vec3Between = (minimum: number, maximum: number) =>
  Schema.Tuple([bounded(minimum, maximum), bounded(minimum, maximum), bounded(minimum, maximum)]);

export const Hex = Schema.String.check(
  Schema.isPattern(/^#[0-9a-f]{6}$/, { message: "Use a lowercase #rrggbb colour." }),
);
