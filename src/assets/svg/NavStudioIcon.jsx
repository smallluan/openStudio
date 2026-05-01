/** Studio stage — custom stroke icon */
export default function NavStudioIcon({ className }) {
  return (
    <svg className={className} width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 8.2c0-1.2 1-2.2 2.2-2.2h9.6c1.2 0 2.2 1 2.2 2.2v9.1c0 .9-.7 1.6-1.6 1.6H6.6c-.9 0-1.6-.7-1.6-1.6V8.2Z"
        stroke="currentColor"
        strokeWidth="1.45"
        strokeLinejoin="round"
        fill="currentColor"
        fillOpacity="0.06"
      />
      <path
        d="M8 11h8M8 14h5.2"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeOpacity="0.55"
      />
      <circle cx="17.2" cy="7.1" r="1.25" fill="var(--os-accent)" fillOpacity="0.95" />
      <path d="M17.9 5.9l.55-1.55M18.85 7l1.45-.35" stroke="var(--os-accent)" strokeWidth="0.9" strokeLinecap="round" />
    </svg>
  );
}
