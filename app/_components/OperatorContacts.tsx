/** An operator's website, email and sales contact, as links. Nothing (or `empty`) when none is set. */
export default function OperatorContacts({ o, empty }: { o: { website: string | null; email: string | null; salesContact: string | null }; empty?: string }) {
  if (!o.website && !o.email && !o.salesContact) return empty ? <p className="small muted" style={{ margin: 0 }}>{empty}</p> : null;
  const site = o.website && /^https?:\/\//i.test(o.website) ? o.website : null;
  return (
    <div className="op-contacts small">
      {site && <span><a href={site} target="_blank" rel="noopener noreferrer">{site.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "")}</a></span>}
      {o.email && <span><a href={`mailto:${o.email}`}>{o.email}</a></span>}
      {o.salesContact && <span className="op-sales"><span className="muted">Sales:</span> {o.salesContact}</span>}
    </div>
  );
}
