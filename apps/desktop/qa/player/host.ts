import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { app, BrowserWindow, protocol } from "electron";

const pageDir = process.env["IRUDD_QA_PAGE"] ?? "";
const examplesDir = process.env["IRUDD_QA_EXAMPLES"] ?? "";
const limitMs = 180_000;

const types: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".glb": "model/gltf-binary",
};

protocol.registerSchemesAsPrivileged([
  { scheme: "qa", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

function finish(code: number): void {
  app.exit(code);
}

async function start(): Promise<void> {
  protocol.handle("qa", async (request) => {
    const url = new URL(request.url);
    const parts = decodeURIComponent(url.pathname).split("/").filter(Boolean);
    if (
      url.hostname !== "page" ||
      !parts.length ||
      parts.some((p) => p === ".." || p.includes("\\"))
    )
      return new Response("not found", { status: 404 });
    const example = parts[0] === "examples";
    const name = parts.slice(example ? 1 : 0).join("/");
    if (example && (parts.length !== 2 || extname(name) !== ".glb"))
      return new Response("not found", { status: 404 });
    try {
      const bytes = await readFile(join(example ? examplesDir : pageDir, name));
      return new Response(bytes, {
        headers: { "content-type": types[extname(name)] ?? "application/octet-stream" },
      });
    } catch {
      return new Response("not found", { status: 404 });
    }
  });
  const window = new BrowserWindow({
    show: false,
    width: 900,
    height: 700,
    paintWhenInitiallyHidden: true,
    webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false },
  });
  const timer = setTimeout(() => {
    console.log("FAIL the player check did not finish in time");
    finish(1);
  }, limitMs);
  window.webContents.on("console-message", (details) => {
    const message = details.message;
    if (message.startsWith("QA-DONE ")) {
      clearTimeout(timer);
      finish(message === "QA-DONE pass" ? 0 : 1);
    } else if (message.startsWith("QA ")) console.log(message.slice(3));
    else if (details.level === "error" || details.level === "warning")
      console.log(`page ${details.level}: ${message}`);
  });
  window.webContents.on("render-process-gone", (_event, reason) => {
    console.log(`FAIL renderer exited: ${reason.reason}`);
    finish(1);
  });
  window.webContents.on("did-fail-load", (_event, code, description, url) => {
    console.log(`FAIL ${url} did not load: ${description} (${code})`);
    finish(1);
  });
  await window.loadURL("qa://page/index.html");
}

app.whenReady().then(start, (error: unknown) => {
  console.log(`FAIL ${error instanceof Error ? error.message : String(error)}`);
  finish(1);
});
