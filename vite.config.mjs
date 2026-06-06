import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bundledSkillsGenerated = path.resolve(__dirname, "src/skills/openclawBundledSkillManifest.json");
const bundledSkillsStub = path.resolve(__dirname, "src/skills/openclawBundledSkillManifest.stub.json");

/** Until postinstall runs, resolve the generated manifest import to the committed stub. */
function openclawBundledSkillsFallback() {
  return {
    name: "open-studio-openclaw-bundled-skills-fallback",
    enforce: "pre",
    resolveId(source) {
      if (!source.endsWith("openclawBundledSkillManifest.json")) return null;
      if (fs.existsSync(bundledSkillsGenerated)) return null;
      return bundledSkillsStub;
    },
  };
}

/** Avoid `crossorigin` on file:// loads in packaged Electron (can block CSS/JS in some builds). */
function stripIndexCrossorigin() {
  return {
    name: "open-studio-strip-index-crossorigin",
    transformIndexHtml(html) {
      return html.replaceAll(/\s+crossorigin(?:="")?/g, "");
    },
  };
}

export default defineConfig({
  plugins: [openclawBundledSkillsFallback(), react(), tailwindcss(), stripIndexCrossorigin()],
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    reportCompressedSize: false,
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    open: false,
  },
});
