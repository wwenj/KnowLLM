import { resolve } from "path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig(({ mode }) => {
  const isDev = mode === "development";
  const reactPlugins = react();
  const tailwindPlugins = tailwindcss();

  return {
    plugins: [
      ...(Array.isArray(reactPlugins) ? reactPlugins : [reactPlugins]),
      ...(Array.isArray(tailwindPlugins) ? tailwindPlugins : [tailwindPlugins]),
    ],
    base: "/",
    resolve: {
      alias: {
        "@": resolve(__dirname, "src"),
      },
    },
    server: {
      port: 43127,
      strictPort: true,
      host: true,
    },
    build: {
      outDir: "dist",
      sourcemap: isDev,
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        output: {
          chunkFileNames: "js/[name]-[hash].js",
          entryFileNames: "js/[name]-[hash].js",
          assetFileNames: (assetInfo) => {
            const name = assetInfo.name || "";
            if (name.endsWith(".css")) return "css/[name]-[hash].[ext]";
            return "assets/[name]-[hash].[ext]";
          },
          manualChunks: (id) => {
            if (
              id.includes("node_modules/react") ||
              id.includes("node_modules/react-dom") ||
              id.includes("node_modules/react-router-dom")
            ) {
              return "react-vendor";
            }
            return undefined;
          },
        },
      },
    },
  };
});
