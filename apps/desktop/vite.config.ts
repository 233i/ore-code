import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],
  resolve: {
    alias: {
      "@ore-code/agent-core": fileURLToPath(new URL("../../packages/agent-core/src/index.ts", import.meta.url)),
      "@ore-code/protocol": fileURLToPath(new URL("../../packages/protocol/src/index.ts", import.meta.url)),
      "@ore-code/state": fileURLToPath(new URL("../../packages/state/src/index.ts", import.meta.url)),
      "@ore-code/tools": fileURLToPath(new URL("../../packages/tools/src/index.ts", import.meta.url))
    }
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  build: {
    // Ore Code is packaged into a local Tauri desktop bundle. The default 500 kB
    // browser-first warning is too low for the desktop shell plus tool UI.
    chunkSizeWarningLimit: 1600
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
