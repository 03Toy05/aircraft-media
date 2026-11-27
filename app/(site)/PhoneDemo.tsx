"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Toy from "../_components/Toy";
import { track } from "./track";

type Video = { src: string; poster?: string; captions: { lang: string; srclang: string; label: string }[] };

/**
 * The front page's phone: its screen always shows Toy's notes (whatever the page puts inside). The demo film is
 * played in a player over the page that takes the film's own shape (16:9 or 9:16; a modal dialog: Esc or Close shuts
 * it, focus goes back to the button) rather than being squeezed into the phone. When the film ends, its last frame
 * stays and a real "Draft your first quote" link appears on top of the picture of that button in the end card, with
 * "Watch again" under it. Without a film there is no play button, only a plain "coming soon" label (no fake controls).
 * The film never starts by itself.
 */
export default function PhoneDemo({ video, short = null, lang, labels, draftHref, startHref, hidePlay = false, children }: {
  video: Video | null;
  /** The short demo, opened by "toy:watch-demo" with detail "short"; its end card's button is "Make Toy yours" (startHref). */
  short?: Video | null;
  startHref: string;
  lang: string;
  labels: { watch: string; close: string; soon: string; screen: string; draft: string; again: string; start: string };
  draftHref: string;
  /** Hide the "Watch the demo" button (e.g. while the founder clip is showing); the player can still be opened by event. */
  hidePlay?: boolean;
  children: React.ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const film = useRef<HTMLVideoElement>(null);
  const [ended, setEnded] = useState(false);
  // The player takes the film's shape: 16:9 for a horizontal film, 9:16 for a vertical one.
  const [tall, setTall] = useState(false);
  // Which film the player holds: the full demo, or the short one.
  const [isShort, setIsShort] = useState(false);
  const playing = isShort && short ? short : video;
  const own = video?.captions.some((c) => c.lang === lang);
  // The film's size may already be known before this component is ready to hear about it.
  useEffect(() => { const v = film.current; if (v && v.videoWidth) setTall(v.videoHeight > v.videoWidth); }, []);

  const play = () => { setEnded(false); film.current?.play().catch(() => {}); }; // a blocked autoplay leaves the controls
  const open = (wantShort = false) => {
    const s = wantShort && !!short;
    if (s !== isShort) {
      // A different film: the <video> is replaced (keyed by src); its onLoadedMetadata starts it.
      setIsShort(s); setEnded(false); pendingPlay.current = true; dialog.current?.showModal();
      track("demo_play", lang);
      return;
    }
    const v = film.current;
    if (v?.videoWidth) setTall(v.videoHeight > v.videoWidth);
    dialog.current?.showModal(); if (v) v.currentTime = 0; play();
    track("demo_play", lang);
  };
  const close = () => dialog.current?.close();
  // Other parts of the page (the founder clip's end link) can ask for the demo with a "toy:watch-demo" event.
  const pendingPlay = useRef(false);
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    if (!video) return;
    const onAsk = (e: Event) => openRef.current((e as CustomEvent).detail === "short");
    window.addEventListener("toy:watch-demo", onAsk);
    return () => window.removeEventListener("toy:watch-demo", onAsk);
  }, [video]);
  const stop = () => { const v = film.current; if (v) { v.pause(); v.currentTime = 0; } setEnded(false); };

  return (
    <div className="phone" role="region" aria-label={labels.screen}>
      <span className="phone-notch" aria-hidden="true" />
      <div className="phone-screen">
        <div className="phone-content">{children}</div>
        {hidePlay ? null : video ? (
          <button type="button" className="phone-play" onClick={() => open(false)}>
            <svg aria-hidden="true" focusable="false" width="14" height="14" viewBox="0 0 14 14"><path d="M3 1.5 L12 7 L3 12.5 Z" fill="currentColor" /></svg>
            {labels.watch}
          </button>
        ) : (
          <span className="phone-play is-soon">{labels.soon}</span>
        )}
        <span className="phone-toy" aria-hidden="true"><Toy size={52} shadow /></span>
      </div>
      {video && (
        // Clicking the dimmed area around the film closes it too.
        <dialog ref={dialog} className={tall ? "film-dialog is-tall" : "film-dialog"} aria-label={labels.watch} onClose={stop}
          onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
          <div className="film-frame">
            {playing && <video key={playing.src} ref={film} className="film-video" controls={!ended} playsInline preload="metadata" poster={video.poster}
              onLoadedMetadata={(e) => { setTall(e.currentTarget.videoHeight > e.currentTarget.videoWidth); if (pendingPlay.current) { pendingPlay.current = false; play(); } }}
              onEnded={() => { setEnded(true); track("demo_complete", lang); }} onPlay={() => setEnded(false)}>
              <source src={playing.src} type="video/mp4" />
              {playing.captions.map((c) => (
                <track key={c.lang} kind="captions" src={`/demo/captions-${c.lang}.vtt`} srcLang={c.srclang} label={c.label}
                  default={c.lang === lang || (c.lang === "en" && !own)} />
              ))}
            </video>}
            {ended && (
              <div className="film-end">
                <Link className="film-draft" href={isShort ? startHref : draftHref}>{isShort ? labels.start : labels.draft}</Link>
                <button type="button" className="film-again" onClick={() => { const v = film.current; if (v) v.currentTime = 0; play(); }}>
                  {labels.again}
                </button>
              </div>
            )}
          </div>
          <button type="button" className="film-close" onClick={close} autoFocus>{labels.close}</button>
        </dialog>
      )}
    </div>
  );
}
