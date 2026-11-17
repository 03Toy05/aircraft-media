import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

/**
 * File byte storage. The database stays authoritative; storage only holds bytes.
 * Phase 1 ships LocalFileStore (dev/tests). A DriveFileStore implements the same interface in phase 2.
 */
export interface FileStore {
  kind: "local" | "drive";
  put(bytes: Uint8Array, suggestedName: string): Promise<string>; // returns storage_ref
  get(ref: string): Promise<Uint8Array>; // throws when bytes are not retrievable
}

export class LocalFileStore implements FileStore {
  kind = "local" as const;
  constructor(private dir: string) {}

  async put(bytes: Uint8Array): Promise<string> {
    await fs.mkdir(this.dir, { recursive: true });
    const ref = randomUUID();
    await fs.writeFile(path.join(this.dir, ref), bytes);
    return ref;
  }

  async get(ref: string): Promise<Uint8Array> {
    if (!/^[0-9a-f-]{36}$/.test(ref)) throw new Error("invalid storage reference");
    return new Uint8Array(await fs.readFile(path.join(this.dir, ref)));
  }
}

let store: FileStore | undefined;
export function getFileStore(): FileStore {
  if (!store) {
    // The Drive store arrives in phase 2; until then everything is local.
    store = new LocalFileStore(path.resolve(process.cwd(), process.env.LOCAL_STORAGE_DIR ?? ".data/files"));
  }
  return store;
}
