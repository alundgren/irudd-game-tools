"""Photograph consecutive generated adults through the workshop in colour and clay.

Run npm run build, then python scripts/check-avatar-lineup.py OUTPUT [--seed 8710].
Whole-body photographs share one camera scale. Styling and body use independent draws.
"""
import argparse
import hashlib
import io
import json

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]



def capture(out, start, count, check_clothes=False, game_portraits=False, build_dir=ROOT / "dist"):
    build_dir = build_dir.resolve()
    out.mkdir(parents=True, exist_ok=True)
    font = ImageFont.load_default(size=17)
    sheets = {}
    rows = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel="chrome")
        try:
            context = browser.new_context(viewport={"width": 1240, "height": 860})
            page = context.new_page()
            editor_file = build_dir / "character-view.html"
            build = hashlib.sha256(editor_file.read_bytes()).hexdigest()
            page.goto(editor_file.as_uri() + "#study=adult-neutral")
            page.wait_for_function("document.querySelector('#status')?.textContent.startsWith('Loaded')")
            canvas = page.locator("#viewport")
            renderer = canvas.evaluate("""canvas => {
                const gl = canvas.getContext('webgl2'), info = gl.getExtension('WEBGL_debug_renderer_info');
                return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
            }""")
            print("Renderer:", renderer, flush=True)
            page.add_style_tag(content=".stage-title,.stage-foot,.camera,.measure {visibility:hidden!important}")
            def click(selector):
                page.locator(selector).first.evaluate("el => el.click()")
            player = None
            player_build = None
            if game_portraits:
                player = page.context.new_page()
                player_file = build_dir / "play-model.html"
                player_build = hashlib.sha256(player_file.read_bytes()).hexdigest()
                player.goto(player_file.as_uri())
                player.locator("#playing").uncheck()

            def tile(label, width, height, index, caption, framing, surface=None):
                surface = canvas if surface is None else surface
                image = Image.open(io.BytesIO(surface.screenshot())).convert("RGB")
                w, h = image.size
                if framing == "fixed":
                    # The editor's world view spans 2.65 m, with the camera aimed at y=1.05 m.
                    span = h * 2.28 / 2.65
                    cx, cy = w / 2, h / 2
                else:
                    span, cx, cy = min(w,h), w/2, h/2
                sw = span * width / height
                crop = image.crop((round(cx-sw/2),round(cy-span/2),round(cx+sw/2),round(cy+span/2)))
                crop = crop.resize((width,height), Image.Resampling.LANCZOS)
                if label not in sheets:
                    sheets[label] = Image.new("RGB", (width*count,height+28), "#232e32")
                sheet = sheets[label]
                sheet.paste(crop,(index*width,0))
                ImageDraw.Draw(sheet).text((index*width+7,height+3),caption,font=font,fill="white")
            click("#scale-lock")
            for i in range(count):
                seed = start + i

                page.evaluate("(hash) => location.hash=hash",f"adult={seed}&look={(seed ^ 0x1e18ae83) & 0xffffffff}")
                page.wait_for_function("seed => document.querySelector('#status').textContent === 'Opened adult draw '+seed+'.'",arg=seed)
                with page.expect_download() as saved:
                    click("#save")
                recipe = saved.value.path().read_bytes()
                (out / f"adult-{seed}.form.json").write_bytes(recipe)
                form = json.loads(recipe)["form"]
                rows.append({"seed":seed,"heightMetres":form["human"]["height"],"outfit":form["humanStyle"]["outfit"],
                             "hair":form["humanStyle"]["hair"], "formSha256":hashlib.sha256(recipe).hexdigest()})
                click("#reset")
                for mode, angle, name in [("Color","3/4","dressed"),("Color","Back","backs"),("Silhouette","Front","outlines")]:
                    click('[data-mode="'+mode+'"]')
                    click('[data-angle="'+angle+'"]')
                    tile(name,250,460,i,f"{seed}    {form['human']['height']:.2f} m","fixed")
                page.locator("#target").select_option("head",force=True)
                for mode, angle, name in [("Color","Portrait","faces"),("Clay","Side","profiles")]:
                    click('[data-mode="'+mode+'"]')
                    click('[data-angle="'+angle+'"]')
                    click("#focus")
                    tile(name,285,285,i,str(seed),"head")
                if game_portraits or check_clothes:
                    page.locator('[data-tab="files"]').click()
                if game_portraits:
                    page.locator("#export-detail").select_option("game")
                    with page.expect_download(timeout=60000) as exported:
                        page.locator("#glb").click()
                    target = out / f"adult-{seed}.glb"
                    exported.value.save_as(target)
                    rows[-1]["glbSha256"] = hashlib.sha256(target.read_bytes()).hexdigest()
                    player.locator("#file").set_input_files(target)
                    player.wait_for_function("name => document.querySelector('#status').textContent.startsWith(name + ' · ')", arg=target.name)
                    rows[-1]["gameMesh"] = player.locator("#stats").inner_text()
                    for angle, clip, phase, label in [
                        ("threequarter", "", 0, "game-dressed"), ("back", "", 0, "game-backs"),
                        ("front", "Walk", .20, "game-walk"), ("threequarter", "Reach", .55, "game-reach"),
                    ]:
                        player.locator("#camera-angle").select_option(angle)
                        player.locator("#clip").select_option(clip)
                        if clip:
                            player.locator("#time").evaluate(
                                "(slider, phase) => { slider.value = phase; slider.dispatchEvent(new Event('input')); }", phase)
                        player.evaluate("() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
                        tile(label, 275, 400, i, str(seed), "player", player.locator("#stage canvas"))
                    player.locator("#clip").select_option("")
                    for angle, expression, label in [
                        ("portrait", "", "game-faces"), ("portrait-side", "", "game-profiles"),
                        ("portrait-oblique", "Smile", "game-smiles"), ("portrait", "Blink", "game-blinks"),
                    ]:
                        player.locator("#camera-angle").select_option(angle)
                        player.locator("#expression").select_option(expression)
                        player.evaluate("() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
                        tile(label, 300, 300, i, str(seed), "head", player.locator("#stage canvas"))
                if check_clothes:
                    panel = page.locator("#file-game-check")
                    if not panel.evaluate("el => el.open"):
                        panel.locator("summary").click()
                    page.locator("#file-game-run").click()
                    page.wait_for_function("!document.querySelector('#file-game-run').disabled", timeout=90000)
                    reading = page.locator("#file-game-reading")
                    raw = reading.get_attribute("data-result")
                    if not raw:
                        raise RuntimeError(reading.inner_text())
                    report = json.loads(raw)
                    coverage = report["detailCoverage"]
                    assert len(coverage) == 4 and all(r["interiorClothingPixels"] > 0 for r in coverage), coverage
                    rows[-1]["gameCoverage"] = coverage
                    print(seed, "newly exposed skin pixels:", [r["exposedSkinPixels"] for r in coverage], flush=True)
                if game_portraits or check_clothes:
                    page.locator('[data-tab="sculpt"]').click()

            for name,sheet in sheets.items():
                sheet.save(out/(name+".webp"),quality=95)
            (out/"draws.json").write_text(json.dumps({"renderer":renderer,"editorSha256":build,"playerSha256":player_build,"draws":rows},indent=2)+"\n",encoding="utf-8")
        finally:
            browser.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("out",type=Path)
    parser.add_argument("--seed",type=int,default=8710)
    parser.add_argument("--count",type=int,choices=range(2,9),default=6)
    parser.add_argument("--check-clothes", action="store_true", help="Compare full-detail garment coverage with the game export in four views.")
    parser.add_argument("--game-portraits", action="store_true", help="Export every draw and photograph its neutral face, profile, smile and blink in the GLB player.")
    parser.add_argument("--build-dir", type=Path, default=ROOT / "dist", help="Directory containing the editor and player HTML from a single build.")
    args = parser.parse_args()
    capture(args.out,args.seed,args.count,args.check_clothes,args.game_portraits,args.build_dir)
