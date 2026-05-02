import { cn } from "../../ui/cn.js";

/** Magnifying glass with small sparkle — rail search affordance */
export default function SearchSparkleIcon({ className }) {
  return (
    <svg
      className={cn("shrink-0", className)}
      width="18"
      height="18"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden
    >
      <circle cx="8.5" cy="8.5" r="5" stroke="currentColor" strokeWidth="1.4" opacity="0.82" />
      <path d="m12.2 12.2 4.3 4.3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path
        d="M3.2 3.9 4.1 3.3l.35.9-.95.25.5.85-.9-.4-.9.4.5-.85-.95-.25.9-.6z"
        fill="currentColor"
        opacity="0.55"
      />
    </svg>
  );
}
