"use client";

import { useMemo, useState } from "react";

export interface ShareItem {
  classification: string;
  classificationLabel: string;
  label: string; // "CABIN 1"
  url: string; // /api/media/<contentVersionId>
  mimeType: string;
  representative: boolean;
}

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/**
 * Send an aircraft to a client without downloading by hand:
 *  - Share: opens the phone's share sheet with the photos attached (pick the client's WhatsApp chat)
 *  - Copy card: puts the compact card on the clipboard (WhatsApp may drop captions on shared files)
 *  - Download zip: photos + card for desktop use
 * Representative (type-level) photos are labelled so they are not passed off as this exact aircraft.
 */
export function ShareBox({ aircraftId, tail, cardText, items }: { aircraftId: string; tail: string; cardText: string; items: ShareItem[] }) {
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
    } catch {
      setMsg("Could not copy automatically — select the card text above and copy it.");
    }
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

  if (items.length === 0) return <p className="muted small">No approved photos to share yet.</p>;
  const zipHref = `/api/aircraft/${aircraftId}/export?views=${[...picked].join(",")}`;
  return (
    <div>
      <div className="row" style={{ marginBottom: 8 }}>
        {classes.map(([c, label]) => (
          <label key={c} style={{ margin: 0, flex: "0 0 auto" }}>
            <input type="checkbox" checked={picked.has(c)} onChange={() => toggle(c)} /> {label} ({items.filter((i) => i.classification === c).length})
          </label>
        ))}
      </div>
      <div className="row">
        <div style={{ flex: "0 0 auto" }}><button type="button" onClick={share} disabled={busy || selected.length === 0}>{busy ? "Preparing…" : `Share ${selected.length} photo${selected.length === 1 ? "" : "s"}…`}</button></div>
        <div style={{ flex: "0 0 auto" }}><button type="button" className="secondary" onClick={copyCard}>Copy card</button></div>
        <div style={{ flex: "0 0 auto" }}><a className="btn secondary" style={{ background: "transparent", color: "var(--accent)" }} href={picked.size ? zipHref : undefined} aria-disabled={picked.size === 0}>Download zip</a></div>
      </div>
      {msg && <p className="small" role="status">{msg}</p>}
    </div>
  );
}
