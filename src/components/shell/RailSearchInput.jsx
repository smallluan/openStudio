import SearchSparkleIcon from "../../assets/svg/SearchSparkleIcon.jsx";
import { useI18n } from "../../context/I18nContext.jsx";
import { cn } from "../../ui/cn.js";

/**
 * @param {{
 *   value: string;
 *   onChange: (v: string) => void;
 *   narrow?: boolean;
 *   className?: string;
 * }} props
 */
export default function RailSearchInput({ value, onChange, narrow = false, className }) {
  const { t } = useI18n();

  if (narrow) {
    return (
      <div
        className={cn("rail-search rail-search--narrow flex min-w-0 flex-1 justify-center", className)}
        title={t("nav.railSearchPlaceholder")}
      >
        <span className="rail-search__pill rail-search__pill--icononly">
          <SearchSparkleIcon className="text-[var(--os-rail-text-muted)]" />
        </span>
      </div>
    );
  }

  return (
    <div className={cn("rail-search rail-search--wide min-w-0 flex-1", className)}>
      <label className="rail-search__pill">
        <SearchSparkleIcon className="text-[var(--os-rail-text-faint)]" />
        <input
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t("nav.railSearchPlaceholder")}
          className="rail-search__field"
          autoComplete="off"
          spellCheck={false}
        />
      </label>
    </div>
  );
}
