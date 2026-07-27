import { useCallback, useEffect, useState } from "react";
import { Button } from "@open-studio/udesign";
import { RefreshCw, Trash2 } from "lucide-react";
import { useI18n } from "../../context/I18nContext.jsx";

/**
 * @typedef {{
 *   domain: string;
 *   cookieCount: number;
 *   persistentCookieCount: number;
 *   sessionCookieCount: number;
 *   secureCookieCount: number;
 *   httpOnlyCookieCount: number;
 *   sampleNames: string[];
 * }} PersistedWebAccountRow
 */

/** @param {{ children: import("react").ReactNode }} props */
function TablePanel({ children }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[color-mix(in_srgb,var(--os-border)_84%,transparent)] bg-[color-mix(in_srgb,var(--os-bg-elevated)_97%,var(--os-bg-subtle))]">
      {children}
    </div>
  );
}

export default function WebAccountSettingsSection() {
  const { t } = useI18n();
  const bridge = typeof window !== "undefined" ? window.studioBridge : undefined;
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [clearingDomain, setClearingDomain] = useState("");
  const [error, setError] = useState("");
  const [rows, setRows] = useState(/** @type {PersistedWebAccountRow[]} */ ([]));

  const supported = Boolean(
    bridge?.listPersistedWebAccounts &&
      bridge?.clearPersistedWebAccount &&
      bridge?.clearAllPersistedWebAccounts,
  );

  const loadAccounts = useCallback(async () => {
    if (!supported) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await bridge.listPersistedWebAccounts();
      if (res?.ok && Array.isArray(res.accounts)) {
        setRows(res.accounts);
      } else {
        setRows([]);
        setError(String(res?.error || "load_failed"));
      }
    } catch (e) {
      setRows([]);
      setError(String(e?.message || e || "load_failed"));
    } finally {
      setLoading(false);
    }
  }, [bridge, supported]);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  const handleClearDomain = useCallback(
    async (domain) => {
      if (!domain || !supported || clearing) return;
      const ok = window.confirm(t("settings.accounts.clearOneConfirm", { domain }));
      if (!ok) return;
      setClearing(true);
      setClearingDomain(domain);
      setError("");
      try {
        const res = await bridge.clearPersistedWebAccount({ domain });
        if (!res?.ok) setError(String(res?.error || "clear_failed"));
      } catch (e) {
        setError(String(e?.message || e || "clear_failed"));
      } finally {
        setClearing(false);
        setClearingDomain("");
      }
      await loadAccounts();
    },
    [bridge, clearing, loadAccounts, supported, t],
  );

  const handleClearAll = useCallback(async () => {
    if (!supported || clearing) return;
    const ok = window.confirm(t("settings.accounts.clearAllConfirm"));
    if (!ok) return;
    setClearing(true);
    setClearingDomain("__all__");
    setError("");
    try {
      const res = await bridge.clearAllPersistedWebAccounts();
      if (!res?.ok) setError(String(res?.error || "clear_all_failed"));
    } catch (e) {
      setError(String(e?.message || e || "clear_all_failed"));
    } finally {
      setClearing(false);
      setClearingDomain("");
    }
    await loadAccounts();
  }, [bridge, clearing, loadAccounts, supported, t]);

  const panelMessageClassName =
    "flex flex-1 items-center justify-center px-4 py-6 text-center text-[0.875rem] text-[var(--os-text-muted)]";

  return (
    <div className="web-account-settings mx-auto flex h-full min-h-0 w-full flex-col gap-3">
      <div className="flex shrink-0 items-center justify-end gap-2">
        <Button
          type="button"
          variant="text"
          size="small"
          icon={<RefreshCw size={14} strokeWidth={1.75} aria-hidden />}
          disabled={loading || clearing || !supported}
          onClick={() => void loadAccounts()}
        >
          {t("settings.accounts.refresh")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="small"
          icon={<Trash2 size={14} strokeWidth={1.75} aria-hidden />}
          disabled={loading || clearing || rows.length === 0}
          onClick={() => void handleClearAll()}
        >
          {t("settings.accounts.clearAll")}
        </Button>
      </div>

      {!supported ? (
        <TablePanel>
          <p className={panelMessageClassName}>{t("settings.accounts.unsupported")}</p>
        </TablePanel>
      ) : loading ? (
        <TablePanel>
          <p className={panelMessageClassName}>{t("settings.accounts.loading")}</p>
        </TablePanel>
      ) : rows.length === 0 ? (
        <TablePanel>
          <p className={panelMessageClassName}>{t("settings.accounts.empty")}</p>
        </TablePanel>
      ) : (
        <TablePanel>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <table className="w-full border-collapse text-left text-[0.8125rem]">
              <thead className="sticky top-0 z-[1] bg-[color-mix(in_srgb,var(--os-bg-elevated)_98%,var(--os-bg-subtle))] text-[var(--os-text-faint)] shadow-[inset_0_-1px_0_color-mix(in_srgb,var(--os-border)_52%,transparent)]">
                <tr>
                  <th className="px-4 py-2.5 font-medium sm:px-5">{t("settings.accounts.colDomain")}</th>
                  <th className="px-3 py-2.5 font-medium text-right tabular-nums">
                    {t("settings.accounts.colCookieCount")}
                  </th>
                  <th className="px-3 py-2.5 font-medium text-right tabular-nums">
                    {t("settings.accounts.colPersistent")}
                  </th>
                  <th className="px-3 py-2.5 font-medium text-right tabular-nums">
                    {t("settings.accounts.colSession")}
                  </th>
                  <th className="px-4 py-2.5 text-right font-medium sm:px-5">{t("settings.accounts.colActions")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const busy = clearing && clearingDomain === row.domain;
                  const sample =
                    Array.isArray(row.sampleNames) && row.sampleNames.length > 0 ? row.sampleNames.join(", ") : "";
                  return (
                    <tr
                      key={row.domain}
                      className="border-t border-[color-mix(in_srgb,var(--os-border)_52%,transparent)]"
                      title={sample ? `${t("settings.accounts.sampleCookies")}: ${sample}` : undefined}
                    >
                      <td className="px-4 py-3 text-[var(--os-text)] sm:px-5">
                        <div className="truncate font-medium" title={row.domain}>
                          {row.domain}
                        </div>
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-[var(--os-text-muted)]">
                        {row.cookieCount}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-[var(--os-text-muted)]">
                        {row.persistentCookieCount}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-[var(--os-text-muted)]">
                        {row.sessionCookieCount}
                      </td>
                      <td className="px-4 py-3 text-right sm:px-5">
                        <Button
                          type="button"
                          variant="text"
                          size="small"
                          disabled={clearing || loading}
                          onClick={() => void handleClearDomain(row.domain)}
                        >
                          {busy ? t("settings.accounts.clearing") : t("settings.accounts.clearOne")}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </TablePanel>
      )}

      {error ? (
        <p className="shrink-0 text-[0.8125rem] text-[var(--os-danger,#b91c1c)]">
          {t("settings.accounts.errorPrefix")} {error}
        </p>
      ) : null}
    </div>
  );
}
