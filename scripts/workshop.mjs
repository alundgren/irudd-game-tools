import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export function workshopServer(page) {
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
    if (req.method === "GET" && ["/","/dist/character-view.html"].includes(req.url)) {
      let html = page;
      if (html === undefined) {
        try {
          html = await readFile(
            new URL("../dist/character-view.html", import.meta.url),
            "utf8",
          );
        } catch {
          return json(503, { error: "Build the editor with npm run build." });
        }
      }
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      });
      return res.end(html);
    }
    if (req.method === "GET") {
      const file =
        ["/play-model.html","/dist/play-model.html"].includes(req.url)
          ? "dist/play-model.html"
          : /^\/examples\/human-targets\/mhr-[fm][123]\.glb$/.test(req.url)
            ? req.url.slice(1)
          : /^\/(?:docs\/(?:[a-z0-9-]+\.(?:html|md)|licenses\/[a-z0-9-]+\.(?:md|txt)|media\/(?:[a-z0-9-]+\/)?[a-z0-9-]+\.(?:webp|png|json))|examples\/[a-z0-9-]+(?:\.form\.json|\.glb)|README\.md|LICENSE)$/.test(
                req.url,
              )
            ? req.url.slice(1)
            : null;
      if (file) {
        try {
          const bytes = await readFile(new URL("../" + file, import.meta.url));
          const types = {
            html: "text/html; charset=utf-8",
            webp: "image/webp",
            png: "image/png",
            json: "application/json",
            glb: "model/gltf-binary",
          };
          res.writeHead(200, {
            "Content-Type":
              types[file.split(".").at(-1)] ?? "text/plain; charset=utf-8",
            "X-Content-Type-Options": "nosniff",
          });
          return res.end(bytes);
        } catch {
          return json(404, { error: "File unavailable." });
        }
      }
    }
    return json(404, {error:"Unknown route."});
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const server = workshopServer();
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
