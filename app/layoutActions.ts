"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { requireWriter } from "@/lib/session";
import { serverT } from "@/lib/uiLang";
import { DomainError } from "@/domain/errors";
import { removeQuoteLayout, setQuoteLayout, setQuoteLayoutEnabled } from "@/domain/quoteLayout";

const back = (k: "error" | "ok", msg: string) => redirect(`/settings?layout=1&${k}=${encodeURIComponent(msg)}#layout`);

async function writer() {
  try {
    return await requireWriter();
  } catch (e) {
    if (e instanceof DomainError) back("error", (await serverT()).error(e));
    throw e;
  }
}

/** Settings: Toy reads a past quote (Word) into the broker's own layout, used for quote PDFs from now on. */
export async function saveQuoteLayoutAction(fd: FormData) {
  const s = await writer();
  const t = await serverT();
  const file = fd.get("docx");
  if (!(file instanceof File) || file.size === 0) back("error", t("Choose a Word file (.docx) first."));
  const f = file as File;
  const res = await setQuoteLayout(await getDb(), s.actor.tenantId, f.name, new Uint8Array(await f.arrayBuffer()));
  if ("error" in res) {
    back("error", res.error === "size" ? t("The Word file must be under 5 MB.") : res.error === "macros" ? t("That file has macros. Save it as a plain Word document (.docx) and upload again.") : t("That isn't a Word file we can read. Save it as .docx (Word 2007 or later) and upload again."));
  }
  revalidatePath("/", "layout");
  back("ok", t("Toy has read your layout. Your quote PDFs now use it. Check the sample PDF below."));
}

export async function setQuoteLayoutEnabledAction(fd: FormData) {
  const s = await writer();
  const on = fd.get("enabled") === "1";
  await setQuoteLayoutEnabled(await getDb(), s.actor.tenantId, on);
  revalidatePath("/", "layout");
  const t = await serverT();
  back("ok", on ? t("Your quote PDFs now use your own layout.") : t("Your quote PDFs now use the standard layout."));
}

export async function removeQuoteLayoutAction() {
  const s = await writer();
  await removeQuoteLayout(await getDb(), s.actor.tenantId);
  revalidatePath("/", "layout");
  back("ok", (await serverT())("Your layout was removed. Quote PDFs use the standard layout."));
}
