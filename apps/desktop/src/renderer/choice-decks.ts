export interface Deck {
  label: string;
  options: readonly string[];
}
export interface PinnedDeck extends Deck {
  pin: number | null;
}
export interface DrawnDeck extends PinnedDeck {
  value: string;
}

export function parseDecks(text: string): Deck[] {
  if (text.length > 3200) throw new Error("Keep your choices under 3,200 characters.");
  const labels = new Set<string>();
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
export function deckText(decks: readonly Deck[]) {
  const pretty = decks.map((d) => d.label + " = " + d.options.join(" | ")).join("\n");
  return pretty.length <= 3200
    ? pretty
    : decks.map((d) => d.label + "=" + d.options.join("|")).join("\n");
}
function choose(seed: number, label: string, count: number) {
  let h = 2166136261;
  for (const c of label) h = Math.imul(h ^ (c.codePointAt(0) ?? 0), 16777619);
  h ^= seed;
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad);
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97);
  h = (h ^ (h >>> 15)) >>> 0;
  return Math.floor((h / 4294967296) * count);
}
export function drawDecks(
  definitions: readonly Deck[],
  seed: number,
  previous: readonly PinnedDeck[] = [],
): DrawnDeck[] {
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
      value: options[choose(pin ?? seed, label, options.length)] ?? "",
    };
  });
}
export function encodeDecks(decks: readonly PinnedDeck[]) {
  const data = JSON.stringify(decks.map(({ label, options, pin }) => [label, options, pin]));
  return btoa(String.fromCharCode(...new TextEncoder().encode(data)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

export function decodeDecks(token: string): PinnedDeck[] {
  const invalid = () => new Error("Invalid choices in direction code.");
  if (!/^[\w-]{1,20000}$/.test(token)) throw invalid();
  try {
    const rows: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        Uint8Array.from(atob(token.replaceAll("-", "+").replaceAll("_", "/")), (c) =>
          c.charCodeAt(0),
        ),
      ),
    );
    if (!Array.isArray(rows) || rows.length > 8) throw invalid();
    const decks = rows.map((row: unknown) => {
      if (!Array.isArray(row) || row.length !== 3) throw invalid();
      const fields: readonly unknown[] = row;
      const [label, options, pin] = fields;
      if (
        typeof label !== "string" ||
        !Array.isArray(options) ||
        !options.every((s: unknown): s is string => typeof s === "string") ||
        !(
          pin === null ||
          (typeof pin === "number" && Number.isInteger(pin) && pin >= 0 && pin <= 0xffffffff)
        )
      )
        throw invalid();
      return { label, options, pin };
    });
    const parsed = parseDecks(deckText(decks));
    if (
      JSON.stringify(parsed) !==
      JSON.stringify(decks.map(({ label, options }) => ({ label, options })))
    )
      throw invalid();
    return decks;
  } catch {
    throw invalid();
  }
}
