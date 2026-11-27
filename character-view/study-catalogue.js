import {humanStudies} from "../examples/human-studies.js";
import { buildTraceMap } from "./trace-map.js";
import tidebellMap from "../examples/tidebell.trace.json";
import glider from "../examples/estuary-glider.form.json";
import beetle from "../examples/accepted-beetle.form.json";
import { studies as proceduralStudies } from "../examples/studies.js";
import { creatureStudies } from "../examples/creature-studies.js";
import { mhrStudies } from "../examples/mhr-study.js";
import { referenceStudies } from "../examples/reference-studies.js";
import { paintedStudies } from "../examples/painted-studies.js";
export const studies = [
  ...humanStudies,
  ...creatureStudies,
  ...proceduralStudies,
  ...paintedStudies,
  ...referenceStudies,
  ...mhrStudies,
  {
    id: "tidebell",
    title: "Tidebell · open carapace",
    game: "Artwork fit",
    make: () => buildTraceMap(tidebellMap, "tidebell"),
  },
  {
    id: "glider",
    title: "Estuary glider",
    game: "AI trial",
    make: () => structuredClone(glider.form),
  },
  {
    id: "beetle",
    title: "Beetle hybrid",
    game: "AI trial",
    make: () => structuredClone(beetle.form),
  },
];
