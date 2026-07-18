import {
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  isValidElement,
} from "react";
import ReactMarkdown from "react-markdown";
import { Button } from "@open-studio/udesign";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { cn } from "../../ui/cn.js";
import Image from "../../ui/Image.jsx";
import FluidTabBar from "../../ui/FluidTabBar.jsx";
import { ChatLabPreviewContext } from "../../context/ChatLabPreviewContext.jsx";
import { csvToHtmlDocument, svgToHtmlDocument, wrapLooseHtmlFragmentForSrcDoc } from "../../chat/chatLabDocumentPreview.js";
import {
  getChatLabMermaidConfig,
  stylizeFlowchartSvg,
} from "../../chat/chatLabMermaidTheme.js";
import { prepareChatLabMarkdownForRender } from "../../chat/chatLabMarkdownImageGrid.js";
import { CHAT_MD_REHYPE_PLUGINS } from "../../chat/chatLabRehypePlugins.js";
import { openChatLabLocalPath } from "../../chat/chatLabSelectionAddress.js";
import { ChatLabImageGrid } from "./ChatLabImageGrid.jsx";
import SyntaxHighlighter from "react-syntax-highlighter/dist/esm/prism-light.js";
import { CHAT_LAB_PRISM_LANGS } from "../../chat/chatLabPrismSetup.js";
import oneLight from "react-syntax-highlighter/dist/esm/styles/prism/one-light.js";
import vscDarkPlus from "react-syntax-highlighter/dist/esm/styles/prism/vsc-dark-plus.js";
import ChatLabEchartsFenceView from "./ChatLabEchartsFenceView.jsx";
import ChatLabChartBlock from "./ChatLabChartBlock.jsx";
import ChatLabDirectoryTree from "./ChatLabDirectoryTree.jsx";
import { looksLikeAsciiTreeText, normalizeAsciiTreeLine, parseAsciiTree } from "../../chat/chatLabAsciiTree.js";

const CHAT_MD_REMARK_PLUGINS = [remarkGfm, remarkMath];

/** Fenced languages that support source / rendered toggle in the toolbar. */
const RENDERABLE_FENCE_LANGS = new Set(["mermaid", "markdown", "md", "chart", "echarts"]);

/** Charts and flowcharts: render-only (no source pane or view toggle). */
const VISUAL_ONLY_FENCE_LANGS = new Set(["mermaid", "chart", "echarts"]);

/** Chart fences need a taller pane — do not lock body height to source scrollHeight. */
const CHART_FENCE_LANGS = new Set(["chart", "echarts"]);

/** @type {Map<string, string>} */
const MERMAID_SVG_CACHE = new Map();

/** Bump when {@link getChatLabMermaidConfig} styling changes to invalidate cached SVG. */
const MERMAID_CACHE_VERSION = 4;

/** @param {"light" | "dark"} theme @param {string} code */
function mermaidCacheKey(theme, code) {
  return `v${MERMAID_CACHE_VERSION}\u0000${theme}\u0000${code}`;
}

/** @type {ReadonlySet<string>} */
const HIGHLIGHT_LANGS = CHAT_LAB_PRISM_LANGS;

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

export { useDocTheme };

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
  const icon = state === "copied" ? <CodeCopiedIcon /> : <CodeCopyIcon />;

  return (
    <Button
      type="button"
      variant="text"
      size="small"
      icon={icon}
      className={cn(
        "chat-lab__code-copy",
        state === "copied" && "chat-lab__code-copy--done",
      )}
      onClick={onCopy}
      aria-label={label}
      title={label}
    >
      <span className="chat-lab__code-copy-label">{label}</span>
    </Button>
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
    <Button
      type="button"
      variant="text"
      size="small"
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
    </Button>
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
 *   value: "source" | "render";
 *   onChange: (mode: "source" | "render") => void;
 *   t: (k: string) => string;
 * }} props
 */
function FenceViewToggle({ value, onChange, t }) {
  const items = useMemo(
    () => [
      { id: "render", label: t("chatLab.previewViewRender") },
      { id: "source", label: t("chatLab.previewViewSource") },
    ],
    [t],
  );

  return (
    <FluidTabBar
      className="chat-lab__code-view-tabs"
      tabListClassName="chat-lab__code-view-tabs__list"
      ariaLabel={t("chatLab.codeViewMode")}
      items={items}
      value={value}
      onChange={(id) => onChange(/** @type {"source" | "render"} */ (id))}
    />
  );
}

/** @param {{ code: string; theme: "light" | "dark" }} props */
function MermaidFenceView({ code, theme }) {
  const reactId = useId();
  const renderId = useMemo(() => `mmd-${reactId.replace(/:/g, "")}`, [reactId]);
  const cacheKey = useMemo(() => mermaidCacheKey(theme, code), [theme, code]);
  const [svg, setSvg] = useState(() => MERMAID_SVG_CACHE.get(cacheKey) ?? "");
  const [error, setError] = useState("");

  useEffect(() => {
    const cached = MERMAID_SVG_CACHE.get(cacheKey);
    if (cached) {
      setSvg(cached);
      setError("");
      return undefined;
    }

    let cancelled = false;
    setError("");
    void import("mermaid")
      .then(({ default: mermaid }) => {
        mermaid.initialize(getChatLabMermaidConfig(theme));
        return mermaid.render(renderId, code);
      })
      .then(({ svg: nextSvg }) => {
        if (cancelled) return;
        const styledSvg = stylizeFlowchartSvg(nextSvg, theme);
        MERMAID_SVG_CACHE.set(cacheKey, styledSvg);
        setSvg(styledSvg);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(String(err?.message ?? err ?? "Mermaid render failed"));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [cacheKey, code, renderId, theme]);

  if (error) {
    return <p className="chat-lab__code-render-error">{error}</p>;
  }
  if (!svg) {
    return <div className="chat-lab__code-render-loading" aria-hidden />;
  }
  return (
    <div
      className="chat-lab__mermaid-render"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

/**
 * @param {{ code: string; t: (k: string) => string }} props
 */
function MarkdownFenceView({ code, t }) {
  const mdSource = useMemo(
    () => prepareChatLabMarkdownForRender(code),
    [code],
  );
  const components = useMemo(() => createChatLabMarkdownComponents(t), [t]);
  return (
    <div className="chat-lab__code-md-render chat-lab__md">
      <ReactMarkdown
        remarkPlugins={CHAT_MD_REMARK_PLUGINS}
        rehypePlugins={CHAT_MD_REHYPE_PLUGINS}
        components={components}
      >
        {mdSource}
      </ReactMarkdown>
    </div>
  );
}

/**
 * @param {{
 *   code: string;
 *   label: string;
 *   theme: "light" | "dark";
 *   t: (k: string) => string;
 * }} props
 */
/**
 * @param {{
 *   code: string;
 *   label: string;
 *   theme: "light" | "dark";
 *   active?: boolean;
 *   t: (k: string) => string;
 * }} props
 */
function FenceRenderedBody({ code, label, theme, active = true, streaming = false, t }) {
  if (label === "mermaid") {
    return <MermaidFenceView code={code} theme={theme} />;
  }
  if (label === "chart" || label === "echarts") {
    return (
      <ChatLabEchartsFenceView
        code={code}
        label={label}
        theme={theme}
        active={active}
        streaming={streaming}
      />
    );
  }
  if (label === "markdown" || label === "md") {
    return <MarkdownFenceView code={code} t={t} />;
  }
  return null;
}

/**
 * @param {{
 *   code: string;
 *   prism: string;
 *   syntaxStyle: Record<string, unknown>;
 *   codeFont: string;
 * }} props
 */
function CodeFenceSource({ code, prism, syntaxStyle, codeFont }) {
  if (prism) {
    return (
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
    );
  }
  return (
    <pre className="chat-lab__code-plain">
      <code>{code}</code>
    </pre>
  );
}

function ChatMdVisualBlock({ code, label, displayLang, isChartFence, streaming, t }) {
  const theme = useDocTheme();

  if (isChartFence) {
    return (
      <ChatLabChartBlock
        code={code}
        label={label}
        displayLang={displayLang}
        theme={theme}
        streaming={streaming}
        t={t}
      />
    );
  }

  return (
    <div
      className={cn(
        "chat-lab__code-block",
        "chat-lab__code-block--visual-only",
      )}
      data-theme={theme}
    >
      <div className="chat-lab__code-block-toolbar">
        <span className="chat-lab__code-lang" title={displayLang}>
          {displayLang}
        </span>
        <div className="chat-lab__code-block-actions">
          <CodeCopyBtn text={code} t={t} />
        </div>
      </div>
      <div className="chat-lab__code-block-body">
        <FenceRenderedBody
          code={code}
          label={label}
          theme={theme}
          active
          streaming={streaming}
          t={t}
        />
      </div>
    </div>
  );
}

/**
 * @param {{
 *   code: string;
 *   label: string;
 *   prism: string;
 *   displayLang: string;
 *   t: (k: string) => string;
 * }} props
 */
function ChatMdToggleableCodeBlock({ code, label, prism, displayLang, streaming, t }) {
  const theme = useDocTheme();
  const preview = useContext(ChatLabPreviewContext);
  const syntaxStyle = theme === "dark" ? vscDarkPlus : oneLight;
  const codeFont = "0.8125rem";
  const canRender = RENDERABLE_FENCE_LANGS.has(label);
  const [viewMode, setViewMode] = useState(/** @type {"source" | "render"} */ ("source"));
  const [renderPaneMounted, setRenderPaneMounted] = useState(false);
  const bodyRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const sourcePaneRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const [lockedBodyHeight, setLockedBodyHeight] = useState(0);
  const [heightFrozen, setHeightFrozen] = useState(false);

  const lockSourceBodyHeight = useCallback(() => {
    const body = bodyRef.current;
    const source = sourcePaneRef.current;
    if (!body || !source) return;
    const { maxHeight } = getComputedStyle(body);
    let cap = Number.POSITIVE_INFINITY;
    if (maxHeight && maxHeight !== "none") {
      const px = Number.parseFloat(maxHeight);
      if (!Number.isNaN(px)) cap = px;
    }
    const h = Math.round(Math.min(source.scrollHeight, cap));
    if (h > 0) setLockedBodyHeight(h);
  }, []);

  const onViewModeChange = useCallback((mode /** @type {"source" | "render"} */) => {
    if (mode === "render") {
      lockSourceBodyHeight();
      setHeightFrozen(true);
      setRenderPaneMounted(true);
    } else {
      setHeightFrozen(false);
      setLockedBodyHeight(0);
    }
    setViewMode(mode);
  }, [lockSourceBodyHeight]);

  useLayoutEffect(() => {
    setLockedBodyHeight(0);
    setHeightFrozen(false);
    setRenderPaneMounted(false);
    setViewMode("source");
  }, [code]);

  useLayoutEffect(() => {
    if (!canRender || heightFrozen) return undefined;
    lockSourceBodyHeight();
    const source = sourcePaneRef.current;
    if (!source) return undefined;
    const ro = new ResizeObserver(() => lockSourceBodyHeight());
    ro.observe(source);
    return () => ro.disconnect();
  }, [canRender, code, heightFrozen, lockSourceBodyHeight]);

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
          {canRender ? (
            <FenceViewToggle value={viewMode} onChange={onViewModeChange} t={t} />
          ) : null}
          {canPreview ? <FencePreviewBtn onClick={onPreview} t={t} /> : null}
          <CodeCopyBtn text={code} t={t} />
        </div>
      </div>
      <div
        ref={bodyRef}
        className={cn(
          "chat-lab__code-block-body",
          canRender && "chat-lab__code-block-body--dual",
          canRender && lockedBodyHeight > 0 && "chat-lab__code-block-body--locked",
        )}
        style={
          canRender && lockedBodyHeight > 0
            ? { height: lockedBodyHeight, maxHeight: lockedBodyHeight }
            : undefined
        }
      >
        {canRender ? (
          <>
            <div
              ref={sourcePaneRef}
              className={cn(
                "chat-lab__code-block-pane",
                viewMode !== "source" && "chat-lab__code-block-pane--hidden",
              )}
              aria-hidden={viewMode !== "source"}
            >
              <CodeFenceSource
                code={code}
                prism={prism}
                syntaxStyle={syntaxStyle}
                codeFont={codeFont}
              />
            </div>
            {renderPaneMounted ? (
              <div
                className={cn(
                  "chat-lab__code-block-pane",
                  viewMode !== "render" && "chat-lab__code-block-pane--hidden",
                )}
                aria-hidden={viewMode !== "render"}
              >
                <FenceRenderedBody
                  code={code}
                  label={label}
                  theme={theme}
                  active={viewMode === "render"}
                  streaming={streaming}
                  t={t}
                />
              </div>
            ) : null}
          </>
        ) : (
          <CodeFenceSource
            code={code}
            prism={prism}
            syntaxStyle={syntaxStyle}
            codeFont={codeFont}
          />
        )}
      </div>
    </div>
  );
}

/**
 * @param {{
 *   code: string;
 *   fenceClassName?: string;
 *   t: (k: string) => string;
 * }} props
 */
function ChatMdCodeBlock({ code, fenceClassName, streaming = false, t }) {
  const { prism, label } = useMemo(
    () => resolveFenceLang(fenceClassName),
    [fenceClassName],
  );
  const displayLang = label || t("chatLab.codePlain");

  if (VISUAL_ONLY_FENCE_LANGS.has(label)) {
    return (
      <ChatMdVisualBlock
        code={code}
        label={label}
        displayLang={displayLang}
        isChartFence={CHART_FENCE_LANGS.has(label)}
        streaming={streaming}
        t={t}
      />
    );
  }

  return (
    <ChatMdToggleableCodeBlock
      code={code}
      label={label}
      prism={prism}
      displayLang={displayLang}
      streaming={streaming}
      t={t}
    />
  );
}

/**
 * @param {unknown} node
 * @returns {{ src: string; alt: string }[] | null}
 */
function parseMarkdownGridImages(node) {
  const props = /** @type {{ properties?: Record<string, unknown> }} */ (node)?.properties;
  const raw = props?.dataImages ?? props?.["data-images"];
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed
      .map((item) => ({
        src: String(item?.src ?? "").trim(),
        alt: String(item?.alt ?? ""),
      }))
      .filter((item) => item.src);
  } catch {
    return null;
  }
}

/** @param {import("react").AnchorHTMLAttributes<HTMLAnchorElement> & { children?: import("react").ReactNode; node?: unknown }} props */
function ChatLabMarkdownLink({ href, children, className, node: _node, ...rest }) {
  const previewApi = useContext(ChatLabPreviewContext);
  const text = chatMarkdownPlainText(children);
  /** @param {import("react").MouseEvent<HTMLAnchorElement>} e */
  const onClick = (e) => {
    if (!href) return;
    if (e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    let targetHref = href;
    try {
      targetHref = new URL(href, window.location.href).href;
    } catch {
      /* keep raw href */
    }
    if (previewApi?.openFromHref?.(targetHref, text)) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  return (
    <a href={href ?? "#"} onClick={onClick} className={cn("chat-lab__md-a", className)} {...rest}>
      {children}
    </a>
  );
}

/**
 * @param {import("react").ButtonHTMLAttributes<HTMLButtonElement> & {
 *   children?: import("react").ReactNode;
 *   node?: { properties?: Record<string, unknown> };
 * }} props
 */
function ChatLabMarkdownLocalPathButton({ children, className, node, type, onClick, ...rest }) {
  const previewApi = useContext(ChatLabPreviewContext);
  const props = node?.properties ?? {};
  const localPath =
    typeof props.dataLocalPath === "string"
      ? props.dataLocalPath
      : typeof props["data-local-path"] === "string"
        ? props["data-local-path"]
        : "";
  const cls = Array.isArray(className) ? className.join(" ") : String(className ?? "");
  const isLocalPath = localPath && cls.includes("chat-lab__md-local-path");

  if (!isLocalPath) {
    return (
      <Button type={type ?? "button"} variant="text" className={className} onClick={onClick} {...rest}>
        {children}
      </Button>
    );
  }

  /** @param {import("react").MouseEvent<HTMLButtonElement>} e */
  const handleClick = (e) => {
    if (e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    e.stopPropagation();
    openChatLabLocalPath(localPath, previewApi);
  };

  return (
    <Button
      type="button"
      variant="text"
      size="small"
      className={cn("chat-lab__md-local-path", className)}
      onClick={handleClick}
      title={localPath}
      {...rest}
    >
      {children}
    </Button>
  );
}

/**
 * @param {(key: string, vars?: Record<string, string | number>) => string} t
 * @param {{ streaming?: boolean }} [opts]
 */
export function createChatLabMarkdownComponents(t, opts = {}) {
  const streaming = Boolean(opts.streaming);
  return {
    /**
     * @param {import("react").AnchorHTMLAttributes<HTMLAnchorElement> & { children?: import("react").ReactNode; node?: unknown }} props
     */
    a: ChatLabMarkdownLink,
    /**
     * @param {import("react").ButtonHTMLAttributes<HTMLButtonElement> & {
     *   children?: import("react").ReactNode;
     *   node?: { properties?: Record<string, unknown> };
     * }} props
     */
    button: ChatLabMarkdownLocalPathButton,
    /**
     * @param {import("react").ComponentPropsWithoutRef<"div"> & { node?: unknown }} props
     */
    div: ({ className, children, node: _node, ...props }) => {
      const clsStr = Array.isArray(className) ? className.join(" ") : String(className ?? "");
      if (clsStr.includes("chat-lab__md-image-grid") && !clsStr.includes("__cell")) {
        const images = parseMarkdownGridImages(_node);
        if (images?.length) {
          return <ChatLabImageGrid images={images} className={className} />;
        }
      }
      return (
        <div className={className} {...props}>
          {children}
        </div>
      );
    },
    /**
     * @param {import("react").ComponentPropsWithoutRef<"img"> & { node?: unknown }} props
     */
    img: ({ src, alt, className, node: _node, title, width, height }) => (
      <Image
        src={typeof src === "string" ? src : undefined}
        alt={alt ?? ""}
        imgClassName={className}
        title={title}
        width={width}
        height={height}
        loading="lazy"
        fit="contain"
        previewable
        as="div"
      />
    ),
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
     * Image grids from rehype should not sit inside an extra `<p>` (invalid HTML + full-width layout).
     * @param {import("react").ComponentPropsWithoutRef<"p"> & { node?: unknown }} props
     */
    p: ({ children, className, node: _node, ...props }) => {
      const kids = Array.isArray(children) ? children : [children];
      const meaningful = kids.filter((c) => c != null && c !== false && c !== "");
      if (meaningful.length === 1 && isValidElement(meaningful[0])) {
        const cls = meaningful[0].props?.className;
        const clsStr = Array.isArray(cls) ? cls.join(" ") : String(cls ?? "");
        if (clsStr.includes("chat-lab__md-image-grid")) {
          return meaningful[0];
        }
      }
      return (
        <p className={className} {...props}>
          {children}
        </p>
      );
    },
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
      const treeCode = code
        .split(/\r?\n/)
        .map((line) => normalizeAsciiTreeLine(line))
        .join("\n");
      const m = /\blanguage-([^\s]+)/i.exec(className ?? "");
      const fenceLang = (m?.[1] ?? "").trim().toLowerCase();
      // Protocol payload — executed client-side and shown in the tool/step bar, not as a code card.
      if (fenceLang === "sidebar-action") {
        return null;
      }
      const soft = !fenceLang || SOFT_FENCE_LANGS.has(fenceLang);
      const singleLine = !/\r?\n/.test(code);
      if (soft && singleLine && code.length <= SOFT_FENCE_INLINE_MAX_CHARS) {
        return <span className="chat-lab__md-soft-inline">{code}</span>;
      }
      if (soft && looksLikeAsciiTreeText(treeCode)) {
        const tree = parseAsciiTree(treeCode);
        if (tree) return <ChatLabDirectoryTree root={tree} />;
      }
      if (soft) {
        return <SoftFenceBlock code={code} />;
      }
      return <ChatMdCodeBlock code={code} fenceClassName={className} streaming={streaming} t={t} />;
    },
  };
}
