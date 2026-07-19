import { useCallback, useEffect, useState } from "react";
import {
  EXPLORE_URL_PRESETS_CHANGE_EVENT,
  loadExploreUrlPresets,
  removeExploreUrlPreset,
  upsertExploreUrlPreset,
} from "./exploreUrlPresetsStore.js";

export function useExploreUrlPresets() {
  const [presets, setPresets] = useState(loadExploreUrlPresets);

  useEffect(() => {
    const onChange = () => setPresets(loadExploreUrlPresets());
    window.addEventListener(EXPLORE_URL_PRESETS_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(EXPLORE_URL_PRESETS_CHANGE_EVENT, onChange);
  }, []);

  const savePreset = useCallback((urls, presetId) => {
    const row = upsertExploreUrlPreset(urls, presetId);
    setPresets(loadExploreUrlPresets());
    return row;
  }, []);

  const deletePreset = useCallback((id) => {
    removeExploreUrlPreset(id);
    setPresets(loadExploreUrlPresets());
  }, []);

  return { presets, savePreset, deletePreset };
}
