import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";
import { Digest, isJson, isJsonArray, isJsonObject } from "@irudd/document";
import { Schema } from "effect";
import { connect, readArtFile, uploadArt, type WorkshopClient } from "@irudd/workshop/client";
import { TraceRegion, type ArtReply } from "@irudd/workshop/wire";
import { appDir, appEnvironment, electronExecutable } from "./electron.js";
import { launchEditor, callEditor } from "./editor-session.js";
import { contactSheet } from "./contact-sheet.js";
import { garmentReply } from "./garment-reply.js";
import { openDetails } from "./qa-field-parity.js";
import { depthReply, paintJacket, paintPortraitHair } from "./painted-reply.js";
import { hardwareRenderer, viewportScreenshot } from "./display-check.js";

const groups = ["review", "paint", "coverage", "files"];
const group = process.argv[2];
if (!group || group === "all") {
  for (const stage of groups) {
    console.log("Starting", stage);
    execFileSync(
      process.execPath,
      [...process.execArgv, resolve(appDir, "scripts/qa-proposal-parity.ts"), stage],
      { cwd: appDir, stdio: "inherit", windowsHide: true },
    );
  }
  process.exit(0);
}
assert.ok(groups.includes(group), "Unknown proposal QA group: " + group);
const root = resolve(appDir, "../.."),
  output = join(root, ".reference-cache/phase9-5");
mkdirSync(output, { recursive: true });
const temp = mkdtempSync(join(tmpdir(), "proposal-parity-")),
  stateDir = join(temp, "state");
const server = spawn(
  process.execPath,
  [
    "--input-type=module",
    "-e",
    `import { workshopServer } from "./scripts/workshop.mjs";
    import { readFileSync } from "node:fs";
    import { createServer } from "node:http";
    const source = readFileSync("dist/character-view.html", "utf8");
    const connected = workshopServer(source.replace("<head>", '<head><meta name="workshop-agent" content="local">'));
    const offline = workshopServer();
    const server = createServer((request, response) => {
      const workshop = request.url === "/dist/character-view.html" ? offline : connected;
      workshop.emit("request", request, response);
    });
    server.listen(0, "127.0.0.1", () => console.log("http://127.0.0.1:" + server.address().port + "/"));`,
  ],
  {
    cwd: root,
    env: { ...process.env, WORKSHOP_PORT: "0" },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  },
);
const url = await new Promise<string>((resolve, reject) => {
  server.stdout.on("data", (b: Buffer) => {
    const match = b.toString().match(/http:\/\/127\.0\.0\.1:\d+\//);
    if (match) resolve(match[0]);
  });
  server.once("error", reject);
  server.once("exit", (code) => reject(new Error("Server exited " + code)));
});
const errors: string[] = [];
const browser = await chromium.launch({ channel: "chrome", args: ["--use-angle=default"] });
const web = await browser.newPage({ viewport: { width: 1340, height: 920 } });
const editor = await launchEditor(
  electronExecutable(),
  [
    "--project",
    join(temp, "project"),
    "--create",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    "--disable-background-timer-throttling",
  ],
  join(temp, "user"),
  appEnvironment({ IRUDD_STATE_DIR: stateDir }),
  errors,
  appDir,
);
const desk = editor.page;
web.setDefaultTimeout(45000);
desk.setDefaultTimeout(45000);
const captures: { name: string; image: string }[] = [];
let agent: WorkshopClient | undefined;
let artwork: Buffer = Buffer.alloc(0);
let mapped: readonly TraceRegion[] = [];
let garment: "open" | "closed" = "closed";
let hold: Promise<void> | undefined;
let received: unknown;
let lastVariation: unknown;
let depthImage = "";
let reviewOutfit: string | undefined;
let refines = 0;
await web.route("**/*", async (route) => {
  const req = route.request(),
    dest = new URL(req.url());
  if (dest.origin !== new URL(url).origin) return route.abort();
  if (req.method() === "GET") return route.continue();
  const payload: unknown = req.postDataJSON();
  assert.ok(
    payload && typeof payload === "object" && "revision" in payload && "requestId" in payload,
  );
  const header = { revision: payload.revision, requestId: payload.requestId };
  if (dest.pathname === "/turnaround") {
    received = payload;
    if (hold) await hold;
    return route.fulfill({
      json: {
        ...header,
        png: artwork.toString("base64"),
        height: "height" in payload ? payload.height : 1.72,
        coverage: garment,
        summary: "Registered teal work jacket",
      },
    });
  }
  if (dest.pathname === "/portrait-depth")
    return route.fulfill({ json: { ...header, png: depthImage } });
  if (dest.pathname === "/trace-map")
    return route.fulfill({
      json: {
        ...header,
        format: "irudd.trace-map.v1",
        height: "height" in payload ? payload.height : 1.72,
        regions: mapped,
      },
    });
  if (dest.pathname === "/variation") {
    lastVariation = payload;
    if (hold) await hold;
    refines++;
    return route.fulfill({
      json: {
        ...header,
        format: "irudd.form-proposal.v1",
        summary: "Jacket finish " + refines,
        operations: reviewOutfit
          ? [{ op: "setForm", set: { outfit: reviewOutfit } }]
          : [{ op: "setPart", id: "body", set: { color: "#487d80" } }],
      },
    });
  }
  return route.abort();
});
async function capture(id: string, label: string, webPanel?: string, desktopPanel?: string) {
  const left = await web.locator(webPanel ?? "#viewport").screenshot({ timeout: 30000 });
  const right = desktopPanel
    ? await (async () => {
        const region = desk.locator(desktopPanel).last();
        await region.evaluate(async (n) => {
          await Promise.all(
            Array.from(n.querySelectorAll("img"), (img) => img.decode().catch(() => undefined)),
          );
          n.scrollIntoView({ block: "start", behavior: "instant" });
          await new Promise<void>((done) =>
            requestAnimationFrame(() => requestAnimationFrame(() => done())),
          );
        });
        const clip = await region.boundingBox();
        assert.ok(clip);
        const viewport = await desk.evaluate(() => ({ width: innerWidth, height: innerHeight }));
        const x = Math.max(0, Math.floor(clip.x)),
          y = Math.max(0, Math.floor(clip.y));
        const bounds = {
          x,
          y,
          width: Math.min(Math.ceil(clip.width), viewport.width - x),
          height: Math.min(Math.ceil(clip.height), viewport.height - y),
        };
        await editor.capture(bounds);
        await desk.evaluate(
          () =>
            new Promise<void>((done) =>
              requestAnimationFrame(() => requestAnimationFrame(() => done())),
            ),
        );
        return editor.capture(bounds);
      })()
    : await viewportScreenshot(desk);
  if (id === "06" || id === "07") {
    for (const frame of [left, right]) {
      const fraction = await web.evaluate(async (data) => {
        const image = await createImageBitmap(
          new Blob([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))]),
        );
        const canvas = new OffscreenCanvas(200, 200);
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Could not sample the painted jacket.");
        ctx.drawImage(image, 0, 0, 200, 200);
        image.close();
        const pixels = ctx.getImageData(0, 0, 200, 200).data;
        let teal = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          const r = pixels[i] ?? 0,
            g = pixels[i + 1] ?? 0,
            b = pixels[i + 2] ?? 0;
          if (g > 55 && g - r > 20 && b - r > 15 && Math.abs(g - b) < 40) teal++;
        }
        return teal / 40000;
      }, frame.toString("base64"));
      assert.ok(fraction > 0.002, "The teal jacket must be visible in both workshop captures.");
    }
  }
  const file = id + "-" + label.replaceAll(" ", "-") + ".png";
  await contactSheet(
    web,
    output,
    [
      { name: "Browser | " + label, image: left.toString("base64") },
      { name: "Desktop | " + label, image: right.toString("base64") },
    ],
    2,
    file,
  );
  captures.push({
    name: id + " " + label,
    image: readFileSync(join(output, file)).toString("base64"),
  });
  console.log("Captured", file);
}
try {
  await web.setViewportSize(
    await desk.evaluate(() => ({ width: innerWidth, height: innerHeight })),
  );
  await web.goto(url + "#form=feline-worker", { waitUntil: "domcontentloaded", timeout: 120000 });
  await web.locator("#target option[value=muzzle]").waitFor({ state: "attached" });
  await web.selectOption("#target", "body");
  await web.click('[data-mode="Color"]');
  await web.click("[data-tab=ai]");
  await desk.selectOption("#start", "feline-worker");
  await desk.locator('#outliner [data-part="p-body"]').click();
  await desk.click("#camera-threequarter");

  const browserGpu = await web.locator("#viewport").evaluate((canvas) => {
    const gl = canvas instanceof HTMLCanvasElement && canvas.getContext("webgl2");
    const debug = gl && gl.getExtension("WEBGL_debug_renderer_info");
    return gl && debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : "";
  });
  assert.ok(browserGpu);
  assert.doesNotMatch(browserGpu, /swiftshader|llvmpipe|softpipe|basic render|warp|software/i);
  console.log("Browser GPU", browserGpu, "Desktop GPU", await hardwareRenderer(desk));
  await desk.click("#agents details:not([open]) > summary");
  await desk.fill("#agents input", "claude");
  await desk.click("#agents button:has-text('Pair')");
  await desk.waitForSelector("#agents p:has-text('Paired claude')");
  const hosts = join(stateDir, "hosts");
  const credential = readdirSync(hosts)
    .map((k) => join(hosts, k, "agents", "claude.json"))
    .find(existsSync);
  assert.ok(credential);
  await callEditor(desk, "recipient.bind", {
    agent: "claude",
    route: { transport: "inbox", host: "claude-code", environment: "local" },
  });
  agent = await connect({
    credential: { role: "agent", file: credential },
    client: { name: "proposal-parity", version: "1" },
    stateDir,
  });
  const paired = agent;
  let documentId = await desk.inputValue("#document");

  const art = desk.locator("#art");
  const list = async () => (await paired.call("art.list", { documentId, all: true })).requests;
  const status = async () =>
    "Web: " +
    (await web.locator("#status").innerText()) +
    " Desktop: " +
    (await desk.locator("#status").innerText());
  async function request(direction: string, action: string, branch = false, width = 0) {
    const before = await list();
    await art.getByLabel("Kind of artwork").selectOption("turnaround");
    await art.getByLabel("Painted edit").selectOption(action);
    if (width) {
      const input = art
        .locator("details label")
        .filter({ hasText: /^width$/ })
        .locator("input");
      await openDetails(input);
      await input.fill(String(width));
    }
    if (branch) await art.getByRole("button", { name: "Select painted branch" }).click();
    await art.getByLabel("Direction").fill(direction);
    await desk.waitForFunction(() => !document.querySelector("#viewport")?.hasAttribute("inert"));
    await art.getByRole("button", { name: "Capture measured views" }).click();
    try {
      await art.locator(".art-compose .art-figure").nth(1).waitFor({ timeout: 20000 });
    } catch (e) {
      console.error(
        "Composer",
        await art.locator("fieldset").innerText(),
        await art.locator(":scope > p").allTextContents(),
      );
      throw e;
    }
    await art.getByRole("button", { name: "Send brief" }).click();
    await art.locator(".art-request").nth(before.length).waitFor();
    const r = (await list()).at(-1);
    assert.ok(r && !before.some((p) => p.artId === r.artId), await status());
    return r;
  }
  async function submit(artId: string, reply: ArtReply) {
    let res = await paired.call("art.submit", {
      artId,
      submissionId: "qa-" + crypto.randomUUID(),
      reply,
    });
    if (res.submission.diagnostics.some((d) => d.path.join(".") === "reply.traceMap.repair")) {
      console.log("Repair requested:", res.submission.diagnostics.map((d) => d.message).join(" "));
      res = await paired.call("art.submit", {
        artId,
        submissionId: "qa-" + crypto.randomUUID(),
        reply,
      });
    }
    assert.ok(res.submission.proposal, JSON.stringify(res.submission.diagnostics));
    const card = desk.locator("#proposals .proposal").filter({ hasText: reply.summary }).first();
    await card.getByRole("button", { name: "Preview", exact: true }).click();
    await desk
      .locator("#banner")
      .getByRole("button", { name: "Show current", exact: true })
      .waitFor();
    return res.submission.proposal;
  }
  const direction = "Dye the existing work jacket teal. Keep its seams and the red shirt.";
  artwork = await paintJacket(web, readFileSync(join(root, "character-view/surveyor.atlas.webp")));
  const itemIds = process.env["IRUDD_PROPOSAL_ITEMS"]?.split(",");
  async function inspect() {
    await web.click("#inspect-export");
    await desk
      .locator("#banner")
      .getByRole("button", { name: "Inspect proposal game export" })
      .click();
    await Promise.all([
      web.locator("#export-review:not([hidden]) img").first().waitFor({ timeout: 90000 }),
      desk.locator("#game-results img").first().waitFor({ timeout: 90000 }),
    ]);
  }
  const jacket = artwork;
  if (group === "paint") {
    const empty = { id: "waistcoat", method: "loft", front: [], side: [] } as const;
    const rect = (l: number, t: number, r: number, b: number): [number, number][] => [
      [l, t],
      [r, t],
      [r, b],
      [l, b],
    ];
    async function scenario(
      id: string,
      label: string,
      action: "whole" | "replace" | "wear" | "revise" | "scalp",
      sheet: Buffer,
      map: readonly TraceRegion[],
      coverage: "open" | "closed" = "closed",
    ) {
      if (itemIds && !itemIds.includes(id)) return;
      mapped = map;
      garment = coverage;
      artwork = sheet;
      const source = await paired.call("current", { documentId });
      const lockTarget = id === "02" ? "right upper arm" : id === "04" ? "body" : undefined;
      if (lockTarget) {
        await focusPart(lockTarget);
        await web.click('[data-tab="sculpt"]');
        await web.click("#protect");
        const lock = desk.locator("#variation-protect");
        await openDetails(lock);
        await lock.check();
        if (action === "whole") await focusPart("");
        else await web.click('[data-tab="ai"]');
      }
      await web.fill("#steering", label);
      if (action !== "whole") await web.selectOption("#paint-action", action);
      const req = await request(label, action);
      const pinned = source.document?.parts.find((p) => p.label === lockTarget);
      if (pinned) assert.ok(req.brief.protected?.includes(pinned.id));
      const digest = (await uploadArt(paired, sheet)).digest;
      await web.click("#paint-generate");
      const proposal = await submit(req.artId, {
        format: "irudd.art-reply",
        version: 1,
        kind: "turnaround",
        summary: label,
        image: Schema.decodeUnknownSync(Digest)(digest),
        coverage,
        ...(map.length
          ? {
              traceMap: {
                format: "irudd.trace-map.v1",
                height: Math.max(0.15, req.brief.height ?? 1.72),
                regions: map,
              },
            }
          : {}),
      });
      await web.locator("#candidate").waitFor();
      const draft = await paired.call("draft", { documentId, proposalId: proposal.id });
      assert.ok(draft.ok);
      if (pinned) {
        const kept = draft.preview.parts.find((p) => p.id === pinned.id);
        assert.deepEqual(kept?.features, pinned.features);
        assert.deepEqual(kept?.size, pinned.size);
      }
      if (action === "scalp" || action === "revise") {
        await desk.click("#focus-selection");
        await web.click('[data-tab="sculpt"]');
        await web.click("#focus");
        await web.click('[data-tab="ai"]');
      }
      await capture(id, label);
      if (id === "04") {
        const files = art.locator(".art-reply").filter({ hasText: label });
        for (const [selector, link] of [
          ["#save-map", "Save trace map"],
          ["#save-turnaround", "Save"],
        ] as const) {
          const [download] = await Promise.all([web.waitForEvent("download"), web.click(selector)]);
          assert.ok(await download.path());
          const anchor = files.getByRole("link", { name: link, exact: true }).first();
          await anchor.waitFor({ state: "attached" });
          const size = await anchor.evaluate(
            async (a) => (await (await fetch(a.getAttribute("href") ?? "")).blob()).size,
          );
          assert.ok(size > 100);
        }
        await capture(
          "12",
          "download artwork and trace map",
          "#candidate",
          "#art .art-reply:last-child",
        );
      }
      if (action === "revise") {
        const portrait = draft.preview.parts.find((p) => p.id === "p-head-and-neck");
        assert.ok(portrait?.features["figure.hair-cap"]);
        assert.ok(portrait?.features["figure.portrait-depth"]);
      }
      if (action === "scalp") {
        assert.ok(
          draft.preview.parts.some(
            (p) => p.parent === "p-head-and-neck" && p.features["figure.hair-cap"],
          ),
        );
      }
      await web.click("#accept");
      await desk.locator("#banner").getByRole("button", { name: "Accept", exact: true }).click();
      const target = source.revision + 1;
      await desk.waitForFunction(
        (n) => document.querySelector("#status-right")?.textContent?.includes("revision " + n),
        target,
      );
      const accepted = await paired.call("current", { documentId });
      assert.deepEqual(accepted.document?.parts, draft.preview.parts);
      await desk.reload();
      await desk
        .locator("#document option")
        .filter({ hasText: source.document?.label ?? "feline" })
        .first()
        .waitFor({ state: "attached" });
      await desk.selectOption("#document", documentId);
      await desk.locator("#outliner [data-part]").first().waitFor();
      assert.equal(
        (await paired.call("current", { documentId })).documentDigest,
        accepted.documentDigest,
      );
      await desk.locator("#viewport").focus();
      await desk.keyboard.press("Control+z");
      await web.click('[data-tab="sculpt"]');
      await web.click("#undo");
      await desk.waitForFunction(
        (n) => document.querySelector("#status-right")?.textContent?.includes("revision " + n),
        target + 1,
      );
      const undone = await paired.call("current", { documentId });
      assert.deepEqual(undone.document?.parts, source.document?.parts);
      if (lockTarget) {
        await web.selectOption("#target", lockTarget);
        if ((await web.getAttribute("#protect", "aria-pressed")) === "true")
          await web.click("#protect");
      }
      console.log("Restored original after", label);
    }
    async function focusPart(webId: string) {
      await web.click('[data-tab="sculpt"]');
      await web.selectOption("#target", webId);
      if (webId)
        await desk.locator('#outliner [data-part="p-' + webId.replaceAll(" ", "-") + '"]').click();
      await web.click('[data-tab="ai"]');
    }
    const closed = await garmentReply(web, jacket, false),
      open = await garmentReply(web, jacket, true);
    await focusPart("body");
    await scenario("04", "closed teal waistcoat", "wear", closed, [empty]);
    await focusPart("body");
    await scenario(
      "05",
      "open teal waistcoat",
      "wear",
      open,
      [
        {
          ...empty,
          id: "left front",
          front: rect(0.12, 0.08, 0.51, 0.92),
          side: rect(0.08, 0.08, 0.92, 0.92),
        },
        {
          ...empty,
          id: "right front",
          parent: "left front",
          front: rect(0.52, 0.09, 0.9, 0.92),
          side: rect(0.08, 0.08, 0.92, 0.92),
        },
      ],
      "open",
    );
    await focusPart("body");
    await scenario("03", "fitted torso replacement", "replace", closed, [empty]);
    await focusPart("");
    const bodyMap = Schema.decodeUnknownSync(Schema.Array(TraceRegion))(
      JSON.parse(readFileSync(join(appDir, "qa/art/feline-worker.trace.json"), "utf8")),
    );
    await scenario("02", "whole painted character", "whole", jacket, bodyMap);
    await focusPart("");
    await scenario("11", "automatic biped after outline repair", "whole", jacket, []);
    const file: unknown = JSON.parse(
      readFileSync(join(root, "examples/fitted-portrait.form.json"), "utf8"),
    );
    const form: unknown = Reflect.get(Object(file), "form") ?? file;
    const entries: unknown = Reflect.get(Object(form), "artwork");
    const saved: unknown = Object.entries(
      entries && typeof entries === "object" ? entries : {},
    ).find(([k]) => k.startsWith("art-155c87"))?.[1];
    assert.ok(typeof saved === "string");
    const scalp = Buffer.from(saved.split(",")[1] ?? "", "base64");
    await web.goto(url + "#form=composed-portrait", { waitUntil: "domcontentloaded" });
    await web.waitForFunction(
      () => document.querySelector("#target option[value='head and neck']") !== null,
    );
    await desk.selectOption("#start", "composed-portrait");
    await desk.waitForFunction(
      (id) => document.querySelector<HTMLSelectElement>("#document")?.value !== id,
      documentId,
    );
    documentId = await desk.inputValue("#document");
    await focusPart("head and neck");
    const face: TraceRegion = {
      id: "face",
      method: "loft",
      front: [],
      side: [],
      outfitRole: "head",
      motionRole: "head",
      faceLandmarks: [
        [0.418, 0.411],
        [0.637, 0.409],
        [0.536, 0.546],
        [0.537, 0.635],
        [0.532, 0.751],
      ],
    };
    await scenario("09", "clean scalp under source hair", "scalp", scalp, [face]);
    await focusPart("head and neck");
    const portraitFile: unknown = JSON.parse(
      readFileSync(join(root, "examples/composed-portrait.form.json"), "utf8"),
    );
    assert.ok(isJson(portraitFile) && isJsonObject(portraitFile));
    const portraitForm = portraitFile["form"];
    assert.ok(isJsonObject(portraitForm));
    const sheets = portraitForm["artwork"];
    assert.ok(isJsonObject(sheets));
    const portraitParts = portraitForm["parts"];
    assert.ok(isJsonArray(portraitParts));
    const head = portraitParts.find((p) => isJsonObject(p) && p["id"] === "head and neck");
    assert.ok(isJsonObject(head));
    const paint = head["paint"];
    assert.ok(isJsonObject(paint) && typeof paint["atlas"] === "string");
    const sourcePortrait = sheets[paint["atlas"]];
    assert.ok(typeof sourcePortrait === "string");
    const revisedSheet = await paintPortraitHair(web, sourcePortrait);
    await scenario("08", "revised fitted portrait", "revise", revisedSheet, [
      {
        ...face,
        faceLandmarks: [
          [0.435, 0.474],
          [0.644, 0.474],
          [0.545, 0.58],
          [0.55, 0.665],
          [0.547, 0.79],
        ],
        depthPairs: [[0.545, 0.58, 0.123, 0.58, 0.14]],
        hairRegions: [
          {
            id: "swept hair",
            front: [
              [0.13, 0.51],
              [0.17, 0.27],
              [0.32, 0.09],
              [0.49, 0.035],
              [0.7, 0.11],
              [0.84, 0.28],
              [0.86, 0.56],
              [0.76, 0.67],
              [0.69, 0.31],
              [0.39, 0.25],
              [0.29, 0.67],
              [0.19, 0.63],
            ],
            side: [
              [0.23, 0.32],
              [0.28, 0.15],
              [0.42, 0.055],
              [0.63, 0.05],
              [0.83, 0.19],
              [0.88, 0.41],
              [0.85, 0.62],
              [0.65, 0.74],
              [0.56, 0.57],
              [0.38, 0.48],
              [0.34, 0.29],
            ],
          },
        ],
      },
    ]);
    if (!itemIds || itemIds.includes("10")) {
      await focusPart("head and neck");
      await web.selectOption("#paint-action", "depth");
      await art.getByLabel("Kind of artwork").selectOption("depth");
      await art.locator('.art-parts label[title="p-head-and-neck"] input').check();
      await art.getByRole("button", { name: "Add sheet views" }).click();
      await art.locator(".art-compose .art-figure").nth(1).waitFor();
      await art.getByLabel("Direction").fill("Fit a grayscale depth pass.");
      const prior = (await list()).length;
      await art.getByRole("button", { name: "Send brief" }).click();
      await art.locator(".art-request").nth(prior).waitFor();
      const req = (await list()).at(-1);
      assert.ok(req);
      const front = req.attachments.find((a) => a.role === "front");
      assert.ok(front);
      depthImage = await depthReply(
        web,
        (await readArtFile(paired, req.artId, front.digest)).bytes,
      );
      const file = await uploadArt(paired, Buffer.from(depthImage, "base64"), "image/png");
      await web.click("#paint-generate");
      await submit(req.artId, {
        format: "irudd.art-reply",
        version: 1,
        kind: "depth",
        image: Schema.decodeUnknownSync(Digest)(file.digest),
        summary: "Fitted grayscale depth",
      });
      await web.locator("#candidate").waitFor();
      await web.click("#accept");
      await desk.locator("#banner").getByRole("button", { name: "Accept", exact: true }).click();
      await focusPart("head and neck");
      await web.click('[data-tab="sculpt"]');
      await web.click('[data-mode="Clay"]');
      await web.click("#focus");
      await desk.selectOption("#display-mode", "clay");
      await desk.click("#focus-selection");
      const mix = web.locator("#depth-mix");
      await openDetails(mix);
      await mix.evaluate((n) => {
        if (n instanceof HTMLInputElement) n.value = "65";
      });
      await mix.dispatchEvent("change");
      const adjust = desk
        .locator("#portrait-actions button")
        .filter({ hasText: "Adjust portrait depth" });
      await openDetails(adjust);
      await adjust.click();
      await desk.getByLabel("Depth strength").evaluate((n) => {
        if (n instanceof HTMLInputElement) n.value = "0.65";
      });
      await desk.click("#portrait-apply");
      await desk.waitForSelector("#portrait-dialog", { state: "hidden" });
      await capture("10", "portrait depth in clay");
    }
  }
  if (group === "review") {
    await desk.selectOption("#display-mode", "studio");
    artwork = jacket;
    const original = await paired.call("current", { documentId });
    await web.selectOption("#paint-action", "repaint");
    await web.check("#repaint-branch");
    const branchDirection = "Dye the jacket and attached sleeves teal.";
    await web.fill("#steering", branchDirection);
    const branch = await request(branchDirection, "", true);
    assert.ok((branch.brief.parts?.length ?? 0) > 1);
    let release = () => {};
    hold = new Promise<void>((done) => {
      release = done;
    });
    await web.click("#paint-generate");
    await web.locator("#cancel-generation").waitFor();
    await capture("01", "measured artwork request", "#steering", "#art .art-request:last-child");
    await web.click("#cancel-generation");
    release();
    hold = undefined;
    assert.ok(received && typeof received === "object" && "views" in received);
    const branchCard = art.locator(".art-request").filter({ hasText: branch.artId }).first();
    await branchCard.getByRole("button", { name: "Cancel", exact: false }).click();
    const can = await paired.call("art.get", { artId: branch.artId });
    assert.equal(can.state, "cancelled");
    await web.click('[data-tab="sculpt"]');
    const range = web.getByLabel("width nudge", { exact: true });
    await range.evaluate((n) => {
      if (n instanceof HTMLInputElement) {
        n.value = "8";
        n.dispatchEvent(new Event("input"));
      }
    });
    await web.click('[data-tab="ai"]');
    const nextBranch = await request(branchDirection, "", true, 8);
    assert.equal(nextBranch.brief.nudge?.amounts["width"], 8);
    const sheet = await uploadArt(paired, jacket, "image/webp");
    await web.click("#paint-generate");
    const nudged = await submit(nextBranch.artId, {
      format: "irudd.art-reply",
      version: 1,
      kind: "turnaround",
      image: Schema.decodeUnknownSync(Digest)(sheet.digest),
      summary: "Dye attached sleeves teal",
    });
    await web.locator("#candidate").waitFor();
    const resized = await paired.call("draft", { documentId, proposalId: nudged.id });
    const source = original.document?.parts.find((p) => p.id === "p-body");
    assert.ok(resized.ok && source);
    assert.ok(
      Math.abs(
        (resized.preview.parts.find((p) => p.id === "p-body")?.size[0] ?? 0) -
          source.size[0] * 1.08,
      ) < 1e-6,
    );
    await capture("07", "repainted attached sleeves");
    await web.click("#discard");
    await desk.locator("#banner").getByRole("button", { name: "Reject" }).click();
    await web.click('[data-tab="sculpt"]');
    await web.click("#clear");
    await web.click('[data-tab="ai"]');
    await web.uncheck("#repaint-branch");
    await web.fill("#steering", direction);
    const r = await request(direction, "");
    assert.ok(
      r.attachments.some((a) => a.role === "close-up" && a.label?.includes("Selected part alone")),
    );
    const uploaded = await uploadArt(paired, artwork, "image/webp");
    await web.click("#paint-generate");
    const proposal = await submit(r.artId, {
      format: "irudd.art-reply",
      version: 1,
      kind: "turnaround",
      image: Schema.decodeUnknownSync(Digest)(uploaded.digest),
      summary: "Registered teal work jacket",
    });
    await web.locator("#candidate").waitFor();
    await capture("06", "registered jacket repaint");
    await web.click("#compare");
    await desk.locator("#banner").getByRole("button", { name: "Show current" }).click();
    await capture("13", "current character comparison");
    await web.click("#compare");
    await desk.locator("#banner").getByRole("button", { name: "Show proposal" }).click();
    await inspect();
    await capture("18", "reloaded game export", "#export-review", "#game-results");
    await desk.click("#inspection-close");
    const card = desk
      .locator("#proposals .proposal")
      .filter({ hasText: "Registered teal work jacket" })
      .first();
    const notes = "Soften the jacket finish.";
    await web.fill("#refine-note", notes);
    await card.getByLabel("Refinement notes").fill(notes);
    await capture(
      "14",
      "refinement direction",
      "label:has(#refine-note)",
      '#proposals .proposal div:has(> input[aria-label="Refinement notes"])',
    );
    await web.click("#refine-send");
    await card.getByRole("button", { name: "Request refinement" }).click();
    await desk.waitForFunction(() =>
      document.querySelector("#status")?.textContent?.includes("Requested refinement"),
    );
    const revision = (await list()).at(-1);
    assert.ok(
      revision &&
        revision.brief.refinement?.proposal === proposal.id &&
        revision.brief.direction.includes(notes),
    );
    const next = await submit(revision.artId, {
      format: "irudd.art-reply",
      version: 1,
      kind: "variation",
      summary: "Jacket finish 1",
      operations: [{ op: "part.set", part: "p-body", set: { color: "#487d80" } }],
    });
    assert.equal(next.id, proposal.id);
    assert.equal(next.version, 2);
    await web.locator("#refine-back").waitFor();
    await inspect();
    await web.click("#export-review-compare");
    await desk
      .locator("#game-results")
      .getByRole("button", { name: "Show earlier export" })
      .click();
    await capture("19", "earlier game export", "#export-review", "#game-results");
    await desk.click("#inspection-close");
    const latestCard = desk
      .locator("#proposals .proposal")
      .filter({ hasText: "Jacket finish 1" })
      .first();
    hold = new Promise<void>((done) => {
      release = done;
    });
    await web.fill("#refine-note", "");
    await web.click("#refine-send");
    await latestCard.getByRole("button", { name: "Request refinement" }).click();
    await desk.waitForFunction(() =>
      document.querySelector("#status")?.textContent?.includes("Requested refinement"),
    );
    await desk.waitForFunction(() =>
      document.querySelector("#art")?.textContent?.includes("correct one visible defect"),
    );
    const inspected = (await list()).at(-1);
    assert.ok(
      inspected?.brief.refinement?.exportReview &&
        inspected.brief.attachments.filter((a) => a.label?.includes("Earlier proposal")).length ===
          2,
    );
    assert.ok(lastVariation && typeof lastVariation === "object" && "refinement" in lastVariation);
    await capture(
      "22",
      "refine from compared exports",
      "#candidate",
      "#art .art-request:last-child",
    );
    await web.click("#cancel-generation");
    release();
    hold = undefined;
    await web.click("#refine-back");
    await desk.locator("#banner").getByRole("button", { name: "Show previous proposal" }).click();
    await desk.locator("#banner").getByRole("button", { name: "Restore this proposal" }).waitFor();
    await capture("15", "previous proposal", "#candidate", "#banner");
    await desk.locator("#banner").getByRole("button", { name: "Restore this proposal" }).click();
    await desk.waitForFunction(
      () =>
        document.querySelector("#banner")?.textContent?.includes("Registered teal work jacket") &&
        !document.querySelector("#banner")?.textContent?.includes("Restore this proposal"),
    );
    const restored = await paired.call("draft", { documentId, proposalId: proposal.id });
    assert.ok(restored.ok && restored.proposal.version === 3);
    await web.click("#compare");
    await desk
      .locator("#banner")
      .getByRole("button", { name: "Show current", exact: true })
      .click();
    await web.click("#keep-candidate");
    await desk.locator("#banner").getByRole("button", { name: "Keep alternate" }).click();
    const saved = desk
      .locator("#document option")
      .filter({ hasText: "Registered teal work jacket alternate" });
    await saved.waitFor({ state: "attached" });
    assert.equal(await desk.inputValue("#document"), documentId);
    assert.equal(
      (await paired.call("current", { documentId })).documentDigest,
      original.documentDigest,
    );
    await capture("16", "kept alternate and original");
    await web.click('[data-tab="files"]');
    await web.fill("#alternate-name", "Original workwear");
    await web.click("#keep-current");
    await desk.fill("#variation-name", "Original workwear");
    await desk.click("#save-variation");
    const shelf = desk.locator("#alternate-shelf");
    await shelf.getByRole("button", { name: "Original workwear", exact: true }).waitFor();
    await desk.reload();
    await desk.selectOption("#document", documentId);
    await web.reload();
    await web.click('[data-tab="files"]');
    await web.locator("#alternate-list .alternate").first().waitFor();
    assert.match(
      await web.locator("#alternate-list .alternate").first().innerText(),
      /Original workwear/,
    );
    assert.match(await shelf.locator("button").first().innerText(), /Original workwear/);
    await capture("17", "saved workwear variations", "#alternate-list", "#alternate-shelf");
    await web.locator("#alternate-list .alternate").nth(1).locator("button").first().click();
    await shelf.locator(":scope > div").nth(1).locator("button").first().click();
    await web.locator("#candidate").waitFor();
    await desk.locator("#banner").getByRole("button", { name: "Accept", exact: true }).waitFor();
    await web.click("#accept");
    await desk.locator("#banner").getByRole("button", { name: "Accept", exact: true }).click();
    await web.click('[data-tab="files"]');
    await web.getByRole("button", { name: "Remove Original workwear" }).click();
    await shelf.getByRole("button", { name: "Remove Original workwear" }).click();
    await shelf
      .getByRole("button", { name: "Original workwear", exact: true })
      .waitFor({ state: "detached" });
  }
  if (group === "coverage") {
    await web.goto(url + "#adult=491", { waitUntil: "domcontentloaded" });
    await desk.selectOption("#start", "human-adult/preset/seed-491");
    await desk.waitForFunction(
      (id) => document.querySelector<HTMLSelectElement>("#document")?.value !== id,
      documentId,
    );
    documentId = await desk.inputValue("#document");
    await web.click('[data-tab="ai"]');
    const base = await paired.call("current", { documentId });
    const params = base.document?.generation?.params;
    assert.ok(params && isJsonObject(params));
    reviewOutfit = "Pressure suit";
    await web.fill("#steering", "Fit a pressure suit to this adult.");
    await web.click("#generate");
    const count = (await list()).length;
    await art.getByLabel("Kind of artwork").selectOption("variation");
    await art.getByLabel("Direction").fill("Fit a pressure suit to this adult.");
    await art.getByRole("button", { name: "Send brief" }).click();
    await art.locator(".art-request").nth(count).waitFor();
    const req = (await list()).at(-1);
    assert.ok(req);
    await submit(req.artId, {
      format: "irudd.art-reply",
      version: 1,
      kind: "variation",
      summary: "Fitted pressure suit",
      operations: [{ op: "generation.steer", params: { ...params, outfit: reviewOutfit } }],
    });
    await web.locator("#candidate").waitFor();
    await inspect();
    const details = desk.locator("#game-results details");
    await details.locator("summary").click({ timeout: 15000 });
    assert.equal(await details.locator("p").count(), 4);
    assert.match(await details.innerText(), /Enclosed skin in game/);
    await capture("20", "full and game suit coverage", "#export-review", "#game-results details");
    await desk.click("#inspection-close");
    reviewOutfit = "Anatomy";
    await web.fill("#refine-note", "Inspect the skin beneath the pressure suit.");
    await web.click("#refine-send");
    const card = desk
      .locator("#proposals .proposal")
      .filter({ hasText: "Fitted pressure suit" })
      .first();
    await card.getByLabel("Refinement notes").fill("Inspect the skin beneath the pressure suit.");
    await card.getByRole("button", { name: "Request refinement" }).click();
    await art
      .locator(".art-request")
      .nth(count + 1)
      .waitFor();
    const revision = (await list()).at(-1);
    assert.ok(revision);
    await submit(revision.artId, {
      format: "irudd.art-reply",
      version: 1,
      kind: "variation",
      summary: "Pressure suit removed",
      operations: [{ op: "generation.steer", params: { ...params, outfit: reviewOutfit } }],
    });
    await web.locator("#refine-back").waitFor();
    await inspect();
    await details.locator("summary").click({ timeout: 15000 });
    assert.match(await details.innerText(), /to bare/);
    await capture("21", "newly exposed skin by garment", "#export-review", "#game-results details");
  }
  if (group === "files") {
    await web.goto(url + "dist/character-view.html", {
      waitUntil: "domcontentloaded",
      timeout: 120000,
    });
    await web.locator("#target option").first().waitFor({ state: "attached" });
    await web.locator("#openfile").setInputFiles(join(root, "examples/feline-worker.form.json"));
    await web.waitForFunction(() =>
      document.querySelector("#status")?.textContent?.includes("Form opened."),
    );
    await web.locator("#target option[value=muzzle]").waitFor({ state: "attached" });
    await web.click('[data-tab="ai"]');
    const image = { name: "teal-jacket.webp", mimeType: "image/webp", buffer: jacket };
    await web.locator("#reference-file").setInputFiles(image);
    await desk.locator("#variation-files").setInputFiles(image);
    await desk
      .locator("#variation-references")
      .getByText(/teal-jacket/)
      .first()
      .waitFor({ state: "attached" });
    await web.fill("#steering", direction);
    await desk.evaluate(() => {
      HTMLAnchorElement.prototype.click = function () {
        if (this.download.endsWith(".json")) {
          void fetch(this.href)
            .then((r) => r.text())
            .then((t) => {
              document.documentElement.dataset["downloaded"] = t;
            });
        } else HTMLElement.prototype.click.call(this);
      };
    });
    async function browserFile(selector: string) {
      const [file] = await Promise.all([web.waitForEvent("download"), web.click(selector)]);
      const path = await file.path();
      assert.ok(path);
      const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
      assert.ok(
        raw && typeof raw === "object" && "revision" in raw && "requestId" in raw && "views" in raw,
      );
      return {
        revision: raw.revision,
        requestId: raw.requestId,
        review:
          "refinement" in raw && isJson(raw.refinement) && isJsonObject(raw.refinement)
            ? raw.refinement["exportReview"]
            : undefined,
      };
    }
    async function desktopFile() {
      await desk.waitForFunction(() => Boolean(document.documentElement.dataset["downloaded"]));
      const json = await desk.evaluate(() => {
        const data = document.documentElement.dataset["downloaded"];
        delete document.documentElement.dataset["downloaded"];
        return data;
      });
      assert.ok(json);
      const raw: unknown = JSON.parse(json);
      assert.ok(
        raw &&
          typeof raw === "object" &&
          "brief" in raw &&
          isJson(raw.brief) &&
          isJsonObject(raw.brief),
      );
      return raw.brief;
    }
    const header = await browserFile("#generate");
    await art.getByLabel("Kind of artwork").selectOption("variation");
    await art.getByLabel("Direction").fill(direction);
    await art.getByRole("button", { name: "Prepare offline brief" }).click();
    const offline = art
      .locator(".art-request")
      .filter({ hasText: "Save the brief and import" })
      .first();
    await offline.getByRole("button", { name: "Save brief" }).click();
    const brief = await desktopFile();
    assert.equal(brief["documentId"], documentId);
    const patch = {
      shape: "box",
      color: "#cc7642",
      position: [0.22, 1.12, 0.1],
      size: [0.07, 0.1, 0.012],
    };
    const pole = {
      shape: "cylinder",
      color: "#e5aa39",
      position: [0.53, 1.55, 0.18],
      size: [0.045, 3.1, 0.045],
    };
    const nativePart = (id: string, label: string, shape: typeof patch, features: object) => ({
      ...shape,
      id,
      label,
      features,
      parent: null,
      sculpt: [],
      rotation: [0, 0, 0, 1],
    });
    const parts = [
      { op: "part.set", part: "p-body", set: { color: "#487d80" } },
      {
        op: "part.add",
        part: nativePart("p-suit-patch", "Spare patch", patch, {
          "outfit.wear": { visibleIn: ["Pressure suit"] },
        }),
      },
    ];
    const file = (name: string, value: unknown) => ({
      name,
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(value)),
    });
    const webReply = (ids: typeof header, summary: string, addPole = false) =>
      file("jacket.json", {
        ...ids,
        format: "irudd.form-proposal.v1",
        summary,
        operations: addPole
          ? [{ op: "addPart", part: { ...pole, id: "Survey staff" } }]
          : [
              { op: "setPart", id: "body", set: { color: "#487d80" } },
              {
                op: "addPart",
                part: { ...patch, id: "Spare patch", visibleIn: ["Pressure suit"] },
              },
            ],
      });
    await web.locator("#file").setInputFiles(webReply(header, "Jacket finish"));
    await web.locator("#candidate").waitFor();
    await offline
      .locator('input[type="file"]')
      .setInputFiles(file("jacket.json", { operations: parts }));
    await desk.getByRole("button", { name: "Import artwork", exact: true }).click();
    const card = desk
      .locator("#proposals .proposal")
      .filter({ hasText: "Imported jacket.json" })
      .first();
    await card.getByRole("button", { name: "Preview", exact: true }).click();
    await desk
      .locator("#banner")
      .getByText(/Hidden in Work clothes: Spare patch/)
      .waitFor();
    assert.match(await web.locator("#summary").innerText(), /Hidden in Work clothes: Spare patch/);
    await inspect();
    await desk.click("#inspection-close");
    await web.fill("#refine-note", "Add a full-length survey staff beside the worker.");
    await card
      .getByLabel("Refinement notes")
      .fill("Add a full-length survey staff beside the worker.");
    const nextHeader = await browserFile("#refine-send");
    await card.getByRole("button", { name: "Export refinement" }).click();
    const nextBrief = await desktopFile();
    const refinement = nextBrief["refinement"];
    assert.ok(
      isJsonObject(refinement) &&
        isJsonArray(nextBrief["attachments"]) &&
        nextBrief["attachments"].some((a) => isJsonObject(a) && a["role"] === "reference"),
    );
    const offlineReply = {
      documentId,
      revision: nextBrief["revision"],
      proposal: refinement["proposal"],
      version: refinement["version"],
      summary: "Offline refinement",
      operations: [
        { op: "part.add", part: nativePart("p-survey-staff", "Survey staff", pole, {}) },
      ],
    };
    await card
      .locator('input[type="file"]')
      .setInputFiles(file("stale.json", { ...offlineReply, version: 0 }));
    await desk
      .getByText(/Return the exported documentId/)
      .first()
      .waitFor({ state: "attached" });
    await web
      .locator("#file")
      .setInputFiles(webReply({ ...nextHeader, requestId: "stale" }, "Stale refinement"));
    assert.ok(!(await web.locator("#refine-back").isVisible()));
    await web.locator("#file").setInputFiles(webReply(nextHeader, "Offline refinement", true));
    await card.locator('input[type="file"]').setInputFiles(file("reply.json", offlineReply));
    await web.locator("#refine-back").waitFor();
    await desk
      .locator("#proposals .proposal")
      .filter({ hasText: "Offline refinement" })
      .first()
      .waitFor({ state: "attached" });
    await inspect();
    await desk.locator("#game-results").getByText("Reframed to fit the proposal.").waitFor();
    const compared = (await browserFile("#refine-send")).review;
    assert.ok(isJsonObject(compared) && compared["matchedPreviousFrame"] === false);
    await capture("files", "reframed survey staff export", "#export-review", "#game-results");
    await desk.click("#inspection-close");
    const humanCard = desk
      .locator("#proposals .proposal")
      .filter({ hasText: "Offline refinement" })
      .first();
    await humanCard.getByLabel("Refinement notes").fill("Check the survey staff finish.");
    await humanCard.getByRole("button", { name: "Request refinement" }).click();
    await desk.waitForFunction(() =>
      document.querySelector("#status")?.textContent?.includes("Requested refinement from claude"),
    );
    const routed = (await list()).at(-1);
    assert.ok(routed?.brief.refinement?.version === 2 && routed.agent === "claude");
    const reviewed = await submit(routed.artId, {
      format: "irudd.art-reply",
      version: 1,
      kind: "variation",
      summary: "Survey staff inspection complete",
      operations: [],
    });
    assert.equal(reviewed.version, 3);
    console.log(
      "Offline request, references, matching file refinement and stale reply checks passed",
    );
  }
  assert.deepEqual(errors, []);
} catch (error) {
  console.error(error);
  console.error(
    "Browser feedback:",
    await web
      .locator("#status")
      .textContent()
      .catch(() => ""),
    "Desktop report:",
    await desk
      .locator("#game-results")
      .textContent()
      .catch(() => ""),
  );
  throw error;
} finally {
  if (captures.length) {
    const verified = readdirSync(output)
      .filter((f) => /^\d\d-.*\.png$/.test(f))
      .sort()
      .map((f) => ({
        name: f.slice(0, -4),
        image: readFileSync(join(output, f)).toString("base64"),
      }));
    await contactSheet(web, output, verified, 1, "contact-sheet.png", 2, {
      width: 760,
      height: 288,
    });
  }
  agent?.close();
  await editor.close();
  await browser.close();
  server.kill();
  rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
