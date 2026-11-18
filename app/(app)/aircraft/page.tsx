import { redirect } from "next/navigation";
import type { SP } from "../../_components/ui";

/** Operators and aircraft now live together on /fleet; keep old links and form returns working. */
export default async function AircraftList({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) for (const x of Array.isArray(v) ? v : v ? [v] : []) qs.append(k, x);
  redirect(`/fleet${qs.size ? `?${qs}` : ""}`);
}
