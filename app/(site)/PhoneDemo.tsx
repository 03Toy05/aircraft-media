"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Toy from "../_components/Toy";

type Video = { src: string; poster?: string; captions: { lang: string; srclang: string; label: string }[] };

/**
 * The front page's phone: its screen always shows Toy's notes (whatever the page puts inside). The demo film is
 * played in a player over the page that takes the film's own shape (16:9 or 9:16; a modal dialog: Esc or Close shuts
 * it, focus goes back to the button) rather than being squeezed into the phone. When the film ends, its last frame
 * stays and a real "Draft your first quote" link appears on top of the picture of that button in the end card, with
 * "Watch again" under it. Without a film there is no play button, only a plain "coming soon" label (no fake controls).
 * The film never starts by itself.
 */
export default function PhoneDemo({ video, lang, labels, draftHref, children }: {
  video: Video | null;
  lang: string;
  labels: { watch: string; close: string; soon: string; screen: string; draft: string; again: string };
  draftHref: string;
  children: React.ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const film = useRef<HTMLVideoElement>(null);
  const [ended, setEnded] = useState(false);
  // The player takes the film's shape: 16:9 for a horizontal film, 9:16 for a vertical one.
  const [tall, setTall] = useState(false);
  const own = video?.captions.some((c) => c.lang === lang);
  // The film's size may already be known before this component is ready to hear about it.
  useEffect(() => { const v = film.current; if (v && v.videoWidth) setTall(v.videoHeight > v.videoWidth); }, []);

  const play = () => { setEnded(false); film.current?.play().catch(() => {}); }; // a blocked autoplay leaves the controls
  const open = () => {
    const v = film.current;
    if (v?.videoWidth) setTall(v.videoHeight > v.videoWidth);
    dialog.current?.showModal(); if (v) v.currentTime = 0; play();
  };
  const close = () => dialog.current?.close();
  const stop = () => { const v = film.current; if (v) { v.pause(); v.currentTime = 0; } setEnded(false); };

  return (
    <div className="phone" role="region" aria-label={labels.screen}>
      <span className="phone-notch" aria-hidden="true" />
      <div className="phone-screen">
        <div className="phone-content">{children}</div>
        {video ? (
          <button type="button" className="phone-play" onClick={open}>
            <svg aria-hidden="true" focusable="false" width="14" height="14" viewBox="0 0 14 14"><path d="M3 1.5 L12 7 L3 12.5 Z" fill="currentColor" /></svg>
            {labels.watch}
          </button>
        ) : (
          <span className="phone-play is-soon">{labels.soon}</span>
        )}
        <span className="phone-toy" aria-hidden="true"><Toy size={40} shadow /></span>
      </div>
      {video && (
        // Clicking the dimmed area around the film closes it too.
        <dialog ref={dialog} className={tall ? "film-dialog is-tall" : "film-dialog"} aria-label={labels.watch} onClose={stop}
          onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
          <div className="film-frame">
            <video ref={film} className="film-video" controls={!ended} playsInline preload="metadata" poster={video.poster}
              onLoadedMetadata={(e) => setTall(e.currentTarget.videoHeight > e.currentTarget.videoWidth)}
              onEnded={() => setEnded(true)} onPlay={() => setEnded(false)}>
              <source src={video.src} type="video/mp4" />
              {video.captions.map((c) => (
                <track key={c.lang} kind="captions" src={`/demo/captions-${c.lang}.vtt`} srcLang={c.srclang} label={c.label}
                  default={c.lang === lang || (c.lang === "en" && !own)} />
              ))}
            </video>
            {ended && (
              <div className="film-end">
                <Link className="film-draft" href={draftHref}>{labels.draft}</Link>
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
