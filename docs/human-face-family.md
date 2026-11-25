# Face families

A face family replaces the editable adult's native head with a head made by a studio artist, together with the eyes,
brows, lashes, hair and colour maps made for it. The adult stays editable: the body, the wardrobe, the head controls,
expressions and gaze all keep working. The family is a choice in the adult's style, `humanStyle.faceFamily`.

| Value | Head |
| --- | --- |
| omitted or `None` | The native face with every native control |
| `Studio Rain` | Rain v3 by Blender Studio, CC BY 4.0 ([licence record](licenses/studio-rain-cc-by-4.0.md)) |

New people and ordinary draws use the native face. A family is chosen in the editor under Face family, or with
"Start a Studio Rain person", which also sets the build, skin, hair and eye colour the head was drawn for.

## What a family carries

With Studio Rain worn, the head, eyes, brows, lashes and hair come from the family. These choices are kept in the
save but not drawn, and the editor holds their fields: hairstyle, fringe, facial plane shading, eyebrows, facial
hair, makeup, eyewear, earrings, hat and hat colour. Complexion and face marks are not drawn either. Choosing `None`
shows them again unchanged.

These still apply: skin tone, hair colour, eye colour, every head and body control, age, expressions (Blink, Smile,
BrowLift), gaze, clothing and the game export.

## Hair in both directions

The hair made for the family and the adult's own hairstyles can be swapped.

- **The family's cut on any adult.** The hairstyle `Ribbon ponytail` is Rain's hair. On a native adult every hair
  point follows the studio scalp to where that scalp is tied on the adult's own skin, so the cut follows head
  width, frame and age. It takes any hair colour: the dye's own colour is lit and shaded as the artist painted.
  Under a hat the tail, its band and the loose front lock are left out. Ordinary draws do not pick this cut.
- **Other hair on the family.** `humanStyle.faceFamilyHair` is `Family` (the default, also for people saved before
  the key existed) or `Chosen`. With `Chosen` the head wears the hairstyle named in `hair`, and `None` is a bare
  head. The adult's hat, eyewear and earrings are worn too. These pieces are made for the native head and are
  carried onto the studio head by the difference between the two skins near each point.

With `Chosen` the editor holds only facial plane shading, eyebrows, facial hair and makeup.

An export credits Rain when a person wears the family or the cut alone. The cut alone is recorded in
`asset.extras.studioHair`.

A held-out comparison on 24 November 2026 took the first six adults drawn from seed 906600 upward that wear a native
ponytail and gave each the Ribbon ponytail. The cut was cleaner in profile on four of the five where hair shows, and
mixed from the front: it has one high hairline and one shape for everyone. It stays a hairstyle to choose and is not
substituted in draws.

## How it works

1. `scripts/studio-head-extract.py` runs in Blender on the original file and writes the head and its pieces at rest
   and in three posed expressions.
2. `scripts/studio-head-native.mjs` writes the native default adult's skin.
3. `scripts/pack-human-studio-head.py` pairs 35 landmarks on the two heads, warps the studio head onto the native
   one, and ties every studio vertex to the nearest native skin point. It writes
   `character-view/human-studio-head-data.json`.
4. `character-view/human-studio-head.js` builds the head for a person. It fits the tied points of that person's
   native skin to the default ones as a whole, then moves each studio vertex by what the native skin did at its tied
   point. Near the neck the head settles onto the native skin and is sewn to the native neck edge.

## Measured on 24 November 2026

Greatest movement of the head skin for one control at +1 on the default adult, in millimetres:

| Control | Studio Rain | Native |
| --- | ---: | ---: |
| Nose width | 2.8 | 2.8 |
| Cheeks | 5.7 | 6.5 |
| Jaw | 9.2 | 9.9 |
| Chin | 10.1 | 10.1 |
| Eye size | 2.0 | 2.0 |
| Age 0.95 | 15.8 | 15.2 |

The lips take half of the native change, because the family's lips are already full.

Game exports of seven people wearing the family came to 23,999 or 24,000 triangles and one material. A person saved,
reopened and exported again gave the same file byte for byte.

## Limits

- Every person wearing the family reads as the same young woman. Age changes the shape but adds no wrinkles, and
  there is no beard. It does not suit older or bearded people.
- With the family's own hair, native hats, eyewear and earrings are not drawn. Choose `Chosen` hair to wear them.
- The family's ears are large and show through native hair that covers the ears.
- The tail of the Ribbon ponytail passes through a high collar.
- The head is painted in a stylized way and the body is not, so the two differ in finish at the neck.
- The sculpt brush does not pick this head.
