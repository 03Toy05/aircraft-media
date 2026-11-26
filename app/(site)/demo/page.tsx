import { redirect } from "next/navigation";
import { parseLang } from "../welcome/copy";

/** The film now lives on the front page; /demo keeps working and lands on it, in the same language. */
export default async function DemoPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const lang = parseLang((await searchParams).lang);
  redirect(lang === "en" ? "/welcome#film" : `/welcome?lang=${lang}#film`);
}
