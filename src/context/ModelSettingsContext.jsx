import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "./I18nContext.jsx";

/** @param {string} modelId */
function inferProviderFromModelId(modelId) {
  const id = String(modelId ?? "").trim();
  if (!id) return "";
  const lc = id.toLowerCase();
  if (lc.startsWith("minimax-") || lc.startsWith("minimax/")) return "minimax";
  if (lc.startsWith("kimi-")) return "moonshot";
  if (lc.startsWith("qwen") || lc.startsWith("qwen3")) return "qwen";
  if (lc.startsWith("deepseek")) return "deepseek";
  return "";
}

const MODEL_PROVIDER_IDS = /** @type {const} */ ([
  "openai",
  "anthropic",
  "google",
  "deepseek",
  "minimax",
  "moonshot",
  "qwen",
  "openai-compatible",
  "anthropic-compatible",
]);

/** @typedef {typeof MODEL_PROVIDER_IDS[number]} ModelProviderId */

/** @typedef {{
 *   id: string;
 *   label: string;
 *   provider: ModelProviderId | "";
 *   modelId: string;
 *   baseUrl: string;
 *   minimaxRegion?: "cn" | "intl" | "";
 *   hasApiKey?: boolean;
 * }} ModelProfileDraft */

/** @returns {string} */
export function newModelProfileId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `prof_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

/** @param {ModelProfileDraft} p */
export function isModelProfilePersistable(p) {
  return MODEL_PROVIDER_IDS.includes(/** @type {*} */ (p.provider)) && Boolean(String(p.modelId ?? "").trim());
}

/** @returns {ModelProfileDraft} */
export function emptyModelProfileDraft() {
  return { id: newModelProfileId(), label: "", provider: "", modelId: "", baseUrl: "", minimaxRegion: "" };
}

/** @type {import("react").Context<object | null>} */
const ModelSettingsContext = createContext(null);

export function ModelSettingsProvider({ children }) {
  const { t } = useI18n();
  const [profiles, setProfiles] = useState(/** @type {ModelProfileDraft[]} */ ([]));
  const [enabledIds, setEnabledIds] = useState(/** @type {string[]} */ ([]));
  const [hasKey, setHasKey] = useState(false);
  const [feedback, setFeedback] = useState(/** @type {{ kind: "err"; text: string } | null} */ (null));
  const profilesRef = useRef(profiles);
  const enabledRef = useRef(enabledIds);
  profilesRef.current = profiles;
  enabledRef.current = enabledIds;

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

  const serializeProfiles = useCallback(
    /**
     * @param {ModelProfileDraft[]} list
     * @param {{ profileId?: string; apiKey?: string }} [keyPatch]
     */
    (list, keyPatch) =>
      list.map(({ id, label, provider, modelId, baseUrl, minimaxRegion }) => {
        /** @type {Record<string, unknown>} */
        const row = {
          id,
          label,
          provider: MODEL_PROVIDER_IDS.includes(/** @type {*} */ (provider)) ? provider : "",
          modelId: modelId.trim(),
          baseUrl:
            provider === "openai-compatible" || provider === "anthropic-compatible" ? baseUrl.trim() : "",
        };
        if (provider === "minimax") {
          row.minimaxRegion = minimaxRegion === "intl" ? "intl" : minimaxRegion === "cn" ? "cn" : "cn";
        }
        if (keyPatch?.profileId === id && keyPatch.apiKey?.trim()) {
          row.apiKey = keyPatch.apiKey.trim();
        }
        return row;
      }),
    [],
  );

  const persist = useCallback(
    /**
     * @param {ModelProfileDraft[]} nextProfiles
     * @param {string[]} nextEnabled
     * @param {{ apiKey?: string; profileId?: string }} [opts]
     */
    async (nextProfiles, nextEnabled, opts) => {
      const sendProfiles = serializeProfiles(nextProfiles, {
        profileId: opts?.profileId,
        apiKey: opts?.apiKey,
      });
      const sendEnabled = nextEnabled.filter((id) => sendProfiles.some((p) => p.id === id));
      const patch = {
        modelProfiles: sendProfiles,
        enabledModelProfileIds: sendEnabled,
        activeModelProfileId: sendEnabled[0] ?? sendProfiles[0]?.id ?? "",
      };
      await window.studioBridge?.setUserConfig?.(patch);
      const c = await window.studioBridge?.getUserConfig?.();
      setHasKey(Boolean(c?.credentials?.hasProviderApiKey));
      // Notify other components that user config has changed
      try {
        window.dispatchEvent(new CustomEvent("openstudio-user-config-changed"));
      } catch {
        /* ignore */
      }
    },
    [serializeProfiles],
  );

  const runPersist = useCallback(
    /**
     * @param {ModelProfileDraft[]} nextProfiles
     * @param {string[]} nextEnabled
     * @param {{ apiKey?: string; profileId?: string }} [opts]
     */
    async (nextProfiles, nextEnabled, opts) => {
      try {
        setFeedback(null);
        await persist(nextProfiles, nextEnabled, opts);
      } catch (e) {
        setFeedback({ kind: "err", text: t("userConfig.saveFailed", { message: String(e?.message ?? e) }) });
        throw e;
      }
    },
    [persist, t],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const c = await window.studioBridge?.getUserConfig?.();
        if (!cancelled && c) {
          const list = Array.isArray(c.modelProfiles) ? c.modelProfiles : [];
          /** @type {ModelProfileDraft[]} */
          const loaded = list.map((row) => {
            const modelId = typeof row.modelId === "string" ? row.modelId : "";
            const providerFromRow =
              MODEL_PROVIDER_IDS.includes(/** @type {*} */ (row.provider)) ?
                /** @type {ModelProviderId} */ (row.provider)
              : "";
            const inferred = providerFromRow || inferProviderFromModelId(modelId);
            const provider =
              MODEL_PROVIDER_IDS.includes(/** @type {*} */ (inferred)) ?
                /** @type {ModelProviderId} */ (inferred)
              : "";
            return {
              id: String(row.id ?? newModelProfileId()),
              label: typeof row.label === "string" ? row.label : "",
              provider,
              modelId,
              baseUrl: typeof row.baseUrl === "string" ? row.baseUrl : "",
              minimaxRegion: row.minimaxRegion === "intl" ? "intl" : row.minimaxRegion === "cn" ? "cn" : provider === "minimax" ? "cn" : "",
              hasApiKey: Boolean(row.hasApiKey),
            };
          });
          const legacyActive = typeof c.activeModelProfileId === "string" ? c.activeModelProfileId.trim() : "";
          const enabledFromConfig = Array.isArray(c.enabledModelProfileIds)
            ? c.enabledModelProfileIds
                .map((x) => (typeof x === "string" ? x.trim() : ""))
                .filter((id, i, arr) => id && arr.indexOf(id) === i && loaded.some((p) => p.id === id))
            : [];
          const enabled =
            enabledFromConfig.length > 0 ?
              enabledFromConfig
            : legacyActive && loaded.some((x) => x.id === legacyActive) ?
              [legacyActive]
            : loaded[0]?.id ?
              [loaded[0].id]
            : [];

          setProfiles(loaded);
          setEnabledIds(enabled);
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

  const upsertProfile = useCallback(
    /**
     * @param {ModelProfileDraft} profile
     * @param {{ apiKey?: string }} [opts]
     */
    async (profile, opts) => {
      if (!isModelProfilePersistable(profile)) {
        throw new Error("profile_invalid");
      }
      const cur = profilesRef.current;
      const exists = cur.some((p) => p.id === profile.id);
      const nextProfiles = exists ?
        cur.map((p) => (p.id === profile.id ? profile : p))
      : [...cur, profile];
      let nextEnabled = enabledRef.current;
      if (!nextEnabled.includes(profile.id)) {
        nextEnabled = [...nextEnabled, profile.id];
      }
      setProfiles(nextProfiles);
      setEnabledIds(nextEnabled);
      await runPersist(nextProfiles, nextEnabled, {
        profileId: profile.id,
        apiKey: opts?.apiKey,
      });
    },
    [runPersist],
  );

  const removeProfile = useCallback(
    /** @param {string} pid */
    async (pid) => {
      const nextProfiles = profilesRef.current.filter((p) => p.id !== pid);
      const nextEnabled = enabledRef.current.filter((id) => id !== pid && nextProfiles.some((p) => p.id === id));
      setProfiles(nextProfiles);
      setEnabledIds(nextEnabled);
      setFeedback(null);
      await runPersist(nextProfiles, nextEnabled);
    },
    [runPersist],
  );

  const toggleEnabled = useCallback(
    /** @param {string} pid @param {boolean} on */
    async (pid, on) => {
      const curEnabled = enabledRef.current;
      const has = curEnabled.includes(pid);
      let nextEnabled = curEnabled;
      if (on && !has) nextEnabled = [...curEnabled, pid];
      if (!on && has) nextEnabled = curEnabled.filter((id) => id !== pid);
      setEnabledIds(nextEnabled);
      setFeedback(null);
      await runPersist(profilesRef.current, nextEnabled);
    },
    [runPersist],
  );

  const clearFeedback = useCallback(() => setFeedback(null), []);

  const value = useMemo(
    () => ({
      MODEL_PROVIDER_IDS,
      profiles,
      enabledIds,
      hasKey,
      feedback,
      providerOptionsWithUnset,
      upsertProfile,
      removeProfile,
      toggleEnabled,
      clearFeedback,
    }),
    [
      clearFeedback,
      enabledIds,
      feedback,
      hasKey,
      profiles,
      providerOptionsWithUnset,
      removeProfile,
      toggleEnabled,
      upsertProfile,
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
