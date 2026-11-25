# Complete looks for the adult

"Roll a look" dresses the adult in one coordinated outfit. `character-view/human-looks.js` chooses what is
worn, its colours, its cloth designs and, in a festive look, face paint. Hair, hair colour, fringe, facial
hair, worn marks and eyewear are still drawn in `dressHuman` (`human-wardrobe.js`) from the stream they have
always used, so a seed keeps those. The look comes from a second stream of its own.

## Using it

- **Roll a look** in the adult editor draws a new seed. **New looks lean** narrows the wardrobe and palette:
  Any, Everyday, Smart, Workwear, Outdoors, Festive or Adventure.
- Every choice the look makes is an ordinary saved field of `humanStyle`, so each can be changed afterwards on
  its own and each change is one Undo step.
- A look depends on the seed, the direction and the skin tone (large pieces are kept clear of it). It does not
  depend on the body: another build with the same skin is dressed the same.

```js
dressHuman(form, seed, "Festive");          // the form in a new look
completeLook(form, seed, "Any");            // { style, outfit, paint, marks, wardrobe, scheme }
```

## What a look is made of

| Part | How it is chosen |
| --- | --- |
| Wardrobe | One of the preset outfits, the library outfits, tailored separates (`humanStyle.tailor`) or an armour set (`humanStyle.armour`). Each has a weight and the directions it suits. |
| Palette | A scheme (one colour on a neutral, denim, tonal, analogous, pop, pastel, festive) gives a top, a lower piece, an accent, a pale and a deep neutral, leather, soles and metal. The two large pieces always differ in lightness. Outside Festive the colours are worn quieter than the colour wheel, and two strong colours are never worn on both large pieces. |
| Repeats | Small pieces repeat a colour that is already worn: tights and a belt take a deep relative of the sweater, a print usually takes a colour worn elsewhere in the look, worn face paint takes a colour of the clothes. |
| Designs | One patterned piece at a time. The main piece takes `clothDesign`; a second piece takes `secondDesign` only beside a plain or herringbone main piece. |
| Separates | Trousers or shorts, an inner top, sometimes an outer layer, footwear, and sometimes a belt or gloves, built with the tailor's own pieces. |

## Style fields

All are optional. A style saved without them renders as it did before.

| Field | Meaning |
| --- | --- |
| `clothSecond`, `clothLight`, `accentColor`, `leatherColor`, `soleColor`, `metalColor` | Name one tone of the outfit outright. An unset tone is derived from `clothColor` by the earlier rule (`palette()` in `human-style.js`). |
| `secondDesign` | The cloth design of the outfit's other large piece. |

Five designs were added to `clothDesign`: Gingham, Small dots, Chest band, Knit yoke and Hem border.

Three things change only for a style that uses the new fields:

- **Library clothes are dyed.** The scanned texture of a library outfit is redrawn with the named tones by
  region (suit cloth, shirt, tie, denim, leather), keeping the shading painted into the scan. Without named
  tones the outfit keeps its light tint. The scans and their licences are unchanged
  (see [human-style.md](human-style.md)).
- **Woven cloth has depth.** Cloth is woven with a soft, uneven wash and a hem stitch, weaker on pale cloth.
- **Tailored cloth takes designs.** With a chosen `clothDesign`, the outermost tailored top is woven in it and
  trousers take `secondDesign`. With no design, "Plain cloth" or "Outfit swatch", tailored pieces are untouched.

## Measured

Method: seeds are fixed before the generator is changed and are rendered once. The same figure, with the same
hair, camera and light, is dressed by the generator as it was before this work and by the new one. The sides
are shuffled per pair, and a reviewer with no knowledge of the code or the key judges the sheets. Renders are
native OpenGL on the GPU (NVIDIA RTX 5070 Ti) through the workshop's own wardrobe code; skin is drawn plain and
eyes blank. The sheets and seeds stay in the ignored `.reference-cache/looks/`.

| Held-out set | Pairs: new / old / tie | Variety, new vs old | Look quality, new vs old | Reviewer would ship |
| --- | --- | --- | --- | --- |
| 9412–9423, first version | 3 / 8 / 1 | 60 vs 42 | 42 vs 58 | old, about 65% |
| 9512–9523, after fixes | 10 / 2 / 0 | 62 vs 46 | 57 vs 44 | new, about 80% |
| 9612–9623, confirmation | 9 / 2 / 1 | 72 vs 40 | 61 vs 49 | new, about 85% |

The first version lost: garments were flat single colours, colours read as picked one garment at a time, and
some separates had visible defects. The fixes were quieter everyday colour with deliberate repeats, the cloth
wash, fewer separates (about 23% of looks), better cuts, and boots kept close under trouser legs. Each set
stopped counting as held out once it had informed a fix.

Both later reviewers said neither generator reaches a shipped Sims 4 or Dragon's Dogma 2 randomise button. The
cloth wash was softened once more after the last review, because that review called some trousers blotchy;
that last change has not been reviewed blind.

Not measured: the look in the browser editor with the real skin and eyes, and looks in motion.

## Known limits

These come from outfit geometry that this work did not change. Distinct tones make them easier to see.

- Skirt waistbands and dress belts stand off the body as a rigid ring.
- Under the chore jacket the trouser waistband shows through at the pocket line on heavy builds.
- Workshop overalls let the tee show through beside the bib.
- The leather armour's bracers show through the sleeves as ragged patches.
- The Explorer's harness straps end on the chest.
- Stripes and dots follow a flat chart, so they splay on sleeves and stretch on flared skirts. Looks avoid
  pinstripe on long sleeves and dots on dresses for that reason.

The starting-form panel lets the artist choose natural, fantasy or mixed adult colouring. Mixed draws a fantasy palette about once in twelve people. A fantasy palette combines a skin swatch with an iris colour and a pointed ear tip. Skin, eyes and ears remain individually editable. Dressing the person again keeps those personal choices.

The Salt-road warden wears an original weathered portrait painted onto his editable head. The front and profile source art was generated from the character and aligned in the workshop. The saved study carries the baked face texture. Remove it with the portrait paint control to reveal the underlying complexion.
