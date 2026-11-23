import { spawn } from "node:child_process";
import {
  mkdtemp,
  readFile,
  writeFile,
  rm,
  lstat,
  realpath,
  readdir,
} from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import { createInterface } from "node:readline";

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export async function codexJob(prompt, views, signal) {
  const dir = await mkdtemp(join(tmpdir(), "irudd-form-"));
  try {
    const out = join(dir, "response.json"),
      argumentsForImages = [];
    for (const [i, view] of views.entries()) {
      const path = join(
        dir,
        "view-" + i + "." + (view.type === "png" ? "png" : "jpg"),
      );
      await writeFile(path, Buffer.from(view.data, "base64"));
      argumentsForImages.push("-i", path);
    }
    const child = spawn(
      process.platform === "win32" ? "codex.exe" : "codex",
      [
        "exec",
        "--ephemeral",
        "--skip-git-repo-check",
        "--sandbox",
        "read-only",
        "--json",
        "--cd",
        dir,
        ...argumentsForImages,
        "-o",
        out,
        "-",
      ],
      { cwd: dir, windowsHide: true, signal, stdio: ["pipe", "pipe", "pipe"] },
    );
    let session = null,
      diagnostic = "";
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      if (session || line.length > 8000) return;
      try {
        const e = JSON.parse(line);
        if (e.type === "thread.started" && uuid.test(e.thread_id))
          session = e.thread_id;
      } catch {}
    });
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      diagnostic = (diagnostic + chunk).slice(-1500);
    });
    child.stdin.on("error", () => {});
    const done = new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) =>
        code === 0
          ? resolve()
          : reject(
              new Error(
                "Codex exited with code " +
                  code +
                  ". " +
                  diagnostic.slice(-240),
              ),
            ),
      );
    });
    child.stdin.end(prompt);
    await done;
    const response = (await readFile(out, "utf8"))
      .trim()
      .replace(/^\x60{3}(?:json)?\s*/i, "")
      .replace(/\s*\x60{3}$/, "");
    return { result: JSON.parse(response), session };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// Only the fresh image tool output directory belonging to this CLI run is
// eligible. Model text cannot nominate a file elsewhere on the user's PC.
export async function generatedPng(session, name) {
  if (!uuid.test(session ?? ""))
    throw new Error("The image run did not return a session ID.");
  const root = resolve(
    process.env.CODEX_HOME || join(homedir(), ".codex"),
    "generated_images",
  );
  const folder = join(root, session);
  const realRoot = await realpath(root);
  if (dirname(await realpath(folder)) !== realRoot)
    throw new Error("Unexpected image output directory.");
  const files = (await readdir(folder, { withFileTypes: true }))
    .filter((f) => f.isFile() && /^[a-zA-Z0-9_-]+\.png$/i.test(f.name))
    .map((f) => f.name);
  const selected = files.includes(basename(name ?? ""))
    ? basename(name)
    : files.length === 1
      ? files[0]
      : null;
  if (!selected)
    throw new Error("The image tool did not return one identifiable PNG.");
  const file = join(folder, selected),
    stat = await lstat(file);
  if (!stat.isFile() || stat.size > 18_000_000 || stat.size < 100)
    throw new Error("Unexpected generated image size.");
  const bytes = await readFile(file);
  if (
    !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    throw new Error("The image tool result is not a PNG.");
  return bytes;
}
