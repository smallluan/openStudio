import { useI18n } from "../context/I18nContext.jsx";

/**
 * Minimal rail route placeholder — single line until the feature ships.
 *
 * @param {{ messageKey: string }} props
 */
export default function RailPlaceholderPage({ messageKey }) {
  const { t } = useI18n();
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6">
      <p className="text-sm text-[var(--os-text-muted)]">{t(messageKey)}</p>
    </div>
  );
}
