"use client";
import { useRef } from "react";
import Toy from "../_components/Toy";

type Video = { src: string; poster?: string; captions: { lang: string; srclang: string; label: string }[] };

/**
 * The front page's phone: its screen always shows Toy's notes (whatever the page puts inside). The demo film is
 * horizontal (16:9), so "Watch the demo" opens it in a 16:9 player over the page (a modal dialog: Esc or Close shuts
 * it, focus goes back to the button) rather than squeezing it into the phone. Without a film there is no play button,
 * only a plain "coming soon" label (no fake controls). The film never starts by itself.
 */
export default function PhoneDemo({ video, lang, labels, children }: {
  video: Video | null;
  lang: string;
  labels: { watch: string; close: string; soon: string; screen: string };
  children: React.ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const film = useRef<HTMLVideoElement>(null);
  const own = video?.captions.some((c) => c.lang === lang);

  const open = () => {
    dialog.current?.showModal();
    film.current?.play().catch(() => {}); // a blocked autoplay just leaves the controls for the visitor
  };
  const close = () => dialog.current?.close();
  const stop = () => { const v = film.current; if (v) { v.pause(); v.currentTime = 0; } };

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
        <dialog ref={dialog} className="film-dialog" aria-label={labels.watch} onClose={stop}
          onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
          <div className="film-frame">
            <video ref={film} className="film-video" controls playsInline preload="none" poster={video.poster} onEnded={close}>
              <source src={video.src} type="video/mp4" />
              {video.captions.map((c) => (
                <track key={c.lang} kind="captions" src={`/demo/captions-${c.lang}.vtt`} srcLang={c.srclang} label={c.label}
                  default={c.lang === lang || (c.lang === "en" && !own)} />
              ))}
            </video>
          </div>
          <button type="button" className="film-close" onClick={close} autoFocus>{labels.close}</button>
        </dialog>
      )}
    </div>
  );
}
