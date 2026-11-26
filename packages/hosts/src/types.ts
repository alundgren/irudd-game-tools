export type RecipientRoute =
  | {
      readonly transport: "t3-thread";
      readonly host: "t3";
      readonly environment: string;
      readonly project?: string;
      readonly conversation: string;
      readonly delivery?: "next-turn" | "mid-turn";
    }
  | {
      readonly transport: "claude-channel";
      readonly host: "claude-code";
      readonly environment: "local";
      readonly server: string;
      readonly instance: string;
      readonly conversation?: string;
    }
  | {
      readonly transport: "codex-queue";
      readonly host: "codex";
      readonly environment: "local";
      readonly conversation: string;
    }
  | {
      readonly transport: "inbox";
      readonly host: "t3" | "claude-code" | "codex";
      readonly environment: string;
      readonly conversation?: string;
    };

export type SteeringTransportName = RecipientRoute["transport"];

export interface HostReceipt {
  readonly transport: SteeringTransportName;
  readonly hostMessageId?: string;
  readonly runId?: string;
  readonly delivery?: string;
  readonly turn?: "mid-turn" | "next-turn" | "new-turn" | "restarted";
  readonly via?: string;
  readonly at: number;
}

export interface DeliveryRequest {
  readonly messageId: string;
  readonly agent: string;
  readonly route: RecipientRoute;
  readonly prompt: string;
  readonly meta: Readonly<Record<string, string>>;
}

export type DeliveryOutcome =
  | { readonly kind: "accepted"; readonly receipt: HostReceipt }
  | { readonly kind: "offline"; readonly detail: string }
  | { readonly kind: "rejected"; readonly detail: string }
  | { readonly kind: "unknown"; readonly detail: string };

export interface RouteCheck {
  readonly state: "ready" | "offline" | "gone" | "inbox-only";
  readonly push: boolean;
  readonly summary: string;
  readonly conversation: {
    readonly status?: string;
    readonly busy?: boolean;
    readonly provider?: string;
    readonly model?: string;
    readonly project?: string;
  } | null;
}

export interface SteeringTransport {
  readonly transport: SteeringTransportName;
  check(route: RecipientRoute): Promise<RouteCheck>;
  deliver(request: DeliveryRequest): Promise<DeliveryOutcome>;
}
