/** 龙虾行为/动画的高层模式（可随阶段 B 扩展） */
export const AgentMode = /** @type {const} */ ({
  IDLE: "idle",
  THINKING: "thinking",
  WORKING: "working",
  BREAK: "break",
  ENTERTAINMENT: "entertainment",
  OFFLINE: "offline",
});

/** @typedef {(typeof AgentMode)[keyof typeof AgentMode]} AgentModeValue */
