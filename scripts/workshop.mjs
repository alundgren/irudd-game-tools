import { agentDesign } from "../character-view/variations.js";
import { createServer } from "node:http";
import { paintVariation, fitArtwork } from "./art-direction.mjs";
import { codexJob } from "./codex-worker.mjs";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateForm, readProposal } from "../character-view/recipe.js";

export async function codexVariation(brief, signal) {
  const prompt =
    "You are the geometry author for a game character editor. Use the JSON brief as design input. Do not use tools, access the filesystem or execute code. Return a single JSON proposal following replyFormat. Preserve ids on retained parts.\n" +
    JSON.stringify(agentDesign(brief));
  return (
    await codexJob(
      prompt,
      (brief.views ?? []).map((v) => ({ data: v.jpeg })),
      signal,
    )
  ).result;
}
export function workshopServer(
  page,
  generate = codexVariation,
  art = { paint: paintVariation, fit: fitArtwork },
) {
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
    if (
      req.method !== "POST" ||
      !["/variation", "/turnaround", "/trace-map"].includes(req.url)
    )
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
    const timeout = setTimeout(
      () => controller.abort(),
      req.url === "/turnaround" ? 420_000 : 240_000,
    );
    res.on("close", () => {
      if (!res.writableEnded) controller.abort();
    });
    try {
      const chunks = [];
      let length = 0;
      for await (const chunk of req) {
        length += chunk.length;
        chunks.push(chunk);
        if (length > 8_000_000)
          return json(413, { error: "Form is too large." });
      }
      let brief;
      try {
        brief = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (
          (req.url === "/trace-map"
            ? brief.format !== "irudd.trace-request.v1"
            : brief.format !== "irudd.form-request.v1") ||
          typeof brief.requestId !== "string" ||
          typeof brief.revision !== "string" ||
          typeof brief.instructions !== "string" ||
          brief.instructions.length > 2000
        )
          throw new Error("Malformed variation request.");
        if (req.url === "/variation") {
          validateForm(brief.current);
          validateForm(brief.preview);
        } else if (
          !Number.isFinite(brief.height) ||
          brief.height < 0.15 ||
          brief.height > 6 ||
          !Array.isArray(brief.views) ||
          brief.views.length !== 2
        )
          throw new Error("Artwork needs two views and a physical height.");
        if (brief.repair && JSON.stringify(brief.repair).length > 60000)
          throw new Error("The repair map is too large.");
        if (
          brief.views &&
          (!Array.isArray(brief.views) ||
            brief.views.length > 2 ||
            brief.views.some(
              (v) =>
                typeof v.jpeg !== "string" ||
                v.jpeg.length > (req.url === "/trace-map" ? 850000 : 170000) ||
                !v.jpeg.startsWith("/9j/"),
            ))
        )
          throw new Error("Invalid camera views.");
      } catch (err) {
        return json(400, { error: err.message });
      }
      if (req.url === "/turnaround")
        return json(200, await art.paint(brief, controller.signal));
      if (req.url === "/trace-map")
        return json(200, await art.fit(brief, controller.signal));
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
