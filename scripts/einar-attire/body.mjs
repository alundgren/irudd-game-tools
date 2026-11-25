// The neutral adult the garments are fitted on: node scripts/einar-attire/body.mjs OUT.json
import fs from "node:fs";
import { evaluateHuman, humanRestPositions } from "../../character-view/human-surface.js";

const g = evaluateHuman({}), list = a => Array.from(a);
fs.writeFileSync(process.argv[2], JSON.stringify({ p: list(humanRestPositions()), seen: list(g.positions), tri: list(g.indices.slice(0, g.bodyTriangles * 3)), ids: list(g.ids), names: g.names, joints: list(g.joints), bones: list(g.boneIndices), weights: list(g.weights), n: g.bodyVertices }));
