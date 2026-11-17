import Link from "next/link";
import { uploadMediaAction } from "../../actions";
import { one, type SP } from "../../_components/ui";

type Result = { name: string; status: "new" | "duplicate" | "failed"; mediaId?: string; error?: string };

export default async function Intake({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  let results: Result[] = [];
  try {
    results = JSON.parse(one(sp.r) ?? "[]");
  } catch {
    results = [];
  }
  return (
    <>
      <h1>Intake</h1>
      {results.length > 0 && (
        <div className="card">
          <h3>Per-item outcomes</h3>
          <table>
            <tbody>
              {results.map((r, i) => (
                <tr key={i}>
                  <td>{r.name}</td>
                  <td>{r.status === "new" ? "Received — needs review" : r.status === "duplicate" ? "Already uploaded (same file) — nothing duplicated" : `Failed: ${r.error}`}</td>
                  <td>{r.mediaId && <Link href={`/review/${r.mediaId}`}>Open</Link>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <form action={uploadMediaAction} className="card">
        <h3>Manual upload</h3>
        <p className="muted small">JPEG, PNG or WebP, up to 20 MB each. The original is kept. Uploading does not classify, associate or approve — you review next.</p>
        <label htmlFor="files">Photos</label>
        <input id="files" type="file" name="files" accept="image/jpeg,image/png,image/webp" multiple required />
        <label htmlFor="cardText">Aircraft card (optional) — pasted as sent by brokers</label>
        <textarea id="cardText" name="cardText" placeholder={"Operator:\nAircraft:\nTail number:\nBase:\nYOM:\nYOR:\nCapacity:\nWIFI:\nNotes:"} />
        <p className="muted small">The card is parsed as a proposal you confirm in review. It never creates an aircraft by itself.</p>
        <button type="submit">Upload</button>
      </form>
      <div className="card">
        <h3>Other sources</h3>
        <p className="muted">Google Drive import and WhatsApp intake are not connected yet (later phases). Status will appear here.</p>
      </div>
    </>
  );
}
