import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bundledSkillsGenerated = path.resolve(__dirname, "src/skills/openclawBundledSkillManifest.json");
const bundledSkillsStub = path.resolve(__dirname, "src/skills/openclawBundledSkillManifest.stub.json");
const iconifyEmojiTestStub = path.resolve(__dirname, "scripts/iconify-emoji-test-stub.mjs");

/** @iconify/utils barrel imports lib/emoji/test/*; Windows Defender often quarantines that folder. */
function iconifyEmojiTestStubPlugin() {
  return {
    name: "open-studio-iconify-emoji-test-stub",
    setup(build) {
      build.onResolve({ filter: /[/\\]test[/\\]/ }, (args) => {
        if (!args.importer.includes("@iconify" + path.sep + "utils")) return;
        return { path: iconifyEmojiTestStub };
      });
    },
  };
}

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

const ORCH_CJS_ENTRIES = {
  "open-studio:orchestration/roles": path.resolve(__dirname, "lib/orchestration/roles.cjs"),
  "open-studio:orchestration/core": path.resolve(__dirname, "lib/orchestration/core.cjs"),
};

/** @type {Map<string, Promise<string>>} */
const orchBundleCache = new Map();

/**
 * Vite dev serves `.cjs` as raw browser modules (`module.exports` throws). Bundle shared
 * orchestration CJS for the renderer while main process keeps requiring the same files.
 */
function orchestrationCjsForBrowser() {
  return {
    name: "open-studio-orchestration-cjs-browser",
    enforce: "pre",
    resolveId(source) {
      if (source.endsWith("lib/orchestration/roles.cjs")) return "open-studio:orchestration/roles";
      if (source.endsWith("lib/orchestration/core.cjs")) return "open-studio:orchestration/core";
      return null;
    },
    async load(id) {
      const entry = ORCH_CJS_ENTRIES[id];
      if (!entry) return null;
      let pending = orchBundleCache.get(id);
      if (!pending) {
        pending = bundleOrchestrationCjs(entry);
        orchBundleCache.set(id, pending);
      }
      return pending;
    },
  };
}

async function bundleOrchestrationCjs(entryPath) {
  const { build } = await import("vite");
  const out = await build({
    configFile: false,
    logLevel: "error",
    build: {
      lib: {
        entry: entryPath,
        formats: ["es"],
        fileName: () => "mod.js",
      },
      write: false,
      minify: false,
      emptyOutDir: false,
    },
  });
  return out[0].output[0].code;
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
  plugins: [
    openclawBundledSkillsFallback(),
    orchestrationCjsForBrowser(),
    react(),
    tailwindcss(),
    stripIndexCrossorigin(),
  ],
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    reportCompressedSize: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes(`${path.sep}src${path.sep}assets${path.sep}geo${path.sep}`)) {
            return "echarts-geo-china";
          }
          if (
            id.includes(`${path.sep}node_modules${path.sep}echarts${path.sep}`)
            || id.includes("chatLabEchartsRuntime")
          ) {
            return "echarts";
          }
        },
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    open: false,
  },
  optimizeDeps: {
    esbuildOptions: {
      plugins: [iconifyEmojiTestStubPlugin()],
    },
  },
});
