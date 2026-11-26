import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { WorkshopError } from "@irudd/workshop/client";
import { AgentCredential, readJsonFile } from "@irudd/workshop/endpoint";
import { exit, UsageError, verbs as projectVerbs, type Context, type Verb } from "./commands.js";
import { runT3 } from "./t3.js";
import { buildId } from "./build.js";
import { steeringVerbs } from "./steering.js";
import { reviewVerbs } from "./review.js";
import { artVerbs } from "./art.js";
import { characterVerbs } from "./character.js";

const verbs: ReadonlyArray<Verb> = [
  ...projectVerbs,
  ...characterVerbs,
  ...steeringVerbs,
  ...reviewVerbs,
  ...artVerbs,
];

const global = {
  project: {
    type: "string",
    value: "dir",
    help: "Project directory (default: $IRUDD_PROJECT, or the current directory if it holds a project).",
  },
  credential: {
    type: "string",
    value: "file",
    help: "Act as the paired agent of this credential file (from irudd pair) instead of as yourself.",
  },
  json: { type: "boolean", help: "Print the host's reply as JSON." },
  help: { type: "boolean", short: "h", help: "Show help." },
} as const;

const unavailableTags = new Set([
  "HostUnavailable",
  "CredentialMissing",
  "CredentialRejected",
  "HostImpostor",
  "ConnectionLost",
]);

interface OptionHelp {
  readonly help: string;
  readonly value?: string;
  readonly short?: string;
}

function optionLines(options: Readonly<Record<string, OptionHelp>>): string[] {
  return Object.entries(options).map(([name, spec]) => {
    const value = spec.value ? ` <${spec.value}>` : "";
    const short = spec.short ? `-${spec.short}, ` : "";
    return `  ${`${short}--${name}${value}`.padEnd(30)} ${spec.help}`;
  });
}

function mainHelp(): string {
  const width = Math.max(...verbs.map((v) => `${v.name} ${v.args}`.length));
  return [
    "Usage: irudd <command> [options]",
    "",
    "Work on a character workshop project through the host that owns it.",
    "",
    "Running a project:",
    `  ${"host <dir> [--create]".padEnd(width)}  Own a project headlessly and serve it (see "irudd host --help")`,
    `  ${"mcp --credential <file>".padEnd(width)}  Run the MCP server for a paired agent, on stdio`,
    `  ${"t3 <connect|status|disconnect>".padEnd(width)}  Let steering reach a running T3 Code turn (see "irudd t3 --help")`,
    `  ${"version [--json]".padEnd(width)}  Print the build this CLI belongs to`,
    "",
    "Commands:",
    ...verbs.map((v) => `  ${`${v.name} ${v.args}`.trimEnd().padEnd(width)}  ${v.summary}`),
    "",
    "Options for every command:",
    ...optionLines(global),
    "",
    "Writes take --base (the revision you prepared the change against, or head) and",
    "--request-id (reuse it to retry safely). Exit codes: 0 ok, 2 usage, 3 host or",
    "credential unavailable, 4 rejected (nothing written), 5 host error.",
    "",
    "Start with: irudd host <dir> --create, then irudd status --project <dir>.",
  ].join("\n");
}

function verbHelp(verb: Verb): string {
  return [
    `Usage: irudd ${verb.name} ${verb.args}${Object.keys(verb.options).length > 0 ? " [options]" : ""}`.trimEnd(),
    "",
    verb.summary + ".",
    ...(verb.details ? ["", verb.details] : []),
    ...(Object.keys(verb.options).length > 0 ? ["", "Options:", ...optionLines(verb.options)] : []),
    "",
    "Global options:",
    ...optionLines(global),
  ].join("\n");
}

function resolveProject(option: string | undefined, credential: string | undefined): string {
  if (credential !== undefined) {
    const read = readJsonFile(credential, AgentCredential);
    if (read === undefined) throw new UsageError(`No agent credential at ${credential}.`);
    if (!read.ok) throw new UsageError(`${credential} is not an irudd agent credential.`);
    if (
      option !== undefined &&
      path.resolve(option).toLowerCase() !== path.resolve(read.value.project).toLowerCase()
    )
      throw new UsageError(`The credential is for ${read.value.project}, not ${option}.`);
    return read.value.project;
  }
  const named = option ?? process.env["IRUDD_PROJECT"];
  if (named) return path.resolve(named);
  if (fs.existsSync(path.join(process.cwd(), "workshop.sqlite"))) return process.cwd();
  throw new UsageError("Name the project with --project <dir>, or set IRUDD_PROJECT.");
}

async function run(
  argv: ReadonlyArray<string>,
  out: (text: string) => void,
  err: (text: string) => void,
): Promise<number> {
  const [name, ...rest] = argv;
  if (name === undefined || name === "help" || name === "--help" || name === "-h") {
    const topic = name === "help" ? verbs.find((v) => v.name === rest[0]) : undefined;
    out(topic ? verbHelp(topic) : mainHelp());
    return exit.ok;
  }
  if (name === "t3") return runT3(rest, out, err);
  if (name === "version") {
    const build = buildId();
    out(
      rest.includes("--json")
        ? JSON.stringify({
            build,
            node: process.versions.node,
            electron: process.versions["electron"] ?? null,
          })
        : `irudd ${build}`,
    );
    return exit.ok;
  }
  if (name === "host" || name === "mcp") {
    err(
      `irudd ${name} runs in its own process. Use the launcher (apps/cli/bin/irudd.cmd on Windows, apps/cli/bin/irudd elsewhere), which starts ${name === "host" ? "packages/workshop/src/host/main.ts" : "apps/mcp/src/main.ts"}.`,
    );
    return exit.usage;
  }
  const verb = verbs.find((v) => v.name === name);
  if (!verb) {
    err(`irudd: unknown command ${name}. Run "irudd help" for the list.`);
    return exit.usage;
  }
  let parsed;
  try {
    parsed = parseArgs({
      args: [...rest],
      allowPositionals: true,
      strict: true,
      options: { ...global, ...verb.options },
    });
  } catch (error) {
    err(
      `irudd ${verb.name}: ${error instanceof Error ? error.message : String(error)}\nRun "irudd ${verb.name} --help".`,
    );
    return exit.usage;
  }
  const values: Record<string, string | boolean | ReadonlyArray<string> | undefined> = {
    ...parsed.values,
  };
  if (values["help"] === true) {
    out(verbHelp(verb));
    return exit.ok;
  }
  const json = values["json"] === true;
  try {
    const projectOption = values["project"];
    const credentialOption = values["credential"];
    const credential =
      typeof credentialOption === "string" ? path.resolve(credentialOption) : undefined;
    const context: Context = {
      project: resolveProject(
        typeof projectOption === "string" ? projectOption : undefined,
        credential,
      ),
      credential,
      json,
      positionals: parsed.positionals,
      options: values,
      out,
      stateDir: process.env["IRUDD_STATE_DIR"],
    };
    return await verb.run(context);
  } catch (error) {
    if (error instanceof UsageError) {
      err(`irudd ${verb.name}: ${error.message}\nRun "irudd ${verb.name} --help".`);
      return exit.usage;
    }
    if (error instanceof WorkshopError) {
      if (json) out(JSON.stringify({ error: error.detail }, null, 2));
      err(`irudd ${verb.name}: ${error.message}`);
      return unavailableTags.has(error._tag) ? exit.unavailable : exit.error;
    }
    err(
      `irudd ${verb.name}: unexpected failure: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    );
    return exit.failed;
  }
}

const code = await run(
  process.argv.slice(2),
  (text) => process.stdout.write(text + "\n"),
  (text) => process.stderr.write(text + "\n"),
);
process.exitCode = code;
