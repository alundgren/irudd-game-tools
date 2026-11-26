"""Fit six 3D references using the running workshop UI and save evidence to a directory.

    python scripts/check-workshop-fits.py .reference-cache/ui-fit --workshop http://127.0.0.1:4182

Requires Playwright for Python, Chrome and Pillow. Start the workshop and build it first.
Each subject starts from an identical 1.72 m neutral body in an isolated browser session.
"""
import argparse
import io
import json
import subprocess
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFont
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
SUBJECTS = ("f1", "f2", "f3", "m1", "m2", "m3")
CREDIT = "Measurements fitted to Momentum Human Rig v1.0.1. Copyright (c) Meta Platforms, Inc. and affiliates. Apache-2.0. Modified by fitting an editable adult. See docs/licenses/mhr-apache-2.0.txt."

def check_wipe(page, out):
    """Both halves must retain the camera used at either end of the slider."""
    page.locator('[data-view="wipe"]').click()
    slider = page.locator("#hfit-wipe")
    canvas = page.locator("#hfit-canvas")
    frames = {}
    for percent in (0, 100, 50):
        slider.evaluate("""(element, value) => {
            element.value = value;
            element.dispatchEvent(new Event('input', {bubbles:true}));
        }""", percent)
        frames[percent] = Image.open(io.BytesIO(canvas.screenshot())).convert("RGB")
    middle = frames[50]
    width, height = middle.size
    for percent, box in [(100, (3, 42, width//2-4, height-3)),
                         (0, (width//2+4, 42, width-3, height-3))]:
        if ImageChops.difference(middle.crop(box), frames[percent].crop(box)).getbbox():
            raise RuntimeError(f"Wipe camera or content changed on the {percent}% side")
    if not ImageChops.difference(frames[0], frames[100]).getbbox():
        raise RuntimeError("Wipe endpoints show identical content")
    middle.save(out / "linked-study-wipe.webp", quality=94)
    page.locator('[data-view="side"]').click()


def fit_subject(page, subject, control, out, refine_face):
    def click(selector):
        page.locator(selector).first.evaluate("button => button.click()")

    page.locator("#openfile").set_input_files(control)
    page.wait_for_function("document.querySelector('#status').textContent.includes('Form opened')")
    click("#human-fit-open")
    source = page.locator("#hfit-source")
    source.select_option("mhr-" + subject)
    selected = source.locator("option:checked").text_content()
    page.wait_for_function(
        """label => !document.querySelector('#hfit-run').disabled &&
            document.querySelector('#hfit-facts').textContent.includes(label)""",
        arg=selected, timeout=60000,
    )
    page.locator("#hfit-contour").set_checked(refine_face)
    click("#hfit-run")
    page.wait_for_function("document.querySelector('#hfit-note').textContent.includes('Apply to keep it')", timeout=120000)
    readings = {key: page.locator("#hfit-" + key).inner_text() for key in ("note", "steps", "table", "facts")}
    print(subject.upper(), readings["note"], flush=True)
    panels = []
    for angle in ("0", "0.62"):
        click(f'#hfit-angles [data-angle="{angle}"]')
        data = page.locator("#hfit-stage").screenshot()
        image = Image.open(io.BytesIO(data)).convert("RGB")
        image.thumbnail((402, 268))
        panels.append(image)
    page.locator("#hfit-frame").select_option("head")
    readings["headViews"] = {}
    for name, angle in (("oblique","0.62"), ("profile","1.5708")):
        click(f'#hfit-angles [data-angle="{angle}"]')
        data = page.locator("#hfit-stage").screenshot()
        Image.open(io.BytesIO(data)).convert("RGB").save(out/f"head-{subject}-{name}.webp",quality=94)
        click("#hfit-view-score")
        score = page.locator("#hfit-view-reading").get_attribute("data-result")
        if not score:
            raise RuntimeError(page.locator("#hfit-view-reading").inner_text())
        readings["headViews"][name] = json.loads(score)
    page.locator("#hfit-frame").select_option("whole")
    click("#hfit-apply")
    click('[data-tab="files"]')
    with page.expect_download() as saved:
        click("#save")
    path = out / f"mhr-{subject}.form.json"
    saved.value.save_as(path)
    form = json.loads(path.read_text(encoding="utf8"))["form"]
    click('[data-tab="sculpt"]')
    return readings, {key: form[key] for key in ("human", "humanFit")}, panels

def run(out, url, refine_face):
    out.mkdir(parents=True, exist_ok=True)
    control = out / "control.form.json"
    make = """import {humanForm} from './character-view/human-form.js';
        console.log(JSON.stringify({format:'irudd.form.v1',form:humanForm({height:1.72},1776)}));"""
    control.write_bytes(subprocess.check_output(["node","--input-type=module","-e",make],cwd=ROOT))
    fits, readings = {}, {}
    montage = Image.new("RGB", (1206,1168), "#1b262b")
    draw = ImageDraw.Draw(montage)
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel="chrome")
        page = browser.new_page(viewport={"width":1380,"height":900})
        page.goto(url.rstrip("/") + "/#study=adult-neutral")
        page.wait_for_function("document.querySelector('#status')?.textContent.startsWith('Loaded')",timeout=60000)
        renderer = page.locator("#viewport").evaluate("""c => {
            const gl = c.getContext('webgl2'), info = gl.getExtension('WEBGL_debug_renderer_info');
            return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
        }""")
        print("Renderer:", renderer, flush=True)
        (out/"renderer.json").write_text(json.dumps({"renderer":renderer})+"\n",encoding="utf8")
        page.goto(url.rstrip("/") + "/#study=mhr-f1&compare=3d", wait_until="load")
        page.reload()
        page.wait_for_function("""document.querySelector('#hfit-source')?.value === 'mhr-f1'
            && document.querySelector('#hfit-facts')?.textContent.includes('female-typical 1')""",
            timeout=60000)
        page.locator("#hfit-frame").select_option("head")
        check_wipe(page, out)
        page.locator("#hfit-close").click()
        for index,subject in enumerate(SUBJECTS):
            readings[subject], fits[subject], panels = fit_subject(page, subject, control, out, refine_face)
            for row,image in enumerate(panels):
                x=index%3*402
                y=(index//3*2+row)*292
                montage.paste(image,(x+(402-image.width)//2,y))
                label="MHR "+subject.upper()+"  /  "+("Front","Three-quarter")[row]
                draw.text((x+10,y+267),label,fill="white",font=ImageFont.load_default(size=16))
        browser.close()
    (out/"readings.json").write_text(json.dumps(readings,indent=2)+"\n",encoding="utf8")
    (out/"fits.json").write_text(json.dumps({"source":CREDIT,"fits":fits},separators=(",",":"))+"\n",encoding="utf8")
    montage.save(out/"comparison.webp",quality=90)

if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("out", type=Path)
    parser.add_argument("--workshop",default="http://127.0.0.1:4179")
    parser.add_argument("--refine-face", action="store_true", help="Enable facial contour refinement during every fit")
    args=parser.parse_args()
    run(args.out.resolve(),args.workshop,args.refine_face)
