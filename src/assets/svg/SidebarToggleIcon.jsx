/** Rail fold — compact chevrons */
export default function SidebarToggleIcon({ className, collapsed }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      {collapsed ? (
        <>
          <path
            d="M10.5 7.2 14.8 12l-4.3 4.8"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M6.2 7.2 10.5 12 6.2 16.8"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeOpacity="0.35"
          />
        </>
      ) : (
        <>
          <path
            d="M13.5 7.2 9.2 12l4.3 4.8"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M17.8 7.2 13.5 12l4.3 4.8"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeOpacity="0.35"
          />
        </>
      )}
    </svg>
  );
}
