// Draws check figures on the graphics card when the machine has one.
//   const draw = await openRenderer();
//   const image = await draw.render(meshes, { yaw, center, span, width, height });
//   await draw.close();
// It starts a headless Chrome or Edge without any renderer flags, draws with Three.js and reads the pixels back, so
// it needs no package beyond the ones the project already has. Set CHROME_PATH to choose the browser. When there is
// no browser, or the browser only has a software renderer, it uses the CPU renderer in human-style-raster.mjs.
// `draw.name` says which one drew, and results should quote it.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { render as rasterRender } from "./human-style-raster.mjs";

function browsers() {
  const env = process.env, list = [env.CHROME_PATH];
  if (process.platform === "win32") for (const root of [env.PROGRAMFILES, env["PROGRAMFILES(X86)"], env.LOCALAPPDATA])
    if (root) list.push(join(root, "Google/Chrome/Application/chrome.exe"), join(root, "Microsoft/Edge/Application/msedge.exe"));
  if (process.platform === "darwin") list.push("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", "/Applications/Chromium.app/Contents/MacOS/Chromium");
  if (process.platform === "linux") for (const dir of (env.PATH ?? "").split(":")) for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge"]) list.push(join(dir, name));
  return list.filter(path => path && existsSync(path));
}

const software = reason => ({ name: "software renderer on the CPU (" + reason + ")", hardware: false, render: async (meshes, view) => rasterRender(meshes, view), close: async () => {} });
const base64 = array => Buffer.from(array.buffer, array.byteOffset, array.byteLength).toString("base64");

async function browser(path) {
  const { build } = await import("esbuild");
  const page = (await build({ entryPoints: [fileURLToPath(new URL("./human-style-render-page.js", import.meta.url))], bundle: true, format: "iife", minify: true, write: false, logLevel: "silent" })).outputFiles[0].text;
  const profile = mkdtempSync(join(tmpdir(), "human-style-render-"));
  const child = spawn(path, ["--headless=new", "--remote-debugging-port=0", "--user-data-dir=" + profile, "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  const gone = new Promise(resolve => { child.once("exit", resolve); child.once("error", resolve); });
  // A script that stops on an error must not leave its browser running.
  const stop = () => { if (child.exitCode === null) child.kill(); };
  process.once("exit", stop);
  let socket = null;
  const close = async () => {
    if (socket?.readyState === 1) socket.send(JSON.stringify({ id: 0, method: "Browser.close" }));
    else child.kill();
    await Promise.race([gone, new Promise(resolve => setTimeout(resolve, 5000))]);
    stop();
    process.off("exit", stop);
    if (dirname(resolve(profile)) === resolve(tmpdir()) && basename(profile).startsWith("human-style-render-")) {
      try { rmSync(profile, { recursive: true, maxRetries: 10, retryDelay: 200 }); } catch { /* Chrome may still hold its temporary profile. */ }
    }
  };
  try {
    const address = await new Promise((resolve, reject) => {
      let text = "";
      const timer = setTimeout(() => reject(new Error("the browser did not start")), 30000);
      child.stderr.on("data", part => { text += part; const found = /DevTools listening on (ws:\/\/\S+)/.exec(text); if (found) { clearTimeout(timer); resolve(found[1]); } });
      gone.then(() => { clearTimeout(timer); reject(new Error("the browser closed while starting")); });
    });
    socket = new WebSocket(address);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = () => reject(new Error("no connection to the browser")); });
    const waiting = new Map();
    let last = 0;
    socket.onmessage = event => {
      const message = JSON.parse(event.data), call = waiting.get(message.id);
      if (!call) return;
      waiting.delete(message.id);
      message.error ? call.reject(new Error(message.error.message)) : call.resolve(message.result);
    };
    const send = (method, params, sessionId) => new Promise((resolve, reject) => {
      const id = ++last, timer = setTimeout(() => { waiting.delete(id); reject(new Error("the browser did not answer " + method)); }, 120000);
      waiting.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
    const { targetId } = await send("Target.createTarget", { url: "about:blank" }), { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    const run = async expression => {
      const answer = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
      if (answer.exceptionDetails) throw new Error(answer.exceptionDetails.exception?.description ?? answer.exceptionDetails.text);
      return answer.result.value;
    };
    await run(page + "\n0");
    const name = await run("styleRenderer.info()");
    if (/swiftshader|llvmpipe|software|basic render/i.test(name)) { await close(); return software("the browser has no hardware renderer: " + name); }
    let loaded = null;
    return {
      name, hardware: true, close,
      async render(meshes, view = {}) {
        if (meshes !== loaded) {
          // Meshes cut from one skinned figure share their positions, so each array is sent once.
          const buffers = [], seen = new Map();
          const slot = (array, Type) => {
            if (!seen.has(array)) { seen.set(array, buffers.length); buffers.push(base64(array instanceof Type ? array : Type.from(array))); }
            return seen.get(array);
          };
          const list = meshes.map(mesh => ({ positions: slot(mesh.positions, Float32Array), indices: slot(mesh.indices, Uint32Array), normals: mesh.normals ? slot(mesh.normals, Float32Array) : null, color: mesh.color }));
          await run("styleRenderer.load(" + JSON.stringify({ buffers, meshes: list }) + ")");
          loaded = meshes;
        }
        const { width = 400, height = 800 } = view;
        return { width, height, data: new Uint8Array(Buffer.from(await run("styleRenderer.draw(" + JSON.stringify(view) + ")"), "base64")) };
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}

/** A renderer for check sheets: the graphics card through a headless browser, or the CPU when that is not possible. */
export async function openRenderer() {
  if (typeof WebSocket === "undefined") return software("this Node has no WebSocket");
  const failures = [];
  for (const path of new Set(browsers())) {
    try {
      const renderer = await browser(path);
      if (renderer.hardware) return renderer;
      failures.push(renderer.name);
    } catch (error) {
      failures.push(error.message);
    }
  }
  return software(failures.join(", ") || "no Chrome or Edge found; set CHROME_PATH");
}
