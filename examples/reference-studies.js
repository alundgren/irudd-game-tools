import { buildFigure } from "../character-view/figure.js";
import references from "./body-references.json" with { type: "json" };
import { scanFits } from "./local-references.js";

export const referenceStudies = Object.entries(scanFits ?? {}).map(
  ([id, figure]) => ({
    id: "scan-" + id,
    title: id.toUpperCase() + " · " + references[id].title,
    game: "Body scan study",
    source: references[id].page,
    angle: "Front",
    make: () => buildFigure(figure),
  }),
);
