"""Open all 32 frozen playback fixtures in the built offline player through its file input.

Run under verification/baseline/gpu-lock.ps1. Chrome stays offline throughout the check.
Supply --camera-reference and --export-report to exercise both players with verified fresh GLBs.
"""
import argparse
import hashlib
import io
import json
import re
import shutil
from pathlib import Path
from tempfile import TemporaryDirectory
from PIL import Image, ImageChops
from playwright.sync_api import expect, sync_playwright


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def stable_frame(stage):
    previous = None
    for _ in range(12):
        png = stage.screenshot()
        if png == previous:
            return Image.open(io.BytesIO(png)).convert("RGB")
        previous = png
    raise AssertionError("Paused player did not produce two consecutive identical frames")


def check_fresh_exports(original, current, gate_file):
    gate = json.loads(gate_file.read_bytes())
    if gate["failures"] or not gate["verifiedExports"]:
        raise ValueError("Use a family export report with verified files and no failed comparisons")
    rows = []
    def control(label):
        return current.locator("label").filter(has=current.get_by_text(label, exact=True)).locator("select")
    players = [
        (original, original.locator("#status"), original.locator("#wardrobe-look"), original.locator("#clip")),
        (current, current.get_by_role("status"), control("Scene"), control("Clip")),
    ]
    for entry in gate["entries"]:
        for preset in entry.get("presets", []):
            if not preset["ok"]:
                continue
            if not all(re.fullmatch(r"[a-z0-9][a-z0-9-]*", label) for label in (entry["name"], preset["preset"])):
                raise ValueError("Expected a character name and preset from the family export gate")
            name = f"{entry['name']}-{preset['preset']}.glb"
            playback = []
            with TemporaryDirectory() as scratch:
                # Another family run can replace its output. Both players must read the same verified file.
                model = Path(scratch) / name
                shutil.copyfile(gate_file.parent / preset["preset"] / name, model)
                sha = digest(model)
                if sha != preset["freshSha256"]:
                    raise ValueError(f"{name} differs from the bytes verified by the family gate")
                for page, status, scenes, clips in players:
                    page.locator("#file").set_input_files(str(model))
                    expect(status).to_have_text(re.compile("^" + re.escape(name) + " ·"), timeout=60000)
                    labels = scenes.locator("option").all_text_contents()
                    outfits = []
                    for index, label in enumerate(labels):
                        if len(labels) > 1:
                            scenes.select_option(str(index))
                        values = clips.locator("option").evaluate_all("options => options.map(o => o.value)")
                        outfits.append({"scene": label, "clips": values})
                    playback.append(outfits)
            if not playback[0] or playback[0] != playback[1]:
                raise AssertionError(f"{name} has inconsistent playback scenes or clips: {playback}")
            rows.append({"file": name, "sha256": sha, "playback": playback[0]})
    if len({row["file"] for row in rows}) != gate["verifiedExports"] or len(rows) != gate["verifiedExports"]:
        raise AssertionError("Playback coverage differs from the count of verified exports")
    return {"expected": gate["expectedExports"], "openedInBoth": len(rows), "files": rows}


def compare_cameras(ctx, root, player, reference, frozen, export_report=None):
    references = {run["play-model.html"] for run in frozen["build"]["runs"]}
    references.update(clone["build"]["play-model.html"] for clone in frozen["lineEndings"]["clones"].values())
    reference_hash = digest(reference)
    if reference_hash not in references:
        raise ValueError(f"Reference player {reference_hash} differs from the pinned G0 build")
    original, current = ctx.new_page(), ctx.new_page()
    rows, errors = [], []
    for page, build in [(original, reference), (current, player)]:
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.set_viewport_size({"width": 1280, "height": 800})
        page.goto(build.as_uri())
        # The legacy page sizes the canvas to a fractional CSS height set by its controls.
        # Match both drawing buffers and projections before comparing rasterized geometry.
        page.locator("#stage").evaluate("e => Object.assign(e.style, {width:'960px', height:'800px', minHeight:'800px'})")
    for name in ["fen-crown", "harbour-trader", "festival-wardrobe", "portrait-gaze"]:
        model = root / "examples" / (name + ".glb")
        for page in [original, current]:
            page.locator("#file").set_input_files(str(model))
            status = page.locator("#status") if page == original else page.get_by_role("status")
            expect(status).to_have_text(re.compile("^" + re.escape(model.name) + " ·"), timeout=60000)
        original.locator("#playing").uncheck()
        original.locator("#clip").select_option("")
        current.locator(".pl-controls input[type=checkbox]").uncheck()
        def field(label):
            return current.locator("label").filter(has=current.get_by_text(label, exact=True)).locator("select")
        field("Clip").select_option("")
        def compare_frame(view):
            a, b = (stable_frame(page.locator("#stage")) for page in (original, current))
            assert a.size == b.size == (960, 800), (a.size, b.size)
            channels = ImageChops.difference(a, b).split()
            difference = ImageChops.lighter(channels[0], ImageChops.lighter(channels[1], channels[2]))
            changed = sum(difference.histogram()[1:])
            peak = difference.getextrema()[1]
            rows.append({"model": name, "view": view, "changedPixels": changed, "maxChannelDifference": peak})
        views = ["front", "threequarter", "side", "back", "overhead"]
        if name in ("festival-wardrobe", "portrait-gaze"):
            views.extend(["portrait", "portrait-side", "portrait-oblique", "portrait-angle"])
        for view in views:
            original.locator("#camera-angle").select_option(view)
            field("Camera").select_option(view)
            compare_frame(view)
        if name == "portrait-gaze":
            # Use the actual controls and sample a turned face with a held and released gaze.
            def set_control(control, value):
                control.fill(str(value))
                control.dispatch_event("change")
            for selector, label, value in [("#portrait-yaw", "Camera turn", 45),
                                           ("#portrait-pitch", "Camera elevation", 15)]:
                set_control(original.locator(selector), value)
                set_control(current.get_by_label(re.compile(label)), value)
            compare_frame("portrait-angle 45/15")
            for value in [80, 0]:
                for slider in [original.locator("#look-x"), current.get_by_label("Look across", exact=True)]:
                    slider.evaluate("(el, v) => { el.value = String(v); el.dispatchEvent(new Event('input', {bubbles:true})); }", value)
                compare_frame(f"portrait-angle 45/15 gaze {value}")
    exports = check_fresh_exports(original, current, export_report) if export_report else None
    original.close()
    current.close()
    assert not errors, errors
    return {"referenceSha256": reference_hash, "size": [960, 800], "frames": rows,
            "passed": all(row["changedPixels"] <= 1 and row["maxChannelDifference"] <= 1 for row in rows),
            **({"freshExports": exports} if exports is not None else {})}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path, nargs="?", default=Path(".reference-cache/g4b/offline.json"))
    parser.add_argument("--camera-reference", type=Path, help="Compare body, portrait and gaze frames against a frozen G0 play-model.html")
    parser.add_argument("--export-report", type=Path, help="Also open the family gate's verified fresh GLBs in both offline players and compare their clips")
    args = parser.parse_args()
    if args.export_report and not args.camera_reference:
        parser.error("--export-report needs --camera-reference")
    root = Path(__file__).resolve().parents[1]
    player = root / "apps/player/dist/player.html"
    baseline = json.loads((root / "verification/baseline/baseline.json").read_bytes())
    corpus = baseline["frozen"]["corpus"]["glbs"]
    assert len(corpus) == 32
    errors, network, results = [], [], []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel="chrome")
        ctx = browser.new_context(offline=True, viewport={"width": 1100, "height": 780})
        page = ctx.new_page()
        page.on("pageerror", lambda err: errors.append(str(err)))
        ctx.on("request", lambda req: network.append(req.url) if req.url.startswith(("http:", "https:")) else None)
        page.goto(player.as_uri())
        gpu = page.locator("#stage canvas").first.evaluate("""c => {
            const g=c.getContext('webgl2'), x=g.getExtension('WEBGL_debug_renderer_info');
            return x ? g.getParameter(x.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER);
        }""")
        assert not any(word in gpu.lower() for word in ("swiftshader", "llvmpipe", "software", "basic render")), gpu
        for fixture in corpus:
            model = root / fixture["file"]
            assert digest(model) == fixture["sha256"], model
            page.locator("#file").set_input_files(str(model))
            expect(page.get_by_role("status")).to_have_text(re.compile("^" + re.escape(model.name) + " ·"), timeout=60000)
            scene_select = page.locator("label").filter(has=page.get_by_text("Scene", exact=True)).locator("select")
            scenes = scene_select.locator("option").all_text_contents()
            assert len(scenes) == fixture["counts"]["scenes"], (model, scenes)
            stats = page.locator(".pl-stats").first.text_content()
            row = {"file": fixture["file"], "scenes": scenes, "stats": stats, "status": page.get_by_role("status").text_content()}
            if len(scenes) > 1:
                for index in range(1, len(scenes)):
                    scene_select.select_option(str(index))
                    expect(scene_select).to_have_value(str(index))
            if model.stem == "fen-crown":
                page.get_by_role("button", name="Check motion").click()
                expect(page.locator(".pl-report")).to_contain_text("movement", timeout=30000)
                row["motion"] = page.locator(".pl-report").inner_text()
                assert "movement" in row["motion"] and "lowest vertex" in row["motion"], row
            results.append(row)
        assert not errors and not network, (errors, network)
        report = {"bundleSha256": digest(player), "chrome": browser.version, "renderer": gpu,
                  "models": results, "pageErrors": errors, "networkRequests": network}
        if args.camera_reference:
            report["cameras"] = compare_cameras(ctx, root, player, args.camera_reference.resolve(), baseline["frozen"], args.export_report)
        assert not network, network
        browser.close()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    if args.camera_reference and not report["cameras"]["passed"]:
        raise SystemExit(f"Camera output differs from G0. Per-frame measurements in {args.output}")
    print(f"{len(results)} verified playback fixtures, no network requests or page errors; {gpu}")
    if args.export_report:
        fresh = report["cameras"]["freshExports"]
        print(f"{fresh['openedInBoth']}/{fresh['expected']} fresh exports opened in both players with matching scenes and clips")


if __name__ == "__main__":
    main()
