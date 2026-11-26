export function parseDecks(text) {
  if (typeof text !== "string" || text.length > 3200)
    throw new Error("Keep your choices under 3,200 characters.");
  const labels = new Set();
  return text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf("=");
      const label = line.slice(0, separator).trim();
      const options = line
        .slice(separator + 1)
        .split("|")
        .map((s) => s.trim());
      if (
        separator < 1 ||
        !label ||
        label.length > 48 ||
        labels.has(label) ||
        labels.size >= 8 ||
        options.length < 2 ||
        options.length > 16 ||
        options.some((s) => !s || s.length > 96) ||
        new Set(options).size !== options.length
      )
        throw new Error(
          "Use up to eight unique names. Give each 2–16 different choices on one line, separated by |.",
        );
      labels.add(label);
      return { label, options };
    });
}
export const deckText = (decks) =>
  (decks ?? []).map((d) => d.label + " = " + d.options.join(" | ")).join("\n");
function choose(seed, label, count) {
  let h = 2166136261;
  for (const c of label) h = Math.imul(h ^ c.codePointAt(0), 16777619);
  h ^= seed;
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad);
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97);
  h = (h ^ (h >>> 15)) >>> 0;
  return Math.floor((h / 4294967296) * count);
}
export function drawDecks(definitions, seed, previous = []) {
  return definitions.map(({ label, options }) => {
    const match = previous.find(
      (d) =>
        d.label === label &&
        d.options.length === options.length &&
        options.every((v, i) => v === d.options[i]),
    );
    const pin = match?.pin ?? null;
    return {
      label,
      options: [...options],
      pin,
      value: options[choose(pin ?? seed, label, options.length)],
    };
  });
}
export function encodeDecks(decks) {
  const data = JSON.stringify(
    decks.map(({ label, options, pin }) => [label, options, pin]),
  );
  return btoa(String.fromCharCode(...new TextEncoder().encode(data)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}
export function decodeDecks(token) {
  if (!/^[\w-]{1,20000}$/.test(token))
    throw new Error("Invalid choices in direction code.");
  try {
    const data = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        Uint8Array.from(
          atob(token.replaceAll("-", "+").replaceAll("_", "/")),
          (c) => c.charCodeAt(0),
        ),
      ),
    );
    if (
      !Array.isArray(data) ||
      data.length > 8 ||
      data.some(
        (row) =>
          !Array.isArray(row) ||
          row.length !== 3 ||
          typeof row[0] !== "string" ||
          !Array.isArray(row[1]) ||
          !row[1].every((s) => typeof s === "string") ||
          (row[2] !== null &&
            (!Number.isInteger(row[2]) || row[2] < 0 || row[2] > 0xffffffff)),
      )
    )
      throw new Error();
    const decks = data.map(([label, options, pin]) => ({
      label,
      options,
      pin,
    }));
    const parsed = parseDecks(deckText(decks));
    if (
      JSON.stringify(parsed) !==
      JSON.stringify(decks.map(({ label, options }) => ({ label, options })))
    )
      throw new Error();
    return decks;
  } catch {
    throw new Error("Invalid choices in direction code.");
  }
}
