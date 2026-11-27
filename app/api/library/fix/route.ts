import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { adminActor, uploadKeyMatches, uploadKeySet } from "@/domain/libraryUpload";
import { fixLibraryAircraft, type LibraryFix } from "@/domain/libraryFix";

/**
 * Corrections to library aircraft (npm run library:fix), for a caller holding LIBRARY_UPLOAD_KEY.
 * POST JSON { fixes: [{ tail, operator, type?, serial?, newTail? }] } -> { results: [...] } (one line each, or why not).
 */
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!uploadKeySet()) return new NextResponse("Not found", { status: 404 });
  const auth = req.headers.get("authorization") ?? "";
  if (!uploadKeyMatches(auth.startsWith("Bearer ") ? auth.slice(7).trim() : "")) return NextResponse.json({ error: "Wrong or missing upload key." }, { status: 401 });
  const db = await getDb();
  const admin = await adminActor(db);
  if (!admin) return NextResponse.json({ error: "The admin hasn't signed in to the site yet." }, { status: 409 });
  let fixes: LibraryFix[];
  try {
    fixes = ((await req.json()) as { fixes?: LibraryFix[] }).fixes ?? [];
  } catch {
    return NextResponse.json({ error: "Send JSON." }, { status: 400 });
  }
  const results: string[] = [];
  for (const f of fixes.slice(0, 50)) {
    try { results.push(await fixLibraryAircraft(db, admin, f)); } catch (e) { results.push(`✗ ${(e as Error).message}`); }
  }
  revalidatePath("/library");
  return NextResponse.json({ results });
}
