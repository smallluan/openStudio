import { useEffect, useState } from "react";
import { getClientPlatform } from "./skillAvailability.js";

/** @typedef {{ platform: string; availableBins: string[]; loading: boolean }} SkillEnvironmentState */

/** @returns {SkillEnvironmentState} */
export function useSkillEnvironment() {
  const [env, setEnv] = useState(() => ({
    platform: getClientPlatform(),
    availableBins: /** @type {string[]} */ ([]),
    loading: Boolean(typeof window !== "undefined" && window.studioBridge?.getSkillEnvironment),
  }));

  useEffect(() => {
    const load = window.studioBridge?.getSkillEnvironment;
    if (!load) {
      setEnv((prev) => ({ ...prev, loading: false }));
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const data = await load();
        if (cancelled) return;
        setEnv({
          platform: data?.platform || getClientPlatform(),
          availableBins: Array.isArray(data?.availableBins) ? data.availableBins : [],
          loading: false,
        });
      } catch {
        if (!cancelled) setEnv((prev) => ({ ...prev, loading: false }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return env;
}
