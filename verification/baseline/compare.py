"""G0 baseline: measure variance between repeated captures and repeated exports.

  python verification/baseline/compare.py captures CAPTURE_DIR
      Compares every shot of r1..rN against r0 (same GLB, same preset). Writes
      CAPTURE_DIR/variance.json with per-shot pixel statistics and an overall envelope:
      byte-identical count, max channel difference, mean absolute difference and the share
      of pixels that differ by more than 0, 8 and 32 levels. "worst" ranks shots by the share
      of changed pixels, then the largest difference; "changed" names every non-identical shot.
  python verification/baseline/compare.py pixels CAPTURE_DIR
      Decodes every retained frame of every repeat into CAPTURE_DIR/pixels.json: file
      SHA-256, width, height, PNG mode and a pixel digest (SHA-256 of 8-bit RGBA rows). When
      the repeats of a shot disagree, the majority is the consensus and the rest are named.
  python verification/baseline/compare.py reencode CAPTURE_DIR OUT.json [LIMIT]
      Re-encodes r0 frames with Pillow at PNG compression levels 1 and 9 and counts how
      many keep the file hash and how many keep the pixel digest.
  python verification/baseline/compare.py frames CAPTURE_DIR BASELINE.json SECTION [N|all]
      Re-decodes N evenly spread r0 frames (default 24) and checks their file hash and
      decoded record against baseline.json frozen.captures.SECTION (shipped or fresh).
  python verification/baseline/compare.py exports RUN_A RUN_B OUT.json
      Compares two export runs file by file: file SHA-256, encoding-independent content
      digest (glb.mjs) and decoded pixels of every embedded image.
  python verification/baseline/compare.py shipped EXPORT_DIR OUT.json
      Compares each tracked examples/NAME.glb with the fresh NAME-game.glb export:
      structure counts, clip names, morph target names and material count.

Only PIL and NumPy are needed.
"""
import hashlib, io, json, struct, subprocess, sys
from pathlib import Path
import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent


def pixels(png):
    return np.asarray(Image.open(png).convert("RGBA"), dtype=np.int16)


def decoded(png_bytes):
    """File hash plus the decoded image: width, height, PNG mode and the SHA-256 of its pixels
    as 8-bit RGBA rows, top to bottom. The pixel digest ignores PNG compression and chunks."""
    img = Image.open(io.BytesIO(png_bytes))
    return {"sha256": hashlib.sha256(png_bytes).hexdigest(), "width": img.width, "height": img.height, "mode": img.mode,
            "pixelSha256": hashlib.sha256(img.convert("RGBA").tobytes()).hexdigest()}


def severity(r):
    """Sort key for repeat differences: most differing pixels, then largest level, then mean."""
    return (-r.get("share>0", 0), -r.get("maxDiff", 0), -r.get("meanAbsDiff", 0), r["shot"], r["against"])


def cmd_pixels(root):
    """Decode every retained frame of every repeat. Writes CAPTURE_DIR/pixels.json with each
    frame's file hash, size, mode and pixel digest, and names the repeat that disagrees when
    the repeats of a shot do not all share one pixel digest (the majority is the consensus)."""
    root = Path(root)
    repeats = sorted((p for p in root.iterdir() if p.is_dir() and p.name.startswith("r")), key=lambda p: int(p.name[1:]))
    frames = {r.name: {str(f.relative_to(r)).replace("\\", "/"): decoded(f.read_bytes()) for f in sorted(r.rglob("*.png"))} for r in repeats}
    shots = sorted(set().union(*frames.values()))
    disagreements = []
    for shot in shots:
        seen = {r: frames[r][shot]["pixelSha256"] for r in frames if shot in frames[r]}
        if len(set(seen.values())) > 1 or len(seen) < len(frames):
            groups = {}
            for r, d in seen.items(): groups.setdefault(d, []).append(r)
            consensus = max(groups.values(), key=len)
            disagreements.append({"shot": shot, "consensus": consensus, "outliers": sorted(set(frames) - set(consensus)),
                                  "missingIn": sorted(set(frames) - set(seen))})
    base = frames[repeats[0].name]
    pairs = [(base[s], frames[r][s]) for r in list(frames)[1:] for s in shots if s in base and s in frames[r]]
    summary = {"repeats": list(frames), "framesPerRepeat": {r: len(v) for r, v in frames.items()}, "shots": len(shots),
               "againstFirstRepeat": {"comparisons": len(pairs), "sameFile": sum(a["sha256"] == b["sha256"] for a, b in pairs),
                                      "samePixels": sum(a["pixelSha256"] == b["pixelSha256"] for a, b in pairs)},
               "modes": sorted({d["mode"] for v in frames.values() for d in v.values()}),
               "sizes": len({(d["width"], d["height"]) for v in frames.values() for d in v.values()}),
               "shotsWhereRepeatsDisagree": len(disagreements)}
    (root / "pixels.json").write_text(json.dumps({"summary": summary, "disagreements": disagreements, "frames": frames}, indent=1), encoding="utf8")
    print(json.dumps({**summary, "disagreements": disagreements}, indent=2))


def cmd_reencode(root, out, limit=None):
    """Re-encode the r0 frames with Pillow at compression levels 1 and 9 and compare each copy
    with the retained Chrome PNG by file hash and by pixel digest."""
    root = Path(root); rows = []
    files = sorted((root / "r0").rglob("*.png"))
    for f in files[: int(limit)] if limit else files:
        raw = f.read_bytes(); src = decoded(raw); img = Image.open(io.BytesIO(raw)); row = {"shot": str(f.relative_to(root / "r0")).replace("\\", "/")}
        for level in (1, 9):
            buf = io.BytesIO(); img.save(buf, "PNG", compress_level=level); re = decoded(buf.getvalue())
            row[f"level{level}"] = {"sameFile": re["sha256"] == src["sha256"], "samePixels": re["pixelSha256"] == src["pixelSha256"],
                                    "sameSizeAndMode": (re["width"], re["height"], re["mode"]) == (src["width"], src["height"], src["mode"]),
                                    "bytes": len(buf.getvalue()), "sourceBytes": len(raw)}
        rows.append(row)
    summary = {"frames": len(rows), "of": len(files), "encoder": f"Pillow {Image.__version__}"}
    for level in (1, 9):
        k = f"level{level}"
        summary[k] = {m: sum(r[k][m] for r in rows) for m in ("sameFile", "samePixels", "sameSizeAndMode")}
    Path(out).write_text(json.dumps({"captureDir": str(root), "summary": summary, "rows": rows}, indent=1), encoding="utf8")
    print(json.dumps(summary, indent=2))


def cmd_frames(root, baseline, section, count="24"):
    """Re-decode r0 frames (every Nth of them, or all) and check them against the decoded
    records frozen in baseline.json frozen.captures.SECTION.r0. Exits 1 on any mismatch."""
    frozen = json.loads(Path(baseline).read_text(encoding="utf8"))["frozen"]["captures"][section]["r0"]
    keys = sorted((g, s) for g, v in frozen.items() for s in v["shots"])
    step = 1 if count == "all" else max(1, len(keys) // int(count))
    bad = []
    for g, s in keys[::step]:
        d = decoded((Path(root) / "r0" / g / f"{s}.png").read_bytes())
        if d["sha256"] != frozen[g]["shots"][s] or [d["width"], d["height"], d["mode"], d["pixelSha256"]] != frozen[g]["decoded"][s]:
            bad.append(f"{g}/{s}")
    print(json.dumps({"section": section, "checked": len(keys[::step]), "of": len(keys), "mismatches": bad}))
    sys.exit(1 if bad else 0)


def shot_stats(a, b):
    if a.shape != b.shape:
        return {"shapeMismatch": [list(a.shape), list(b.shape)]}
    d = np.abs(a - b).max(axis=2)
    n = d.size
    return {"identical": bool((d == 0).all()), "maxDiff": int(d.max()), "meanAbsDiff": float(np.abs(a - b).mean()),
            "share>0": float((d > 0).sum() / n), "share>8": float((d > 8).sum() / n), "share>32": float((d > 32).sum() / n),
            "size": [int(a.shape[1]), int(a.shape[0])]}


def cmd_captures(root):
    root = Path(root)
    repeats = sorted(p for p in root.iterdir() if p.is_dir() and p.name.startswith("r"))
    base, rows = repeats[0], []
    for other in repeats[1:]:
        for png in sorted(base.rglob("*.png")):
            rel = png.relative_to(base); twin = other / rel
            row = {"shot": str(rel).replace("\\", "/"), "against": other.name}
            row.update(shot_stats(pixels(png), pixels(twin)) if twin.exists() else {"missing": True})
            rows.append(row)
    ok = [r for r in rows if "maxDiff" in r]
    envelope = {
        "comparisons": len(rows), "identical": sum(r["identical"] for r in ok),
        "missingOrMismatched": len(rows) - len(ok),
        "maxDiff": max((r["maxDiff"] for r in ok), default=0),
        "maxMeanAbsDiff": max((r["meanAbsDiff"] for r in ok), default=0),
        "maxShare>0": max((r["share>0"] for r in ok), default=0),
        "maxShare>8": max((r["share>8"] for r in ok), default=0),
        "maxShare>32": max((r["share>32"] for r in ok), default=0),
    }
    # Rank by how many pixels changed, then by level, so identical shots sort last by name.
    worst = sorted(ok, key=severity)[:10]
    envelope["changed"] = [{"shot": r["shot"], "against": r["against"], "maxDiff": r["maxDiff"],
                            "pixels>0": round(r["share>0"] * r["size"][0] * r["size"][1])} for r in sorted(ok, key=severity) if not r["identical"]]
    (root / "variance.json").write_text(json.dumps({"envelope": envelope, "worst": worst, "rows": rows}, indent=2), encoding="utf8")
    print(json.dumps(envelope, indent=2))


def glb_parts(path):
    data = Path(path).read_bytes(); n = struct.unpack_from("<I", data, 12)[0]
    g = json.loads(data[20:20 + n]); binstart = 20 + n + 8
    return g, data[binstart:]


def image_digests(path):
    g, bin_ = glb_parts(path); out = []
    for im in g.get("images", []):
        v = g["bufferViews"][im["bufferView"]]; raw = bin_[v.get("byteOffset", 0): v.get("byteOffset", 0) + v["byteLength"]]
        img = Image.open(io.BytesIO(raw)); arr = np.asarray(img.convert("RGBA"))
        out.append({"mime": im.get("mimeType"), "bytes": len(raw), "fileSha": hashlib.sha256(raw).hexdigest()[:16],
                    "pixelSha": hashlib.sha256(arr.tobytes()).hexdigest()[:16], "size": list(img.size), "mode": img.mode})
    return out


def summaries(paths):
    if not paths: return {}
    res = subprocess.run(["node", str(HERE / "glb.mjs"), *map(str, paths)], capture_output=True, text=True, check=True)
    return {Path(j["file"]).name: j for j in map(json.loads, res.stdout.splitlines())}


def cmd_exports(a, b, out):
    a, b = Path(a), Path(b)
    names = sorted({p.name for p in a.glob("*.glb")} & {p.name for p in b.glob("*.glb")})
    sa, sb = summaries([a / n for n in names]), summaries([b / n for n in names])
    rows = []
    for n in names:
        ia, ib = image_digests(a / n), image_digests(b / n)
        rows.append({"file": n, "sameBytes": (a / n).read_bytes() == (b / n).read_bytes(),
                     "sameContentDigest": sa[n]["contentDigest"] == sb[n]["contentDigest"],
                     "sameImageBytes": [x["fileSha"] for x in ia] == [x["fileSha"] for x in ib],
                     "sameImagePixels": [x["pixelSha"] for x in ia] == [x["pixelSha"] for x in ib],
                     "integrityA": sa[n]["integrity"], "integrityB": sb[n]["integrity"]})
    summary = {k: sum(r[k] for r in rows) for k in ("sameBytes", "sameContentDigest", "sameImageBytes", "sameImagePixels")}
    summary["files"] = len(rows)
    summary["onlyInA"] = sorted({p.name for p in a.glob("*.glb")} - set(names))
    summary["onlyInB"] = sorted({p.name for p in b.glob("*.glb")} - set(names))
    Path(out).write_text(json.dumps({"a": str(a), "b": str(b), "summary": summary, "rows": rows}, indent=2), encoding="utf8")
    print(json.dumps(summary, indent=2))


def cmd_shipped(export_dir, out):
    export_dir = Path(export_dir); repo = Path.cwd()
    shipped = sorted((repo / "examples").glob("*.glb"))
    # A shipped GLB with several scenes was exported with all saved outfits.
    def fresh_for(s):
        g, _ = glb_parts(s); outfits = export_dir / f"{s.stem}-game-outfits.glb"
        return outfits if len(g.get("scenes", [])) > 1 and outfits.exists() else export_dir / f"{s.stem}-game.glb"
    pairs = [(s, fresh_for(s)) for s in shipped]
    ss = summaries([s for s, _ in pairs]); fs = summaries([f for _, f in pairs if f.exists()])
    rows = []
    for s, f in pairs:
        a = ss[s.name]; b = fs.get(f.name)
        row = {"shipped": s.name, "fresh": f.name if b else None}
        if b:
            keys = ("scenes", "meshes", "materials", "images", "skins", "joints", "morphTargets", "animations", "triangles")
            row["countDiffs"] = {k: [a["counts"][k], b["counts"][k]] for k in keys if a["counts"][k] != b["counts"][k]}
            row["clipsShipped"] = [x["name"] for x in a["animations"]]; row["clipsFresh"] = [x["name"] for x in b["animations"]]
            row["morphsShipped"] = sorted({t for m in a["meshes"] for t in m["targetNames"]}); row["morphsFresh"] = sorted({t for m in b["meshes"] for t in m["targetNames"]})
            row["sameStructure"] = not row["countDiffs"] and row["clipsShipped"] == row["clipsFresh"] and row["morphsShipped"] == row["morphsFresh"]
        rows.append(row)
    summary = {"shipped": len(rows), "withFreshExport": sum(1 for r in rows if r["fresh"]), "sameStructure": sum(1 for r in rows if r.get("sameStructure"))}
    Path(out).write_text(json.dumps({"summary": summary, "rows": rows}, indent=2), encoding="utf8")
    print(json.dumps(summary, indent=2))


cmd, *rest = sys.argv[1:]
{"captures": cmd_captures, "pixels": cmd_pixels, "reencode": cmd_reencode, "frames": cmd_frames, "exports": cmd_exports, "shipped": cmd_shipped}[cmd](*rest)
