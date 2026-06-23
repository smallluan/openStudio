/** @typedef {"light" | "dark"} ChatLabDocTheme */

const FONT_STACK =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';

/** Base diagram label size — kept compact for chat code-block preview. */
const DIAGRAM_FONT_SIZE = "11px";
const EDGE_LABEL_FONT_SIZE = "10px";

/** Pastel palette — washed tints aligned with Figure 2 (high brightness, low saturation). */
const FLOWCHART_PALETTE_LIGHT = {
  process: "#F5F2FD",
  startEnd: "#EDF6FD",
  action: "#FFF3E8",
  decision: "#FFFBEB",
  data: "#FEF0F0",
  accent: "#FDF0FC",
  stroke: "#333333",
  text: "#2a2a2a",
  line: "#333333",
  edgeLabelBg: "#ffffff",
};

/**
 * @param {string} pointsStr
 * @returns {{ x: number; y: number }[]}
 */
function parseSvgPoints(pointsStr) {
  const nums = pointsStr.trim().split(/[\s,]+/).map(Number);
  /** @type {{ x: number; y: number }[]} */
  const pts = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    pts.push({ x: nums[i], y: nums[i + 1] });
  }
  return pts;
}

/**
 * Mermaid parallelograms have horizontal top/bottom edges with a horizontal offset.
 * @param {string} pointsStr
 */
function isParallelogramShape(pointsStr) {
  const pts = parseSvgPoints(pointsStr);
  if (pts.length !== 4) return false;
  const byY = [...pts].sort((a, b) => a.y - b.y);
  const top = byY.slice(0, 2);
  const bottom = byY.slice(2, 4);
  const topAligned = Math.abs(top[0].y - top[1].y) < 2;
  const bottomAligned = Math.abs(bottom[0].y - bottom[1].y) < 2;
  if (!topAligned || !bottomAligned) return false;
  const leftOffset = Math.abs(top[0].x - bottom[0].x);
  const rightOffset = Math.abs(top[1].x - bottom[1].x);
  return leftOffset > 2 || rightOffset > 2;
}

/**
 * @param {SVGGraphicsElement} shape
 * @returns {boolean}
 */
function isStadiumRect(shape) {
  if (!(shape instanceof SVGRectElement)) return false;
  const rx = Number.parseFloat(shape.getAttribute("rx") ?? "0");
  const ry = Number.parseFloat(shape.getAttribute("ry") ?? "0");
  const h = Number.parseFloat(shape.getAttribute("height") ?? "0");
  return rx > 8 && ry > 8 && h > 0 && rx >= h * 0.35;
}

/**
 * @param {SVGGraphicsElement} shape
 * @param {ReturnType<typeof getFlowchartPalette>} palette
 */
function fillForShape(shape, palette) {
  const tag = shape.tagName.toLowerCase();
  if (tag === "path") return palette.data;
  if (tag === "ellipse" || tag === "circle") return palette.startEnd;
  if (tag === "rect") {
    return isStadiumRect(shape) ? palette.startEnd : palette.process;
  }
  if (tag === "polygon") {
    const points = shape.getAttribute("points") ?? "";
    return isParallelogramShape(points) ? palette.action : palette.decision;
  }
  return palette.process;
}

/**
 * @param {SVGGraphicsElement} shape
 * @param {string} fill
 * @param {string} stroke
 */
function paintShape(shape, fill, stroke) {
  shape.setAttribute("fill", fill);
  shape.setAttribute("stroke", stroke);
  shape.setAttribute("stroke-width", "1");
  shape.style.fill = fill;
  shape.style.stroke = stroke;
  shape.style.strokeWidth = "1px";
}

/**
 * Apply Figure 1 classic flowchart fills per node shape (Figure 2 palette).
 * Diagram canvas stays white in both app themes, so always use the light palette.
 * @param {string} svg
 * @param {ChatLabDocTheme} [_docTheme]
 */
export function stylizeFlowchartSvg(svg, _docTheme) {
  if (typeof DOMParser === "undefined") return svg;

  const palette = FLOWCHART_PALETTE_LIGHT;
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = doc.documentElement;
  if (root.querySelector("parsererror")) return svg;

  root.querySelectorAll(".node").forEach((node) => {
    const shape = node.querySelector("rect, polygon, ellipse, circle, path");
    if (!(shape instanceof SVGGraphicsElement)) return;
    paintShape(shape, fillForShape(shape, palette), palette.stroke);
  });

  root.querySelectorAll(".flowchart-link, .edge-pattern-solid, .edge-thickness-normal").forEach((el) => {
    if (!(el instanceof SVGElement)) return;
    el.setAttribute("stroke", palette.line);
    el.style.stroke = palette.line;
  });

  root.querySelectorAll(".marker path, .arrowheadPath").forEach((el) => {
    if (!(el instanceof SVGElement)) return;
    el.setAttribute("fill", palette.line);
    el.setAttribute("stroke", palette.line);
    el.style.fill = palette.line;
    el.style.stroke = palette.line;
  });

  root.querySelectorAll(".edgeLabel rect").forEach((el) => {
    if (!(el instanceof SVGRectElement)) return;
    el.setAttribute("fill", palette.edgeLabelBg);
    el.setAttribute("stroke", "none");
    el.style.fill = palette.edgeLabelBg;
  });

  root.querySelectorAll(".nodeLabel, .label, .edgeLabel").forEach((el) => {
    el.querySelectorAll("text, tspan, span, p").forEach((textEl) => {
      if (!(textEl instanceof Element)) return;
      textEl.setAttribute("fill", palette.text);
      if ("style" in textEl && textEl.style) {
        textEl.style.color = palette.text;
        textEl.style.fill = palette.text;
      }
    });
  });

  return new XMLSerializer().serializeToString(root);
}

/** @param {ChatLabDocTheme} docTheme */
function buildThemeCss(docTheme) {
  const palette = FLOWCHART_PALETTE_LIGHT;
  const linkWidth = "1px";

  return `
    .node rect,
    .node circle,
    .node ellipse,
    .node polygon,
    .node path,
    .cluster rect {
      filter: none;
    }
    .node rect,
    .cluster rect {
      rx: 0;
      ry: 0;
    }
    .node polygon,
    .node path {
      stroke-linejoin: miter;
    }
    .edgeLabel rect {
      rx: 2px;
      ry: 2px;
      stroke-width: 0;
    }
    .flowchart-link,
    .edge-thickness-normal {
      stroke-width: ${linkWidth};
      stroke: ${palette.line};
      stroke-linecap: butt;
    }
    .marker {
      fill: ${palette.line};
      stroke: ${palette.line};
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
      color: ${palette.text} !important;
    }
    .edgeLabel,
    .edgeLabel span {
      font-size: ${EDGE_LABEL_FONT_SIZE} !important;
    }
    .label text,
    .nodeLabel,
    .nodeLabel tspan {
      font-size: ${DIAGRAM_FONT_SIZE} !important;
      font-weight: 400;
      fill: ${palette.text} !important;
    }
    .edgeLabel text,
    .edgeLabel tspan {
      font-size: ${EDGE_LABEL_FONT_SIZE} !important;
      fill: ${palette.text} !important;
    }
  `;
}

/** @param {ChatLabDocTheme} docTheme */
function buildThemeVariables(docTheme) {
  const palette = FLOWCHART_PALETTE_LIGHT;

  return {
    darkMode: docTheme === "dark",
    background: "transparent",
    fontFamily: FONT_STACK,
    fontSize: DIAGRAM_FONT_SIZE,
    primaryColor: palette.process,
    primaryTextColor: palette.text,
    primaryBorderColor: palette.stroke,
    secondaryColor: palette.decision,
    secondaryTextColor: palette.text,
    secondaryBorderColor: palette.stroke,
    tertiaryColor: palette.startEnd,
    tertiaryTextColor: palette.text,
    tertiaryBorderColor: palette.stroke,
    lineColor: palette.line,
    textColor: palette.text,
    defaultLinkColor: palette.line,
    edgeLabelBackground: palette.edgeLabelBg,
    clusterBkg: palette.accent,
    clusterBorder: palette.stroke,
    titleColor: palette.text,
    nodeBorder: palette.stroke,
    nodeTextColor: palette.text,
    mainBkg: palette.process,
    secondBkg: palette.decision,
    tertiaryBkg: palette.startEnd,
  };
}

/**
 * Mermaid init tuned for Chat Lab — classic flowchart look, Figure 2 pastel palette.
 * @param {ChatLabDocTheme} docTheme
 * @returns {import("mermaid").MermaidConfig}
 */
export function getChatLabMermaidConfig(docTheme) {
  return {
    startOnLoad: false,
    securityLevel: "strict",
    theme: "base",
    look: "classic",
    fontFamily: FONT_STACK,
    themeVariables: buildThemeVariables(docTheme),
    themeCSS: buildThemeCss(docTheme),
    flowchart: {
      curve: "linear",
      padding: 12,
      htmlLabels: true,
      useMaxWidth: true,
      nodeSpacing: 36,
      rankSpacing: 44,
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
