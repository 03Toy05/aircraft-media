"use client";
import { useState } from "react";
import Toy from "../_components/Toy";

type Video = { src: string; poster?: string; captions: { lang: string; srclang: string; label: string }[] };

/**
 * The front page's phone: its screen shows Toy's notes (whatever the page puts inside) until the visitor plays the demo,
 * which then fills the screen; the notes come back when the film ends or is closed. Without a film there is no play
 * button, only a plain "coming soon" label (no fake controls). The film never starts by itself.
 */
export default function PhoneDemo({ video, lang, labels, children }: {
  video: Video | null;
  lang: string;
  labels: { watch: string; close: string; soon: string; screen: string };
  children: React.ReactNode;
}) {
  const [playing, setPlaying] = useState(false);
  const own = video?.captions.some((c) => c.lang === lang);
  return (
    <div className="phone" role="region" aria-label={labels.screen}>
      <span className="phone-notch" aria-hidden="true" />
      <div className="phone-screen">
        {playing && video ? (
          <>
            <video className="phone-video" controls autoPlay playsInline poster={video.poster} onEnded={() => setPlaying(false)}>
              <source src={video.src} type="video/mp4" />
              {video.captions.map((c) => (
                <track key={c.lang} kind="captions" src={`/demo/captions-${c.lang}.vtt`} srcLang={c.srclang} label={c.label}
                  default={c.lang === lang || (c.lang === "en" && !own)} />
              ))}
            </video>
            <button type="button" className="phone-close" onClick={() => setPlaying(false)}>{labels.close}</button>
          </>
        ) : (
          <>
            <div className="phone-content">{children}</div>
            {video ? (
              <button type="button" className="phone-play" onClick={() => setPlaying(true)}>
                <svg aria-hidden="true" focusable="false" width="14" height="14" viewBox="0 0 14 14"><path d="M3 1.5 L12 7 L3 12.5 Z" fill="currentColor" /></svg>
                {labels.watch}
              </button>
            ) : (
              <span className="phone-play is-soon">{labels.soon}</span>
            )}
            <span className="phone-toy" aria-hidden="true"><Toy size={40} shadow /></span>
          </>
        )}
      </div>
    </div>
  );
}
