import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import type { WorkshopClient } from "@irudd/workshop/client";
import { hardwareRenderer, viewportScreenshot } from "./display-check.js";

async function captureWindow(page: Page, path: string) {
  const session = await page.context().newCDPSession(page);
  const frame = Promise.withResolvers<string>();
  session.once("Page.screencastFrame", ({ data }) => frame.resolve(data));
  const timeout = setTimeout(
    () => frame.reject(new Error("No frame from the hidden workshop window.")),
    15000,
  );
  try {
    await session.send("Page.startScreencast", { format: "png" });
    writeFileSync(path, Buffer.from(await frame.promise, "base64"));
  } finally {
    clearTimeout(timeout);
    await session.detach();
  }
}

export async function verifyVariation(
  page: Page,
  agent: WorkshopClient,
  documentId: string,
  out: string,
) {
  mkdirSync(out, { recursive: true });
  console.log("Variation GPU", await hardwareRenderer(page));
  await page.click('#outliner [data-part="p-body"]');
  const props = page.locator("#properties");
  const reroll = props.getByRole("button", { name: "Small reroll" });
  await reroll.click();
  assert.match(await props.locator("output").innerText(), /[+-]\d+%/);
  await props.getByRole("button", { name: "Reset", exact: true }).click();
  assert.equal(await props.locator("output").count(), 0);
  const before = await agent.call("inspect", { documentId });
  await reroll.click();
  await props.getByRole("button", { name: "Apply nudge" }).click();
  await page.waitForFunction(
    (n) => document.querySelector("#status-right")?.textContent?.includes("revision " + n + " ·"),
    before.revision + 1,
  );
  const after = await agent.call("inspect", { documentId });
  assert.equal(after.revision, before.revision + 1);
  assert.notDeepEqual(
    after.document?.parts.find((p) => p.id === "p-body")?.size,
    before.document?.parts.find((p) => p.id === "p-body")?.size,
  );
  await page.click("#variation summary");
  await page.fill("#variation-decks", "mood = calm | wary | fierce\nfabric = silk | wool");
  await page.selectOption("#variation-strength", "radical");
  await page.evaluate(() => {
    const original = crypto.getRandomValues.bind(crypto);
    const seeds = [1, 2];
    crypto.getRandomValues = (buffer) => {
      if (buffer instanceof Uint32Array && buffer.length === 1 && seeds.length) {
        buffer[0] = seeds.shift() ?? 0;
        if (!seeds.length) crypto.getRandomValues = original;
        return buffer;
      }
      return original(buffer);
    };
  });
  await page.click("#variation-draw");
  const rows = page.locator("#variation-results label");
  assert.match(await rows.nth(2).innerText(), /mood = wary/);
  const pinned = await rows.first().innerText();
  await rows.first().locator("input").check();
  await page.click("#variation-draw");
  assert.match(await rows.nth(2).innerText(), /mood = fierce/);
  assert.equal(await rows.first().innerText(), pinned);
  const expected = await rows.allInnerTexts();
  const code = await page.inputValue("#variation-code");
  await page.click("#variation-copy");
  await page.waitForSelector("#variation-note:has-text('copied')");
  await page.click("#variation-clear");
  const input = page.locator("#variation-code");
  await input.focus();
  await input.press("ControlOrMeta+v");
  assert.equal(await input.inputValue(), code);
  await page.click("#variation-replay");
  assert.deepEqual(await rows.allInnerTexts(), expected);
  assert.ok(await rows.first().locator("input").isChecked());
  await page.check("#variation-protect");
  await page.selectOption("#variation-reference-role", "Body silhouette");
  const picture = await viewportScreenshot(page);
  await page
    .locator("#variation-files")
    .setInputFiles({ name: "guide.png", mimeType: "image/png", buffer: picture });
  await page.waitForSelector("#variation-references button");
  await page.locator("#variation").scrollIntoViewIfNeeded();
  await captureWindow(page, join(out, "direction.png"));
  const items = expected.map((s) => s.trim().replace(/^Pin /, ""));
  async function briefFor(text: string) {
    await page.waitForSelector("#steering .steer-messages li:has-text('" + text + "')");
    const message = (await agent.call("inbox.read", {})).messages.find((m) =>
      m.text.includes(text),
    );
    assert.ok(message);
    for (const item of items) assert.ok(message.text.includes(item), item);
    assert.match(message.text, /Protected regions: p-body/);
    const request = (await agent.call("art.list", { documentId, all: true })).requests.find(
      (r) => r.messageId === message.messageId,
    );
    assert.ok(request);
    const brief = await agent.call("art.get", { artId: request.artId });
    assert.deepEqual(brief.brief.protected, ["p-body"]);
    const ref = brief.attachments.find((a) => a.role === "reference");
    assert.ok(ref);
    assert.equal(ref.label, "Body silhouette: guide.png");
    assert.deepEqual(brief.brief.variation?.cues, items.slice(0, 2));
    assert.deepEqual(
      brief.brief.variation?.choices.map((c) => c.label + " = " + c.value),
      items.slice(2),
    );
    const read = await agent.call("art.read", { artId: request.artId, digest: ref.digest });
    assert.deepEqual(Buffer.from(read.base64, "base64"), picture);
    return request;
  }
  await page.locator("#art select[aria-label='Kind of artwork']").selectOption("variation");
  await page.locator("#art textarea").fill("Try the artwork direction");
  await page.locator("#art").getByRole("button", { name: "Send brief" }).click();
  await briefFor("Try the artwork direction");
  await page.fill("#steering textarea", "Try the steering direction");
  await page.click("#steering button:has-text('Send to qa-agent')");
  const request = await briefFor("Try the steering direction");
  await page.uncheck("#variation-protect");
  await agent.call("inbox.ack", { messageId: request.messageId });
  const requestId = "qa-steering-protected-part";
  const changed = await agent.call("apply", {
    request: {
      format: "irudd.command",
      version: 1,
      documentId,
      expectedRevision: request.brief.revision,
      requestId,
      command: {
        type: "proposal.create",
        proposal: "prop-qa-locked",
        summary: "Stretch protected body",
        content: {
          kind: "ops",
          ops: [{ op: "part.set", part: "p-body", set: { size: [1, 1, 1] } }],
        },
      },
    },
  });
  assert.equal(changed.kind, "committed");
  await agent.call("inbox.applied", { messageId: request.messageId, requestId, documentId });
  const card = page.locator("#proposals .proposal").filter({ hasText: "Stretch protected body" });
  await card.locator(".protected-warning").waitFor();
  assert.match(await card.innerText(), /protected geometry:.*p-body/);
  await card.getByRole("button", { name: "Preview" }).click();
  await page.waitForSelector("#banner .protected-warning");
  await captureWindow(page, join(out, "protected-proposal.png"));
  await page.locator("#banner").getByRole("button", { name: "Reject" }).click();
  await card.waitFor({ state: "detached" });
}
