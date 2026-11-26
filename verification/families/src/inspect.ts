import { readFileSync } from "node:fs";
import { inspectGlb } from "@irudd/character";

const files = process.argv.slice(2);
const out = files.map((file) => ({ file, ...inspectGlb(new Uint8Array(readFileSync(file))) }));
console.log(JSON.stringify(files.length === 1 ? out[0] : out, null, 2));
