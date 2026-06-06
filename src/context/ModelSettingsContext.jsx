import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useI18n } from "./I18nContext.jsx";

const MODEL_PROVIDER_IDS = /** @type {const} */ ([
  "openai",
  "anthropic",
  "google",
  "deepseek",
  "openai-compatible",
]);

/** @typedef {typeof MODEL_PROVIDER_IDS[number]} ModelProviderId */

/** @typedef {{
 *   id: string;
 *   label: string;
 *   provider: ModelProviderId | "";
 *   modelId: string;
 *   baseUrl: string;
 * }} ModelProfileDraft */

/** @returns {string} */
function newProfileId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `prof_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

/** @type {import("react").Context<object | null>} */
const ModelSettingsContext = createContext(null);

export function ModelSettingsProvider({ children }) {
  const { t } = useI18n();
  const [profiles, setProfiles] = useState(/** @type {ModelProfileDraft[]} */ ([]));
  const [selectedId, setSelectedId] = useState("");
  const [activeId, setActiveId] = useState("");
  const [enabledIds, setEnabledIds] = useState(/** @type {string[]} */ ([]));
  const [apiKey, setApiKey] = useState("");
  const [gateway, setGateway] = useState("http://127.0.0.1:18789");
  const [gatewayToken, setGatewayToken] = useState("");
  const [hasGatewayToken, setHasGatewayToken] = useState(false);
  const [chatLabLeanPlugins, setChatLabLeanPlugins] = useState(false);
  const [sessionKey, setSessionKey] = useState("agent:dev:dev");
  const [hasKey, setHasKey] = useState(false);
  const [feedback, setFeedback] = useState(/** @type {{ kind: "ok" | "err"; text: string } | null} */ (null));

  const providerOptionsWithUnset = useMemo(
    () => [
      { value: "", label: t("userConfig.providerUnsetOption") },
      ...MODEL_PROVIDER_IDS.map((id) => ({
        value: id,
        label: t(`userConfig.providerOptions.${id}`),
      })),
    ],
    [t],
  );

  const selectedProfile = profiles.find((p) => p.id === selectedId) ?? null;

  const patchSelected = useCallback(
    /** @param {Partial<ModelProfileDraft>} patch */
    (patch) => {
      const sid = selectedId;
      setProfiles((prev) =>
        prev.map((p) => (p.id === sid ? /** @type {ModelProfileDraft} */ ({ ...p, ...patch }) : p)),
      );
    },
    [selectedId],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const c = await window.studioBridge?.getUserConfig?.();
        if (!cancelled && c) {
          const list = Array.isArray(c.modelProfiles) ? c.modelProfiles : [];
          /** @type {ModelProfileDraft[]} */
          const loaded = list.map((row) => ({
            id: String(row.id ?? newProfileId()),
            label: typeof row.label === "string" ? row.label : "",
            provider:
              MODEL_PROVIDER_IDS.includes(/** @type {*} */ (row.provider)) ?
                /** @type {ModelProviderId} */ (row.provider)
              : "",
            modelId: typeof row.modelId === "string" ? row.modelId : "",
            baseUrl: typeof row.baseUrl === "string" ? row.baseUrl : "",
          }));
          let nextActive = typeof c.activeModelProfileId === "string" ? c.activeModelProfileId.trim() : "";
          const enabledFromConfig = Array.isArray(c.enabledModelProfileIds)
            ? c.enabledModelProfileIds
                .map((x) => (typeof x === "string" ? x.trim() : ""))
                .filter((id, i, arr) => id && arr.indexOf(id) === i && loaded.some((p) => p.id === id))
            : [];
          const enabled = enabledFromConfig.length > 0
            ? enabledFromConfig
            : (nextActive && loaded.some((x) => x.id === nextActive)
                ? [nextActive]
                : (loaded[0]?.id ? [loaded[0].id] : []));
          const matched = enabled.length > 0 && enabled.includes(nextActive)
            ? loaded.find((x) => x.id === nextActive)
            : null;
          const pick = matched ?? (enabled.length > 0 ? loaded.find((x) => x.id === enabled[0]) : null);

          setProfiles(loaded);
          setEnabledIds(enabled);
          setActiveId(pick?.id ?? "");
          setSelectedId(pick?.id ?? "");
          setGateway(c.openclaw?.gatewayBaseUrl ?? "http://127.0.0.1:18789");
          setHasGatewayToken(Boolean(c.openclaw?.hasGatewayToken));
          setGatewayToken("");
          setChatLabLeanPlugins(Boolean(c.openclaw?.chatLabLeanPlugins));
          setSessionKey(
            typeof c.openclaw?.sessionKey === "string" && c.openclaw.sessionKey.trim()
              ? c.openclaw.sessionKey.trim()
              : "agent:dev:dev",
          );
          setHasKey(Boolean(c.credentials?.hasProviderApiKey));
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const addProfile = useCallback(() => {
    const id = newProfileId();
    const wasEmpty = profiles.length === 0;
    setProfiles((prev) => [...prev, { id, label: "", provider: "", modelId: "", baseUrl: "" }]);
    setSelectedId(id);
    if (wasEmpty) {
      setEnabledIds([id]);
      setActiveId(id);
    }
    setFeedback(null);
  }, [profiles.length]);

  const removeProfile = useCallback(
    /** @param {string} pid */
    (pid) => {
      const next = profiles.filter((p) => p.id !== pid);
      setProfiles(next);
      setEnabledIds((ids) => {
        const keep = ids.filter((id) => id !== pid && next.some((p) => p.id === id));
        setActiveId((a) => {
          if (a === pid) return keep[0] ?? "";
          if (a && keep.includes(a)) return a;
          return keep[0] ?? "";
        });
        return keep;
      });
      setSelectedId((s) => (s === pid ? next[0]?.id ?? "" : s));
      setFeedback(null);
    },
    [profiles],
  );

  const toggleActiveSwitch = useCallback(
    /** @param {string} pid @param {boolean} on */
    (pid, on) => {
      setEnabledIds((ids) => {
        const has = ids.includes(pid);
        let next = ids;
        if (on && !has) next = [...ids, pid];
        if (!on && has) next = ids.filter((id) => id !== pid);
        if (!on && activeId === pid) {
          setActiveId(next[0] ?? "");
        } else if (on && !activeId) {
          setActiveId(pid);
        }
        return next;
      });
      setFeedback(null);
    },
    [activeId],
  );

  const setDefaultProfile = useCallback(
    /** @param {string} pid */
    (pid) => {
      if (!pid) return;
      setEnabledIds((ids) => (ids.includes(pid) ? ids : [...ids, pid]));
      setActiveId(pid);
      setFeedback(null);
    },
    [],
  );

  const validateForSave = useCallback(() => {
    if (profiles.length === 0) return null;
    if (enabledIds.length === 0) return { kind: "err", text: t("userConfig.validationNeedEnabled") };
    const ap = profiles.find((p) => p.id === activeId);
    if (!ap || !enabledIds.includes(ap.id)) return { kind: "err", text: t("userConfig.validationPickActive") };
    if (!MODEL_PROVIDER_IDS.includes(/** @type {*} */ (ap.provider))) {
      return { kind: "err", text: t("userConfig.validationPickProvider") };
    }
    if (!String(ap.modelId ?? "").trim()) return { kind: "err", text: t("userConfig.validationNeedModelId") };
    return null;
  }, [activeId, enabledIds, profiles, t]);

  const save = useCallback(async () => {
    setFeedback(null);
    const v = validateForSave();
    if (v) {
      setFeedback(v);
      return;
    }

    const sendProfiles = [...profiles];
    const sendEnabled = enabledIds.filter((id) => sendProfiles.some((p) => p.id === id));
    let sendActive = sendEnabled.includes(activeId) ? activeId : (sendEnabled[0] ?? "");

    try {
      /** @type {{ gatewayBaseUrl: string; gatewayToken?: string; chatLabLeanPlugins?: boolean; sessionKey: string }} */
      const openclawPatch = {
        gatewayBaseUrl: gateway.trim(),
        chatLabLeanPlugins,
        sessionKey: sessionKey.trim() || "agent:dev:dev",
      };
      if (gatewayToken.trim() !== "") openclawPatch.gatewayToken = gatewayToken.trim();

      const patch = {
        modelProfiles: sendProfiles.map(({ id, label, provider, modelId, baseUrl }) => ({
          id,
          label,
          provider: MODEL_PROVIDER_IDS.includes(/** @type {*} */ (provider)) ? provider : "",
          modelId: modelId.trim(),
          baseUrl: (provider === "openai-compatible" || provider === "deepseek") ? baseUrl.trim() : "",
        })),
        enabledModelProfileIds: sendEnabled,
        activeModelProfileId: sendEnabled.length === 0 ? "" : sendActive || "",
        openclaw: openclawPatch,
      };
      if (sendProfiles.length > 0 && sendEnabled.length === 0) {
        setFeedback({ kind: "err", text: t("userConfig.validationNeedEnabled") });
        return;
      }

      if (apiKey.trim() !== "") {
        patch.credentials = { providerApiKey: apiKey.trim() };
      }

      await window.studioBridge?.setUserConfig?.(patch);

      const c = await window.studioBridge?.getUserConfig?.();
      const list = Array.isArray(c?.modelProfiles) ? c.modelProfiles : [];
      /** @type {ModelProfileDraft[]} */
      const nextProfiles = list.map((row) => ({
        id: String(row.id ?? newProfileId()),
        label: typeof row.label === "string" ? row.label : "",
        provider:
          MODEL_PROVIDER_IDS.includes(/** @type {*} */ (row.provider)) ?
            /** @type {ModelProviderId} */ (row.provider)
          : "",
        modelId: typeof row.modelId === "string" ? row.modelId : "",
        baseUrl: typeof row.baseUrl === "string" ? row.baseUrl : "",
      }));
      const nextEnabled = Array.isArray(c?.enabledModelProfileIds)
        ? c.enabledModelProfileIds
            .map((x) => (typeof x === "string" ? x.trim() : ""))
            .filter((id, i, arr) => id && arr.indexOf(id) === i && nextProfiles.some((p) => p.id === id))
        : (nextProfiles[0]?.id ? [nextProfiles[0].id] : []);

      const ra = typeof c?.activeModelProfileId === "string" ? c.activeModelProfileId.trim() : "";
      const pick = ra && nextEnabled.includes(ra)
        ? nextProfiles.find((x) => x.id === ra)
        : (nextEnabled.length > 0 ? nextProfiles.find((x) => x.id === nextEnabled[0]) : null);

      setProfiles(nextProfiles);
      setEnabledIds(nextEnabled);
      setActiveId(pick?.id ?? "");
      setSelectedId((prev) => (nextProfiles.some((x) => x.id === prev) ? prev : (pick?.id ?? "")));

      setApiKey("");
      setGatewayToken("");
      setHasGatewayToken(Boolean(c?.openclaw?.hasGatewayToken));
      setChatLabLeanPlugins(Boolean(c?.openclaw?.chatLabLeanPlugins));
      setSessionKey(
        typeof c?.openclaw?.sessionKey === "string" && c.openclaw.sessionKey.trim()
          ? c.openclaw.sessionKey.trim()
          : "agent:dev:dev",
      );
      setHasKey(Boolean(c?.credentials?.hasProviderApiKey));
      setFeedback({ kind: "ok", text: t("userConfig.savedOk") });
    } catch (e) {
      setFeedback({ kind: "err", text: t("userConfig.saveFailed", { message: String(e?.message ?? e) }) });
    }
  }, [activeId, apiKey, chatLabLeanPlugins, enabledIds, gateway, gatewayToken, profiles, sessionKey, t, validateForSave]);

  const clearFeedback = useCallback(() => setFeedback(null), []);

  const value = useMemo(
    () => ({
      MODEL_PROVIDER_IDS,
      profiles,
      selectedId,
      setSelectedId,
      activeId,
      enabledIds,
      setDefaultProfile,
      selectedProfile,
      apiKey,
      setApiKey,
      gateway,
      setGateway,
      gatewayToken,
      setGatewayToken,
      hasGatewayToken,
      chatLabLeanPlugins,
      setChatLabLeanPlugins,
      sessionKey,
      setSessionKey,
      hasKey,
      feedback,
      providerOptionsWithUnset,
      patchSelected,
      addProfile,
      removeProfile,
      toggleActiveSwitch,
      save,
      clearFeedback,
    }),
    [
      activeId,
      addProfile,
      apiKey,
      chatLabLeanPlugins,
      clearFeedback,
      enabledIds,
      feedback,
      gateway,
      gatewayToken,
      hasGatewayToken,
      hasKey,
      patchSelected,
      profiles,
      providerOptionsWithUnset,
      removeProfile,
      save,
      selectedId,
      selectedProfile,
      setDefaultProfile,
      sessionKey,
      setSelectedId,
      toggleActiveSwitch,
    ],
  );

  return <ModelSettingsContext.Provider value={value}>{children}</ModelSettingsContext.Provider>;
}

export function useModelSettings() {
  const ctx = useContext(ModelSettingsContext);
  if (!ctx) throw new Error("useModelSettings requires ModelSettingsProvider");
  return ctx;
}

/** @param {ModelProfileDraft} p */
/** @returns {string} */
export function modelProfileSummaryLine(p, /** @type {(key: string) => string} */ tr) {
  const provKnown = MODEL_PROVIDER_IDS.includes(/** @type {*} */ (p.provider));
  const prov = provKnown ? tr(`userConfig.providerOptions.${p.provider}`) : "";
  const mid = String(p.modelId ?? "").trim();
  if (!prov && !mid) return tr("userConfig.profileSummaryEmpty");
  if (!prov) return mid;
  return mid ? `${prov} · ${mid}` : prov;
}
