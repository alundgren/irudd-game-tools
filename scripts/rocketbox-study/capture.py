"""Capture matched orbit views from the Rocketbox comparison page.

Build the page first: node scripts/rocketbox-study/build.mjs
Then: python scripts/rocketbox-study/capture.py [--page dist/rocketbox-study.html] [--out .reference-cache/rocketbox/media]
      [--stage final] [--quick] [--require-hardware]
      python scripts/rocketbox-study/capture.py --look torso [--angles 0,90,180] [--modes Colour,Clay] [--study gardener-male-01]
Needs Chrome, Playwright, Pillow and NumPy. Chrome uses the platform's hardware renderer; the detected
renderer is printed and saved in readings.json, and a software fallback is named as one. The images show the reference and stay local. Every tile pairs the Rocketbox original (left) with the
editable adult (right) under one orthographic camera, so both share a metric scale.
"""
import argparse
import io
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
ORBIT = [0, 45, 90, 135, 180, 225, 270, 315]
STAGE = (1200, 800)  # two 600 px panes
RENDERER = """() => { const gl = document.createElement("canvas").getContext("webgl2"); if (!gl) return "";
  const info = gl.getExtension("WEBGL_debug_renderer_info"); return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); }"""


def grab(page, **view):
    info = page.evaluate("(v) => window.rocketboxStudy.show(v)", view)
    page.evaluate("() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))")
    image = Image.open(io.BytesIO(page.locator("#stage canvas").screenshot())).convert("RGB")
    return image, info


def halves(image):
    w = image.width // 2
    return image.crop((0, 0, w, image.height)), image.crop((w, 0, 2 * w, image.height))


def figure_mask(image):
    rgb = np.asarray(image).astype(int)
    return (rgb[:, :, 0] < 90) & (rgb[:, :, 1] < 110) & (rgb[:, :, 2] < 110)


def sheet(tiles, columns, label=None):
    w, h = tiles[0].size
    rows = (len(tiles) + columns - 1) // columns
    out = Image.new("RGB", (w * columns, h * rows), "white")
    for i, tile in enumerate(tiles):
        out.paste(tile, ((i % columns) * w, (i // columns) * h))
    if label:
        ImageDraw.Draw(out).text((6, 4), label, fill=(30, 50, 40))
    return out


def crop_pair(image, keep):
    """Trim each pane to the same central fraction of its width, then rejoin."""
    left, right = halves(image)
    w, h = left.size
    x0, x1 = round(w * (0.5 - keep / 2)), round(w * (0.5 + keep / 2))
    out = Image.new("RGB", (2 * (x1 - x0) + 4, h), "white")
    out.paste(left.crop((x0, 0, x1, h)), (0, 0))
    out.paste(right.crop((x0, 0, x1, h)), (x1 - x0 + 4, 0))
    return out


def silhouette_readings(page, study, stage):
    """Overlap of the two outlines per view, with the widest disagreements by height."""
    rows = {}
    tiles = []
    for angle in ORBIT:
        # Without the ruler: it is the same in both panes, so counting it would raise every overlap a little.
        image, info = grab(page, study=study, stage=stage, mode="Silhouette", frame="whole", angle=angle, ruler=False)
        a, b = (figure_mask(x) for x in halves(image))
        union = np.count_nonzero(a | b)
        px = image.height / info["metres"]
        both = np.zeros((*a.shape, 3), np.uint8) + 255
        both[a & b] = (70, 80, 76)
        both[a & ~b] = (60, 120, 190)   # only the Rocketbox original
        both[b & ~a] = (205, 90, 50)    # only the editable adult
        tiles.append(Image.fromarray(both))
        ys = np.where(a.any(1) | b.any(1))[0]
        widths = []
        for y in range(ys.min(), ys.max(), max(1, round(px * 0.05))):
            wa, wb = np.count_nonzero(a[y]), np.count_nonzero(b[y])
            widths.append((round((image.height - y) / px - (info["metres"] / 2 - 0.96), 2), round(wa / px, 3), round(wb / px, 3)))
        top = lambda m: (image.height - np.where(m.any(1))[0].min()) / px - (info["metres"] / 2 - 0.96)
        rows[str(angle)] = {
            "iou": round(float(np.count_nonzero(a & b) / union), 3),
            "targetOnlyShare": round(float(np.count_nonzero(a & ~b) / union), 3),
            "resultOnlyShare": round(float(np.count_nonzero(b & ~a) / union), 3),
            "targetTopM": round(float(top(a)), 3),
            "resultTopM": round(float(top(b)), 3),
            "widthsByHeightM": widths,
        }
    return rows, tiles


def capture(page_path, out, stage, quick, require_hardware=False, look=None, only=None):
    out.mkdir(parents=True, exist_ok=True)
    readings = {}
    with sync_playwright() as pw:
        # Chrome picks the platform's own hardware renderer. Nothing here names a backend or a card.
        browser = pw.chromium.launch(channel="chrome")
        page = browser.new_page(viewport={"width": 1280, "height": 1100})
        gpu = page.evaluate(RENDERER)
        software = not gpu or any(word in gpu.lower() for word in ("swiftshader", "software", "llvmpipe", "basic render"))
        print("WebGL renderer:", gpu or "none", "(SOFTWARE FALLBACK: no hardware renderer was available)" if software else "(hardware)", flush=True)
        if software and require_hardware:
            browser.close()
            raise SystemExit("Chrome has no hardware renderer here and --require-hardware was given, so nothing was rendered.")
        readings["renderer"] = {"webgl": gpu, "softwareFallback": software}
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(page_path.resolve().as_uri())
        page.wait_for_function("window.rocketboxStudy", timeout=180000)
        page.add_style_tag(content=f"#stage{{width:{STAGE[0]}px;height:{STAGE[1]}px;min-height:0}}")
        studies = page.evaluate("() => window.rocketboxStudy.studies")
        for entry in studies:
            study = entry["id"]
            which = stage if stage in entry["stages"] else "final"
            tag = study.replace("rocketbox-", "") + ("" if which == "final" else "-" + which.replace(" ", "-"))
            if only and not study.endswith(only):
                continue
            if look:
                # A close working sheet while tuning: one framing, a few angles, nothing measured.
                for mode in look["modes"]:
                    tiles = [crop_pair(grab(page, study=study, stage=which, mode=mode, frame=look["frame"], angle=a)[0], 0.96 if look["frame"] == "whole" else 0.9) for a in look["angles"]]
                    file = out / (f"{tag}-look-{look['frame']}" + ("" if mode == "Colour" else "-" + mode.lower()) + ".png")
                    sheet(tiles, look["columns"]).save(file)
                    print("Wrote", file, flush=True)
                continue
            modes = ["Colour"] if quick else ["Colour", "Clay"]
            for mode in modes:
                tiles = [crop_pair(grab(page, study=study, stage=which, mode=mode, frame="whole", angle=a)[0], 0.96) for a in ORBIT]
                sheet(tiles, 4).save(out / f"{tag}-orbit-{mode.lower()}.webp", quality=88, method=5)
            heads = [crop_pair(grab(page, study=study, stage=which, mode=m, frame="head", angle=a)[0], 0.72)
                     for m in (["Colour"] if quick else ["Colour", "Clay"]) for a in [0, 45, 90, 180]]
            sheet(heads, 4).save(out / f"{tag}-head.webp", quality=90, method=5)
            details = [crop_pair(grab(page, study=study, stage=which, mode="Colour", frame=f, angle=a)[0], 0.9)
                       for f in ["torso", "legs"] for a in [0, 60, 180]]
            sheet(details, 3).save(out / f"{tag}-outfit.webp", quality=88, method=5)
            rows, diff = silhouette_readings(page, study, which)
            sheet([d.resize((d.width // 2, d.height // 2)) for d in diff], 4).save(out / f"{tag}-silhouette.webp", quality=90, method=5)
            readings[tag] = rows
            print(tag, {k: v["iou"] for k, v in rows.items()}, flush=True)
        assert not errors, errors
        browser.close()
    if look:
        return
    name = "readings.json" if stage == "final" else "readings-" + stage.replace(" ", "-") + ".json"
    (out / name).write_text(json.dumps(readings, indent=1) + "\n", encoding="utf8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--page", default=str(ROOT / "dist" / "rocketbox-study.html"))
    parser.add_argument("--out", default=str(ROOT / ".reference-cache" / "rocketbox" / "media"))
    parser.add_argument("--stage", default="final")
    parser.add_argument("--quick", action="store_true")
    parser.add_argument("--require-hardware", action="store_true", help="stop instead of falling back to software rendering")
    parser.add_argument("--look", choices=["whole", "torso", "head", "legs"], help="write one close working sheet per study instead of the full set")
    parser.add_argument("--angles", default="0,90,180")
    parser.add_argument("--modes", default="Colour", help="comma separated: Colour, Clay, Silhouette")
    parser.add_argument("--columns", type=int, default=3)
    parser.add_argument("--study", help="only the study whose id ends with this")
    args = parser.parse_args()
    look = {"frame": args.look, "angles": [float(a) for a in args.angles.split(",")], "modes": [m.strip().capitalize() for m in args.modes.split(",")], "columns": args.columns} if args.look else None
    capture(Path(args.page), Path(args.out), args.stage, args.quick, args.require_hardware, look, args.study)
