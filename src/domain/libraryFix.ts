import { randomUUID } from "node:crypto";
import { and, eq, ne } from "drizzle-orm";
import type { Db } from "../db/client";
import { aircraft } from "../db/schema";
import type { Actor } from "./action";
import { changeRegistration, findAircraftByTail, getAircraftCard, resolveAircraftTypesExact } from "./directory";
import { LIBRARY_TENANT_ID } from "./library";

/**
 * Corrections to library aircraft whose details came in wrong (a source file's typo): the type, the serial number
 * and the tail. Found by the tail they have now. Used through POST /api/library/fix (npm run library:fix).
 */
export interface LibraryFix {
  /** The tail the aircraft has in the library now (e.g. "91JS"). */
  tail: string;
  /** The operator it is listed under, to be sure it's the right one. */
  operator: string;
  type?: string;
  serial?: string;
  newTail?: string;
}

export async function fixLibraryAircraft(db: Db, admin: Actor, f: LibraryFix): Promise<string> {
  const lib: Actor = { id: admin.id, tenantId: LIBRARY_TENANT_ID };
  const found = await findAircraftByTail(db, LIBRARY_TENANT_ID, f.tail);
  if (found.length !== 1) throw new Error(`${f.tail}: ${found.length ? "more than one" : "no"} library aircraft has this tail.`);
  const id = found[0].aircraftId;
  const card = await getAircraftCard(db, id);
  if (!card) throw new Error(`${f.tail}: not found.`);
  if ((card.operator ?? "").trim().toLowerCase() !== f.operator.trim().toLowerCase()) throw new Error(`${f.tail}: listed under "${card.operator}", not "${f.operator}".`);
  const [row] = await db.select().from(aircraft).where(eq(aircraft.id, id));
  const done: string[] = [];

  let typeId = row.aircraftTypeId;
  if (f.type) {
    const t = (await resolveAircraftTypesExact(db, LIBRARY_TENANT_ID, f.type))[0];
    if (!t) throw new Error(`${f.tail}: unknown type "${f.type}".`);
    if (t.id !== typeId) { typeId = t.id; done.push(`type → ${f.type}`); }
  }
  const serial = f.serial !== undefined ? f.serial.trim() || null : row.serialNumber;
  if (serial !== row.serialNumber) done.push(`serial ${row.serialNumber ?? "–"} → ${serial ?? "–"}`);
  if (serial) {
    const dup = await db.select({ id: aircraft.id }).from(aircraft).where(and(eq(aircraft.tenantId, LIBRARY_TENANT_ID), eq(aircraft.aircraftTypeId, typeId), eq(aircraft.serialNumber, serial), eq(aircraft.active, true), ne(aircraft.id, id)));
    if (dup.length) throw new Error(`${f.tail}: another library aircraft of this type already has serial ${serial}.`);
  }
  if (typeId !== row.aircraftTypeId || serial !== row.serialNumber) {
    await db.update(aircraft).set({ aircraftTypeId: typeId, serialNumber: serial, updatedAt: new Date() }).where(eq(aircraft.id, id));
  }
  if (f.newTail && f.newTail.trim().toUpperCase() !== f.tail.trim().toUpperCase()) {
    await changeRegistration(db, lib, randomUUID(), { aircraftId: id, newRegistration: f.newTail.trim().toUpperCase() });
    done.push(`tail ${f.tail} → ${f.newTail.trim().toUpperCase()}`);
  }
  return `${f.tail} (${f.operator}): ${done.length ? done.join(", ") : "already right"}`;
}
