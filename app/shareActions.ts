"use server";

import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { aircraft, contacts } from "@/db/schema";
import { requireOwner } from "@/lib/session";
import { getAircraftCard } from "@/domain/directory";
import { formatAircraftCard } from "@/domain/card";
import { getLineup } from "@/domain/media";
import { CLASSIFICATION_LABEL } from "@/domain/constants";
import type { ShareContact, ShareItem } from "./_components/ShareBox";

export interface SharePayload {
  aircraftId: string;
  tail: string;
  cardText: string;
  items: ShareItem[];
  contact: ShareContact;
}

/** Everything the Send panel needs for one aircraft and one saved contact. Read-only. */
export async function prepareShareAction(aircraftId: string, contactId: string): Promise<SharePayload | null> {
  const { actor } = await requireOwner();
  const db = await getDb();
  const [ac] = await db.select().from(aircraft).where(and(eq(aircraft.id, aircraftId), eq(aircraft.tenantId, actor.tenantId)));
  const [c] = await db.select().from(contacts).where(and(eq(contacts.id, contactId), eq(contacts.tenantId, actor.tenantId)));
  if (!ac || !c) return null;
  const card = await getAircraftCard(db, aircraftId);
  if (!card) return null;
  const lineup = await getLineup(db, { aircraftId, aircraftTypeId: ac.aircraftTypeId });
  return {
    aircraftId,
    tail: card.tailNumber ?? "aircraft",
    cardText: formatAircraftCard(card),
    items: lineup.map((l) => ({
      classification: l.classification,
      classificationLabel: CLASSIFICATION_LABEL[l.classification],
      label: l.label,
      url: `/api/media/${l.contentVersionId}`,
      mimeType: l.mimeType,
      representative: l.associationStatus === "representative_type",
    })),
    contact: { name: c.name, app: c.app, handle: c.handle },
  };
}
