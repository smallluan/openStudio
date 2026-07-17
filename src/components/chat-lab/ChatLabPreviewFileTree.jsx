import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@open-studio/udesign";
import { ChevronDown, ChevronRight, File, Folder } from "lucide-react";
import { cn } from "../../ui/cn.js";

/**
 * @typedef {import("../../chat/chatLabPreviewFileTree.js").PreviewTreeNode} PreviewTreeNode
 */

/**
 * @param {{
 *   nodes: PreviewTreeNode[];
 *   selectedPath: string | null;
 *   artifactOps?: Map<string, import("../../chat/chatLabSessionArtifacts.js").ArtifactOp>;
 *   onSelectFile: (path: string) => void;
 * }} props
 */
export default function ChatLabPreviewFileTree({ nodes, selectedPath, artifactOps, onSelectFile }) {
  const [expanded, setExpanded] = useState(() => new Set());

  const toggleDir = useCallback((dirPath) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) next.delete(dirPath);
      else next.add(dirPath);
      return next;
    });
  }, []);

  const normalizedSelected = useMemo(
    () => String(selectedPath ?? "").replace(/\\/g, "/").toLowerCase(),
    [selectedPath],
  );

  useEffect(() => {
    const raw = String(selectedPath ?? "").replace(/\\/g, "/");
    const parts = raw.split("/").filter(Boolean);
    if (parts.length <= 1) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      for (let i = 1; i < parts.length; i += 1) {
        next.add(parts.slice(0, i).join("/"));
      }
      return next;
    });
  }, [selectedPath]);

  /** @param {PreviewTreeNode[]} list @param {number} depth */
  const renderNodes = (list, depth) =>
    list.map((node) => {
      const normPath = String(node.path ?? "").replace(/\\/g, "/");
      const isDir = node.kind === "dir";
      const isOpen = isDir && expanded.has(normPath);
      const isActive =
        !isDir && normPath.toLowerCase() === normalizedSelected;
      const op = artifactOps?.get(normPath) ?? artifactOps?.get(String(node.path ?? ""));

      if (isDir) {
        return (
          <li key={`dir:${normPath}`} className="chat-lab-preview-dock__tree-node">
            <Button
              type="button"
              className="chat-lab-preview-dock__tree-item chat-lab-preview-dock__tree-item--dir"
              style={{ paddingLeft: `${0.45 + depth * 0.65}rem` }}
              onClick={() => toggleDir(normPath)}
              aria-expanded={isOpen}
              title={normPath}
            >
              <span className="chat-lab-preview-dock__tree-chevron" aria-hidden>
                {isOpen ? <ChevronDown size={12} strokeWidth={2} /> : <ChevronRight size={12} strokeWidth={2} />}
              </span>
              <Folder size={13} strokeWidth={1.75} className="chat-lab-preview-dock__tree-icon" aria-hidden />
              <span className="chat-lab-preview-dock__tree-name">{node.name}</span>
            </Button>
            {isOpen && node.children?.length ? (
              <ul className="chat-lab-preview-dock__tree-list chat-lab-preview-dock__tree-list--nested">
                {renderNodes(node.children, depth + 1)}
              </ul>
            ) : null}
          </li>
        );
      }

      if (node.previewable === false) return null;

      return (
        <li key={`file:${normPath}`} className="chat-lab-preview-dock__tree-node">
          <Button
            type="button"
            className={cn(
              "chat-lab-preview-dock__tree-item chat-lab-preview-dock__tree-item--file",
              isActive && "chat-lab-preview-dock__tree-item--active",
            )}
            style={{ paddingLeft: `${0.45 + depth * 0.65}rem` }}
            onClick={() => onSelectFile(node.path)}
            title={normPath}
          >
            <span className="chat-lab-preview-dock__tree-chevron chat-lab-preview-dock__tree-chevron--spacer" aria-hidden />
            {op ? (
              <span
                className={cn(
                  "chat-lab-preview-dock__tree-badge",
                  op === "created"
                    ? "chat-lab-preview-dock__tree-badge--created"
                    : op === "modified"
                      ? "chat-lab-preview-dock__tree-badge--modified"
                      : "chat-lab-preview-dock__tree-badge--viewed",
                )}
              >
                {op === "created" ? "+" : op === "modified" ? "~" : "↗"}
              </span>
            ) : (
              <File size={13} strokeWidth={1.75} className="chat-lab-preview-dock__tree-icon" aria-hidden />
            )}
            <span className="chat-lab-preview-dock__tree-name">{node.name}</span>
          </Button>
        </li>
      );
    });

  if (!nodes.length) return null;

  return (
    <ul className="chat-lab-preview-dock__tree-list min-h-0 flex-1 overflow-auto py-1">
      {renderNodes(nodes, 0)}
    </ul>
  );
}
