import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { aircraft, aircraftTypes, organisations } from "../db/schema";
import { parseAircraftCard } from "./card";
import { AIRCRAFT_CATEGORY_LABEL, CLASSIFICATION_LABEL, normalizeKey, parseClassification, type AircraftCategory, type Classification, type WifiStatus } from "./constants";
import { isChinese, plural, tr, trCategory, trClassification, trLoose, trWifi, type ChatLang } from "./chocksText";
import { parseShareRequest, parseQuoteRequest, findAircraftsForShare } from "./chocksShare";
import { answerFleet, answerLookup, fleetBasics, isLookupQuestion, quotePreview } from "./chocksLookup";
import { parseFleetQuery } from "./fleetQuery";
import { findContacts } from "./contacts";
import { findAircraftByTail, findAircraftWithoutTail, getAircraftCard, orgAliasesFor, typeAliasesFor, resolveAircraftTypes, resolveAircraftTypesExact, resolveOrganisations, resolveOrganisationsExact } from "./directory";

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
  /** The language Chocks speaks; the browser sets it on every turn. */
  lang?: ChatLang;
}

export interface Chip { label: string; send: string }
/** A photo Chocks shows with a quote: which option (aircraft, from 0) it belongs to and what view it is. */
export interface ChocksPhoto { id: string; label: string; classification?: Classification; option?: number }
export interface ChocksReply { say: string[]; chips: Chip[]; ready: boolean; done?: boolean; link?: { href: string; label: string }; photos?: ChocksPhoto[]; copy?: string; options?: { title: string; text: string }[]; share?: { aircraftId: string; contactId: string } }

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
  const aliases = await orgAliasesFor(db, tenantId);
  return orgs.filter((o) => similar(n, o.normalizedName) || aliases.some((a) => a.organisationId === o.id && similar(n, a.normalizedAlias))).slice(0, 4).map((o) => ({ id: o.id, name: o.canonicalName }));
}

export async function similarTypes(db: Db, tenantId: string, text: string): Promise<Option[]> {
  const n = normalizeKey(text);
  const types = await db.select().from(aircraftTypes).where(and(eq(aircraftTypes.tenantId, tenantId), eq(aircraftTypes.active, true)));
  const aliases = await typeAliasesFor(db, tenantId);
  return types
    .filter((t) => similar(n, t.normalizedName) || aliases.some((a) => a.aircraftTypeId === t.id && similar(n, a.normalizedAlias)))
    .slice(0, 5)
    .map((t) => ({ id: t.id, name: `${t.manufacturer} ${t.model}` }));
}

async function countOperators(db: Db, tenantId: string) {
  return (await db.select({ id: organisations.id }).from(organisations).where(and(eq(organisations.tenantId, tenantId), eq(organisations.active, true)))).length;
}

// ---------------------------------------------------------------- answers

const END = "(?:[。！!，,\\s]|$)";
const YES = new RegExp("^(?:(?:yes|yep|yeah|y|ok(?:ay)?|sure|correct|right|confirm(?:ed)?|go(?: ahead)?|do it|looks good|that'?s right|please)\\b|(?:是的?|對|对|好的?|可以|確認|确认|確定|确定|沒問題|没问题|冇問題)" + END + ")", "i");
const NEW = new RegExp("^(?:(?:new|it'?s new|a new one|new one|new operator|create(?: it| one)?|add(?: it)?|yes|yep|yeah|y)\\b|(?:新增|新的|新營運商|新运营商|新建|建立|創建|创建|是新的|是)" + END + ")", "i");
const SKIP = new RegExp("^(?:(?:skip|none|no operator|blank|leave(?: it)?(?: blank| out)?|later|not now|no tail|no|nope|n)\\b|(?:跳過|跳过|略過|略过|不用|不需要|留空|無|无|沒有|没有|稍後|稍后|之後|之后|否|不是|不要)" + END + ")", "i");
const UNSURE = /(don'?t know|do not know|not sure|unsure|no idea|dunno|unknown|i'?m not certain|不知道|不確定|不确定|唔知|不清楚|未必)/i;
const RESTART = new RegExp("^(?:(?:cancel|start over|reset|forget (?:it|that)|never ?mind)\\b|(?:取消|重來|重来|重新開始|重新开始|算了|不用了)" + END + ")", "i");
const SAME = /^(use|same as|it'?s|its|that'?s|choose|pick|用|選|选|揀)(?:\s+|(?<=[用選选揀]))(.+)$/i;

function pickOption(text: string, options: Option[]): Option | null {
  const t = text.trim().replace(SAME, "$2").trim();
  const num = t.match(/^(?:#|第)?(\d)(?:個|个)?$/);
  if (num) return options[Number(num[1]) - 1] ?? null;
  const n = normalizeKey(t);
  return options.find((o) => normalizeKey(o.name) === n) ?? options.find((o) => n.length >= 3 && normalizeKey(o.name).includes(n)) ?? null;
}

function sharePrepared(L: ChatLang | undefined, aircraftId: string, contactId: string): ChocksReply {
  return { say: [tr(L, "Here you go. I've prepared the card. Nothing is sent until you press Send in the messenger.")], chips: [], ready: false, done: true, share: { aircraftId, contactId } };
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
  const L = d.lang;
  const say: string[] = [];
  let message = messageRaw.trim();
  const asked = d.asked;
  // "YOM 2013 / YOR 2020 / Confirm": changes and a confirmation in one message. Apply the changes, then confirm.
  let confirmAfter = false;
  if (asked?.kind === "confirm" && message.includes("\n")) {
    const lines = message.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const rest = lines.filter((l) => !/^(confirm(ed)?|yes|ok(ay)?|go ahead|do it|確認|确认|確定|确定|好|是)[.!。！]?$/i.test(l));
    if (rest.length && rest.length < lines.length) { confirmAfter = true; message = rest.join("\n"); }
  }
  if (asked?.kind === "confirm" && !confirmAfter) {
    // "Capacity 12, confirm" / "YOM 2014 and confirm": a trailing confirmation on the same line.
    const tail = message.match(/^(.+?)[ ,;.，；]+(?:and +|並且?|并且?)?(?:please +)?(?:confirm(?:ed)?|go ahead|do it|確認|确认|確定|确定)[.!。！]?$/is);
    if (tail && tail[1].trim()) { confirmAfter = true; message = tail[1].trim(); }
  }
  d.asked = null;
  d.photos.push(...newPhotos);
  if (newPhotos.length) say.push(tr(L, "Got {n} photo{s}.", { n: newPhotos.length, s: plural(newPhotos.length) }));

  if (message && RESTART.test(message)) {
    return { draft: { ...emptyDraft(d.submitKey), lang: L }, reply: { say: [tr(L, "No problem, I've cleared that. Send me photos and details whenever you're ready.")], chips: [], ready: false }, confirm: false };
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
    const preview = ids.length ? await quotePreview(db, tenantId, ids, L) : null;
    const say = preview
      ? [[tr(L, "Here is the message and photos for:"), ...names.map((n) => `• ${n}`)].join(String.fromCharCode(10)), preview.text, tr(L, "Open the quote to add prices, change the language, edit the wording and send it with the photos.")]
      : [quoteReq.what.length ? tr(L, "I couldn't find {names}.", { names: missing.join(isChinese(L) ? "、" : " or ") }) : tr(L, "Open the Quote page to choose the aircraft.")];
    if (ids.length && missing.length) say.push(tr(L, "I couldn't find: {names}.", { names: missing.join(", ") }));
    return { draft: d, reply: { say, chips: [], ready: false, photos: preview?.photos, copy: preview?.text, options: preview?.options, link: { href: ids.length ? `/quote?ids=${ids.join(",")}` : "/quote", label: tr(L, "Open the quote") } }, confirm: false };
  }

  // A question about what you already have ("show me what aircraft Capa Jet has"): answer it, change nothing.
  if (d.photos.length === 0 && isLookupQuestion(message) && !(asked?.kind === "confirm")) {
    // Explicit filters or sorting ("heavy jets in Asia, newest first") run the Operators & aircraft page's own filters.
    // Otherwise a named operator or tail is looked up; a general "show operators" falls back to the whole list.
    const fleetFirst = parseFleetQuery(message, await fleetBasics(db, tenantId)).understood.length > 0;
    const fleet = fleetFirst ? await answerFleet(db, tenantId, message, L) : null;
    const answer = fleet ? null : await answerLookup(db, tenantId, message, L);
    const fleetAny = fleet ?? (answer ? null : await answerFleet(db, tenantId, message, L));
    if (asked) d.asked = asked; // a side question must not make Chocks forget what it was waiting for
    const f = fleet ?? fleetAny;
    return {
      draft: d,
      reply: f
        ? { say: f.say, chips: [], ready: false, link: f.link }
        : answer
          ? { say: answer.say, chips: [], ready: false, link: answer.link, photos: answer.photos }
          : { say: [tr(L, "I couldn't match that to an operator or tail number you have. Try the operator's name or a tail number, for example “what does Capa Jet have?”.")], chips: [], ready: false },
      confirm: false,
    };
  }

  // Sending an aircraft to a saved contact ("send the G280 to Mr Chan"). Nothing is saved; Chocks only prepares the message.
  if (asked?.kind === "share_aircraft" || asked?.kind === "share_contact") {
    const picked = pickOption(message, asked.options);
    if (picked) return { draft: d, reply: sharePrepared(L, asked.kind === "share_aircraft" ? picked.id : asked.aircraftId, asked.kind === "share_aircraft" ? asked.contactId : picked.id), confirm: false };
    d.asked = asked;
    return { draft: d, reply: { say: [tr(L, "Please pick one of the options below.")], chips: asked.options.map((o, i) => ({ label: o.name, send: `Use #${i + 1}` })), ready: false }, confirm: false };
  }
  const shareReq = d.photos.length === 0 && !/\r?\n/.test(message) ? parseShareRequest(message) : null;
  if (shareReq) {
    const people = await findContacts(db, tenantId, shareReq.who);
    if (people.length === 0) {
      return { draft: d, reply: { say: [tr(L, "I don't have a contact called “{who}”. Add them on the Contacts page first, with the messenger they prefer, then ask me again.", { who: shareReq.who })], chips: [], ready: false }, confirm: false };
    }
    const planes = await findAircraftsForShare(db, tenantId, shareReq.what);
    if (planes.length === 0) return { draft: d, reply: { say: [tr(L, "I couldn't find an aircraft matching “{what}”. Try the tail number, the operator or the aircraft type.", { what: shareReq.what })], chips: [], ready: false }, confirm: false };
    if (planes.length > 1) {
      const options = planes.slice(0, 6).map((a) => ({ id: a.id, name: a.label }));
      d.asked = { kind: "share_aircraft", options, contactId: people[0].id };
      return { draft: d, reply: { say: [tr(L, "“{what}” matches {n} aircraft. Which one should go to {who}?", { what: shareReq.what, n: planes.length, who: people[0].name })], chips: options.map((o, i) => ({ label: o.name, send: `Use #${i + 1}` })), ready: false }, confirm: false };
    }
    if (people.length > 1) {
      const options = people.slice(0, 6).map((c) => ({ id: c.id, name: c.name }));
      d.asked = { kind: "share_contact", options, aircraftId: planes[0].id };
      return { draft: d, reply: { say: [tr(L, "“{who}” matches {n} contacts. Which one?", { who: shareReq.who, n: people.length })], chips: options.map((o, i) => ({ label: o.name, send: `Use #${i + 1}` })), ready: false }, confirm: false };
    }
    return { draft: d, reply: sharePrepared(L, planes[0].id, people[0].id), confirm: false };
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
        if (isAlias) say.push(tr(L, "Got it: “{text}” is another name for {name}. I'll save that so it matches next time.", { text: d.operatorText, name: picked.name }));
        consumed = true;
      } else if (shortAnswer && NEW.test(message)) {
        d.operator = { kind: "new" };
        consumed = true;
      } else if (UNSURE.test(message) && !/^(skip|leave)/i.test(message)) {
        const n = await countOperators(db, tenantId);
        d.asked = { ...asked, tries: asked.tries + 1 };
        say.push(asked.options.length
          ? tr(L, "That's fine. I checked all {n} operator{s} you have and the closest ones are listed below, so it is most likely a new operator.", { n, s: plural(n) })
          : tr(L, "That's fine. I checked all {n} operator{s} you have and none looks like “{text}”, so it is most likely a new operator.", { n, s: plural(n), text: d.operatorText }));
        return { draft: d, reply: { say: [...say, tr(L, "Shall I create it as new, or leave the operator blank for now? You can add it later.")], chips: operatorChips(d, asked.options), ready: false }, confirm: false };
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
      if (/^(different|another|new|no|nope|n|not the same|distinct)\b|^(?:另一架|不同|新的|不是同一架)/i.test(message)) { d.aircraft = { kind: "new", distinct: true }; consumed = true; }
      else if (/^(skip|none|no tail|leave)\b|^(?:略過|略过|跳過|跳过|無|无)/i.test(message)) { d.aircraft = { kind: "none" }; consumed = true; }
      else if (YES.test(message) || /^(same|existing|use)\b|^(?:同一架|同一個|同一个|一樣|一样)/i.test(message)) {
        const o = pickOption(message, asked.existing) ?? asked.existing[0];
        d.aircraft = { kind: "existing", id: o.id, label: o.name };
        consumed = true;
      }
    } else if (asked.kind === "classify") {
      const all = message.match(/^(?:all\s+|全部\s*|所有\s*)(.+)$/i);
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
    for (const line of rest) say.push(tr(L, "I didn't understand “{line}”. You can add “Tail number: …”, “YOM: …” or “Capacity: …” on their own lines.", { line }));
    for (const a of c.assumed) say.push(tr(L, "I read {a}.", { a: trLoose(L, a) }));
    for (const p of c.problems) say.push(trLoose(L, p) + (isChinese(L) ? "。" : "."));
  }

  // 3) Check what already exists, then ask the next open question.
  const q = await nextStep(db, tenantId, d, say);
  if (confirmAfter && q.reply.ready) return { draft: q.draft, reply: q.reply, confirm: true };
  return { draft: q.draft, reply: q.reply, confirm: false };
}

function operatorChips(d: Draft, options: Option[]): Chip[] {
  return [
    { label: tr(d.lang, "Yes, create “{text}”", { text: d.operatorText }), send: "New operator" },
    ...options.map((o, i) => ({ label: tr(d.lang, "Same as {name}", { name: o.name }), send: `Same as #${i + 1}` })),
    { label: tr(d.lang, "Leave operator blank"), send: "Leave blank" },
  ];
}

async function nextStep(db: Db, tenantId: string, d: Draft, say: string[]): Promise<{ draft: Draft; reply: ChocksReply }> {
  const L = d.lang;
  // -- operator
  if (d.operatorText && d.operator.kind === "unset") {
    const matches = await resolveOrganisationsExact(db, tenantId, d.operatorText);
    if (matches.length === 1) {
      d.operator = { kind: "existing", id: matches[0].id, name: matches[0].canonicalName };
      say.push(tr(L, "Operator: {name} is already in your list.", { name: matches[0].canonicalName }));
    } else if (matches.length > 1) {
      const options = matches.map((m) => ({ id: m.id, name: m.canonicalName }));
      d.asked = { kind: "operator", options, tries: 0 };
      return { draft: d, reply: { say: [...say, tr(L, "“{text}” matches {n} of your operators. Which one is it?", { text: d.operatorText, n: matches.length })], chips: options.map((o, i) => ({ label: o.name, send: `Use #${i + 1}` })), ready: false } };
    } else {
      const n = await countOperators(db, tenantId);
      const options = (await similarOperators(db, tenantId, d.operatorText)).map((o) => ({ ...o, note: "similar" }));
      d.asked = { kind: "operator", options, tries: 0 };
      const lines = [...say, tr(L, "I checked your {n} operator{s} and “{text}” isn't one of them.", { n, s: plural(n), text: d.operatorText })];
      if (options.length) lines.push(tr(L, options.length === 1 ? "The closest one is: {names}. Is it one of those under another name, or a new operator?" : "The closest ones are: {names}. Is it one of those under another name, or a new operator?", { names: options.map((o) => o.name).join(isChinese(L) ? "、" : ", ") }));
      else lines.push(tr(L, "Is it a new operator? If you're not sure, say “not sure” and I'll tell you what I'd do."));
      return { draft: d, reply: { say: lines, chips: operatorChips(d, options), ready: false } };
    }
  }

  // -- a tail you already have tells the type: don't ask for it again
  if (!d.typeId && !d.aircraftText && d.tail) {
    const found = await findAircraftByTail(db, tenantId, d.tail);
    if (found.length === 1) {
      const [row] = await db.select({ t: aircraftTypes }).from(aircraft).innerJoin(aircraftTypes, eq(aircraftTypes.id, aircraft.aircraftTypeId)).where(and(eq(aircraft.id, found[0].aircraftId), eq(aircraft.tenantId, tenantId)));
      if (row) {
        d.typeId = row.t.id;
        d.typeLabel = `${row.t.manufacturer} ${row.t.model}`;
        say.push(tr(L, "Aircraft type: {label}.", { label: d.typeLabel }));
      }
    }
  }

  // -- aircraft type
  if (!d.typeId && !d.typeSkipped) {
    if (d.aircraftText) {
      const m = await resolveAircraftTypesExact(db, tenantId, d.aircraftText);
      if (m.length === 1) {
        d.typeId = m[0].id;
        d.typeLabel = `${m[0].manufacturer} ${m[0].model}`;
        const cat = m[0].category ? trCategory(L, m[0].category, AIRCRAFT_CATEGORY_LABEL[m[0].category as AircraftCategory] ?? m[0].category) : "";
        say.push(cat ? tr(L, "Aircraft type: {label} ({category}).", { label: d.typeLabel, category: cat }) : tr(L, "Aircraft type: {label}.", { label: d.typeLabel }));
      } else {
        const options = (m.length ? m.map((x) => ({ id: x.id, name: `${x.manufacturer} ${x.model}` })) : await similarTypes(db, tenantId, d.aircraftText));
        d.asked = { kind: "type", options };
        const first = m.length > 1 ? tr(L, "“{text}” matches {n} aircraft types. Which one?", { text: d.aircraftText, n: m.length }) : options.length ? tr(L, "I don't have “{text}”. Did you mean one of these?", { text: d.aircraftText }) : tr(L, "I don't have an aircraft type called “{text}”. Tell me the exact name (like “Gulfstream G280”), or load the standard list on the Operators & aircraft page.", { text: d.aircraftText });
        return { draft: d, reply: { say: [...say, first], chips: [...options.map((o, i) => ({ label: o.name, send: `Use #${i + 1}` })), { label: tr(L, "Skip the type"), send: "Skip" }], ready: false } };
      }
    } else if (d.photos.length || d.tail || d.yom || d.yor || d.capacity) {
      d.asked = { kind: "type", options: [] };
      return { draft: d, reply: { say: [...say, tr(L, "Which aircraft type is this? For example “Gulfstream G280”.")], chips: [{ label: tr(L, "Skip the type"), send: "Skip" }], ready: false } };
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
          say: [...say, tr(L, "{tail} is already in your directory: {list}. Is this photo set for that aircraft, or a different aircraft with the same tail number?", { tail: d.tail, list: existing.map((e) => e.name).join("; ") })],
          chips: [{ label: tr(L, "Same aircraft"), send: "Same aircraft" }, { label: tr(L, "Different aircraft"), send: "Different aircraft" }, { label: tr(L, "Skip the tail"), send: "Skip the tail" }],
          ready: false,
        },
      };
    }
    d.aircraft = { kind: "new", distinct: false };
    say.push(tr(L, "{tail} isn't in your directory yet, so I'll create it as a new aircraft.", { tail: d.tail }));
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
          existing.push({ id, name: c ? `${c.aircraft}${c.operator ? ` — ${c.operator}` : ""} ${tr(L, "(no tail number yet)")}` : id });
        }
        d.asked = { kind: "tail", existing, noTail: true };
        return {
          draft: d,
          reply: {
            say: [...say, tr(L, "You already have {list}. Is this that aircraft, or another one?", { list: existing.map((e) => e.name).join("; ") })],
            chips: [{ label: tr(L, "Same aircraft"), send: "Same aircraft" }, { label: tr(L, "Another aircraft"), send: "Different aircraft" }, { label: tr(L, "Photos for the type only"), send: "Skip" }],
            ready: false,
          },
        };
      }
      d.aircraft = { kind: "new", distinct: false };
      say.push(tr(L, "No tail number was given, so I'll record the aircraft without one. You can add it later."));
    }
  }
  if (d.aircraft.kind === "new" && !d.typeId) {
    d.asked = { kind: "type", options: [] };
    return { draft: d, reply: { say: [...say, tr(L, "To create {tail} I need its aircraft type. Which one is it?", { tail: d.tail })], chips: [], ready: false } };
  }

  // -- each photo needs a view
  const unclassified = d.photos.find((p) => p.classification === "unclassified");
  if (unclassified) {
    d.asked = { kind: "classify", mediaId: unclassified.mediaId };
    const chips = (["exterior", "cabin", "floor_plan"] as Classification[]).map((c) => ({ label: trClassification(L, c, CLASSIFICATION_LABEL[c]), send: c }));
    return { draft: d, reply: { say: [...say, tr(L, "What view is “{name}”? Say “all cabin” to apply a view to every unclassified photo.", { name: unclassified.name })], chips, ready: false } };
  }

  // -- ready
  if (!d.photos.length && d.operator.kind === "unset" && d.aircraft.kind === "none" && !d.typeId && !d.yom && !d.capacity) {
    return { draft: d, reply: { say: [...say, tr(L, "I need a bit more. Send photos, or details like “Operator: …”, “Aircraft type: …”, “Tail number: …”.")], chips: [], ready: false } };
  }
  d.asked = { kind: "confirm" };
  return { draft: d, reply: { say: [...say, ...summary(d), tr(L, "Say “confirm”, or change something by sending it again (for example “Capacity: 12”).")], chips: [{ label: tr(L, "Confirm"), send: "Confirm" }, { label: tr(L, "Cancel"), send: "Cancel" }], ready: true } };
}

export function summary(d: Draft): string[] {
  const L = d.lang;
  const lines = [tr(L, "Here is what I'll do:")];
  const reg = d.region ? tr(L, " (region: {region})", { region: d.region }) : "";
  if (d.operator.kind === "new") lines.push(tr(L, "• Create operator “{text}”{reg}", { text: d.operatorText, reg }));
  else if (d.operator.kind === "alias_of") lines.push(tr(L, "• Use operator {name} and remember “{text}” as another name", { name: d.operator.name, text: d.operatorText }));
  else if (d.operator.kind === "existing") lines.push(d.region ? tr(L, "• Operator: {name}, set region to {region}", { name: d.operator.name, region: d.region }) : tr(L, "• Operator: {name}", { name: d.operator.name }));
  if (d.aircraft.kind === "new") lines.push(tr(L, "• Create aircraft {what}{type}{distinct}", { what: d.tail || tr(L, "without a tail number yet"), type: d.typeLabel ? ` (${d.typeLabel})` : "", distinct: d.aircraft.distinct && d.tail ? tr(L, " as a different aircraft from the existing one") : "" }));
  else if (d.aircraft.kind === "existing") lines.push(tr(L, "• Use the existing aircraft {label}, and update the details you gave", { label: d.aircraft.label }));
  else if (d.typeLabel) lines.push(tr(L, "• No tail number: photos will represent the {label} type", { label: d.typeLabel }));
  const facts = [
    d.yom && tr(L, "YOM {n}", { n: d.yom }),
    d.yor && tr(L, "YOR {n}", { n: d.yor }),
    d.capacity && tr(L, "{n} seats", { n: d.capacity }),
    d.wifi !== "unknown" && tr(L, "WIFI {status}", { status: `${trWifi(L, d.wifi)}${d.wifiDetail ? `, ${d.wifiDetail}` : ""}` }),
    d.notes && tr(L, "notes “{text}”", { text: d.notes }),
  ].filter(Boolean);
  if (facts.length && d.aircraft.kind === "new") lines.push(tr(L, "• Details: {facts}", { facts: facts.join(", ") }));
  else if (facts.length && d.aircraft.kind === "existing") lines.push(tr(L, "• Details to save on it: {facts} (anything you didn't mention stays as it is)", { facts: facts.join(", ") }));
  if (d.photos.length && d.aircraft.kind !== "existing" && d.aircraft.kind !== "new" && !d.typeId) lines.push(tr(L, "• These photos have no aircraft or type to attach to, so they stay in Review"));
  if (d.photos.length) lines.push(tr(L, "• Approve {n} photo{s}: {list}", { n: d.photos.length, s: plural(d.photos.length), list: d.photos.map((p) => `${p.name} (${trClassification(L, p.classification, CLASSIFICATION_LABEL[p.classification])})`).join(", ") }));
  return lines;
}
