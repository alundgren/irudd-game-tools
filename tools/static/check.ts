import { spawn } from "node:child_process";
import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSync } from "@swc/core";
import { cruise } from "dependency-cruiser";
import {
  bundleProbes,
  bundledStyles,
  forbiddenOptions,
  graphRules,
  overridableBaseOptions,
  projects,
  strictFamily,
  type ProgramPolicy,
  type ProjectPolicy,
} from "./policy.ts";

interface Finding {
  readonly step: string;
  readonly message: string;
}

interface StepResult {
  readonly step: string;
  readonly ms: number;
  readonly findings: readonly Finding[];
  readonly notes: readonly string[];
}

interface ActiveProject {
  readonly policy: ProjectPolicy;
  readonly dir: string;
  readonly entries: readonly string[];
  readonly dependencies: readonly string[];
  readonly devDependencies: readonly string[];
}

interface Exception {
  readonly rule: string;
  readonly from: string;
  readonly to: string;
  readonly owner: string;
  readonly removal: string;
}

const toolRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const vp = join(toolRoot, "node_modules/vite-plus/bin/vp");
const defaultTsc = join(toolRoot, "node_modules/typescript/bin/tsc");
const readOnlyTsc = ["--noEmit", "--incremental", "false", "--composite", "false"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJson(file: string): unknown {
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  return parsed;
}

function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return value === undefined ? "?" : JSON.stringify(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function posix(path: string): string {
  return path.replaceAll("\\", "/");
}

function rel(root: string, file: string): string {
  return posix(relative(root, file));
}

function elapsed(start: number): number {
  return Math.round(performance.now() - start);
}

interface RunResult {
  readonly code: number;
  readonly output: string;
}

function run(args: readonly string[], cwd: string): Promise<RunResult> {
  return new Promise((done) => {
    const child = spawn(process.execPath, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.on("close", (code) => done({ code: code ?? 1, output }));
    child.on("error", (error) => done({ code: 1, output: String(error) }));
  });
}

const javascriptFile = /\.[cm]?jsx?$/;

function lines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
}

function workspaceDirs(root: string, findings: Finding[]): string[] {
  const file = join(root, "pnpm-workspace.yaml");
  if (!existsSync(file)) {
    findings.push({ step: "manifests", message: "pnpm-workspace.yaml is missing" });
    return [];
  }
  const patterns: string[] = [];
  let inPackages = false;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    if (/^packages:\s*$/.test(line)) {
      inPackages = true;
      continue;
    }
    if (inPackages) {
      const item = /^\s+-\s+["']?([^"'#]+?)["']?\s*$/.exec(line);
      if (item?.[1] !== undefined) patterns.push(item[1]);
      else if (/^\S/.test(line)) inPackages = false;
    }
  }
  const dirs: string[] = [];
  for (const pattern of patterns) {
    if (pattern.endsWith("/*") && !pattern.slice(0, -2).includes("*")) {
      const parent = join(root, pattern.slice(0, -2));
      if (!existsSync(parent)) continue;
      for (const name of readdirSync(parent).sort()) {
        if (existsSync(join(parent, name, "package.json")))
          dirs.push(posix(join(pattern.slice(0, -2), name)));
      }
    } else if (!pattern.includes("*")) {
      if (existsSync(join(root, pattern, "package.json"))) dirs.push(posix(pattern));
    } else {
      findings.push({ step: "manifests", message: `unsupported workspace pattern "${pattern}"` });
    }
  }
  return dirs;
}

function exportTargets(value: unknown, out: string[]): void {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const item of value) exportTargets(item, out);
  else if (isRecord(value)) for (const item of Object.values(value)) exportTargets(item, out);
}

const rootDependencies = new Set([
  "@ast-grep/cli",
  "three",
  "@swc/core",
  "@types/node",
  "dependency-cruiser",
  "esbuild",
  "oxlint-tsgolint",
  "typescript",
  "vite-plus",
]);

const dependencyFields = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

function checkDependencySpecs(
  manifest: Record<string, unknown>,
  where: string,
  findings: Finding[],
): void {
  if ("imports" in manifest)
    findings.push({
      step: "manifests",
      message: `${where}: package imports maps are outside the checked module graph`,
    });
  for (const field of dependencyFields) {
    const deps = manifest[field];
    if (deps === undefined) continue;
    if (!isRecord(deps)) {
      findings.push({ step: "manifests", message: `${where}: ${field} is not an object` });
      continue;
    }
    for (const [name, spec] of Object.entries(deps)) {
      if (where === "package.json" && !rootDependencies.has(name))
        findings.push({
          step: "manifests",
          message: `package.json: ${name} is outside the root dependency policy`,
        });
      const ok = name.startsWith("@irudd/") ? spec === "workspace:*" : spec === "catalog:";
      if (!ok) {
        findings.push({
          step: "manifests",
          message: `${where}: ${field}.${name} is ${JSON.stringify(spec)}; use ${name.startsWith("@irudd/") ? '"workspace:*"' : '"catalog:"'} so the pin lives in the workspace catalog`,
        });
      }
    }
  }
}

function discover(root: string): { active: ActiveProject[]; result: StepResult } {
  const start = performance.now();
  const findings: Finding[] = [];
  const notes: string[] = [];
  const active: ActiveProject[] = [];
  const byDir = new Map(projects.map((project) => [project.dir, project]));
  const workspace = new Set(workspaceDirs(root, findings));

  const rootManifest = readJson(join(root, "package.json"));
  if (isRecord(rootManifest)) checkDependencySpecs(rootManifest, "package.json", findings);

  for (const dir of workspace) {
    if (!byDir.has(dir)) {
      findings.push({
        step: "manifests",
        message: `${dir} is a workspace package with no static policy; add it to tools/static/policy.ts`,
      });
    }
  }

  for (const policy of projects) {
    const dir = join(root, policy.dir);
    const isWorkspacePackage = workspace.has(policy.dir);
    if (!existsSync(dir)) {
      if (policy.status === "required") {
        findings.push({ step: "manifests", message: `required project ${policy.dir} is missing` });
      }
      continue;
    }
    if (policy.name !== undefined && !isWorkspacePackage) {
      findings.push({
        step: "manifests",
        message: `${policy.dir} exists but is not a workspace package (package.json and pnpm-workspace.yaml)`,
      });
      continue;
    }

    const entries = [
      ...(policy.entries ?? []),
      ...policy.programs.flatMap((program) => program.entries ?? []),
    ].map((entry) => posix(join(policy.dir, entry)));
    let dependencies = policy.dependencies;
    let devDependencies = policy.devDependencies;
    if (isWorkspacePackage) {
      const manifest = readJson(join(dir, "package.json"));
      if (!isRecord(manifest)) {
        findings.push({
          step: "manifests",
          message: `${policy.dir}/package.json is not an object`,
        });
        continue;
      }
      if (manifest["name"] !== policy.name) {
        findings.push({
          step: "manifests",
          message: `${policy.dir}/package.json name is ${JSON.stringify(manifest["name"])}; policy expects ${policy.name ?? "(none)"}`,
        });
      }
      if (manifest["type"] !== "module") {
        findings.push({
          step: "manifests",
          message: `${policy.dir}/package.json must set "type": "module"`,
        });
      }
      checkDependencySpecs(manifest, `${policy.dir}/package.json`, findings);
      const allowedByField: readonly (readonly [string, readonly string[]])[] = [
        ["dependencies", policy.dependencies],
        ["devDependencies", policy.devDependencies],
        ["peerDependencies", []],
        ["optionalDependencies", []],
      ];
      for (const [field, allowed] of allowedByField) {
        const deps = manifest[field];
        if (!isRecord(deps)) continue;
        for (const name of Object.keys(deps)) {
          if (!allowed.includes(name)) {
            findings.push({
              step: "manifests",
              message: `${policy.dir}: ${field}.${name} is not allowed for role ${policy.role} (policy allows ${allowed.join(", ") || "none"})`,
            });
          }
        }
      }
      dependencies = isRecord(manifest["dependencies"])
        ? Object.keys(manifest["dependencies"])
        : [];
      devDependencies = isRecord(manifest["devDependencies"])
        ? Object.keys(manifest["devDependencies"])
        : [];
      const targets: string[] = [];
      exportTargets(manifest["exports"], targets);
      exportTargets(manifest["bin"], targets);
      if (policy.bundledMain !== undefined) {
        if (manifest["main"] !== policy.bundledMain.output)
          findings.push({
            step: "manifests",
            message: `${policy.dir}: main must point to ${policy.bundledMain.output}`,
          });
        targets.push(policy.bundledMain.source);
      } else if (typeof manifest["main"] === "string") targets.push(manifest["main"]);
      for (const target of targets) {
        const file = resolve(dir, target);
        const inside = !relative(dir, file).startsWith("..") && !isAbsolute(relative(dir, file));
        if (!inside || !existsSync(file)) {
          findings.push({
            step: "manifests",
            message: `${policy.dir}: entry ${target} does not exist in the package`,
          });
        } else {
          entries.push(rel(root, file));
        }
      }
    }
    for (const entry of entries) {
      if (!existsSync(join(root, entry))) {
        findings.push({
          step: "manifests",
          message: `${policy.dir}: entry ${entry} does not exist`,
        });
      }
    }
    const unique = [...new Set(entries)].filter((entry) => existsSync(join(root, entry)));
    const transitional = new Set(
      policy.programs.flatMap((program) =>
        (program.javascript?.files ?? []).map((file) => posix(join(policy.dir, file))),
      ),
    );
    for (const entry of unique) {
      if (javascriptFile.test(entry) && !transitional.has(entry)) {
        findings.push({
          step: "manifests",
          message: `${policy.dir}: shipped entry ${entry} is JavaScript, which tsc does not check; ship TypeScript or list it in a program's javascript exemption`,
        });
      }
    }
    if (unique.length === 0) {
      findings.push({
        step: "manifests",
        message: `${policy.dir} has no shipped entries (package.json exports/bin or policy entries); an empty graph cannot pass`,
      });
    }
    active.push({ policy, dir: policy.dir, entries: unique, dependencies, devDependencies });
    notes.push(
      `${policy.dir} (${policy.role}): ${unique.length} entr${unique.length === 1 ? "y" : "ies"}`,
    );
  }
  return { active, result: { step: "manifests", ms: elapsed(start), findings, notes } };
}

async function format(root: string, write: boolean): Promise<StepResult> {
  const start = performance.now();
  const findings: Finding[] = [];
  const notes: string[] = [];
  if (write) {
    const written = await run([vp, "fmt", "."], root);
    if (written.code !== 0)
      findings.push({ step: "format", message: `vp fmt failed\n${written.output}` });
  }
  const checked = await run([vp, "fmt", "--check", "."], root);
  const count = /on (\d+) files?/.exec(checked.output);
  if (checked.code !== 0) {
    for (const line of lines(checked.output)) {
      if (/^\S.*\(\d+ms\)$/.test(line)) {
        findings.push({
          step: "format",
          message: `${line.replace(/ \(\d+ms\)$/, "")} is not Oxfmt-formatted`,
        });
      }
    }
    if (findings.length === 0) findings.push({ step: "format", message: checked.output.trim() });
  } else if (count?.[1] === undefined || Number(count[1]) === 0) {
    findings.push({ step: "format", message: `Oxfmt checked no files\n${checked.output}` });
  } else {
    notes.push(`${count[1]} files formatted`);
  }
  return { step: "format", ms: elapsed(start), findings, notes };
}

async function lint(root: string): Promise<StepResult> {
  const start = performance.now();
  const findings: Finding[] = [];
  const notes: string[] = [];
  const result = await run([vp, "lint", "--format", "json", "."], root);
  const json = result.output.slice(result.output.indexOf("{"));
  let report: unknown;
  try {
    report = JSON.parse(json);
  } catch {
    findings.push({
      step: "lint",
      message: result.output.trim() || `vp lint exited ${result.code}`,
    });
  }
  if (isRecord(report)) {
    const files = Number(report["number_of_files"] ?? 0);
    const diagnostics = Array.isArray(report["diagnostics"])
      ? report["diagnostics"].filter(isRecord)
      : [];
    for (const diagnostic of diagnostics) {
      const labels = Array.isArray(diagnostic["labels"])
        ? diagnostic["labels"].filter(isRecord)
        : [];
      const span = isRecord(labels[0]?.["span"]) ? labels[0]["span"] : {};
      const at = `${text(diagnostic["filename"])}:${text(span["line"])}:${text(span["column"])}`;
      findings.push({
        step: "lint",
        message: `${at}: ${text(diagnostic["code"])} ${text(diagnostic["message"])}`.trim(),
      });
    }
    if (files === 0) findings.push({ step: "lint", message: "Oxlint checked no files" });
    notes.push(`${files} files, ${String(report["number_of_rules"])} rules`);
  }
  if (result.code !== 0 && findings.length === 0) {
    findings.push({ step: "lint", message: `vp lint exited ${result.code}\n${result.output}` });
  }
  return { step: "lint", ms: elapsed(start), findings, notes };
}

function programDirsPresent(root: string, project: ActiveProject, program: ProgramPolicy): boolean {
  if (program.tsconfig === "tsconfig.json") return true;
  return existsSync(join(root, project.dir, dirname(program.tsconfig)));
}

async function typecheck(
  root: string,
  active: readonly ActiveProject[],
  tsc: string,
  files: readonly string[],
): Promise<StepResult> {
  const start = performance.now();
  const findings: Finding[] = [];
  const notes: string[] = [];
  const projectByName = new Map(
    active.flatMap((project) =>
      project.policy.name === undefined ? [] : [[project.policy.name, project] as const],
    ),
  );
  const invariants = baseInvariants(root, findings);
  const checked = new Set<string>();

  const jobs = active.flatMap((project) =>
    project.policy.programs
      .filter((program) => programDirsPresent(root, project, program))
      .map(async (program) => {
        const tsconfig = posix(join(project.dir, program.tsconfig));
        const where = `${tsconfig}`;
        if (!existsSync(join(root, tsconfig))) {
          findings.push({ step: "types", message: `${where} is missing` });
          return;
        }
        const shown = await run([tsc, "-p", tsconfig, "--showConfig"], root);
        let options: Record<string, unknown> | undefined;
        try {
          const parsed: unknown = JSON.parse(shown.output);
          if (isRecord(parsed) && isRecord(parsed["compilerOptions"]))
            options = parsed["compilerOptions"];
        } catch {
          options = undefined;
        }
        if (shown.code !== 0 || options === undefined) {
          findings.push({
            step: "types",
            message: `${where}: tsc --showConfig exited ${shown.code}\n${shown.output}`,
          });
          return;
        }
        const optionFindings: Finding[] = [];
        checkOptions(where, project.policy.role, program, options, invariants, optionFindings);
        if (optionFindings.length > 0) {
          findings.push(...optionFindings);
          return;
        }
        const compiled = await run(
          [
            tsc,
            "-p",
            tsconfig,
            "--listFiles",
            "--pretty",
            "false",
            ...readOnlyTsc,
            ...(program.skipLibCheck?.allowedDiagnostic ? ["--skipLibCheck", "false"] : []),
            "--libReplacement",
            "false",
          ],
          root,
        );

        const programFiles: string[] = [];
        const diagnostics: string[] = [];
        for (const line of lines(compiled.output)) {
          const absolute =
            /^([A-Za-z]:)?\//.test(posix(line)) &&
            /\.[cm]?[jt]sx?$/.test(line) &&
            !line.includes("): error");
          const last = diagnostics.length - 1;
          if (absolute) programFiles.push(posix(line));
          else if (/^\s/.test(line) && last >= 0)
            diagnostics[last] = `${diagnostics[last] ?? ""}\n${line}`;
          else diagnostics.push(line);
        }
        const allowed = program.skipLibCheck?.allowedDiagnostic;
        let allowedCount = 0;
        for (const message of diagnostics) {
          if (allowed?.test(posix(message))) allowedCount++;
          else findings.push({ step: "types", message });
        }
        if (compiled.code !== 0 && diagnostics.length === 0) {
          findings.push({
            step: "types",
            message: `${where}: tsc exited ${compiled.code} without a readable diagnostic; run tsc -p ${tsconfig} directly`,
          });
        }
        if (programFiles.length === 0) {
          findings.push({ step: "types", message: `${where}: tsc listed no program files` });
        }
        const loaded = inspectProgram(
          root,
          project,
          program,
          where,
          programFiles,
          projectByName,
          findings,
        );
        for (const file of loaded) checked.add(file);
        const exception = allowedCount ? `, ${allowedCount} allowed dependency diagnostics` : "";
        notes.push(
          `${where}: ${programFiles.length} program files, tsc exit ${compiled.code}${exception}`,
        );
      }),
  );
  await Promise.all(jobs);
  for (const file of files) {
    const local = rel(root, file);
    if (!sourceExtension.test(local) || checked.has(local)) continue;
    const owner = active.find((project) => local.startsWith(`${project.dir}/`));
    if (owner === undefined) continue;
    findings.push({
      step: "types",
      message: javascriptFile.test(local)
        ? `${local} is JavaScript outside every tsconfig program of ${owner.dir}; write TypeScript and include it, or list it in a javascript exemption`
        : `${local} is outside every tsconfig program of ${owner.dir}, so tsc never checks it; include it in a program`,
    });
  }
  return { step: "types", ms: elapsed(start), findings, notes: notes.sort() };
}

function baseInvariants(
  root: string,
  findings: Finding[],
): readonly (readonly [string, unknown])[] {
  let parsed: unknown;
  try {
    parsed = readJson(join(root, "tsconfig.base.json"));
  } catch {
    parsed = undefined;
  }
  if (!isRecord(parsed) || !isRecord(parsed["compilerOptions"])) {
    findings.push({
      step: "types",
      message: "tsconfig.base.json must exist as plain JSON with compilerOptions",
    });
    return [];
  }
  return Object.entries(parsed["compilerOptions"]).filter(
    ([option]) => !overridableBaseOptions.includes(option),
  );
}

function sameOption(actual: unknown, expected: unknown): boolean {
  if (typeof actual === "string" && typeof expected === "string")
    return actual.toLowerCase() === expected.toLowerCase();
  return JSON.stringify(actual) === JSON.stringify(expected);
}

const compilerOptions = new Set([
  ...overridableBaseOptions,
  ...strictFamily,
  "target",
  "module",
  "moduleResolution",
  "moduleDetection",
  "verbatimModuleSyntax",
  "erasableSyntaxOnly",
  "resolveJsonModule",
  "isolatedModules",
  "noEmit",
  "strict",
  "exactOptionalPropertyTypes",
  "noUncheckedIndexedAccess",
  "noImplicitOverride",
  "noImplicitReturns",
  "noFallthroughCasesInSwitch",
  "noPropertyAccessFromIndexSignature",
  "noUnusedLocals",
  "noUnusedParameters",
  "allowUnreachableCode",
  "allowUnusedLabels",
  "forceConsistentCasingInFileNames",
  "preserveConstEnums",
  "allowJs",
  "checkJs",
]);

const aliasHint = "aliases are not allowed; import workspace packages by name";
const buildStateHint = "writes build state; the check is read-only";
const optionHints: Readonly<Record<string, string>> = {
  paths: aliasHint,
  baseUrl: aliasHint,
  rootDirs: aliasHint,
  customConditions: "changes resolution away from the graph's conditions",
  incremental: buildStateHint,
  composite: buildStateHint,
  tsBuildInfoFile: buildStateHint,
  noCheck: "skips type checking",
  skipDefaultLibCheck: "skips checking declarations",
  noLib: "replaces the policy's lib",
  noResolve: "hides imported files from the program",
  allowUmdGlobalAccess: "widens globals",
  typeRoots: "widens ambient declarations",
};

function checkOptions(
  where: string,
  role: string,
  program: ProgramPolicy,
  options: Record<string, unknown>,
  invariants: readonly (readonly [string, unknown])[],
  findings: Finding[],
): void {
  const add = (message: string): void => {
    findings.push({ step: "types", message: `${where}: ${message}` });
  };
  for (const name of Object.keys(options)) {
    if (!compilerOptions.has(name) && !forbiddenOptions.includes(name))
      add(`${name} is outside the read-only compiler option policy`);
  }
  const lib = stringArray(options["lib"]);
  const types = stringArray(options["types"]);
  if (lib.length === 0) add("set an explicit lib");
  for (const entry of lib) {
    if (!program.lib.test(entry))
      add(`lib "${entry}" is not allowed for ${role} (${String(program.lib)})`);
  }
  if (!Array.isArray(options["types"])) add("set an explicit types array");
  const expected = [...program.types].sort().join(",");
  if ([...types].sort().join(",") !== expected) {
    add(`types ${JSON.stringify(types)} must be ${JSON.stringify(program.types)}`);
  }
  for (const [option, value] of invariants) {
    if (!sameOption(options[option], value)) {
      const actual = options[option] === undefined ? "unset" : JSON.stringify(options[option]);
      add(
        `${option} must stay ${JSON.stringify(value)} from tsconfig.base.json (effective ${actual})`,
      );
    }
  }
  for (const flag of strictFamily) {
    if (options[flag] === false) add(`${flag} false weakens strict; remove the override`);
  }
  for (const option of forbiddenOptions) {
    const value = options[option];
    if (value !== undefined && value !== false)
      add(`${option} ${optionHints[option] ?? "is not allowed"}`);
  }
  if (options["skipLibCheck"] === true && program.skipLibCheck === undefined)
    add("skipLibCheck needs a recorded policy exception");
  if (options["skipLibCheck"] !== true && program.skipLibCheck !== undefined)
    add("remove the unused skipLibCheck exception from policy.ts");
  const javascript = options["allowJs"] === true || options["checkJs"] === true;
  if (javascript && program.javascript === undefined) {
    add("allowJs/checkJs needs a transitional javascript exemption in policy.ts naming the files");
  } else if (javascript && (options["allowJs"] !== true || options["checkJs"] !== true)) {
    add("transitional JavaScript needs both allowJs and checkJs");
  } else if (!javascript && program.javascript !== undefined) {
    add("remove the unused javascript exemption from policy.ts");
  }
}

const libFile =
  /\/(?:typescript|@typescript\/typescript-[^/]+)\/lib\/lib(?:\.([a-z0-9.]+))?\.d\.ts$/;
const declarationFile = /\.d(\.[a-z0-9]+)?\.[cm]?ts$/;

function inspectProgram(
  root: string,
  project: ActiveProject,
  program: ProgramPolicy,
  where: string,
  files: readonly string[],
  projectByName: ReadonlyMap<string, ActiveProject>,
  findings: Finding[],
): ReadonlySet<string> {
  const add = (message: string): void => {
    findings.push({ step: "types", message: `${where}: ${message}` });
  };
  const allowsNode = program.ambient === "node" || program.ambient === "node+dom";
  const pure = program.ambient === "none";
  const rootReal = posix(realpathSync(root));
  const allowedDirs = new Set([project.dir]);
  const pending = new Set([...project.dependencies, ...project.devDependencies]);
  for (const name of pending) {
    const dependency = projectByName.get(name);
    if (dependency === undefined) continue;
    allowedDirs.add(dependency.dir);
    for (const transitive of dependency.dependencies) pending.add(transitive);
  }
  const transitional = new Set(
    (program.javascript?.files ?? []).map((file) => posix(join(project.dir, file))),
  );
  const loaded = new Set<string>();
  for (const file of files) {
    const lower = file.toLowerCase();
    if (!allowsNode && lower.includes("/@types/node/")) {
      add(`Node declarations leak into the program (${file})`);
    } else if (pure && lower.includes("/node_modules/@types/")) {
      add(`ambient @types declarations leak into the program (${file})`);
    }
    const lib = libFile.exec(lower);
    if (lib !== null) {
      const name = lib[1];
      if (name === undefined)
        add(`the default lib.d.ts (ES5, DOM and host) leaks into the program (${file})`);
      else if (!program.lib.test(name) && !/^decorators(\.legacy)?$/.test(name))
        add(`lib "${name}" leaks into the program (${file}); allowed: ${String(program.lib)}`);
      continue;
    }
    if (lower.includes("/node_modules/")) continue;
    const local = posix(relative(rootReal, file));
    if (local.startsWith("..")) continue;
    loaded.add(local);
    const owner = projects.find((candidate) => local.startsWith(`${candidate.dir}/`));
    if (owner !== undefined && !allowedDirs.has(owner.dir)) {
      add(`loads ${local} from ${owner.dir}, which is not a declared dependency`);
    }
    if (javascriptFile.test(local) && !transitional.has(local)) {
      add(`loads first-party JavaScript ${local}; write TypeScript or list it in an exemption`);
    }
    if (pure && declarationFile.test(local)) {
      add(`${local} is a first-party declaration file; pure programs declare nothing ambient`);
    } else if (pure && /\.[cm]?tsx?$/.test(local)) {
      for (const declaration of ambientDeclarations(file)) add(`${local}: ${declaration}`);
    }
  }
  for (const file of transitional) {
    if (!loaded.has(file))
      add(`javascript exemption lists ${file}, which the program does not load`);
  }
  {
    const assignedEntries =
      program.entries?.map((entry) => posix(join(project.dir, entry))) ??
      (program.tsconfig === "tsconfig.json" ? project.entries : []);
    for (const entry of assignedEntries) {
      if (bundledStyles.has(entry)) continue;
      if (!loaded.has(entry)) add(`shipped entry ${entry} is not type-checked by this program`);
    }
  }
  return loaded;
}

function ambientDeclarations(file: string): string[] {
  let parsed: ReturnType<typeof parseSync>;
  try {
    parsed = parseSync(readFileSync(file, "utf8"), {
      syntax: "typescript",
      tsx: file.endsWith("x"),
    });
  } catch (error) {
    return [`cannot be parsed for ambient declarations (${String(error)})`];
  }
  const out: string[] = [];
  for (const item of parsed.body) {
    const declaration = item.type === "ExportDeclaration" ? item.declaration : item;
    if (declaration.type !== "TsModuleDeclaration") continue;
    if (declaration.global) {
      out.push("declare global adds ambient globals; pass platform capabilities in instead");
    } else if (declaration.id.type === "StringLiteral") {
      out.push(
        `declare module "${declaration.id.value}" is an ambient module or augmentation; import the real module`,
      );
    }
  }
  return out;
}

const sourceExtension = /\.(ts|mts|cts|tsx|js|mjs|cjs|jsx)$/;

const localConfig =
  /^(\.(git|prettier|eslint|oxlint|oxfmt)?ignore|\.?(oxlintrc|oxfmtrc|prettierrc|eslintrc)(\..+)?|\.editorconfig|(vite|vitest|oxlint|oxfmt|eslint|prettier)\.config\.[cm]?[jt]s)$/;

const guardedRules = new Set([
  "ban-ts-comment",
  "triple-slash-reference",
  "no-dynamic-require",
  "no-restricted-properties",
  "no-eval",
  "no-new-func",
  "no-implied-eval",
]);

function walk(dir: string, out: string[], buildOutputs: readonly string[] = []): void {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git") continue;
    const path = join(dir, name);
    if (buildOutputs.includes(path)) continue;
    if (statSync(path).isDirectory()) walk(path, out, buildOutputs);
    else out.push(path);
  }
}

function escapes(root: string, files: readonly string[]): StepResult {
  const start = performance.now();
  const findings: Finding[] = [];
  let count = 0;
  const sources = files.filter((file) => sourceExtension.test(file));
  for (const file of sources) {
    const text = readFileSync(file, "utf8").split(/\r?\n/);
    text.forEach((line, index) => {
      const directive = /(?:oxlint|eslint)-disable(?<kind>-next-line|-line)?(?<rest>[^*\n]*)/.exec(
        line,
      );
      if (directive === null) return;
      count += 1;
      const where = `${rel(root, file)}:${index + 1}`;
      const add = (message: string): void => {
        findings.push({ step: "escapes", message: `${where}: ${message}` });
      };
      const [names = "", reason = ""] = (directive.groups?.["rest"] ?? "").split(" -- ");
      const rules = names
        .split(",")
        .map((rule) => rule.trim())
        .filter((rule) => rule.length > 0);
      if (directive.groups?.["kind"] === undefined)
        add("file- and block-wide disables are not allowed; use -next-line or -line");
      if (rules.length === 0) add("name the exact rule being disabled");
      if (rules.length > 1) add(`name exactly one rule per escape (found ${rules.join(", ")})`);
      for (const rule of rules) {
        if (guardedRules.has(rule.slice(rule.lastIndexOf("/") + 1)))
          add(`${rule} guards the type and graph checks and cannot be disabled`);
      }
      if (reason.trim().length < 10)
        add('explain the exception after " -- " (owner and removal condition)');
    });
  }
  return {
    step: "escapes",
    ms: elapsed(start),
    findings,
    notes: [`${sources.length} source files scanned, ${count} lint escapes`],
  };
}

async function coverage(root: string, files: readonly string[]): Promise<StepResult> {
  const start = performance.now();
  const findings: Finding[] = [];
  const listed = await run([vp, "lint", "--debug=files", "."], root);
  const linted = new Set(lines(listed.output).map(posix));
  if (listed.code !== 0 || linted.size === 0) {
    findings.push({
      step: "coverage",
      message: `vp lint --debug=files exited ${listed.code}\n${listed.output}`,
    });
  }
  for (const name of [".prettierignore", ".ignore", ".eslintignore", ".oxlintignore"]) {
    if (existsSync(join(root, name))) {
      findings.push({
        step: "coverage",
        message: `${name}: tool-specific ignore files are not allowed; use the lists in vite.config.ts`,
      });
    }
  }
  let sources = 0;
  for (const file of files) {
    const local = rel(root, file);
    if (localConfig.test(basename(file))) {
      findings.push({
        step: "coverage",
        message: `${local}: package-local lint, format or ignore configuration is not allowed; configure the root vite.config.ts`,
      });
    } else if (sourceExtension.test(file)) {
      sources += 1;
      if (linted.size > 0 && !linted.has(local)) {
        findings.push({
          step: "coverage",
          message: `${local} is hidden from lint and format by an ignore rule (.gitignore, Git excludes or ignorePatterns)`,
        });
      }
    }
  }
  return {
    step: "coverage",
    ms: elapsed(start),
    findings,
    notes: [`${sources} project sources, ${linted.size} files selected by lint`],
  };
}

function loadExceptions(root: string, findings: Finding[]): Exception[] {
  const file = join(root, "tools/static/exceptions.json");
  if (!existsSync(file)) return [];
  const parsed = readJson(file);
  if (!Array.isArray(parsed)) {
    findings.push({ step: "graph", message: "tools/static/exceptions.json must be an array" });
    return [];
  }
  const out: Exception[] = [];
  for (const item of parsed) {
    if (!isRecord(item)) continue;
    const { rule, from, to, owner, removal } = item;
    if (
      typeof rule === "string" &&
      typeof from === "string" &&
      typeof to === "string" &&
      typeof owner === "string" &&
      typeof removal === "string" &&
      owner.length > 0 &&
      removal.length > 0
    ) {
      out.push({ rule, from, to, owner, removal });
    } else {
      findings.push({
        step: "graph",
        message: `exception ${JSON.stringify(item)} needs exact rule, from, to, owner and removal`,
      });
    }
  }
  return out;
}

async function graph(root: string, active: readonly ActiveProject[]): Promise<StepResult> {
  const start = performance.now();
  const findings: Finding[] = [];
  const notes: string[] = [];
  const exceptions = loadExceptions(root, findings);
  const entries = active.flatMap((project) => project.entries);
  if (entries.length === 0) {
    findings.push({
      step: "graph",
      message: "no shipped entries to cruise; an empty graph cannot pass",
    });
    return { step: "graph", ms: elapsed(start), findings, notes };
  }
  const previous = process.cwd();
  process.chdir(root);
  let output: unknown;
  try {
    const result = await cruise(entries, {
      validate: true,
      ruleSet: { forbidden: graphRules.map((rule) => ({ ...rule })) },
      parser: "swc",
      tsPreCompilationDeps: true,
      combinedDependencies: false,
      preserveSymlinks: false,
      doNotFollow: { path: "node_modules" },
      enhancedResolveOptions: {
        exportsFields: ["exports"],
        conditionNames: ["import", "types", "node", "default"],
        mainFields: ["module", "main", "types"],
      },
    });
    output = result.output;
  } finally {
    process.chdir(previous);
  }
  if (!isRecord(output)) {
    findings.push({ step: "graph", message: "dependency-cruiser returned no result" });
    return { step: "graph", ms: elapsed(start), findings, notes };
  }
  const modules = Array.isArray(output["modules"]) ? output["modules"].filter(isRecord) : [];
  const sources = new Set(modules.map((module) => String(module["source"])));
  for (const project of active) {
    const own = [...sources].filter((source) => source.startsWith(`${project.dir}/`));
    const missing = project.entries.filter((entry) => !sources.has(entry));
    for (const entry of missing)
      findings.push({ step: "graph", message: `entry ${entry} is missing from the graph` });
    notes.push(`${project.dir}: ${own.length} modules from ${project.entries.length} entries`);
    if (own.length === 0)
      findings.push({ step: "graph", message: `${project.dir}: graph is empty` });
  }
  for (const module of modules) {
    const source = module["source"];
    if (typeof source !== "string" || !Array.isArray(module["dependencies"])) continue;
    const owner = active.find((candidate) => source.startsWith(candidate.dir + "/"));
    if (owner === undefined) continue;
    for (const edge of module["dependencies"].filter(isRecord)) {
      const target = edge["resolved"];
      if (typeof target !== "string") continue;
      const dependency = active.find((candidate) => target.startsWith(candidate.dir + "/"));
      const name = dependency?.policy.name;
      if (dependency === owner || name === undefined) continue;
      if (!owner.dependencies.includes(name) && !owner.devDependencies.includes(name)) {
        findings.push({
          step: "graph",
          message: `undeclared-workspace-import: ${source} imports ${target} without declaring ${name}`,
        });
      }
    }
  }
  const summary = isRecord(output["summary"]) ? output["summary"] : {};
  const violations = Array.isArray(summary["violations"])
    ? summary["violations"].filter(isRecord)
    : [];
  const used = new Set<Exception>();
  for (const violation of violations) {
    const rule = isRecord(violation["rule"]) ? String(violation["rule"]["name"]) : "?";
    const from = String(violation["from"]);
    const to = String(violation["to"]);
    const exception = exceptions.find(
      (item) => item.rule === rule && item.from === from && item.to === to,
    );
    if (exception !== undefined) {
      used.add(exception);
      continue;
    }
    const via = Array.isArray(violation["via"])
      ? violation["via"].map((step) => (isRecord(step) ? String(step["name"]) : String(step)))
      : [];
    const comment = graphRules.find((item) => item.name === rule)?.comment ?? "";
    findings.push({
      step: "graph",
      message: `${rule}: ${from} → ${to}${via.length > 0 ? ` (via ${via.join(" → ")})` : ""}. ${comment}`,
    });
  }
  for (const exception of exceptions) {
    if (!used.has(exception)) {
      findings.push({
        step: "graph",
        message: `stale exception ${exception.rule}: ${exception.from} → ${exception.to} (owner ${exception.owner}); remove it`,
      });
    }
  }
  notes.push(
    `${modules.length} modules, ${violations.length} raw violations, ${used.size} scoped exceptions used`,
  );
  notes.push(
    `pnpm check:bundles checks ${bundleProbes.length} outputs after the desktop and offline player builds.`,
  );
  return { step: "graph", ms: elapsed(start), findings, notes };
}

interface Args {
  readonly root: string;
  readonly write: boolean;
  readonly tsc: string;
  readonly json?: string;
}

function parseArgs(argv: readonly string[]): Args {
  let root = toolRoot;
  let write = false;
  let tsc = defaultTsc;
  let json: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root") root = resolve(argv[++index] ?? ".");
    else if (arg === "--write-format") write = true;
    else if (arg === "--tsc") tsc = resolve(argv[++index] ?? defaultTsc);
    else if (arg === "--json") json = resolve(argv[++index] ?? "static-check.json");
    else throw new Error(`unknown argument ${arg ?? ""}`);
  }
  return json === undefined ? { root, write, tsc } : { root, write, tsc, json };
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const start = performance.now();
  const { active, result: manifests } = discover(args.root);
  const written = args.write ? await format(args.root, true) : undefined;
  const files: string[] = [];
  for (const project of active) {
    const dir = join(args.root, project.dir);
    const built = project.dir === "apps/desktop" || project.dir === "apps/player";
    const buildOutputs = built ? [join(dir, "dist")] : [];
    if (project.dir === "apps/desktop") buildOutputs.push(join(dir, "qa", "dist"));
    walk(dir, files, buildOutputs);
  }
  const [formatted, linted, covered, typed, graphed] = await Promise.all([
    written ?? format(args.root, false),
    lint(args.root),
    coverage(args.root, files),
    typecheck(args.root, active, args.tsc, files),
    graph(args.root, active),
  ]);
  const scanned = escapes(args.root, files);
  const results = [manifests, formatted, linted, covered, typed, graphed, scanned];
  const total = elapsed(start);

  for (const result of results) {
    const status = result.findings.length === 0 ? "ok  " : "FAIL";
    console.log(
      `${status} ${result.step.padEnd(9)} ${String(result.ms).padStart(5)} ms  ${result.notes.join("; ")}`,
    );
    for (const finding of result.findings)
      console.log(`     ${finding.message.replaceAll("\n", "\n     ")}`);
  }
  const failures = results.reduce((sum, result) => sum + result.findings.length, 0);
  console.log(
    `${failures === 0 ? "static check passed" : `static check failed: ${failures} findings`} in ${total} ms (${rel(toolRoot, args.root) || "."})`,
  );
  if (args.json !== undefined) {
    writeFileSync(args.json, `${JSON.stringify({ root: args.root, total, results }, null, 2)}\n`);
  }
  return failures === 0 ? 0 : 1;
}

process.exitCode = await main();
