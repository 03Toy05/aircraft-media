"use client";

import { useState } from "react";
import Icon from "./Icon";

/** A big "Choose photos" area in place of the browser's small file box, saying what was picked. */
export default function PhotoPicker({ name, accept }: { name: string; accept: string }) {
  const [picked, setPicked] = useState<string[]>([]);
  return (
    <label className="photo-pick">
      <input
        type="file"
        name={name}
        accept={accept}
        multiple
        required
        onChange={(e) => setPicked(Array.from(e.target.files ?? []).map((f) => f.name))}
      />
      <Icon name="upload" size={26} />
      {picked.length === 0 ? (
        <>
          <b>Choose photos or PDFs</b>
          <span className="small muted">From your phone&apos;s gallery or files. You can pick several.</span>
        </>
      ) : (
        <>
          <b>{picked.length} file{picked.length === 1 ? "" : "s"} chosen</b>
          <span className="small muted">{picked.slice(0, 3).join(", ")}{picked.length > 3 ? ` and ${picked.length - 3} more` : ""} · tap to change</span>
        </>
      )}
    </label>
  );
}
