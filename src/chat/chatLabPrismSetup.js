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

let registered = false;

/** Register Prism grammars once for chat code blocks + artifact preview. */
export function ensureChatLabPrismLanguages() {
  if (registered) return;
  for (const [name, mod] of LANG_PAIRS) {
    SyntaxHighlighter.registerLanguage(name, mod);
  }
  registered = true;
}

ensureChatLabPrismLanguages();

/** @type {ReadonlySet<string>} */
export const CHAT_LAB_PRISM_LANGS = new Set(LANG_PAIRS.map(([n]) => n));
