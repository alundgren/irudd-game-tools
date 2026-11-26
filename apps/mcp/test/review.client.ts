import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const register = pathToFileURL(path.join(root, "packages/document/test/support/register.ts")).href;
const mcpMain = path.join(root, "apps/mcp/src/main.ts");

const { values } = parseArgs({
  options: {
    credential: { type: "string" },
    out: { type: "string" },
    document: { type: "string" },
    preset: { type: "string" },
    width: { type: "string" },
    "pixel-ratio": { type: "string" },
    inline: { type: "string" },
    wardrobe: { type: "string" },
  },
});
const credential = values.credential;
const out = values.out;
const documentId = values.document;
assert.ok(credential && out && documentId, "give --credential, --out and --document");
fs.mkdirSync(out, { recursive: true });

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
const field = (value: unknown, ...keys: Array<string | number>): unknown =>
  keys.reduce<unknown>(
    (v, k) => (typeof v === "object" && v !== null ? Reflect.get(v, k) : undefined),
    value,
  );

interface Block {
  readonly type: string;
  readonly text?: string;
  readonly data?: string;
  readonly mimeType?: string;
}

function blocks(result: unknown): Block[] {
  const content = field(result, "content");
  return Array.isArray(content)
    ? content.map((b: unknown) => ({
        type: String(field(b, "type")),
        ...(typeof field(b, "text") === "string" ? { text: String(field(b, "text")) } : {}),
        ...(typeof field(b, "data") === "string" ? { data: String(field(b, "data")) } : {}),
        ...(typeof field(b, "mimeType") === "string"
          ? { mimeType: String(field(b, "mimeType")) }
          : {}),
      }))
    : [];
}

function manifestOf(result: unknown): unknown {
  const text = blocks(result)[0]?.text ?? "";
  const split = text.indexOf("\n\n");
  return split >= 0 ? JSON.parse(text.slice(split + 2)) : null;
}

const env: Record<string, string> = Object.fromEntries(
  Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === "string"),
);
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["--import", register, mcpMain, "--credential", credential],
  env,
  stderr: "pipe",
});
const client = new Client({ name: "review-gate", version: "1.0.0" });
const started = performance.now();
const timings: Record<string, number> = {};
const time = async <T>(name: string, run: () => Promise<T>): Promise<T> => {
  const t = performance.now();
  try {
    return await run();
  } finally {
    timings[name] = Math.round(performance.now() - t);
  }
};
try {
  await time("initialize", () => client.connect(transport));
  const tools = (await client.listTools()).tools.map((t) => t.name).sort();
  const capabilities = await time("review_capabilities", () =>
    client.callTool({ name: "review_capabilities", arguments: {} }),
  );
  const exported = await time("export_character", () =>
    client.callTool({
      name: "export_character",
      arguments: { documentId, preset: values.preset ?? "clay" },
    }),
  );
  const wardrobeId = values.wardrobe;
  const wardrobe =
    wardrobeId === undefined
      ? undefined
      : await time("export_character wardrobe", () =>
          client.callTool({
            name: "export_character",
            arguments: { documentId: wardrobeId, preset: values.preset ?? "clay", wardrobe: true },
          }),
        );
  const inspected = await time("inspect_character", () =>
    client.callTool({
      name: "inspect_character",
      arguments: {
        documentId,
        preset: values.preset ?? "clay",
        width: Number(values.width ?? 768),
        pixelRatio: Number(values["pixel-ratio"] ?? 2),
        inline: Number(values.inline ?? 12),
      },
    }),
  );
  const manifest = manifestOf(inspected);
  const listed = field(manifest, "images");
  const images = Array.isArray(listed) ? listed : [];
  const content = blocks(inspected);
  const received: Array<{
    name: string;
    sha256: string;
    received: string;
    mimeType: string;
    bytes: number;
    file: string;
  }> = [];
  for (let i = 1; i < content.length; i += 2) {
    const caption = content[i];
    const image = content[i + 1];
    assert.equal(caption?.type, "text");
    assert.equal(image?.type, "image");
    const name = /^(\S+)/.exec(caption?.text ?? "")?.[1] ?? `image-${i}`;
    const listedSha = /sha256 ([0-9a-f]{64})/.exec(caption?.text ?? "")?.[1] ?? "";
    const bytes = new Uint8Array(Buffer.from(image?.data ?? "", "base64"));
    const file = path.join(out, name);
    fs.writeFileSync(file, bytes);
    received.push({
      name,
      sha256: listedSha,
      received: sha256(bytes),
      mimeType: image?.mimeType ?? "",
      bytes: bytes.byteLength,
      file,
    });
  }
  const last: unknown = images.at(-1);
  const lastSha = String(field(last, "sha256"));
  const again = await time("review_image", () =>
    client.callTool({ name: "review_image", arguments: { sha256: lastSha } }),
  );
  const againImage = blocks(again).find((b) => b.type === "image");
  const unknown = await client.callTool({
    name: "review_image",
    arguments: { sha256: "0".repeat(64) },
  });
  const report = {
    tools,
    capabilities: { isError: capabilities.isError === true, value: manifestOf(capabilities) },
    export: { isError: exported.isError === true, value: manifestOf(exported) },
    ...(wardrobe
      ? {
          wardrobe: {
            isError: wardrobe.isError === true,
            summary: (blocks(wardrobe)[0]?.text ?? "").split("\n\n")[0],
            value: manifestOf(wardrobe),
          },
        }
      : {}),
    inspect: {
      isError: inspected.isError === true,
      summary: (content[0]?.text ?? "").split("\n\n")[0],
      manifest,
      received,
    },
    reviewImage: {
      sha256: lastSha,
      received: againImage ? sha256(Buffer.from(againImage.data ?? "", "base64")) : null,
    },
    unknownImage: {
      isError: unknown.isError === true,
      summary: (blocks(unknown)[0]?.text ?? "").split("\n")[0],
    },
    timings: { ...timings, totalMs: Math.round(performance.now() - started) },
  };
  fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2) + "\n");
} finally {
  await client.close();
}
