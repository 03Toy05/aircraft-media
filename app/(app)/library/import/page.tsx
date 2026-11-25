import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { serverT } from "@/lib/uiLang";
import { getImportJob, runningImportJobs, type ImportJob } from "@/domain/importJobs";
import { importLibraryPackAction } from "../../../actions";
import { AutoRefresh } from "../../../_components/AutoRefresh";
import { Flash, one, type SP } from "../../../_components/ui";

const minutes = (ms: number) => {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
};

function JobCard({ job, t }: { job: ImportJob; t: Awaited<ReturnType<typeof serverT>> }) {
  const pct = job.total ? Math.round((job.done / job.total) * 100) : 0;
  const elapsed = (job.finishedAt ?? Date.now()) - job.startedAt;
  // A rough time left from the pace so far (only once a few aircraft are in).
  const left = !job.finishedAt && job.done >= 3 ? (elapsed / job.done) * (job.total - job.done) : null;
  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>{job.operator}</h2>
      {job.finishedAt ? (
        <>
          <Flash error={job.error ? t("The import stopped: {reason}. Run the pack again to finish it (what is already in is kept).", { reason: job.error }) : undefined} ok={job.message} />
          <p className="small muted">{t("Took {time}.", { time: minutes(elapsed) })} <Link href="/library">{t("Open the library →")}</Link></p>
        </>
      ) : (
        <>
          <AutoRefresh every={3000} />
          <p style={{ margin: "0 0 6px" }}>
            {t("{done} of {total} aircraft done ({pct}%)", { done: job.done, total: job.total, pct })}
          </p>
          <div style={{ background: "var(--line)", borderRadius: 4, height: 8, overflow: "hidden" }}>
            <div style={{ width: `${pct}%`, height: "100%", background: "var(--accent)", transition: "width .4s" }} />
          </div>
          <p className="small muted">
            {job.current ? t("Last done: {name}.", { name: job.current }) : t("Starting…")}{" "}
            {left != null ? t("Running for {time}, about {left} left. You can leave this page; the import carries on.", { time: minutes(elapsed), left: minutes(left) }) : t("Running for {time}. You can leave this page; the import carries on.", { time: minutes(elapsed) })}
          </p>
        </>
      )}
    </div>
  );
}

/** Admin only: load an operator's fleet (pack.json plus photos) straight into the library. */
export default async function LibraryImport({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  await requireAdmin();
  const t = await serverT();
  const jobId = one(sp.job);
  const job = jobId ? getImportJob(jobId) : undefined;
  const others = runningImportJobs().filter((j) => j.id !== job?.id);
  return (
    <>
      <p className="small"><Link href="/library">← {t("Library")}</Link></p>
      <h1>{t("Import into the library")}</h1>
      <Flash error={one(sp.error) ?? (jobId && !job ? t("That import is no longer tracked (the server restarted). Run the pack again to finish it; what is already in is kept.") : undefined)} ok={one(sp.ok)} />
      {job && <JobCard job={job} t={t} />}
      {others.map((j) => <JobCard key={j.id} job={j} t={t} />)}
      <div className="card">
        <p className="small muted" style={{ marginTop: 0 }}>
          {t("Choose pack.json and all the photos it names, together (up to 45 MB at a time). Aircraft are matched by tail, or by operator, type and base when there is no tail. Photos go in approved; an aircraft that already has its 1 EXT, 2 CABIN and 1 FLOOR PLAN keeps them.")}
        </p>
        <form action={importLibraryPackAction} className="inline-form">
          <input type="file" name="files" multiple accept=".json,application/json,image/*" required aria-label={t("Pack files")} />
          <button type="submit">{t("Import")}</button>
        </form>
      </div>
    </>
  );
}
