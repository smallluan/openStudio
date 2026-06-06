/** Prism language ids for artifact / code preview (shared with chat markdown fences). */

/** @type {Readonly<Record<string, string>>} */
export const EXT_TO_PRISM = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  tsx: "tsx",
  jsx: "jsx",
  json: "json",
  css: "css",
  scss: "css",
  less: "css",
  py: "python",
  rb: "python",
  rs: "rust",
  go: "go",
  java: "java",
  kt: "java",
  swift: "java",
  c: "cpp",
  h: "cpp",
  cpp: "cpp",
  hpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  cs: "csharp",
  sql: "sql",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  ps1: "powershell",
  psm1: "powershell",
  yml: "yaml",
  yaml: "yaml",
  md: "markdown",
  markdown: "markdown",
  html: "markup",
  htm: "markup",
  xml: "markup",
  svg: "markup",
  vue: "markup",
  gql: "graphql",
  graphql: "graphql",
  dockerfile: "bash",
  env: "bash",
  gitignore: "bash",
  toml: "yaml",
  ini: "ini",
  csv: "csv",
};

/**
 * @param {string} filenameOrPath
 * @returns {string} prism language id, or "" for plain text
 */
export function prismLangFromFilename(filenameOrPath) {
  const s = String(filenameOrPath ?? "").trim();
  const dot = s.lastIndexOf(".");
  if (dot < 0) {
    const base = s.split(/[/\\]/).pop()?.toLowerCase() ?? "";
    if (base === "dockerfile") return "bash";
    return "";
  }
  const ext = s.slice(dot + 1).toLowerCase();
  return EXT_TO_PRISM[ext] ?? "";
}
