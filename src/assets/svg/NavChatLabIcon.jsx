/** Chat lab — speech bubble with a spark */
export default function NavChatLabIcon({ className }) {
  return (
    <svg className={className} width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 7.3c0-1.25 1.02-2.25 2.27-2.25h9.46C17.98 5.05 19 6.05 19 7.3v6.2c0 1.25-1.02 2.25-2.27 2.25h-4.48l-3.2 2.68a.65.65 0 0 1-1.06-.5V15.75H7.27C6.02 15.75 5 14.75 5 13.5V7.3Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
        fill="currentColor"
        fillOpacity="0.08"
      />
      <path
        d="M8.6 9.6h5.2M8.6 12h3.6"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeOpacity="0.55"
      />
      <path
        d="M17.2 4.2l.55 1.35L19.1 6.1l-1.35.55L17.2 8l-.55-1.35L15.3 6.1l1.35-.55L17.2 4.2Z"
        fill="var(--os-accent)"
        fillOpacity="0.92"
      />
    </svg>
  );
}
