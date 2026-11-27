import { and, eq, inArray, ne, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import * as s from "../db/schema";
import { DomainError } from "./errors";
import { normalizeEmail, type AccountRow } from "./accounts";

/**
 * A person closing their own account.
 *
 * Cancel: the account becomes read-only (as when a trial ends): they can still sign in, look, share and download, and
 * reopen it themselves. No more trial emails or announcements. The admin can also turn it back on.
 *
 * Delete: their workspace and everything in it is removed from the database at once (or nothing is, if anything
 * goes wrong). If someone else shares the workspace, only the person leaving is removed and the workspace stays.
 * Photos already accepted into the platform library stay there (the library has its own copy). The photo files kept
 * in storage are not touched here: originals are never deleted by the app.
 */

async function me(db: Db, userId: string): Promise<AccountRow> {
  const [u] = await db.select().from(s.users).where(eq(s.users.id, userId));
  if (!u) throw new DomainError("NOT_FOUND", "That user was not found.");
  return u;
}

export async function cancelAccount(db: Db, userId: string, now = new Date()): Promise<AccountRow> {
  const u = await me(db, userId);
  if (u.status === "cancelled") return u;
  if (u.status !== "active") throw new DomainError("NOT_ACTIVE", "This account can't be cancelled from here. Contact us instead.");
  const [row] = await db.update(s.users).set({ status: "cancelled", updatedAt: now }).where(eq(s.users.id, u.id)).returning();
  return row;
}

export async function reopenAccount(db: Db, userId: string, now = new Date()): Promise<AccountRow> {
  const u = await me(db, userId);
  if (u.status !== "cancelled") return u;
  const [row] = await db.update(s.users).set({ status: "active", updatedAt: now }).where(eq(s.users.id, u.id)).returning();
  return row;
}

/** What was removed, for the admin's email. */
export interface Deleted { email: string; displayName: string; workspace: boolean; aircraft: number; photos: number; quotes: number }

export async function deleteAccount(db: Db, userId: string, typedEmail: string): Promise<Deleted> {
  const u = await me(db, userId);
  if (normalizeEmail(typedEmail) !== u.email.toLowerCase()) throw new DomainError("CONFIRM_EMAIL", "Type your email address exactly to confirm.");
  const others = await db.select({ id: s.users.id }).from(s.users).where(and(eq(s.users.tenantId, u.tenantId), ne(s.users.id, u.id)));
  const T = u.tenantId;

  return db.transaction(async (tx) => {
    // Their own things, wherever the workspace goes.
    await tx.delete(s.whatsappDeliveries).where(eq(s.whatsappDeliveries.userId, u.id));
    await tx.delete(s.verifiedWhatsappNumbers).where(eq(s.verifiedWhatsappNumbers.userId, u.id));
    await tx.delete(s.toyConversations).where(eq(s.toyConversations.userId, u.id));
    await tx.delete(s.toyChoices).where(eq(s.toyChoices.userId, u.id));
    await tx.delete(s.signInLinks).where(eq(s.signInLinks.email, u.email.toLowerCase()));

    if (others.length) {
      // Someone else keeps the workspace: only this person leaves.
      await tx.delete(s.users).where(eq(s.users.id, u.id));
      return { email: u.email, displayName: u.displayName, workspace: false, aircraft: 0, photos: 0, quotes: 0 };
    }

    const media = tx.select({ id: s.aircraftMedia.id }).from(s.aircraftMedia).where(eq(s.aircraftMedia.tenantId, T));
    const planes = tx.select({ id: s.aircraft.id }).from(s.aircraft).where(eq(s.aircraft.tenantId, T));
    const orgs = tx.select({ id: s.organisations.id }).from(s.organisations).where(eq(s.organisations.tenantId, T));
    const types = tx.select({ id: s.aircraftTypes.id }).from(s.aircraftTypes).where(eq(s.aircraftTypes.tenantId, T));
    const reqs = tx.select({ id: s.requests.id }).from(s.requests).where(eq(s.requests.tenantId, T));

    const [{ n: aircraftN }] = await tx.select({ n: sql<number>`count(*)` }).from(s.aircraft).where(eq(s.aircraft.tenantId, T));
    const [{ n: photosN }] = await tx.select({ n: sql<number>`count(*)` }).from(s.aircraftMedia).where(and(eq(s.aircraftMedia.tenantId, T), eq(s.aircraftMedia.lifecycleState, "active")));
    const [{ n: quotesN }] = await tx.select({ n: sql<number>`count(*)` }).from(s.quoteVersions).where(eq(s.quoteVersions.tenantId, T));

    // Children first, so no row is left pointing at one that is gone.
    await tx.delete(s.whatsappDeliveries).where(eq(s.whatsappDeliveries.tenantId, T));
    await tx.delete(s.verifiedWhatsappNumbers).where(eq(s.verifiedWhatsappNumbers.tenantId, T));
    await tx.delete(s.processingProposals).where(eq(s.processingProposals.tenantId, T));
    await tx.delete(s.cbosExports).where(eq(s.cbosExports.tenantId, T));
    await tx.delete(s.mediaAssociations).where(inArray(s.mediaAssociations.aircraftMediaId, media));
    await tx.delete(s.mediaAssociations).where(inArray(s.mediaAssociations.aircraftId, planes));
    await tx.delete(s.mediaContentVersions).where(inArray(s.mediaContentVersions.aircraftMediaId, media));
    // Offers to the library not yet accepted go; accepted ones are the library's own copy now.
    await tx.delete(s.libraryContributions).where(and(eq(s.libraryContributions.sourceTenantId, T), ne(s.libraryContributions.status, "accepted")));
    await tx.delete(s.aircraftMedia).where(eq(s.aircraftMedia.tenantId, T));
    await tx.delete(s.organisationAircraftRelationships).where(inArray(s.organisationAircraftRelationships.aircraftId, planes));
    await tx.delete(s.organisationAircraftRelationships).where(inArray(s.organisationAircraftRelationships.organisationId, orgs));
    await tx.delete(s.aircraftBases).where(inArray(s.aircraftBases.aircraftId, planes));
    await tx.delete(s.aircraftInformationVersions).where(inArray(s.aircraftInformationVersions.aircraftId, planes));
    await tx.delete(s.aircraftRegistrations).where(inArray(s.aircraftRegistrations.aircraftId, planes));
    await tx.delete(s.libraryCopies).where(eq(s.libraryCopies.tenantId, T));
    await tx.delete(s.aircraft).where(eq(s.aircraft.tenantId, T));
    await tx.delete(s.aircraftTypeAliases).where(inArray(s.aircraftTypeAliases.aircraftTypeId, types));
    await tx.delete(s.aircraftTypes).where(eq(s.aircraftTypes.tenantId, T));
    await tx.delete(s.organisationRoles).where(inArray(s.organisationRoles.organisationId, orgs));
    await tx.delete(s.organisationAliases).where(inArray(s.organisationAliases.organisationId, orgs));
    await tx.delete(s.contacts).where(eq(s.contacts.tenantId, T));
    await tx.delete(s.organisations).where(eq(s.organisations.tenantId, T));
    await tx.delete(s.quoteLinks).where(inArray(s.quoteLinks.requestId, reqs));
    await tx.delete(s.quoteVersions).where(inArray(s.quoteVersions.requestId, reqs));
    await tx.delete(s.requests).where(eq(s.requests.tenantId, T));
    for (const t of [s.quoteLinks, s.quoteVersions, s.quoteShares, s.timings, s.actionExecutions, s.driveSyncState, s.quoteTemplates, s.brands, s.wordTemplates, s.toyConversations, s.sourceEvidence] as const) {
      await tx.delete(t).where(eq(t.tenantId, T));
    }
    await tx.delete(s.users).where(eq(s.users.tenantId, T));
    return { email: u.email, displayName: u.displayName, workspace: true, aircraft: Number(aircraftN), photos: Number(photosN), quotes: Number(quotesN) };
  });
}

