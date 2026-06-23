import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeKatex from "rehype-katex";
import { rehypeChatLabImageGrid } from "./rehypeChatLabImageGrid.js";

const starAttrs = defaultSchema.attributes["*"] ?? [];

/**
 * GitHub-style sanitize, then KaTeX.
 * - `rehype-raw`: HTML in Markdown (not inside fenced / inline code) becomes elements.
 * - `rehype-sanitize`: strip scripts, bad URLs, etc.; allow limited inline `style` for user HTML.
 * - `rehype-katex`: must run after this sanitize pass (see rehype-sanitize math example).
 */
const chatMarkdownSanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    "*": [...starAttrs, "style"],
    div: [
      ...(defaultSchema.attributes.div ?? []),
      "style",
      ["className", "math", "math-display"],
    ],
    span: [
      ...(defaultSchema.attributes.span ?? []),
      "style",
      ["className", "math", "math-inline"],
    ],
  },
};

export const CHAT_MD_REHYPE_PLUGINS = [
  rehypeRaw,
  [rehypeSanitize, chatMarkdownSanitizeSchema],
  rehypeKatex,
  rehypeChatLabImageGrid(),
];
