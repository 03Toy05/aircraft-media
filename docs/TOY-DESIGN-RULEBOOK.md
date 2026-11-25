# Toy Design Rulebook
Version 1.4 | 25 November 2026 | Approved design direction

## TOY-01 — Identity and purpose
Toy is the personal aircraft media assistant of Aircraft Media (aircraftmedia.my), the founder's first creation developed with the help of AI. The product itself does not use generative AI for Toy's commands at launch. Toy is the interface, not merely a decorative mascot. It helps aviation charter brokers and does not replace their judgment.

Toy is also the Aircraft Media logo: the plain ready-state character is the brand mark (`public/logo.svg`), shown beside the name "Aircraft Media". There is no separate logo.

Canonical messages:
- Brand philosophy: **Everything begins as a Toy.**
- Customer promise: **Every broker deserves an assistant.**
- Practical benefit: **Less admin. More brokering.**
- Vision: **Small beginning. Useful and reliable product. Bigger possibilities.**

## TOY-02 — Character geometry
Use the approved little block: a rounded yellow square, two vertical dark eyes and a minimal curved mouth. No arms, legs, clothing, realistic face or humanoid body. Do not add antennas, aircraft or other accessories; aviation is conveyed by what Toy does and where it appears, not by objects attached to it. The one exception is the retractable wings in TOY-11. A head tilt is reserved for greeting (see TOY-04); a short bounce conveys playfulness. Use one reusable SVG/React component with a state prop; do not create independent drawings for each screen. Canonical ready-state geometry (100 × 100 viewBox):
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
  <rect x="10" y="10" width="80" height="80" rx="24" fill="#E4B66C"/>
  <rect x="30" y="30" width="8" height="18" rx="4" fill="#293C43"/>
  <rect x="62" y="30" width="8" height="18" rx="4" fill="#293C43"/>
  <path d="M40 63 Q50 73 60 63" stroke="#293C43" stroke-width="3" fill="none" stroke-linecap="round"/>
</svg>
```
Preserve proportions at every size. Use the same character on light and dark backgrounds. Provide accessible text when meaningful; hide purely decorative SVG from assistive technology.

**Shadow.** A soft shadow may sit under Toy in larger, standalone placements (website hero, video, sign-in page): an Ink ellipse at about 13% opacity, centred under the body (`cx 50, cy 102, rx 30, ry 4.5` in a 100 × 110 viewBox). It stays on the ground when Toy bounces. It is decoration, never part of the identity, and is not used at icon sizes (favicon, app header, chat).

## TOY-03 — Color and typography
| Token | Hex | Use |
|---|---|---|
| Toy yellow | #E4B66C | Character body |
| Ink | #293C43 | Face, primary text and controls |
| Canvas | #F8F7F2 | Warm background |
| Sage | #ADC5B8 | Secondary accents |
Use white for the response surface. Use existing application typography where suitable; otherwise a clean system sans-serif. Maintain WCAG AA text/control contrast; sage and yellow are not default text colors on white. Avoid gradients, stock aviation decoration and unnecessary visual effects.

## TOY-04 — State and motion
| State | Expression | Trigger |
|---|---|---|
| Greeting | Curved happy eyes, smile, head tilted about 8° (top leaning left), one short bounce | Toy says hello: the public site's opening screen, returning to the start, the video introduction |
| Ready | Open eyes, smile, upright | Idle / available |
| Listening | Taller eyes, optional side waves | Actual voice capture active. Spoken commands are suspended for now, so Listening is not shown until they return |
| Working | Ready face (open eyes, smile) with wings out, lifted slightly | Actual request pending |
| Completed | Curved happy eyes, smile, upright, one short bounce | Confirmed successful result |
| Needs help | Slight tilt the other way (about 6°), small round mouth | Missing input, ambiguity or failure requiring attention |
| Goodbye | Curved happy eyes, smile, upright, one short bounce | Explicit farewell / video ending |
| Takeoff, Landing | See TOY-11 | Transitions into Working (request accepted) and out of it (success confirmed) |
Only Greeting tilts as an expression of happiness; Needs help keeps its slight lean so it reads as puzzled. Never signal success before the backend confirms it. Errors must include readable explanations. Motion is subtle, CSS/SVG-based; honor prefers-reduced-motion. No perpetual distracting animation. No fake listening or processing. Implementation defaults: 150–250 ms transitions (the tilt eases in over 200 ms), one short bounce on Greeting, Completed and Goodbye, optional occasional blink in Ready.

## TOY-05 — Voice and language
Friendly, short, practical and accurate. First person is appropriate. Examples: “Hi, I'm Toy.” “What can I help you with?” “Give me a moment.” “Done! Here are your aircraft photos.” “Which operator do you mean?” “I couldn't find that aircraft.” “I can't do that yet.” “See you soon!”
Do not invent facts, promise unsupported functionality, claim unfinished work is complete or impersonate a human. English, Traditional Chinese and Simplified Chinese are the launch language direction; keep translations equivalent and distinguish browser speech recognition from AI. Spoken commands are suspended for now: do not advertise or show them on the website, in the app or in the demo until the owner brings them back. Recorded narration for the demo is separate from runtime functionality.

## TOY-06 — Intelligence and authority
Public website V1: predefined questions and deterministic responses only. Later: deterministic text matching; AI only in a separately approved future phase. Existing authenticated application: preserve current fixed-pattern typed commands and authoritative domain functions (spoken commands suspended for now; see TOY-05). No new LLM integration or paid model calls for launch. Any mention of AI in marketing must be accurate: Toy was created with the help of AI, but do not claim Toy's commands use generative AI while they do not. AI may later interpret requests, but the backend owns facts, validation, permissions and writes. Maintain consistent entities, actions, relationships and events; do not duplicate authoritative records or bypass existing access controls.

## TOY-07 — Shared interface
Reuse the same character, state vocabulary, messages and design tokens across public site, authenticated dashboard, mobile, onboarding, demo and marketing. Keep existing app workflows and navigation available. Integrate Toy visually without rebuilding the backend. Map UI states to actual command outcomes; no duplicate execution paths.

The one implementation is `app/_components/Toy.tsx` (motion in `app/_components/toy.css`): `state` (the TOY-04 states), `size`, `label` (accessible name; omit when decorative), `shadow` (TOY-02) and `waves` (Listening only).

## TOY-08 — Public navigation
Concept A: single-screen conversational interface. Greeting, character, central response panel, four predefined questions: “What can you do?”, “Show me how”, “How it begins”, “How much?”. Clicking changes the central panel, not page scroll position. Toy shows Greeting on the opening screen and Ready once a question is chosen; clicking Toy or the logo returns to the greeting. Sign-in and subscription remain directly accessible. Mobile and zoom may scroll when needed for accessibility. Text input is a later phase, not V1.

## TOY-09 — Evolution
Toy remains the little block even as its supported tasks expand. Future assistants may have distinct identities. No public CBOS branding at launch. Do not imply future PDF quotation or AI capabilities are available today.

## TOY-10 — Governance
This file is the authoritative Toy design reference. Website and video handoffs reference it rather than redefine it. Keep version history; propose material changes to the owner before implementation. Reuse existing components where possible. Verify actual behavior and visual consistency, not unnecessary new architecture or audit layers.

## TOY-11 — Aviation identity
Toy stays the original yellow rounded block (TOY-02), with two approved aviation cues: **retractable wings** and **flight movements**. This is a narrow exception to TOY-02's ban on accessories: only these wings are permitted. No permanent wings, pilot costume, arms, legs or realistic aircraft body. TOY-04 remains authoritative for what each state means; this rule only adds how Toy moves between them.

**Wings.** Drawn behind the block, hidden while Toy is on the ground and extending/retracting horizontally (about 180 ms). Same yellow as the body with a thin darker edge. Geometry (block coordinates): left `M15 52 L-15 70 Q-20 76 -8 77 L20 71 Z`, right `M85 52 L115 70 Q120 76 108 77 L80 71 Z`.

**Scene.** In the full scene (320 × 200, block at 110,70) Toy rests above a **solid ground line** (y 174) and a **dashed runway centreline** (y 182, dash 16 10); both stay still. A **dotted curved flight path** (sage, dash 5 6, round caps) appears only in flight. These three lines are the only aviation decoration (TOY-03 still bans the rest: no radar, spinner, stock aircraft). Use the full scene on the public home page and in the demo; use the compact block (no ground or runway) in dense application areas such as the dashboard chat. No layout shift as states change.

| Visual state | Actual trigger | Motion |
|---|---|---|
| Ready | Idle | Wings hidden, resting on the ground |
| Greeting | Public home opening screen, video intro | Website: one-time arrival along a fading dotted path, wings retract, then the greeting tilt (TOY-04). Decorative only; makes no task claim |
| Listening | Voice capture actually active (suspended for now) | Taller eyes, side waves, grounded |
| Takeoff | An existing request was accepted and is pending | Wings extend, rises and tilts; 420 ms at most |
| Working | The same request is still pending | Airborne with the trail, ready face, two gentle banks, then still; the readable status beside Toy says it is working |
| Landing | The backend confirmed success | Descends with happy eyes; 360 ms at most |
| Completed | The success result is shown | Wings retract, one short bounce |
| Needs help | Failure, rejection or missing input | Grounded, wings retracted, slight lean, with a readable explanation beside it |
| Goodbye | Explicit farewell or the scripted demo ending | Wings extend and Toy departs along the dotted path |

**Honesty.** Movement follows the real request, never the reverse. Results are shown the moment they arrive; animations never delay them. No landing on a failure. Never fly because a timer runs or someone is reading. Public predefined questions change instantly, with no flight. New request, cancellation or unmount cancels pending visual steps; a stale reply never moves Toy. With reduced motion, skip Takeoff and Landing and show Working or Completed directly, with no animation.

**Accessibility.** The SVG is decorative wherever a readable status text sits beside it (for example "Toy is working on it…" in the chat, announced politely).

## TOY-12 — Typography
Rounded geometric identity approved. Preserve the fonts, sizes and typography already used on the existing website; do not migrate fonts or resize the website. Earlier Nunito / Manrope / IBM Plex Mono and Noto Sans TC/SC proposals are design references only where compatible with the existing implementation. Use compact aviation values and readable localized labels. No new font dependencies for branding.

## TOY-13 — Mobile design principle
Spacious interaction, compact information. Prioritize phone use, comfortable touch targets, readable text and natural scrolling where necessary. Keep aircraft data compact. This principle does not authorize a website redesign or font-size changes.

## TOY-14 — Brand signature and meaning
Canonical text remains **Everything begins as a Toy.** Replace only the visible final period with a tiny custom gold SVG airplane (`public/brand/airplane.svg`, gold #C2934D): inline immediately after "Toy", baseline aligned, width and height 0.35em, margin-left 0.045em, vertical-align -0.015em, rotated 40 degrees clockwise from nose-up. No emoji, fixed text coordinates, overlap with the "y", or extra visible period. Keep the normal period in accessible and plain text.

Chinese: Traditional **一切從Toy開始**, Simplified **一切从Toy开始**; the airplane replaces the final 。 (accessible text keeps it). Toy's Chinese self-introduction is **我是Toy**.

Signature animation: static punctuation by default; on explicit playback or a one-time scripted transition (the public site plays it once when "How it begins" opens), the airplane flies along a curved path starting at the punctuation's centre, revealing individual round sage dots progressively behind it along the same path. The trail stays visible at the end. No looping; reduced motion keeps the static punctuation. Reference duration 2600 ms; no backend dependency. Implementation: `app/_components/BrandSignature.tsx`.

Standalone assets (`public/brand/`): 01 Foundation to flight (`foundation-to-flight.svg`) and 02 The journey (`the-journey.svg`) only; the underline (`brand-underline.svg`). Solid ink #293C43, sage #ADC5B8, round dotted stroke 2.5, dash array 1 6. The wordmark variation 03 is rejected.

Combined composition: the centred master. Character scene viewBox 0 0 340 175, block centred at x170, shadow x170 y148, ground M90 160 H250, runway M95 168 H245. The two-line statement is centred beneath it with the inline airplane punctuation. Underline in a separate centred 340 × 40 viewBox: solid M40 26 H195; dotted M195 26 Q255 26 307 10. Do not shift, shorten or re-centre these paths independently. The vision statement and the existing wordmark are centred beneath. Scale the whole composition proportionally. Production draws Toy with the master component (TOY-02), not the reference drawing in `centered-toy.svg`.

Meaning: Toy = beginning of creation; solid line = reliability and foundation; dotted line = exploration and possibilities; small airplane = aviation and moving forward; takeoff = the beginning of a journey. Reuse the approved assets in marketing, video and quotation branding where appropriate; no changes to quotation data or workflows.

## Version history
| Version | Date | Changes (approved by the owner) |
|---|---|---|
| 1.0 | 24 November 2026 | First approved direction. |
| 1.1 | 25 November 2026 | Toy is the Aircraft Media logo (TOY-01). Soft shadow defined for larger placements; aircraft and other accessories considered and declined (TOY-02). New Greeting state; head tilt reserved for Greeting; Completed and Goodbye stay upright with one bounce; Needs help leans the other way (TOY-04). Spoken commands suspended for now; Listening not shown and voice not advertised (TOY-04, TOY-05, TOY-06). "No AI claims" replaced by "AI claims must be accurate" (TOY-06). Component reference added (TOY-07). Public site Greeting/Ready behaviour (TOY-08). |
| 1.2 | 25 November 2026 | TOY-11 Aviation identity added: retractable wings (the one accessory exception to TOY-02) and flight movements with solid ground, dashed runway and dotted flight path; Takeoff and Landing transitions (TOY-04). |
| 1.3 | 25 November 2026 | Working now shows the ready face with wings out instead of flat eyes and three dots (TOY-04, TOY-11). |
| 1.4 | 25 November 2026 | Owner's final v1.2 package merged: TOY-12 Typography, TOY-13 Mobile principle, TOY-14 Brand signature (airplane punctuation, progressive dotted takeoff, centred composition, locked line geometry, approved SVG assets). Chinese brand line 一切從Toy開始 / 一切从Toy开始 and greeting 我是Toy. Decisions from 1.1–1.3 kept where the package differed (working face, greeting tilt, Toy logo, voice suspended, accurate AI wording). |
