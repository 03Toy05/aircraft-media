"use client";

import { useMemo, useState } from "react";
import Icon from "./Icon";
import { CONTACT_APPS, contactApp, contactLink, type ContactApp } from "@/domain/messengers";

export interface ShareItem {
  classification: string;
  classificationLabel: string;
  label: string; // "CABIN 1"
  url: string; // /api/media/<contentVersionId>
  mimeType: string;
  representative: boolean;
}

export interface ShareContact { name: string; app: string; handle: string | null }

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/**
 * Send an aircraft to a client:
 *  - With a contact (from Chocks or the Contacts list): one button opens that person's chat in their preferred app with the card.
 *  - Share photos: the phone's share sheet with the photos attached. Links can never carry photos, so the owner picks the
 *    person there; the sheet lists every installed messenger.
 *  - Messenger shortcuts, Copy card, Download zip.
 * Representative (type-level) photos are labelled so they are not passed off as this exact aircraft.
 */
export function ShareBox({ aircraftId, tail, cardText, items, contact }: { aircraftId: string; tail: string; cardText: string; items: ShareItem[]; contact?: ShareContact }) {
  const classes = useMemo(() => [...new Map(items.map((i) => [i.classification, i.classificationLabel])).entries()], [items]);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(classes.map(([c]) => c)));
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const selected = items.filter((i) => picked.has(i.classification));

  const toggle = (c: string) => setPicked((p) => { const n = new Set(p); if (n.has(c)) n.delete(c); else n.add(c); return n; });

  async function copyCard() {
    try {
      await navigator.clipboard.writeText(cardText);
      setMsg("Card copied.");
      return true;
    } catch {
      setMsg("Could not copy automatically. Select the card text above and copy it.");
      return false;
    }
  }

  /** Open one messenger (for a specific person when `who` is given). */
  async function openApp(app: ContactApp, who?: ShareContact) {
    const link = contactLink(app.id, who?.handle, cardText);
    const person = who ? who.name : "the chat";
    if (link.copyFirst) {
      const ok = await copyCard();
      setMsg(`${ok ? "Card copied. " : ""}Opening ${app.label}${who ? ` for ${who.name}` : ""}. ${ok ? "Paste the card into the chat, then press Send." : ""} Use Share photos for the photos.`);
    } else {
      setMsg(`${app.label} opened with the card ready for ${person}. Press Send there. Use Share photos for the photos.`);
    }
    if (link.newTab) window.open(link.url, "_blank");
    else window.location.href = link.url;
  }

  async function share() {
    setBusy(true);
    setMsg(null);
    try {
      const files = await Promise.all(
        selected.map(async (i) => {
          const res = await fetch(i.url);
          if (!res.ok) throw new Error("A photo could not be loaded");
          const blob = await res.blob();
          const name = `${i.label}${i.representative ? " (representative)" : ""} - ${tail}.${EXT[i.mimeType] ?? "jpg"}`;
          return new File([blob], name, { type: i.mimeType });
        }),
      );
      const data: ShareData = { files, text: cardText, title: `${tail}` };
      if (!navigator.canShare || !navigator.canShare({ files })) {
        setMsg("This browser cannot share photos directly. Use Download zip, or open this page on your phone.");
        return;
      }
      await navigator.share(data);
      setMsg("Shared. If the card text did not come through, use Copy card.");
    } catch (e) {
      if ((e as Error).name !== "AbortError") setMsg((e as Error).message || "Sharing failed");
    } finally {
      setBusy(false);
    }
  }

  const who = contact ? contactApp(contact.app) : undefined;
  if (items.length === 0 && !contact) return <p className="muted small">No approved photos to share yet.</p>;
  const zipHref = `/api/aircraft/${aircraftId}/export?views=${[...picked].join(",")}`;
  return (
    <div>
      {contact && who && (
        <div style={{ marginBottom: 10 }}>
          <button type="button" onClick={() => openApp(who, contact)}>
            <Icon name="send" />Send card to {contact.name} on {who.label}
          </button>
          <p className="small muted" style={{ margin: "4px 0 0" }}>
            {who.mode === "chat+text" && "Opens their chat with the card already typed. You press Send."}
            {who.mode === "chat" && "Opens their chat. The card is copied first, so paste it and press Send."}
            {who.mode === "app" && `${who.label} cannot open a person from a link. The card is copied and the app opens; find ${contact.name} and paste it.`}
          </p>
        </div>
      )}
      {items.length > 0 && (
        <>
          <div className="row" style={{ marginBottom: 8 }}>
            {classes.map(([c, label]) => (
              <label key={c} style={{ margin: 0, flex: "0 0 auto" }}>
                <input type="checkbox" checked={picked.has(c)} onChange={() => toggle(c)} /> {label} ({items.filter((i) => i.classification === c).length})
              </label>
            ))}
          </div>
          <div className="row">
            <div style={{ flex: "0 0 auto" }}><button type="button" onClick={share} disabled={busy || selected.length === 0}><Icon name="share" />{busy ? "Preparing…" : `Share ${selected.length} photo${selected.length === 1 ? "" : "s"}${contact ? ` (pick ${contact.name})` : ""}…`}</button></div>
            <div style={{ flex: "0 0 auto" }}><button type="button" className="secondary" onClick={copyCard}><Icon name="copy" />Copy card</button></div>
            <div style={{ flex: "0 0 auto" }}><a className="btn secondary" style={{ background: "transparent", color: "var(--accent)" }} href={picked.size ? zipHref : undefined} aria-disabled={picked.size === 0}><Icon name="download" />Download zip</a></div>
          </div>
        </>
      )}
      {!contact && (
        <>
          <p className="small muted" style={{ marginBottom: 4 }}>Send the card to:</p>
          <div className="apps">
            {CONTACT_APPS.map((a) => (
              <button key={a.id} type="button" className="app" onClick={() => openApp(a)}>
                <span className="dot" style={{ background: a.colour }}>{a.mark}</span>{a.label}
              </button>
            ))}
          </div>
        </>
      )}
      {msg && <p className="small" role="status">{msg}</p>}
    </div>
  );
}
