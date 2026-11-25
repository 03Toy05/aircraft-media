import Link from "next/link";
import { getDb } from "@/db/client";
import { requireAdmin } from "@/lib/session";
import { speedReport, type SpeedRow, type TimingKind } from "@/domain/timings";
import { serverT } from "@/lib/uiLang";
import { one, type SP } from "../../../_components/ui";

const s = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`);
/** Under 1 s feels instant, up to 3 s is a wait, longer is slow. */
const feel = (ms: number) => (ms < 1000 ? "ok" : ms < 3000 ? "warn" : "off");


/** Admin: how long people wait for pages, buttons and Toy, from what their browsers report. */
export default async function Speed({ searchParams }: { searchParams: SP }) {
  await requireAdmin();
  const t = await serverT();
  const SECTIONS: { kind: TimingKind; title: string; what: string }[] = [
    { kind: "toy", title: "Toy", what: t("From sending a message to Toy's reply on screen. Server: the part spent on the server.") },
    { kind: "action", title: t("Buttons"), what: t("From pressing a button (Save, Add to my workspace…) to the result on screen.") },
    { kind: "page", title: t("Pages"), what: t("From tapping a link to the new page on screen. \"(opened)\": the first load when the app is opened.") },
  ];
  const sp = await searchParams;
  const days = [1, 7, 30].includes(Number(one(sp.days))) ? Number(one(sp.days)) : 7;
  const rows = await speedReport(await getDb(), days);
  const table = (list: SpeedRow[], server: boolean) => (
    <table>
      <thead><tr><th>{t("What")}</th><th>{t("Times")}</th><th>{t("Typical")}</th><th>{t("Slow (1 in 10)")}</th><th>{t("Slowest")}</th>{server && <th>{t("Server")}</th>}</tr></thead>
      <tbody>
        {list.map((r) => (
          <tr key={r.name}>
            <td>{r.name}</td><td>{r.count}</td>
            <td><span className={`pill ${feel(r.typical)}`}>{s(r.typical)}</span></td>
            <td><span className={`pill ${feel(r.slow)}`}>{s(r.slow)}</span></td>
            <td className="small muted">{s(r.slowest)}</td>
            {server && <td className="small muted">{r.server == null ? "" : s(r.server)}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
  return (
    <>
      <p className="small"><Link href="/admin">← {t("Users")}</Link></p>
      <div className="people-head">
        <h1 style={{ margin: 0 }}>{t("Speed")}</h1>
        <div className="seg">
          {[1, 7, 30].map((d) => <Link key={d} href={`/admin/speed?days=${d}`} className={d === days ? "btn small-btn" : "btn secondary small-btn"}>{d === 1 ? t("Today") : t("{n} days", { n: d })}</Link>)}
        </div>
      </div>
      <p className="small muted">{days === 1 ? t("What people waited for in the last 24 hours, as their browsers measured it. Typical: half were faster. Green under 1 s, amber up to 3 s, red slower.") : t("What people waited for in the last {n} days, as their browsers measured it. Typical: half were faster. Green under 1 s, amber up to 3 s, red slower.", { n: days })}</p>
      {rows.length === 0 && <div className="card muted">{t("Nothing recorded yet. Times appear as people use the app.")}</div>}
      {SECTIONS.map(({ kind, title, what }) => {
        const list = rows.filter((r) => r.kind === kind);
        return list.length > 0 && (
          <div key={kind} className="card" style={{ overflowX: "auto" }}>
            <h3 style={{ marginTop: 0 }}>{title}</h3>
            <p className="small muted" style={{ marginTop: 0 }}>{what}</p>
            {table(list, kind === "toy")}
          </div>
        );
      })}
    </>
  );
}
