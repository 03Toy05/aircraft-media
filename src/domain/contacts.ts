import { and, asc, eq } from "drizzle-orm";
import { contacts } from "../db/schema";
import type { Db } from "../db/client";
import { runAction, type Actor, type Tx } from "./action";
import { normalizeKey } from "./constants";
import { conflict, invalid, notFound } from "./errors";
import { contactApp } from "./messengers";

export { CONTACT_APPS, contactApp, contactLink, type ContactApp } from "./messengers";

type Q = Db | Tx;

export interface ContactInput { name: string; app: string; handle?: string | null; notes?: string | null }

function check(input: ContactInput) {
  const name = input.name.trim();
  if (!name) throw invalid("Contact name is required");
  if (!contactApp(input.app)) throw invalid(`Unknown messenger "${input.app}"`);
  return { name, handle: input.handle?.trim() || null, notes: input.notes?.trim() || null };
}

export function createContact(db: Db, actor: Actor, key: string, input: ContactInput) {
  return runAction({
    db, actor, name: "contact.create", idempotencyKey: key, input,
    handler: async (tx) => {
      const v = check(input);
      const norm = normalizeKey(v.name);
      const dup = await tx.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.tenantId, actor.tenantId), eq(contacts.normalizedName, norm), eq(contacts.active, true)));
      if (dup.length) throw conflict("DUPLICATE_CONTACT", `You already have a contact called "${v.name}"`, { id: dup[0].id });
      const [row] = await tx.insert(contacts).values({ tenantId: actor.tenantId, name: v.name, normalizedName: norm, app: input.app, handle: v.handle, notes: v.notes }).returning({ id: contacts.id });
      return { contactId: row.id };
    },
  });
}

export function updateContact(db: Db, actor: Actor, key: string, input: ContactInput & { contactId: string }) {
  return runAction({
    db, actor, name: "contact.update", idempotencyKey: key, input,
    handler: async (tx) => {
      const v = check(input);
      const [c] = await tx.select().from(contacts).where(and(eq(contacts.id, input.contactId), eq(contacts.tenantId, actor.tenantId)));
      if (!c) throw notFound("Contact");
      await tx.update(contacts).set({ name: v.name, normalizedName: normalizeKey(v.name), app: input.app, handle: v.handle, notes: v.notes, updatedAt: new Date() }).where(eq(contacts.id, c.id));
      return { contactId: c.id };
    },
  });
}

export function retireContact(db: Db, actor: Actor, key: string, input: { contactId: string }) {
  return runAction({
    db, actor, name: "contact.retire", idempotencyKey: key, input,
    handler: async (tx) => {
      const [c] = await tx.select().from(contacts).where(and(eq(contacts.id, input.contactId), eq(contacts.tenantId, actor.tenantId)));
      if (!c) throw notFound("Contact");
      await tx.update(contacts).set({ active: false, updatedAt: new Date() }).where(eq(contacts.id, c.id));
      return { contactId: c.id };
    },
  });
}

export async function listContacts(db: Q, tenantId: string) {
  return db.select().from(contacts).where(and(eq(contacts.tenantId, tenantId), eq(contacts.active, true))).orderBy(asc(contacts.name));
}

const TITLE = /^(mr|mrs|ms|dr)\.?\s+/i;

/** "Mr Chan", "chan", "Chan Tai Man": exact first, then partial matches (several are returned for the owner to choose). */
export async function findContacts(db: Q, tenantId: string, text: string) {
  const all = await listContacts(db, tenantId);
  const n = normalizeKey(text.replace(TITLE, ""));
  if (!n) return [];
  const exact = all.filter((c) => normalizeKey(c.name) === normalizeKey(text) || normalizeKey(c.name.replace(TITLE, "")) === n);
  if (exact.length) return exact;
  return all.filter((c) => normalizeKey(c.name).includes(n));
}
