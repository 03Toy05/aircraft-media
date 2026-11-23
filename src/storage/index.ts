import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { DriveClient, DriveFileStore, driveClientFromEnv } from "./drive";

export type StorageKind = "local" | "drive";

/** Where new bytes are filed. Drive uses these as sub-folders of the Aircraft Media root; local ignores them. */
export type StorageArea = "Sources" | "Processing" | "Approved" | "Retired";

/**
 * File byte storage. The database stays authoritative; storage only holds bytes.
 * A reference is not proof the bytes still exist: get() throws when they cannot be retrieved.
 */
export interface FileStore {
  kind: StorageKind;
  put(bytes: Uint8Array, name: string, area?: StorageArea, mimeType?: string): Promise<string>; // returns storage_ref
  get(ref: string, kind?: StorageKind): Promise<Uint8Array>;
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

/**
 * Writes go to the primary store; reads are routed by the kind recorded on each content version,
 * so Drive-referenced originals and locally stored derivatives can coexist.
 */
export class StorageRouter implements FileStore {
  constructor(
    private primary: FileStore,
    private others: FileStore[] = [],
  ) {}
  get kind() {
    return this.primary.kind;
  }
  put(bytes: Uint8Array, name: string, area?: StorageArea, mimeType?: string) {
    return this.primary.put(bytes, name, area, mimeType);
  }
  get(ref: string, kind?: StorageKind) {
    const store = [this.primary, ...this.others].find((s) => s.kind === (kind ?? this.primary.kind));
    if (!store) throw new Error(`No storage configured for kind "${kind}"`);
    return store.get(ref, kind);
  }
}

/**
 * A store that keeps the bytes it was just given, so reading them back (e.g. to build a combined photo from the
 * photos uploaded a moment ago) costs no round trip to Drive. Meant for one short job; forget() frees the memory.
 */
export class RememberingStore implements FileStore {
  private kept = new Map<string, Uint8Array>();
  constructor(private inner: FileStore) {}
  get kind() {
    return this.inner.kind;
  }
  async put(bytes: Uint8Array, name: string, area?: StorageArea, mimeType?: string) {
    const ref = await this.inner.put(bytes, name, area, mimeType);
    this.kept.set(`${this.inner.kind}:${ref}`, bytes);
    return ref;
  }
  get(ref: string, kind?: StorageKind) {
    const b = this.kept.get(`${kind ?? this.inner.kind}:${ref}`);
    return b ? Promise.resolve(b) : this.inner.get(ref, kind);
  }
  forget() {
    this.kept.clear();
  }
}

let store: FileStore | undefined;
let driveClient: DriveClient | null | undefined;

/** The configured Drive client, or null when Drive credentials are not set. */
export function getDriveClient(): DriveClient | null {
  if (driveClient === undefined) driveClient = driveClientFromEnv();
  return driveClient;
}

/**
 * STORAGE_KIND=drive writes new bytes to the Aircraft Media Drive folder (local files already stored stay readable).
 * Anything else uses local disk. Fails loudly if Drive is requested without credentials.
 */
export function getFileStore(): FileStore {
  if (!store) {
    const local = new LocalFileStore(path.resolve(process.cwd(), /*turbopackIgnore: true*/ process.env.LOCAL_STORAGE_DIR ?? ".data/files"));
    if (process.env.STORAGE_KIND === "drive") {
      const client = getDriveClient();
      if (!client) throw new Error("STORAGE_KIND=drive but Google Drive credentials are missing (see docs/CONFIGURATION.md).");
      store = new StorageRouter(new DriveFileStore(client), [local]);
    } else {
      // Drive-referenced originals (imported in place) are still readable when a Drive client exists.
      const client = getDriveClient();
      store = client ? new StorageRouter(local, [new DriveFileStore(client)]) : local;
    }
  }
  return store;
}

export function setFileStore(s: FileStore) {
  store = s;
}
