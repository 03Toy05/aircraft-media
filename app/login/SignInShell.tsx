import Link from "next/link";
import Toy, { type ToyState } from "../_components/Toy";
import { LangSwitch } from "../_components/uiLang";
import "./signin.css";

/**
 * The frame shared by the sign-in pages (TOY brand, approved canvas design): Toy above a white card on the warm canvas,
 * the language switch in the card's corner, Privacy and Terms underneath. Only the look lives here; each page keeps its
 * own forms, actions and messages.
 */
export default function SignInShell({ title, intro, toy = "ready", langSwitch = true, footer, children }: {
  title: string;
  intro?: React.ReactNode;
  toy?: ToyState;
  langSwitch?: boolean;
  footer: { privacy: string; terms: string };
  children: React.ReactNode;
}) {
  return (
    <div className="signin-page">
      <main className="signin-main">
        <div className="signin-card">
          {langSwitch && <div className="signin-lang"><LangSwitch /></div>}
          <div className="signin-head">
            <Link href="/" className="signin-toy" aria-label="aircraftmedia.my"><Toy state={toy} size={64} shadow /></Link>
            <h1>{title}</h1>
            {intro && <p className="signin-intro">{intro}</p>}
          </div>
          {children}
        </div>
        <p className="signin-foot"><Link href="/privacy">{footer.privacy}</Link> · <Link href="/terms">{footer.terms}</Link></p>
      </main>
    </div>
  );
}
