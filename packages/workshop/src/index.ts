// @irudd/workshop: the project service and its contract.
//
// Hosts (desktop, a headless service host) import this entry to open projects.
// Clients that only talk to a running service import `@irudd/workshop/contract`,
// which reaches no storage code.
export * from "./contract/index.js";
export { createProject, openProject, restoreProject } from "./service/project.js";
export { sniffMediaType, maxBlobBytes } from "./service/blobs.js";
