export {};

declare global {
  // MCP SDK 1.32.2 uses the Fetch spelling. Node types the same parameter on RequestInit.
  type HeadersInit = NonNullable<RequestInit["headers"]>;
}
