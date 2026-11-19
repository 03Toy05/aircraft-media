"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import Icon from "./Icon";
import { copyText, openAfterCopy, shareText } from "./copyText";
import { CONTACT_APPS, contactApp, contactLink } from "@/domain/messengers";
import { QUOTE_LANGUAGES, QUOTE_WORDS, buildQuoteParts, type QuoteLanguage, type QuoteTemplate } from "@/domain/quote";
import type { WifiStatus } from "@/domain/constants";
import type { ShareItem } from "./ShareBox";

export interface QuoteAircraftOption {
  id: string;
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
export interface QuoteContact { id: string; name: string; app: string; handle: string | null }
export type SavedTemplates = Partial<Record<QuoteLanguage, Partial<QuoteTemplate>>>;

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/**
 * The message is built from your saved wording (Quote → Edit the wording) and the aircraft you choose, in separate
 * pieces: a greeting, one block per aircraft, and a closing. Each piece can be edited by hand. An edited piece is
 * kept when you add or remove other aircraft; only Reset (or changing the language) rebuilds it.
 */
export default function QuoteBuilder({ aircraft, contacts, initialIds, templates }: { aircraft: QuoteAircraftOption[]; contacts: QuoteContact[]; initialIds: string[]; templates: SavedTemplates }) {
  const [ids, setIds] = useState<string[]>(initialIds);
  const [lang, setLang] = useState<QuoteLanguage>("en");
  const [inc, setInc] = useState({ operator: false, tail: false, base: false, notes: false, greeting: true });
  const [filter, setFilter] = useState("");
  const [operatorFilter, setOperatorFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState(() => {
    const t = [...new Set(initialIds.map((id) => aircraft.find((a) => a.id === id)?.type).filter(Boolean))];
    return t.length === 1 ? (t[0] as string) : "";
  });
  const [edits, setEdits] = useState<Record<string, string>>({}); // "greeting" | "closing" | "block:<aircraftId>" -> the broker's own text
  const [classes, setClasses] = useState<Set<string> | null>(null); // null = every kind of photo
  const [contactId, setContactId] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const chosen = useMemo(() => ids.map((id) => aircraft.find((a) => a.id === id)).filter((a): a is QuoteAircraftOption => !!a), [ids, aircraft]);
  const parts = useMemo(
    () => buildQuoteParts(chosen, { language: lang, template: templates[lang] ?? null, includeOperator: inc.operator, includeTail: inc.tail, includeBase: inc.base, includeNotes: inc.notes, greeting: inc.greeting }),
    [chosen, lang, inc, templates],
  );
  const greeting = parts.greeting === null ? null : edits.greeting ?? parts.greeting;
  const closing = parts.closing === null ? null : edits.closing ?? parts.closing;
  const blocks = chosen.map((a, i) => edits[`block:${a.id}`] ?? parts.blocks[i]);
  const text = [greeting, ...blocks, closing].filter((x): x is string => !!x && x.trim() !== "").join("\n\n");
  const anyEdits = Object.keys(edits).length > 0;
  const editedBlocks = chosen.some((a) => `block:${a.id}` in edits);

  const setEdit = (k: string, v: string) => setEdits((cur) => ({ ...cur, [k]: v }));
  const resetEdit = (k: string) => setEdits((cur) => { const n = { ...cur }; delete n[k]; return n; });
  const toggle = (id: string) => setIds((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const move = (id: string, d: -1 | 1) => setIds((cur) => { const i = cur.indexOf(id); const j = i + d; if (i < 0 || j < 0 || j >= cur.length) return cur; const n = [...cur]; [n[i], n[j]] = [n[j], n[i]]; return n; });

  const changeLang = (l: QuoteLanguage) => {
    if (anyEdits && !window.confirm("Changing the language rewrites the message, so your hand edits will be lost. Continue?")) return;
    setEdits({});
    setLang(l);
  };

  const allClasses = useMemo(() => [...new Map(chosen.flatMap((a) => a.photos).map((p) => [p.classification, p.classificationLabel])).entries()], [chosen]);
  const useClass = (c: string) => !classes || classes.has(c);
  const toggleClass = (c: string) => setClasses((cur) => { const n = new Set(cur ?? allClasses.map(([k]) => k)); if (n.has(c)) n.delete(c); else n.add(c); return n; });
  const photos = chosen.flatMap((a, i) => a.photos.filter((p) => useClass(p.classification)).map((p) => ({ a, i, p })));

  const dir = lang === "ar" ? "rtl" : "ltr";
  // Type first: the broker picks the aircraft type, which narrows the list of aircraft (and of operators) below.
  const types = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of aircraft) m.set(a.type, (m.get(a.type) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [aircraft]);
  const ofType = aircraft.filter((a) => !typeFilter || a.type === typeFilter);
  const operators = [...new Set(ofType.map((a) => a.operator).filter((o): o is string => !!o))].sort((a, b) => a.localeCompare(b));
  const shown = ofType.filter((a) => (!operatorFilter || (operatorFilter === "__none" ? !a.operator : a.operator === operatorFilter)) && (!filter.trim() || `${a.type} ${a.tail ?? ""} ${a.operator ?? ""}`.toLowerCase().includes(filter.trim().toLowerCase())));
  const pickType = (t: string) => { setTypeFilter(t); setOperatorFilter(""); };

  async function copy() {
    const ok = await copyText(text);
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
      await navigator.share({ files, text });
      setMsg("Shared. If the message text did not come through, paste it from Copy message.");
    } catch (e) {
      if ((e as Error).name !== "AbortError") setMsg((e as Error).message || "Sharing failed");
    } finally { setBusy(false); }
  }

  async function open(appId: string, handle: string | null, label: string) {
    const link = contactLink(appId, handle, text);
    if (link.copyFirst) {
      // Apps that cannot take text from a link: the phone's share sheet passes the message straight in.
      const r = await shareText(text);
      if (r === "shared") { setMsg(`Message sent to the share sheet. If ${label} did not open, pick it there. Then share the photos.`); return; }
      if (r === "cancelled") { setMsg(null); return; }
      if (!(await copy())) { setMsg(`Could not copy the message automatically. Select it and copy it, then open ${label}.`); return; }
      setMsg(`Message copied. Opening ${label}. Paste it into the chat (long-press, Paste), then share the photos.`);
      openAfterCopy(link.url, link.newTab);
      return;
    }
    setMsg(`${label} opened with the message ready. Press Send there, then share the photos.`);
    if (link.newTab) window.open(link.url, "_blank"); else window.location.href = link.url;
  }

  const email = () => { window.location.href = `mailto:?subject=${encodeURIComponent(QUOTE_WORDS[lang].aircraft)}&body=${encodeURIComponent(text)}`; setMsg("Email opened with the message. Attach the photos from Share photos, or paste them in."); };
  const contact = contacts.find((c) => c.id === contactId);
  const rows = (v: string) => Math.max(2, v.split("\n").length);

  return (
    <div className="grid g2" style={{ alignItems: "start" }}>
      <div>
        <div className="card">
          <h3>1. Aircraft type</h3>
          {types.length === 0 && <p className="muted small">No aircraft yet.</p>}
          <div className="chips" role="radiogroup" aria-label="Aircraft type">
            {types.length > 1 && (
              <button type="button" role="radio" aria-checked={!typeFilter} className={`chip${!typeFilter ? " on" : ""}`} onClick={() => pickType("")}>All types ({aircraft.length})</button>
            )}
            {types.map(([t, n]) => (
              <button key={t} type="button" role="radio" aria-checked={typeFilter === t} className={`chip${typeFilter === t ? " on" : ""}`} onClick={() => pickType(t)}>
                {t} ({n}){ids.some((id) => aircraft.find((a) => a.id === id)?.type === t) && <span aria-label="has chosen aircraft"> ✓</span>}
              </button>
            ))}
          </div>
        </div>

        <div className="card">
          <h3>2. Aircraft{typeFilter ? ` · ${typeFilter}` : ""}</h3>
          <div className="row" style={{ alignItems: "end" }}>
            {operators.length > 1 && (
              <div><label>Operator</label>
                <select value={operatorFilter} onChange={(e) => setOperatorFilter(e.target.value)}>
                  <option value="">All operators</option>
                  {operators.map((o) => <option key={o} value={o}>{o}</option>)}
                  {ofType.some((a) => !a.operator) && <option value="__none">No operator</option>}
                </select></div>
            )}
            {ofType.length > 6 && <div><label>Search</label><input placeholder="Tail or operator" value={filter} onChange={(e) => setFilter(e.target.value)} /></div>}
          </div>
          <div className="ac-pick">
            {shown.length === 0 && types.length > 0 && <p className="muted small">No aircraft match.</p>}
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
                    <b>{a.operator ?? "No operator"}</b>{!typeFilter && <> · {a.type}</>}
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
          {typeFilter && types.length > 1 && <p className="small muted" style={{ margin: "6px 0 0" }}>To add another type, tap it above. Aircraft you ticked stay chosen.</p>}
          {chosen.length > 1 && (
            <>
              <p className="small muted" style={{ marginBottom: 4 }}>Order in the message:</p>
              {chosen.map((a, i) => (
                <div key={a.id} className="small" style={{ display: "flex", gap: 6, alignItems: "center", margin: "2px 0" }}>
                  <span>{i + 1}. {a.type}</span>
                  <button type="button" className="secondary" style={{ padding: "0 8px" }} onClick={() => move(a.id, -1)} disabled={i === 0} aria-label="Move up">↑</button>
                  <button type="button" className="secondary" style={{ padding: "0 8px" }} onClick={() => move(a.id, 1)} disabled={i === chosen.length - 1} aria-label="Move down">↓</button>
                </div>
              ))}
            </>
          )}
        </div>

        <div className="card">
          <h3>3. Language and details</h3>
          <label>Language of the message</label>
          <select value={lang} onChange={(e) => changeLang(e.target.value as QuoteLanguage)}>
            {QUOTE_LANGUAGES.map((l) => <option key={l} value={l}>{QUOTE_WORDS[l].name}{templates[l] ? " ●" : ""}</option>)}
          </select>
          <p className="small muted">
            The wording comes from your saved template for this language{templates[lang] ? " (you have customised it)" : " (standard wording)"}.{" "}
            <Link href={`/quote/template?lang=${lang}`}>Edit the wording →</Link> Aircraft names, tail numbers and notes are never translated.
          </p>
          <label><input type="checkbox" checked={inc.greeting} onChange={(e) => setInc({ ...inc, greeting: e.target.checked })} /> Greeting and closing line</label>
          <label><input type="checkbox" checked={inc.operator} onChange={(e) => setInc({ ...inc, operator: e.target.checked })} /> Show the operator</label>
          <label><input type="checkbox" checked={inc.tail} onChange={(e) => setInc({ ...inc, tail: e.target.checked })} /> Show the tail number</label>
          <label><input type="checkbox" checked={inc.base} onChange={(e) => setInc({ ...inc, base: e.target.checked })} /> Show the base</label>
          <label><input type="checkbox" checked={inc.notes} onChange={(e) => setInc({ ...inc, notes: e.target.checked })} /> Show notes</label>
          {editedBlocks && <p className="small muted">An aircraft you have edited by hand keeps your text when you change these. Press Reset on it to rebuild it.</p>}
        </div>
      </div>

      <div>
        <div className="card">
          <h3>4. Check and edit the message</h3>
          {chosen.length === 0 && <p className="muted">Choose at least one aircraft on the left.</p>}
          {greeting !== null && (
            <Piece label="Greeting" dir={dir} value={greeting} rows={rows(greeting)} edited={"greeting" in edits} onChange={(v) => setEdit("greeting", v)} onReset={() => resetEdit("greeting")} />
          )}
          {chosen.map((a, i) => (
            <Piece key={a.id} label={`${i + 1}. ${a.type}`} dir={dir} value={blocks[i]} rows={rows(blocks[i])} edited={`block:${a.id}` in edits} onChange={(v) => setEdit(`block:${a.id}`, v)} onReset={() => resetEdit(`block:${a.id}`)} />
          ))}
          {closing !== null && chosen.length > 0 && (
            <Piece label="Closing" dir={dir} value={closing} rows={rows(closing)} edited={"closing" in edits} onChange={(v) => setEdit("closing", v)} onReset={() => resetEdit("closing")} />
          )}
          {chosen.length > 0 && <p className="small muted">Type the price on each “Price” line. You can change any wording here for this message only; your saved template stays as it is.</p>}
          <div className="row" style={{ marginTop: 8 }}>
            <div style={{ flex: "0 0 auto" }}><button type="button" onClick={copy} disabled={!text.trim()}><Icon name="copy" />Copy message</button></div>
            {anyEdits && <div style={{ flex: "0 0 auto" }}><button type="button" className="secondary" onClick={() => setEdits({})}>Reset all edits</button></div>}
          </div>
        </div>

        <div className="card">
          <h3>5. Send</h3>
          {allClasses.length > 0 && (
            <>
              <p className="small muted" style={{ marginBottom: 4 }}>Photos to include ({photos.length}):</p>
              <div className="row" style={{ marginBottom: 8 }}>
                {allClasses.map(([c, label]) => (
                  <label key={c} style={{ margin: 0, flex: "0 0 auto" }}><input type="checkbox" checked={useClass(c)} onChange={() => toggleClass(c)} /> {label}</label>
                ))}
              </div>
            </>
          )}
          <div className="row">
            <div style={{ flex: "0 0 auto" }}><button type="button" onClick={sharePhotos} disabled={busy || photos.length === 0}><Icon name="share" />{busy ? "Preparing…" : `Share ${photos.length} photo${photos.length === 1 ? "" : "s"} + message…`}</button></div>
          </div>
          <p className="small muted">Opens your phone's share sheet with the photos and the message. Choose WhatsApp, WeChat, LINE, Telegram, Mail or any other app, then the client.</p>

          <p className="small muted" style={{ margin: "10px 0 4px" }}>Or send just the message:</p>
          {contacts.length > 0 && (
            <div className="row" style={{ alignItems: "end", marginBottom: 8 }}>
              <div><label>To a saved contact</label>
                <select value={contactId} onChange={(e) => setContactId(e.target.value)}>
                  <option value="">Choose…</option>
                  {contacts.map((c) => <option key={c.id} value={c.id}>{c.name} ({contactApp(c.app)?.label ?? c.app})</option>)}
                </select></div>
              <div style={{ flex: "0 0 auto" }}><button type="button" disabled={!contact || !text.trim()} onClick={() => contact && open(contact.app, contact.handle, contactApp(contact.app)?.label ?? contact.app)}><Icon name="send" />Send</button></div>
            </div>
          )}
          <div className="apps">
            {CONTACT_APPS.map((a) => (
              <button key={a.id} type="button" className="app" disabled={!text.trim()} onClick={() => open(a.id, null, a.label)}>
                <span className="dot" style={{ background: a.colour }}>{a.mark}</span>{a.label}
              </button>
            ))}
            <button type="button" className="app" disabled={!text.trim()} onClick={email}><span className="dot" style={{ background: "#6b7280" }}>@</span>Email</button>
          </div>
          {msg && <p className="small" role="status">{msg}</p>}
        </div>
      </div>
    </div>
  );
}

function Piece({ label, value, rows, edited, onChange, onReset, dir }: { label: string; value: string; rows: number; edited: boolean; onChange: (v: string) => void; onReset: () => void; dir: "ltr" | "rtl" }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <label style={{ margin: 0 }}>{label}{edited && <span className="muted small"> · edited</span>}</label>
        {edited && <button type="button" className="secondary" style={{ padding: "0 8px" }} onClick={onReset}>Reset</button>}
      </div>
      <textarea dir={dir} rows={rows} value={value} onChange={(e) => onChange(e.target.value)} style={{ width: "100%" }} />
    </div>
  );
}
