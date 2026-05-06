/** Skills / capabilities — stacked sparkles */
export default function NavSkillIcon({ className }) {
  return (
    <svg className={className} width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3.2l.7 2.2a2.6 2.6 0 001.9 1.8l2.2.7-2.2.7a2.6 2.6 0 00-1.9 1.8L12 12l-.7-2.2a2.6 2.6 0 00-1.9-1.8l-2.2-.7 2.2-.7a2.6 2.6 0 001.9-1.8l.7-2.2Z"
        fill="currentColor"
        fillOpacity="0.14"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinejoin="round"
      />
      <path
        d="M17.8 14.3l.45 1.35a1.55 1.55 0 001.1 1l1.35.45-1.35.45a1.55 1.55 0 00-1.1 1l-.45 1.35-.45-1.35a1.55 1.55 0 00-1.1-1l-1.35-.45 1.35-.45a1.55 1.55 0 001.1-1l.45-1.35Z"
        fill="var(--os-accent)"
        fillOpacity="0.22"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
      <path
        d="M6.4 15.6l.35 1.05a1.2 1.2 0 00.85.8l1.05.35-1.05.35a1.2 1.2 0 00-.85.8l-.35 1.05-.35-1.05a1.2 1.2 0 00-.85-.8l-1.05-.35 1.05-.35a1.2 1.2 0 00.85-.8l.35-1.05Z"
        fill="currentColor"
        fillOpacity="0.35"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinejoin="round"
      />
    </svg>
  );
}
