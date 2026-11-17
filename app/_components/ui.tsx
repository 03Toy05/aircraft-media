import { randomUUID } from "node:crypto";

/** Hidden idempotency key, fresh per render: a double-submitted form is one action. */
export function Key() {
  return <input type="hidden" name="key" value={randomUUID()} />;
}

export function Flash({ error, ok }: { error?: string; ok?: string }) {
  if (error) return <div className="flash err" role="alert">{error}</div>;
  if (ok) return <div className="flash ok">{ok}</div>;
  return null;
}

export function Badge({ status }: { status: string }) {
  return <span className={`badge s-${status}`}>{status.replace(/_/g, " ")}</span>;
}

export type SP = Promise<Record<string, string | string[] | undefined>>;
export const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
