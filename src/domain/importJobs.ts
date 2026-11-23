import { randomUUID } from "node:crypto";

/**
 * Library imports run after the upload is answered, so the admin is not left watching a form for half an hour.
 * The server is one instance, so the jobs live in memory: a restart loses the progress, not the work (running the
 * pack again matches what is already in and adds the rest).
 */
export interface ImportJob {
  id: string;
  operator: string;
  startedAt: number;
  finishedAt?: number;
  done: number;
  total: number;
  current: string;
  message?: string;
  error?: string;
}

const g = globalThis as unknown as { __libraryImports?: Map<string, ImportJob> };
const jobs = (g.__libraryImports ??= new Map());

export function startImportJob(operator: string, total: number, work: (job: ImportJob) => Promise<string>): ImportJob {
  const job: ImportJob = { id: randomUUID(), operator, startedAt: Date.now(), done: 0, total, current: "" };
  jobs.set(job.id, job);
  // Old finished jobs are dropped after a day.
  for (const [id, j] of jobs) if (j.finishedAt && Date.now() - j.finishedAt > 86_400_000) jobs.delete(id);
  void work(job).then(
    (message) => { job.message = message; job.finishedAt = Date.now(); },
    (e) => { console.error("Library import failed", e); job.error = (e as Error).message; job.finishedAt = Date.now(); },
  );
  return job;
}

export const getImportJob = (id: string) => jobs.get(id);
export const runningImportJobs = () => [...jobs.values()].filter((j) => !j.finishedAt);
