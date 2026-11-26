// The GLB library: the project's exports and files the person opened.
//
// The renderer only ever sees entry IDs. Main maps an ID to a path it chose
// itself: a file in the project's `exports` directory, or a file the person
// picked in an open dialog during this or an earlier session.

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { LibraryEntry, LibraryFile } from "../shared/api.js";

const glbMagic = 0x46546c67;
export const maxGlbBytes = 256 * 1024 * 1024;

export function isGlb(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= 20 &&
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true) === glbMagic
  );
}

/** A file-name-safe form of a label. */
export function safeName(label: string): string {
  const name = label
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 80);
  return name || "model";
}

function readList(file: string): string[] {
  try {
    const value: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export class Library {
  private readonly listFile: string;
  private opened: string[];
  private exportsDir: string | undefined;

  constructor(stateDir: string) {
    this.listFile = path.join(stateDir, "opened-glbs.json");
    this.opened = readList(this.listFile);
  }

  /** Exports go into `<project>/exports`. Without a project there are no exports. */
  setProject(directory: string | undefined): void {
    this.exportsDir = directory === undefined ? undefined : path.join(directory, "exports");
  }

  private openedId(file: string): string {
    return "opened:" + createHash("sha256").update(path.resolve(file)).digest("hex").slice(0, 24);
  }

  private entry(
    file: string,
    id: string,
    origin: LibraryEntry["origin"],
  ): LibraryEntry | undefined {
    try {
      const stat = fs.statSync(file);
      if (!stat.isFile()) return undefined;
      return {
        id,
        name: path.basename(file),
        origin,
        byteLength: stat.size,
        modifiedAt: stat.mtimeMs,
      };
    } catch {
      return undefined;
    }
  }

  private resolve(id: string): { file: string; origin: LibraryEntry["origin"] } | undefined {
    if (id.startsWith("export:") && this.exportsDir) {
      const name = id.slice("export:".length);
      if (name !== path.basename(name) || !name.toLowerCase().endsWith(".glb")) return undefined;
      return { file: path.join(this.exportsDir, name), origin: "export" };
    }
    const file = this.opened.find((f) => this.openedId(f) === id);
    return file === undefined ? undefined : { file, origin: "opened" };
  }

  list(): LibraryEntry[] {
    const entries: LibraryEntry[] = [];
    if (this.exportsDir) {
      let names: string[] = [];
      try {
        names = fs.readdirSync(this.exportsDir).filter((n) => n.toLowerCase().endsWith(".glb"));
      } catch {
        // No exports yet.
      }
      for (const name of names) {
        const entry = this.entry(path.join(this.exportsDir, name), "export:" + name, "export");
        if (entry) entries.push(entry);
      }
    }
    for (const file of this.opened) {
      const entry = this.entry(file, this.openedId(file), "opened");
      if (entry) entries.push(entry);
    }
    return entries.sort((a, b) => b.modifiedAt - a.modifiedAt);
  }

  read(id: string): LibraryFile | null {
    const found = this.resolve(id);
    if (!found) return null;
    const entry = this.entry(found.file, id, found.origin);
    if (!entry || entry.byteLength > maxGlbBytes) return null;
    return { entry, bytes: new Uint8Array(fs.readFileSync(found.file)) };
  }

  /** Remember a file the person picked and read it. */
  open(file: string): LibraryFile | null {
    const resolved = path.resolve(file);
    this.opened = [resolved, ...this.opened.filter((f) => f !== resolved)].slice(0, 50);
    fs.mkdirSync(path.dirname(this.listFile), { recursive: true });
    fs.writeFileSync(this.listFile, JSON.stringify(this.opened, null, 2) + "\n");
    return this.read(this.openedId(resolved));
  }

  /** Write an export into the project's exports directory, never replacing a file. */
  saveExport(name: string, bytes: Uint8Array): LibraryEntry {
    const dir = this.exportsDir;
    if (!dir) throw new Error("Open a project before exporting.");
    fs.mkdirSync(dir, { recursive: true });
    let file = path.join(dir, name + ".glb");
    for (let n = 2; fs.existsSync(file); n++) file = path.join(dir, `${name}-${n}.glb`);
    fs.writeFileSync(file, bytes, { flag: "wx" });
    const entry = this.entry(file, "export:" + path.basename(file), "export");
    if (!entry) throw new Error("The export could not be read back.");
    return entry;
  }
}
