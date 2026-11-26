import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { dirname } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
export interface Running {
  readonly page: Page;
  readonly browser: Browser;
  answerDialogs(answers: { save?: string; open?: string }): Promise<void>;
  close(): Promise<void>;
}

async function editorPage(context: BrowserContext): Promise<Page> {
  for (let i = 0; i < 600; i++) {
    const editor = context
      .pages()
      .find((page) => /^file:.*\/dist\/renderer\/index\.html$/.test(page.url()));
    if (editor) return editor;
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error("The desktop editor page did not open.");
}

async function evaluateInMain(url: string, expression: string): Promise<unknown> {
  const socket = new WebSocket(url);
  await new Promise<void>((done, fail) => {
    socket.addEventListener("open", () => done(), { once: true });
    socket.addEventListener("error", () => fail(new Error("The main-process inspector refused.")), {
      once: true,
    });
  });
  try {
    const reply = await new Promise<unknown>((done, fail) => {
      socket.addEventListener("message", (event) => {
        const message: unknown = JSON.parse(String(event.data));
        if (typeof message === "object" && message !== null && Reflect.get(message, "id") === 1)
          done(message);
      });
      socket.addEventListener("close", () => fail(new Error("The inspector closed.")));
      socket.send(
        JSON.stringify({
          id: 1,
          method: "Runtime.evaluate",
          params: {
            expression,
            includeCommandLineAPI: true,
            awaitPromise: true,
            returnByValue: true,
          },
        }),
      );
    });
    const result: unknown = Reflect.get(Object(reply), "result");
    const exception: unknown = Reflect.get(Object(result), "exceptionDetails");
    if (exception) throw new Error(`Main-process evaluation failed: ${JSON.stringify(exception)}`);
    return Reflect.get(Object(Reflect.get(Object(result), "result")), "value");
  } finally {
    socket.close();
  }
}

export async function launchEditor(
  executable: string,
  extra: string[],
  userData: string,
  env: Record<string, string>,
  problems: string[],
  app?: string,
): Promise<Running> {
  const child = spawn(
    executable,
    [
      ...(app ? [app] : []),
      "--hidden",
      "--inspect=0",
      "--remote-debugging-port=0",
      "--user-data",
      userData,
      ...extra,
    ],
    { cwd: dirname(executable), env, stdio: ["ignore", "ignore", "pipe"] },
  );
  const exited = new Promise<void>((done) => child.once("exit", () => done()));
  try {
    const { devtools, inspector } = await new Promise<{ devtools: string; inspector: string }>(
      (done, fail) => {
        let text = "";
        const timer = setTimeout(
          () => fail(new Error(`No endpoints: ${text.slice(-800)}`)),
          60_000,
        );
        child.stderr?.on("data", (data: Buffer) => {
          text += data.toString();
          const devtools = /DevTools listening on (ws:\/\/\S+)/.exec(text)?.[1];
          const inspector = /Debugger listening on (ws:\/\/\S+)/.exec(text)?.[1];
          if (devtools && inspector) {
            clearTimeout(timer);
            done({ devtools, inspector });
          }
        });
        child.once("exit", (code) =>
          fail(new Error(`The app exited with ${code}: ${text.slice(-800)}`)),
        );
      },
    );
    const browser = await chromium.connectOverCDP(devtools);
    const context = browser.contexts()[0];
    if (!context) throw new Error("The app has no browser context.");
    const page = await editorPage(context);
    page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") problems.push(`console: ${message.text()}`);
    });
    await page.waitForSelector("body[data-ready=true]", { timeout: 60_000 });
    return {
      page,
      browser,
      answerDialogs: (answers) => answerFileDialogs(inspector, answers),
      async close() {
        await page.evaluate(() => window.close()).catch(() => undefined);
        const timeout = setTimeout(() => child.kill(), 20_000);
        await exited;
        clearTimeout(timeout);
        assert.equal(child.exitCode, 0, "the app quit cleanly");
      },
    };
  } catch (error) {
    if (child.exitCode === null) child.kill();
    await exited;
    throw error;
  }
}

export async function answerFileDialogs(
  inspector: string,
  answers: { save?: string; open?: string },
) {
  const value = await evaluateInMain(
    inspector,
    `(() => {
            const { dialog } = require("electron");
            const answers = ${JSON.stringify(answers)};
            if (answers.save) dialog.showSaveDialog = async () => ({ canceled: false, filePath: answers.save });
            if (answers.open) dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [answers.open] });
            return "answered";
          })()`,
  );
  assert.equal(value, "answered");
}

export async function callEditor(page: Page, method: string, params: unknown): Promise<unknown> {
  const outcome = await page.evaluate(
    async ([m, p]) => {
      const api: unknown = Reflect.get(window, "workshop");
      const fn: unknown = Reflect.get(Object(api), "call");
      const callable = (f: unknown): f is (method: string, params: unknown) => Promise<unknown> =>
        typeof f === "function";
      if (!callable(fn)) throw new Error("No workshop bridge.");
      return await fn(m, p);
    },
    [method, params] as const,
  );
  const ok: unknown = Reflect.get(Object(outcome), "ok");
  if (ok !== true) throw new Error(`${method}: ${JSON.stringify(outcome)}`);
  return Reflect.get(Object(outcome), "value");
}
