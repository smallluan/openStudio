import { useCallback, useContext, useMemo, useState, useSyncExternalStore, isValidElement } from "react";
import { cn } from "../../ui/cn.js";
import { ChatLabPreviewContext } from "../../context/ChatLabPreviewContext.jsx";
import { csvToHtmlDocument, svgToHtmlDocument, wrapLooseHtmlFragmentForSrcDoc } from "../../chat/chatLabDocumentPreview.js";
import SyntaxHighlighter from "react-syntax-highlighter/dist/esm/prism-light.js";
import bash from "react-syntax-highlighter/dist/esm/languages/prism/bash.js";
import cpp from "react-syntax-highlighter/dist/esm/languages/prism/cpp.js";
import csharp from "react-syntax-highlighter/dist/esm/languages/prism/csharp.js";
import css from "react-syntax-highlighter/dist/esm/languages/prism/css.js";
import go from "react-syntax-highlighter/dist/esm/languages/prism/go.js";
import graphql from "react-syntax-highlighter/dist/esm/languages/prism/graphql.js";
import java from "react-syntax-highlighter/dist/esm/languages/prism/java.js";
import javascript from "react-syntax-highlighter/dist/esm/languages/prism/javascript.js";
import jsx from "react-syntax-highlighter/dist/esm/languages/prism/jsx.js";
import json from "react-syntax-highlighter/dist/esm/languages/prism/json.js";
import markdown from "react-syntax-highlighter/dist/esm/languages/prism/markdown.js";
import markup from "react-syntax-highlighter/dist/esm/languages/prism/markup.js";
import powershell from "react-syntax-highlighter/dist/esm/languages/prism/powershell.js";
import python from "react-syntax-highlighter/dist/esm/languages/prism/python.js";
import rust from "react-syntax-highlighter/dist/esm/languages/prism/rust.js";
import sql from "react-syntax-highlighter/dist/esm/languages/prism/sql.js";
import tsx from "react-syntax-highlighter/dist/esm/languages/prism/tsx.js";
import typescript from "react-syntax-highlighter/dist/esm/languages/prism/typescript.js";
import yaml from "react-syntax-highlighter/dist/esm/languages/prism/yaml.js";
import oneLight from "react-syntax-highlighter/dist/esm/styles/prism/one-light.js";
import vscDarkPlus from "react-syntax-highlighter/dist/esm/styles/prism/vsc-dark-plus.js";

const LANG_PAIRS = [
  ["bash", bash],
  ["javascript", javascript],
  ["jsx", jsx],
  ["typescript", typescript],
  ["tsx", tsx],
  ["json", json],
  ["css", css],
  ["python", python],
  ["rust", rust],
  ["sql", sql],
  ["yaml", yaml],
  ["markdown", markdown],
  ["markup", markup],
  ["graphql", graphql],
  ["powershell", powershell],
  ["cpp", cpp],
  ["go", go],
  ["java", java],
  ["csharp", csharp],
];

for (const [name, mod] of LANG_PAIRS) {
  SyntaxHighlighter.registerLanguage(name, mod);
}

/** @type {ReadonlySet<string>} */
const HIGHLIGHT_LANGS = new Set(LANG_PAIRS.map(([n]) => n));

/** Fenced blocks rendered as prose (no toolbar); includes unlabeled ``` fences. */
const SOFT_FENCE_LANGS = new Set(["plaintext", "text", "plain", "txt"]);

/** Single-line soft fences at or below this length render inline (avoids breaking sentences). */
const SOFT_FENCE_INLINE_MAX_CHARS = 88;

const FENCE_LANG_ALIASES = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  py: "python",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  yml: "yaml",
  md: "markdown",
  html: "markup",
  xml: "markup",
  svg: "markup",
  vue: "markup",
  rss: "markup",
  atom: "markup",
  php: "markup",
  ps1: "powershell",
  psm1: "powershell",
  gql: "graphql",
  cxx: "cpp",
  cc: "cpp",
  "c++": "cpp",
  golang: "go",
  cs: "csharp",
};

function subscribeDocTheme(onStoreChange) {
  const el = document.documentElement;
  const mo = new MutationObserver(onStoreChange);
  mo.observe(el, { attributes: true, attributeFilter: ["data-theme"] });
  return () => mo.disconnect();
}

/** @returns {"light"|"dark"} */
function snapshotDocTheme() {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

function useDocTheme() {
  return useSyncExternalStore(subscribeDocTheme, snapshotDocTheme, () => "light");
}

/** Pull plain text from react-markdown cell children (often a `<p>` or inline mix). */
export function chatMarkdownPlainText(node) {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(chatMarkdownPlainText).join("");
  if (isValidElement(node)) {
    const ch = /** @type {{ children?: unknown }} */ (node.props).children;
    return chatMarkdownPlainText(ch);
  }
  return "";
}

/** Rank/index column: small integers only (avoids matching "1649.9万" style cells). */
const MARKDOWN_RANK_CELL = /^\s*#?\s*(\d{1,3})\s*$/;

/**
 * @param {string | undefined} className react-markdown `language-xxx`
 * @returns {{ prism: string; label: string }}
 */
function resolveFenceLang(className) {
  const m = /\blanguage-([^\s]+)/i.exec(className ?? "");
  const raw = (m?.[1] ?? "").trim().toLowerCase();
  if (!raw) return { prism: "", label: "" };
  const mapped = FENCE_LANG_ALIASES[raw] ?? raw;
  const prism = HIGHLIGHT_LANGS.has(mapped) ? mapped : "";
  return {
    prism,
    label: raw,
  };
}

/** @param {{ code: string }} props */
function SoftFenceBlock({ code }) {
  return (
    <div className="chat-lab__soft-fence-block">
      <pre className="chat-lab__soft-fence-block__pre">
        <code>{code}</code>
      </pre>
    </div>
  );
}

/** @param {{ text: string; t: (k: string) => string }} props */
function CodeCopyBtn({ text, t }) {
  const [state, setState] = useState("idle");

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
      window.setTimeout(() => setState("idle"), 2000);
    } catch {
      setState("idle");
    }
  }, [text]);

  const label = state === "copied" ? t("chatLab.codeCopied") : t("chatLab.codeCopy");

  return (
    <button
      type="button"
      className={cn(
        "chat-lab__code-copy",
        state === "copied" && "chat-lab__code-copy--done",
      )}
      onClick={onCopy}
      aria-label={label}
      title={label}
    >
      {state === "copied" ? (
        <CodeCopiedIcon />
      ) : (
        <CodeCopyIcon />
      )}
      <span className="chat-lab__code-copy-label">{label}</span>
    </button>
  );
}

function CodeCopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect
        x="8.25"
        y="8.25"
        width="11"
        height="13"
        rx="1.65"
        stroke="currentColor"
        strokeWidth="1.35"
      />
      <path
        d="M7.25 17H6.65A2.65 2.65 0 0 1 4 14.35V7.65A2.65 2.65 0 0 1 6.65 5h6.7A2.65 2.65 0 0 1 16 7.65V8.25"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** @param {{ onClick: () => void; t: (k: string) => string }} props */
function FencePreviewBtn({ onClick, t }) {
  return (
    <button
      type="button"
      className="chat-lab__code-preview"
      onClick={onClick}
      aria-label={t("chatLab.previewOpen")}
      title={t("chatLab.previewOpen")}
    >
      <span className="chat-lab__code-preview-ico" aria-hidden>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <path
            d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <span className="chat-lab__code-preview-label">{t("chatLab.previewOpen")}</span>
    </button>
  );
}

function CodeCopiedIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M6.5 12.5 10 16l7-8"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * @param {{
 *   code: string;
 *   fenceClassName?: string;
 *   t: (k: string) => string;
 * }} props
 */
function ChatMdCodeBlock({ code, fenceClassName, t }) {
  const theme = useDocTheme();
  const preview = useContext(ChatLabPreviewContext);
  const { prism, label } = useMemo(
    () => resolveFenceLang(fenceClassName),
    [fenceClassName],
  );
  const syntaxStyle = theme === "dark" ? vscDarkPlus : oneLight;
  const displayLang = label || t("chatLab.codePlain");
  const codeFont = "0.8125rem";
  const canPreview =
    Boolean(preview) && (label === "html" || label === "csv" || label === "svg");
  const onPreview = useCallback(() => {
    if (!preview) return;
    if (label === "html") {
      const doc = wrapLooseHtmlFragmentForSrcDoc(code);
      if (!doc) return;
      preview.openSrcDoc(doc, t("chatLab.previewTitleHtml"));
    } else if (label === "csv") {
      preview.openSrcDoc(csvToHtmlDocument(code), t("chatLab.previewTitleCsv"));
    } else if (label === "svg") {
      preview.openSrcDoc(svgToHtmlDocument(code), t("chatLab.previewTitleSvg"));
    }
  }, [code, label, preview, t]);

  return (
    <div className="chat-lab__code-block" data-theme={theme}>
      <div className="chat-lab__code-block-toolbar">
        <span className="chat-lab__code-lang" title={displayLang}>
          {displayLang}
        </span>
        <div className="chat-lab__code-block-actions">
          {canPreview ? <FencePreviewBtn onClick={onPreview} t={t} /> : null}
          <CodeCopyBtn text={code} t={t} />
        </div>
      </div>
      <div className="chat-lab__code-block-body">
        {prism ? (
          <SyntaxHighlighter
            language={prism}
            style={syntaxStyle}
            showLineNumbers={false}
            codeTagProps={{
              style: {
                fontSize: codeFont,
                lineHeight: 1.55,
                background: "transparent",
              },
            }}
            customStyle={{
              margin: 0,
              padding: "0.62rem 0.75rem",
              borderRadius: 0,
              fontSize: codeFont,
              lineHeight: 1.55,
              background: "transparent",
              border: "none",
              boxShadow: "none",
            }}
          >
            {code}
          </SyntaxHighlighter>
        ) : (
          <pre className="chat-lab__code-plain">
            <code>{code}</code>
          </pre>
        )}
      </div>
    </div>
  );
}

/**
 * @param {(key: string, vars?: Record<string, string | number>) => string} t
 */
export function createChatLabMarkdownComponents(t) {
  return {
    /**
     * @param {import("react").ComponentPropsWithoutRef<"td"> & { children?: import("react").ReactNode }} props
     */
    td: ({ children, ...props }) => {
      const plain = chatMarkdownPlainText(children);
      const rank = MARKDOWN_RANK_CELL.exec(plain);
      if (rank) {
        return (
          <td {...props}>
            <span className="chat-lab__md-rank">{rank[1]}</span>
          </td>
        );
      }
      return <td {...props}>{children}</td>;
    },
    /** @param {import("react").ComponentPropsWithoutRef<"pre">} props */
    pre: ({ children }) => <>{children}</>,
    /**
     * @param {{
     *   inline?: boolean;
     *   className?: string;
     *   children?: import("react").ReactNode;
     * } & Record<string, unknown>} props
     */
    code: ({ inline, className, children, ...props }) => {
      if (inline) {
        return (
          <code className={className} {...props}>
            {children}
          </code>
        );
      }
      const code = String(children ?? "").replace(/\n$/, "");
      const m = /\blanguage-([^\s]+)/i.exec(className ?? "");
      const fenceLang = (m?.[1] ?? "").trim().toLowerCase();
      const soft = !fenceLang || SOFT_FENCE_LANGS.has(fenceLang);
      const singleLine = !/\r?\n/.test(code);
      if (soft && singleLine && code.length <= SOFT_FENCE_INLINE_MAX_CHARS) {
        return <span className="chat-lab__md-soft-inline">{code}</span>;
      }
      if (soft) {
        return <SoftFenceBlock code={code} />;
      }
      return <ChatMdCodeBlock code={code} fenceClassName={className} t={t} />;
    },
  };
}
