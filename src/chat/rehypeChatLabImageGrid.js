/** @typedef {import('hast').Element} HastElement */
/** @typedef {import('hast').ElementContent} HastElementContent */
/** @typedef {import('hast').Root} HastRoot */

/**
 * @param {HastElement} node
 * @returns {HastElement[] | null}
 */
function loneImagesInParagraph(node) {
  if (node.type !== "element" || node.tagName !== "p") return null;
  /** @type {HastElement[]} */
  const imgs = [];
  for (const ch of node.children ?? []) {
    if (ch.type === "text" && !String(ch.value ?? "").trim()) continue;
    if (ch.type === "element" && ch.tagName === "img") {
      imgs.push(ch);
      continue;
    }
    return null;
  }
  return imgs.length ? imgs : null;
}

/**
 * @param {HastElementContent} node
 * @returns {HastElement[] | null}
 */
function imagesFromBlock(node) {
  if (node.type !== "element") return null;
  if (node.tagName === "img") return [node];
  return loneImagesInParagraph(node);
}

/**
 * @param {HastElement} img
 * @returns {{ src: string; alt: string }}
 */
function imageRefFromNode(img) {
  const src = typeof img.properties?.src === "string" ? img.properties.src : "";
  const alt = typeof img.properties?.alt === "string" ? img.properties.alt : "";
  return { src, alt };
}

/**
 * @param {HastElement} node
 */
function isImageGridNode(node) {
  if (node.type !== "element") return false;
  const cn = node.properties?.className;
  const classes = Array.isArray(cn) ? cn : cn ? [cn] : [];
  return classes.some((c) => String(c).startsWith("chat-lab__md-image-grid"));
}

/**
 * @param {HastElementContent[]} nodes
 */
function groupImageRuns(nodes) {
  if (!Array.isArray(nodes) || nodes.length === 0) return;

  let i = 0;
  while (i < nodes.length) {
    /** @type {HastElement[]} */
    const run = [];
    let j = i;
    while (j < nodes.length) {
      const batch = imagesFromBlock(nodes[j]);
      if (!batch) break;
      run.push(...batch);
      j++;
    }

    if (run.length === 0) {
      i++;
      continue;
    }

    const count = Math.min(run.length, 9);
    const images = run.slice(0, 9).map(imageRefFromNode);
    /** @type {HastElement} */
    const grid = {
      type: "element",
      tagName: "div",
      properties: {
        className: ["chat-lab__md-image-grid", `chat-lab__md-image-grid--count-${count}`],
        dataImages: JSON.stringify(images),
      },
      children: [],
    };

    nodes.splice(i, j - i, grid);
    i++;
  }
}

/**
 * @param {HastElementContent[] | undefined} nodes
 * @param {boolean} [insideGrid]
 */
function processChildren(nodes, insideGrid = false) {
  if (!Array.isArray(nodes)) return;
  if (!insideGrid) groupImageRuns(nodes);
  for (const node of nodes) {
    if (node.type !== "element" || !Array.isArray(node.children)) continue;
    processChildren(node.children, insideGrid || isImageGridNode(node));
  }
}

/**
 * Group consecutive `![…](url)` blocks into a compact WeChat-Moments-style grid.
 * @returns {() => (tree: HastRoot) => void}
 */
export function rehypeChatLabImageGrid() {
  return (tree) => {
    if (!tree?.children) return;
    processChildren(tree.children);
  };
}
