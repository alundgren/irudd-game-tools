// Credits an exported adult carries (the human branch of afterParse in
// character-view/export-form.js at 2761eb1): the MakeHuman base, each HSRD-100
// scan whose face or skin the adult draws on, and the Rocketbox library when a
// cast shape, a portrait finish or a worn cast member comes from it, with the
// avatars a worn member is made from. Library clothes, hair and facial hair add
// their own credits once they are ported.

import type { Json } from "@irudd/document";
import { capturedSkinNames } from "./captured.js";
import {
  captureCredit,
  capturedAxes,
  capturedSources,
  castPeople,
  castShapeAxes,
  rocketboxCredit,
} from "./catalogue.js";
import { castDonor } from "./cast.js";
import { castOutfitSubjects } from "./cast-wardrobe.js";
import { humanWornCast, type HumanAdultParams } from "./generator.js";

/** The MIT notice that travels with a GLB wearing Rocketbox-derived artwork. */
export const rocketboxLicense =
  'MIT License\n\nCopyright (c) 2020 Microsoft\n\nPermission is hereby granted, free of charge, to any person obtaining a copy\nof this software and associated documentation files (the "Software"), to deal\nin the Software without restriction, including without limitation the rights\nto use, copy, modify, merge, publish, distribute, sublicense, and/or sell\ncopies of the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all\ncopies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR\nIMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,\nFITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE\nAUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER\nLIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,\nOUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.';
const rocketboxSource = `https://github.com/microsoft/Microsoft-Rocketbox/tree/${rocketboxCredit.commit}`;

export interface HumanCredits {
  /** Lines for `asset.copyright`, in the reference order. */
  readonly copyright: ReadonlyArray<string>;
  /** Entries for `asset.extras`. */
  readonly extras: Readonly<Record<string, Json>>;
}

/**
 * The credits of an adult built from `regions` of its body regions: a worn cast
 * member credits its avatars, and only its measurements, not a complexion,
 * draw on the scans.
 */
export function humanCredits(params: HumanAdultParams, regions?: number): HumanCredits {
  const copyright = ["Adult base and selected assets from the MakeHuman community, CC0 1.0."];
  const cast = humanWornCast(params, regions);
  const avatars: string[] = [];
  if (cast) {
    const subject = castPeople[cast]?.subject;
    if (subject) avatars.push(subject);
    avatars.push(...castOutfitSubjects(cast, params.style));
    const donor = castDonor(cast);
    if (donor && (params.style.castShape || params.style.castPigment)) avatars.push(donor);
  }
  const scans = capturedAxes
    .filter(
      (axis, k) =>
        (params.human[axis] ?? 0) > 0 || (!cast && capturedSkinNames[k] === params.complexion),
    )
    .map((axis) => capturedSources[axis]);
  const extras: Record<string, Json> = {};
  if (scans.length) {
    const { title, author, year, license, source, changes } = captureCredit;
    copyright.push(`${title}, ${author} (${year}), CC BY 4.0. ${changes} ${source} ${license}`);
    extras["capturedPortraits"] = { title, author, year, source, license, changes, scans };
  }
  const rocketbox =
    avatars.length > 0 ||
    castShapeAxes.some((axis) => (params.human[axis] ?? 0) > 0) ||
    (params.complexion?.startsWith("Portrait ") ?? false);
  if (rocketbox) {
    copyright.push(
      "Character artwork adapted from the Microsoft Rocketbox Avatar Library. Copyright (c) 2020 Microsoft, MIT.",
    );
    extras["rocketbox"] = {
      source: rocketboxSource,
      license: rocketboxLicense,
      ...(avatars.length ? { avatars: [...new Set(avatars)] } : {}),
    };
  }
  return { copyright, extras };
}
