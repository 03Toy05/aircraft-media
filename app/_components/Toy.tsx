import "./toy.css";

/**
 * Toy's expressions (TOY-04) and flight transitions (TOY-11). Show a state only when it is true: takeoff/working while a
 * request is pending, landing/completed only after the backend confirms, needsHelp on a failure or missing input.
 */
export type ToyState = "greeting" | "ready" | "listening" | "takeoff" | "working" | "landing" | "completed" | "needsHelp" | "goodbye";

/** How long the takeoff and landing moves last (TOY-11). Visual only: never wait for these before showing a result. */
export const TOY_TAKEOFF_MS = 420;
export const TOY_LANDING_MS = 360;

const INK = "#293C43";
const YELLOW = "#E4B66C";

/** The dotted flight path for each move, in scene coordinates (320 x 200). Only flight states have one. */
const TRAIL: Partial<Record<ToyState, string>> = {
  greeting: "M40 30 Q130 40 160 145", // the one-time arrival on the public home page; it fades out
  takeoff: "M30 165 Q85 165 145 90",
  working: "M30 150 Q150 25 275 70",
  landing: "M30 40 Q130 50 160 145",
  goodbye: "M160 145 Q235 125 300 25",
};

/**
 * The one Toy character (TOY-02), drawn once for every screen.
 * - Compact (default): the block alone, 100 x 100 viewBox; `size` is its width. For dense places such as the chat.
 * - `scene`: the full aviation scene (TOY-11), 320 x 200 viewBox with ground, runway and flight path; `size` is the scene width.
 * Pass `label` when Toy carries meaning on its own; leave it out when a readable status sits beside it (the SVG is then hidden
 * from assistive technology). `shadow` adds the soft shadow to the compact block (the scene always has its own).
 */
export default function Toy({ state = "ready", size = 96, label, waves = false, shadow = false, scene = false, className }: {
  state?: ToyState;
  size?: number;
  label?: string;
  /** Side waves, for `listening` only, and only while voice capture really is running. */
  waves?: boolean;
  shadow?: boolean;
  scene?: boolean;
  className?: string;
}) {
  const happy = state === "greeting" || state === "landing" || state === "completed" || state === "goodbye";
  // The head tilts only to say hello, and the other way, a little less, when Toy needs help.
  const tilt = state === "greeting" ? -8 : state === "needsHelp" ? 6 : 0;
  const trail = scene ? TRAIL[state] : undefined;
  const box = scene ? { w: 320, h: 200 } : { w: 100, h: shadow ? 110 : 100 };
  return (
    <svg
      className={["toy", className].filter(Boolean).join(" ")}
      data-state={state}
      data-scene={scene ? "" : undefined}
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${box.w} ${box.h}`}
      width={size}
      height={Math.round((size * box.h) / box.w)}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true, focusable: false })}
    >
      {scene ? (
        <>
          {/* Solid ground and dashed runway centreline: always still. */}
          <path className="toy-ground" d="M15 174 H305" />
          <path className="toy-runway" d="M20 182 H300" />
          {trail && <path key={state} className="toy-trail" d={trail} />}
          <ellipse className="toy-scene-shadow" cx="160" cy="166" rx="37" ry="5" />
        </>
      ) : (
        shadow && <ellipse cx="50" cy="102" rx="30" ry="4.5" fill={INK} opacity="0.13" />
      )}
      <g className="toy-position">
        <g className="toy-bob">
          <g className="toy-head" style={{ transform: `rotate(${tilt}deg)` }}>
            {/* Retractable wings (TOY-11), behind the block; hidden on the ground. */}
            <path className="toy-wing toy-wing-left" d="M15 52 L-15 70 Q-20 76 -8 77 L20 71 Z" />
            <path className="toy-wing toy-wing-right" d="M85 52 L115 70 Q120 76 108 77 L80 71 Z" />
            <rect x="10" y="10" width="80" height="80" rx="24" fill={YELLOW} />
            <g className="toy-eyes" fill={INK}>
              {happy ? (
                <g fill="none" stroke={INK} strokeWidth="4" strokeLinecap="round">
                  <path d="M28 46 Q34 32 40 46" />
                  <path d="M60 46 Q66 32 72 46" />
                </g>
              ) : state === "working" ? (
                <>
                  <rect x="26" y="38" width="18" height="8" rx="4" />
                  <rect x="56" y="38" width="18" height="8" rx="4" />
                </>
              ) : state === "listening" ? (
                <>
                  <rect x="30" y="25" width="8" height="26" rx="4" />
                  <rect x="62" y="25" width="8" height="26" rx="4" />
                </>
              ) : (
                <>
                  <rect x="30" y="30" width="8" height="18" rx="4" />
                  <rect x="62" y="30" width="8" height="18" rx="4" />
                </>
              )}
            </g>
            {state === "working" ? (
              <g fill={INK}>
                <circle cx="40" cy="66" r="3" />
                <circle cx="50" cy="66" r="3" />
                <circle cx="60" cy="66" r="3" />
              </g>
            ) : state === "needsHelp" ? (
              <circle cx="50" cy="66" r="4" stroke={INK} strokeWidth="3" fill="none" />
            ) : (
              <path d="M40 63 Q50 73 60 63" stroke={INK} strokeWidth="3" fill="none" strokeLinecap="round" />
            )}
            {state === "listening" && waves && (
              <g fill="none" stroke={INK} strokeWidth="3" strokeLinecap="round">
                <path d="M96 40 Q101 50 96 60" />
                <path d="M4 40 Q-1 50 4 60" />
              </g>
            )}
          </g>
        </g>
      </g>
    </svg>
  );
}
