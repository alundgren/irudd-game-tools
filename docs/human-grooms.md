# Authored hair and facial hair for the adult human

Several adult haircuts and the moustache use grooms that MakeHuman and MakeHuman Community authors released under CC0. They are ordinary library hair: fitted to the head through the groom's own anchors on the hm08 skin, tinted by the hair colour of the style, listed in the editor's Hair control and drawn by the game exporter into the single atlas material.

| Style | Groom | Author | Licence | Page | Pack |
| --- | --- | --- | --- | --- | --- |
| Layered short | short01 | MakeHuman team | CC0 | system assets | system |
| Receding short | short01 with a receding hairline | MakeHuman team | CC0 | system assets | system |
| Sleek bob | Bob | MargaretToigo | CC0 | <http://www.makehumancommunity.org/node/1669> | hair01 |
| Fringed bob | Bob with fringe | MargaretToigo | CC0 | <http://www.makehumancommunity.org/node/1681> | hair01 |
| Curled-under bob | Curled bob | MargaretToigo | CC0 | <http://www.makehumancommunity.org/node/1677> | hair01 |
| Angled bob | Inverted bob | MargaretToigo | CC0 | <http://www.makehumancommunity.org/node/1673> | hair01 |
| Tied bun | ponytail01 wound into a chignon | MakeHuman team | CC0 | system assets | system |
| Loose waves | Cloud waves | Cortu Johnstone | CC0 | <http://www.makehumancommunity.org/node/2808> | hair01 |
| Long centre part | long01 | MakeHuman team | CC0 | system assets | system |
| Side-swept pixie | short03 | MakeHuman team | CC0 | system assets | system |
| Low ponytail | ponytail01 | MakeHuman team | CC0 | system assets | system |
| Moustache | Viking moustache | RehmanPolanski | CC0 | <http://www.makehumancommunity.org/node/2615> | bodyparts05 |

The community grooms come from the official `hair01` and `bodyparts05` CC0 asset packs (`asset_packs/<pack>/<pack>_cc0.zip` on files.makehumancommunity.org); the system grooms come from the MakeHuman system assets, released as CC0 in September 2020. The [CC0 text](licenses/makehuman-cc0.md) applies. The packer takes a community groom only when the community asset index lists it as CC0, and a system groom only when its file carries the CC0 release.

Each packed groom records the release from its source file in `credit.fileLicenceLine`. The layered short cut and the receding cut use the system short01 locks. The chignon uses the complete painted locks from the system ponytail01, wound around its tie point and attached to the skull.

## Packing

```
python scripts/pack-human-grooms.py SOURCE_FOLDER character-view/human-grooms-data.json
```

`SOURCE_FOLDER` holds the unpacked grooms and the community `assets.json`, kept outside the repository. The packer needs Python with NumPy, SciPy and Pillow, and Node for its finishing step (`scripts/pack-human-grooms-finish.mjs`). It writes the file whole or not at all. Beyond the authored mesh, fit and paint it adds:

- a strand map in neutral tone: the painted strands are brought to one mid grey with their lock-to-lock contrast kept, so any hair colour tints them without going dark;
- cards trimmed to their painted hair, and whole cards for a game model;
- the scalp each groom covers, so the painted roots under it end at the groom's own hairline;
- for the receding cut, the hair over the temples and the front of the crown cleared along one line across every card, with the cards near the line laid close to the head.

## Wearing

`character-view/human-authored-hair.js` names the styles and fits them. Hair that stands off the head (a bob's hem, a bun, a ponytail) follows the skull as one piece, so it keeps its combed shape on any neck and shoulders. The moustache uses authored cards. Short and full beards use original generated grayscale artwork. A continuous layer of short hairs covers the jaw and cheeks. Six cutout tufts give the beard its tips and outline. Both layers take their colour from the Hair colour control. Matching relief and roughness maps share the exported material. Each follows the face through Blink, Smile and BrowLift. Clay uses the sculpted mass.

A draw keeps the cut, colour and facial hair it always drew. `dressHuman` then wears the cut as a fitted groom where one is listed for it (`hairWornFor` in `character-view/human-wardrobe.js`), chosen from a random stream of its own. Between four and five of ten ordinary draws wear an authored groom; coils, curls, afro, buzz cut and braids stay as they were.

`character-view/human-authored-hair.test.js` covers the credits, every saved hair name, the fit on five head shapes, roots, held hems and the share of draws.

## Curly and coily hair

Coiled crop, Rounded coils, Curls, Afro and Natural curls are one sculpted mass per head (`character-view/human-hair-clumps.js`). The clumps of a style are the cells round scattered points on a sphere of head directions. Each cell is a dome with a crease where it meets its neighbours, so clumps touch all the way round and the outline of the head is whole clumps. The picture and its relief are drawn in code from the same cells: lobes of about a centimetre for coils and wound bands for ringlets, sized for the few hundred pixels hair gets in the 1024 atlas. A band on the scalp follows each adult's own hairline and is cut by alpha into fine hairs. Curls and Natural curls hang past the hairline behind the ears and are kept out of the neck. In clay the raised and sunken volume alone represents the hair. The mass is between 3,400 and 4,800 triangles and the game export keeps it as built.

## Drawn-back hair

Low ponytail, Crown braid, Braid, Bun and Ponytail fit an original painted scalp to each head from crown to hairline. The same chart mixes the chosen dye into the skin colour at the temples and nape. The knot, plait or tail has its own geometry. The halo braid winds three strands around the measured skull. Long centre part and Loose waves use their library grooms.

The brushed scalp, coil undercoat and lock paintings were generated for this project with OpenAI ImageGen and packed as grayscale samples. The hair is tinted at runtime. The curl mass does not use the coil undercoat or the lock paintings; `character-view/human-curls.js` still carries them.

Natural curls keeps its name and its place in the list of styles; it is grown as long ringlets and no longer worn from the library groom `afro01`. `character-view/human-curls.test.js` covers the clumps, the picture, the fit, cover and facing on four heads, the outlines, clay and the seeded draws.

Loose waves combs the outer locks away from the temples and grows shorter, finer hair across the forehead. Its generated root strip stores strand tone and coverage separately so the transition can take the saved skin and hair colours, including pale hair on dark skin.

## Fringed ponytail and Feathered pixie

These two editable cuts use the scalp and hair ribbons of Female Adult 12 and 13 from Microsoft Rocketbox. The source photographs are separated from the skin and registered to the fitted skull. The saved hair colour dyes the cut, and fringe and hat controls still act on its geometry. The original models remain available in the [Microsoft Rocketbox library](https://github.com/microsoft/Microsoft-Rocketbox/tree/0943055db6ec570bcef9f2c8b41c9e5467c808f9).

To repack them, run Blender in background with `scripts/rocketbox-extract.py -- SOURCE OUTPUT`, where each source avatar has its own folder with the original FBX. Run `python scripts/pack-human-production-hair.py OUTPUT SOURCE character-view/human-production-hair-data.json` on those two meshes and textures. Each exported GLB carrying either cut includes the MIT notice in its asset metadata.
