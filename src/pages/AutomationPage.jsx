import { useState } from "react";
import { Button, Input } from "@open-studio/udesign";
import OsEmpty from "../ui/OsEmpty.jsx";
import { Plus } from "lucide-react";
import taskHero from "../assets/images/task-hero.png";
import SearchSparkleIcon from "../assets/svg/SearchSparkleIcon.jsx";
import { useI18n } from "../context/I18nContext.jsx";
import { cn } from "../ui/cn.js";

export default function AutomationPage() {
  const { t } = useI18n();
  const [query, setQuery] = useState("");

  return (
    <div className="route-page route-page--plain flex min-h-0 flex-1 flex-col bg-[color-mix(in_srgb,var(--os-bg-base)_96%,var(--os-bg-panel))]">
      <section className="mb-6 flex shrink-0 flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <h1 className="text-[1.65rem] font-semibold tracking-tight text-[var(--os-text)]">
            {t("automationPage.heroTitle")}
          </h1>
          <p className="max-w-lg text-[0.875rem] leading-relaxed text-[var(--os-text-muted)]">
            {t("automationPage.heroDesc")}
          </p>
          <div className="pt-1">
            <Button type="button" theme="primary" icon={<Plus size={16} />}>
              {t("automationPage.heroCreate")}
            </Button>
          </div>
        </div>
        <div className="flex shrink-0 items-center justify-center lg:justify-end">
          <img
            src={taskHero}
            alt=""
            className="h-auto max-h-[min(220px,32vw)] w-full max-w-[min(360px,88vw)] object-contain"
          />
        </div>
      </section>

      <div className="mb-4 flex shrink-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-[1.05rem] font-semibold text-[var(--os-text)]">{t("automationPage.listTitle")}</h2>
        <div className="w-full min-w-[220px] max-w-md sm:w-72">
          <Input
            type="search"
            prefixIcon={<SearchSparkleIcon className="opacity-75" aria-hidden />}
            clearable
            value={query}
            onChange={(value) => setQuery(value)}
            placeholder={t("automationPage.searchPlaceholder")}
            aria-label={t("automationPage.searchPlaceholder")}
          />
        </div>
      </div>

      <div className={cn("min-h-0 flex-1 overflow-auto pb-10", "flex items-center justify-center pb-0")}>
        <OsEmpty description={t("automationPage.emptyList")} />
      </div>
    </div>
  );
}
