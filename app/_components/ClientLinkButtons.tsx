"use client";

import { useState } from "react";
import Icon from "./Icon";
import { copyText } from "./copyText";
import { clientLinkAction } from "../requestActions";
import { useT } from "./uiLang";

/**
 * Copy or share the client's link. With `url` it uses that one; otherwise it asks for the request's link (made on the
 * first press) — the Quote page does that right after saving.
 */
export default function ClientLinkButtons({ requestId, url: given, compact = false }: { requestId: string; url?: string; compact?: boolean }) {
  const [url, setUrl] = useState(given ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const t = useT();
  const get = async () => {
    if (url) return url;
    setBusy(true);
    try {
      const r = await clientLinkAction(requestId);
      if (!r.ok || !r.url) { setMsg(r.message); return ""; }
      setUrl(r.url);
      return r.url;
    } finally { setBusy(false); }
  };
  const copy = async () => {
    const u = await get();
    if (!u) return;
    setMsg((await copyText(u)) ? t("Link copied. Paste it into the chat or email.") : t("Copy this link: {url}", { url: u }));
  };
  const share = async () => {
    const u = await get();
    if (!u) return;
    try {
      if (navigator.share) { await navigator.share({ url: u }); return; }
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
    }
    await copy();
  };
  return (
    <span className="client-link">
      <button type="button" className={compact ? "secondary small-btn" : "secondary"} onClick={copy} disabled={busy}><Icon name="copy" />{t("Copy client link")}</button>
      <button type="button" className={compact ? "secondary small-btn" : "secondary"} onClick={share} disabled={busy}><Icon name="share" />{t("Share link")}</button>
      {url && <a className="small" href={`${url}?preview=1`} target="_blank" rel="noopener">{t("Open as the client sees it")}</a>}
      {msg && <span className="small" role="status">{msg}</span>}
    </span>
  );
}
