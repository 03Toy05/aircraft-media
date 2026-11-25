"use client";

import { useEffect, useState } from "react";

/** A date (and time) in the viewer's own time zone; the server only knows UTC. */
export default function LocalTime({ iso, time = true }: { iso: string; time?: boolean }) {
  const d = new Date(iso);
  const fmt = (tz?: string) => d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", ...(time ? { hour: "2-digit", minute: "2-digit" } : {}), ...(tz ? { timeZone: tz } : {}) });
  // UTC on the server, then the viewer's zone once in the browser (the same text when they match).
  const [text, setText] = useState(() => fmt("UTC"));
  useEffect(() => setText(fmt()), [iso]); // eslint-disable-line react-hooks/exhaustive-deps
  return <time dateTime={iso} suppressHydrationWarning>{text}</time>;
}
