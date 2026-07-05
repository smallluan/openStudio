import { useId } from "react";

/** Brand mark — geometric claw-window motif */
export default function LogoMarkIcon({ className }) {
  const id = useId();
  const gid = `os-logo-g-${id.replace(/:/g, "")}`;

  return (
    <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
      <defs>
        <linearGradient id={gid} x1="5" y1="4" x2="19" y2="21" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8eabff" />
          <stop offset="0.45" stopColor="#366ef4" />
          <stop offset="1" stopColor="#0052d9" />
        </linearGradient>
      </defs>
      <path
        d="M12 2.8 19.2 6v7.4c0 2.6-2.5 5.2-7.2 7.4L12 21l-.8-.5c-4.8-2.2-7.4-4.8-7.4-7.5V6L12 2.8Z"
        stroke={`url(#${gid})`}
        strokeWidth="1.35"
        strokeLinejoin="round"
        fill="currentColor"
        fillOpacity="0.08"
      />
      <path
        d="M8.7 10.2c.9-.9 2.4-1.5 3.3-.7l.6.5.7-.5c.9-.8 2.4-.2 3.3.7 1 1.1 1 2.8-.1 3.8l-3.9 3.4-3.9-3.4c-1.1-1-1.1-2.7-.1-3.8Z"
        fill={`url(#${gid})`}
        fillOpacity="0.92"
      />
    </svg>
  );
}
