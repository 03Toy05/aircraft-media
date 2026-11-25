import "./site.css";

/** The public site: no sign-in, no database. It shares nothing with the (app) layout, which requires a signed-in user. */
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
