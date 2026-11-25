import { and, asc, eq, isNull, like } from "drizzle-orm";
import { contacts } from "../db/schema";
import type { Db } from "../db/client";
import { runAction, type Actor, type Tx } from "./action";
import { normalizeKey } from "./constants";
import { conflict, invalid, notFound } from "./errors";
import { contactApp } from "./messengers";

export { CONTACT_APPS, contactApp, contactLink, type ContactApp } from "./messengers";

type Q = Db | Tx;

export interface ContactInput { name: string; englishName?: string | null; app: string; handle?: string | null; notes?: string | null }

function check(input: ContactInput) {
  const name = input.name.trim();
  if (!name) throw invalid("Contact name is required");
  if (!contactApp(input.app)) throw invalid('Unknown messenger "{app}"', undefined, { app: String(input.app) });
  return { name, englishName: input.englishName?.trim() || null, handle: input.handle?.trim() || null, notes: input.notes?.trim() || null };
}

// ---------------------------------------------------------------- Person reference (CBOS Rulebook B1.2)

const TITLES = /^(mr|mrs|ms|miss|dr|sir|madam|capt|captain)\.?$/i;

/**
 * Initials for PER-{initials}-{number}, from the English name: the first letter of each word, titles ("Mr") left out.
 * Null when there is no English (Latin-letter) name to take them from; the Rulebook says to resolve that, not guess.
 */
export function personInitials(englishName: string): string | null {
  const words = englishName
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // accents off: "José" -> "Jose"
    .split(/[\s\-_/.,]+/)
    .filter((w) => w && !TITLES.test(w));
  const letters = words.map((w) => w.match(/[A-Za-z]/)?.[0] ?? "").join("").toUpperCase();
  return letters || null;
}

export function formatPersonReference(initials: string, n: number) {
  return `PER-${initials}-${String(n).padStart(3, "0")}`;
}

/** Next free PER reference for these initials in the workspace. Numbers are never reused (contacts are only retired). */
async function allocatePersonReference(tx: Q, tenantId: string, initials: string): Promise<string> {
  const rows = await tx.select({ r: contacts.reference }).from(contacts).where(and(eq(contacts.tenantId, tenantId), like(contacts.reference, `PER-${initials}-%`)));
  const max = rows.reduce((m, x) => Math.max(m, Number(x.r?.slice(`PER-${initials}-`.length)) || 0), 0);
  return formatPersonReference(initials, max + 1);
}

function initialsFor(v: { name: string; englishName: string | null }) {
  return personInitials(v.englishName ?? v.name);
}

export function createContact(db: Db, actor: Actor, key: string, input: ContactInput) {
  return runAction({
    db, actor, name: "contact.create", idempotencyKey: key, input,
    handler: async (tx) => {
      const v = check(input);
      const norm = normalizeKey(v.name);
      const dup = await tx.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.tenantId, actor.tenantId), eq(contacts.normalizedName, norm), eq(contacts.active, true)));
      if (dup.length) throw conflict("DUPLICATE_CONTACT", 'You already have a contact called "{name}"', { id: dup[0].id }, { name: v.name });
      const initials = initialsFor(v);
      if (!initials) throw invalid("Add the contact's English name: the Person ID (PER-…) takes its initials from it.");
      const reference = await allocatePersonReference(tx, actor.tenantId, initials);
      const [row] = await tx
        .insert(contacts)
        .values({ tenantId: actor.tenantId, reference, name: v.name, englishName: v.englishName, normalizedName: norm, app: input.app, handle: v.handle, notes: v.notes })
        .returning({ id: contacts.id });
      return { contactId: row.id, reference };
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
      // The reference never changes once allocated (renaming does not regenerate it). A contact still without one gets
      // it now, if an English name is available.
      let reference = c.reference;
      if (!reference) {
        const initials = initialsFor(v);
        if (initials) reference = await allocatePersonReference(tx, actor.tenantId, initials);
      }
      await tx
        .update(contacts)
        .set({ name: v.name, englishName: c.reference ? c.englishName : v.englishName, reference, normalizedName: normalizeKey(v.name), app: input.app, handle: v.handle, notes: v.notes, updatedAt: new Date() })
        .where(eq(contacts.id, c.id));
      return { contactId: c.id, reference };
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

/**
 * Gives contacts saved before Person references existed their PER reference, oldest first, so numbers follow the
 * order they were added. Contacts with no English name are left for the owner to complete. Returns how many were given one.
 */
export async function assignMissingPersonReferences(db: Db, tenantId: string): Promise<number> {
  return db.transaction(async (tx) => {
    const rows = await tx.select().from(contacts).where(and(eq(contacts.tenantId, tenantId), isNull(contacts.reference))).orderBy(asc(contacts.createdAt));
    let n = 0;
    for (const c of rows) {
      const initials = initialsFor({ name: c.name, englishName: c.englishName });
      if (!initials) continue;
      await tx.update(contacts).set({ reference: await allocatePersonReference(tx, tenantId, initials) }).where(eq(contacts.id, c.id));
      n++;
    }
    return n;
  });
}
