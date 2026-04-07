import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command }) => ({
  plugins: [react()],
  // GitHub Pages serves this app from /Tourna/ in production.
  base: command === "build" ? "/Tourna/" : "/",
}));
