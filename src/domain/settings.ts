import { and, eq } from "drizzle-orm";
import { users, verifiedWhatsappNumbers } from "../db/schema";
import type { Db } from "../db/client";
import { runAction, type Actor } from "./action";
import { conflict, invalid, notFound } from "./errors";
import { normalizePhone } from "../lib/owner";

/** The owner records their own WhatsApp number as verified (manual verification, no OTP message). */
export function addVerifiedNumber(db: Db, actor: Actor, key: string, input: { phone: string }) {
  return runAction({
    db,
    actor,
    name: "whatsapp.addVerifiedNumber",
    idempotencyKey: key,
    input,
    handler: async (tx) => {
      const phone = normalizePhone(input.phone);
      if (!phone) throw invalid("Enter the number with country code, e.g. 85291234567");
      const [dupe] = await tx
        .select()
        .from(verifiedWhatsappNumbers)
        .where(and(eq(verifiedWhatsappNumbers.tenantId, actor.tenantId), eq(verifiedWhatsappNumbers.phone, phone), eq(verifiedWhatsappNumbers.active, true)));
      if (dupe) throw conflict("NUMBER_IN_USE", "This number is already active");
      const [row] = await tx
        .insert(verifiedWhatsappNumbers)
        .values({ tenantId: actor.tenantId, userId: actor.id, phone, verificationStatus: "verified", verifiedAt: new Date() })
        .returning({ id: verifiedWhatsappNumbers.id });
      return { numberId: row.id };
    },
  });
}

export function deactivateNumber(db: Db, actor: Actor, key: string, input: { numberId: string }) {
  return runAction({
    db,
    actor,
    name: "whatsapp.deactivateNumber",
    idempotencyKey: key,
    input,
    handler: async (tx) => {
      const [n] = await tx.select().from(verifiedWhatsappNumbers).where(and(eq(verifiedWhatsappNumbers.id, input.numberId), eq(verifiedWhatsappNumbers.tenantId, actor.tenantId)));
      if (!n) throw notFound("Number");
      await tx.update(verifiedWhatsappNumbers).set({ active: false, updatedAt: new Date() }).where(eq(verifiedWhatsappNumbers.id, n.id));
      return { numberId: n.id };
    },
  });
}

export const LANGUAGES = ["en", "zh-Hant", "zh-Hans", "fr", "ar", "de", "ru"] as const;

export function setPreferredLanguage(db: Db, actor: Actor, key: string, input: { language: string }) {
  return runAction({
    db,
    actor,
    name: "user.setLanguage",
    idempotencyKey: key,
    input,
    handler: async (tx) => {
      if (!(LANGUAGES as readonly string[]).includes(input.language)) throw invalid("Unsupported language");
      await tx.update(users).set({ preferredLanguage: input.language, updatedAt: new Date() }).where(eq(users.id, actor.id));
      return { language: input.language };
    },
  });
}
