import Link from "next/link";
import type { Metadata } from "next";
import BrandComposition from "./BrandComposition";

// A preview page for the brand composition and the two standalone graphics (TOY-14); kept out of search engines.
export const metadata: Metadata = {
  title: "Everything begins as a Toy — Aircraft Media",
  icons: { icon: "/toy.svg" },
  robots: { index: false, follow: false },
};

export default function BrandPage() {
  return (
    <div className="toy-site">
      <header className="site-head">
        <Link className="site-brand" href="/welcome">
          <span className="site-brand-name">aircraftmedia.my</span>
          <span className="site-brand-tag"> — A little help for aviation.</span>
        </Link>
      </header>
      <main className="brand-page">
        <BrandComposition />
        <section className="brand-assets" aria-label="Brand graphics">
          <figure>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/foundation-to-flight.svg" alt="A solid line that turns into a dotted flight path, ending in a small airplane" />
            <figcaption>01 — Foundation to flight</figcaption>
          </figure>
          <figure>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/the-journey.svg" alt="A curved dotted flight path ending in a small airplane" />
            <figcaption>02 — The journey</figcaption>
          </figure>
        </section>
      </main>
    </div>
  );
}
