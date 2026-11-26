import Link from "next/link";
import { getDb } from "@/db/client";
import { requireOwner } from "@/lib/session";
import { serverT } from "@/lib/uiLang";
import { libraryScope } from "@/domain/library";
import { sampleAircraft, sampleQuoteText } from "@/domain/guide";
import { TRIAL_DAYS } from "@/domain/accounts";

/** Getting started: seven short steps, each with a "Try it" that opens Toy with an example ready (made from a real aircraft). */
export default async function Guide() {
  const s = await requireOwner();
  const t = await serverT();
  const db = await getDb();
  const sample = await sampleAircraft(db, s.actor.tenantId, await libraryScope(db, s));
  const quoteText = sampleQuoteText(sample);
  const ask = (text: string) => `/?ask=${encodeURIComponent(text)}`;
  const zh = t.lang !== "en";
  const steps: { title: string; body: string[]; try?: { href: string; label: string }; example?: string }[] = [
    {
      title: t("Your first quote in 30 seconds"),
      body: [
        t("Tell Toy the aircraft, the routing, the date, the passengers and the price, in one line. Toy finds the aircraft, adds the routing and gives you the message, the photos and a link for your client."),
        t("You can write it in English or Chinese, and in any order."),
      ],
      example: quoteText,
      try: { href: ask(quoteText), label: t("Try it") },
    },
    {
      title: t("Bigger quotes: use the template"),
      body: [
        t("Tap Template, then Quote. Fill in the legs and the options; blank lines are skipped."),
        t("Each option has a Note, for that aircraft only, e.g. “subject to owner's approval” (which also adds the owner's approval sticker). Opening and Closing replace your usual first and last lines."),
      ],
      try: { href: "/?template=quote", label: t("Open the template") },
    },
    {
      title: t("Send it"),
      body: [
        t("Copy the message, or share it with the photos to WhatsApp or another app. Each aircraft can be sent on its own."),
        t("View the quote opens the Quote page: save it as a request, then send the client link or download the PDF."),
        t("Save your clients in Contacts, then say “send it to Mr Chan”."),
      ],
      try: { href: "/contacts", label: t("Open Contacts") },
    },
    {
      title: t("Change things by just saying so"),
      body: [
        t("After a quote, write the change: a new price, a year, a note. Toy updates the quote. A change to the aircraft's details is saved only after you say yes."),
        t("When several aircraft fit (e.g. three 7X), Toy asks which one, and remembers your choice next time. Say “other 7X” to choose again."),
      ],
      example: sample ? `${sample.model} USD 110k` : "G650 USD 110k",
    },
    {
      title: t("Add your own aircraft and photos"),
      body: [
        t("Tap “Add an aircraft or photos”, fill in what you know and attach the photos or the operator's PDF. Toy asks only what's missing, and nothing is saved until you confirm."),
        t("Check the photos in Review (exterior, cabin, floor plan), then they're ready for quotes. A combined photo is made for you."),
      ],
      try: { href: "/?add=1", label: t("Add an aircraft") },
    },
    {
      title: t("Make it yours"),
      body: [
        t("In Settings: your logo and colour, and the reference format. Or upload one of your past quotes, and your PDFs come out in your own layout."),
        t("Quote wording: change the standard message once, per language."),
      ],
      try: { href: "/settings", label: t("Open Settings") },
    },
    {
      title: t("Toy remembers"),
      body: [
        t("Your conversation carries on in another tab, on your phone, or the next day. “New chat” starts afresh."),
        t("Ask “my recent quotes” or “same as last time” to pick up where you left off."),
      ],
      try: { href: ask(zh ? "最近的報價" : "my recent quotes"), label: t("Try it") },
    },
  ];
  return (
    <>
      <div className="people-head">
        <h1 style={{ margin: 0 }}>{t("Getting started with Toy")}</h1>
        <Link href="/?welcome=1" className="btn secondary small-btn">{t("Show Toy's welcome again")}</Link>
      </div>
      <p className="muted">{s.daysLeft != null ? t("Seven short steps. Your free trial has {n} days left; everything you make stays yours.", { n: s.daysLeft }) : t("Seven short steps. Each “Try it” opens Toy with an example ready: just press Send.")}</p>
      <ol className="guide">
        {steps.map((st, i) => (
          <li key={i} className="card">
            <h3 style={{ marginTop: 0 }}><span className="guide-n">{i + 1}</span> {st.title}</h3>
            {st.body.map((b, j) => <p key={j} style={{ margin: "6px 0" }}>{b}</p>)}
            {st.example && <p className="small" style={{ margin: "8px 0" }}>{t("For example:")} <code>{st.example}</code></p>}
            {st.try && <Link className="btn small-btn" href={st.try.href}>{st.try.label} →</Link>}
          </li>
        ))}
      </ol>
      <p className="small muted">{t("Questions or ideas?")} <Link href="/support">{t("Feedback and support")}</Link> · {t("Free trial: {n} days, then look-only until you choose a plan.", { n: TRIAL_DAYS })}</p>
    </>
  );
}
