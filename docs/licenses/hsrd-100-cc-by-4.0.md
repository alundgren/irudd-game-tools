# HSRD-100 (Digital Reality Lab), CC BY 4.0

The scan hairstyles "Silver side part" and "Feathered dark crop" are cut from two scans in HSRD-100.

- Credit: HSRD-100: 100 High-Quality 3D Human Scans Dataset, DigitalRealityLab / HumanScanRepository
- Source: https://huggingface.co/datasets/digitalrealitylab/HSRD-100, revision `9cc5e9c138dd310dc88c95c80e5db0a3ecb7971a`
- Licence: Creative Commons Attribution 4.0 International, https://creativecommons.org/licenses/by/4.0/

## What was taken

| Hairstyle | Scan | Level of detail |
| --- | --- | --- |
| Silver side part | HSR0023-Body-017 | LOD1 mesh, 8K colour map |
| Feathered dark crop | HSR0112-Body-018 | LOD1 mesh, 8K colour map |

From each scan: the outer surface of the hair and the part of the colour photograph that shows it.

## What was changed

- The scanned head is fitted to the editable adult's head by its face, and the hair surface is cut out along the
  photographed hairline.
- The surface is simplified to about 5,500 triangles and stored in the proportions of the adult's head.
- The photograph is redrawn into one 512 pixel picture with a cut-out matte. The scanned person's own skin is taken
  out of it.
- In use the hair is re-dyed to the chosen hair colour and its roots are tinted to the wearer's skin.

The packed data is `character-view/human-scan-hair-data.json`. It carries the credit, source, revision, licence and
a summary of the changes. The scans are not in the repository.

Exported files that use a scan hairstyle name it in `asset.copyright` and in `asset.extras.scanHair`.

## Scanned knitwear

The tops "Crew sweatshirt" (HSR0023-Body-017) and "Cable V-neck" (HSR0112-Body-018) are taken from the same two scans, LOD1 mesh and 8K colour map.

- Taken: the outer surface of the sweatshirt or jumper as a distance from the wearer's body, and the part of the colour photograph that shows it.
- Changed: the surface is rebuilt on the editable adult's own trunk and arm mesh, the donor's build is smoothed out, one sleeve of the sweatshirt mirrors the other, unseen places are filled from the cloth round them, slow lighting is evened, and the cloth can be dyed.
- Credit carried by game exports: Scanned clothing adapted from HSRD-100 by Digital Reality Lab (CC BY 4.0).
