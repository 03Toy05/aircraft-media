"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { finishUploadAction, uploadFileAction, type UploadResult } from "../actions";
import PhotoPicker from "./PhotoPicker";

/** How many files go up at the same time: enough to keep the line busy, few enough not to choke a phone. */
const AT_ONCE = 3;

/**
 * The Upload photos form. Each file is sent on its own, a few at a time, with a progress bar ("3 of 10"),
 * so a big batch never looks stuck. Photos are sent as they are: the original is always kept.
 * Without the page's script, the form still works the old way (everything in one go).
 */
export default function UploadForm({ action }: { action: (fd: FormData) => Promise<void> }) {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [bytes, setBytes] = useState({ sent: 0, all: 0 });

  async function send(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const fd = new FormData(e.currentTarget);
    const files = fd.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
    if (!files.length) return;
    const cardText = String(fd.get("cardText") ?? "");
    const batchId = crypto.randomUUID();
    setBusy(true); setDone(0); setTotal(files.length); setBytes({ sent: 0, all: files.reduce((n, f) => n + f.size, 0) });

    const results: UploadResult[] = new Array(files.length);
    let toReview = 0;
    let next = 0;
    const worker = async () => {
      while (next < files.length) {
        const i = next++;
        const f = files[i];
        const one = new FormData();
        one.set("file", f); one.set("cardText", cardText); one.set("batchId", batchId);
        try {
          const r = await uploadFileAction(one);
          results[i] = r.result;
          toReview += r.toReview;
        } catch {
          results[i] = { name: f.name, status: "failed", error: "It didn't go through (connection or size). Try that file again." };
        }
        setDone((d) => d + 1);
        setBytes((b) => ({ ...b, sent: b.sent + f.size }));
      }
    };
    await Promise.all(Array.from({ length: Math.min(AT_ONCE, files.length) }, worker));
    router.push(await finishUploadAction(results, toReview));
  }

  const mb = (n: number) => `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  const pct = total ? Math.round((bytes.all ? bytes.sent / bytes.all : done / total) * 100) : 0;

  return (
    <form ref={form} action={action} onSubmit={send} className="card">
      <p className="muted small" style={{ marginTop: 0 }}>You&apos;ll check each photo in Review before anything is saved to an aircraft. Photos inside a PDF come out as separate photos.</p>
      <PhotoPicker name="files" accept="image/jpeg,image/png,image/webp,application/pdf" />
      <details className="collapse" style={{ marginTop: 10 }}>
        <summary className="small">Add the aircraft details (optional)</summary>
        <label htmlFor="cardText">Paste the details as you received them</label>
        <textarea id="cardText" name="cardText" placeholder={"Operator:\nAircraft:\nTail number:\nBase:\nYOM:\nYOR:\nCapacity:\nWIFI:\nNotes:"} />
        <p className="muted small">They&apos;re filled in for you in Review, where you confirm them.</p>
      </details>
      {busy ? (
        <div className="upload-progress" role="status" aria-live="polite">
          <div className="bar"><span style={{ width: `${Math.max(pct, 4)}%` }} /></div>
          <div className="small">
            {done < total ? <>Uploading {Math.min(done + 1, total)} of {total}…</> : <>All {total} sent. Opening Review…</>}
            <span className="muted"> {mb(bytes.sent)} of {mb(bytes.all)}. Keep this page open.</span>
          </div>
        </div>
      ) : (
        <p style={{ marginBottom: 0 }}><button type="submit">Upload</button></p>
      )}
    </form>
  );
}
