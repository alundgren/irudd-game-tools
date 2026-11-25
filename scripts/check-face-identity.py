"""Build two unlabelled-by-seed face sheets to test recognition across camera angles.

The three closest disjoint head pairs come from scripts/adult-diversity.mjs.
Give an observer references.webp and probes.webp. Keep the answer key separate.
Requires Python with Playwright and Pillow, Chrome, and npm run build.
"""
import argparse
import io
import json
import random
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]


def capture(out, shuffle_seed):
    out.mkdir(parents=True, exist_ok=True)
    report = json.loads((ROOT / "docs/media/adult-diversity.json").read_text())
    subjects = [seed for pair in report["head"]["closePairs"] for seed in pair]
    rng = random.Random(shuffle_seed)
    rng.shuffle(subjects)
    probes = rng.sample(subjects, len(subjects))
    cols, cell, label = 3, 260, 25
    sheets = [Image.new("RGB", (cols*cell, 2*(cell+label)), "#283236") for _ in range(2)]
    font = ImageFont.load_default(size=17)
    make = """import {generatedHuman} from './character-view/human-form.js';
        console.log(JSON.stringify({format:'irudd.form.v1',form:generatedHuman(Number(process.argv[1]))}));"""
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel="chrome")
        page = browser.new_page(viewport={"width": 1300, "height": 860})
        page.goto((ROOT / "dist/character-view.html").as_uri() + "#study=adult-neutral")
        page.wait_for_function("document.querySelector('#status')?.textContent.startsWith('Loaded')", timeout=60000)
        page.add_style_tag(content=".stage-title,.camera,.stage-foot,.measure{visibility:hidden!important}")
        def click(selector):
            page.locator(selector).first.evaluate("el => el.click()")
        for index, seed in enumerate(subjects):
            form = subprocess.check_output(["node","--input-type=module","-e",make,str(seed)], cwd=ROOT)
            page.locator("#openfile").set_input_files({"name":"body.json","mimeType":"application/json","buffer":form})
            page.wait_for_function("document.querySelector('#status').textContent.includes('Form opened')")
            click('[data-mode="Clay"]')
            page.locator("#target").select_option("head", force=True)
            for row,(angle,slot) in enumerate([("Front",index),("3/4",probes.index(seed))]):
                click('[data-angle="'+angle+'"]')
                click("#focus")
                page.wait_for_timeout(120)
                frame = Image.open(io.BytesIO(page.locator("#viewport").screenshot())).convert("RGB")
                width,height=frame.size
                side=min(width,height)
                frame=frame.crop(((width-side)//2,(height-side)//2,(width+side)//2,(height+side)//2)).resize((cell,cell),Image.Resampling.LANCZOS)
                x=slot%cols*cell
                y=slot//cols*(cell+label)
                sheets[row].paste(frame,(x,y))
                mark=chr(65+slot) if row else str(slot+1)
                ImageDraw.Draw(sheets[row]).text((x+7,y+cell+2),mark,font=font,fill="white")
    for sheet,name in zip(sheets,["references","probes"]):
        sheet.save(out/(name+".webp"),quality=94)
    key = {chr(65+i):subjects.index(seed)+1 for i,seed in enumerate(probes)}
    (out/"key.json").write_text(json.dumps({"key":key,"referenceSeeds":subjects,"probeSeeds":probes},indent=2)+"\n")

if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("out",type=Path)
    parser.add_argument("--shuffle-seed",type=int,help="Optional repeatable shuffle")
    args=parser.parse_args()
    capture(args.out.resolve(),args.shuffle_seed)
