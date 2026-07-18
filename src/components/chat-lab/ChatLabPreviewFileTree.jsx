import { useEffect, useMemo, useState } from "react";
import { Tree } from "tdesign-react";
import { cn } from "../../ui/cn.js";

/**
 * @typedef {import("../../chat/chatLabPreviewFileTree.js").PreviewTreeNode} PreviewTreeNode
 */

/**
 * @param {{
 *   nodes: PreviewTreeNode[];
 *   selectedPath: string | null;
 *   onSelectFile: (path: string) => void;
 * }} props
 */
export default function ChatLabPreviewFileTree({ nodes, selectedPath, onSelectFile }) {
  const [expanded, setExpanded] = useState(() => new Set());

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

  const treeData = useMemo(() => {
    /**
     * @param {PreviewTreeNode[]} list
     * @returns {Array<{
     *   value: string;
     *   label: string;
     *   path: string;
     *   kind: "file" | "dir";
     *   previewable?: boolean;
     *   children?: any[];
     * }>}
     */
    const convert = (list) =>
      list
        .map((node) => {
          const normPath = String(node.path ?? "").replace(/\\/g, "/");
          if (!normPath) return null;
          const children = Array.isArray(node.children) ? convert(node.children) : undefined;
          return {
            value: normPath,
            label: node.name,
            path: node.path,
            kind: node.kind,
            previewable: node.previewable,
            ...(children && children.length ? { children } : {}),
          };
        })
        .filter(Boolean);
    return convert(nodes);
  }, [nodes]);

  if (!nodes.length) return null;

  const expandedValues = Array.from(expanded);

  return (
    <div className="chat-lab-preview-dock__tree-control min-h-0 flex-1 overflow-auto py-1">
      <Tree
        data={treeData}
        hover
        transition
        expandOnClickNode
        expanded={expandedValues}
        onExpand={(nextExpanded) => {
          const list = Array.isArray(nextExpanded) ? nextExpanded : [];
          setExpanded(new Set(list.map((v) => String(v).replace(/\\/g, "/"))));
        }}
        icon={({ data }) =>
          data?.kind === "dir" ? (
            <span className="chat-lab-preview-dock__tree-emoji" aria-hidden>
              📁
            </span>
          ) : (
            <span className="chat-lab-preview-dock__tree-emoji" aria-hidden>
              📄
            </span>
          )
        }
        label={({ data }) => {
          const normPath = String(data?.value ?? "").replace(/\\/g, "/");
          const isDir = data?.kind === "dir";
          const isActive = !isDir && normPath.toLowerCase() === normalizedSelected;
          return (
            <span
              className={cn(
                "chat-lab-preview-dock__tree-item",
                isDir ? "chat-lab-preview-dock__tree-item--dir" : "chat-lab-preview-dock__tree-item--file",
                isActive && "chat-lab-preview-dock__tree-item--active",
              )}
              title={normPath}
            >
              <span className="chat-lab-preview-dock__tree-name">{String(data?.label ?? "")}</span>
            </span>
          );
        }}
        onClick={({ node }) => {
          const nodeData = node?.data;
          if (!nodeData || nodeData.kind !== "file") return;
          if (nodeData.previewable === false) return;
          const path = String(nodeData.path ?? "").trim();
          if (!path) return;
          onSelectFile(path);
        }}
      />
    </div>
  );
}
