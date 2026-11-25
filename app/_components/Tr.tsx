"use client";

import { useT } from "./uiLang";

/** One English label in the screen language, for components that also render on the server without hooks (e.g. Choice). */
export default function Tr({ text }: { text: string }) {
  const t = useT();
  return <>{t(text)}</>;
}
