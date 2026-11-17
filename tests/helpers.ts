import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { createMemoryDb, type Db } from "../src/db/client";
import { users } from "../src/db/schema";
import { FIXED_TENANT_ID } from "../src/domain/constants";
import type { Actor } from "../src/domain/action";
import { LocalFileStore } from "../src/storage";

export async function setup() {
  const db: Db = await createMemoryDb();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aircraft-media-test-"));
  const store = new LocalFileStore(dir);
  const [u] = await db
    .insert(users)
    .values({ tenantId: FIXED_TENANT_ID, email: "owner@example.test", displayName: "Test Owner" })
    .returning({ id: users.id });
  const actor: Actor = { id: u.id, tenantId: FIXED_TENANT_ID };
  return { db, store, actor, dir };
}

/** A solid-colour test image with a distinct marker so each has unique bytes. */
export async function makeImage(width = 400, height = 300, seed = 0): Promise<Uint8Array> {
  const buf = await sharp({
    create: { width, height, channels: 3, background: { r: (seed * 37) % 256, g: (seed * 91) % 256, b: (seed * 53) % 256 } },
  })
    .png()
    .toBuffer();
  return new Uint8Array(buf);
}

export const key = () => randomUUID();
