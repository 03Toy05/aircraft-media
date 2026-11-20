import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { importLibraryPackAction } from "../../../actions";
import { Flash, one, type SP } from "../../../_components/ui";

/** Admin only: load an operator's fleet (pack.json plus photos) straight into the library. */
export default async function LibraryImport({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  await requireAdmin();
  return (
    <>
      <p className="small"><Link href="/library">← Library</Link></p>
      <h1>Import into the library</h1>
      <Flash error={one(sp.error)} ok={one(sp.ok)} />
      <div className="card">
        <p className="small muted" style={{ marginTop: 0 }}>
          Choose <b>pack.json</b> and all the photos it names, together. Aircraft are matched by tail, or by operator, type and base when there is
          no tail. Photos go in approved; an aircraft that already has its 1 EXT, 2 CABIN and 1 FLOOR PLAN keeps them.
        </p>
        <form action={importLibraryPackAction} className="inline-form">
          <input type="file" name="files" multiple accept=".json,image/*" required aria-label="Pack files" />
          <button type="submit">Import</button>
        </form>
      </div>
    </>
  );
}
