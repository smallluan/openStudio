import { AgentMode } from "./modes.js";

/**
 * @typedef {{ x: number; y: number }} NormPoint
 * @typedef {{
 *   id: string;
 *   bounds: { x: number; y: number; w: number; h: number };
 *   defaultAnchors: NormPoint[];
 *   preferredModes?: import("./modes.js").AgentModeValue[];
 * }} StudioZone
 */

/** @type {StudioZone[]} */
export const ZONE_REGISTRY = [
  {
    id: "workstation",
    bounds: { x: 4, y: 8, w: 28, h: 38 },
    defaultAnchors: [{ x: 16, y: 28 }],
    preferredModes: [AgentMode.THINKING, AgentMode.WORKING, AgentMode.IDLE],
  },
  {
    id: "tea",
    bounds: { x: 34, y: 6, w: 28, h: 28 },
    defaultAnchors: [{ x: 48, y: 18 }],
    preferredModes: [AgentMode.BREAK],
  },
  {
    id: "lounge",
    bounds: { x: 30, y: 48, w: 38, h: 40 },
    defaultAnchors: [{ x: 48, y: 66 }],
    preferredModes: [AgentMode.BREAK, AgentMode.ENTERTAINMENT],
  },
  {
    id: "server_nook",
    bounds: { x: 68, y: 6, w: 28, h: 32 },
    defaultAnchors: [{ x: 80, y: 22 }],
    preferredModes: [AgentMode.WORKING],
  },
  {
    id: "library",
    bounds: { x: 62, y: 50, w: 34, h: 42 },
    defaultAnchors: [{ x: 78, y: 68 }],
    preferredModes: [AgentMode.ENTERTAINMENT, AgentMode.THINKING],
  },
];

/** @param {string} id */
export function getZoneById(id) {
  return ZONE_REGISTRY.find((z) => z.id === id) ?? null;
}

/**
 * 根据模式选默认分区（阶段 B 可被每只虾的配置覆盖）
 * @param {import("./modes.js").AgentModeValue} mode
 */
export function pickZoneIdForMode(mode) {
  if (mode === AgentMode.OFFLINE) return "workstation";
  const hit = ZONE_REGISTRY.find((z) => z.preferredModes?.includes(mode));
  return hit?.id ?? "lounge";
}
