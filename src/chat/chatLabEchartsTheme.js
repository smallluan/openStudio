/** @typedef {"light" | "dark"} ChatLabDocTheme */

const FONT_STACK =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';

/**
 * @param {ChatLabDocTheme} theme
 */
export function getChatLabEchartsTheme(theme) {
  const isDark = theme === "dark";
  return {
    base: {
      backgroundColor: "transparent",
      color: isDark
        ? ["#8ab4ff", "#7ee787", "#f2cc60", "#ff7b72", "#d2a8ff", "#79c0ff", "#ffa657"]
        : ["#5470c6", "#91cc75", "#fac858", "#ee6666", "#73c0de", "#3ba272", "#fc8452"],
      textStyle: {
        fontFamily: FONT_STACK,
        color: isDark ? "#e6edf3" : "#2a2a2a",
      },
    },
  };
}
