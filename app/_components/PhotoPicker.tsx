"use client";

import { useState } from "react";
import Icon from "./Icon";
import { useT } from "./uiLang";

/** A big "Choose photos" area in place of the browser's small file box, saying what was picked. */
export default function PhotoPicker({ name, accept }: { name: string; accept: string }) {
  const t = useT();
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
          <b>{t("Choose photos or PDFs")}</b>
          <span className="small muted">{t("From your phone's gallery or files. You can pick several.")}</span>
        </>
      ) : (
        <>
          <b>{picked.length === 1 ? t("{n} file chosen", { n: 1 }) : t("{n} files chosen", { n: picked.length })}</b>
          <span className="small muted">{picked.slice(0, 3).join(", ")}{picked.length > 3 ? t(" and {n} more", { n: picked.length - 3 }) : ""} · {t("tap to change")}</span>
        </>
      )}
    </label>
  );
}
