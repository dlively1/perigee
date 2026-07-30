import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  // Static-host base path. Defaults to "/" for local dev/preview; a Pages
  // deploy can set BASE_PATH="/perigee/" so built asset URLs resolve under
  // the project-pages subpath.
  base: process.env.BASE_PATH ?? "/",
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ["**/.claude/**"],
    },
  },
  preview: {
    host: true,
    port: 4173,
    strictPort: true,
  },
  build: {
    target: "es2022",
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          phaser: ["phaser"],
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
