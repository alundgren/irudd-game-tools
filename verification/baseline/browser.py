"""G0 baseline: drive the unmodified reference build in hardware Chrome.

Run every subcommand under the shared GPU lock:
  powershell -NoProfile -File verification/baseline/gpu-lock.ps1 verification/baseline/browser.py SUBCOMMAND ...

  export BUILD_DIR OUT_DIR FORM... [--presets clay,full,game,portrait] [--reverse] [--outfits]
      Opens each saved form through the editor's own Forms > Open form input and downloads
      Export GLB at each GLB detail preset. --outfits also exports forms that have saved
      outfits with "Export all saved outfits as selectable scenes" ticked (suffix -outfits).
      A form whose envelope the editor rejects is recorded with the editor's message.
  adult BUILD_DIR OUT_DIR SEED... [--presets ...]
      Opens the editor's #adult=SEED&look=SEED route and exports at each preset.
  capture BUILD_DIR OUT_DIR GLB... [--repeat N]
      Opens each GLB through the standalone player's Character file input and captures the
      #stage element at fixed camera presets, a motion sample, an expression sample and the
      ink silhouette. Each repeat uses a fresh browser.

  references BUILD OUT_DIR
      Records what a build shows of the optional reference material: the Forms tab rig
      comparison link, the study list, the Fit a 3D reference model list, the #compare-mhr
      and #study=ID&compare=3d routes, and asset.copyright / asset.extras of a Game export of
      every "3D reference fits" study. Run it on a build with the private references and on
      the public build; exports stay in OUT_DIR (ignored cache) and only text is reported.
  flows BUILD OUT_DIR IMAGE
      Drives the offline (no provider) AI tab and the hybrid starting form: Generate a
      starting form with the hybrid plan, Save, Export GLB and reopen; Generate on the AI
      tab exports form-request.json, a local echo proposal answers it through Import
      proposal, then Show current, Inspect export, Accept and Discard; a stale proposal is
      rejected; IMAGE is attached as a visual reference and must appear in the next request.

The pages are driven through their shipped controls: file inputs, selects, checkboxes,
buttons and URL routes. Page scripts run only to read state: the WebGL renderer string,
#status, option lists, element visibility and the open dialog. The one write is in export
and flows, which clear the #status text before Open form or Import proposal so the wait
matches the editor's new message rather than the previous one. Every run records the
renderer, Chrome version, viewport and device scale factor and fails on a software renderer
unless --allow-software is given (the fallback is then named in the record).
"""
import argparse, hashlib, json, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright

VIEWPORT = {"width": 1280, "height": 800}
SOFTWARE = ("swiftshader", "llvmpipe", "softpipe", "basic render", "software", "gdi generic")
VIEWS = ["threequarter", "front", "side", "back", "overhead", "portrait", "portrait-side", "portrait-oblique"]


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def renderer_of(page, selector):
    return page.locator(selector).evaluate(
        "c=>{const g=c.getContext('webgl2')||c.getContext('webgl');const x=g&&g.getExtension('WEBGL_debug_renderer_info');"
        "return g?(x?g.getParameter(x.UNMASKED_RENDERER_WEBGL):g.getParameter(g.RENDERER)):null}")


def launch(pw):
    return pw.chromium.launch(channel="chrome")


def session_record(browser, page, renderer, args):
    software = renderer is None or any(k in renderer.lower() for k in SOFTWARE)
    if software and not args.allow_software:
        raise SystemExit(f"software renderer: {renderer}")
    return {"chrome": browser.version, "renderer": renderer, "softwareFallback": software,
            "viewport": VIEWPORT, "deviceScaleFactor": 1, "userAgent": page.evaluate("navigator.userAgent")}


def glb_brief(path):
    import struct
    data = Path(path).read_bytes(); n = struct.unpack_from("<I", data, 12)[0]; g = json.loads(data[20:20 + n])
    return {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(), "scenes": len(g.get("scenes", [])),
            "meshes": len(g.get("meshes", [])), "materials": len(g.get("materials", [])), "images": len(g.get("images", [])),
            "animations": len(g.get("animations", []))}


READY_ROUTE = "#study=ranger"


def open_editor(browser, build, fragment=READY_ROUTE):
    context = browser.new_context(viewport=VIEWPORT, device_scale_factor=1, accept_downloads=True)
    page = context.new_page(); errors = []
    page.on("pageerror", lambda ex: errors.append(str(ex)))
    page.goto((Path(build).resolve() / "character-view.html").as_uri() + fragment)
    if fragment == READY_ROUTE:
        page.wait_for_function("document.querySelector('#status')?.textContent.startsWith('Loaded')", timeout=300000)
    return context, page, errors


def export_current(page, out, name, presets, outfits, report):
    page.locator('[data-tab="files"]').click()
    variants = [(p, False) for p in presets]
    if outfits and page.locator("#export-outfit-field").is_visible():
        variants.append(("game", True))
    for preset, all_outfits in variants:
        page.locator("#export-detail").select_option(preset)
        if page.locator("#export-outfit-field").is_visible():
            page.locator("#all-outfits").set_checked(all_outfits)
        started = time.perf_counter()
        with page.expect_download(timeout=600000) as dl:
            page.locator("#glb").click()
        target = out / f"{name}-{preset}{'-outfits' if all_outfits else ''}.glb"
        dl.value.save_as(target)
        report[target.name] = {**glb_brief(target), "preset": preset, "allOutfits": all_outfits,
                               "exportSeconds": round(time.perf_counter() - started, 2),
                               "status": page.locator("#status").text_content()}
        print(target.name, json.dumps(report[target.name]), flush=True)


def cmd_export(args):
    out = Path(args.out); out.mkdir(parents=True, exist_ok=True)
    forms = [Path(f).resolve() for f in args.forms]
    if args.reverse: forms.reverse()
    presets = args.presets.split(",")
    report, rejected = {}, {}
    with sync_playwright() as pw:
        browser = launch(pw)
        context, page, errors = open_editor(browser, args.build)
        session = session_record(browser, page, renderer_of(page, "#viewport"), args)
        print(json.dumps(session), flush=True)
        for form in forms:
            name = form.name.replace(".form.json", "")
            page.evaluate("document.querySelector('#status').textContent=''")
            page.locator("#openfile").set_input_files(str(form))
            page.wait_for_function("(()=>{const t=document.querySelector('#status').textContent;return t.includes('Form opened')||/Choose|Invalid|exceeds|Unknown|Keep|unavailable/.test(t)})()", timeout=300000)
            status = page.locator("#status").text_content()
            if "Form opened" not in status:
                rejected[form.name] = status; print("REJECTED", form.name, status, flush=True); continue
            export_current(page, out, name, presets, args.outfits, report)
        context.close()
        browser.close()
    record = {"command": "export", "build": str(Path(args.build).resolve()), "buildFiles": {f.name: sha(f) for f in Path(args.build).glob("*.html")},
              "order": "reverse" if args.reverse else "forward", "readyRoute": READY_ROUTE, "session": session, "presets": presets,
              "forms": {f.name: sha(f) for f in forms}, "files": report, "rejected": rejected, "pageErrors": errors}
    (out / "export.json").write_text(json.dumps(record, indent=2), encoding="utf8")
    if errors: print("PAGE ERRORS", errors, file=sys.stderr)


def cmd_adult(args):
    out = Path(args.out); out.mkdir(parents=True, exist_ok=True)
    presets = args.presets.split(","); report = {}; statuses = {}
    with sync_playwright() as pw:
        browser = launch(pw)
        for seed in args.seeds:
            context, page, errors = open_editor(browser, args.build, f"#adult={seed}&look={seed}")
            page.wait_for_function(f"document.querySelector('#status').textContent.includes('Opened adult draw {seed}')", timeout=300000)
            session = session_record(browser, page, renderer_of(page, "#viewport"), args)
            statuses[seed] = page.locator("#status").text_content()
            export_current(page, out, f"adult-look-{seed}", presets, False, report)
            if errors: statuses[seed] += " | page errors: " + "; ".join(errors)
            context.close()
        browser.close()
    (out / "export.json").write_text(json.dumps({"command": "adult", "build": str(Path(args.build).resolve()), "session": session, "presets": presets, "statuses": statuses, "files": report}, indent=2), encoding="utf8")


def settle(page, element, limit=40):
    """Screenshot until two consecutive frames are byte-identical (orbit damping has stopped)."""
    last = None
    for i in range(limit):
        page.wait_for_timeout(150)
        shot = element.screenshot()
        if shot == last: return shot, i
        last = shot
    return last, limit


def cmd_capture(args):
    out = Path(args.out); out.mkdir(parents=True, exist_ok=True)
    runs = []
    with sync_playwright() as pw:
        for repeat in range(args.repeat):
            browser = launch(pw)
            context = browser.new_context(viewport=VIEWPORT, device_scale_factor=1)
            page = context.new_page(); errors = []
            page.on("pageerror", lambda ex: errors.append(str(ex)))
            page.goto((Path(args.build).resolve() / "play-model.html").as_uri())
            session = session_record(browser, page, renderer_of(page, "#stage canvas"), args)
            stage = page.locator("#stage")
            shots = {}
            for glb in args.glbs:
                glb = Path(glb).resolve(); key = glb.stem
                page.locator("#file").set_input_files(str(glb))
                page.wait_for_function(f"document.querySelector('#status').textContent.startsWith({json.dumps(glb.name + ' · ')})", timeout=300000)
                status = page.locator("#status").text_content(); stats = page.locator("#stats").text_content()
                page.locator("#playing").set_checked(False)
                page.locator("#clip").select_option("")
                portrait_ok = not page.locator('#camera-angle option[value="portrait"]').is_disabled()
                entry = {"glb": str(glb), "sha256": sha(glb), "status": status, "stats": stats, "portraitAvailable": portrait_ok, "shots": {}}
                d = out / f"r{repeat}" / key; d.mkdir(parents=True, exist_ok=True)

                def take(label):
                    png, waits = settle(page, stage)
                    (d / f"{label}.png").write_bytes(png)
                    entry["shots"][label] = {"sha256": hashlib.sha256(png).hexdigest(), "settleFrames": waits}

                for view in VIEWS:
                    if view.startswith("portrait") and not portrait_ok: continue
                    page.locator("#camera-angle").select_option(view)
                    take(view)
                clips = [o for o in page.locator("#clip option").evaluate_all("os=>os.map(o=>o.value)") if o]
                entry["clips"] = clips
                if clips:
                    page.locator("#camera-angle").select_option("threequarter")
                    page.locator("#clip").select_option(clips[0])
                    page.locator("#playing").set_checked(False)
                    page.locator("#time").fill("0.5")
                    take(f"motion-{clips[0].lower().replace(' ', '-')}-0.5")
                    page.locator("#clip").select_option("")
                expressions = [o for o in page.locator("#expression option").evaluate_all("os=>os.map(o=>o.value)") if o]
                entry["expressions"] = expressions
                if expressions and portrait_ok:
                    page.locator("#camera-angle").select_option("portrait")
                    page.locator("#expression").select_option(expressions[0])
                    take(f"expression-{expressions[0]}")
                    page.locator("#expression").select_option("")
                page.locator("#camera-angle").select_option("front")
                page.locator("#surface").select_option("ink")
                take("silhouette-front")
                page.locator("#surface").select_option(index=0)
                shots[key] = entry
                print(f"r{repeat} {key} {len(entry['shots'])} shots", flush=True)
            runs.append({"repeat": repeat, "session": session, "pageErrors": errors, "glbs": shots})
            context.close(); browser.close()
    record = {"command": "capture", "build": str(Path(args.build).resolve()), "player": sha(Path(args.build) / "play-model.html"),
              "views": VIEWS, "runs": runs}
    (out / "capture.json").write_text(json.dumps(record, indent=2), encoding="utf8")


def content_digest(path):
    """Encoding-independent GLB content digest from glb.mjs beside this script."""
    import subprocess
    res = subprocess.run(["node", str(Path(__file__).resolve().parent / "glb.mjs"), str(path)], capture_output=True, text=True, check=True)
    return json.loads(res.stdout.splitlines()[0])["contentDigest"]


def glb_asset(path):
    """asset.copyright and asset.extras of a GLB, with long licence text replaced by its hash."""
    import struct
    data = Path(path).read_bytes(); n = struct.unpack_from("<I", data, 12)[0]; asset = json.loads(data[20:20 + n]).get("asset", {})
    extras = json.loads(json.dumps(asset.get("extras"))) if asset.get("extras") is not None else None
    if isinstance(extras, dict) and isinstance(extras.get("license"), str) and len(extras["license"]) > 200:
        text = extras["license"]
        extras["license"] = {"sha256": hashlib.sha256(text.encode()).hexdigest(), "lfSha256": hashlib.sha256(text.replace("\r\n", "\n").encode()).hexdigest(),
                             "chars": len(text), "firstLine": text.strip().splitlines()[0].strip()}
    return {"copyright": asset.get("copyright"), "extras": extras}


def wait_status(page, test, timeout=300000):
    page.wait_for_function(f"(()=>{{const t=document.querySelector('#status')?.textContent??'';return {test}}})()", timeout=timeout)
    return page.locator("#status").text_content()


def options(page, selector):
    return page.locator(selector).evaluate("s=>[...s.options].map(o=>[o.value,o.textContent])") if page.locator(selector).count() else None


def cmd_references(args):
    out = Path(args.out); out.mkdir(parents=True, exist_ok=True)
    editor = (Path(args.build).resolve() / "character-view.html").as_uri()
    record = {"command": "references", "build": str(Path(args.build).resolve()),
              "buildFiles": {f.name: sha(f) for f in sorted(Path(args.build).glob("*.html"))}, "routes": {}, "studies": {}}
    with sync_playwright() as pw:
        browser = launch(pw)
        context, page, errors = open_editor(browser, args.build)
        record["session"] = session_record(browser, page, renderer_of(page, "#viewport"), args)
        page.locator('[data-tab="files"]').click()
        record["formsTab"] = {"compareMhrLinks": page.locator('a[href="#compare-mhr"]').count(),
                              "compareMhrLinkText": page.locator('a[href="#compare-mhr"]').first.text_content() if page.locator('a[href="#compare-mhr"]').count() else None}
        studies = options(page, "#studies")
        record["studyList"] = {"count": len(studies), "referenceFits": [s for s in studies if s[1].endswith(" · 3D reference fits")]}
        record["pageErrors"] = errors
        context.close()
        context, page, errors = open_editor(browser, args.build, "#adult=42")
        wait_status(page, "t.includes('Opened adult draw 42')")
        page.locator('[data-tab="sculpt"]').click()
        page.locator("#human-fit-open").click()
        page.wait_for_timeout(1500)
        record["fit3dReference"] = {"route": "#adult=42", "openDialog": page.evaluate("document.querySelector('dialog[open]')?.id ?? null"),
                                    "modelList": options(page, "#hfit-source"), "pageErrors": errors}
        context.close()
        for value, label in record["studyList"]["referenceFits"]:
            context, page, errors = open_editor(browser, args.build, f"#study={value}")
            status = wait_status(page, "t.startsWith('Loaded')||t.startsWith('Unknown')")
            report = {}
            export_current(page, out, value, ["game"], False, report)
            name = f"{value}-game.glb"
            record["studies"][value] = {"label": label, "status": status, "export": {**{k: report[name][k] for k in ("bytes", "sha256", "status")}, "contentDigest": content_digest(out / name)},
                                        "asset": glb_asset(out / name), "pageErrors": errors}
            context.close()
        for value, _ in record["studyList"]["referenceFits"][:2] or [("mhr-f1", None)]:
            context, page, errors = open_editor(browser, args.build, f"#study={value}&compare=3d")
            try: wait_status(page, "t.startsWith('Loaded')||t.startsWith('Unknown')", 120000)
            except Exception: pass
            page.wait_for_timeout(4000)
            record["routes"][f"#study={value}&compare=3d"] = {"status": page.locator("#status").text_content(),
                "openDialog": page.evaluate("document.querySelector('dialog[open]')?.id ?? null"),
                "modelChosen": page.locator("#hfit-source").input_value() if page.locator("#hfit-source").count() else None,
                "pageErrors": errors}
            context.close()
        context = browser.new_context(viewport=VIEWPORT, device_scale_factor=1); page = context.new_page(); errors = []
        page.on("pageerror", lambda ex: errors.append(str(ex)))
        page.goto(editor + "#compare-mhr"); page.wait_for_timeout(8000)
        record["routes"]["#compare-mhr"] = {"finalPage": page.url.rsplit("/", 1)[-1], "title": page.title(),
                                           "status": page.locator("#status").first.text_content() if page.locator("#status").count() else None, "pageErrors": errors}
        context.close()
        rig = Path(args.build) / "rig-study.html"
        if rig.exists():
            context = browser.new_context(viewport=VIEWPORT, device_scale_factor=1); page = context.new_page(); errors = []
            page.on("pageerror", lambda ex: errors.append(str(ex)))
            page.goto(rig.resolve().as_uri())
            try: page.wait_for_function("!document.querySelector('#status')?.textContent.startsWith('Loading')", timeout=120000)
            except Exception: pass
            record["rigStudyPage"] = {"title": page.title(), "status": page.locator("#status").text_content(),
                                      "renderer": renderer_of(page, "canvas") if page.locator("canvas").count() else None, "pageErrors": errors}
            context.close()
        browser.close()
    (out / "references.json").write_text(json.dumps(record, indent=2), encoding="utf8")
    print(json.dumps(record, indent=1))


def cmd_flows(args):
    out = Path(args.out); out.mkdir(parents=True, exist_ok=True)
    record = {"command": "flows", "build": str(Path(args.build).resolve()),
              "buildFiles": {f.name: sha(f) for f in sorted(Path(args.build).glob("*.html"))}, "image": {"file": args.image, "sha256": sha(args.image)}}
    clear = "document.querySelector('#status').textContent=''"
    with sync_playwright() as pw:
        browser = launch(pw)
        context, page, errors = open_editor(browser, args.build)
        record["session"] = session_record(browser, page, renderer_of(page, "#viewport"), args)
        hybrids = []
        for i in range(args.hybrids):
            page.locator('[data-tab="files"]').click()
            page.locator("#body-plan").select_option("hybrid")
            page.evaluate(clear)
            page.locator("#fresh").click()
            status = wait_status(page, "t.length>0")
            page.locator('[data-tab="files"]').click()
            with page.expect_download() as dl:
                page.locator("#save").click()
            saved = out / f"hybrid-{i}.form.json"; dl.value.save_as(saved)
            form = json.loads(saved.read_text(encoding="utf8"))["form"]
            report = {}
            export_current(page, out, f"hybrid-{i}", ["game"], False, report)
            hybrids.append({"status": status, "origin": form.get("origin"), "parts": len(form.get("parts", [])),
                            "artwork": len(form.get("artwork", {})), "formSha256": sha(saved),
                            "export": {**{k: report[f"hybrid-{i}-game.glb"][k] for k in ("bytes", "sha256", "status")},
                                       "contentDigest": content_digest(out / f"hybrid-{i}-game.glb")}})
        record["hybrid"] = {"generated": hybrids, "pageErrors": list(errors)}
        context.close()
        context, page, errors = open_editor(browser, args.build)
        for i, h in enumerate(hybrids):
            page.evaluate(clear)
            page.locator("#openfile").set_input_files(str(out / f"hybrid-{i}.form.json"))
            h["reopenStatus"] = wait_status(page, "t.length>0")
            report = {}
            export_current(page, out, f"hybrid-{i}-reopened", ["game"], False, report)
            h["reopenedExport"] = {**{k: report[f"hybrid-{i}-reopened-game.glb"][k] for k in ("bytes", "sha256", "status")},
                                   "contentDigest": content_digest(out / f"hybrid-{i}-reopened-game.glb")}
            h["reopenedSameContent"] = h["reopenedExport"]["contentDigest"] == h["export"]["contentDigest"]
        record["hybrid"]["reopenPageErrors"] = errors
        context.close()

        context, page, errors = open_editor(browser, args.build)
        ai = record["proposal"] = {"connected": page.evaluate("document.querySelector('meta[name=\"workshop-agent\"]')?.content ?? null"), "rounds": []}
        page.locator('[data-tab="ai"]').click()
        ai["paintGenerate"] = {"hidden": not page.locator("#paint-generate").is_visible(), "paintActions": options(page, "#paint-action")}

        def request(name):
            page.locator("#steering").fill("Broaden the shoulders a little.")
            page.evaluate(clear)
            with page.expect_download() as dl:
                page.locator("#generate").click()
            target = out / name; dl.value.save_as(target)
            return json.loads(target.read_text(encoding="utf8")), wait_status(page, "t.length>0")

        def answer(req, name, request_id=None):
            proposal = {"format": "irudd.form-proposal.v1", "requestId": request_id or req["requestId"], "revision": req["revision"],
                        "summary": "G0 offline echo: the preview unchanged.", "operations": []}
            (out / name).write_text(json.dumps(proposal), encoding="utf8")
            page.evaluate(clear)
            page.locator("#file").set_input_files(str(out / name))
            return wait_status(page, "t.length>0")

        visible = lambda s: page.locator(s).is_visible()
        for decision in ("accept", "discard"):
            req, req_status = request(f"request-{decision}.json")
            row = {"requestStatus": req_status, "requestKeys": sorted(req), "references": [{"role": r.get("role"), "label": r.get("label")} for r in req.get("references", [])]}
            row["staleProposal"] = answer(req, f"stale-{decision}.json", request_id="not-" + str(req["requestId"]))
            row["importStatus"] = answer(req, f"proposal-{decision}.json")
            row["review"] = {s: visible(s) for s in ("#compare", "#accept", "#discard", "#inspect-export", "#export-review-compare", "#refine-send")}
            page.locator("#compare").click(); row["compareText"] = page.locator("#compare").text_content()
            page.locator("#compare").click(); row["compareTextAgain"] = page.locator("#compare").text_content()
            if decision == "accept":
                page.evaluate(clear)
                page.locator("#inspect-export").click()
                row["inspectStatus"] = wait_status(page, "t.length>0&&!t.startsWith('Exporting')", 600000)
                row["afterInspect"] = {s: visible(s) for s in ("#inspect-export", "#export-review-compare", "#refine-send")}
                row["refineSend"] = {"text": page.locator("#refine-send").text_content(), "disabled": page.locator("#refine-send").is_disabled()}
                refinements = []
                for k in range(2):
                    page.evaluate(clear)
                    with page.expect_download() as dl:
                        page.locator("#refine-send").click()
                    target = out / f"refinement-request-{k}.json"; dl.value.save_as(target)
                    brief = json.loads(target.read_text(encoding="utf8"))
                    review = brief.get("refinement", {}).get("exportReview") or {}
                    step = {"status": wait_status(page, "t.length>0"), "round": brief.get("refinement", {}).get("round"),
                            "exportReviewKeys": sorted(review), "previousReview": "previous" in review,
                            "attachments": review.get("attachments"), "views": [v.get("name") for v in brief.get("views", [])]}
                    step["replyStatus"] = answer(brief, f"refinement-{k}.json")
                    page.evaluate(clear)
                    page.locator("#inspect-export").click()
                    step["inspectStatus"] = wait_status(page, "t.length>0&&!t.startsWith('Exporting')", 600000)
                    step["afterInspect"] = {s: visible(s) for s in ("#export-review-compare", "#refine-back")}
                    if step["afterInspect"]["#export-review-compare"]:
                        step["compareButton"] = page.locator("#export-review-compare").text_content()
                        page.locator("#export-review-compare").click()
                        step["compareButtonPressed"] = page.locator("#export-review-compare").text_content()
                        page.locator("#export-review-compare").click()
                    refinements.append(step)
                page.evaluate(clear)
                page.locator("#refine-back").click()
                row["refineBack"] = {"status": page.locator("#status").text_content(), "refineBackVisible": visible("#refine-back")}
                row["refinements"] = refinements
            page.evaluate(clear)
            page.locator("#" + decision).click()
            row["decisionStatus"] = wait_status(page, "t.length>0")
            ai["rounds"].append(row)
            if decision == "accept":
                page.evaluate(clear)
                page.locator("#reference-file").set_input_files(args.image)
                ai["referenceAttach"] = {"status": wait_status(page, "t.length>0"), "roles": options(page, "#reference-role")}
        ai["pageErrors"] = errors
        context.close(); browser.close()
    (out / "flows.json").write_text(json.dumps(record, indent=2), encoding="utf8")
    print(json.dumps(record, indent=1))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--allow-software", action="store_true")
    sub = ap.add_subparsers(dest="cmd", required=True)
    e = sub.add_parser("export"); e.add_argument("build"); e.add_argument("out"); e.add_argument("forms", nargs="+")
    e.add_argument("--presets", default="clay,full,game,portrait"); e.add_argument("--reverse", action="store_true"); e.add_argument("--outfits", action="store_true")
    a = sub.add_parser("adult"); a.add_argument("build"); a.add_argument("out"); a.add_argument("seeds", nargs="+"); a.add_argument("--presets", default="game,portrait")
    c = sub.add_parser("capture"); c.add_argument("build"); c.add_argument("out"); c.add_argument("glbs", nargs="+"); c.add_argument("--repeat", type=int, default=1)
    r = sub.add_parser("references"); r.add_argument("build"); r.add_argument("out")
    f = sub.add_parser("flows"); f.add_argument("build"); f.add_argument("out"); f.add_argument("image"); f.add_argument("--hybrids", type=int, default=3)
    args = ap.parse_args()
    {"export": cmd_export, "adult": cmd_adult, "capture": cmd_capture, "references": cmd_references, "flows": cmd_flows}[args.cmd](args)
