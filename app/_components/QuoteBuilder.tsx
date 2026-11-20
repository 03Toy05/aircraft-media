"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Icon from "./Icon";
import TextBox, { Styled } from "./TextBox";
import { copyText, fetchPhoto } from "./copyText";
import { registerCommands, type CommandResult } from "./voice";
import { recordQuoteShareAction, togglePreferredOperator } from "../actions";
import { QUOTE_LANGUAGES, QUOTE_WORDS, buildQuoteParts, renumberBlock, type QuoteLanguage, type QuoteTemplate } from "@/domain/quote";
import { forOtherApps, parseStyled } from "@/domain/textStyle";
import { parseQuoteCommands, type QuoteCommand } from "@/domain/quoteCommands";
import { COMBINED_NEEDS, type WifiStatus, type YesNoStatus } from "@/domain/constants";
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
  smoking: YesNoStatus;
  pets: YesNoStatus;
  cleaningFee: string | null;
  notes: string | null;
  photos: ShareItem[];
}
export interface QuoteOperator { id: string; name: string; region: string | null; addedAt: string; count: number }
export type SavedTemplates = Partial<Record<QuoteLanguage, Partial<QuoteTemplate>>>;

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
/** Which app the quote goes through. WhatsApp reads *bold*; WeChat takes photos and text in separate sends. */
type SendApp = "whatsapp" | "wechat" | "other";
const SEND_APPS: [SendApp, string][] = [["whatsapp", "WhatsApp"], ["wechat", "WeChat"], ["other", "Other apps"]];
/** The quote being written, kept on this device so leaving the page does not lose it. */
const DRAFT = "quoteDraft";
const DRAFT_DAYS = 14;
interface Draft {
  savedAt: number; ids: string[]; lang: QuoteLanguage; inc: Record<string, boolean>; prices: Record<string, string>;
  extras: Record<string, string>; edits: Record<string, string>; flip: string[]; app: SendApp; opId: string;
  /** Set at the first share, so sharing the same quote again (or option by option) counts once. */
  quoteKey?: string;
}
const SPEECH: Partial<Record<QuoteLanguage, string>> = { en: "en-US", "zh-Hant": "zh-HK", "zh-Hans": "zh-CN", ja: "ja-JP", ko: "ko-KR", vi: "vi-VN", th: "th-TH", id: "id-ID", fr: "fr-FR", de: "de-DE", ru: "ru-RU", ar: "ar-SA" };
type Sort = "name" | "aircraft" | "recent";

/**
 * Find the operator (preferred ones first, then recently added, or search, filter and sort them all), tick the
 * aircraft, then edit the message: an opening line, one block per aircraft (with its price and an extra line) and a
 * closing line. Every box has Bold / Italic / Underline and a microphone. The Ask Chocks microphone runs spoken
 * commands on this page ("add the G280, Chinese, price 40,000").
 */
export default function QuoteBuilder({ aircraft, operators, preferred: preferredInitial, initialIds, initialPrices, initialKinds, templates }: {
  aircraft: QuoteAircraftOption[]; operators: QuoteOperator[]; preferred: string[]; initialIds: string[]; templates: SavedTemplates;
  /** From Chocks: prices per aircraft, and the photo kinds asked for ([] = no photos). */
  initialPrices?: Record<string, string>; initialKinds?: string[];
}) {
  const [ids, setIds] = useState<string[]>(initialIds);
  const [lang, setLang] = useState<QuoteLanguage>("en");
  const [inc, setInc] = useState({ operator: false, tail: false, base: false, notes: false, greeting: true, closing: true });
  // Typed for this quote, per aircraft. They are values, not text, so they survive changing the details or the language.
  const [prices, setPrices] = useState<Record<string, string>>(initialPrices ?? {});
  const [extras, setExtras] = useState<Record<string, string>>({});
  const [edits, setEdits] = useState<Record<string, string>>({}); // "greeting" | "closing" | "block:<aircraftId>" -> the broker's own text
  // Photos ("<aircraftId>|<photo url>") ticked or unticked by hand, against their default (singles on, combined off).
  // Chocks may ask for some kinds only; an aircraft without the combined photo asked for sends its single photos.
  const [flip, setFlip] = useState<Set<string>>(() => {
    const n = new Set<string>();
    if (!initialKinds) return n;
    for (const id of initialIds) {
      const a = aircraft.find((x) => x.id === id);
      if (!a) continue;
      const hasAsked = a.photos.some((p) => initialKinds.includes(p.classification));
      const singlesInstead = !hasAsked && initialKinds.length === 1 && initialKinds[0] === "combined";
      for (const p of a.photos) {
        const want = singlesInstead ? p.classification !== "combined" : initialKinds.includes(p.classification);
        if (want !== (p.classification !== "combined")) n.add(`${a.id}|${p.url}`);
      }
    }
    return n;
  });
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [app, setApp] = useState<SendApp>("whatsapp");
  const styleFor: "whatsapp" | "other" = app === "whatsapp" ? "whatsapp" : "other";

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

  // -- the draft: brought back when the page opens without aircraft chosen elsewhere, saved on every change
  const [loaded, setLoaded] = useState(false);
  const [restored, setRestored] = useState(false);
  const [quoteKey, setQuoteKey] = useState("");
  useEffect(() => {
    try {
      const d = JSON.parse(localStorage.getItem(DRAFT) ?? "null") as Draft | null;
      const known = d ? d.ids.filter((id) => aircraft.some((a) => a.id === id)) : [];
      if (d && initialIds.length === 0 && Date.now() - d.savedAt < DRAFT_DAYS * 864e5 && (known.length || Object.keys(d.edits).length)) {
        setIds(known); setLang(d.lang); setInc((cur) => ({ ...cur, ...d.inc })); setPrices(d.prices); setExtras(d.extras);
        setEdits(d.edits); setFlip(new Set(d.flip)); setApp(d.app); setOpId(d.opId); setQuoteKey(d.quoteKey ?? "");
        if (known.length) setSteps({ op: false, ac: true, lang: false });
        setRestored(true);
      }
    } catch { /* no storage: the page starts empty */ }
    setLoaded(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!loaded) return;
    try {
      const d: Draft = { savedAt: Date.now(), ids, lang, inc, prices, extras, edits, flip: [...flip], app, opId, quoteKey };
      localStorage.setItem(DRAFT, JSON.stringify(d));
    } catch { /* storage full or blocked */ }
  }, [loaded, ids, lang, inc, prices, extras, edits, flip, app, opId, quoteKey]);
  const startOver = () => {
    if (!window.confirm("Clear this quote and start a new one?")) return;
    try { localStorage.removeItem(DRAFT); } catch { /* ignore */ }
    setIds([]); setPrices({}); setExtras({}); setEdits({}); setFlip(new Set()); setOpId(""); setRestored(false); setMsg(null); setQuoteKey("");
    setSteps({ op: true, ac: true, lang: false });
  };

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
  // A block rewritten by hand keeps the broker's words; only its "Aircraft N" label follows the current order.
  const blocks = chosen.map((a, i) => {
    const own = edits[`block:${a.id}`];
    return own === undefined ? parts.blocks[i] : renumberBlock(own, { language: lang, template: templates[lang] ?? null }, i + 1, chosen.length);
  });
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
  const photoKey = (a: QuoteAircraftOption, p: ShareItem) => `${a.id}|${p.url}`;
  // Single photos start ticked; the combined photo starts unticked (it repeats them), so the broker sends one or the other.
  const startsOn = (p: ShareItem) => p.classification !== "combined";
  const isOn = (a: QuoteAircraftOption, p: ShareItem) => startsOn(p) !== flip.has(photoKey(a, p));
  const setPhotos = (items: { a: QuoteAircraftOption; p: ShareItem }[], on: boolean) => setFlip((cur) => {
    const n = new Set(cur);
    for (const { a, p } of items) { const k = photoKey(a, p); if (on === startsOn(p)) n.delete(k); else n.add(k); }
    return n;
  });
  const togglePhoto = (a: QuoteAircraftOption, p: ShareItem) => setPhotos([{ a, p }], !isOn(a, p));
  const ofClass = (c: string) => chosen.flatMap((a) => a.photos.filter((p) => p.classification === c).map((p) => ({ a, p })));
  // A kind of photo (Exterior, Cabin, Combined…) counts as chosen while any photo of that kind is ticked; tapping it ticks or unticks them all.
  const useClass = (c: string) => ofClass(c).some(({ a, p }) => isOn(a, p));
  const toggleClass = (c: string) => setPhotos(ofClass(c), !useClass(c));
  /**
   * Send every chosen aircraft as single photos, or as its combined photo. An aircraft with no combined photo yet
   * always goes as single photos.
   */
  const sendAs = (mode: "single" | "combined") => setFlip((cur) => {
    const n = new Set(cur);
    for (const a of chosen) {
      const hasCombined = a.photos.some((p) => p.classification === "combined");
      for (const p of a.photos) {
        const want = mode === "combined" && hasCombined ? p.classification === "combined" : p.classification !== "combined";
        const k = photoKey(a, p);
        if (want === startsOn(p)) n.delete(k); else n.add(k);
      }
    }
    return n;
  });
  const isMode = (mode: "single" | "combined") => chosen.length > 0 && chosen.every((a) => {
    const hasCombined = a.photos.some((p) => p.classification === "combined");
    return a.photos.every((p) => isOn(a, p) === (mode === "combined" && hasCombined ? p.classification === "combined" : p.classification !== "combined"));
  });
  const photos = chosen.flatMap((a, i) => a.photos.filter((p) => isOn(a, p)).map((p) => ({ a, i, p })));
  const withoutCombined = chosen.filter((a) => !a.photos.some((p) => p.classification === "combined"));
  const dir = lang === "ar" ? "rtl" : "ltr";
  const speech = SPEECH[lang];

  /** Counts this quote as shared out (the Users page shows how many). Sharing it again counts once. */
  const counted = (how: "share" | "copy") => {
    const k = quoteKey || crypto.randomUUID();
    if (!quoteKey) setQuoteKey(k);
    void recordQuoteShareAction({ quoteKey: k, how, options: chosen.length });
  };

  async function copy(mode = styleFor) {
    const ok = await copyText(textFor(mode));
    if (ok && chosen.length) counted("copy");
    setMsg(ok ? "Message copied. Paste it into your chat or email, then share the photos." : "Could not copy automatically. Select the message and copy it.");
    return ok;
  }

  /** One option's message: its own block, with the opening line on the first option and the closing line on the last. */
  const optionText = (i: number, mode: "whatsapp" | "other") => {
    const t = [i === 0 ? greeting : null, blocks[i], i === chosen.length - 1 ? closing : null].filter((x): x is string => !!x && x.trim() !== "").join("\n\n");
    return mode === "whatsapp" ? t : forOtherApps(t);
  };
  /**
   * Share through the phone's share sheet. option = null: every photo, then the whole message, in one send.
   * option = i: that option's photos with that option's message, so the client sees option 1, then option 2...
   */
  async function sharePhotos(option: number | null = null, what: "both" | "photos" | "message" = "both") {
    setBusy(true); setMsg(null);
    try {
      const message = option === null ? textFor(styleFor) : optionText(option, styleFor);
      if (what === "message") { await navigator.share({ text: message }); counted("share"); return; }
      const mine = option === null ? photos : photos.filter((x) => x.i === option);
      const files = await Promise.all(mine.map(async ({ a, i, p }) => {
        const blob = await fetchPhoto(p.url, `${a.type} ${p.label}`);
        return new File([blob], `Option ${i + 1} - ${a.type} - ${p.label}${p.representative ? " (representative)" : ""}.${EXT[p.mimeType] ?? "jpg"}`, { type: p.mimeType });
      }));
      if (files.length && (!navigator.canShare || !navigator.canShare({ files }))) { setMsg("This browser cannot share photos directly. Open this page on your phone, or save the photos from each aircraft page."); return; }
      if (what === "photos") { await navigator.share({ files }); counted("share"); return; }
      // WhatsApp shows the photos first, then the message.
      await navigator.share(files.length ? { files, text: message } : { text: message });
      counted("share");
      // The phone does not say whether the message was actually sent in WhatsApp, so nothing is marked as sent.
      if (option === null && files.length) setMsg(app === "other" ? "If the app kept only the photos, tap Message only and send it to the same chat." : "If the message text did not come through, paste it from Copy message.");
    } catch (e) {
      if ((e as Error).name === "TypeError" || !navigator.share) { setMsg("This browser cannot open the share sheet. Open this page on your phone, or use Copy message."); return; }
      if ((e as Error).name !== "AbortError") setMsg((e as Error).message || "Sharing failed");
    } finally { setBusy(false); }
  }

  const rows = (v: string) => Math.max(2, v.split("\n").length);

  // -- spoken commands (the Ask Chocks microphone on this page)
  const live = useRef({ aircraft, ids, operators, handEdits: anyEdits });
  live.current = { aircraft, ids, operators, handEdits: anyEdits };
  const actions = useRef({ copy, sharePhotos });
  actions.current = { copy, sharePhotos };
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
        // Links cannot carry photos, so "send it on WeChat" also goes through the share sheet.
        case "send":
          if (c.app === "whatsapp" || c.app === "wechat") setApp(c.app);
          followUp = c.app === "wechat"
            ? { label: "Share the photos (then the message)", run: () => { actions.current.sharePhotos(null, "photos"); } }
            : { label: "Share photos + message", run: () => { actions.current.sharePhotos(); } };
          shareBtn.current?.scrollIntoView({ block: "center" });
          break;
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
        {restored && (
          <div className="draft-note small">
            <span>Your last quote is back, as you left it.</span>
            <button type="button" className="linkish" onClick={startOver}>Start a new one</button>
          </div>
        )}
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
                <div className="group-row"><span>Region</span>
                  <span className="seg" role="radiogroup" aria-label="Region">
                    {["", ...regions].map((r) => (
                      <button key={r || "all"} type="button" role="radio" aria-checked={region === r} className={region === r ? "on" : ""} onClick={() => setRegion(r)}>{r || "All"}</button>
                    ))}
                  </span>
                </div>
              )}
              <div className="group-row"><span>Sort</span>
                <span className="seg" role="radiogroup" aria-label="Sort">
                  {([["name", "A–Z"], ["aircraft", "Most aircraft"], ["recent", "Newest"]] as const).map(([v, l]) => (
                    <button key={v} type="button" role="radio" aria-checked={sort === v} className={sort === v ? "on" : ""} onClick={() => setSort(v)}>{l}</button>
                  ))}
                </span>
              </div>
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
          <div className="chips" role="radiogroup" aria-label="Language" style={{ marginBottom: 8 }}>
            {QUOTE_LANGUAGES.map((l) => (
              <button key={l} type="button" role="radio" aria-checked={lang === l} className={`chip small${lang === l ? " on" : ""}`} onClick={() => lang !== l && changeLang(l)}>
                {QUOTE_WORDS[l].name}{templates[l] ? " ●" : ""}
              </button>
            ))}
          </div>
          <div className="group">
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
                <PhotoPicker
                  photos={a.photos}
                  isOn={(p) => isOn(a, p)}
                  onToggle={(p) => togglePhoto(a, p)}
                  onAll={(on) => setPhotos(a.photos.map((p) => ({ a, p })), on)}
                />
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
            {(chosen.length > 0 || anyEdits) && <div style={{ flex: "0 0 auto" }}><button type="button" className="secondary" onClick={startOver}>New quote</button></div>}
          </div>
          <p className="small muted" style={{ margin: "4px 0 0" }}>Saved on this device as you type, so you can leave the page and come back.</p>
        </div>

        <div className="card">
          <h3>5. Send</h3>
          {allClasses.length > 0 && (
            <>
              <div className="group-title">Quick pick for all {chosen.length > 1 ? `${chosen.length} aircraft` : "photos"}</div>
              <p className="small muted" style={{ margin: "0 0 6px" }}>
                Tap a kind to tick or untick it for every aircraft at once. To pick single photos, tap them under each aircraft in step 4.
              </p>
              <div className="chips" style={{ marginBottom: 8 }}>
                {allClasses.map(([c, label]) => (
                  <button key={c} type="button" className={`chip small${useClass(c) ? " on" : ""}`} aria-pressed={useClass(c)} onClick={() => toggleClass(c)}>{useClass(c) ? "✓ " : ""}{label}</button>
                ))}
              </div>
            </>
          )}
          {chosen.length > 0 && withoutCombined.length < chosen.length && (
            <>
              <div className="chips" style={{ marginBottom: 6 }}>
                <button type="button" className={`chip small${isMode("single") ? " on" : ""}`} aria-pressed={isMode("single")} onClick={() => sendAs("single")}>Single photos</button>
                <button type="button" className={`chip small${isMode("combined") ? " on" : ""}`} aria-pressed={isMode("combined")} onClick={() => sendAs("combined")}>Combined photo</button>
              </div>
            </>
          )}
          {chosen.length > 0 && withoutCombined.length > 0 && (
            <p className="small muted" style={{ margin: "0 0 8px" }}>
              {withoutCombined.length === chosen.length ? (chosen.length === 1 ? "This aircraft has" : "These aircraft have") : `${withoutCombined.map((a) => a.type).join(", ")} ${withoutCombined.length === 1 ? "has" : "have"}`} no combined photo yet (it is made once an aircraft has {COMBINED_NEEDS}).
              {withoutCombined.length < chosen.length && isMode("combined") ? " Those go as single photos." : ""}
            </p>
          )}
          <div className="group" style={{ margin: "4px 0 10px" }}>
            <div className="group-row"><span>Sending through</span>
              <span className="seg" role="radiogroup" aria-label="Sending through">
                {SEND_APPS.map(([v, l]) => (
                  <button key={v} type="button" role="radio" aria-checked={app === v} className={app === v ? "on" : ""} onClick={() => setApp(v)}>{l}</button>
                ))}
              </span>
            </div>
          </div>
          {app === "wechat" && (
            <p className="small muted" style={{ margin: "0 0 8px" }}>
              WeChat takes photos or a message, not both in one share. Tap Photos and send them, then Message to the same chat.
            </p>
          )}
          {chosen.length > 1 ? (
            <>
              <div className="group-title">Send, one option at a time ({photos.length} photo{photos.length === 1 ? "" : "s"} ticked in total)</div>
              <div className="option-sends">
                {chosen.map((a, i) => {
                  const n = photos.filter((x) => x.i === i).length;
                  return app === "wechat" ? (
                    <div key={a.id} className="option-pair">
                      <span className="option-send-text small">Option {i + 1} · {a.type}</span>
                      <button type="button" className="secondary" onClick={() => sharePhotos(i, "photos")} disabled={busy || n === 0}><Icon name="share" />{n} photo{n === 1 ? "" : "s"}</button>
                      <button type="button" className="secondary" onClick={() => sharePhotos(i, "message")} disabled={busy}><Icon name="share" />Message</button>
                    </div>
                  ) : (
                    <button key={a.id} type="button" className="block-btn secondary option-send" onClick={() => sharePhotos(i)} disabled={busy}>
                      <Icon name="share" />
                      <span className="option-send-text">Option {i + 1} · {a.type} — {n ? `${n} photo${n === 1 ? "" : "s"} + message` : "message only"}</span>
                    </button>
                  );
                })}
              </div>
              <p className="small muted" style={{ margin: "6px 0 0" }}>
                {app === "wechat"
                  ? "Send Option 1's photos, then its message, then Option 2's, all to the same chat."
                  : "Tap Option 1, choose the chat, send; then Option 2 to the same chat, and so on. The client gets each option's photos followed by its message."}
              </p>
              {app === "wechat" ? (
                <div className="row" style={{ marginTop: 8 }}>
                  <div style={{ flex: "0 0 auto" }}><button ref={shareBtn} type="button" className="secondary" onClick={() => sharePhotos(null, "photos")} disabled={busy || photos.length === 0}>Or all {photos.length} photo{photos.length === 1 ? "" : "s"}</button></div>
                  <div style={{ flex: "0 0 auto" }}><button type="button" className="secondary" onClick={() => sharePhotos(null, "message")} disabled={busy || !text.trim()}>then the whole message</button></div>
                </div>
              ) : (
                <button ref={shareBtn} type="button" className="secondary" style={{ marginTop: 8 }} onClick={() => sharePhotos(null)} disabled={busy || photos.length === 0}>
                  Or everything at once: {photos.length} photo{photos.length === 1 ? "" : "s"}, then one message
                </button>
              )}
            </>
          ) : app === "wechat" ? (
            <div className="row">
              <div style={{ flex: "0 0 auto" }}><button ref={shareBtn} type="button" onClick={() => sharePhotos(null, "photos")} disabled={busy || photos.length === 0}><Icon name="share" />{busy ? "Preparing…" : `1. Share ${photos.length} photo${photos.length === 1 ? "" : "s"}`}</button></div>
              <div style={{ flex: "0 0 auto" }}><button type="button" onClick={() => sharePhotos(null, "message")} disabled={busy || !text.trim()}><Icon name="share" />2. Share the message</button></div>
            </div>
          ) : (
            <>
              <button ref={shareBtn} type="button" className="block-btn" onClick={() => sharePhotos(null)} disabled={busy || (photos.length === 0 && !text.trim())}><Icon name="share" />{busy ? "Preparing…" : photos.length ? `Share ${photos.length} photo${photos.length === 1 ? "" : "s"} + message` : "Share the message"}</button>
              <p className="small muted" style={{ margin: "6px 0 0" }}>
                Opens your phone&apos;s share sheet: choose the app, then the client. Links to an app cannot carry photos, so this is the one way to send both.
                {app === "other" && <> If the app keeps only the photos, <button type="button" className="linkish" onClick={() => sharePhotos(null, "message")} disabled={busy}>share the message</button> after them.</>}
              </p>
            </>
          )}
          {msg && <p className="small" role="status">{msg}</p>}
        </div>
      </div>
    </div>
  );
}

/** One aircraft's photos (the combined photo among them) as tickable thumbnails: ticked photos are sent with the message. */
function PhotoPicker({ photos, isOn, onToggle, onAll }: {
  photos: ShareItem[]; isOn: (p: ShareItem) => boolean; onToggle: (p: ShareItem) => void; onAll: (on: boolean) => void;
}) {
  if (photos.length === 0) return <p className="small muted" style={{ margin: "6px 0" }}>No approved photos for this aircraft yet.</p>;
  const n = photos.filter(isOn).length;
  return (
    <div className="photo-pick">
      <div className="photo-pick-head">
        <span className="small">Photos to send: <b>{n} of {photos.length}</b></span>
        <span style={{ display: "flex", gap: 4 }}>
          <button type="button" className="secondary small-btn" onClick={() => onAll(true)} disabled={n === photos.length}>All</button>
          <button type="button" className="secondary small-btn" onClick={() => onAll(false)} disabled={n === 0}>None</button>
        </span>
      </div>
      <div className="photo-pick-grid">
        {photos.map((p) => {
          const on = isOn(p);
          return (
            <button key={p.url} type="button" className={`photo-tile${on ? " on" : ""}${p.classification === "combined" ? " combined" : ""}`} aria-pressed={on} onClick={() => onToggle(p)} title={on ? "Tap to leave this photo out" : "Tap to send this photo"}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt={p.label} loading="lazy" />
              <span className="tick" aria-hidden>{on ? "✓" : ""}</span>
              <span className="cap">{p.label}{p.representative ? " · rep." : ""}</span>
            </button>
          );
        })}
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
