// irudd-host: own one project headlessly and serve it to the CLI and MCP.
//
//   irudd host <project-dir> [--create] [--label <text>] [--durability full|normal] [--json]
//
// The process runs until Ctrl+C (SIGINT), SIGTERM or Ctrl+Break. While it
// runs no other process can open the project; clients connect to it instead.

import path from "node:path";
import { parseArgs } from "node:util";
import { loadForms, startHost, type FormStarter, type HostOptions } from "./index.js";

const usage = `Usage: irudd host <project-dir> [options]

Own a workshop project and serve it to the CLI, MCP agents and desktop
windows on this machine. Runs until Ctrl+C.

Options:
  --create              Create the project if the directory has none.
  --label <text>        Label for a new project (default: the directory name).
  --durability <mode>   full (default): every acknowledged commit survives power loss.
                        normal: faster; survives crashes, may lose the last commits on power loss.
  --forms <dir>         Offer prepared forms from this directory. The installed host
                        defaults to the form library shipped with its build.
  --agent-command <cmd> The irudd command steering messages tell agents to run
                        (default: $IRUDD_AGENT_COMMAND, set by the launcher, or irudd).
  --json                Print one JSON line when ready, for scripts.
  -h, --help            Show this help.

Next steps once it is serving:
  irudd status --project <dir>     who owns the project and who you are
  irudd pair <agent-id>            give an MCP agent a credential
`;

function fail(message: string, code = 2): never {
  process.stderr.write(`irudd host: ${message}\n`);
  process.exit(code);
}

interface HostCatalog {
  readonly formsDirectory: string;
  load(): Promise<Pick<HostOptions, "registry" | "starters" | "artTranslators" | "shippedArtwork">>;
}

/** Run the headless host with the catalog provided by its distribution. */
export async function runHeadless(catalog?: HostCatalog): Promise<void> {
  let parsed;
  try {
    parsed = parseArgs({
      allowPositionals: true,
      options: {
        create: { type: "boolean" },
        label: { type: "string" },
        durability: { type: "string" },
        forms: { type: "string" },
        "agent-command": { type: "string" },
        json: { type: "boolean" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (error) {
    fail(`${error instanceof Error ? error.message : String(error)}\n\n${usage}`);
  }
  const { values, positionals } = parsed;
  if (values.help) {
    process.stdout.write(usage);
    process.exit(0);
  }
  const directory = positionals[0] ?? process.env["IRUDD_PROJECT"];
  if (!directory || positionals.length > 1) fail(`give exactly one project directory.\n\n${usage}`);
  const durability = values.durability;
  if (durability !== undefined && durability !== "full" && durability !== "normal")
    fail(`--durability is full or normal, not ${durability}.`);

  const project = path.resolve(directory);
  const formsDirectory = values.forms ?? catalog?.formsDirectory;
  let forms: ReadonlyArray<FormStarter> = [];
  if (formsDirectory !== undefined) {
    try {
      const loaded = loadForms(path.resolve(formsDirectory));
      for (const problem of loaded.problems)
        process.stderr.write(`irudd host: skipped ${problem}
`);
      forms = loaded.forms;
    } catch (error) {
      fail(
        `cannot read forms from ${formsDirectory}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  const log = (line: string) => process.stderr.write(`[irudd host] ${line}\n`);

  let host;
  try {
    host = await startHost({
      path: project,
      ...(values.create ? { create: { label: values.label ?? path.basename(project) } } : {}),
      ...(durability === undefined ? {} : { durability }),
      ...(catalog ? await catalog.load() : {}),
      kind: "headless",
      forms,
      log,
      agentCommand: values["agent-command"] ?? process.env["IRUDD_AGENT_COMMAND"] ?? "irudd",
    });
  } catch (error) {
    const tag: unknown =
      typeof error === "object" && error !== null ? Reflect.get(error, "_tag") : undefined;
    const message = error instanceof Error ? error.message : String(error);
    if (tag === "ProjectLocked")
      fail(
        `another process already owns ${project}. Clients connect to that owner; run: irudd status --project "${project}"`,
        3,
      );
    if (tag === "ProjectMissing")
      fail(
        `there is no project in ${project}. Create one with: irudd host "${project}" --create --label "My project"`,
        3,
      );
    if (tag === "ProjectExists") fail(`${message}`, 3);
    fail(`${typeof tag === "string" ? `${tag}: ` : ""}${message}`, 1);
  }

  const ready = {
    ready: true,
    project: host.endpoint.project,
    projectId: host.project.info.projectId,
    label: host.project.info.label,
    address: host.endpoint.address,
    pid: process.pid,
    instance: host.endpoint.host.instance,
    person: host.human.id,
  };
  process.stdout.write(
    values.json
      ? JSON.stringify(ready) + "\n"
      : `Serving "${ready.label}" (${ready.project}) as person ${ready.person}.\nEndpoint ${ready.address}. Press Ctrl+C to stop.\n`,
  );

  let stopping = false;
  const stop = (signal: string) => {
    if (stopping) return;
    stopping = true;
    log(`${signal}: closing the project`);
    void host.close().then(
      () => process.exit(0),
      (error: unknown) => {
        process.stderr.write(`irudd host: close failed: ${String(error)}\n`);
        process.exit(1);
      },
    );
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));
  process.on("SIGBREAK", () => stop("SIGBREAK"));
}
