import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { Button } from "@open-studio/udesign";
import { useI18n } from "../../context/I18nContext.jsx";
import Modal from "../../ui/Modal.jsx";
import ModalCloseButton from "../../ui/ModalCloseButton.jsx";
import { EXPLORE_PAGE_SCRIPT_LIFECYCLES } from "../../web-explore/explorePageScript.js";

/**
 * @typedef {import("../../web-explore/explorePageScript.js").ExploreTabPageScript} ExploreTabPageScript
 *
 * @typedef {{
 *   open: boolean;
 *   tabIndex: number;
 *   tabUrl: string;
 *   script: ExploreTabPageScript | null;
 *   inElectron: boolean;
 *   onSave: (script: ExploreTabPageScript | null) => void;
 *   onClose: () => void;
 * }} WebExplorePageScriptModalProps
 */

/**
 * @param {WebExplorePageScriptModalProps} props
 */
export default function WebExplorePageScriptModal({
  open,
  tabIndex,
  tabUrl,
  script,
  inElectron,
  onSave,
  onClose,
}) {
  const { t } = useI18n();
  const titleId = useId();
  const [lifecycle, setLifecycle] = useState(/** @type {"beforeLoad"} */ ("beforeLoad"));
  const [code, setCode] = useState("");

  useEffect(() => {
    if (!open) return;
    setLifecycle(script?.lifecycle === "beforeLoad" ? "beforeLoad" : "beforeLoad");
    setCode(script?.code ?? "");
  }, [open, script]);

  const lifecycleOptions = useMemo(
    () =>
      EXPLORE_PAGE_SCRIPT_LIFECYCLES.map((value) => ({
        value,
        label: t(`webExplorePage.pageScriptLifecycle.${value}`),
      })),
    [t],
  );

  const handleSave = useCallback(() => {
    const trimmed = String(code ?? "").trim();
    if (!trimmed) {
      onSave(null);
      return;
    }
    onSave({ lifecycle: "beforeLoad", code: trimmed });
  }, [code, onSave]);

  const handleClear = useCallback(() => {
    onSave(null);
  }, [onSave]);

  if (!open) return null;

  return (
    <Modal className="web-explore-page-script-modal" labelledBy={titleId} onClose={onClose} width="760px">
      <div className="flex min-h-0 w-full flex-col">
        <div className="flex items-start justify-between gap-3 border-b border-[color-mix(in_srgb,var(--os-border)_50%,transparent)] px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold text-[var(--os-text)]">
              {t("webExplorePage.pageScriptTitle")}
            </h2>
            <p className="mt-1 truncate text-xs text-[var(--os-text-muted)]" title={tabUrl}>
              {t("webExplorePage.pageScriptTabMeta", { index: tabIndex + 1, url: tabUrl || t("webExplorePage.newTab") })}
            </p>
          </div>
          <ModalCloseButton />
        </div>

        <div className="web-explore-page-script-modal__body flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
          {!inElectron ? (
            <p className="text-sm text-[var(--os-text-muted)]">{t("webExplorePage.pageScriptHintBrowser")}</p>
          ) : (
            <p className="text-sm text-[var(--os-text-muted)]">{t("webExplorePage.pageScriptHintElectron")}</p>
          )}

          <label className="web-explore-page-script-modal__field">
            <span className="web-explore-page-script-modal__field-label">
              {t("webExplorePage.pageScriptLifecycleLabel")}
            </span>
            <select
              className="web-explore-page-script-modal__select"
              value={lifecycle}
              onChange={(e) => setLifecycle(/** @type {"beforeLoad"} */ (e.target.value))}
              disabled={!inElectron}
            >
              {lifecycleOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>

          <label className="web-explore-page-script-modal__field web-explore-page-script-modal__field--code">
            <span className="web-explore-page-script-modal__field-label">
              {t("webExplorePage.pageScriptCodeLabel")}
            </span>
            <textarea
              className="web-explore-page-script-modal__textarea"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={t("webExplorePage.pageScriptCodePlaceholder")}
              spellCheck={false}
              rows={14}
              disabled={!inElectron}
            />
          </label>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-[color-mix(in_srgb,var(--os-border)_50%,transparent)] px-5 py-3">
          <Button type="button" variant="text" size="small" onClick={handleClear} disabled={!inElectron}>
            {t("webExplorePage.pageScriptClear")}
          </Button>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="small" onClick={onClose}>
              {t("webExplorePage.pageScriptCancel")}
            </Button>
            <Button type="button" variant="primary" size="small" onClick={handleSave} disabled={!inElectron}>
              {t("webExplorePage.pageScriptSave")}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
