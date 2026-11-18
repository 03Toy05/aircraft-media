import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { aircraftTypeAliases, aircraftTypes, organisationAliases, organisations } from "../db/schema";
import { parseAircraftCard } from "./card";
import { AIRCRAFT_CATEGORY_LABEL, CLASSIFICATION_LABEL, normalizeKey, parseClassification, type AircraftCategory, type Classification, type WifiStatus } from "./constants";
import { parseShareRequest, parseQuoteRequest, findAircraftsForShare } from "./chocksShare";
import { answerFleet, answerLookup, fleetBasics, isLookupQuestion, quotePreview } from "./chocksLookup";
import { parseFleetQuery } from "./fleetQuery";
import { findContacts } from "./contacts";
import { findAircraftByTail, findAircraftWithoutTail, getAircraftCard, resolveAircraftTypes, resolveAircraftTypesExact, resolveOrganisations, resolveOrganisationsExact } from "./directory";

/**
 * Chocks, the assistant. It is deterministic: it reads labelled text, checks the directory, and asks one plain
 * question at a time. The whole conversation state lives in the Draft, which the browser sends back each turn,
 * so a short reply ("new", "yes", "cabin") is always read against the question Chocks just asked.
 */

export interface Option { id: string; name: string; note?: string }

export type Asked =
  | { kind: "operator"; options: Option[]; tries: number }
  | { kind: "type"; options: Option[] }
  | { kind: "tail"; existing: Option[]; noTail?: boolean }
  | { kind: "share_aircraft"; options: Option[]; contactId: string }
  | { kind: "share_contact"; options: Option[]; aircraftId: string }
  | { kind: "classify"; mediaId: string }
  | { kind: "confirm" };

export interface DraftPhoto { mediaId: string; name: string; contentVersionId: string | null; classification: Classification; note?: string }

export interface Draft {
  photos: DraftPhoto[];
  operatorText: string;
  /** The operator's region, when given ("Region: Asia"). Optional on drafts saved by older versions. */
  region?: string;
  operator: { kind: "unset" } | { kind: "existing"; id: string; name: string } | { kind: "new" } | { kind: "alias_of"; id: string; name: string } | { kind: "none" };
  aircraftText: string;
  typeId: string | null;
  typeLabel: string;
  typeSkipped: boolean;
  tail: string;
  aircraft: { kind: "unset" } | { kind: "existing"; id: string; label: string } | { kind: "new"; distinct: boolean } | { kind: "none" };
  yom: number | null;
  yor: number | null;
  capacity: number | null;
  wifi: WifiStatus;
  /** Optional on drafts saved by older versions. */
  wifiDetail?: string;
  notes: string;
  base: { mode: "based" | "floating"; locations: string[] } | null;
  asked: Asked | null;
  evidence: string[];
  submitKey: string;
}

export interface Chip { label: string; send: string }
export interface ChocksReply { say: string[]; chips: Chip[]; ready: boolean; done?: boolean; link?: { href: string; label: string }; photos?: { id: string; label: string }[]; copy?: string; share?: { aircraftId: string; contactId: string } }

export function emptyDraft(submitKey: string): Draft {
  return {
    photos: [], operatorText: "", operator: { kind: "unset" }, aircraftText: "", typeId: null, typeLabel: "", typeSkipped: false, tail: "",
    aircraft: { kind: "unset" }, yom: null, yor: null, capacity: null, wifi: "unknown", notes: "", base: null, asked: null, evidence: [], submitKey,
  };
}

// ---------------------------------------------------------------- similarity (so Chocks can say "did you mean…")

function editDistance(a: string, b: string) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

function similar(textNorm: string, candNorm: string) {
  if (!textNorm || !candNorm) return false;
  if (textNorm === candNorm) return true;
  if (Math.min(textNorm.length, candNorm.length) >= 4 && (candNorm.includes(textNorm) || textNorm.includes(candNorm))) return true;
  return editDistance(textNorm, candNorm) <= Math.max(1, Math.floor(Math.min(textNorm.length, candNorm.length) * 0.2));
}

export async function similarOperators(db: Db, tenantId: string, text: string): Promise<Option[]> {
  const n = normalizeKey(text);
  const orgs = await db.select().from(organisations).where(and(eq(organisations.tenantId, tenantId), eq(organisations.active, true)));
  const aliases = await db.select().from(organisationAliases);
  return orgs.filter((o) => similar(n, o.normalizedName) || aliases.some((a) => a.organisationId === o.id && similar(n, a.normalizedAlias))).slice(0, 4).map((o) => ({ id: o.id, name: o.canonicalName }));
}

export async function similarTypes(db: Db, tenantId: string, text: string): Promise<Option[]> {
  const n = normalizeKey(text);
  const types = await db.select().from(aircraftTypes).where(and(eq(aircraftTypes.tenantId, tenantId), eq(aircraftTypes.active, true)));
  const aliases = await db.select().from(aircraftTypeAliases);
  return types
    .filter((t) => similar(n, t.normalizedName) || aliases.some((a) => a.aircraftTypeId === t.id && similar(n, a.normalizedAlias)))
    .slice(0, 5)
    .map((t) => ({ id: t.id, name: `${t.manufacturer} ${t.model}` }));
}

async function countOperators(db: Db, tenantId: string) {
  return (await db.select({ id: organisations.id }).from(organisations).where(and(eq(organisations.tenantId, tenantId), eq(organisations.active, true)))).length;
}

// ---------------------------------------------------------------- answers

const YES = /^(yes|yep|yeah|y|ok(ay)?|sure|correct|right|confirm(ed)?|go( ahead)?|do it|looks good|that'?s right|please)\b/i;
const NEW = /^(new|it'?s new|a new one|new one|new operator|create( it| one)?|add( it)?|yes|yep|yeah|y)\b/i;
const SKIP = /^(skip|none|no operator|blank|leave( it)?( blank| out)?|later|not now|no tail|no|nope|n)\b/i;
const UNSURE = /(don'?t know|do not know|not sure|unsure|no idea|dunno|unknown|i'?m not certain)/i;
const RESTART = /^(cancel|start over|reset|forget (it|that)|never ?mind)\b/i;
const SAME = /^(use|same as|it'?s|its|that'?s|choose|pick)\s+(.+)$/i;

function pickOption(text: string, options: Option[]): Option | null {
  const t = text.trim().replace(SAME, "$2").trim();
  const num = t.match(/^#?(\d)$/);
  if (num) return options[Number(num[1]) - 1] ?? null;
  const n = normalizeKey(t);
  return options.find((o) => normalizeKey(o.name) === n) ?? options.find((o) => n.length >= 3 && normalizeKey(o.name).includes(n)) ?? null;
}

function sharePrepared(aircraftId: string, contactId: string): ChocksReply {
  return { say: ["Here you go. I've prepared the card. Nothing is sent until you press Send in the messenger."], chips: [], ready: false, done: true, share: { aircraftId, contactId } };
}

// ---------------------------------------------------------------- the conversation turn

export async function converse(
  db: Db,
  tenantId: string,
  input: Draft,
  messageRaw: string,
  newPhotos: DraftPhoto[],
): Promise<{ draft: Draft; reply: ChocksReply; confirm: boolean }> {
  let d: Draft = structuredClone(input);
  const say: string[] = [];
  let message = messageRaw.trim();
  const asked = d.asked;
  // "YOM 2013 / YOR 2020 / Confirm": changes and a confirmation in one message. Apply the changes, then confirm.
  let confirmAfter = false;
  if (asked?.kind === "confirm" && message.includes("\n")) {
    const lines = message.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const rest = lines.filter((l) => !/^(confirm(ed)?|yes|ok(ay)?|go ahead|do it)[.!]?$/i.test(l));
    if (rest.length && rest.length < lines.length) { confirmAfter = true; message = rest.join("\n"); }
  }
  if (asked?.kind === "confirm" && !confirmAfter) {
    // "Capacity 12, confirm" / "YOM 2014 and confirm": a trailing confirmation on the same line.
    const tail = message.match(/^(.+?)[ ,;.]+(?:and +)?(?:please +)?(?:confirm(?:ed)?|go ahead|do it)[.!]?$/is);
    if (tail && tail[1].trim()) { confirmAfter = true; message = tail[1].trim(); }
  }
  d.asked = null;
  d.photos.push(...newPhotos);
  if (newPhotos.length) say.push(`Got ${newPhotos.length} photo${newPhotos.length === 1 ? "" : "s"}.`);

  if (message && RESTART.test(message)) {
    return { draft: emptyDraft(d.submitKey), reply: { say: ["No problem, I've cleared that. Send me photos and details whenever you're ready."], chips: [], ready: false }, confirm: false };
  }

  // "Make a quote for the G650 and B-KXX": open the Quote page with those aircraft already chosen. Nothing is saved.
  const quoteReq = d.photos.length === 0 && asked?.kind !== "confirm" ? parseQuoteRequest(message) : null;
  if (quoteReq) {
    const ids: string[] = [];
    const names: string[] = [];
    const missing: string[] = [];
    for (const what of quoteReq.what) {
      const found = await findAircraftsForShare(db, tenantId, what);
      if (!found.length) missing.push(what);
      for (const f of found.slice(0, 4)) if (!ids.includes(f.id)) { ids.push(f.id); names.push(f.label); }
    }
    if (asked) d.asked = asked;
    const preview = ids.length ? await quotePreview(db, tenantId, ids) : null;
    const say = preview
      ? [["Here is the message and photos for:", ...names.map((n) => `• ${n}`)].join(String.fromCharCode(10)), preview.text, "Open the quote to add prices, change the language, edit the wording and send it with the photos."]
      : [quoteReq.what.length ? `I couldn't find ${missing.join(" or ")}.` : "Open the Quote page to choose the aircraft."];
    if (ids.length && missing.length) say.push(`I couldn't find: ${missing.join(", ")}.`);
    return { draft: d, reply: { say, chips: [], ready: false, photos: preview?.photos, copy: preview?.text, link: { href: ids.length ? `/quote?ids=${ids.join(",")}` : "/quote", label: "Open the quote" } }, confirm: false };
  }

  // A question about what you already have ("show me what aircraft Capa Jet has"): answer it, change nothing.
  if (d.photos.length === 0 && isLookupQuestion(message) && !(asked?.kind === "confirm")) {
    // Explicit filters or sorting ("heavy jets in Asia, newest first") run the Operators & aircraft page's own filters.
    // Otherwise a named operator or tail is looked up; a general "show operators" falls back to the whole list.
    const fleetFirst = parseFleetQuery(message, await fleetBasics(db, tenantId)).understood.length > 0;
    const fleet = fleetFirst ? await answerFleet(db, tenantId, message) : null;
    const answer = fleet ? null : await answerLookup(db, tenantId, message);
    const fleetAny = fleet ?? (answer ? null : await answerFleet(db, tenantId, message));
    if (asked) d.asked = asked; // a side question must not make Chocks forget what it was waiting for
    const f = fleet ?? fleetAny;
    return {
      draft: d,
      reply: f
        ? { say: f.say, chips: [], ready: false, link: f.link }
        : answer
          ? { say: answer.say, chips: [], ready: false, link: answer.link, photos: answer.photos }
          : { say: ["I couldn't match that to an operator or tail number you have. Try the operator's name or a tail number, for example “what does Capa Jet have?”."], chips: [], ready: false },
      confirm: false,
    };
  }

  // Sending an aircraft to a saved contact ("send the G280 to Mr Chan"). Nothing is saved; Chocks only prepares the message.
  if (asked?.kind === "share_aircraft" || asked?.kind === "share_contact") {
    const picked = pickOption(message, asked.options);
    if (picked) return { draft: d, reply: sharePrepared(asked.kind === "share_aircraft" ? picked.id : asked.aircraftId, asked.kind === "share_aircraft" ? asked.contactId : picked.id), confirm: false };
    d.asked = asked;
    return { draft: d, reply: { say: ["Please pick one of the options below."], chips: asked.options.map((o, i) => ({ label: o.name, send: `Use #${i + 1}` })), ready: false }, confirm: false };
  }
  const shareReq = d.photos.length === 0 && !/\r?\n/.test(message) ? parseShareRequest(message) : null;
  if (shareReq) {
    const people = await findContacts(db, tenantId, shareReq.who);
    if (people.length === 0) {
      return { draft: d, reply: { say: [`I don't have a contact called “${shareReq.who}”. Add them on the Contacts page first, with the messenger they prefer, then ask me again.`], chips: [], ready: false }, confirm: false };
    }
    const planes = await findAircraftsForShare(db, tenantId, shareReq.what);
    if (planes.length === 0) return { draft: d, reply: { say: [`I couldn't find an aircraft matching “${shareReq.what}”. Try the tail number, the operator or the aircraft type.`], chips: [], ready: false }, confirm: false };
    if (planes.length > 1) {
      const options = planes.slice(0, 6).map((a) => ({ id: a.id, name: a.label }));
      d.asked = { kind: "share_aircraft", options, contactId: people[0].id };
      return { draft: d, reply: { say: [`“${shareReq.what}” matches ${planes.length} aircraft. Which one should go to ${people[0].name}?`], chips: options.map((o, i) => ({ label: o.name, send: `Use #${i + 1}` })), ready: false }, confirm: false };
    }
    if (people.length > 1) {
      const options = people.slice(0, 6).map((c) => ({ id: c.id, name: c.name }));
      d.asked = { kind: "share_contact", options, aircraftId: planes[0].id };
      return { draft: d, reply: { say: [`“${shareReq.who}” matches ${people.length} contacts. Which one?`], chips: options.map((o, i) => ({ label: o.name, send: `Use #${i + 1}` })), ready: false }, confirm: false };
    }
    return { draft: d, reply: sharePrepared(planes[0].id, people[0].id), confirm: false };
  }

  // 1) Is this message an answer to what I just asked?
  let consumed = false;
  if (message && asked) {
    if (asked.kind === "confirm" && YES.test(message)) return { draft: d, reply: { say: [], chips: [], ready: true }, confirm: true };

    if (asked.kind === "operator") {
      // "new" or "skip" is an answer only when it stands alone; a whole sentence ("new operator Vietstar, base Ho Chi Minh") is fresh details.
      const shortAnswer = message.trim().split(/\s+/).length <= 4;
      const picked = pickOption(message, asked.options);
      if (picked) {
        const isAlias = picked.note === "similar";
        d.operator = isAlias ? { kind: "alias_of", id: picked.id, name: picked.name } : { kind: "existing", id: picked.id, name: picked.name };
        if (isAlias) say.push(`Got it: “${d.operatorText}” is another name for ${picked.name}. I'll save that so it matches next time.`);
        consumed = true;
      } else if (shortAnswer && NEW.test(message)) {
        d.operator = { kind: "new" };
        consumed = true;
      } else if (UNSURE.test(message) && !/^(skip|leave)/i.test(message)) {
        const n = await countOperators(db, tenantId);
        d.asked = { ...asked, tries: asked.tries + 1 };
        say.push(`That's fine. I checked all ${n} operator${n === 1 ? "" : "s"} you have${asked.options.length ? " and the closest ones are listed below" : " and none looks like “" + d.operatorText + "”"}, so it is most likely a new operator.`);
        return { draft: d, reply: { say: [...say, "Shall I create it as new, or leave the operator blank for now? You can add it later."], chips: operatorChips(d, asked.options), ready: false }, confirm: false };
      } else if (shortAnswer && SKIP.test(message) && !/^(no|nope|n)$/i.test(message)) {
        d.operator = { kind: "none" };
        consumed = true;
      } else if (/^(no|nope|n)$/i.test(message)) {
        d.operator = { kind: "none" };
        consumed = true;
      }
    } else if (asked.kind === "type") {
      if (SKIP.test(message) || UNSURE.test(message)) {
        d.typeSkipped = true;
        consumed = true;
      } else {
        const picked = pickOption(message, asked.options);
        const found = picked ? [{ id: picked.id, label: picked.name }] : (await resolveAircraftTypes(db, tenantId, message.replace(SAME, "$2"))).map((t) => ({ id: t.id, label: `${t.manufacturer} ${t.model}` }));
        if (found.length === 1) {
          d.typeId = found[0].id;
          d.typeLabel = found[0].label;
          consumed = true;
        }
      }
    } else if (asked.kind === "tail") {
      if (/^(different|another|new|no|nope|n|not the same|distinct)\b/i.test(message)) { d.aircraft = { kind: "new", distinct: true }; consumed = true; }
      else if (/^(skip|none|no tail|leave)\b/i.test(message)) { d.aircraft = { kind: "none" }; consumed = true; }
      else if (YES.test(message) || /^(same|existing|use)\b/i.test(message)) {
        const o = pickOption(message, asked.existing) ?? asked.existing[0];
        d.aircraft = { kind: "existing", id: o.id, label: o.name };
        consumed = true;
      }
    } else if (asked.kind === "classify") {
      const all = message.match(/^all\s+(.+)$/i);
      const cls = parseClassification((all ? all[1] : message).replace(/^(it'?s|its|this is|a|an|the)\s+/i, "").replace(/[.!]+$/, ""));
      if (cls) {
        for (const p of d.photos) if (p.classification === "unclassified" && (all || p.mediaId === asked.mediaId)) p.classification = cls;
        consumed = true;
      }
    }
  }

  // 2) Otherwise read it as new details (labelled lines, or a voice-style single line).
  if (message && !consumed && !(asked?.kind === "confirm" && YES.test(message))) {
    d.evidence.push(message);
    const c = parseAircraftCard(message);
    if (c.operator) { d.operatorText = c.operator; d.operator = { kind: "unset" }; }
    if (c.aircraft) { d.aircraftText = c.aircraft; d.typeId = null; d.typeLabel = ""; d.typeSkipped = false; }
    if (c.tail) { d.tail = c.tail; d.aircraft = { kind: "unset" }; }
    if (c.yom != null) d.yom = c.yom;
    if (c.yor != null) d.yor = c.yor;
    if (c.capacity != null) d.capacity = c.capacity;
    if (c.wifi) { d.wifi = c.wifi; if (c.wifiDetail) d.wifiDetail = c.wifiDetail; }
    if (c.notes) d.notes = c.notes;
    if (c.base) d.base = c.base;
    if (c.region) d.region = c.region;
    // Lines with no label (the natural way to type: "Advance Aviation" then "G280"). Work out what each one is:
    // 1) exact matches against your operators and aircraft types, 2) a closer look for a type, 3) whatever is left is the operator name.
    let rest = [...c.unrecognised];
    const take = (line: string) => { rest = rest.filter((x) => x !== line); };
    for (const line of [...rest]) {
      if (!d.aircraftText && !c.aircraft && (await resolveAircraftTypesExact(db, tenantId, line)).length) { d.aircraftText = line; d.typeId = null; d.typeLabel = ""; d.typeSkipped = false; take(line); continue; }
      if (!d.operatorText && !c.operator && (await resolveOrganisationsExact(db, tenantId, line)).length) { d.operatorText = line; d.operator = { kind: "unset" }; take(line); }
    }
    for (const line of [...rest]) {
      if (!d.aircraftText && !c.aircraft && (await resolveAircraftTypes(db, tenantId, line)).length) { d.aircraftText = line; d.typeId = null; d.typeLabel = ""; d.typeSkipped = false; take(line); }
    }
    if (!d.operatorText && !c.operator && rest.length && asked?.kind !== "type") {
      d.operatorText = rest[0];
      d.operator = { kind: "unset" };
      rest = rest.slice(1);
    }
    for (const line of rest) say.push(`I didn't understand “${line}”. You can add “Tail number: …”, “YOM: …” or “Capacity: …” on their own lines.`);
    for (const a of c.assumed) say.push(`I read ${a}.`);
    for (const p of c.problems) say.push(p + ".");
  }

  // 3) Check what already exists, then ask the next open question.
  const q = await nextStep(db, tenantId, d, say);
  if (confirmAfter && q.reply.ready) return { draft: q.draft, reply: q.reply, confirm: true };
  return { draft: q.draft, reply: q.reply, confirm: false };
}

function operatorChips(d: Draft, options: Option[]): Chip[] {
  return [
    { label: `Yes, create “${d.operatorText}”`, send: "New operator" },
    ...options.map((o, i) => ({ label: `Same as ${o.name}`, send: `Same as #${i + 1}` })),
    { label: "Leave operator blank", send: "Leave blank" },
  ];
}

async function nextStep(db: Db, tenantId: string, d: Draft, say: string[]): Promise<{ draft: Draft; reply: ChocksReply }> {
  // -- operator
  if (d.operatorText && d.operator.kind === "unset") {
    const matches = await resolveOrganisationsExact(db, tenantId, d.operatorText);
    if (matches.length === 1) {
      d.operator = { kind: "existing", id: matches[0].id, name: matches[0].canonicalName };
      say.push(`Operator: ${matches[0].canonicalName} is already in your list.`);
    } else if (matches.length > 1) {
      const options = matches.map((m) => ({ id: m.id, name: m.canonicalName }));
      d.asked = { kind: "operator", options, tries: 0 };
      return { draft: d, reply: { say: [...say, `“${d.operatorText}” matches ${matches.length} of your operators. Which one is it?`], chips: options.map((o, i) => ({ label: o.name, send: `Use #${i + 1}` })), ready: false } };
    } else {
      const n = await countOperators(db, tenantId);
      const options = (await similarOperators(db, tenantId, d.operatorText)).map((o) => ({ ...o, note: "similar" }));
      d.asked = { kind: "operator", options, tries: 0 };
      const lines = [...say, `I checked your ${n} operator${n === 1 ? "" : "s"} and “${d.operatorText}” isn't one of them.`];
      if (options.length) lines.push(`The closest ${options.length === 1 ? "one is" : "ones are"}: ${options.map((o) => o.name).join(", ")}. Is it one of those under another name, or a new operator?`);
      else lines.push("Is it a new operator? If you're not sure, say “not sure” and I'll tell you what I'd do.");
      return { draft: d, reply: { say: lines, chips: operatorChips(d, options), ready: false } };
    }
  }

  // -- aircraft type
  if (!d.typeId && !d.typeSkipped) {
    if (d.aircraftText) {
      const m = await resolveAircraftTypesExact(db, tenantId, d.aircraftText);
      if (m.length === 1) {
        d.typeId = m[0].id;
        d.typeLabel = `${m[0].manufacturer} ${m[0].model}`;
        say.push(`Aircraft type: ${d.typeLabel}${m[0].category ? ` (${AIRCRAFT_CATEGORY_LABEL[m[0].category as AircraftCategory] ?? m[0].category})` : ""}.`);
      } else {
        const options = (m.length ? m.map((x) => ({ id: x.id, name: `${x.manufacturer} ${x.model}` })) : await similarTypes(db, tenantId, d.aircraftText));
        d.asked = { kind: "type", options };
        const first = m.length > 1 ? `“${d.aircraftText}” matches ${m.length} aircraft types. Which one?` : options.length ? `I don't have “${d.aircraftText}”. Did you mean one of these?` : `I don't have an aircraft type called “${d.aircraftText}”. Tell me the exact name (like “Gulfstream G280”), or load the standard list on the Aircraft page.`;
        return { draft: d, reply: { say: [...say, first], chips: [...options.map((o, i) => ({ label: o.name, send: `Use #${i + 1}` })), { label: "Skip the type", send: "Skip" }], ready: false } };
      }
    } else if (d.photos.length || d.tail || d.yom || d.yor || d.capacity) {
      d.asked = { kind: "type", options: [] };
      return { draft: d, reply: { say: [...say, "Which aircraft type is this? For example “Gulfstream G280”."], chips: [{ label: "Skip the type", send: "Skip" }], ready: false } };
    }
  }

  // -- tail: check whether it already exists
  if (d.tail && d.aircraft.kind === "unset") {
    const found = await findAircraftByTail(db, tenantId, d.tail);
    if (found.length) {
      const existing: Option[] = [];
      for (const f of found) {
        const c = await getAircraftCard(db, f.aircraftId);
        existing.push({ id: f.aircraftId, name: c ? `${c.tailNumber ?? d.tail} — ${c.aircraft}${c.operator ? ` — ${c.operator}` : ""}` : d.tail });
      }
      d.asked = { kind: "tail", existing };
      return {
        draft: d,
        reply: {
          say: [...say, `${d.tail} is already in your directory: ${existing.map((e) => e.name).join("; ")}. Is this photo set for that aircraft, or a different aircraft with the same tail number?`],
          chips: [{ label: "Same aircraft", send: "Same aircraft" }, { label: "Different aircraft", send: "Different aircraft" }, { label: "Skip the tail", send: "Skip the tail" }],
          ready: false,
        },
      };
    }
    d.aircraft = { kind: "new", distinct: false };
    say.push(`${d.tail} isn't in your directory yet, so I'll create it as a new aircraft.`);
  }
  // -- no tail number: still fine. Record the aircraft without one (when there is an operator or details to attach it to).
  if (!d.tail && d.aircraft.kind === "unset") {
    const hasOperator = d.operator.kind === "existing" || d.operator.kind === "alias_of" || d.operator.kind === "new";
    const hasDetails = !!(d.yom || d.yor || d.capacity || d.notes);
    if (!d.typeId || !(hasOperator || hasDetails)) {
      d.aircraft = { kind: "none" };
    } else {
      const opId = d.operator.kind === "existing" || d.operator.kind === "alias_of" ? d.operator.id : null;
      const ids = opId ? await findAircraftWithoutTail(db, tenantId, d.typeId, opId) : [];
      if (ids.length) {
        const existing: Option[] = [];
        for (const id of ids) {
          const c = await getAircraftCard(db, id);
          existing.push({ id, name: c ? `${c.aircraft}${c.operator ? ` — ${c.operator}` : ""} (no tail number yet)` : id });
        }
        d.asked = { kind: "tail", existing, noTail: true };
        return {
          draft: d,
          reply: {
            say: [...say, `You already have ${existing.map((e) => e.name).join("; ")}. Is this that aircraft, or another one?`],
            chips: [{ label: "Same aircraft", send: "Same aircraft" }, { label: "Another aircraft", send: "Different aircraft" }, { label: "Photos for the type only", send: "Skip" }],
            ready: false,
          },
        };
      }
      d.aircraft = { kind: "new", distinct: false };
      say.push("No tail number was given, so I'll record the aircraft without one. You can add it later.");
    }
  }
  if (d.aircraft.kind === "new" && !d.typeId) {
    d.asked = { kind: "type", options: [] };
    return { draft: d, reply: { say: [...say, `To create ${d.tail} I need its aircraft type. Which one is it?`], chips: [], ready: false } };
  }

  // -- each photo needs a view
  const unclassified = d.photos.find((p) => p.classification === "unclassified");
  if (unclassified) {
    d.asked = { kind: "classify", mediaId: unclassified.mediaId };
    const chips = (["exterior", "cabin", "floor_plan", "galley", "flight_deck"] as Classification[]).map((c) => ({ label: CLASSIFICATION_LABEL[c], send: c }));
    return { draft: d, reply: { say: [...say, `What view is “${unclassified.name}”? Say “all cabin” to apply a view to every unclassified photo.`], chips, ready: false } };
  }

  // -- ready
  if (!d.photos.length && d.operator.kind === "unset" && d.aircraft.kind === "none" && !d.typeId && !d.yom && !d.capacity) {
    return { draft: d, reply: { say: [...say, "I need a bit more. Send photos, or details like “Operator: …”, “Aircraft type: …”, “Tail number: …”."], chips: [], ready: false } };
  }
  d.asked = { kind: "confirm" };
  return { draft: d, reply: { say: [...say, ...summary(d), "Say “confirm”, or change something by sending it again (for example “Capacity: 12”)."], chips: [{ label: "Confirm", send: "Confirm" }, { label: "Cancel", send: "Cancel" }], ready: true } };
}

export function summary(d: Draft): string[] {
  const lines = ["Here is what I'll do:"];
  const reg = d.region ? ` (region: ${d.region})` : "";
  if (d.operator.kind === "new") lines.push(`• Create operator “${d.operatorText}”${reg}`);
  else if (d.operator.kind === "alias_of") lines.push(`• Use operator ${d.operator.name} and remember “${d.operatorText}” as another name`);
  else if (d.operator.kind === "existing") lines.push(`• Operator: ${d.operator.name}${reg ? `, set region to ${d.region}` : ""}`);
  if (d.aircraft.kind === "new") lines.push(`• Create aircraft ${d.tail || "without a tail number yet"}${d.typeLabel ? ` (${d.typeLabel})` : ""}${d.aircraft.distinct && d.tail ? " as a different aircraft from the existing one" : ""}`);
  else if (d.aircraft.kind === "existing") lines.push(`• Use the existing aircraft ${d.aircraft.label}, and update the details you gave`);
  else if (d.typeLabel) lines.push(`• No tail number: photos will represent the ${d.typeLabel} type`);
  const facts = [d.yom && `YOM ${d.yom}`, d.yor && `YOR ${d.yor}`, d.capacity && `${d.capacity} seats`, d.wifi !== "unknown" && `WIFI ${d.wifi}${d.wifiDetail ? `, ${d.wifiDetail}` : ""}`, d.notes && `notes “${d.notes}”`].filter(Boolean);
  if (facts.length && d.aircraft.kind === "new") lines.push(`• Details: ${facts.join(", ")}`);
  else if (facts.length && d.aircraft.kind === "existing") lines.push(`• Details to save on it: ${facts.join(", ")} (anything you didn't mention stays as it is)`);
  if (d.photos.length && d.aircraft.kind !== "existing" && d.aircraft.kind !== "new" && !d.typeId) lines.push("• These photos have no aircraft or type to attach to, so they stay in Review");
  if (d.photos.length) lines.push(`• Approve ${d.photos.length} photo${d.photos.length === 1 ? "" : "s"}: ${d.photos.map((p) => `${p.name} (${CLASSIFICATION_LABEL[p.classification]})`).join(", ")}`);
  return lines;
}
