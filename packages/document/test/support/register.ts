import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repository = path.resolve(fileURLToPath(new URL("../../../../", import.meta.url)));
const roots = [
  path.join(repository, "packages") + path.sep,
  path.join(repository, "apps") + path.sep,
  path.join(repository, "verification", "protocol") + path.sep,
  path.join(repository, "verification", "families") + path.sep,
];

function firstParty(url: string | undefined): boolean {
  if (typeof url !== "string" || !url.startsWith("file:")) return false;
  const file = fileURLToPath(url);
  return (
    !file.includes(`${path.sep}node_modules${path.sep}`) &&
    roots.some((root) => file.startsWith(root))
  );
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ERR_MODULE_NOT_FOUND" &&
        (specifier.startsWith("./") || specifier.startsWith("../")) &&
        specifier.endsWith(".js") &&
        firstParty(context.parentURL)
      ) {
        return nextResolve(specifier.slice(0, -3) + ".ts", context);
      }
      throw error;
    }
  },
});
