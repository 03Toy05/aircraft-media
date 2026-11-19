"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Icon from "./Icon";
import TextBox, { Styled } from "./TextBox";
import MessengerButtons from "./MessengerButtons";
import { copyText, openAfterCopy, shareText } from "./copyText";
import { registerCommands, type CommandResult } from "./voice";
import { togglePreferredOperator } from "../actions";
import { contactApp, contactLink } from "@/domain/messengers";
import { QUOTE_LANGUAGES, QUOTE_WORDS, buildQuoteParts, type QuoteLanguage, type QuoteTemplate } from "@/domain/quote";
import { forOtherApps, parseStyled, readsMarkers } from "@/domain/textStyle";
import { parseQuoteCommands, type QuoteCommand } from "@/domain/quoteCommands";
import type { WifiStatus } from "@/domain/constants";
import type { ShareItem } from "./ShareBox";

export interface QuoteAircraftOption {
  id: string;
  operatorId: string | null;
  type: string;
  tail: string | null;
  operator: string | null;
  base: string | null;
  yom: number | null;
  yor: number | null;
  capacity: number | null;
  wifi: WifiStatus;
  wifiDetail: string | null;
  notes: string | null;
  photos: ShareItem[];
}
export interface QuoteOperator { id: string; name: string; region: string | null; addedAt: string; count: number }
export interface QuoteContact { id: string; name: string; app: string; handle: string | null }
export type SavedTemplates = Partial<Record<QuoteLanguage, Partial<QuoteTemplate>>>;

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const SPEECH: Partial<Record<QuoteLanguage, string>> = { en: "en-US", "zh-Hant": "zh-HK", "zh-Hans": "zh-CN", ja: "ja-JP", ko: "ko-KR", vi: "vi-VN", th: "th-TH", id: "id-ID", fr: "fr-FR", de: "de-DE", ru: "ru-RU", ar: "ar-SA" };
type Sort = "name" | "aircraft" | "recent";

/**
 * Find the operator (preferred ones first, then recently added, or search, filter and sort them all), tick the
 * aircraft, then edit the message: an opening line, one block per aircraft (with its price and an extra line) and a
 * closing line. Every box has Bold / Italic / Underline and a microphone. The Ask Chocks microphone runs spoken
 * commands on this page ("add the G280, Chinese, price 40,000").
 */
export default function QuoteBuilder({ aircraft, operators, preferred: preferredInitial, contacts, initialIds, templates }: {
  aircraft: QuoteAircraftOption[]; operators: QuoteOperator[]; preferred: string[]; contacts: QuoteContact[]; initialIds: string[]; templates: SavedTemplates;
}) {
  const [ids, setIds] = useState<string[]>(initialIds);
  const [lang, setLang] = useState<QuoteLanguage>("en");
  const [inc, setInc] = useState({ operator: false, tail: false, base: false, notes: false, greeting: true, closing: true });
  // Typed for this quote, per aircraft. They are values, not text, so they survive changing the details or the language.
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [extras, setExtras] = useState<Record<string, string>>({});
  const [edits, setEdits] = useState<Record<string, string>>({}); // "greeting" | "closing" | "block:<aircraftId>" -> the broker's own text
  const [classes, setClasses] = useState<Set<string> | null>(null); // null = every kind of photo
  const [contactId, setContactId] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [styleFor, setStyleFor] = useState<"whatsapp" | "other">("whatsapp");

  // -- finding the operator
  const [preferred, setPreferred] = useState<string[]>(preferredInitial);
  const [opId, setOpId] = useState<string>(() => {
    const ops = [...new Set(initialIds.map((id) => aircraft.find((a) => a.id === id)?.operatorId).filter(Boolean))];
    return ops.length === 1 ? (ops[0] as string) : "";
  });
  const [search, setSearch] = useState("");
  const [region, setRegion] = useState("");
  const [sort, setSort] = useState<Sort>("name");
  const [withAircraft, setWithAircraft] = useState(true);
  const [starMsg, setStarMsg] = useState<string | null>(null);
  const shareBtn = useRef<HTMLButtonElement>(null);
  const messageRef = useRef<HTMLDivElement>(null);
  // Steps fold to a one-line summary. Steps 1 and 2 start folded when Chocks already chose the aircraft.
  const [steps, setSteps] = useState({ op: initialIds.length === 0, ac: true, lang: false });

  const opById = useMemo(() => new Map(operators.map((o) => [o.id, o])), [operators]);
  const preferredOps = preferred.map((id) => opById.get(id)).filter((o): o is QuoteOperator => !!o);
  const recentOps = [...operators].filter((o) => !preferred.includes(o.id) && o.count > 0).sort((a, b) => b.addedAt.localeCompare(a.addedAt)).slice(0, 5);
  const regions = [...new Set(operators.map((o) => o.region).filter((r): r is string => !!r))].sort();
  const q = search.trim().toLowerCase();
  const browse = operators
    .filter((o) => (!withAircraft || o.count > 0) && (!region || o.region === region) && (!q || o.name.toLowerCase().includes(q)))
    .sort((a, b) => sort === "aircraft" ? b.count - a.count || a.name.localeCompare(b.name) : sort === "recent" ? b.addedAt.localeCompare(a.addedAt) : a.name.localeCompare(b.name));
  const rank = (a: QuoteAircraftOption) => { const i = a.operatorId ? preferred.indexOf(a.operatorId) : -1; return i < 0 ? 99 : i; };
  const shown = aircraft
    .filter((a) => (!opId || a.operatorId === opId) && (!q || `${a.type} ${a.tail ?? ""} ${a.operator ?? ""}`.toLowerCase().includes(q)))
    .sort((a, b) => rank(a) - rank(b) || (a.operator ?? "~").localeCompare(b.operator ?? "~") || a.type.localeCompare(b.type));
  const opChosen = (id: string) => ids.some((x) => aircraft.find((a) => a.id === x)?.operatorId === id);
  const pickOp = (id: string) => setOpId((cur) => (cur === id ? "" : id));

  async function star(id: string) {
    setStarMsg(null);
    const r = await togglePreferredOperator(id);
    setPreferred(r.ids);
    if (r.error) setStarMsg(r.error);
  }

  // -- the message
  const chosen = useMemo(() => ids.map((id) => aircraft.find((a) => a.id === id)).filter((a): a is QuoteAircraftOption => !!a), [ids, aircraft]);
  const parts = useMemo(
    () => buildQuoteParts(
      chosen.map((a) => ({ ...a, price: prices[a.id] ?? "", extra: extras[a.id] ?? "" })),
      { language: lang, template: templates[lang] ?? null, includeOperator: inc.operator, includeTail: inc.tail, includeBase: inc.base, includeNotes: inc.notes, greeting: inc.greeting, closing: inc.closing },
    ),
    [chosen, lang, inc, templates, prices, extras],
  );
  const greeting = parts.greeting === null ? null : edits.greeting ?? parts.greeting;
  const closing = parts.closing === null ? null : edits.closing ?? parts.closing;
  const blocks = chosen.map((a, i) => edits[`block:${a.id}`] ?? parts.blocks[i]);
  const text = [greeting, ...blocks, closing].filter((x): x is string => !!x && x.trim() !== "").join("\n\n");
  const styled = parseStyled(text).some((s) => s.bold || s.italic || s.strike || s.underline);
  /** The message as the chosen app needs it: WhatsApp reads *bold* and _italic_; other apps get Unicode letters. */
  const textFor = (mode: "whatsapp" | "other") => (mode === "whatsapp" ? text : forOtherApps(text));
  const anyEdits = Object.keys(edits).length > 0;
  const editedBlocks = chosen.some((a) => `block:${a.id}` in edits);

  const setEdit = (k: string, v: string) => setEdits((cur) => ({ ...cur, [k]: v }));
  const resetEdit = (k: string) => setEdits((cur) => { const n = { ...cur }; delete n[k]; return n; });
  const toggle = (id: string) => setIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const move = (id: string, d: -1 | 1) => setIds((cur) => { const i = cur.indexOf(id); const j = i + d; if (i < 0 || j < 0 || j >= cur.length) return cur; const n = [...cur]; [n[i], n[j]] = [n[j], n[i]]; return n; });

  const changeLang = (l: QuoteLanguage, ask = true) => {
    // Prices and extra lines are kept. Only text rewritten by hand is in the old language, so only that is lost.
    if (ask && anyEdits && !window.confirm("Your prices and extra lines are kept. Text you rewrote by hand is in the old language and will be replaced. Continue?")) return;
    setEdits({});
    setLang(l);
  };

  const allClasses = useMemo(() => [...new Map(chosen.flatMap((a) => a.photos).map((p) => [p.classification, p.classificationLabel])).entries()], [chosen]);
  const useClass = (c: string) => !classes || classes.has(c);
  const toggleClass = (c: string) => setClasses((cur) => { const n = new Set(cur ?? allClasses.map(([k]) => k)); if (n.has(c)) n.delete(c); else n.add(c); return n; });
  const photos = chosen.flatMap((a, i) => a.photos.filter((p) => useClass(p.classification)).map((p) => ({ a, i, p })));
  const dir = lang === "ar" ? "rtl" : "ltr";
  const speech = SPEECH[lang];

  async function copy(mode = styleFor) {
    const ok = await copyText(textFor(mode));
    setMsg(ok ? "Message copied. Paste it into your chat or email, then share the photos." : "Could not copy automatically. Select the message and copy it.");
    return ok;
  }

  async function sharePhotos() {
    setBusy(true); setMsg(null);
    try {
      const files = await Promise.all(photos.map(async ({ a, i, p }) => {
        const res = await fetch(p.url);
        if (!res.ok) throw new Error("A photo could not be loaded");
        const blob = await res.blob();
        return new File([blob], `Aircraft ${i + 1} - ${a.type} - ${p.label}${p.representative ? " (representative)" : ""}.${EXT[p.mimeType] ?? "jpg"}`, { type: p.mimeType });
      }));
      if (!navigator.canShare || !navigator.canShare({ files })) { setMsg("This browser cannot share photos directly. Open this page on your phone, or save the photos from each aircraft page."); return; }
      // One send: photos and message together (WhatsApp shows the photos first, then the message).
      await navigator.share({ files, text: textFor(styleFor) });
      setMsg("Shared. If the message text did not come through, paste it from Copy message.");
    } catch (e) {
      if ((e as Error).name !== "AbortError") setMsg((e as Error).message || "Sharing failed");
    } finally { setBusy(false); }
  }

  async function open(appId: string, handle: string | null, label: string) {
    const t = textFor(readsMarkers(appId) ? "whatsapp" : "other");
    const link = contactLink(appId, handle, t);
    if (link.copyFirst) {
      // Apps that cannot take text from a link: the phone's share sheet passes the message straight in.
      const r = await shareText(t);
      if (r === "shared") { setMsg(`Message sent to the share sheet. If ${label} did not open, pick it there. Then share the photos.`); return; }
      if (r === "cancelled") { setMsg(null); return; }
      if (!(await copyText(t))) { setMsg(`Could not copy the message automatically. Select it and copy it, then open ${label}.`); return; }
      setMsg(`Message copied. Opening ${label}. Paste it into the chat (long-press, Paste), then share the photos.`);
      openAfterCopy(link.url, link.newTab);
      return;
    }
    setMsg(`${label} opened with the message ready. Press Send there, then share the photos.`);
    if (link.newTab) window.open(link.url, "_blank"); else window.location.href = link.url;
  }

  const email = () => { window.location.href = `mailto:?subject=${encodeURIComponent(QUOTE_WORDS[lang].aircraft)}&body=${encodeURIComponent(textFor("other"))}`; setMsg("Email opened with the message. Attach the photos from Share photos, or paste them in."); };
  const contact = contacts.find((c) => c.id === contactId);
  const rows = (v: string) => Math.max(2, v.split("\n").length);

  // -- spoken commands (the Ask Chocks microphone on this page)
  const live = useRef({ aircraft, ids, operators, handEdits: anyEdits });
  live.current = { aircraft, ids, operators, handEdits: anyEdits };
  const actions = useRef({ copy, sharePhotos, open, email });
  actions.current = { copy, sharePhotos, open, email };
  useEffect(() => registerCommands((said): CommandResult | null => {
    const { aircraft: list, ids: cur, operators: ops } = live.current;
    const r = parseQuoteCommands(said, list, cur);
    if (r.commands.length === 0) return { said: [], passOn: said };
    const out: string[] = [];
    let followUp: CommandResult["followUp"];
    const name = (id: string | null) => { const a = list.find((x) => x.id === id); return a ? `${a.type}${a.operator ? ` (${a.operator})` : ""}` : "the aircraft"; };
    for (const c of r.commands as QuoteCommand[]) {
      switch (c.do) {
        case "add": setIds((x) => [...x, ...c.ids.filter((id) => !x.includes(id))]); out.push(`Added ${c.ids.map(name).join(", ")}.`); break;
        case "remove": setIds((x) => x.filter((id) => !c.ids.includes(id))); out.push(`Removed ${c.ids.map(name).join(", ")}.`); break;
        case "clear": setIds([]); out.push("Cleared the aircraft."); break;
        case "findOperator": {
          const hit = ops.filter((o) => o.name.toLowerCase().includes(c.text.toLowerCase()));
          if (hit.length === 1) { setOpId(hit[0].id); setSearch(""); out.push(`Showing ${hit[0].name}.`); }
          else { setOpId(""); setSearch(c.text); out.push(`Searching for “${c.text}”.`); }
          break;
        }
        case "lang":
          if (live.current.handEdits && !window.confirm("Your prices and extra lines are kept. Text you rewrote by hand is in the old language and will be replaced. Continue?")) { out.push("Kept the language as it is."); break; }
          changeLang(c.lang, false); out.push(`Language: ${QUOTE_WORDS[c.lang].name}.`); break;
        case "price": if (c.id) { setPrices((p) => ({ ...p, [c.id!]: c.value })); out.push(`Price for ${name(c.id)}: ${c.value}.`); } else out.push("Add an aircraft first, then say the price."); break;
        case "extra": if (c.id) { setExtras((p) => ({ ...p, [c.id!]: c.value })); out.push(`Extra line for ${name(c.id)}: ${c.value}.`); } else out.push("Add an aircraft first."); break;
        case "show": setInc((v) => ({ ...v, [c.what]: c.on })); out.push(`${c.on ? "Showing" : "Hiding"} the ${c.what === "greeting" ? "opening line" : c.what === "closing" ? "closing line" : c.what}.`); break;
        // Copying and sharing need a tap on the phone, so Chocks offers the button.
        case "copy": followUp = { label: "Copy message", run: () => actions.current.copy() }; break;
        case "share": followUp = { label: "Share photos + message", run: () => { actions.current.sharePhotos(); } }; shareBtn.current?.scrollIntoView({ block: "center" }); break;
        case "send": {
          const label = c.app === "email" ? "Email" : contactApp(c.app)?.label ?? c.app;
          followUp = { label: `Open ${label}`, run: () => (c.app === "email" ? actions.current.email() : actions.current.open(c.app, null, label)) };
          break;
        }
      }
    }
    if (r.unknown.length) out.push(`I didn't catch: “${r.unknown.join("”, “")}”.`);
    return { said: out, followUp };
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  const opChip = (o: QuoteOperator, starred: boolean) => (
    <button key={o.id} type="button" className={`chip${opId === o.id ? " on" : ""}`} aria-pressed={opId === o.id} onClick={() => pickOp(o.id)}>
      {starred && "★ "}{o.name} ({o.count}){opChosen(o.id) && <span aria-label="has chosen aircraft"> ✓</span>}
    </button>
  );

  const stepProps = (k: keyof typeof steps) => ({
    open: steps[k],
    onToggle: (e: React.SyntheticEvent<HTMLDetailsElement>) => { const o = e.currentTarget.open; setSteps((s) => (s[k] === o ? s : { ...s, [k]: o })); },
  });
  const toMessage = () => {
    setSteps({ op: false, ac: false, lang: false });
    setTimeout(() => messageRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };
  const shownToggles: [keyof typeof inc, string][] = [["operator", "Operator"], ["tail", "Tail"], ["base", "Base"], ["notes", "Notes"]];

  return (
    <div className="grid g2" style={{ alignItems: "start" }}>
      <div>
        <details className="card step" {...stepProps("op")}>
          <summary><h3>1. Operator</h3><span className="sum">{opId ? opById.get(opId)?.name : "All operators"}</span></summary>
          <TextBox single styles={false} value={search} onChange={setSearch} placeholder="Search operator, type or tail" ariaLabel="Search operators and aircraft" />
          {preferredOps.length > 0 && (
            <>
              <div className="group-title">Preferred</div>
              <div className="chips">{preferredOps.map((o) => opChip(o, true))}</div>
            </>
          )}
          {recentOps.length > 0 && (
            <>
              <div className="group-title">Recently added</div>
              <div className="chips">{recentOps.map((o) => opChip(o, false))}</div>
            </>
          )}
          {opId && <p className="small" style={{ margin: "8px 0 0" }}>Showing {opById.get(opId)?.name}. <button type="button" className="linklike" onClick={() => setOpId("")}>Show all operators</button></p>}
          <details className="collapse" style={{ marginTop: 10 }} open={q.length > 0 || undefined}>
            <summary className="small">All operators ({browse.length}) · search, filter, sort</summary>
            <div className="group">
              {regions.length > 0 && (
                <label className="group-row">Region
                  <select value={region} onChange={(e) => setRegion(e.target.value)}>
                    <option value="">All regions</option>
                    {regions.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </label>
              )}
              <label className="group-row">Sort
                <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                  <option value="name">Name A–Z</option>
                  <option value="aircraft">Most aircraft</option>
                  <option value="recent">Recently added</option>
                </select>
              </label>
              <label className="group-row">Only operators with aircraft
                <input type="checkbox" className="switch" checked={withAircraft} onChange={(e) => setWithAircraft(e.target.checked)} />
              </label>
            </div>
            <div className="op-list">
              {browse.length === 0 && <p className="muted small">No operators match.</p>}
              {browse.slice(0, 60).map((o) => (
                <div key={o.id} className={`op-row${opId === o.id ? " on" : ""}`}>
                  <button type="button" className="star" onClick={() => star(o.id)} aria-pressed={preferred.includes(o.id)} aria-label={preferred.includes(o.id) ? `Remove ${o.name} from preferred` : `Add ${o.name} to preferred`} title="Preferred">{preferred.includes(o.id) ? "★" : "☆"}</button>
                  <button type="button" className="op-name" onClick={() => pickOp(o.id)}>
                    <span>{o.name}{o.region ? <span className="muted small"> · {o.region}</span> : null}</span>
                    <span className="muted small">{o.count} aircraft{opChosen(o.id) ? " ✓" : ""}</span>
                  </button>
                </div>
              ))}
              {browse.length > 60 && <p className="muted small">Showing 60 of {browse.length}. Search or filter to narrow it down.</p>}
            </div>
            {starMsg && <p className="small" style={{ color: "var(--warn)" }}>{starMsg}</p>}
            <p className="small muted" style={{ margin: "6px 0 0" }}>Tap ☆ to make an operator preferred (up to 5), or set them in <Link href="/settings#preferred">Settings</Link>.</p>
          </details>
        </details>

        <details className="card step" {...stepProps("ac")}>
          <summary><h3>2. Aircraft{opId ? ` · ${opById.get(opId)?.name ?? ""}` : ""}</h3><span className="sum">{ids.length ? `${ids.length} chosen` : "None chosen"}</span></summary>
          <div className="ac-pick">
            {aircraft.length === 0 && <p className="muted small">No aircraft yet.</p>}
            {shown.length === 0 && aircraft.length > 0 && <p className="muted small">No aircraft match.</p>}
            {shown.map((a) => {
              const on = ids.includes(a.id);
              const facts = [
                a.yom ? `YOM ${a.yom}` : null,
                a.yor ? `YOR ${a.yor}` : null,
                a.capacity ? `${a.capacity} seats` : null,
                a.wifi === "yes" ? `WIFI${a.wifiDetail ? ` (${a.wifiDetail})` : ""}` : a.wifi === "no" ? "No WIFI" : null,
              ].filter(Boolean).join(" · ");
              return (
                <label key={a.id} className={`ac-card${on ? " on" : ""}`}>
                  <input type="checkbox" checked={on} onChange={() => toggle(a.id)} />
                  <span>
                    <b>{a.type}</b>{!opId && <> · {a.operator ?? "No operator"}</>}
                    <span className="small muted" style={{ display: "block" }}>
                      {[a.tail ?? "no tail yet", a.base].filter(Boolean).join(" · ")}{facts ? ` · ${facts}` : ""} · {a.photos.length} photo{a.photos.length === 1 ? "" : "s"}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
          <div className="row" style={{ margin: "6px 0 0" }}>
            <div style={{ flex: "0 0 auto" }}><button type="button" className="secondary" onClick={() => setIds((cur) => [...cur, ...shown.map((a) => a.id).filter((id) => !cur.includes(id))])} disabled={shown.length === 0}>Select all shown ({shown.length})</button></div>
            <div style={{ flex: "0 0 auto" }}><button type="button" className="secondary" onClick={() => setIds([])} disabled={ids.length === 0}>Clear ({ids.length})</button></div>
          </div>
          {opId && <p className="small muted" style={{ margin: "6px 0 0" }}>To add another operator&apos;s aircraft, pick it above. Aircraft you ticked stay chosen.</p>}
          {chosen.length > 1 && (
            <>
              <div className="group-title">Order in the message</div>
              <div className="group">
                {chosen.map((a, i) => (
                  <div key={a.id} className="group-row">
                    <span className="small">{i + 1}. {a.type}{a.operator ? ` · ${a.operator}` : ""}</span>
                    <span style={{ display: "flex", gap: 4 }}>
                      <button type="button" className="secondary small-btn" onClick={() => move(a.id, -1)} disabled={i === 0} aria-label="Move up">↑</button>
                      <button type="button" className="secondary small-btn" onClick={() => move(a.id, 1)} disabled={i === chosen.length - 1} aria-label="Move down">↓</button>
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </details>

        <details className="card step" {...stepProps("lang")}>
          <summary><h3>3. Language and details</h3><span className="sum">{QUOTE_WORDS[lang].name}</span></summary>
          <div className="group-title">Message</div>
          <div className="group">
            <label className="group-row">Language
              <select value={lang} onChange={(e) => changeLang(e.target.value as QuoteLanguage)}>
                {QUOTE_LANGUAGES.map((l) => <option key={l} value={l}>{QUOTE_WORDS[l].name}{templates[l] ? " ●" : ""}</option>)}
              </select>
            </label>
            <label className="group-row">Opening line<input type="checkbox" className="switch" checked={inc.greeting} onChange={(e) => setInc({ ...inc, greeting: e.target.checked })} /></label>
            <label className="group-row">Closing line<input type="checkbox" className="switch" checked={inc.closing} onChange={(e) => setInc({ ...inc, closing: e.target.checked })} /></label>
          </div>
          <div className="group-title">Show in each aircraft</div>
          <div className="chips">
            {shownToggles.map(([k, label]) => (
              <button key={k} type="button" className={`chip small${inc[k] ? " on" : ""}`} aria-pressed={!!inc[k]} onClick={() => setInc({ ...inc, [k]: !inc[k] })}>{inc[k] ? "✓ " : ""}{label}</button>
            ))}
          </div>
          <p className="small muted" style={{ margin: "8px 0 0" }}>
            Wording: {templates[lang] ? "your own" : "standard"}. <Link href={`/quote/template?lang=${lang}`}>Edit the wording →</Link> Aircraft names, tail numbers and notes are never translated.
          </p>
          {editedBlocks && <p className="small muted">An aircraft you rewrote by hand keeps your text when you change these. Press “Back to automatic” on it to follow them again.</p>}
        </details>

        {ids.length > 0 && (
          <div className="quote-bar">
            <span className="small"><b>{ids.length}</b> aircraft · {photos.length} photo{photos.length === 1 ? "" : "s"}</span>
            <button type="button" onClick={toMessage}>Edit message ↓</button>
          </div>
        )}
      </div>

      <div className="quote-right">
        <div className="card" ref={messageRef} style={{ scrollMarginTop: 60 }}>
          <h3>4. Check and edit the message</h3>
          {chosen.length === 0 && <p className="muted">Choose at least one aircraft first.</p>}
          {greeting !== null && chosen.length > 0 && (
            <Piece label="Opening line" edited={"greeting" in edits} onReset={() => resetEdit("greeting")}>
              <TextBox dir={dir} speechLang={speech} rows={rows(greeting)} value={greeting} onChange={(v) => setEdit("greeting", v)} ariaLabel="Opening line" />
            </Piece>
          )}
          {chosen.map((a, i) => {
            const k = `block:${a.id}`;
            const byHand = k in edits;
            return (
              <div key={a.id} className="quote-ac">
                <div className="quote-ac-head">
                  <b>{i + 1}. {a.type}{a.operator ? <span className="muted small"> · {a.operator}</span> : null}</b>
                  {byHand
                    ? <button type="button" className="secondary small-btn" onClick={() => resetEdit(k)}>Back to automatic</button>
                    : <button type="button" className="secondary small-btn" onClick={() => setEdit(k, blocks[i])}>Rewrite by hand</button>}
                </div>
                {byHand
                  ? <TextBox dir={dir} speechLang={speech} rows={rows(blocks[i])} value={blocks[i]} onChange={(v) => setEdit(k, v)} ariaLabel={`Aircraft ${i + 1}`} />
                  : <pre className="cardtext" dir={dir} style={{ margin: "6px 0" }}><Styled text={blocks[i]} /></pre>}
                {byHand
                  ? <p className="small muted" style={{ margin: "4px 0 0" }}>Rewritten by hand: changes to the details, price or language no longer reach this aircraft.</p>
                  : (
                    <div className="group">
                      <div className="group-row field"><span>Price</span>
                        <TextBox single dir={dir} speechLang={speech} value={prices[a.id] ?? ""} onChange={(v) => setPrices((p) => ({ ...p, [a.id]: v }))} placeholder="USD 85,000 + tax" ariaLabel="Price" />
                      </div>
                      <div className="group-row field"><span>Extra line</span>
                        <TextBox dir={dir} speechLang={speech} rows={1} value={extras[a.id] ?? ""} onChange={(v) => setExtras((p) => ({ ...p, [a.id]: v }))} placeholder="From 12 Dec" ariaLabel="Extra line" />
                      </div>
                    </div>
                  )}
              </div>
            );
          })}
          {closing !== null && chosen.length > 0 && (
            <Piece label="Closing line" edited={"closing" in edits} onReset={() => resetEdit("closing")}>
              <TextBox dir={dir} speechLang={speech} rows={rows(closing)} value={closing} onChange={(v) => setEdit("closing", v)} ariaLabel="Closing line" />
            </Piece>
          )}
          {chosen.length > 0 && <p className="small muted">Tap a box for Bold, Italic, Underline and the microphone. Prices and extra lines stay when you change the details or the language.</p>}
          {styled && (
            <details className="collapse" open>
              <summary className="small">Preview</summary>
              <pre className="cardtext" dir={dir}><Styled text={text} /></pre>
            </details>
          )}
          <div className="row" style={{ marginTop: 8 }}>
            <div style={{ flex: "0 0 auto" }}><button type="button" className="secondary" onClick={() => copy()} disabled={!text.trim()}><Icon name="copy" />Copy message</button></div>
            {anyEdits && <div style={{ flex: "0 0 auto" }}><button type="button" className="secondary" onClick={() => setEdits({})}>Reset all edits</button></div>}
          </div>
        </div>

        <div className="card">
          <h3>5. Send</h3>
          {allClasses.length > 0 && (
            <>
              <div className="group-title">Photos to include ({photos.length})</div>
              <div className="chips" style={{ marginBottom: 10 }}>
                {allClasses.map(([c, label]) => (
                  <button key={c} type="button" className={`chip small${useClass(c) ? " on" : ""}`} aria-pressed={useClass(c)} onClick={() => toggleClass(c)}>{useClass(c) ? "✓ " : ""}{label}</button>
                ))}
              </div>
            </>
          )}
          <button ref={shareBtn} type="button" className="block-btn" onClick={sharePhotos} disabled={busy || photos.length === 0}><Icon name="share" />{busy ? "Preparing…" : `Share ${photos.length} photo${photos.length === 1 ? "" : "s"} + message`}</button>
          <p className="small muted" style={{ margin: "6px 0 0" }}>Opens your phone&apos;s share sheet with the photos and the message together. Choose the app, then the client.</p>
          {styled && (
            <div className="group" style={{ marginTop: 10 }}>
              <label className="group-row">Bold and italics for
                <select value={styleFor} onChange={(e) => setStyleFor(e.target.value as "whatsapp" | "other")}>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="other">Other apps</option>
                </select>
              </label>
            </div>
          )}
          <details className="collapse" style={{ marginTop: 12 }}>
            <summary className="small">More ways to send (message only)</summary>
            {contacts.length > 0 && (
              <div className="row" style={{ alignItems: "end", marginBottom: 10 }}>
                <div><label>To a saved contact</label>
                  <select value={contactId} onChange={(e) => setContactId(e.target.value)}>
                    <option value="">Choose…</option>
                    {contacts.map((c) => <option key={c.id} value={c.id}>{c.name} ({contactApp(c.app)?.label ?? c.app})</option>)}
                  </select></div>
                <div style={{ flex: "0 0 auto" }}><button type="button" className="secondary" disabled={!contact || !text.trim()} onClick={() => contact && open(contact.app, contact.handle, contactApp(contact.app)?.label ?? contact.app)}><Icon name="send" />Send</button></div>
              </div>
            )}
            <MessengerButtons disabled={!text.trim()} onPick={(id, label) => open(id, null, label)} onEmail={email} />
          </details>
          {msg && <p className="small" role="status">{msg}</p>}
        </div>
      </div>
    </div>
  );
}

function Piece({ label, edited, onReset, children }: { label: string; edited: boolean; onReset: () => void; children: ReactNode }) {
  return (
    <div className="piece">
      <div className="piece-head">
        <label style={{ margin: 0 }}>{label}{edited && <span className="muted small"> · edited</span>}</label>
        {edited && <button type="button" className="secondary small-btn" onClick={onReset}>Reset</button>}
      </div>
      {children}
    </div>
  );
}
