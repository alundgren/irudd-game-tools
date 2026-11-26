"""Exercise the original workshop repaint path with a deterministic local turnaround reply.

Run under gpu-lock.ps1 with the path to a built 2761eb14 checkout and an output directory.
Only the document and the canned turnaround request are served by Playwright. No worker runs.
"""
import argparse
import base64
import hashlib
import io
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from PIL import Image
from playwright.sync_api import sync_playwright
from browser import READY_ROUTE, VIEWPORT, launch, renderer_of, session_record, sha


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("checkout", type=Path)
    parser.add_argument("out", type=Path)
    args = parser.parse_args()
    args.allow_software = False
    args.out.mkdir(parents=True, exist_ok=True)
    checkout = args.checkout.resolve()
    form_path = checkout / "examples/harbour-trader.form.json"
    html = checkout / "dist/character-view.html"
    image_path = checkout / "character-view/courier.atlas.webp"
    source = html.read_bytes().replace(
        b"</head>", b'<meta name="workshop-agent" content="local"></head>', 1)
    png = io.BytesIO()
    with Image.open(image_path) as image:
        image.save(png, "PNG")
    reply = base64.b64encode(png.getvalue()).decode("ascii")
    calls, errors = [], []
    class DocumentHandler(BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path != "/character-view.html":
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(source)))
            self.end_headers()
            self.wfile.write(source)

    server = ThreadingHTTPServer(("127.0.0.1", 0), DocumentHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f"http://127.0.0.1:{server.server_port}"
    address = origin + "/character-view.html"

    def serve(route):
        req = route.request
        if req.url == address and req.method == "GET":
            route.continue_()
        elif req.url == origin + "/turnaround" and req.method == "POST":
            payload = req.post_data_json
            calls.append({"target": payload["paintTarget"], "resurface": payload["resurface"],
                          "viewCount": len(payload["views"]), "sourceView": bool(payload["sourceView"]),
                          "revision": payload["revision"], "requestId": payload["requestId"]})
            route.fulfill(json={"requestId": payload["requestId"], "revision": payload["revision"],
                                "png": reply, "summary": "Local courier atlas fixture"})
        else:
            errors.append(f"Unexpected request {req.method} {req.url}")
            route.abort()

    def open_page(browser):
        ctx = browser.new_context(viewport=VIEWPORT, device_scale_factor=1, accept_downloads=True)
        ctx.route("http://**/*", serve)
        ctx.route("https://**/*", serve)
        page = ctx.new_page()
        page.on("pageerror", lambda ex: errors.append(str(ex)))
        page.goto(address + READY_ROUTE)
        try:
            page.wait_for_function("document.querySelector('#status')?.textContent.startsWith('Loaded')", timeout=60000)
        except Exception as exc:
            raise RuntimeError(f"Startup status: {page.locator('#status').all_text_contents()}, {errors}") from exc
        return ctx, page

    def load_form(page, path):
        page.locator("#openfile").set_input_files(str(path))
        page.wait_for_function("document.querySelector('#status')?.textContent.includes('Form opened')")

    def save_form(page, path):
        page.locator('[data-tab="files"]').click()
        with page.expect_download() as download:
            page.locator("#save").click()
        download.value.save_as(path)
        return json.loads(path.read_bytes())["form"]

    with server, sync_playwright() as pw:
        browser = launch(pw)
        ctx, page = open_page(browser)
        run = session_record(browser, page, renderer_of(page, "#viewport"), args)
        load_form(page, form_path)
        # The same target dropdown is used by the sculpt and direction panels.
        page.locator("#target").select_option("body", force=True)
        page.locator('[data-tab="ai"]').click()
        page.locator("#paint-action").select_option("repaint")
        page.locator("#repaint-branch").uncheck()
        page.locator("#steering").fill("Repaint the selected body with the supplied courier sheet.")
        page.locator("#paint-generate").click()
        try:
            page.locator("#accept").wait_for(state="visible", timeout=60000)
        except Exception as exc:
            raise RuntimeError(f"Paint status: {page.locator('#status').inner_text()}, {calls}, {errors}") from exc
        page.locator("#compare").click()
        page.locator("#compare").click()
        page.locator("#accept").click()
        saved_path = args.out / "painted.form.json"
        saved = save_form(page, saved_path)
        ctx.close()
        ctx, page = open_page(browser)
        load_form(page, saved_path)
        reopened = save_form(page, args.out / "reopened.form.json")
        ctx.close()
        browser.close()

    before = json.loads(form_path.read_bytes())["form"]
    bindings = lambda form: {p["id"]: (p.get("paint") or p.get("hull") or {}).get("atlas") for p in form["parts"]}
    old, new = bindings(before), bindings(saved)
    changed = [key for key in old if old[key] != new[key]]
    assert len(calls) == 1 and calls[0]["target"] == "body" and calls[0]["resurface"] and calls[0]["sourceView"], calls
    assert old.keys() == new.keys() and changed == ["body"], changed
    atlas = new["body"]
    blob = base64.b64decode(saved["artwork"][atlas].split(",", 1)[1], validate=True)
    assert atlas == "art-" + hashlib.sha256(blob).hexdigest(), atlas
    assert saved == reopened and not errors, errors
    result = {"session": run, "build": sha(html), "sourceForm": sha(form_path), "replySource": sha(image_path),
              "calls": calls, "changedAtlasBindings": changed, "acceptedAtlas": atlas,
              "artworkBytes": len(blob), "artworkSha256": hashlib.sha256(blob).hexdigest(),
              "wholeFormEqualAfterReopen": True, "pageErrors": errors}
    (args.out / "paint.json").write_text(json.dumps(result, indent=2), encoding="utf8")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
