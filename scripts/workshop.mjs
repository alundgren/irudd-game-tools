import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateForm, readProposal } from "../character-view/recipe.js";

export async function codexVariation(brief, signal) {
  const dir = await mkdtemp(join(tmpdir(), "irudd-form-"));
  try {
    const output = join(dir, "proposal.json");
    const cmd = process.platform === "win32" ? "codex.exe" : "codex";
    const attachments = [];
    for (const [i, view] of (brief.views ?? []).entries()) {
      const file = join(dir, "view-" + i + ".jpg");
      await writeFile(file, Buffer.from(view.jpeg, "base64"));
      attachments.push("-i", file);
    }
    const { views, ...design } = brief;
    const child = spawn(
      cmd,
      [
        "exec",
        "--ephemeral",
        "--skip-git-repo-check",
        "--sandbox",
        "read-only",
        "--cd",
        dir,
        ...attachments,
        "-o",
        output,
        "-",
      ],
      {
        cwd: dir,
        windowsHide: true,
        stdio: ["pipe", "ignore", "pipe"],
        signal,
      },
    );
    let diagnostic = "";
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      diagnostic = (diagnostic + chunk).slice(-2400);
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
                  diagnostic.slice(-320),
              ),
            ),
      );
    });
    child.stdin.end(
      "You are the geometry author for a game character editor. Use the JSON brief below as design input. Do not use tools, access the filesystem or execute code. Return a single JSON proposal following replyFormat. Preserve ids on retained parts.\n" +
        JSON.stringify(design),
    );
    await done;
    const response = (await readFile(output, "utf8"))
      .trim()
      .replace(/^\x60{3}(?:json)?\s*/i, "")
      .replace(/\s*\x60{3}$/, "");
    return JSON.parse(response);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function workshopServer(page, generate = codexVariation) {
  let busy = false;
  return createServer(async (req, res) => {
    const url = "http://127.0.0.1:" + req.socket.localPort;
    const json = (status, body) => {
      res.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(body));
    };
    if (req.headers.host !== new URL(url).host)
      return json(403, { error: "Use the local workshop address." });
    if (req.method === "GET" && req.url === "/") {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      });
      return res.end(
        page.replace(
          "</head>",
          '<meta name="workshop-agent" content="local"></head>',
        ),
      );
    }
    if (req.method !== "POST" || req.url !== "/variation")
      return json(404, { error: "Unknown route." });
    if (
      req.headers.origin !== url ||
      req.headers["content-type"] !== "application/json"
    )
      return json(403, { error: "Generate from the local workshop." });
    if (busy)
      return json(409, { error: "Another variation is being generated." });
    busy = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 240_000);
    res.on("close", () => {
      if (!res.writableEnded) controller.abort();
    });
    try {
      let raw = "";
      for await (const chunk of req) {
        raw += chunk.toString();
        if (Buffer.byteLength(raw) > 450000)
          return json(413, { error: "Form is too large." });
      }
      let brief;
      try {
        brief = JSON.parse(raw);
        if (
          brief.format !== "irudd.form-request.v1" ||
          typeof brief.requestId !== "string" ||
          typeof brief.revision !== "string" ||
          typeof brief.instructions !== "string" ||
          brief.instructions.length > 2000
        )
          throw new Error("Malformed variation request.");
        validateForm(brief.current);
        validateForm(brief.preview);
        if (
          brief.views &&
          (!Array.isArray(brief.views) ||
            brief.views.length > 2 ||
            brief.views.some(
              (v) =>
                typeof v.jpeg !== "string" ||
                v.jpeg.length > 170000 ||
                !v.jpeg.startsWith("/9j/"),
            ))
        )
          throw new Error("Invalid camera views.");
      } catch (err) {
        return json(400, { error: err.message });
      }
      const proposal = readProposal(
        await generate(brief, controller.signal),
        brief,
        brief.revision,
      );
      json(200, proposal);
    } catch (error) {
      if (!res.destroyed)
        json(502, {
          error: controller.signal.aborted
            ? "Generation timed out. Your current form is safe."
            : error.message,
        });
    } finally {
      clearTimeout(timeout);
      busy = false;
    }
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const page = await readFile(
    fileURLToPath(new URL("../dist/character-view.html", import.meta.url)),
    "utf8",
  );
  const server = workshopServer(page);
  server.on("error", (err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
  server.listen(Number(process.env.WORKSHOP_PORT ?? 4179), "127.0.0.1", () =>
    console.log(
      "Character workshop: http://127.0.0.1:" + server.address().port + "/",
    ),
  );
}
