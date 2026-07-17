import { useCallback, useEffect, useState } from "react";
import { Button } from "@open-studio/udesign";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "../../ui/cn.js";
import { isAsciiTreeDir } from "../../chat/chatLabAsciiTree.js";

/**
 * @typedef {import("../../chat/chatLabAsciiTree.js").AsciiTreeNode} AsciiTreeNode
 */

/**
 * Default expansion: only the outermost directory layer.
 * - Named root (e.g. D:\openStudio/) → expand that root only.
 * - Multiple top-level dirs (no named root) → expand each top-level dir.
 * @param {AsciiTreeNode} root
 */
function buildDefaultExpanded(root) {
  /** @type {Set<string>} */
  const keys = new Set();

  if (root?.name && root.children?.length) {
    keys.add(root.name);
    return keys;
  }

  const children = root?.children ?? [];
  for (let i = 0; i < children.length; i += 1) {
    const node = children[i];
    const key = node.name || `node-${i}`;
    if (node.children?.length && isAsciiTreeDir(node)) {
      keys.add(key);
    }
  }

  return keys;
}

/**
 * @param {{
 *   root: AsciiTreeNode;
 *   className?: string;
 * }} props
 */
export default function ChatLabDirectoryTree({ root, className }) {
  const [expanded, setExpanded] = useState(() => buildDefaultExpanded(root));

  useEffect(() => {
    setExpanded(buildDefaultExpanded(root));
  }, [root]);

  const toggleDir = useCallback((key) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  /**
   * @param {{ show: boolean; open?: boolean }} props
   */
  const TreeChevron = ({ show, open = false }) => (
    <span
      className={cn("chat-lab__md-tree-chevron", !show && "chat-lab__md-tree-chevron--spacer")}
      aria-hidden
    >
      {show ? (open ? <ChevronDown size={11} strokeWidth={2.2} /> : <ChevronRight size={11} strokeWidth={2.2} />) : null}
    </span>
  );

  /** @param {number} depth */
  const rowIndentStyle = (depth) => ({ paddingLeft: `${depth * 0.85}rem` });

  /** @param {AsciiTreeNode[]} nodes @param {number} depth @param {string} prefix */
  const renderNodes = (nodes, depth, prefix) =>
    nodes.map((node, index) => {
      const key = prefix ? `${prefix}/${node.name}` : node.name || `node-${index}`;
      const isDir = isAsciiTreeDir(node);
      const hasChildren = Boolean(node.children?.length);
      const isOpen = hasChildren && expanded.has(key);
      const displayName = String(node.name ?? "").replace(/[/\\]+$/, "") || node.name;
      const indentStyle = rowIndentStyle(depth);

      if (isDir) {
        const rowClass = cn(
          "chat-lab__md-tree-item chat-lab__md-tree-item--dir",
          !hasChildren && "chat-lab__md-tree-item--leaf",
        );
        const rowBody = (
          <>
            <TreeChevron show={hasChildren} open={isOpen} />
            <span className="chat-lab__md-tree-emoji" aria-hidden>
              📂
            </span>
            <span className="chat-lab__md-tree-name">{displayName}</span>
            {node.comment ? <span className="chat-lab__md-tree-comment">{node.comment}</span> : null}
          </>
        );

        return (
          <li key={key} className="chat-lab__md-tree-node">
            {hasChildren ? (
              <Button
                variant="text"
                size="small"
                type="button"
                className={rowClass}
                style={indentStyle}
                onClick={() => toggleDir(key)}
                aria-expanded={isOpen}
                title={node.name}
              >
                {rowBody}
              </Button>
            ) : (
              <div className={rowClass} style={indentStyle} title={node.name}>
                {rowBody}
              </div>
            )}
            {isOpen && hasChildren ? (
              <ul className="chat-lab__md-tree-list chat-lab__md-tree-list--nested">
                {renderNodes(node.children, depth + 1, key)}
              </ul>
            ) : null}
          </li>
        );
      }

      return (
        <li key={key} className="chat-lab__md-tree-node">
          <div
            className="chat-lab__md-tree-item chat-lab__md-tree-item--file"
            style={indentStyle}
            title={node.name}
          >
            <TreeChevron show={false} />
            <span className="chat-lab__md-tree-emoji" aria-hidden>
              📄
            </span>
            <span className="chat-lab__md-tree-name">{displayName}</span>
            {node.comment ? <span className="chat-lab__md-tree-comment">{node.comment}</span> : null}
          </div>
        </li>
      );
    });

  const rootIsDir = isAsciiTreeDir(root);
  const rootHasChildren = Boolean(root.children?.length);
  const rootOpen = rootHasChildren && expanded.has(root.name);
  const rootDisplayName = String(root.name ?? "").replace(/[/\\]+$/, "") || root.name;

  return (
    <div className={cn("chat-lab__md-tree", className)}>
      {root.name ? (
        <div className="chat-lab__md-tree-root">
          {rootIsDir ? (
            rootHasChildren ? (
              <Button
                variant="text"
                size="small"
                type="button"
                className="chat-lab__md-tree-item chat-lab__md-tree-item--dir chat-lab__md-tree-item--root"
                onClick={() => toggleDir(root.name)}
                aria-expanded={rootOpen}
                title={root.name}
              >
                <TreeChevron show={rootHasChildren} open={rootOpen} />
                <span className="chat-lab__md-tree-emoji" aria-hidden>
                  📂
                </span>
                <span className="chat-lab__md-tree-name">{rootDisplayName}</span>
                {root.comment ? <span className="chat-lab__md-tree-comment">{root.comment}</span> : null}
              </Button>
            ) : (
              <div
                className="chat-lab__md-tree-item chat-lab__md-tree-item--dir chat-lab__md-tree-item--root chat-lab__md-tree-item--leaf"
                title={root.name}
              >
                <TreeChevron show={false} />
                <span className="chat-lab__md-tree-emoji" aria-hidden>
                  📂
                </span>
                <span className="chat-lab__md-tree-name">{rootDisplayName}</span>
                {root.comment ? <span className="chat-lab__md-tree-comment">{root.comment}</span> : null}
              </div>
            )
          ) : (
            <div className="chat-lab__md-tree-item chat-lab__md-tree-item--file chat-lab__md-tree-item--root" title={root.name}>
              <TreeChevron show={false} />
              <span className="chat-lab__md-tree-emoji" aria-hidden>
                📄
              </span>
              <span className="chat-lab__md-tree-name">{rootDisplayName}</span>
              {root.comment ? <span className="chat-lab__md-tree-comment">{root.comment}</span> : null}
            </div>
          )}
        </div>
      ) : null}
      {root.children?.length && (!root.name || !rootHasChildren || rootOpen) ? (
        <ul className="chat-lab__md-tree-list">
          {renderNodes(root.children, root.name ? 1 : 0, root.name || "")}
        </ul>
      ) : null}
    </div>
  );
}
