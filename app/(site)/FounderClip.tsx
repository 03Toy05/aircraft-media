"use client";
import { useState } from "react";

type Video = { src: string; poster?: string; captions: { lang: string; srclang: string; label: string }[] };

/**
 * The founder's own video in "How it begins", playing inside the phone. It never starts by itself; when it ends, a
 * "See Toy draft a quote" button appears that opens the demo film (the phone's player listens for "toy:watch-demo").
 * Without a demo film there is nothing to link to, so no button.
 */
export default function FounderClip({ video, lang, label, cta, hasDemo }: {
  video: Video;
  lang: string;
  label: string;
  cta: string;
  hasDemo: boolean;
}) {
  const [ended, setEnded] = useState(false);
  const own = video.captions.some((c) => c.lang === lang);
  return (
    <figure className="phone-founder">
      <video controls playsInline preload="metadata" poster={video.poster} aria-label={label}
        onEnded={() => setEnded(true)} onPlay={() => setEnded(false)}>
        <source src={video.src} type="video/mp4" />
        {video.captions.map((c) => (
          <track key={c.lang} kind="captions" src={`/brand/founder-captions-${c.lang}.vtt`} srcLang={c.srclang} label={c.label}
            default={c.lang === lang || (c.lang === "en" && !own)} />
        ))}
      </video>
      <figcaption>{label}</figcaption>
      {ended && hasDemo && (
        <button type="button" className="phone-founder-cta" onClick={() => window.dispatchEvent(new Event("toy:watch-demo"))}>
          {cta} →
        </button>
      )}
    </figure>
  );
}
