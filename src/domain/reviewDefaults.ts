import type { Db } from "../db/client";
import { parseAircraftCard, type ParsedCard } from "./card";
import { matchCard } from "./chat";
import type { CatalogueRow } from "./catalogue";

export interface AssignDefaults {
  parsed: ParsedCard | undefined;
  /** "", "new" or an organisation id */
  operator: string;
  /** Name to create when operator is "new" */
  newOperatorName: string;
  /** "new", "none" or an aircraft id */
  aircraft: string;
  type: string;
  /** Things worth telling the broker about the card text (assumptions, problems, words not recognised). */
  notes: { text: string; warn: boolean }[];
}

/**
 * What the Assign form starts with, read from the card text sent with the photos. Deterministic, re-read each time,
 * so newly added operators and better parsing apply to photos already waiting. Nothing is saved from here.
 */
export async function assignDefaults(
  db: Db,
  tenantId: string,
  input: { cardText: string | null; parsed?: ParsedCard; catalogue: CatalogueRow[]; associatedAircraftId: string | null },
): Promise<AssignDefaults> {
  const parsed = input.parsed ?? (input.cardText ? parseAircraftCard(input.cardText) : undefined);
  const m = parsed
    ? await matchCard(db, tenantId, parsed)
    : { tailMatches: [] as string[], opMatches: [] as { id: string }[], typeMatches: [] as { id: string }[], operatorText: "", leftover: [] as string[] };
  const operator = m.opMatches.length === 1 ? m.opMatches[0].id : m.opMatches.length === 0 && m.operatorText ? "new" : "";
  const type = m.typeMatches.length === 1 ? m.typeMatches[0].id : "";
  // The one tail match, else the operator's only aircraft of that type (so a second set of photos joins it), else a new one.
  const sameTypeAndOperator =
    m.opMatches.length === 1 && m.typeMatches.length === 1
      ? input.catalogue.filter((r) => r.operatorId === m.opMatches[0].id && r.aircraftTypeId === m.typeMatches[0].id)
      : [];
  const aircraft =
    m.tailMatches.length === 1 ? m.tailMatches[0]
    : sameTypeAndOperator.length === 1 ? sameTypeAndOperator[0].aircraftId
    : input.associatedAircraftId ?? (parsed ? "new" : "none");
  const notes = [
    ...(parsed?.assumed ?? []).map((a) => ({ text: `Assumed: ${a}`, warn: false })),
    ...(parsed?.problems ?? []).map((p) => ({ text: p, warn: true })),
    ...m.leftover.map((u) => ({ text: `Not recognised: ${u}`, warn: true })),
  ];
  return { parsed, operator, newOperatorName: m.opMatches.length === 0 ? m.operatorText : "", aircraft, type, notes };
}
