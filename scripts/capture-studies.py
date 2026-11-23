"""Capture the actual workshop in Chromium. Build the HTML first.
Optional local evidence tools: pip install playwright pillow numpy, install Chrome.
Running this replaces the generated benchmark images and measurements.
"""
import io
import itertools
import json
from pathlib import Path

import numpy as np
from PIL import Image
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / "docs" / "media"
DEST.mkdir(parents=True, exist_ok=True)
STUDIES = ["painted-ranger", "painted-surveyor", "painted-trader", "painted-porter", "painted-elder", "painted-courier"]
ANGLES = ["3/4", "Front", "Side", "Back"]


def shot(page):
    return Image.open(io.BytesIO(page.locator("#viewport").screenshot())).convert("RGB")


def mask(image):
    rgb = np.asarray(image)
    return (rgb[:, :, 0] < 85) & (rgb[:, :, 1] < 100) & (rgb[:, :, 2] < 100)


def bounds(binary, pad=12):
    y, x = np.where(binary)
    return (int(x.min())-pad, int(y.min())-pad, int(x.max())+pad+1, int(y.max())+pad+1)


def card(image, rect, size):
    crop = image.crop(rect)
    crop.thumbnail(size, Image.Resampling.LANCZOS)
    bg = Image.new("RGB", size, image.getpixel((1, 1)))
    bg.paste(crop, ((size[0]-crop.width)//2, (size[1]-crop.height)//2))
    return bg


def strip(images):
    out = Image.new("RGB", (sum(im.width for im in images), max(im.height for im in images)))
    x = 0
    for im in images:
        out.paste(im, (x, 0))
        x += im.width
    return out


def click(page, selector):
    page.locator(selector).evaluate("(el)=>el.click()")


def normalized(binary):
    image = Image.fromarray(binary)
    box = image.getbbox()
    image = image.crop(box)
    image = image.resize((max(1, round(192 * image.width / image.height)),192),Image.Resampling.NEAREST)
    result = Image.new("1",(512,192))
    result.paste(image,((512-image.width)//2,0))
    return np.asarray(result)


def capture():
    normalized_masks = {}
    lineup = []
    readings = {}
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel="chrome", args=["--use-angle=swiftshader","--enable-unsafe-swiftshader"])
        page = browser.new_page(viewport={"width":1280,"height":860})
        errors = []
        page.on("pageerror",lambda e:errors.append(str(e)))
        page.goto((ROOT/"dist"/"character-view.html").as_uri())
        page.wait_for_function("document.querySelector('#donor-component')?.options.length>1")
        page.add_style_tag(content=".stage-title,.measure,.camera,.stage-foot{visibility:hidden}")
        for study in STUDIES:
            click(page,"[data-tab=files]")
            page.locator("#studies").select_option(study)
            click(page,"#study")
            assert "Loaded" in page.locator("#status").inner_text()
            readings[study]={"height":page.locator("#size").text_content()}
            click(page,"[data-tab=sculpt]")
            click(page,'[data-mode="Silhouette"]')
            masks={}
            for angle in ANGLES:
                click(page,f'[data-angle="{angle}"]')
                masks[angle]=mask(shot(page))
            normalized_masks[study] = [normalized(masks[a]) for a in ["Front","Side","Back"]]
            for mode,angles in [("Color",ANGLES),("Clay",ANGLES),("Silhouette",["Front","Side"])]:
                click(page,f'[data-mode="{mode}"]')
                panels=[]
                for angle in angles:
                    click(page,f'[data-angle="{angle}"]')
                    panels.append(card(shot(page),bounds(masks[angle],18),(320,450)))
                strip(panels).save(DEST/(study+"-"+mode.lower()+".webp"),quality=89,method=5)
            click(page,'[data-mode="Color"]')
            click(page,"#scale-lock")
            click(page,'[data-angle="Front"]')
            full=shot(page)
            # All subjects use the same fixed world camera, crop, baseline and pixels/metre.
            width,height=full.size
            rect=(width//2-180,round(.10*height),width//2+180,round(.91*height))
            lineup.append(full.crop(rect).resize((216,round((rect[3]-rect[1])*.6)),Image.Resampling.LANCZOS))
            click(page,"#scale-lock")
            if study in ["painted-ranger","painted-surveyor","painted-elder","painted-courier"]:
                page.locator("#target").select_option("head and neck")
                click(page,"#focus")
                faces=[]
                for a in ["Front","3/4","Side"]:
                    click(page,f'[data-angle="{a}"]')
                    f=shot(page)
                    midpoint=f.width//2
                    crop=f.crop((midpoint-280,f.height//2-280,midpoint+280,f.height//2+280))
                    faces.append(crop.resize((260,260),Image.Resampling.LANCZOS))
                strip(faces).save(DEST/(study+"-head.webp"),quality=91,method=5)
            print(study,readings[study],flush=True)
        assert not errors,errors
        browser.close()
    strip(lineup).save(DEST/"standing-scale.webp",quality=91,method=5)
    distances={}
    for a,b in itertools.combinations(STUDIES,2):
        distance=[1-np.count_nonzero(x&y)/np.count_nonzero(x|y) for x,y in zip(normalized_masks[a],normalized_masks[b])]
        distances[a+" / "+b]=[round(float(d),3) for d in distance]
    (DEST/"measurements.json").write_text(json.dumps({"studies":readings,"views":["front","side","back"],"silhouetteDistance":distances},indent=2)+"\n",encoding="utf8")


if __name__ == "__main__":
    capture()
