"""Open each saved study form in the editor the way a person does, and export it.

python scripts/rocketbox-study/editor-pass.py --editor path/to/character-view.html
      [--forms .reference-cache/rocketbox/forms] [--out .reference-cache/rocketbox/exports]

For every *.form.json it uses Forms -> Open form, takes a picture of the stage, then presses
Export GLB once per GLB detail choice and saves the downloads. It then changes a tailored piece,
chooses a preset outfit over it and undoes both, and last opens the full and game exports in the
player page for a picture of what was written. Chrome uses the platform's
hardware renderer; the detected renderer is printed and a software fallback is named as one.
"""
import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
RENDERER = """() => { const gl = document.createElement("canvas").getContext("webgl2"); if (!gl) return "";
  const info = gl.getExtension("WEBGL_debug_renderer_info"); return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); }"""


def run(editor, forms, out, player=None):
    out.mkdir(parents=True, exist_ok=True)
    report = {}
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel="chrome")
        page = browser.new_page(viewport={"width": 1500, "height": 1000}, accept_downloads=True)
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(editor.resolve().as_uri())
        page.wait_for_selector("#glb", state="attached", timeout=180000)
        gpu = page.evaluate(RENDERER)
        software = not gpu or any(word in gpu.lower() for word in ("swiftshader", "software", "llvmpipe", "basic render"))
        print("WebGL renderer:", gpu or "none", "(SOFTWARE FALLBACK: no hardware renderer was available)" if software else "(hardware)", flush=True)
        report["renderer"] = {"webgl": gpu, "softwareFallback": software}
        details = page.eval_on_selector_all("#export-detail option", "options => options.map(o => o.value)")
        for form in sorted(forms.glob("*.form.json")):
            name = form.name.replace(".form.json", "")
            page.set_input_files("#openfile", str(form))
            page.wait_for_timeout(4000)
            status = page.evaluate("() => document.querySelector('#status')?.textContent ?? ''")
            page.screenshot(path=str(out / f"{name}-editor.png"))
            report[name] = {"opened": status, "exports": {}}
            for detail in details:
                # The control may sit in a tab that is not showing, so it is set directly.
                page.evaluate("(v) => { const s = document.querySelector('#export-detail'); s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); }", detail)
                with page.expect_download(timeout=240000) as got:
                    page.evaluate("() => document.querySelector('#glb').click()")
                file = out / f"{name}-{detail or 'full'}.glb"
                got.value.save_as(str(file))
                page.wait_for_function("() => !document.querySelector('#glb').disabled", timeout=240000)
                report[name]["exports"][detail or "full"] = {"file": file.name, "bytes": file.stat().st_size, "status": page.evaluate("() => document.querySelector('#status')?.textContent ?? ''")}
                print(name, detail, file.stat().st_size, flush=True)
            # The tailored outfit panel: change one piece, choose a preset over it, and undo both.
            panel = page.evaluate("""async () => {
              const wait = () => new Promise((r) => setTimeout(r, 900)), status = () => document.querySelector('#status').textContent;
              const pieces = () => [...document.querySelectorAll('#human-tailor details summary')].map((s) => s.textContent);
              const before = pieces(), out = { pieces: before };
              const select = document.querySelector('#human-tailor details select');
              const other = [...select.options].find((o) => o.value !== select.value).value;
              select.value = other; select.dispatchEvent(new Event('change', { bubbles: true })); await wait();
              out.fieldChange = status();
              document.querySelector('#undo').click(); await wait();
              const outfit = document.querySelector('#adult-outfit');
              outfit.value = 'Chore jacket'; outfit.dispatchEvent(new Event('change', { bubbles: true })); await wait();
              out.presetChosen = { status: status(), tailoredPiecesLeft: pieces().length, startOffered: !document.querySelector('#human-tailor button').hidden };
              document.querySelector('#undo').click(); await wait();
              out.afterUndo = { tailoredPieces: pieces().length, same: JSON.stringify(pieces()) === JSON.stringify(before) };
              return out;
            }""")
            report[name]["tailorPanel"] = panel
            print(name, "tailor panel", json.dumps(panel), flush=True)
        if player:
            page.goto(player.resolve().as_uri())
            page.wait_for_selector("#file", state="attached", timeout=60000)
            for glb in sorted(out.glob("*-full.glb")) + sorted(out.glob("*-game.glb")):
                page.set_input_files("#file", str(glb))
                page.wait_for_timeout(3500)
                page.screenshot(path=str(out / (glb.stem + "-played.png")))
                # From behind, then part-way through the first movement clip, where layers that cross would show.
                page.evaluate("([id, value]) => { const s = document.querySelector(id); s.value = value; s.dispatchEvent(new Event('change', { bubbles: true })); }", ["#camera-angle", "back"])
                page.wait_for_timeout(600)
                page.screenshot(path=str(out / (glb.stem + "-played-back.png")))
                clip = page.evaluate("() => { const s = document.querySelector('#clip'); if (s.disabled || s.options.length < 2) return ''; s.selectedIndex = 1; s.dispatchEvent(new Event('change', { bubbles: true })); return s.value; }")
                page.evaluate("([id, value]) => { const s = document.querySelector(id); s.value = value; s.dispatchEvent(new Event('change', { bubbles: true })); }", ["#camera-angle", "threequarter"])
                if clip:
                    page.wait_for_timeout(900)
                    page.screenshot(path=str(out / (glb.stem + "-played-moving.png")))
                print("played", glb.name, "clip", clip or "none", flush=True)
        report["pageErrors"] = errors
        browser.close()
    (out / "editor-pass.json").write_text(json.dumps(report, indent=1) + "\n", encoding="utf8")
    if errors:
        raise SystemExit("Page errors: " + "; ".join(errors))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--editor", default=str(ROOT / "dist" / "character-view.html"))
    parser.add_argument("--forms", default=str(ROOT / ".reference-cache" / "rocketbox" / "forms"))
    parser.add_argument("--out", default=str(ROOT / ".reference-cache" / "rocketbox" / "exports"))
    parser.add_argument("--player", default=str(ROOT / "dist" / "play-model.html"), help="page that plays an exported GLB; pass an empty value to skip")
    args = parser.parse_args()
    run(Path(args.editor), Path(args.forms), Path(args.out), Path(args.player) if args.player else None)
