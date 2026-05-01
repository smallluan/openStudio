/** Settings — slider motif */
export default function NavSettingsIcon({ className }) {
  return (
    <svg className={className} width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M6 7h12M6 12h12M6 17h12" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeOpacity="0.35" />
      <circle cx="15.5" cy="7" r="2.2" fill="currentColor" fillOpacity="0.12" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="8.8" cy="12" r="2.2" fill="currentColor" fillOpacity="0.12" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="13.2" cy="17" r="2.2" fill="var(--os-accent)" fillOpacity="0.22" stroke="var(--os-accent)" strokeWidth="1.2" />
      <circle cx="15.5" cy="7" r="0.55" fill="var(--os-accent)" />
      <circle cx="8.8" cy="12" r="0.55" fill="currentColor" fillOpacity="0.85" />
      <circle cx="13.2" cy="17" r="0.55" fill="var(--os-accent)" />
    </svg>
  );
}
