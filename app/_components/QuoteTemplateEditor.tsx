"use client";

import { useMemo, useState } from "react";
import TextBox, { Styled } from "./TextBox";
import { resetQuoteTemplateAction, saveQuoteTemplateAction } from "../actions";
import { TEMPLATE_PLACEHOLDERS, buildQuote, validateQuoteTemplate, type QuoteAircraft, type QuoteLanguage, type QuoteTemplate } from "@/domain/quote";

// Two made-up aircraft, so the preview shows how several aircraft look and how an empty value drops its line.
const SAMPLE: QuoteAircraft[] = [
  { type: "Gulfstream G550", yom: 2013, yor: 2020, capacity: 13, wifi: "yes", wifiDetail: "at USD 10/MB", smoking: "no", pets: "yes", cleaningFee: "USD 500", tail: "B-XXX", operator: "Sample Jet", base: "Hong Kong", notes: "Subject to owner's approval", price: "USD 5,200 per hour" },
  { type: "Bombardier Global 6000", yom: 2015, yor: null, capacity: 14, wifi: "no", tail: "B-YYY", operator: "Sample Jet", base: "Singapore", notes: null, price: "" },
];

export default function QuoteTemplateEditor({ language, defaults, saved, submitKey }: { submitKey: string; language: QuoteLanguage; defaults: QuoteTemplate; saved: Partial<QuoteTemplate> | null }) {
  const [t, setT] = useState<QuoteTemplate>({ ...defaults, ...(saved ?? {}) });
  const [show, setShow] = useState({ operator: true, tail: true, base: true, notes: true });
  const set = (k: keyof QuoteTemplate) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setT({ ...t, [k]: e.target.value });
  const problem = validateQuoteTemplate(t);
  const preview = useMemo(
    () => (problem ? "" : buildQuote(SAMPLE, { language, template: t, greeting: true, includeOperator: show.operator, includeTail: show.tail, includeBase: show.base, includeNotes: show.notes })),
    [t, language, problem, show],
  );
  const dir = language === "ar" ? "rtl" : "ltr";
  const changed = JSON.stringify(t) !== JSON.stringify(defaults);

  return (
    <div className="grid g2" style={{ alignItems: "start" }}>
      <form action={saveQuoteTemplateAction} className="card">
        <input type="hidden" name="key" value={submitKey} />
        <input type="hidden" name="language" value={language} />
        <label>Greeting (top of the message; leave empty for none)</label>
        <TextBox dir={dir} name="greeting" rows={2} value={t.greeting} onChange={(v) => setT({ ...t, greeting: v })} />
        <label>Each aircraft</label>
        <TextBox dir={dir} name="block" rows={11} value={t.block} onChange={(v) => setT({ ...t, block: v })} />
        <p className="small muted" style={{ margin: "2px 0 8px" }}>
          Write it the way you want it to look. Select words and tap B, I or U to style them (WhatsApp shows *bold* and _italic_). Change a label, reorder the lines, add your own lines. The words in curly brackets are filled in from the aircraft. A line whose fields are all empty is left out; the line with {"{price}"} always stays.
        </p>
        <label>Closing (bottom of the message; leave empty for none)</label>
        <TextBox dir={dir} name="closing" rows={2} value={t.closing} onChange={(v) => setT({ ...t, closing: v })} />
        <div className="row">
          <div><label>WIFI: yes</label><input dir={dir} name="yes" value={t.yes} onChange={set("yes")} /></div>
          <div><label>WIFI: no</label><input dir={dir} name="no" value={t.no} onChange={set("no")} /></div>
          <div><label>WIFI: to be confirmed</label><input dir={dir} name="tbc" value={t.tbc} onChange={set("tbc")} /></div>
        </div>
        <label>Seats wording (optional, use {"{n}"} for the number, for example “{"{n}"} seats”)</label>
        <input dir={dir} name="seats" value={t.seats} onChange={set("seats")} placeholder="Leave empty for the standard wording" />
        {problem && <div className="flash err" style={{ marginTop: 8 }}>{problem}</div>}
        <p className="row" style={{ alignItems: "center", marginTop: 12 }}>
          <span style={{ flex: "0 0 auto" }}><button type="submit" disabled={!!problem}>Save wording</button></span>
          <span style={{ flex: "0 0 auto" }}>
            <button type="submit" className="secondary" formAction={resetQuoteTemplateAction} disabled={!saved && !changed} formNoValidate>Back to standard</button>
          </span>
        </p>
      </form>

      <div>
        <div className="card">
          <h3>Fields you can use</h3>
          <table style={{ width: "auto" }}>
            <tbody>
              {TEMPLATE_PLACEHOLDERS.map((p) => (
                <tr key={p.key}>
                  <td><code>{`{${p.key}}`}</code></td>
                  <td className="small muted">{p.help}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h3>Preview</h3>
          <p className="small muted">Two made-up aircraft. The second has no refurbishment year and no notes, so those lines disappear.</p>
          <div className="row small">
            {(["operator", "tail", "base", "notes"] as const).map((k) => (
              <label key={k} style={{ margin: 0, flex: "0 0 auto" }}><input type="checkbox" checked={show[k]} onChange={(e) => setShow({ ...show, [k]: e.target.checked })} /> {k}</label>
            ))}
          </div>
          <pre className="cardtext" dir={dir} style={{ whiteSpace: "pre-wrap" }}>{preview ? <Styled text={preview} /> : "Fix the problem above to see the preview."}</pre>
        </div>
      </div>
    </div>
  );
}
