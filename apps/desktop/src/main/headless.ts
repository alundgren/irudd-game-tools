import path from "node:path";
import { runHeadless } from "@irudd/workshop/host-command";
import { desktopArtTranslators, shippedArtwork } from "./art.js";
import { humanHosting } from "./human.js";

const dist = path.resolve(import.meta.dirname, "..");
await runHeadless({
  formsDirectory: path.join(dist, "forms"),
  load: async () => {
    const { registry, starters } = await humanHosting(path.join(dist, "assets"));
    return { registry, starters, shippedArtwork, artTranslators: desktopArtTranslators() };
  },
});
