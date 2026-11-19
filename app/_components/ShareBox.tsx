"use client";

import { useMemo, useState } from "react";
import Icon from "./Icon";
import { copyText, openAfterCopy, shareText } from "./copyText";
import { contactApp, contactLink, type ContactApp } from "@/domain/messengers";

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
    const ok = await copyText(cardText);
    setMsg(ok ? "Card copied." : "Could not copy automatically. Select the card text above and copy it.");
    return ok;
  }

  /** Open one messenger (for a specific person when `who` is given). */
  async function openApp(app: ContactApp, who?: ShareContact) {
    const link = contactLink(app.id, who?.handle, cardText);
    const person = who ? who.name : "the chat";
    if (link.copyFirst) {
      // Apps that cannot take text from a link: the phone's share sheet passes the card straight in.
      const r = await shareText(cardText);
      if (r === "shared") { setMsg(`Card sent to the share sheet${who ? `; pick ${who.name} in ${app.label}` : ""}. Use Share photos for the photos.`); return; }
      if (r === "cancelled") { setMsg(null); return; }
      const ok = await copyCard();
      if (!ok) {
        // Do not open the app: the card would be lost. Let the owner copy it by hand first.
        setMsg(`Could not copy the card automatically. Use Copy card (or select the text and copy it), then open ${app.label}.`);
        return;
      }
      setMsg(`Card copied. Opening ${app.label}${who ? ` for ${who.name}` : ""}. Paste the card into the chat (long-press, Paste), then press Send. Use Share photos for the photos.`);
      openAfterCopy(link.url, link.newTab);
      return;
    }
    setMsg(`${app.label} opened with the card ready for ${person}. Press Send there. Use Share photos for the photos.`);
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
      if (!navigator.canShare || !navigator.canShare({ files })) {
        setMsg("This browser cannot share photos directly. Use Download zip, or open this page on your phone.");
        return;
      }
      // One send: photos and card together (WhatsApp shows the photos first, then the card).
      await navigator.share({ files, text: cardText, title: tail });
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
            {who.mode === "chat" && `Opens your phone's share sheet with the card. Choose ${who.label}, then ${contact.name}.`}
            {who.mode === "app" && `Opens your phone's share sheet with the card. Choose ${who.label}, then ${contact.name}.`}
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
      {items.length > 0 && <p className="small muted" style={{ margin: "6px 0 0" }}>Share opens your phone&apos;s share sheet with the photos and the card: choose the app, then the chat. WeChat keeps only the photos, so paste the card after them (Copy card).</p>}
      {msg && <p className="small" role="status">{msg}</p>}
    </div>
  );
}
