import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

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
  plugins: [react(), tailwindcss(), stripIndexCrossorigin()],
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
