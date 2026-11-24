import "./toy.css";

/** Toy's expressions (TOY-04). Show a state only when it is true: working while a request is pending, completed only after the backend confirms. */
export type ToyState = "ready" | "listening" | "working" | "completed" | "needsHelp" | "goodbye";

const INK = "#293C43";
const YELLOW = "#E4B66C";

/**
 * The one Toy character (TOY-02), drawn once for every screen. 100 x 100 viewBox, so size it with `size` only.
 * Pass `label` when Toy carries meaning on its own; leave it out when the SVG is decoration (it is then hidden from assistive technology).
 */
export default function Toy({ state = "ready", size = 96, label, waves = false, className }: {
  state?: ToyState;
  size?: number;
  label?: string;
  /** Side waves, for `listening` only, and only while voice capture really is running. */
  waves?: boolean;
  className?: string;
}) {
  const happy = state === "completed" || state === "goodbye";
  const tilt = state === "needsHelp" ? -6 : state === "goodbye" ? 6 : 0;
  return (
    <svg
      className={["toy", className].filter(Boolean).join(" ")}
      data-state={state}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 100"
      width={size}
      height={size}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true, focusable: false })}
    >
      <g transform={tilt ? `rotate(${tilt} 50 50)` : undefined}>
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
    </svg>
  );
}
