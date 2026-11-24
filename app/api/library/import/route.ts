import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getDb } from "@/db/client";
import { getFileStore } from "@/storage";
import { getImportJob } from "@/domain/importJobs";
import { adminActor, readPackFiles, startPackImport, uploadKeyMatches, uploadKeySet } from "@/domain/libraryUpload";

/**
 * Library import without a browser (npm run library:upload): the same as the admin's Import page, for a caller
 * holding LIBRARY_UPLOAD_KEY. With no key set the address doesn't exist.
 *   POST  multipart "files" (pack.json and its photos)  ->  { jobId }
 *   GET   ?job=<id>                                     ->  the job's progress and result
 */
export const dynamic = "force-dynamic";

function denied(req: Request): NextResponse | null {
  if (!uploadKeySet()) return new NextResponse("Not found", { status: 404 });
  const auth = req.headers.get("authorization") ?? "";
  const given = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  return uploadKeyMatches(given) ? null : NextResponse.json({ error: "Wrong or missing upload key." }, { status: 401 });
}

export async function POST(req: Request) {
  const no = denied(req);
  if (no) return no;
  const db = await getDb();
  const admin = await adminActor(db);
  if (!admin) return NextResponse.json({ error: "The admin (OWNER_EMAIL) hasn't signed in to the site yet." }, { status: 409 });
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Send the files as a multipart form." }, { status: 400 });
  }
  try {
    const { pack, files } = await readPackFiles(form.getAll("files"));
    const job = startPackImport(db, getFileStore(), admin, pack, files);
    revalidatePath("/library");
    return NextResponse.json({ jobId: job.id, operator: pack.operator, aircraft: pack.aircraft.length, photos: files.size }, { status: 202 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function GET(req: Request) {
  const no = denied(req);
  if (no) return no;
  const id = new URL(req.url).searchParams.get("job") ?? "";
  const job = getImportJob(id);
  if (!job) return NextResponse.json({ error: "That import is no longer tracked (the server may have restarted). Run it again; what is already in is kept." }, { status: 404 });
  return NextResponse.json({
    operator: job.operator, done: job.done, total: job.total, current: job.current,
    finished: !!job.finishedAt, message: job.message ?? null, error: job.error ?? null,
  });
}
