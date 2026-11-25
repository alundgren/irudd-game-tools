"""Place the raw head scans on the neutral editable head and write the placed meshes.

Usage: python scripts/head-study/prepare-targets.py CACHE [name ...]

CACHE holds the downloaded scans, one folder per source (see hs_targets.SOURCES
for the URLs and hashes). The placed meshes and their manifest are written to
CACHE/placed/ and CACHE/manifest.json. Reference assets never leave the cache.
"""

import json
import sys
from pathlib import Path

import numpy as np

import hs_targets
from hb_mesh import write_glb
from hs_fit import Head, ScanView, find_placement, region_weights
from hs_generator import Generator, HeadTopology


def main(cache, names):
    generator = Generator()
    topology = HeadTopology(generator)
    manifest = hs_targets.manifest(cache)
    manifest["note"] = ("Head scans placed on the neutral editable head (default recipe, 1.72 m, eyes closed). "
                        "Each scan was turned, moved and scaled as a whole. Triangles that cannot be seen from "
                        "outside, such as a modelled mouth cavity, were removed. The remaining shape is unchanged.")
    manifest["generator_sha256"] = generator.source_sha256
    for name in names:
        source = hs_targets.SOURCES[name]
        raw, faces = hs_targets.load_raw(name, cache)
        guesses = np.array(source["metres_per_unit"])
        middle = float(np.median(guesses))
        view = ScanView(raw * middle, faces, samples=12000, seed=5)
        head = Head(topology, generator.evaluate([{}], blink=source["blink"])[0], region_weights(source["not_skin"]))
        value, placement, scale, degrees = find_placement(head, view, guesses / middle, source["pitch_degrees"])
        placed = placement.apply(view.vertices)
        outside = hs_targets.outside_faces(placed, faces)
        if source.get("flat_cut"):  # scraps of the cast's inner face that a view caught through the opening
            outside[outside] = hs_targets.largest_piece(faces[outside])
        hidden = int((~outside).sum())
        used, compact = np.unique(faces[outside], return_inverse=True)
        placed, faces = placed[used], compact.reshape(-1, 3)
        path = hs_targets.placed_path(name, cache)
        path.parent.mkdir(parents=True, exist_ok=True)
        write_glb(path, placed, faces, copyright_text=source["attribution"], name=name,
                  extras={"source": source["url"], "license": source["license"]})
        entry = {
            "title": source["title"], "page": source["page"], "source": source["url"],
            "source_sha256": source["sha256"], "license": source["license"], "license_url": source["license_url"],
            "attribution": source["attribution"], "file": "placed/" + path.name,
            "sha256": hs_targets.sha256(path),
            "vertices": len(placed), "triangles": len(faces),
            "metres_per_source_unit": round(middle * placement.scale, 6),
            "scale_is_measured": len(guesses) == 1,
            "start": {"metres_per_unit": round(middle * scale, 6), "pitch_degrees": degrees},
            "interior_triangles_removed": hidden,
            "eyes": "closed", "not_skin": source["not_skin"],
        }
        manifest["targets"][name] = entry
        print(name, f"loss {value * 1e6:.2f}", json.dumps(entry["start"]), "metres per unit", entry["metres_per_source_unit"])
    hs_targets.manifest_path(cache).write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    generator.close()


if __name__ == "__main__":
    main(Path(sys.argv[1]), sys.argv[2:] or list(hs_targets.SOURCES))
