import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const windows = process.platform === "win32";
const parser = path.join(root, "node_modules/@ast-grep/cli", windows ? "ast-grep.exe" : "ast-grep");
const findings = new Map();

function run(command, args, input) {
  const result = spawnSync(command, args, {cwd: root, input, encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024});
  if (result.error) throw result.error;
  if (result.status !== 0 && !(command === parser && result.status === 1 && !result.stderr.trim()))
    throw new Error(result.stderr || command + " failed with exit " + result.status);
  return result.stdout;
}

const files = [...new Set(run("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]).split("\0"))]
  .filter(file => file && existsSync(path.join(root, file)));

function collect(output, stdinFile) {
  for (const row of output.trim().split("\n").filter(Boolean)) {
    const {file, range, text} = JSON.parse(row);
    if (range.byteOffset.start === 0 && text.startsWith("#!")) continue;
    const key = stdinFile ?? file;
    if (!findings.has(key)) findings.set(key, []);
    findings.get(key).push({line: range.start.line + 1});
  }
}

for (const [language, extension] of [
  ["typescript", /\.(?:[cm]?ts)$/i], ["tsx", /\.tsx$/i],
  ["javascript", /\.(?:[cm]?js|jsx|html?)$/i], ["css", /\.(?:css|html?)$/i],
  ["html", /\.html?$/i], ["python", /\.py$/i], ["csharp", /\.cs$/i],
  ["yaml", /\.ya?ml$/i]
]) {
  const selected = files.filter(file => extension.test(file));
  for (let i = 0; i < selected.length; i += 48) {
    collect(run(parser, ["run", "-l", language, "-k", "comment", "--json=stream", ...selected.slice(i,i+48)]));
  }
}

for (const file of files.filter(file => /\.sh$/i.test(file) || file === "apps/cli/bin/irudd")) {
  collect(run(parser, ["run", "-l", "bash", "-k", "comment", "--json=stream", "--stdin"], readFileSync(path.join(root,file))), file);
}

const powershellFiles = files.filter(file => /\.(?:ps1|psm1|psd1)$/i.test(file));
if (powershellFiles.length)
  collect(run(windows ? "powershell.exe" : "pwsh", ["-NoProfile", "-NonInteractive", "-File", "scripts/comment-tokens.ps1", ...powershellFiles]));

for (const file of files.filter(file => /\.(?:cmd|bat)$/i.test(file))) {
  const source = readFileSync(path.join(root,file), "utf8");
  for (const match of source.matchAll(/^[ \t]*@?(?:rem\b|::)[^\r\n]*/gim)) {
    const start = Buffer.byteLength(source.slice(0,match.index));
    collect(JSON.stringify({file,text:match[0],range:{byteOffset:{start,end:start+Buffer.byteLength(match[0])},start:{line:source.slice(0,match.index).split("\n").length-1}}}));
  }
}

for (const [file, comments] of findings)
  for (const {line} of comments) console.error(file + ":" + line + ": code comments are prohibited");
const count = [...findings.values()].reduce((total, rows) => total + rows.length, 0);
console.log("Found " + count + " code comments in " + findings.size + " files.");
if (count) process.exitCode = 1;
