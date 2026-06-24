/** @typedef {import("hast").Element} HastElement */
/** @typedef {import("hast").ElementContent} HastElementContent */
/** @typedef {import("hast").Root} HastRoot */

import { findLocalPathSpansInText } from "./chatLabSelectionAddress.js";

const SKIP_ANCESTORS = new Set(["a", "code", "pre", "script", "style", "kbd", "samp", "textarea", "button"]);

/**
 * @param {HastElement[]} ancestors
 */
function shouldSkipAncestors(ancestors) {
  return ancestors.some((node) => node.type === "element" && SKIP_ANCESTORS.has(node.tagName));
}

/**
 * @param {HastElement} parent
 * @param {HastElement[]} ancestors
 */
function processElementChildren(parent, ancestors) {
  const children = parent.children;
  if (!Array.isArray(children)) return;

  let i = 0;
  while (i < children.length) {
    const child = children[i];
    if (child.type === "element" && Array.isArray(child.children)) {
      processElementChildren(child, [...ancestors, child]);
      i++;
      continue;
    }
    if (child.type !== "text" || shouldSkipAncestors(ancestors)) {
      i++;
      continue;
    }

    const spans = findLocalPathSpansInText(child.value);
    if (!spans.length) {
      i++;
      continue;
    }

    const text = child.value;
    /** @type {HastElementContent[]} */
    const replacement = [];
    let last = 0;
    for (const span of spans) {
      if (span.start > last) {
        replacement.push({ type: "text", value: text.slice(last, span.start) });
      }
      replacement.push({
        type: "element",
        tagName: "button",
        properties: {
          type: "button",
          className: ["chat-lab__md-local-path"],
          dataLocalPath: span.path,
        },
        children: [{ type: "text", value: span.path }],
      });
      last = span.end;
    }
    if (last < text.length) {
      replacement.push({ type: "text", value: text.slice(last) });
    }

    children.splice(i, 1, ...replacement);
    i += replacement.length;
  }
}

/**
 * Turn absolute / workspace-relative local paths in prose into clickable controls.
 * @returns {() => (tree: HastRoot) => void}
 */
export function rehypeChatLabLocalPaths() {
  return (tree) => {
    if (!tree?.children) return;
    for (const node of tree.children) {
      if (node.type === "element") processElementChildren(node, []);
    }
  };
}
