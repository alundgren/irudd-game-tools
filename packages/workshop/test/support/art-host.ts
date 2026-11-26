// A project host that the art crash test kills. It serves the project and
// state directory it is given and terminates itself (SIGKILL, TerminateProcess
// on Windows) when the art service reaches the named cut point, so nothing
// after that point is written. Progress lines go to stdout synchronously.
//
//   { "path": <project>, "stateDir": <dir>, "cut": <ArtCut> }
import fs from "node:fs";
import { startHost } from "@irudd/workshop/host";
import { person } from "./art-fixtures.js";

const raw: unknown = JSON.parse(process.argv[2] ?? "{}");
if (typeof raw !== "object" || raw === null) throw new Error("art-host: expected JSON options");
const say = (event: Record<string, unknown>) => fs.writeSync(1, JSON.stringify(event) + "\n");
const point = String(Reflect.get(raw, "cut"));

await startHost({
  path: String(Reflect.get(raw, "path")),
  stateDir: String(Reflect.get(raw, "stateDir")),
  human: person,
  durability: "full",
  transports: [],
  artCut: (at) => {
    if (at !== point) return;
    say({ event: "cut", point: at });
    process.kill(process.pid, "SIGKILL");
  },
});
say({ event: "ready" });
setInterval(() => undefined, 1 << 30);
