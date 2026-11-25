"use client";

import { useMemo, useState } from "react";
import TextBox, { Styled } from "./TextBox";
import { useT } from "./uiLang";
import { resetQuoteTemplateAction, saveQuoteTemplateAction } from "../actions";
import { TEMPLATE_PLACEHOLDERS, buildQuote, validateQuoteTemplate, type QuoteAircraft, type QuoteLanguage, type QuoteTemplate } from "@/domain/quote";

// Two made-up aircraft, so the preview shows how several aircraft look and how an empty value drops its line.
const SAMPLE: QuoteAircraft[] = [
  { type: "Gulfstream G550", yom: 2013, yor: 2020, capacity: 13, wifi: "yes", wifiDetail: "at USD 10/MB", smoking: "no", pets: "yes", cleaningFee: "USD 500", tail: "B-XXX", operator: "Sample Jet", base: "Hong Kong", notes: "Subject to owner's approval", price: "USD 5,200 per hour" },
  { type: "Bombardier Global 6000", yom: 2015, yor: null, capacity: 14, wifi: "no", tail: "B-YYY", operator: "Sample Jet", base: "Singapore", notes: null, price: "" },
];

export default function QuoteTemplateEditor({ language, defaults, saved, submitKey }: { submitKey: string; language: QuoteLanguage; defaults: QuoteTemplate; saved: Partial<QuoteTemplate> | null }) {
  const t = useT();
  const [tpl, setT] = useState<QuoteTemplate>({ ...defaults, ...(saved ?? {}) });
  const [show, setShow] = useState({ operator: true, tail: true, base: true, notes: true });
  const set = (k: keyof QuoteTemplate) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setT({ ...tpl, [k]: e.target.value });
  const problem = validateQuoteTemplate(tpl);
  const preview = useMemo(
    () => (problem ? "" : buildQuote(SAMPLE, { language, template: tpl, greeting: true, includeOperator: show.operator, includeTail: show.tail, includeBase: show.base, includeNotes: show.notes })),
    [tpl, language, problem, show],
  );
  const dir = language === "ar" ? "rtl" : "ltr";
  const changed = JSON.stringify(tpl) !== JSON.stringify(defaults);

  return (
    <div className="grid g2" style={{ alignItems: "start" }}>
      <form action={saveQuoteTemplateAction} className="card">
        <input type="hidden" name="key" value={submitKey} />
        <input type="hidden" name="language" value={language} />
        <label>{t("Greeting (top of the message; leave empty for none)")}</label>
        <TextBox dir={dir} name="greeting" rows={2} value={tpl.greeting} onChange={(v) => setT({ ...tpl, greeting: v })} />
        <label>{t("Each aircraft")}</label>
        <TextBox dir={dir} name="block" rows={11} value={tpl.block} onChange={(v) => setT({ ...tpl, block: v })} />
        <p className="small muted" style={{ margin: "2px 0 8px" }}>
          {t("Write it the way you want it to look. Select words and tap B, I or U to style them (WhatsApp shows *bold* and _italic_). Change a label, reorder the lines, add your own lines. The words in curly brackets are filled in from the aircraft. A line whose fields are all empty is left out; the line with {price} always stays.")}
        </p>
        <label>{t("Closing (bottom of the message; leave empty for none)")}</label>
        <TextBox dir={dir} name="closing" rows={2} value={tpl.closing} onChange={(v) => setT({ ...tpl, closing: v })} />
        <div className="row">
          <div><label>{t("WIFI: yes")}</label><input dir={dir} name="yes" value={tpl.yes} onChange={set("yes")} /></div>
          <div><label>{t("WIFI: no")}</label><input dir={dir} name="no" value={tpl.no} onChange={set("no")} /></div>
          <div><label>{t("WIFI: to be confirmed")}</label><input dir={dir} name="tbc" value={tpl.tbc} onChange={set("tbc")} /></div>
        </div>
        <label>{t("Seats wording (optional, use {n} for the number, for example “{n} seats”)")}</label>
        <input dir={dir} name="seats" value={tpl.seats} onChange={set("seats")} placeholder={t("Leave empty for the standard wording")} />
        <div className="grid g2">
          <div><label>{t("Routing heading (quotes made for a request)")}</label><input dir={dir} name="routing" value={tpl.routing} onChange={set("routing")} /></div>
          <div><label>{t("Times in the routing")}</label>
            <select name="times" value={tpl.times} onChange={(e) => setT({ ...tpl, times: e.target.value })}>
              <option value="utc">{t("Local and UTC: Dep 16:30 LT (08:30 UTC)")}</option>
              <option value="local">{t("Local only: Dep 16:30 LT")}</option>
            </select>
          </div>
        </div>
        {problem && <div className="flash err" style={{ marginTop: 8 }}>{t(problem)}</div>}
        <p className="row" style={{ alignItems: "center", marginTop: 12 }}>
          <span style={{ flex: "0 0 auto" }}><button type="submit" disabled={!!problem}>{t("Save wording")}</button></span>
          <span style={{ flex: "0 0 auto" }}>
            <button type="submit" className="secondary" formAction={resetQuoteTemplateAction} disabled={!saved && !changed} formNoValidate>{t("Back to standard")}</button>
          </span>
        </p>
      </form>

      <div>
        <div className="card">
          <h3>{t("Fields you can use")}</h3>
          <table style={{ width: "auto" }}>
            <tbody>
              {TEMPLATE_PLACEHOLDERS.map((p) => (
                <tr key={p.key}>
                  <td><code>{`{${p.key}}`}</code></td>
                  <td className="small muted">{t(p.help)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h3>{t("Preview")}</h3>
          <p className="small muted">{t("Two made-up aircraft. The second has no refurbishment year and no notes, so those lines disappear.")}</p>
          <div className="row small">
            {(["operator", "tail", "base", "notes"] as const).map((k) => (
              <label key={k} style={{ margin: 0, flex: "0 0 auto" }}><input type="checkbox" checked={show[k]} onChange={(e) => setShow({ ...show, [k]: e.target.checked })} /> {k === "operator" ? t("operator") : k === "tail" ? t("tail") : k === "base" ? t("base") : t("notes")}</label>
            ))}
          </div>
          <pre className="cardtext" dir={dir} style={{ whiteSpace: "pre-wrap" }}>{preview ? <Styled text={preview} /> : t("Fix the problem above to see the preview.")}</pre>
        </div>
      </div>
    </div>
  );
}
