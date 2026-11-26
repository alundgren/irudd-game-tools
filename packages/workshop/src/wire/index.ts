// @irudd/workshop/wire: the typed frames and method table shared by the host,
// the CLI, MCP and desktop (including its renderer). Pure: no Node, no storage.
// Endpoint discovery and credential proofs are in `@irudd/workshop/endpoint`.
export * from "./protocol.js";
export * from "./steering.js";
export * from "./review.js";
export * from "./art.js";
