import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useI18n } from "./I18nContext.jsx";

const MODEL_PROVIDER_IDS = /** @type {const} */ ([
  "openai",
  "anthropic",
  "google",
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
          const matched = loaded.find((x) => x.id === nextActive);
          const pick = matched ?? loaded[0] ?? null;

          setProfiles(loaded);
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
    if (wasEmpty) setActiveId(id);
    setFeedback(null);
  }, [profiles.length]);

  const removeProfile = useCallback(
    /** @param {string} pid */
    (pid) => {
      const next = profiles.filter((p) => p.id !== pid);
      setProfiles(next);
      setSelectedId((s) => (s === pid ? next[0]?.id ?? "" : s));
      setActiveId((a) => (a === pid ? next[0]?.id ?? "" : a));
      setFeedback(null);
    },
    [profiles],
  );

  const toggleActiveSwitch = useCallback(
    /** @param {string} pid @param {boolean} on */
    (pid, on) => {
      if (on) setActiveId(pid);
      else if (activeId === pid) setActiveId("");
      setFeedback(null);
    },
    [activeId],
  );

  const validateForSave = useCallback(() => {
    if (profiles.length === 0) return null;
    const ap = profiles.find((p) => p.id === activeId);
    if (!ap) return { kind: "err", text: t("userConfig.validationPickActive") };
    if (!MODEL_PROVIDER_IDS.includes(/** @type {*} */ (ap.provider))) {
      return { kind: "err", text: t("userConfig.validationPickProvider") };
    }
    if (!String(ap.modelId ?? "").trim()) return { kind: "err", text: t("userConfig.validationNeedModelId") };
    return null;
  }, [activeId, profiles, t]);

  const save = useCallback(async () => {
    setFeedback(null);
    const v = validateForSave();
    if (v) {
      setFeedback(v);
      return;
    }

    const sendProfiles = [...profiles];
    let sendActive = activeId;
    if (sendProfiles.length === 1) sendActive = sendProfiles[0].id;

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
          baseUrl: provider === "openai-compatible" ? baseUrl.trim() : "",
        })),
        activeModelProfileId: sendProfiles.length === 0 ? "" : sendActive || "",
        openclaw: openclawPatch,
      };

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

      const ra = typeof c?.activeModelProfileId === "string" ? c.activeModelProfileId.trim() : "";
      const pick = nextProfiles.find((x) => x.id === ra) ?? nextProfiles[0];

      setProfiles(nextProfiles);
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
  }, [activeId, apiKey, chatLabLeanPlugins, gateway, gatewayToken, profiles, sessionKey, t, validateForSave]);

  const clearFeedback = useCallback(() => setFeedback(null), []);

  const value = useMemo(
    () => ({
      MODEL_PROVIDER_IDS,
      profiles,
      selectedId,
      setSelectedId,
      activeId,
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
