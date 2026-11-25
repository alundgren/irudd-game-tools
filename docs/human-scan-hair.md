# Scan hair

Two hairstyles for the editable adult are cut from 3D scans of real people: "Silver side part" and
"Feathered dark crop". Each is the scanned outer surface of the hair, worn with its own photograph. Both are
choices in the Hair list. Random looks do not draw them.

The scans come from HSRD-100 under CC BY 4.0. Credit, licence and the list of changes are in
[licenses/hsrd-100-cc-by-4.0.md](licenses/hsrd-100-cc-by-4.0.md).

## What a scan cut is

- One mesh of about 5,500 triangles, weighted to the head.
- One 512 pixel picture: the photograph of the hair, and a matte that cuts the outline. The hairline is the
  photographed one, not the edge of the mesh.
- The code is `character-view/human-scan-hair.js` and the data is `character-view/human-scan-hair-data.json`.

## How it fits a head

Each point is stored in the proportions of the head (its centre and three radii) with the height it stood above the
scanned skull. On the wearer:

- Hair within 4 mm of the scanned skull keeps that height, so the hairline lies on the skin of any head.
- Hair more than 16 mm up keeps its scanned shape. Between the two the fit blends.
- No point goes closer to the skin than 1.6 mm.

Hats press it down like any other hair.

## How it takes a dye

Every texel keeps its ratio to the middle tone of the scanned hair, channel by channel. Lighter, darker, warmer and
cooler strands stay so in any hair colour, and grey hair keeps its several greys. Three adjustments apply:

- The chosen colour is darkened to 55–72 % for the middle tone, as the other cuts do, so one hair colour reads alike
  across styles.
- Hair that photographs with a wide range (very dark hair with light strands) has its range drawn in, so a light dye
  does not glare.
- Where the matte thins towards the hairline, the colour moves towards the wearer's skin.

## Exports

A scan cut exports through the normal Game export with the rest of the person: one material, cut-out alpha. The file
names the scan in `asset.copyright` and in `asset.extras.scanHair` (`scans`, `credit`, `source`, `revision`,
`license`, `changes`).

## Making the data again

The scripts are in `scripts/scan-hair/`. They read and write `.reference-cache/scan-hair11/`, which is not in the
repository. They need:

- the scan renderer and Python environment in `.reference-cache/scan-person11/` (`render.py`, `face.task`, `env/`);
- the editor's default adult surface, `.reference-cache/studio-head10/work/native.json`, written by
  `scripts/studio-head-native.mjs`.

Run from the repository root, with `PY=.reference-cache/scan-person11/env/Scripts/python.exe`:

```
$PY -I scripts/scan-hair/fetch.py HSR0112-Body-018          # a scan that is not already in scan-person11
node scripts/scan-hair/frame.mjs                            # the default head frame, once
$PY scripts/scan-hair/align.py HSR0023-Body-017             # fit the scanned head to the adult's by its face
$PY scripts/scan-hair/extract.py HSR0023-Body-017 --theta 138
$PY scripts/scan-hair/align.py HSR0112-Body-018
$PY scripts/scan-hair/extract.py HSR0112-Body-018 --theta 138
node scripts/scan-hair/pack.mjs "Silver side part=HSR0023-Body-017:5500" "Feathered dark crop=HSR0112-Body-018:5500"
```

`align.py` writes a picture of the two heads together and `extract.py` a picture of the chart, matte and cut-out
(`work/NAME-align.jpg`, `work/NAME-chart.jpg`). Look at both before packing.

`extract.py` unrolls the head round the crown into one square chart, with the face towards the bottom and the rim
`--theta` degrees down from the top. It classes each texel as hair or skin by colour, keeps the hair joined to the
crown, and cuts everything in front of the face below the eyes. `--band` treats a cloth band in the hair as hair and
paints it from the hair above it.

## Limits

- The method takes the outermost surface in each direction from the centre of the head. It suits short and
  medium cuts. Long curls that hang in layers (HSR0102-Body-019 was tried) come out ragged and are not included.
- At the Game export's 1024 pixel atlas the hairline is coarser and the hair softer than in the scan.
- Both cuts cover a full head of hair. They do not show a receding hairline.
- The adult's ears show through hair that covered the scanned person's ears.
