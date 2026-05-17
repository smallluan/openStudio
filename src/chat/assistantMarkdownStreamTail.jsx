import { createElement } from "react";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { visit } from "unist-util-visit";

/**
 * Find which markdown block should carry the inline stream tail (doc order), matching remark-gfm + remark-math.
 * @param {string} markdown
 * @returns {{ kind: "paragraph"; ordinal: number } | { kind: "heading"; depth: number; ordinal: number } | null}
 */
export function getAssistantStreamTailPlacement(markdown) {
  const src = String(markdown ?? "").trim();
  if (!src) return null;

  const tree = unified().use(remarkParse).use(remarkGfm).use(remarkMath).parse(src);

  /** @type {Array<{ kind: "paragraph" } | { kind: "heading"; depth: number }>} */
  const blocks = [];
  visit(tree, (node) => {
    if (node.type === "paragraph") blocks.push({ kind: "paragraph" });
    else if (node.type === "heading") {
      const d = /** @type {{ depth: number }} */ (node).depth;
      if (d >= 1 && d <= 6) blocks.push({ kind: "heading", depth: d });
    }
  });

  const last = blocks[blocks.length - 1];
  if (!last) return null;

  let ordinal = 0;
  for (const b of blocks) {
    if (last.kind === "paragraph" && b.kind === "paragraph") ordinal++;
    else if (last.kind === "heading" && b.kind === "heading" && b.depth === last.depth) ordinal++;
  }

  return last.kind === "paragraph"
    ? { kind: "paragraph", ordinal }
    : { kind: "heading", depth: /** @type {{ kind: "heading"; depth: number }} */ (last).depth, ordinal };
}

/**
 * @typedef {{ current: { p: number; h: Record<number, number> } }} StreamTailOrdinalRef
 */

/**
 * Inject {@link Tail} after children of the last paragraph or heading (per placement).
 * @param {import("react-markdown").Components} base
 * @param {NonNullable<ReturnType<typeof getAssistantStreamTailPlacement>>} placement
 * @param {StreamTailOrdinalRef} ordinalRef reset to `{ p: 0, h: {} }` before each `ReactMarkdown` render
 * @param {import("react").ComponentType<{ active: boolean }>} Tail
 * @param {boolean} streamActive
 * @returns {import("react-markdown").Components}
 */
export function mergeMarkdownComponentsWithStreamTail(base, placement, ordinalRef, Tail, streamActive) {
  const next = { ...base };

  if (placement.kind === "paragraph") {
    const origP = base.p;
    next.p = (props) => {
      ordinalRef.current.p += 1;
      const show = ordinalRef.current.p === placement.ordinal;
      const tail = show ? <Tail active={streamActive} /> : null;
      const children = (
        <>
          {props.children}
          {tail}
        </>
      );
      if (origP) return origP({ ...props, children });
      return <p {...props}>{children}</p>;
    };
    return next;
  }

  const tagName = `h${placement.depth}`;
  const origH = base[tagName];
  next[tagName] = (props) => {
    const d = placement.depth;
    ordinalRef.current.h[d] = (ordinalRef.current.h[d] ?? 0) + 1;
    const idx = ordinalRef.current.h[d];
    const show = idx === placement.ordinal;
    const tail = show ? <Tail active={streamActive} /> : null;
    const children = (
      <>
        {props.children}
        {tail}
      </>
    );
    if (origH) return origH({ ...props, children });
    return createElement(tagName, props, children);
  };

  return next;
}

