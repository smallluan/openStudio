/** @typedef {"light" | "dark"} ChatLabDocTheme */

const FONT_STACK =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';

/** Base diagram label size — kept compact for chat code-block preview. */
const DIAGRAM_FONT_SIZE = "11px";
const EDGE_LABEL_FONT_SIZE = "10px";

/** @param {ChatLabDocTheme} docTheme */
function buildThemeCss(docTheme) {
  const shadow =
    docTheme === "dark"
      ? "drop-shadow(0 4px 14px rgba(0, 0, 0, 0.35))"
      : "drop-shadow(0 4px 14px rgba(15, 23, 42, 0.08))";
  const linkWidth = docTheme === "dark" ? "1.65px" : "1.75px";

  return `
    .node rect,
    .node circle,
    .node ellipse,
    .node polygon,
    .cluster rect {
      filter: ${shadow};
    }
    .node rect,
    .cluster rect {
      rx: 12px;
      ry: 12px;
    }
    .node polygon {
      stroke-linejoin: round;
    }
    .edgeLabel rect {
      rx: 7px;
      ry: 7px;
      stroke-width: 0.75px;
    }
    .flowchart-link,
    .edge-thickness-normal {
      stroke-width: ${linkWidth};
      stroke-linecap: round;
    }
    .marker {
      fill: currentColor;
    }
    .label,
    .nodeLabel,
    .edgeLabel,
    .cluster-label,
    .label span,
    .nodeLabel span,
    .edgeLabel span {
      font-family: ${FONT_STACK} !important;
      font-size: ${DIAGRAM_FONT_SIZE} !important;
      line-height: 1.35 !important;
    }
    .edgeLabel,
    .edgeLabel span {
      font-size: ${EDGE_LABEL_FONT_SIZE} !important;
    }
    .label text,
    .nodeLabel,
    .nodeLabel tspan {
      font-size: ${DIAGRAM_FONT_SIZE} !important;
      font-weight: 500;
    }
    .edgeLabel text,
    .edgeLabel tspan {
      font-size: ${EDGE_LABEL_FONT_SIZE} !important;
    }
  `;
}

/** @param {ChatLabDocTheme} docTheme */
function buildThemeVariables(docTheme) {
  if (docTheme === "dark") {
    return {
      darkMode: true,
      background: "transparent",
      fontFamily: FONT_STACK,
      fontSize: DIAGRAM_FONT_SIZE,
      primaryColor: "#2a221e",
      primaryTextColor: "#eef2f7",
      primaryBorderColor: "#b86a48",
      secondaryColor: "#1a2838",
      secondaryTextColor: "#e4ebf4",
      secondaryBorderColor: "#4f6f9a",
      tertiaryColor: "#242030",
      tertiaryTextColor: "#e8e4f2",
      tertiaryBorderColor: "#6a5a8a",
      lineColor: "#8a94a8",
      textColor: "#d8dee8",
      defaultLinkColor: "#8a94a8",
      edgeLabelBackground: "#1a2028",
      clusterBkg: "#141a22",
      clusterBorder: "#2c3644",
      titleColor: "#eef2f7",
      nodeBorder: "#b86a48",
      nodeTextColor: "#eef2f7",
    };
  }

  return {
    darkMode: false,
    background: "transparent",
    fontFamily: FONT_STACK,
    fontSize: DIAGRAM_FONT_SIZE,
    primaryColor: "#fff5ef",
    primaryTextColor: "#1a1f28",
    primaryBorderColor: "#e0a88a",
    secondaryColor: "#edf4ff",
    secondaryTextColor: "#1a2438",
    secondaryBorderColor: "#9ec0ea",
    tertiaryColor: "#f6f0ff",
    tertiaryTextColor: "#2a2240",
    tertiaryBorderColor: "#c8b8e8",
    lineColor: "#8a94a6",
    textColor: "#3a4250",
    defaultLinkColor: "#9aa3b2",
    edgeLabelBackground: "#ffffff",
    clusterBkg: "#f7f8fb",
    clusterBorder: "#dfe4ec",
    titleColor: "#1a1f28",
    nodeBorder: "#e0a88a",
    nodeTextColor: "#1a1f28",
  };
}

/**
 * Mermaid init tuned for Chat Lab — warm accent, soft pastels, rounded neo look.
 * @param {ChatLabDocTheme} docTheme
 * @returns {import("mermaid").MermaidConfig}
 */
export function getChatLabMermaidConfig(docTheme) {
  return {
    startOnLoad: false,
    securityLevel: "strict",
    theme: "base",
    look: "neo",
    fontFamily: FONT_STACK,
    themeVariables: buildThemeVariables(docTheme),
    themeCSS: buildThemeCss(docTheme),
    flowchart: {
      curve: "basis",
      padding: 10,
      htmlLabels: true,
      useMaxWidth: true,
      nodeSpacing: 34,
      rankSpacing: 42,
      wrappingWidth: 140,
    },
    sequence: {
      diagramMarginX: 12,
      diagramMarginY: 8,
      actorMargin: 48,
      boxMargin: 8,
      messageMargin: 28,
      mirrorActors: true,
      useMaxWidth: true,
    },
    gantt: {
      useMaxWidth: true,
    },
  };
}
