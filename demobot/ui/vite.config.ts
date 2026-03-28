import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  root: path.resolve(__dirname, "."),
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/ask":    { target: "http://localhost:3000", changeOrigin: true },
      "/health": { target: "http://localhost:3000", changeOrigin: true },
      "/stt":    { target: "http://localhost:3000", changeOrigin: true },

    },
  },
  build: {
    outDir: path.resolve(__dirname, "../dist-ui"),
    emptyOutDir: true,
  },
});
