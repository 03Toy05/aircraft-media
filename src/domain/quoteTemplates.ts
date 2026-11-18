import { and, eq } from "drizzle-orm";
import { quoteTemplates } from "../db/schema";
import type { Db } from "../db/client";
import { runAction, type Actor, type Tx } from "./action";
import { invalid } from "./errors";
import { QUOTE_LANGUAGES, defaultQuoteTemplate, validateQuoteTemplate, type QuoteLanguage, type QuoteTemplate } from "./quote";

type Q = Db | Tx;

const FIELDS: (keyof QuoteTemplate)[] = ["greeting", "block", "closing", "yes", "no", "tbc", "seats"];

/** The owner's saved wording per language (only the parts that differ from the default). */
export async function getQuoteTemplates(db: Q, tenantId: string): Promise<Partial<Record<QuoteLanguage, Partial<QuoteTemplate>>>> {
  const rows = await db.select().from(quoteTemplates).where(eq(quoteTemplates.tenantId, tenantId));
  const out: Partial<Record<QuoteLanguage, Partial<QuoteTemplate>>> = {};
  for (const r of rows) {
    try { out[r.language as QuoteLanguage] = JSON.parse(r.template) as Partial<QuoteTemplate>; } catch { /* ignore a damaged row; the default is used */ }
  }
  return out;
}

export function saveQuoteTemplate(db: Db, actor: Actor, key: string, input: { language: string; template: Partial<QuoteTemplate> }) {
  return runAction({
    db, actor, name: "quoteTemplate.save", idempotencyKey: key, input,
    handler: async (tx) => {
      if (!(QUOTE_LANGUAGES as readonly string[]).includes(input.language)) throw invalid(`Unknown language "${input.language}"`);
      const language = input.language as QuoteLanguage;
      const base = defaultQuoteTemplate(language);
      // Normalise line endings; keep only what differs from the default so future default improvements still reach unchanged parts.
      const clean: Partial<QuoteTemplate> = {};
      for (const f of FIELDS) {
        const v = (input.template[f] ?? "").replace(/\r\n/g, "\n");
        if (f !== "greeting" && f !== "closing" && f !== "seats" && v.trim() === "") continue;
        if (v !== base[f]) clean[f] = v;
      }
      const problem = validateQuoteTemplate({ ...base, ...clean });
      if (problem) throw invalid(problem);
      if (Object.keys(clean).length === 0) {
        await tx.delete(quoteTemplates).where(and(eq(quoteTemplates.tenantId, actor.tenantId), eq(quoteTemplates.language, language)));
        return { language, custom: false };
      }
      await tx
        .insert(quoteTemplates)
        .values({ tenantId: actor.tenantId, language, template: JSON.stringify(clean) })
        .onConflictDoUpdate({ target: [quoteTemplates.tenantId, quoteTemplates.language], set: { template: JSON.stringify(clean), updatedAt: new Date() } });
      return { language, custom: true };
    },
  });
}

export function resetQuoteTemplate(db: Db, actor: Actor, key: string, input: { language: string }) {
  return runAction({
    db, actor, name: "quoteTemplate.reset", idempotencyKey: key, input,
    handler: async (tx) => {
      await tx.delete(quoteTemplates).where(and(eq(quoteTemplates.tenantId, actor.tenantId), eq(quoteTemplates.language, input.language)));
      return { language: input.language };
    },
  });
}
