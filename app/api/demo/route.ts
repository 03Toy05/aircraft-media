import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { getFileStore } from "@/storage";
import { uploadKeyMatches, uploadKeySet } from "@/domain/libraryUpload";
import { makeDemoQuote, type DemoInput } from "@/domain/demoQuote";
import { CLASSIFICATIONS, type Classification } from "@/domain/constants";

/**
 * Makes the website's demo client link (npm run demo:links), for a caller holding LIBRARY_UPLOAD_KEY.
 * POST multipart: "spec" (JSON: aircraft, legs, expiresAt, photos [{ name, classification }]) and "files" (the photos).
 * Answers { created, links: { en, zh-hant, zh-hans } } (tokens). Running it again gives the same links.
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!uploadKeySet()) return new NextResponse("Not found", { status: 404 });
  const auth = req.headers.get("authorization") ?? "";
  if (!uploadKeyMatches(auth.startsWith("Bearer ") ? auth.slice(7).trim() : "")) return NextResponse.json({ error: "Wrong or missing upload key." }, { status: 401 });
  try {
    const form = await req.formData();
    const spec = JSON.parse(String(form.get("spec") ?? "{}")) as Omit<DemoInput, "photos" | "expiresAt"> & { expiresAt: string; photos: { name: string; classification: string }[] };
    const files = new Map<string, File>();
    for (const f of form.getAll("files")) if (f instanceof File) files.set(f.name, f);
    const photos: DemoInput["photos"] = [];
    for (const p of spec.photos ?? []) {
      const f = files.get(p.name);
      if (!f) throw new Error(`The photo ${p.name} wasn't sent.`);
      if (!(CLASSIFICATIONS as readonly string[]).includes(p.classification)) throw new Error(`Unknown kind of photo: ${p.classification}`);
      photos.push({ name: p.name, bytes: new Uint8Array(await f.arrayBuffer()), classification: p.classification as Classification });
    }
    const expiresAt = new Date(spec.expiresAt);
    if (Number.isNaN(expiresAt.getTime())) throw new Error("expiresAt isn't a date.");
    const r = await makeDemoQuote(await getDb(), getFileStore(), { aircraft: spec.aircraft, legs: spec.legs, photos, expiresAt });
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
